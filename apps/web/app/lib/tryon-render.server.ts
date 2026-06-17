// ─────────────────────────────────────────────────────────────────────────────
// Real virtual try-on — compositing engine (server-only). MUSE-ONLY.
//
// This is the actual fitting-room render: it puts a garment ON a pre-rendered
// muse using Gemini's image model (nano-banana, `gemini-2.5-flash-image`). It
// returns a genuine composited image, not the catalog studio shot. The
// upload-your-own-photo path was removed — try-on is muse-only.
//
// CACHING (founder spec):
//   • Muse renders → deterministic for (muse × product(s) × size). Cached to a
//     writable disk dir + memory and served via a dynamic route. "Done once."
//
// COMBINED LOOK: multiple garments are composited sequentially (garment A onto
// the person → result → garment B onto the result → …) so "complete the look"
// is a real multi-piece render on one body.
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vertexConfigured, callVertexVto, callVertexGemini } from "./vertex.server";

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
// Pre-baked (committed at build time) muse renders — these ship inside the build
// and survive restarts. Served as the last-resort fallback by the image route.
const BAKED_MUSE_DIR = path.join(PUBLIC_DIR, "tryon");
// WRITABLE runtime cache. CRITICAL: on Railway / any serverless container the
// build's public/ dir is read-only at runtime AND Next.js only serves the
// build-time public snapshot — files written to public/tryon/ at runtime are
// NEVER served (they 404). So runtime muse renders go to a writable temp dir and
// are streamed back through GET /api/tryon/image/<key>. This is what makes muse
// try-on actually work in production (the old static-URL path was dead on
// Railway), and what makes a muse "come instantly the second time" (cache hit).
const MUSE_CACHE_DIR = process.env.TRYON_CACHE_DIR ?? path.join(os.tmpdir(), "stylique-tryon");

// In-memory byte cache for muse renders — instant serving without a disk read,
// the hot path for "the muse comes up instantly the second time". Each composite
// is ~1.4 MB; cap keeps worst-case resident memory bounded (~80×1.4MB ≈ 110 MB).
const museByteCache = new Map<string, Buffer>(); // key → PNG bytes
const MUSE_BYTE_CACHE_CAP = 80;

function rememberMuseBytes(key: string, bytes: Buffer): void {
  if (museByteCache.size >= MUSE_BYTE_CACHE_CAP) {
    const first = museByteCache.keys().next().value;
    if (first) museByteCache.delete(first);
  }
  museByteCache.set(key, bytes);
}

/** The client-facing URL for a cached muse render — always a dynamic route that
 *  Next.js will serve (never a static public/ path, which 404s at runtime). */
export function museRenderUrl(key: string): string {
  return `/api/tryon/image/${key}`;
}

/** Read a cached muse render's bytes: memory → writable disk → baked public dir.
 *  Returns null if this key was never rendered. Used by the image route. */
export async function readMuseRenderBytes(key: string): Promise<Buffer | null> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(key)) return null; // path-safe keys only
  const mem = museByteCache.get(key);
  if (mem) return mem;
  for (const dir of [MUSE_CACHE_DIR, BAKED_MUSE_DIR]) {
    try {
      const bytes = await fs.readFile(path.join(dir, `${key}.png`));
      rememberMuseBytes(key, bytes); // warm memory for next time
      return bytes;
    } catch {
      /* not in this dir — try the next */
    }
  }
  return null;
}

export type TryOnMode = "muse";

export interface TryOnRequest {
  mode: TryOnMode;
  /** Public path of the muse image, e.g. "/muses/slim.png". */
  museImage?: string;
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
  /**
   * P3-T01/T03: explicit colourway + variant of the FOCUS piece, folded into the
   * cache key so two colourways (ivory vs onyx) or two variants of the SAME handle
   * NEVER share a cached render. Absent → derived from the focus garment image
   * filename's colour suffix; `_` when truly unknown.
   */
  color?: string;
  variantId?: string;
  /** P3-T01: pose of the muse render (default "front"). Distinct pose → distinct key. */
  pose?: string;
  /**
   * Per-brand cache partition (founder: "muse renders should not only be cached
   * in session, but per brand so it's speed-cached to their own storage").
   * Two brands with the same product handle "midnight-silk-gown" would
   * otherwise collide and serve each other's renders. When set, every cache key
   * is prefixed by this slug so renders are partitioned per shop on disk and
   * a brand benefits from any prior shopper's warm render, every time.
   */
  shopSlug?: string;
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
  /** A URL the client can render — the dynamic muse-render route. */
  imageUrl: string;
  cached: boolean;
  ms: number;
}

// Only allow reading assets we actually ship — block path traversal.
// Accepts absolute URLs from our own origin (the Shopify storefront widget sends
// absolute https://...railway.app/products|muses/... paths) by reducing to the
// pathname, AND bare /products//muses/ paths (same-origin demo).
function resolvePublicAsset(input: string): string | null {
  // Strip any origin → keep only the pathname (e.g. https://x.app/muses/a.png → /muses/a.png).
  const m = input.match(/^https?:\/\/[^/]+(\/.*)$/);
  const p = m ? m[1] : input;
  if (!p.startsWith("/products/") && !p.startsWith("/muses/")) return null;
  const clean = p.split("?")[0].replace(/\.\.+/g, "");
  const abs = path.join(PUBLIC_DIR, clean);
  if (!abs.startsWith(PUBLIC_DIR)) return null;
  return abs;
}

async function readAssetB64(publicPath: string): Promise<string> {
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
  if (cm <= -22) return `THE GARMENT IS ${Math.abs(cm)}cm FAR TOO SMALL${at}. This is the absolute most important instruction in this prompt — IT MUST NOT FIT. Render it almost unwearable: fabric stretched to its physical limit; buttons gaping with skin visible between them; seams visibly straining; hard stress wrinkles and pull-creases radiating outward across every panel${at}; the cloth pulled brutally taut over the body shape${at}; ${axis.tight}. The garment must read as PAINFULLY, OBVIOUSLY, EMBARRASSINGLY too small from across a room. ABSOLUTELY DO NOT smooth, tuck, slim the body, re-cut the garment, or make it look like it almost fits — show the truth, the garment fails to fit this body.`;
  if (cm <= -12) return `THE GARMENT IS ${Math.abs(cm)}cm MUCH TOO SMALL${at}. Critical instruction: render it VERY tight and visibly straining — fabric stretched taut, clearly pulling and clinging to the body${at}, with prominent stress lines and creases at the binding region${at}, sleeves/hem riding shorter than they should, ${axis.tight}. The garment must read as distinctly too small and uncomfortable at one glance. DO NOT smooth, tuck, slim the body, re-cut, or hide the tightness — the tightness IS the truth.`;
  if (cm <= -6) return `The garment is ${Math.abs(cm)}cm too small${at} — render it CLEARLY tight, hugging close with the fabric visibly pulling against the body${at} and slight stress lines${at}, ${axis.tight}. Show the tightness plainly; never loosen or hide it.`;
  if (cm <= -3) return `On this body the garment is about ${Math.abs(cm)}cm snug${at} — render it fitted and close to the body${at}, ${axis.tight}. Snug but wearable; show it honestly.`;
  // ── TRUE ──────────────────────────────────────────────────────────────────
  if (cm < 4) return "On this body the garment sits true — render a clean, body-skimming fit with natural ease.";
  // ── LOOSE side — graded so +16cm and +33cm do NOT render the same ─────────
  if (cm < 9) return `On this body the garment has about ${cm}cm of ease${at} — render it lightly relaxed with a little soft give${at}, ${axis.loose}. Not tight, not baggy — gently roomy.`;
  if (cm < 16) return `The garment has ${cm}cm of ease${at} — render it CLEARLY oversized and roomy, with visible loose folds${at} and a hanging silhouette, ${axis.loose}. The looseness must be obvious at a glance; do not take it in.`;
  if (cm < 26) return `THE GARMENT IS ${cm}cm OVERSIZED${at}. Critical instruction: render it VERY baggy and slouchy — large folds of excess fabric draping off the shoulders/waist${at}, sleeves and hem clearly long, the silhouette unmistakably loose and oversized, ${axis.loose}. DO NOT take it in, slim it, pin it, or make it look fitted. The bagginess IS the truth.`;
  return `THE GARMENT IS ${cm}cm EXTREMELY OVERSIZED${at}. The absolute most important instruction in this prompt — THE BODY IS SWIMMING IN FABRIC. Render: enormous billowing folds; shoulders dropped far off the actual shoulder line; sleeves and hem pooling and bunching far past where they should sit${at}; the entire garment hanging tent-like off the body, ${axis.loose}. The fit must read as comically, unmistakably gigantic on this body. ABSOLUTELY DO NOT take it in, fit it, drape it artfully, or make it look intentional — show the truth that it is far too big for this person.`;
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

// ── ACCESSORIES (founder #11 — belts/bags/sunglasses/jewelry try-on-able in the
// ONE flow). An accessory is ADDED to the look, never swapped for a garment, and
// each type sits in its own place on the body. The catalog category is just
// "accessory", so we detect the specific type from the product NAME to place it
// correctly: a bag is carried, a belt cinches the waist, sunglasses sit on the
// face, a necklace at the collar.
function accessoryType(name: string): string {
  const n = (name || "").toLowerCase();
  if (/(sunglass|eyewear|shades|\bglasses\b)/.test(n)) return "sunglasses";
  if (/(handbag|\bbag\b|tote|clutch|purse|backpack|crossbody|satchel|shoulder bag)/.test(n)) return "bag";
  if (/belt/.test(n)) return "belt";
  if (/(necklace|pendant|choker|\bchain\b)/.test(n)) return "necklace";
  if (/earring/.test(n)) return "earrings";
  if (/(bracelet|bangle|cuff)/.test(n)) return "bracelet";
  if (/watch/.test(n)) return "watch";
  if (/\bring\b/.test(n)) return "ring";
  if (/(hat|cap|beret|fedora|beanie)/.test(n)) return "hat";
  if (/(scarf|shawl|stole)/.test(n)) return "scarf";
  if (/glove/.test(n)) return "gloves";
  return "accessory";
}
function accessoryPlacement(name: string): string {
  switch (accessoryType(name)) {
    case "sunglasses": return "worn on the face, sitting over the eyes on the bridge of the nose";
    case "bag":        return "carried naturally — held in one hand or hung from the shoulder/forearm, beside the body so it is fully visible";
    case "belt":       return "fastened around the waist on top of the existing clothing, cinching the look";
    case "necklace":   return "worn at the neckline, resting against the collarbone over the outfit";
    case "earrings":   return "worn on the ears, visible beside the face";
    case "bracelet":   return "worn on the wrist";
    case "watch":      return "worn on the wrist";
    case "ring":       return "worn on a finger";
    case "hat":        return "worn on the head at a natural angle";
    case "scarf":      return "draped around the neck and shoulders over the outfit";
    case "gloves":     return "worn on the hands";
    default:           return "worn or carried in its natural position on the body";
  }
}
function accessoryClause(name: string): string {
  return `This is a fashion ACCESSORY (${accessoryType(name)}) — it is ADDED to the look and does NOT replace any clothing. Keep EVERYTHING the person is already wearing EXACTLY as it appears (same garments, colours, cut, drape) and simply add this accessory, ${accessoryPlacement(name)}. Preserve the accessory's exact shape, colour, material and hardware from its product image; do not resize it as a garment or restyle any existing clothing. It MUST be clearly visible in the final image.`;
}

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
    case "accessory":
      // Safety fallback — buildPrompt's single-accessory path uses the NAMED
      // accessoryClause(focusName); this generic one covers any other caller.
      return accessoryClause("");
    case "dress":
      return "This is a DRESS — a single full-body garment. Remove EVERYTHING the person is currently wearing on both their upper and lower body (any top, shirt, trousers, pants, skirt or shorts) and dress them in ONLY this dress. There must be NO trousers, pants, or separate top visible — the dress is worn on its own over bare legs as a dress is normally worn.";
    case "bottom":
      // CONSISTENCY LOCK: keep the model's EXISTING top exactly as in the base
      // photo, so changing the bottom's size is the ONLY thing that moves between
      // renders. Inventing a new top each time made successive try-ons look
      // unrelated and hid the actual fit change (founder: "sometimes it grabs the
      // shirt, sometimes it does that").
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
    // Accessories are ADDED, not sized — no cm-ease, just correct placement.
    if (f.kind === "accessory") {
      return `• The ${f.name} is an ACCESSORY — ADD it to the look (it does NOT replace any garment), ${accessoryPlacement(f.name)}; preserve its exact shape, colour, material and hardware; do not resize it as a garment.`;
    }
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

function buildPrompt(garmentCount: number, size: string, recommended?: string, kind?: string, easeCm?: number, bindLabel?: string, garmentFits?: GarmentFit[], focusName?: string): string {
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
    // ACCESSORY worn solo — ADD it to the body, keep all clothing, no cm-ease.
    if (kind === "accessory") {
      return [
        "You are a virtual try-on engine for a luxury fashion store.",
        "The FIRST image is a person (a model on a plain studio backdrop).",
        "The SECOND image shows a fashion ACCESSORY.",
        IDENTITY_LOCK,
        GARMENT_FIDELITY,
        accessoryClause(focusName ?? ""),
        "Full-length, head-to-feet fashion lookbook photograph showing the person's whole body from head to feet, soft even studio lighting, sharp focus.",
        "Output ONLY the edited photograph.",
      ].join(" ");
    }
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
    // Consistency across size changes (founder: 'I only change the size and the OTHER garments change'):
    "Each supplied garment keeps its EXACT colour, fabric, print, cut and silhouette from its own reference image — do NOT substitute, recolour, restyle, or swap any garment for a different one. The ONLY thing that varies per piece is how tight or loose it sits, driven by that piece's selected size below. Render every supplied garment; never drop or replace one.",
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
  if (vertexConfigured()) {
    try {
      if (VERTEX_PATH === "vto") {
        // VTO-001 ignores the text prompt; it takes person + garments directly.
        return await callVertexVto(personB64, personMime, garmentB64s, prompt);
      }
      // Vertex-authed Gemini — same body as public, preserves the fit prompt.
      return await callVertexGemini(prompt, personB64, personMime, garmentB64s);
    } catch (err) {
      console.error("[tryon] vertex render failed, falling back to public gemini:", (err as Error).message);
      // fall through to public Gemini
    }
  }
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

// Prompt version. Bump WHENEVER the buildPrompt / easeMagnitudeClause / fit
// language changes, so old renders made under weaker prompts (e.g. the previous
// XS-vs-XL "looks the same" pass) are NEVER served stale. Founder complaint:
// "extra small and large are showing almost similar tightness." That bug was a
// prompt-strength issue and an old-cache issue; bumping this guarantees the
// new dramatic clauses re-render fresh.
const PROMPT_VERSION = "v3";

// P3-T02: render-PIPELINE version, distinct from PROMPT_VERSION. Bumping this
// invalidates EVERY pre-Phase-3 cache key at once (different key → guaranteed
// cache miss → fresh render) — no destructive bulk delete needed. Phase 3 bumps
// to c1 because the key now also encodes colour + variant + pose + model, so the
// old keys (which omitted colour for the focus piece → wrong-colourway hits) must
// never resolve again.
const TRYON_CACHE_VERSION = "c1";

// Short, non-secret hash of a garment image PATH so two different focus images
// for the same handle never collide (and the key stays debuggable, no bytes).
function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 8);
}

// A filesystem-safe token from any free-form value (colour, variant, pose, model).
function slugToken(v: string | undefined, fallback = "_"): string {
  if (!v) return fallback;
  const s = v.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  return s || fallback;
}

// Derive the focus colourway from the focus garment image filename. The demo
// encodes colourway in the filename (`onyx-silk-slip-ivory.png`); the handle is
// the product (`onyx-silk-slip`). The trailing token after the handle is the
// colour. Returns "_" when no colour suffix is present.
function focusColorFromImage(handle: string, focusImage?: string): string {
  if (!focusImage) return "_";
  const base = focusImage.split("/").pop()?.replace(/\.png$/i, "").replace(/-\d+$/, "") ?? "";
  if (base === handle || !base.startsWith(handle + "-")) return "_";
  return slugToken(base.slice(handle.length + 1));
}

const MODEL_SLUG = slugToken(MODEL, "model");

// Sanitise shop identifier into a filesystem-safe slug. Brand domain comes in
// as `stylee.myshopify.com` or similar; collapse to alphanumerics + dashes so
// it composes safely with the rest of the cache key + survives any disk write.
function shopKey(shopSlug?: string): string {
  if (!shopSlug) return "_";
  const s = shopSlug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 40) || "_";
}

// ── Full try-on cache key (P3-T01) ───────────────────────────────────────────
// Every dimension that changes the rendered pixels is in the key, so a different
// shop / muse / product / variant / colour / size / ease / pose / garment image /
// model / pipeline-version NEVER reuses another's render. Debuggable (no secrets).
export function buildTryOnCacheKey(input: {
  shopSlug?: string; museId: string; handle: string; size: string;
  color?: string; variantId?: string; pose?: string;
  focusImage?: string; lookHandles: string[]; easeCm?: number; garmentFits?: GarmentFit[];
}): string {
  const look = input.lookHandles.length ? `_look-${[...input.lookHandles].sort().join("-")}` : "";
  let perPiece = "";
  if (input.garmentFits && input.garmentFits.length > 1) {
    perPiece =
      "_fits-" +
      input.garmentFits.slice(1)
        .map((f) => `${f.size.toLowerCase()}${easeBucket(f.easeCm)}`)
        .sort()
        .join("");
  }
  const s = shopKey(input.shopSlug);
  const color = input.color ? slugToken(input.color) : focusColorFromImage(input.handle, input.focusImage);
  const variant = slugToken(input.variantId);
  const pose = slugToken(input.pose, "front");
  const ghash = shortHash(input.focusImage ?? input.handle);
  // Order: shop → muse → product → variant → colour → size → ease → pose →
  // garment-hash → look/per-piece → model → cache-version → prompt-version.
  return [
    `s-${s}`, `m-${input.museId}`, `p-${input.handle}`, `v-${variant}`, `c-${color}`,
    `z-${input.size.toLowerCase()}`, easeBucket(input.easeCm), `pose-${pose}`, `g-${ghash}`,
  ].join("-") + `${look}${perPiece}-mdl-${MODEL_SLUG}-${TRYON_CACHE_VERSION}-${PROMPT_VERSION}`;
}

function museCacheKey(
  shopSlug: string | undefined,
  museId: string, handle: string, size: string,
  lookHandles: string[], easeCm?: number, garmentFits?: GarmentFit[],
  color?: string, variantId?: string, pose?: string, focusImage?: string,
): string {
  return buildTryOnCacheKey({ shopSlug, museId, handle, size, color, variantId, pose, focusImage, lookHandles, easeCm, garmentFits });
}

export async function renderTryOn(req: TryOnRequest): Promise<TryOnResult> {
  const t0 = Date.now();
  const garmentImages = req.garmentImages.filter(Boolean).slice(0, 4);
  if (garmentImages.length === 0) throw new Error("no_garment");

  // ── Muse render: deterministic for (muse × product(s) × size). Cached in memory
  //    + a writable disk dir + the baked public dir, served via a DYNAMIC route
  //    (/api/tryon/image/<key>) — NOT a static public/ path (those 404 at runtime
  //    on Railway). Second request for the same muse/product/size is an instant
  //    cache hit. ──
  if (!req.museImage || !req.museId || !req.handle) throw new Error("muse_args");
  // Look-piece cache identity = the file basename MINUS the trailing numeric
  // index (-1/-2), but KEEPING any colorway suffix. The old strip also removed
  // `-[a-z]+\.png` which collapsed `onyx-silk-slip-ivory.png` and
  // `onyx-silk-slip-onyx.png` to the same key → the WRONG colorway served from
  // cache. Keeping the colorway makes each colorway its own cache entry.
  const lookHandles = garmentImages
    .slice(1)
    .map((g) => g.split("/").pop()?.replace(/\.png$/i, "").replace(/-\d+$/, "") ?? "");
  const key = museCacheKey(
    req.shopSlug, req.museId, req.handle, req.size, lookHandles, req.easeCm, req.garmentFits,
    req.color, req.variantId, req.pose, garmentImages[0],
  );
  // P3-T01: cache key is debuggable (no secrets — paths/ids only).
  if (process.env.TRYON_DEBUG_KEYS === "1") console.debug("[tryon] cacheKey", key);
  const url = museRenderUrl(key);

  // Cache hit anywhere (memory → writable disk → baked) → instant.
  const cached = await readMuseRenderBytes(key);
  if (cached) return { imageUrl: url, cached: true, ms: Date.now() - t0 };

  // Miss → render the composite.
  const personB64 = await readAssetB64(req.museImage);
  const garmentB64s = await Promise.all(garmentImages.map(readAssetB64));
  const prompt = buildPrompt(garmentB64s.length, req.size, req.recommendedSize, req.garmentKind, req.easeCm, req.bindLabel, req.garmentFits, req.garmentFits?.[0]?.name);
  const out = await renderImage(prompt, personB64, "image/png", garmentB64s);
  const bytes = Buffer.from(out.b64, "base64");

  // Save so it "comes up instantly the second time": memory always; writable
  // disk best-effort (survives across requests within the container lifetime).
  rememberMuseBytes(key, bytes);
  void (async () => {
    try {
      await fs.mkdir(MUSE_CACHE_DIR, { recursive: true });
      await fs.writeFile(path.join(MUSE_CACHE_DIR, `${key}.png`), bytes);
    } catch {
      /* read-only FS — memory cache still serves this instance */
    }
  })();

  return { imageUrl: url, cached: false, ms: Date.now() - t0 };
}
