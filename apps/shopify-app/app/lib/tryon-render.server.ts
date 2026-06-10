// ─────────────────────────────────────────────────────────────────────────────
// Real virtual try-on — compositing engine (server-only).
//
// This is the actual fitting-room render: it puts a garment ON a person
// (a pre-rendered muse OR the shopper's own uploaded photo) using Gemini's
// image model (nano-banana, `gemini-2.5-flash-image`). It returns a genuine
// composited image, not the catalog studio shot.
//
// CACHING (founder spec):
//   • Muse renders  → deterministic for (muse × product(s) × size). Cached to
//     disk under public/tryon/<key>.png and served as a static URL. "Done once."
//   • Photo renders → run live when the shopper uploads, cached IN MEMORY only
//     (keyed by a hash of the photo bytes + product + size). The shopper's photo
//     and any composite derived from it NEVER touch disk — privacy invariant
//     D23 / PB17 / §3.5: shopper images are pass-through, never persisted.
//
// COMBINED LOOK: multiple garments are composited sequentially (garment A onto
// the person → result → garment B onto the result → …) so "complete the look"
// is a real multi-piece render on one body.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const MODEL = process.env.TRYON_IMAGE_MODEL ?? "gemini-2.5-flash-image";

// Which Vertex render path to use when Vertex creds are present (Request #3).
//   • "gemini" (default) → Vertex-authed Gemini image model. SAME body as the
//     public path, so it reuses our full fit-prompt engine → the 9-band size
//     differentiation (Request #2) is preserved. Billing stays on GCP credits.
//   • "vto"             → Vertex VTO-001 (virtual-try-on-preview-08-04), the
//     purpose-built garment-swap model. Highest garment fidelity but it does
//     NOT honor text fit-prompts → size differentiation is lost. Use only when
//     single-garment realism matters more than showing the fit difference.
// Either way, if the Vertex call throws we fall back to public Gemini so the
// demo never goes dark when GCP hiccups.
const VERTEX_PATH = (process.env.VERTEX_RENDER_PATH ?? "gemini").toLowerCase();
const PUBLIC_DIR = path.join(process.cwd(), "public");
const MUSE_CACHE_DIR = path.join(PUBLIC_DIR, "tryon");

// In-memory cache for photo composites (never written to disk).
const photoCache = new Map<string, string>(); // key → data URL
const PHOTO_CACHE_CAP = 200;
// Render-in-flight dedup (panel P1 — cache stampede). When N shoppers hit the
// SAME cold muse key at once, they all miss photoCache and would each fire a
// 4-8s Gemini render. This map holds the single in-flight render promise per key
// so the other N-1 await it instead of spawning duplicates.
const museInFlight = new Map<string, Promise<string>>();

export type TryOnMode = "muse" | "photo";

export interface TryOnRequest {
  mode: TryOnMode;
  /** Public path of the muse image, e.g. "/muses/slim.png" (muse mode only). */
  museImage?: string;
  /** Data URL of the shopper's photo (photo mode only — in-memory only). */
  photoDataUrl?: string;
  /** Public paths of the garment image(s), first = focus piece, rest = look. */
  garmentImages: string[];
  /** Size label (XS/S/M/L/XL) — influences the rendered fit. */
  size: string;
  /** The recommended size, so we can phrase the relative fit honestly. */
  recommendedSize?: string;
  /** Focus garment kind ("top"|"bottom"|"dress"|"outerwear") — drives the fit axis. */
  garmentKind?: string;
  /** Stable id for the muse, used in the cache key (muse mode). */
  museId?: string;
  /** Stable handle for the focus product, used in the cache key. */
  handle?: string;
  /** Signed ease in cm of the BINDING region (− = tight, + = roomy) — render magnitude. */
  easeCm?: number;
  /** Tightness −1..+1 (− = pulling, + = voluminous) — render magnitude. */
  tightness?: number;
  /** The region that binds (e.g. "Waist") so the render names where it pulls/drapes. */
  bindLabel?: string;
  /**
   * Per-garment fit descriptors for a COMBINED look, in the same order as
   * garmentImages. Each piece carries its OWN size + ease so the render shows
   * the pant at the pant's size and the top at the top's size — not one global
   * size applied to everything. (Founder D: "it did not change the pant size as
   * well.") Ignored for a single-garment render (the top-level fields drive it).
   */
  garmentFits?: GarmentFit[];
}

export interface GarmentFit {
  /** Display name, e.g. "Atelier Wide-Leg Trouser". */
  name: string;
  /** "top" | "bottom" | "dress" | "outerwear" — drives the fit axis. */
  kind: string;
  /** Size label this specific piece is worn at. */
  size: string;
  /** Signed ease (cm) of this piece's binding region (− tight, + roomy). */
  easeCm?: number;
  /** The region that binds for this piece (e.g. "Hip"). */
  bindLabel?: string;
}

export interface TryOnResult {
  /** A URL the client can render: static "/tryon/..." (muse) or a data URL (photo). */
  imageUrl: string;
  cached: boolean;
  ms: number;
}

const DATA_URL_RE = /^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/;

// Only allow reading assets we actually ship — block path traversal.
function resolvePublicAsset(p: string): string | null {
  if (!p.startsWith("/products/") && !p.startsWith("/muses/")) return null;
  const clean = p.split("?")[0].replace(/\.\.+/g, "");
  const abs = path.join(PUBLIC_DIR, clean);
  if (!abs.startsWith(PUBLIC_DIR)) return null;
  return abs;
}

async function readAssetB64(publicPath: string): Promise<string> {
  // Storefront port: muse images (Railway) + garment images (Shopify/CloudFront)
  // are REMOTE https URLs — fetch them. Only fall back to local for relative
  // /products//muses/ paths (dev). https only; block other schemes.
  if (/^https:\/\//i.test(publicPath)) {
    // Bound the fetch (panel P1 — regression in EXPERT-PANEL-5's in-flight dedup):
    // the museInFlight promise only clears its key on settle, so a hung CDN fetch
    // here would leave the key forever and grow the map unboundedly. A 15s timeout
    // guarantees the promise always settles → finally() always fires.
    const res = await fetch(publicPath, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`asset_fetch_${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  }
  const abs = resolvePublicAsset(publicPath);
  if (!abs) throw new Error(`invalid_asset:${publicPath}`);
  const buf = await fs.readFile(abs);
  return buf.toString("base64");
}

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"];

// Garment-type-aware language so a size change reads correctly on the right axis:
// a top changes through the shoulders/chest/body, a bottom through the waist/hips
// and length. Founder: "by looking at measurements … how actually they will look."
function fitAxis(kind?: string): { tight: string; loose: string } {
  switch (kind) {
    case "bottom":
      return {
        tight: "snug at the waist and hips with a slimmer leg and a shorter break at the ankle",
        loose: "easier through the waist and hips with a fuller, longer leg pooling slightly at the ankle",
      };
    case "dress":
      return {
        tight: "closer through the bust, waist and hips with a shorter hem",
        loose: "looser through the bust, waist and hips with a longer, more fluid hem",
      };
    case "outerwear":
      return {
        tight: "trim through the shoulders and body with sleeves ending at the wrist",
        loose: "roomier through the shoulders and body with a draped, longer line and longer sleeves",
      };
    default: // top / unknown
      return {
        tight: "closer through the shoulders, chest and body with a shorter, trimmer line",
        loose: "looser through the shoulders, chest and body with extra drape and a longer line",
      };
  }
}

// Absolute anchor: the same size should ALWAYS read the same way regardless of
// who is wearing it — XS is the trimmest cut the garment comes in, XXL the most
// voluminous. This guarantees two different sizes are visibly different even when
// neither equals the recommended size. (Founder SIZE-1 / Fix #2.)
function absoluteFitClause(size: string, axis: { tight: string; loose: string }): string {
  const i = SIZE_ORDER.indexOf(size.toUpperCase());
  if (i < 0) return "";
  // Map the 6-point size scale to a -2..+3 cut intensity around M.
  const intensity = i - 2; // XS=-2 … M=0 … XXL=+3
  if (intensity <= -2) return `This is the SMALLEST cut available — render it dramatically ${axis.tight}; the fabric should clearly strain and pull tight against the body.`;
  if (intensity === -1) return `This is a smaller cut — render it clearly ${axis.tight}; close to the body with visible tension in the fabric.`;
  if (intensity === 0) return "This is the mid cut — render a clean, true-to-size fit that skims the body.";
  if (intensity === 1) return `This is a larger cut — render it clearly ${axis.loose}; obvious extra room and drape.`;
  return `This is the LARGEST cut available — render it dramatically ${axis.loose}; oversized and visibly voluminous with heavy draping and excess fabric.`;
}

// The measurement-honest magnitude: the actual signed ease (cm) of THIS size on
// THIS shopper's body. This is the concrete number that makes the render reflect
// real brand + body measurements rather than a generic guess. Founder: "show how
// big it is … if something's tight, make sure they see that it's tight … it does
// not need to fake it or try to hide it."
function easeMagnitudeClause(easeCm: number | undefined, axis: { tight: string; loose: string }, bindLabel?: string): string {
  if (easeCm == null || !Number.isFinite(easeCm)) return "";
  const cm = Math.round(easeCm);
  const at = bindLabel ? ` at the ${bindLabel.toLowerCase()}` : "";
  // ── TIGHT side — graded so −10cm and −24cm do NOT render the same ──────────
  if (cm <= -22) return `On this body the garment is about ${Math.abs(cm)}cm FAR TOO SMALL${at} — render it EXTREMELY tight, almost unwearable: the fabric is stretched to its limit and visibly straining, gaping or refusing to close${at}, with hard stress lines and pull-creases radiating across the cloth, ${axis.tight}. It must look painfully, obviously too small — do NOT smooth, tuck, re-cut, or make it look wearable.`;
  if (cm <= -12) return `On this body the garment is about ${Math.abs(cm)}cm much too small${at} — render it VERY tight: the fabric is stretched taut and clearly straining and pulling${at}, with visible stress lines, ${axis.tight}. It must look distinctly too small and uncomfortable — do NOT smooth it out, tuck it in, re-cut it, or make it look comfortable.`;
  if (cm <= -6) return `On this body the garment is about ${Math.abs(cm)}cm too small${at} — render it clearly tight, hugging close with the fabric pulling and slight stress lines${at}, ${axis.tight}. Show the tightness honestly; do not loosen or hide it.`;
  if (cm <= -3) return `On this body the garment is about ${Math.abs(cm)}cm snug${at} — render it fitted and close to the body${at}, ${axis.tight}. Snug but wearable; show it honestly.`;
  // ── TRUE ──────────────────────────────────────────────────────────────────
  if (cm < 4) return "On this body the garment sits true — render a clean, body-skimming fit with natural ease.";
  // ── LOOSE side — graded so +16cm and +33cm do NOT render the same ─────────
  if (cm < 9) return `On this body the garment has about ${cm}cm of ease${at} — render it lightly relaxed with a little soft give${at}, ${axis.loose}. Not tight, not baggy — gently roomy.`;
  if (cm < 16) return `On this body the garment has about ${cm}cm of ease${at} — render it clearly OVERSIZED and roomy with visible loose folds${at}, ${axis.loose}. Make the looseness obvious; do not take it in.`;
  if (cm < 26) return `On this body the garment has about ${cm}cm of ease${at} — render it VERY oversized and baggy with large folds of excess fabric draping and hanging off the body${at}, ${axis.loose}. It must look unmistakably big and slouchy — do NOT take it in or make it look fitted.`;
  return `On this body the garment has about ${cm}cm of ease${at} — render it EXTREMELY oversized, the body practically swimming in fabric: huge billowing folds, dropped shoulders, sleeves and hem pooling far past where they should sit${at}, ${axis.loose}. It must look enormously, comically too big — absolutely do NOT take it in, fit it, or make it look intentional.`;
}

// Relative anchor: how this size compares to the size we recommended for THIS
// shopper's measurements — graded by how many sizes apart it is.
function relativeFitClause(size: string, recommended: string | undefined, axis: { tight: string; loose: string }): string {
  if (!recommended) return "";
  const di = SIZE_ORDER.indexOf(size.toUpperCase());
  const ri = SIZE_ORDER.indexOf(recommended.toUpperCase());
  if (di < 0 || ri < 0) return "";
  const steps = di - ri;
  if (steps === 0) return "This is the shopper's recommended size — it should sit cleanly and true to their body.";
  const mag = Math.abs(steps) >= 2 ? "much" : "a bit";
  return steps > 0
    ? `It is ${Math.abs(steps)} size(s) above their recommended size, so it should look ${mag} ${axis.loose} on them.`
    : `It is ${Math.abs(steps)} size(s) below their recommended size, so it should look ${mag} ${axis.tight} on them.`;
}

// IDENTITY LOCK (founder S6-1B — "the whole model changed, and his face got
// cut. Why is this? That is so wrong."). The single most important constraint:
// the person is FIXED. Only their clothing may change. The full head must stay
// in frame — never crop, never swap the individual, never re-pose.
const IDENTITY_LOCK =
  "ABSOLUTE IDENTITY LOCK — this is the most important rule: the person in the FIRST image must remain the EXACT SAME individual. Preserve their face, facial features, expression, hairstyle, hair colour, skin tone, body shape, height, proportions, pose and stance with zero change. Keep the SAME plain studio background. The person's WHOLE head and face MUST stay fully visible inside the frame — never crop, cut off, zoom into, or hide the head or any part of the face. Do NOT generate a different-looking person, do NOT beautify, slim, age, or restyle them, do NOT change the camera angle or crop. The ONLY thing you may change is the clothing on their body.";

// GARMENT FIDELITY LOCK (founder G — "it really changed the V neck to a circle
// neck and changed the material … it should show the truth only"). The garment's
// IDENTITY is fixed by its product photo; only its FIT/drape on the body changes
// with size. Neckline shape, fabric, thickness, sleeves, closures, print and
// colour must be reproduced exactly — never substituted.
const GARMENT_FIDELITY =
  "GARMENT FIDELITY — render the EXACT garment shown in the garment image(s), truthfully. You MUST preserve, with zero substitution: the precise NECKLINE shape (a V-neck stays a sharp V, a crew/round neck stays round, a collar stays the same collar — never swap one neckline for another), the exact FABRIC and material (silk stays fluid silk, knit stays knit, denim stays denim, leather stays leather), the material's THICKNESS and weight, the SLEEVE length and shape, the HEM length and shape, every closure (buttons/zip/tie), any PRINT or pattern, and the exact COLOUR. Do NOT redesign, simplify, restyle, or 'improve' the garment. The ONLY thing that may differ from the product photo is how the piece DRAPES and FITS on this body at the requested size. Show the truth of the garment.";

// Garment-type-aware replacement (founder P2a — a dress "should remove the pants
// underneath … It's not worn with these"). Tell the model exactly which existing
// garments to REMOVE before dressing, by the kind of the focus garment, so we
// never get a dress layered over trousers or a coat over nothing sensible.
function replacementClause(kind: string | undefined, multi: boolean): string {
  if (multi) {
    // In a complete-the-look render the supplied garments define the whole outfit.
    return "Remove ALL of the person's original clothing first, then dress them in ONLY the supplied garments — nothing from their original outfit should remain visible underneath or alongside. EVERY supplied garment MUST be clearly visible and worn in the final image — never drop, hide, omit, or shorten a piece so it disappears. If a long dress or coat is supplied, render it at its FULL length; do not cut it off or let it vanish behind another piece.";
  }
  switch (kind) {
    case "dress":
      return "This is a DRESS — a single full-body garment. Remove EVERYTHING the person is currently wearing on both their upper and lower body (any top, shirt, trousers, pants, skirt or shorts) and dress them in ONLY this dress. There must be NO trousers, pants, or separate top visible — the dress is worn on its own over bare legs as a dress is normally worn.";
    case "bottom":
      // CONSISTENCY LOCK: keep the model's EXISTING top exactly as in the base
      // photo so changing the bottom's size is the ONLY thing that moves between
      // renders (founder: "sometimes it grabs the shirt, sometimes it does that").
      return "This is a BOTTOM (trousers/skirt). Change ONLY the lower-body garment. Keep the person's EXISTING top EXACTLY as it appears in the first image — the same garment, same colour, same cut, same drape — do not redesign, restyle, recolour, or swap it. Everything except the bottom must stay identical to the first image.";
    case "outerwear":
      return "This is OUTERWEAR worn as the top layer. Put this piece on as the outermost layer over the person's EXISTING outfit, keeping whatever they already wear underneath EXACTLY as it appears in the first image (same garments, same colours) — do not invent or change the clothes underneath. Change ONLY by adding this outer layer.";
    default: // top / knitwear
      // CONSISTENCY LOCK — see "bottom" above. Preserve the model's existing
      // lower-body garment instead of inventing "neutral bottoms" each render.
      return "This is an UPPER-BODY garment. Change ONLY the top. Keep the person's EXISTING lower-body garment (trousers / leggings / skirt) EXACTLY as it appears in the first image — the same garment, same colour, same cut — do not redesign, restyle, recolour, or swap it. Everything except the top must stay identical to the first image.";
  }
}

// Per-piece fit for a COMBINED look — describes EACH garment at its own size and
// ease so the render shows them genuinely differently (the pant at the pant's
// size, the top at the top's). Founder D: "Large looks like small or medium, it
// did not change the pant size as well … which should really look loose."
function perPieceFitBlock(fits: GarmentFit[]): string {
  const lines = fits.map((f) => {
    const axis = fitAxis(f.kind);
    const ease = easeMagnitudeClause(f.easeCm, axis, f.bindLabel);
    const abs = absoluteFitClause(f.size, axis);
    return `• The ${f.name} (${f.kind}) is worn at size ${f.size.toUpperCase()}. ${[abs, ease].filter(Boolean).join(" ")}`;
  });
  return [
    "Each garment is worn at its OWN size — they are NOT all the same size. Render each piece's fit independently from its own measurements below:",
    ...lines,
    "CRITICAL: each piece's fit MUST be obvious and honest at a glance — a tight piece visibly pulls and strains, a loose/large piece visibly drapes and looks oversized with excess fabric. Never render a piece smaller or larger than its stated size, and never smooth, tuck, pin or flatter a poor fit. Show the truth of every piece.",
  ].join(" ");
}

function buildPrompt(garmentCount: number, size: string, recommended?: string, kind?: string, easeCm?: number, bindLabel?: string, garmentFits?: GarmentFit[]): string {
  const axis = fitAxis(kind);
  const ease = easeMagnitudeClause(easeCm, axis, bindLabel);
  const rel = relativeFitClause(size, recommended, axis);
  // When the body-honest ease is a STRONG signal (very tight or very loose on
  // this body), the size-letter clause can contradict it (e.g. "M = mid cut,
  // skims the body" while the body makes M sit +17cm oversized). The ease is the
  // truth, so drop the letter clause in that case — otherwise the model averages
  // the two and renders a bland "true" fit, hiding the looseness/tightness the
  // shopper must see. (Founder D: "which should really look loose.")
  const strongEase = easeCm != null && Number.isFinite(easeCm) && Math.abs(easeCm) >= 8;
  const abs = strongEase ? "" : absoluteFitClause(size, axis);
  const fit = [
    `The shopper selected size ${size.toUpperCase()}.`,
    "Render the fit from the requested size and the measurements below — do NOT copy the fit, drape or proportions shown in the garment's own product photo; that photo is only a reference for the garment's colour, fabric and cut.",
    abs,
    ease,
    rel,
    "CRITICAL: the fit difference between sizes MUST be obvious at a glance — a small size must look noticeably tighter and a large size noticeably bigger than the true size. Never render different sizes the same. Show the HONEST fit — if it is tight, show it pulling; if it is big, show it draping and oversized. Do not tuck, pin, flatter, or hide a poor fit.",
  ].filter(Boolean).join(" ");
  if (garmentCount === 1) {
    return [
      "You are a virtual try-on engine for a luxury fashion store.",
      "The FIRST image is a person (a model on a plain studio backdrop).",
      "The SECOND image shows a garment.",
      IDENTITY_LOCK,
      GARMENT_FIDELITY,
      replacementClause(kind, false),
      "The garment must wrap the body naturally and photorealistically, with correct folds, drape and shadows.",
      fit,
      "Full-length, head-to-feet fashion lookbook photograph showing the person's whole body from head to feet, soft even studio lighting, sharp focus.",
      "Output ONLY the edited photograph.",
    ].join(" ");
  }
  // Combined look: prefer the per-piece fit block (each garment at its own size)
  // and fall back to the single global fit description only if no per-piece data.
  const multiFit = garmentFits && garmentFits.length ? perPieceFitBlock(garmentFits) : fit;
  return [
    "You are a virtual try-on engine for a luxury fashion store.",
    "The FIRST image is a person (a model on a plain studio backdrop).",
    "The REMAINING images are separate garments that together form one outfit.",
    IDENTITY_LOCK,
    GARMENT_FIDELITY,
    replacementClause(kind, true),
    "Dress the person in ALL of the supplied garments at once, layered/combined into a single complete, coherent outfit, each worn in its natural position (tops on top, bottoms on the lower body, outerwear as the outer layer, accessories placed correctly).",
    "Every garment must fit naturally and photorealistically with correct drape and shadows; the pieces should look styled together.",
    multiFit,
    "Full-length, head-to-feet fashion lookbook photograph showing the person's whole body from head to feet, soft even studio lighting, sharp focus.",
    "Output ONLY the edited photograph.",
  ].join(" ");
}

async function callGemini(prompt: string, personB64: string, personMime: string, garmentB64s: string[]): Promise<{ b64: string; mime: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no_api_key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const parts: Array<Record<string, unknown>> = [
    { text: prompt },
    { inlineData: { mimeType: personMime, data: personB64 } },
    ...garmentB64s.map((g) => ({ inlineData: { mimeType: "image/png", data: g } })),
  ];
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }] }),
    signal: AbortSignal.timeout(75_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[tryon] gemini http", res.status, txt.slice(0, 300));
    throw new Error("render_failed");
  }
  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string } }> } }>;
  };
  const outParts = j.candidates?.[0]?.content?.parts ?? [];
  const img = outParts.find((p) => p.inlineData);
  if (!img?.inlineData) {
    console.error("[tryon] gemini no image part");
    throw new Error("render_no_image");
  }
  return { b64: img.inlineData.data, mime: img.inlineData.mimeType || "image/png" };
}

// ─── Provider selector (Request #3 — Vertex when configured, else public) ────
// One entry point for every render. Prefers Vertex on GCP credits when the
// service-account env is present; always falls back to public Gemini so the
// demo never breaks when Vertex env is absent or a Vertex call errors.
async function renderImage(
  prompt: string,
  personB64: string,
  personMime: string,
  garmentB64s: string[],
): Promise<{ b64: string; mime: string }> {
  // Public Gemini img2img only (Vertex stripped for the storefront port).
  return callGemini(prompt, personB64, personMime, garmentB64s);
}

// The ease bucket keeps the deterministic muse cache correct now that the render
// reflects the shopper's body: two shoppers whose body makes the SAME size fit
// noticeably differently get distinct cached renders, while identical bodies
// still hit "done once". Bucketed to 4cm so we don't fragment the cache per-gram.
function easeBucket(easeCm?: number): string {
  if (easeCm == null || !Number.isFinite(easeCm)) return "e0";
  const b = Math.round(easeCm / 4) * 4;
  return `e${b >= 0 ? "p" : "m"}${Math.abs(b)}`;
}

function museCacheKey(museId: string, handle: string, size: string, lookHandles: string[], easeCm?: number, garmentFits?: GarmentFit[]): string {
  const look = lookHandles.length ? `_look-${[...lookHandles].sort().join("-")}` : "";
  // Combined looks: fold each non-focus piece's size + ease bucket into the key
  // so the same look rendered at different per-piece fits caches as distinct
  // assets (and a body that fits a look piece differently re-renders correctly).
  let perPiece = "";
  if (garmentFits && garmentFits.length > 1) {
    perPiece =
      "_fits-" +
      garmentFits
        .slice(1)
        .map((f) => `${f.size.toLowerCase()}${easeBucket(f.easeCm)}`)
        .sort()
        .join("");
  }
  return `m-${museId}-${handle}-${size.toLowerCase()}-${easeBucket(easeCm)}${look}${perPiece}`;
}

export async function renderTryOn(req: TryOnRequest): Promise<TryOnResult> {
  const t0 = Date.now();
  const garmentImages = req.garmentImages.filter(Boolean).slice(0, 4);
  if (garmentImages.length === 0) throw new Error("no_garment");

  // ── Muse mode: disk cache (public, static URL). ──
  if (req.mode === "muse") {
    if (!req.museImage || !req.museId || !req.handle) throw new Error("muse_args");
    const museImage = req.museImage; // narrowed to string here — capture so the in-flight closure keeps the narrowing
    const lookHandles = garmentImages
      .slice(1)
      .map((g) => g.split("/").pop()?.replace(/-\d+\.png$|-[a-z]+\.png$/i, "") ?? "");
    // Storefront port: muse renders are returned as data URLs (cross-origin
    // safe) and cached IN MEMORY by deterministic key. No disk, no static URL.
    const key = museCacheKey(req.museId, req.handle, req.size, lookHandles, req.easeCm, req.garmentFits);
    const memHit = photoCache.get(key);
    if (memHit) return { imageUrl: memHit, cached: true, ms: Date.now() - t0 };
    // Collapse a cache stampede: if a render for this exact key is already in
    // flight, await it instead of firing a duplicate Gemini call (panel P1).
    let flight = museInFlight.get(key);
    if (!flight) {
      flight = (async () => {
        const personB64 = await readAssetB64(museImage);
        const garmentB64s = await Promise.all(garmentImages.map(readAssetB64));
        const prompt = buildPrompt(garmentB64s.length, req.size, req.recommendedSize, req.garmentKind, req.easeCm, req.bindLabel, req.garmentFits);
        const out = await renderImage(prompt, personB64, "image/png", garmentB64s);
        const url = `data:${out.mime};base64,${out.b64}`;
        if (photoCache.size >= PHOTO_CACHE_CAP) {
          const first = photoCache.keys().next().value;
          if (first) photoCache.delete(first);
        }
        photoCache.set(key, url);
        return url;
      })();
      museInFlight.set(key, flight);
      void flight.catch(() => undefined).finally(() => museInFlight.delete(key));
    }
    const dataUrl = await flight;
    return { imageUrl: dataUrl, cached: false, ms: Date.now() - t0 };
  }

  // ── Photo mode: in-memory cache only, returns a data URL. Never hits disk. ──
  if (!req.photoDataUrl || !DATA_URL_RE.test(req.photoDataUrl)) throw new Error("bad_photo");
  const personB64 = req.photoDataUrl.split(",")[1] ?? "";
  const personMime = req.photoDataUrl.slice(5, req.photoDataUrl.indexOf(";")) || "image/png";
  const photoHash = createHash("sha256").update(personB64).digest("hex").slice(0, 24);
  const lookKey = garmentImages.join("|");
  const memKey = `p-${photoHash}-${req.handle ?? "x"}-${req.size}-${easeBucket(req.easeCm)}-${createHash("sha256").update(lookKey).digest("hex").slice(0, 12)}`;
  const hit = photoCache.get(memKey);
  if (hit) return { imageUrl: hit, cached: true, ms: Date.now() - t0 };

  const garmentB64s = await Promise.all(garmentImages.map(readAssetB64));
  const prompt = buildPrompt(garmentB64s.length, req.size, req.recommendedSize, req.garmentKind, req.easeCm, req.bindLabel);
  const out = await renderImage(prompt, personB64, personMime, garmentB64s);
  const dataUrl = `data:${out.mime};base64,${out.b64}`;
  if (photoCache.size >= PHOTO_CACHE_CAP) {
    const first = photoCache.keys().next().value;
    if (first) photoCache.delete(first);
  }
  photoCache.set(memKey, dataUrl);
  return { imageUrl: dataUrl, cached: false, ms: Date.now() - t0 };
}
