"use client";

// Mira, AI shopping-intelligence stylist for the Stylique demo site.
//
// This is NOT a chatbot UI. It is a visual-first stylist sidebar: an editorial
// feed of modular cards (recommendation, why-this-works, complete-the-look board,
// style note, fit) rather than a stream of messenger bubbles. The panel never
// goes full-screen, products and the store stay visible behind it.
//
// Behaviour principles encoded:
//   • Visual-first: every recommendation leads with the image, not text.
//   • Curate, don't flood: a single hero by default, never a wall of products.
//   • Why this works: every recommendation carries one line of stylist reasoning.
//   • Try-on is an escalation, not a default, surfaced only on higher intent.
//   • Complete-the-look is the AOV lever: a named edit with a total + add-all.
//   • PDP-contextual: opens by naming the exact piece, its colour, its occasion.
//   • Confident + candid: Mira will flag a caveat instead of always approving.
//   • Subtle memory: she notices the palette/silhouette you keep returning to.
//   • Passive proactivity: a quiet nudge on real PDP dwell, never a random pop.

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import {
  buildLook, analyzeColorHarmony, products as catalog, recommendSizeForProduct, confidenceBreakdown, resolveAsset, ASSET_BASE,
  type Product, type FitPref, type CollectionSlug, type HarmonyType,
} from "../../lib/catalog";
import { addToCart, addOutfitToCart } from "../../lib/storefront-cart";

// ── Surface config, makes this ONE component serve both the demo (same-origin)
// and the storefront widget bundle, using the BUILD-TIME ASSET_BASE (no
// module-load-ordering hazard). On the storefront ASSET_BASE is the backend
// origin → API calls are absolute (not the shop domain) and PDP links are
// /products/ (Shopify plural). On the demo it's "" → relative, /product/.
// ONE-BACKEND: API calls go to __sqApi when set (the storefront sets it to the App
// Proxy → the real Shopify app). Falls back to ASSET_BASE (the demo's own origin)
// so the marketing demo page is unchanged. This is the split that routes the
// storefront onto the single Shopify backend without touching the demo.
// LAZY (the Step-5 fix): read __sqApi at CALL time, not module-load time. ES
// imports are hoisted, so this module evaluates BEFORE the storefront entry sets
// window.__sqApi = "/apps/stylique", a load-time const would always miss it and
// fall back to ASSET_BASE (the demo brain), which is exactly why the storefront
// was blind to the merchant's catalog. Reading it lazily at fetch time means the
// storefront hits the App Proxy (real per-tenant brain + merchant products) while
// the demo (no __sqApi) stays same-origin.
function sqApi(): string {
  if (typeof window === "undefined") return ASSET_BASE;
  const api = (window as unknown as Record<string, unknown>).__sqApi;
  return typeof api === "string" ? api : ASSET_BASE;
}
function money(amount: number): string {
  const currency = typeof window !== "undefined"
    ? (window as unknown as Record<string, unknown>).__sqCurrency
    : "USD";
  const code = typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${code} ${amount.toLocaleString()}`;
  }
}
const PRODUCT_SEG = ASSET_BASE ? "products" : "product"; // Shopify plural vs demo singular
function productUrl(handle: string): string { return `/${PRODUCT_SEG}/${handle}`; }

// ── Price-truth guard ────────────────────────────────────────────────────────
// The LLM `voice` line is free text and sometimes names its OWN total
// ("…for a total of $1950"), while the card/look below it is rebuilt from the
// catalog with the AUTHORITATIVE total ("Add entire look · $3,540"). Two
// different numbers on one turn read as Mira lying. On card-bearing routes we
// strip any spoken price from the voice so the CARD is the single source of
// price truth; budget/talk_only routes keep their prices (Mira must answer
// "how much" plainly). Verified against the real failing voices — see the
// pricing-fix log.
const PRICE_ATOM = "(?:US\\$|USD\\s?|\\$)\\s?\\d[\\d,]*(?:\\.\\d{1,2})?";
function stripSpokenPrice(text: string): string {
  if (!text || !/\$|\bUSD\b/i.test(text)) return text;
  let out = text
    .replace(new RegExp("\\s*[,;:—-]?\\s*(?:and\\s+)?(?:for\\s+|at\\s+|that(?:'s| is)\\s+)?(?:a\\s+)?(?:combined\\s+|grand\\s+)?(?:the\\s+(?:two|three|pieces?|set|look)\\s+)?(?:together\\s+)?(?:those\\s+(?:two|three)\\s+(?:pieces?\\s+)?)?(?:are\\s+|is\\s+|come(?:s)?\\s+to\\s+|total(?:ling|s)?\\s+|total\\s+of\\s+)?(?:just\\s+|only\\s+|around\\s+|about\\s+|roughly\\s+)?\\(?" + PRICE_ATOM + "\\)?", "gi"), "")
    .replace(new RegExp("\\(?" + PRICE_ATOM + "\\)?", "gi"), "");
  out = out.split(/(?<=[.!?])\s+/).filter((s) => !/^\s*(?:and\s+)?(?:the\s+(?:two|three|pieces?|set)\s+)?(?:those\s+(?:two|three)\s+(?:pieces?\s+)?)?(?:together\s*,?\s*)?(?:are|is|come(?:s)?\s+to|total[a-z]*)?\s*[.!?,]*\s*$/i.test(s)).join(" ");
  out = out.replace(/\s+([,.!?;:])/g, "$1").replace(/,\s*([.!?])/g, "$1").replace(/\s{2,}/g, " ").replace(/\(\s*\)/g, "").replace(/[,;:—-]\s*$/, "").replace(/^[\s,;:—-]+/, "").trim();
  // Re-capitalise if the strip left a lowercase lead-in.
  if (out && /^[a-z]/.test(out)) out = out[0].toUpperCase() + out.slice(1);
  return out.length ? out : text;
}
// Routes where a card/cart-line carries the authoritative total → scrub voice.
const CARD_PRICE_ROUTES = new Set([
  "look", "add_to_cart", "reco_handle", "reco_category", "reco_filter", "navigate", "search",
]);
import TryOnPanel from "../surfaces/TryOnPanel";
import {
  emptyMemory, updateFromLookCard, updateFromVoice, updateFromReco,
  markAccepted, resolveBundle, buildLookContextBlock,
  type ActiveLookMemory,
} from "../../lib/active-look-memory";
import {
  getTryOnSummaryForMira,
  updateTryOnStatus as updateTryOnCtxStatus,
} from "../../lib/tryon-context";

// ── Mira avatar ─────────────────────────────────────────────────────────────
// Hyperrealistic stylist persona, a full-figure editorial portrait shot on the
// Stylique maison gradient backdrop (display-only; no facial data is gathered or
// analysed). MiraFace = the compact circular crop (panel header). MiraLauncher =
// the full standing-avatar card that greets the shopper like a stylist on the
// floor, instead of a bare chat bubble.

const MIRA_PORTRAIT = resolveAsset("/mira/avatar.png"); // absolute on the storefront, relative on the demo

// Circular crop, frames her face/shoulders out of the full-body portrait.
function MiraFace({ size = 48, ring = false }: { size?: number; ring?: boolean }) {
  const dot = Math.max(8, Math.round(size * 0.2));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {ring && (
        <span style={{
          position: "absolute", inset: -3, borderRadius: "50%",
          background: "conic-gradient(from 0deg, #8B5CF6, #EC4899, #8B5CF6)",
          animation: "miraRingSpin 3s linear infinite",
          zIndex: 0,
        }} />
      )}
      <div style={{
        position: "relative", zIndex: 1, width: size, height: size,
        borderRadius: "50%", overflow: "hidden",
        border: "1.5px solid rgba(255,255,255,0.18)",
        boxShadow: ring ? "0 0 18px rgba(139,92,246,0.5)" : "0 2px 10px rgba(0,0,0,0.4)",
      }}>
        <Image
          src={MIRA_PORTRAIT} alt="Mira" width={size * 3} height={size * 3}
          style={{ width: "180%", height: "180%", maxWidth: "none", marginLeft: "-40%", marginTop: "2%", objectFit: "cover", objectPosition: "center top" }}
        />
      </div>
      <span style={{
        position: "absolute", bottom: 0, right: 0, width: dot, height: dot, borderRadius: "50%",
        background: "#4EC49E", border: "2px solid #12101A", zIndex: 2,
      }} />
    </div>
  );
}

// Boxless, HUMAN launcher, Mira's face floating like a real person leaning in, not
// a chat-app square. A circular portrait with a soft glow halo, a slow gradient ring,
// and a live presence dot. No card, no rectangle: it reads as a person, which is what
// differentiates it from every WhatsApp/Intercom bubble. Tap to open.
function MiraLauncher({ nudging, onOpen }: { nudging: boolean; onOpen: () => void }) {
  const D = 78; // face diameter
  return (
    <button
      onClick={onOpen}
      aria-label="Chat with Mira, your stylist"
      data-stylique-open="1"
      className="sq-mira-launch"
      style={{
        position: "relative", width: D, height: D, padding: 0, border: "none",
        background: "none", cursor: "pointer", borderRadius: "50%",
        animation: nudging ? "miraFloat 2.4s ease-in-out infinite" : "miraFadeUp 420ms var(--ease-spring) both",
      }}
    >
      {/* soft radial glow halo, alive, draws the eye, no hard edge */}
      <span style={{ position: "absolute", inset: -16, borderRadius: "50%", background: "var(--glow)", animation: "miraPulse 2.8s ease-in-out infinite", pointerEvents: "none", zIndex: 0 }} />
      {/* slow gradient ring around the face */}
      <span style={{ position: "absolute", inset: -3, borderRadius: "50%", background: "conic-gradient(from 0deg, #8B5CF6, #E879C8, #8B5CF6)", animation: "miraRingSpin 4.5s linear infinite", pointerEvents: "none", zIndex: 1 }} />
      {/* circular face crop, the human, boxless */}
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", border: "2px solid #0E0A14", boxShadow: "0 14px 36px rgba(0,0,0,0.55)", zIndex: 2 }}>
        <Image
          src={MIRA_PORTRAIT} alt="Mira, your stylist" width={D * 3} height={D * 3}
          style={{ width: "180%", height: "180%", maxWidth: "none", marginLeft: "-40%", marginTop: "2%", objectFit: "cover", objectPosition: "center top" }}
        />
      </span>
      {/* live presence dot */}
      <span style={{ position: "absolute", bottom: 3, right: 3, width: 15, height: 15, borderRadius: "50%", background: "#4EC49E", border: "2.5px solid #0E0A14", boxShadow: "0 0 10px #4EC49E", zIndex: 3 }} />
    </button>
  );
}

// ── Card model ──────────────────────────────────────────────────────────────
// The feed is built from modular cards, not chat bubbles. Each card is its own
// shopping object, a recommendation, a look board, a style note, a fit result.

// A scorecard is the stylist's confidence made visible, every number is REAL
// (keepRate from the catalog, match from the color/category harmony engine). No
// invented figures: a field is omitted rather than guessed.
type RecoScore = { matchPct?: number; keepPct?: number; harmonyLabel?: string };
type LookScore = { harmonyPct: number; harmonyLabel: string; pieces: number };
type Reco = { product: Product; why: string; escalateTryOn?: boolean; score?: RecoScore };
type LookBoard = { title: string; anchor: Product; pieces: Product[]; why: string; total: number; score?: LookScore };

type ChatMsg =
  | { from: "mira"; kind: "say"; text: string; quickReplies?: string[] }
  | { from: "user"; kind: "say"; text: string }
  | { from: "mira"; kind: "reco"; reco: Reco; lead?: string }
  | { from: "mira"; kind: "look"; look: LookBoard }
  | { from: "mira"; kind: "insight"; label: string; text: string; quickReplies?: string[] }
  | { from: "mira"; kind: "cart"; productName: string }
  // Visual context divider when the shopper moves to a new product — keeps the
  // thread oriented without a wall of text (founder: "differentiate new product
  // in chat with cards / highlight different context").
  | { from: "mira"; kind: "context"; product: Product; prevName?: string };

type KnowledgeEntry = { id: string; text: string; createdAt: string };

type MiraContext = {
  shownHandles: Set<string>;
  lastTopic: string;
  turnCount: number;
  sizeAsked: boolean;
  cartValue: number;
  // The pieces from the most recent look board, used by bundle add-to-cart.
  lastLookPieces?: Product[];
};

// ── Sentinels ─────────────────────────────────────────────────────────────────
const SIZE_FORM_TRIGGER  = "__size_form__";
const NAV_TRIGGER        = "__navigate__:"; // followed by a product handle
const TRYON_TRIGGER      = "__try_on__:";   // followed by a product handle, opens the fitting room

// Payments-panel finding: free-shipping nudge was firing on every store
// regardless of currency, telling a PKR shopper they're "Rs 250 from free
// shipping" when the threshold was actually 500 USD. Gate the nudge to
// USD-only stores for now; international free-shipping thresholds require
// per-shop config.
const FREE_SHIPPING_THRESHOLD = 500;
const FREE_SHIPPING_CURRENCY = "USD";

// ── Per-product size memory ─────────────────────────────────────────────────
// Every piece here is cut differently, so a size is remembered PER PRODUCT,
// the made-to-order fitting model. We also remember the shopper's body once, so
// the size form prefills on the next piece and they never re-enter measurements.
//
// PRIVACY (Step 2H Phase 1 / P1-T01): body + size are SESSION-SCOPED only.
// They live in sessionStorage so they evaporate when the tab/session ends and a
// new shopper on the same device NEVER inherits a prior shopper's body/size.
// Persisting beyond the session requires explicit consent (the OTP soft-account
// claim, server-side on ShopperSession) — we never write body/size to
// device-wide localStorage. purgeLegacyBodyStorage() wipes any pre-Phase-1
// localStorage residue the first time the widget reads.
const SIZE_MEM_KEY = "mira_size_memory_v1"; // { [handle]: size }
const BODY_MEM_KEY = "mira_body_v1";        // { heightCm, weightKg, fitPref }

type BodyMemory = {
  heightCm: number; weightKg: number; fitPref: "slim" | "true" | "relaxed";
  /** Age in years — improves waist estimate for 30+ (BoldMatrix age correction) */
  age?: number;
  /** The size the shopper usually wears in a similar brand — strongest pre-measurement predictor */
  usualBrandSize?: string;
};

// One-time cleanup: earlier builds stored body/size in device-wide localStorage.
// Remove that residue so it can never be inherited cross-session.
function purgeLegacyBodyStorage(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(SIZE_MEM_KEY); localStorage.removeItem(BODY_MEM_KEY); } catch { /* ignore */ }
}

function loadSizeMemory(): Record<string, string> {
  if (typeof window === "undefined") return {};
  purgeLegacyBodyStorage();
  try { return JSON.parse(sessionStorage.getItem(SIZE_MEM_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}
function rememberSize(handle: string, size: string): void {
  if (typeof window === "undefined") return;
  try {
    const m = loadSizeMemory();
    m[handle] = size;
    sessionStorage.setItem(SIZE_MEM_KEY, JSON.stringify(m));
  } catch { /* read-only storage, fine, just won't persist */ }
}
function recalledSize(handle?: string | null): string | null {
  if (!handle) return null;
  return loadSizeMemory()[handle] ?? null;
}
function loadBody(): BodyMemory | null {
  if (typeof window === "undefined") return null;
  purgeLegacyBodyStorage();
  try {
    const b = JSON.parse(sessionStorage.getItem(BODY_MEM_KEY) ?? "null") as BodyMemory | null;
    return b && b.heightCm ? b : null;
  } catch { return null; }
}
function rememberBody(b: BodyMemory): void {
  if (typeof window === "undefined") return;
  try {
    // Merge with what's already stored so age/usualBrandSize from TryOnPanel survive
    const existing = loadBody();
    const merged: BodyMemory = {
      ...existing,
      ...b,
      // Preserve optional signals if the new write doesn't supply them
      age: b.age ?? existing?.age,
      usualBrandSize: b.usualBrandSize ?? existing?.usualBrandSize,
    };
    sessionStorage.setItem(BODY_MEM_KEY, JSON.stringify(merged));
  } catch { /* ignore */ }
}

// Parse measurements a shopper TYPES inline ("I'm 5'6, 145lb", "170cm 64kg") so
// Mira never makes them fill a form for data they just gave (council fix #2).
// Saves to body memory the moment they say it, so it flows everywhere after.
function captureBodyFromText(text: string): void {
  const t = text.toLowerCase();
  let heightCm: number | null = null;
  let weightKg: number | null = null;
  // height: 5'6 / 5'6" / 5 ft 6 / 170cm / 1.70m
  const ftIn = t.match(/(\d)\s*['’]\s*(\d{1,2})|(\d)\s*ft\s*(\d{1,2})/);
  const cm = t.match(/(\d{3})\s*cm\b/);
  const m = t.match(/\b(1\.[5-9]\d?)\s*m\b/);
  if (cm) heightCm = parseInt(cm[1]!, 10);
  else if (m) heightCm = Math.round(parseFloat(m[1]!) * 100);
  else if (ftIn) {
    const ft = parseInt(ftIn[1] ?? ftIn[3] ?? "0", 10);
    const inch = parseInt(ftIn[2] ?? ftIn[4] ?? "0", 10);
    if (ft >= 4 && ft <= 7) heightCm = Math.round((ft * 12 + inch) * 2.54);
  }
  // weight: 64kg / 145lb / 145 lbs / 145 pounds
  const kg = t.match(/(\d{2,3})\s*kg\b/);
  const lb = t.match(/(\d{2,3})\s*(lb|lbs|pounds)\b/);
  if (kg) weightKg = parseInt(kg[1]!, 10);
  else if (lb) weightKg = Math.round(parseInt(lb[1]!, 10) * 0.4536);
  if (heightCm && weightKg && heightCm >= 140 && heightCm <= 210 && weightKg >= 35 && weightKg <= 180) {
    const existing = loadBody();
    const fitPref: BodyMemory["fitPref"] = /\b(snug|fitted|tight|slim)\b/.test(t) ? "slim"
      : /\b(loose|relaxed|oversized|roomy)\b/.test(t) ? "relaxed"
      : existing?.fitPref ?? "true";
    rememberBody({ heightCm, weightKg, fitPref });
  }
}

// ── Conversation continuity across page navigation ──────────────────────────
// On a Shopify storefront every product page is a FULL page load, so the widget
// remounts and React state (the transcript, what's been shown, the topic) would
// reset, Mira "forgets everything when you go to another product". We persist
// the live conversation to sessionStorage (survives same-tab navigation, clears
// when the tab closes) so Mira remembers the whole visit until they leave the
// store. Founder: "it should remember until they're at the store."
const CONVO_KEY = "mira_convo_v1";

type ConvoSnapshot = {
  messages: ChatMsg[];
  shownHandles: string[];
  lastTopic: string;
  sizeAsked: boolean;
  turnCount: number;
  lastLookHandles: string[];
  cartCount: number;
  cartValue: number;
  open: boolean;
  // The product Mira last "approached" — lets her notice a product switch across
  // a full page reload (every PDP click on the demo + Shopify storefront).
  lastProductHandle?: string;
};

function loadConvo(): ConvoSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CONVO_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ConvoSnapshot;
    return Array.isArray(s.messages) ? s : null;
  } catch { return null; }
}
function saveConvo(s: ConvoSnapshot): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(CONVO_KEY, JSON.stringify(s)); } catch { /* quota/read-only, fine */ }
}

// ── Per-product rationale ─────────────────────────────────────────────────────
// One-sentence "why this works", the stylist's reasoning, surfaced on every card.
const RATIONALE: Record<string, string> = {
  "onyx-silk-slip":           "Bias cut skims without clinging, the weight of the silk does the work.",
  "midnight-silk-gown":       "Cowl neck in 21-momme satin, heavier than most, so it drapes rather than sticks.",
  "ivory-silk-camisole":      "Featherweight charmeuse that layers under everything or works alone with wide-leg trousers.",
  "linen-relaxed-shirt":      "Belgian linen with a drop shoulder, the silhouette that reads effortless regardless of what's under it.",
  "atelier-wide-leg-trouser": "High-rise fluid wool, structured enough for a boardroom, comfortable enough for a long day.",
  "wide-leg-denim":           "Selvedge from Okayama, fades uniquely to how you wear it, gets better with every year.",
  "pleated-midi-skirt":       "Knife pleats in duchess satin, catches light when you move, not just when you stand still.",
  "leather-trench":           "Italian nappa that moulds to you with wear, the investment that gets better, not worn.",
  "wrap-coat-camel":          "Double-faced cashmere-wool, the weight and warmth that no synthetic at any price replicates.",
  "cashmere-v-neck":          "12-gauge Mongolian cashmere, the gauge is what makes it substantial enough to wear alone.",
  "merino-ribbed-turtleneck": "18.5-micron merino, the threshold where it stops being scratchy and starts feeling like a second skin.",
  "tailored-blazer-double":   "Italian virgin wool with peak lapels, makes everything underneath look deliberate.",
};

function whyFor(p: Product): string {
  return RATIONALE[p.handle] ?? p.hesitationHint ?? p.fitNotes ?? "";
}

// ── PDP context derivation ────────────────────────────────────────────────────
// Turns the raw product into the language a stylist would use on the floor:
// "You're looking at the Linen Shirt, an ivory top built for easy daytime
//  layering. It pairs beautifully with the Atelier Wide-Leg Trouser."
const CATEGORY_NOUN: Record<Product["category"], string> = {
  outerwear: "coat", dress: "dress", top: "top", bottom: "trouser", knitwear: "knit", accessory: "piece",
};
const OCCASION_PHRASE: Record<CollectionSlug, string> = {
  "evening": "made for evenings and occasions",
  "tailoring": "cut for work and the tailored days",
  "the-atelier": "built for easy, everyday wear",
  "knitwear": "for layering through the cold months",
  "outerwear": "to carry a whole outfit",
  "south-asian": "celebrating South Asian style",
  "bridal": "made for your biggest moments",
  "accessories": "to finish and elevate any look",
  "streetwear": "for the streets and everyday cool",
  "active": "for movement and athleisure",
  "modest": "for modest, covered dressing",
};

function contextualOpener(p: Product): string {
  const color = p.colors[0]?.toLowerCase() ?? "";
  const noun = CATEGORY_NOUN[p.category];
  const occ = OCCASION_PHRASE[p.collection];
  const Color = color ? color.charAt(0).toUpperCase() + color.slice(1) : "";
  // Lead-first + rotated (panel rank 13): Mira asserts a POV on the piece instead
  // of repeating one flat descriptive template, these are the first words she
  // speaks, so they must feel decisive and never identical visit-to-visit.
  const variants = [
    `The ${p.name}, a ${color} ${noun} ${occ}. Strong choice.`,
    `${Color ? `${Color} ` : ""}${noun}, ${occ}, the ${p.name} earns its place.`,
    `That ${color} ${noun} is a quiet winner: the ${p.name}, ${occ}.`,
    `The ${p.name} is the kind of ${noun} that works for more than one moment.`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

// ── Editorial edit names for look boards ──────────────────────────────────────
function editName(anchor: Product): string {
  const fams = anchor.colors.map(colorFamily);
  if (fams.every((f) => f === "dark")) return "The Monochrome Edit";
  if (fams.includes("neutral")) return "Quiet Neutrals";
  if (anchor.collection === "evening") return "The Evening Edit";
  if (anchor.collection === "knitwear" || anchor.collection === "outerwear") return "The Cold-Weather Edit";
  if (anchor.collection === "tailoring") return "The Tailored Edit";
  return "The Edit";
}

type ColorFamily = "dark" | "neutral" | "warm" | "cool";
function colorFamily(name: string): ColorFamily {
  const n = name.toLowerCase();
  if (/black|onyx|ink|midnight|charcoal|espresso/.test(n)) return "dark";
  if (/ivory|bone|oat|champagne|stone|white|cream/.test(n)) return "neutral";
  if (/camel|cognac|cardinal|tan/.test(n)) return "warm";
  if (/indigo|navy|blue/.test(n)) return "cool";
  return "neutral";
}
const FAMILY_LABEL: Record<ColorFamily, string> = {
  dark: "deep, structured pieces", neutral: "soft neutrals",
  warm: "warm earth tones", cool: "cool, quiet blues",
};

// ── Brand-exact size recommendation ──────────────────────────────────────────
function recommendSize(
  p: Product, heightCm: number, weightKg: number, fitPref: FitPref = "true",
  age?: number, usualBrandSize?: string,
): { size: string; reasoning: string; keepRate: number; confidence: number; alt?: { size: string; note: string } } {
  const rec = recommendSizeForProduct(p, { heightCm, weightKg, fitPref, age, usualBrandSize });
  return { size: rec.size, reasoning: rec.reasoning, keepRate: p.keepRate ?? 0.82, confidence: rec.confidence, alt: rec.alt };
}

// ── Keyword product search ────────────────────────────────────────────────────
function findProducts(query: string): Product[] {
  const cleaned = query.toLowerCase()
    .replace(/^(show me|show me the|i want|i want the|i'd like|give me|get me|find me|do you have|what about|how about|the)\s+/g, "")
    .trim();
  const exact = catalog.filter((p) => p.name.toLowerCase().includes(cleaned) || cleaned.includes(p.name.toLowerCase()));
  if (exact.length) return exact.slice(0, 3);
  const q = cleaned;
  const byCat = catalog.filter((p) => {
    if (/dress|gown|slip/.test(q)) return p.category === "dress";
    if (/coat|trench|outerwear|jacket/.test(q)) return p.category === "outerwear";
    if (/knit|cashmere|sweater|merino|turtleneck/.test(q)) return p.category === "knitwear";
    if (/trouser|denim|jean|bottom|pant|skirt/.test(q)) return p.category === "bottom";
    if (/top|blouse|shirt|camisole|cami/.test(q)) return p.category === "top";
    return false;
  });
  if (byCat.length) return byCat.slice(0, 3);
  const keywords = cleaned.split(/\s+/).filter((w) => w.length > 3);
  return catalog.filter((p) => keywords.some((kw) => p.name.toLowerCase().includes(kw) || p.description.toLowerCase().includes(kw))).slice(0, 3);
}

// ── Context-aware helpers ─────────────────────────────────────────────────────
function fresh(products: Product[], ctx: MiraContext): Product[] {
  const unseen = products.filter((p) => !ctx.shownHandles.has(p.handle));
  return unseen.length ? unseen : products;
}
function hero(products: Product[], ctx: MiraContext): Product {
  return fresh(products, ctx)[0] ?? products[0];
}

// ── Scorecard builders ────────────────────────────────────────────────────────
// HARMONY_LABEL surfaces the harmony type as a short, human badge.
const HARMONY_BADGE: Record<HarmonyType, string> = {
  monochromatic: "Tonal match",
  analogous:     "Same palette",
  complementary: "Plays off it",
  triadic:       "Considered contrast",
  neutral:       "Clean neutral",
  accent:        "Pop of colour",
  contrast:      "Bold contrast",
};

// Build the REAL scorecard for a single recommendation. keepPct is always the
// product's true keepRate; matchPct + harmonyLabel only when the pick is made
// relative to a piece the shopper is already on (so the % means something).
function recoScore(p: Product, relativeTo?: Product | null): RecoScore {
  const keepPct = p.keepRate != null ? Math.round(p.keepRate * 100) : undefined;
  if (relativeTo && relativeTo.handle !== p.handle) {
    const h = analyzeColorHarmony(relativeTo.colors, p.colors);
    // Colour harmony returns 0 when either piece has no colour data — which is the
    // norm on a real storefront (single-colour products carry no "Color" option),
    // and shipping a misleading "0% match" is exactly the null-result the store
    // must never show. Fall back to the FULL look-engine score (category affinity +
    // proportion + formality + season — none of which need colour). Only surface a
    // match% when it's a genuine, > 0 signal; otherwise omit it entirely.
    let pct = Math.round(h.score * 100);
    if (pct <= 0) {
      const ranked = buildLook(relativeTo, [p], 1);
      pct = ranked.length ? Math.round(ranked[0].score * 100) : 0;
    }
    return pct > 0 ? { matchPct: pct, keepPct, harmonyLabel: HARMONY_BADGE[h.type] } : { keepPct };
  }
  return { keepPct };
}

// ── Card builders ─────────────────────────────────────────────────────────────
// A single hero recommendation, visual-first, with one line of reasoning.
function recoMsg(p: Product, opts?: { lead?: string; escalate?: boolean; relativeTo?: Product | null }): ChatMsg {
  return { from: "mira", kind: "reco", lead: opts?.lead, reco: { product: p, why: whyFor(p), escalateTryOn: opts?.escalate, score: recoScore(p, opts?.relativeTo) } };
}
// A complete-the-look board, the AOV lever. Anchor + harmonised pieces + total.
// The harmony % + label come straight from the shared styling engine (buildLook).
// Color-theory "why this is the best combination" — names the harmony TYPE in
// plain language tied to the real colours, so the look reads as a stylist's logic,
// not a guess (founder: "understand color theory, occasion, pairings, and TELL
// the likelihood it's best").
function harmonyReason(anchorColor: string, type: HarmonyType): string {
  const c = anchorColor.toLowerCase();
  switch (type) {
    case "monochromatic": return `it's a tonal ${c} story, one refined register top to bottom, which is exactly what reads expensive`;
    case "analogous":     return `the colours sit right next to ${c} on the wheel, so it's harmonious without ever looking matchy`;
    case "complementary": return `${c} played against its opposite, the contrast is what makes people look twice`;
    case "accent":        return `a quiet base with one deliberate pop of colour, the eye lands exactly where you want it`;
    case "neutral":       return `a clean neutral base that lets the ${c} carry the whole look`;
    default:              return `a considered palette built around the ${c}`;
  }
}

function lookMsg(anchor: Product, ctx: MiraContext, why?: string): ChatMsg {
  const ranked = buildLook(anchor, activeProducts());
  const fresh = ranked.filter((e) => !ctx.shownHandles.has(e.product.handle));
  const pool = fresh.length >= 2 ? fresh : ranked;
  // RIGHT NUMBER OF PIECES (founder: "the right number of combinations"): take the
  // strong pairings, not a forced three. Always the top; add the 2nd/3rd only while
  // they genuinely raise the look (score ≥ 0.68) and fill a different slot.
  const slots = new Set<string>();
  const chosen: typeof ranked = [];
  for (const e of pool) {
    if (chosen.length >= 3) break;
    if (e.score < 0.68 && chosen.length >= 1) break;
    if (slots.has(e.product.category) && chosen.length >= 1) continue; // one per slot
    chosen.push(e); slots.add(e.product.category);
  }
  if (chosen.length === 0 && pool[0]) chosen.push(pool[0]);
  const pieces = chosen.map((e) => e.product);
  const total = anchor.priceUsd + pieces.reduce((s, p) => s + p.priceUsd, 0);
  const harmonyPct = chosen.length ? Math.round((chosen.reduce((s, e) => s + e.score, 0) / chosen.length) * 100) : 0;
  const topType = chosen[0]?.harmonyType ?? "neutral";
  const harmonyLabel = chosen[0] ? HARMONY_BADGE[topType] : "Curated";
  // STATE THE LIKELIHOOD + the color-theory reason (why it's the best).
  const anchorColor = anchor.colors[0] ?? "neutral";
  // Short, ≤2-line reason (founder: cut the wall of text). The % match already
  // shows as a Stat chip, so don't repeat it; the card carries the visual story.
  const r0 = harmonyReason(anchorColor, topType);
  const reasoning = why ?? `${r0.charAt(0).toUpperCase()}${r0.slice(1)} — the pieces balance the silhouette.`;
  return { from: "mira", kind: "look", look: { title: editName(anchor), anchor, pieces, why: reasoning, total, score: { harmonyPct, harmonyLabel, pieces: pieces.length } } };
}

// ── Main response engine ──────────────────────────────────────────────────────
function getMiraResponse(userText: string, currentProduct: Product | null, ctx: MiraContext): ChatMsg[] {
  const t = userText.toLowerCase().trim();
  // ONE-BRAIN: on a real storefront the regex fallback MUST operate on the
  // merchant's real (hydrated) catalog, never the bundled demo products — else it
  // leaks phantom demo pieces (e.g. "Onyx Silk Slip") onto a live store. On the
  // demo page (ASSET_BASE === "") activeProducts() returns the demo catalog, so
  // behaviour there is unchanged. If a real store hasn't hydrated yet, answer with
  // a generic non-product line rather than inventing demo inventory. Shadows the
  // imported `catalog` for the whole function.
  const catalog = activeProducts();
  if (ASSET_BASE && !catalog.length) {
    return [{ from: "mira", kind: "say", text: "Tell me what you're after — a vibe, an occasion, a colour — and I'll pull the right piece.", quickReplies: ["A vibe in mind", "For an occasion", "Just browsing"] }];
  }

  // When Mira commits to a single confident pick on a different page, she takes the
  // shopper there, never just "here it is". Mirrors applyDecision's navigate contract.
  const navIfAway = (p: Product): ChatMsg | null =>
    currentProduct?.handle !== p.handle ? { from: "mira", kind: "say", text: `${NAV_TRIGGER}${p.handle}` } : null;
  const withNav = (msgs: ChatMsg[], p: Product): ChatMsg[] => {
    const nav = navIfAway(p);
    if (!nav) return msgs;
    // slot the navigation right after the first reco card so the page turns as she names it
    const i = msgs.findIndex((m) => m.kind === "reco");
    if (i === -1) return [...msgs, nav];
    return [...msgs.slice(0, i + 1), nav, ...msgs.slice(i + 1)];
  };


  // Explicit "just browsing", go quiet
  if (/just browsing|only browsing|just looking|only looking|no thanks|not now|leave me|not interested|i'll keep looking/.test(t)) {
    return [{ from: "mira", kind: "say", text: "No pressure at all. I'll be right here, say the word when something catches your eye." }];
  }

  // Discovery: generic occasion, not yet named → ASK, don't dump
  if (/(for an occasion|something for an occasion|special occasion|an event|dress up|dressing up)/.test(t)
      && !/wedding|party|dinner|\bdate\b|gala|cocktail|interview|work|funeral|graduation|birthday/.test(t)) {
    return [{
      from: "mira", kind: "say",
      text: "Love that, the occasion sets everything. What is it? I'll pull the one piece, not a wall of options.",
      quickReplies: ["A wedding", "Dinner / date", "Work event", "Night out"],
    }];
  }

  // Discovery: "is it right for me / would it suit me" → candid suitability → fit
  if (/(right for me|suit me|does it suit|would it suit|look good on me|work for my|for my body|my shape|my frame|flatter)/.test(t)) {
    const anchor = currentProduct;
    if (anchor) {
      const out: ChatMsg[] = [];
      out.push({ from: "mira", kind: "insight", label: "My honest read", text: candidTake(anchor) });
      out.push({
        from: "mira", kind: "say",
        text: "What makes or breaks it is the size. Give me your height and weight and I'll tell you the exact one for your frame, no guessing.",
        quickReplies: ["Size me", "What's it made of?", "Show the full look"],
      });
      return out;
    }
    return [{ from: "mira", kind: "say", text: "Tell me which piece you're eyeing and I'll be straight about whether it'll work for you." }];
  }

  // Discovery: "just exploring" → one guiding question
  if (/just exploring|still exploring|feeling it out|having a look|seeing what|not sure yet/.test(t)) {
    const anchor = currentProduct;
    return [{
      from: "mira", kind: "say",
      text: anchor
        ? `No rush. The ${anchor.name} is a good place to start, tell me one piece you've felt great in before and I'll work from your taste.`
        : "No rush. Tell me one piece you've felt great in before, and I'll work backwards from your taste.",
      quickReplies: ["A good coat", "A silk dress", "Show me something", "I'll keep looking"],
    }];
  }

  // Size form trigger
  if (/^size me$/.test(t) || /^(size me for|size me up)/.test(t)) {
    return [{ from: "mira", kind: "say", text: SIZE_FORM_TRIGGER }];
  }

  // Sizing / fit
  if (/\bsize\b|sizing|\bfit\b|fits me|measure|what size|plus size|petite|tall|how does it fit|runs small|runs large|what.*size.*am i|height|weight|measurements/.test(t)) {
    const anchor = currentProduct;
    if (anchor) {
      return [
        { from: "mira", kind: "insight", label: "Fit", text: anchor.fitNotes },
        {
          from: "mira", kind: "say",
          text: "Give me your height and weight, I'll give you a single size, not a range.",
          quickReplies: ["Size me", "It usually runs true?", "I'm usually a medium"],
        },
      ];
    }
    return [{ from: "mira", kind: "say", text: "Tell me what you're sizing for and I'll do the math, or I can show you something first." }];
  }

  // Fabric / material / care
  if (/what.*made of|fabric|material|composition|wash|care|machine.*wash|dry clean|hand.*wash|itchy|scratch|breathe|heavy|light weight|feels like|quality/.test(t)) {
    const anchor = currentProduct;
    if (anchor?.fabricComposition) {
      const fab = anchor.fabricComposition;
      const frame = fab.includes("silk") ? "Silk this weight drapes rather than clings, the weight is the feature, not a flaw."
        : fab.includes("cashmere") ? "This gauge is substantial enough to wear alone, fine enough to layer, it won't pill the way cheaper knits do."
        : fab.includes("linen") ? "Linen wrinkles, that's intentional. It's the texture that reads expensive rather than stiff."
        : fab.includes("wool") ? "The wool weight holds its shape through a full day without looking tired."
        : (fab.includes("nappa") || fab.includes("leather")) ? "Italian nappa softens with wear, a little stiff the first few times, then exactly what you want."
        : "The construction is what justifies the price, this isn't fast-fashion quality.";
      const care = anchor.careInstructions ? ` ${anchor.careInstructions}.` : "";
      return [
        { from: "mira", kind: "insight", label: "Fabric & care", text: `${fab}. ${frame}${care}`, quickReplies: ["Will it fit me?", "Style a full look", "Add to bag"] },
      ];
    }
    return [{ from: "mira", kind: "say", text: "Tap a piece and I'll give you the full fabric and care story, or tell me which one you mean." }];
  }

  // Returns / policy
  if (/return|exchange|refund|policy|send back|wrong size/.test(t)) {
    return [
      { from: "mira", kind: "insight", label: "Returns", text: "14-day window, unworn, original packaging, handled directly through the Stylique Maison team." },
      { from: "mira", kind: "say", text: "If size was the worry, let me fix that before you order. What's your usual size in something like this?", quickReplies: ["Size me", "It's about fit", "Got it, thanks"] },
    ];
  }

  // Greetings
  if (/^(hi|hey|hello|hiya|yo|sup|heya|helo)[\s!.?]*$/.test(t)) {
    const anchor = currentProduct;
    return anchor
      ? [
          { from: "mira", kind: "say", text: `Hey, good eye. ${contextualOpener(anchor)}` },
          { from: "mira", kind: "say", text: "What's drawing you to it, something specific, or still feeling it out?", quickReplies: ["It's for an occasion", "Is it right for me?", "Build the look"] },
        ]
      : [{ from: "mira", kind: "say", text: "Hey. What are you shopping for today?", quickReplies: ["Something for an occasion", "Everyday pieces", "Just browsing"] }];
  }

  // Wedding
  if (/wedding|bridal|ceremony|reception/.test(t)) {
    const evening = catalog.filter((p) => p.collection === "evening");
    const pick = hero(evening, ctx);
    return withNav([
      { from: "mira", kind: "say", text: "A wedding. I have one answer." },
      recoMsg(pick, { lead: `${pick.name}, ${money(pick.priceUsd)}.${pick.lowStock ? " Only a few left in most sizes." : ""}`, relativeTo: currentProduct }),
      { from: "mira", kind: "say", text: "Want me to build the full look around it, or size you first?", quickReplies: ["Build the full look", "Size me", "Show more options"] },
    ], pick);
  }

  // Evening / formal / occasion
  if (/evening|night out|formal|gown|dinner|black.?tie|red carpet|cocktail|occasion|date night|\bdate\b|anniversary|gala|party|celebrate|celebration/.test(t)) {
    const evening = catalog.filter((p) => p.collection === "evening");
    const pick = hero(evening, ctx);
    return withNav([
      recoMsg(pick, { lead: "For the evening, this is where I'd start.", relativeTo: currentProduct }),
      { from: "mira", kind: "say", text: "Build the look around it, or see another direction?", quickReplies: ["Build the full look", "See more options", "Size me"] },
    ], pick);
  }

  // Complete the look / outfit
  if (/build.*look|show.*look|complete.*look|outfit|what.*go.*with|what.*wear.*with|pair|style.*me|put.*together|full look|whole look|entire look/.test(t)) {
    const anchor = currentProduct ?? hero(catalog, ctx);
    return [lookMsg(anchor, ctx)];
  }

  // See it on / try it on, fitting room is the closing zone.
  if (/see it on|on me|on you|try (it |this )?on|try.?on|fitting room|how does it look on|put it on/.test(t)) {
    const anchor = currentProduct ?? hero(catalog, ctx);
    return [
      { from: "mira", kind: "say", text: "Let's put it in the fitting room." },
      { from: "mira", kind: "say", text: `${TRYON_TRIGGER}${anchor.handle}` },
    ];
  }

  // Add to bag (in-chat)
  if (/add to bag|add to cart|buy this|buy it|i'll take it|i want this|order this|checkout|purchase|let's do it|let's go|bag it|ship it|i'm sold|\bsold\b|\bdone\b|i'll buy it|i'll get it/.test(t)) {
    const anchor = currentProduct;
    if (anchor) {
      return [
        { from: "mira", kind: "cart", productName: anchor.name },
        { from: "mira", kind: "say", text: `The ${anchor.name} is in your bag. Want me to complete the look before you check out?`, quickReplies: ["Complete the look", "See checkout", "Keep shopping"] },
      ];
    }
    return [{ from: "mira", kind: "say", text: "Which piece? Tap it first and I'll add it for you." }];
  }

  // Category browse, curate to ONE hero + offer, never a wall
  const catMap: { re: RegExp; cat: Product["category"]; line: string }[] = [
    { re: /\bcoat\b|\bcoats\b|outerwear|jacket|trench|wrap|overcoat|topcoat/, cat: "outerwear", line: "Of the coats, this is the one I'm putting you in." },
    { re: /knit|knitwear|cashmere|merino|sweater|jumper|turtleneck|pullover|cardigan|wool/, cat: "knitwear", line: "The knit I reach for first." },
    { re: /denim|jean|jeans|trouser|trousers|pant|pants|bottom|skirt/, cat: "bottom", line: "Start here for bottoms." },
    { re: /\btop\b|tops|blouse|shirt|cami|camisole|tee|t-shirt/, cat: "top", line: "The top I build around." },
  ];
  for (const { re, cat, line } of catMap) {
    if (re.test(t)) {
      const pick = hero(catalog.filter((p) => p.category === cat), ctx);
      return withNav([
        recoMsg(pick, { lead: line, relativeTo: currentProduct }),
        { from: "mira", kind: "say", text: "Want the full look around it, or another option?", quickReplies: ["Build the look", "Another option", "Size me"] },
      ], pick);
    }
  }

  // Everyday / work
  if (/every.?day|casual|daily|work|office|errands|weekend|daytime|simple|easy|low.?key/.test(t)) {
    const pick = hero(catalog.filter((p) => ["the-atelier", "knitwear"].includes(p.collection)), ctx);
    return withNav([recoMsg(pick, { lead: "The piece I reach for every morning, atelier quality that actually lives in a wardrobe.", relativeTo: currentProduct }),
      { from: "mira", kind: "say", text: "Build a full everyday look?", quickReplies: ["Build the look", "Another option"] }], pick);
  }

  // Winter / summer
  if (/winter|cold|freezing|cozy|layer|layering|autumn|fall/.test(t)) {
    const pick = hero(catalog.filter((p) => ["knitwear", "outerwear"].includes(p.category)), ctx);
    return withNav([recoMsg(pick, { lead: "Cashmere to layer, a coat to carry you through.", relativeTo: currentProduct })], pick);
  }
  if (/summer|beach|holiday|vacation|warm weather|linen|light|breezy|resort/.test(t)) {
    const pick = hero(catalog.filter((p) => ["the-atelier", "evening"].includes(p.collection)), ctx);
    return withNav([recoMsg(pick, { lead: "Light for warm days, linen that breathes, silk that floats.", relativeTo: currentProduct })], pick);
  }

  // New arrivals
  if (/new arrival|what.?s new|just dropped|latest|trending|what.?s in|fresh|new in|new pieces/.test(t)) {
    const newer = ["midnight-silk-gown", "leather-trench", "pleated-midi-skirt"].map((h) => catalog.find((p) => p.handle === h)).filter((p): p is Product => !!p);
    const pick = hero(newer, ctx);
    return withNav([recoMsg(pick, { lead: "The piece I keep coming back to this season.", relativeTo: currentProduct })], pick);
  }

  // Gift
  if (/gift|present|birthday|for my|for her|for him|for them|mother|mom|sister|friend|anniversary gift/.test(t)) {
    const picks = ["cashmere-v-neck", "ivory-silk-camisole"].map((h) => catalog.find((p) => p.handle === h)).filter((p): p is Product => !!p);
    const pick = hero(picks, ctx);
    return withNav([
      { from: "mira", kind: "say", text: "For gifting I go personal but not bold, cashmere and silk, things that work on everyone." },
      recoMsg(pick, { relativeTo: currentProduct }),
    ], pick);
  }

  // Price, budget / luxury / objection
  if (/too expensive|can't afford|out of my budget|too much|pricey/.test(t)) {
    const pick = hero([...catalog].sort((a, b) => a.priceUsd - b.priceUsd), ctx);
    return withNav([
      { from: "mira", kind: "say", text: "Fair. Here's the entry point, same quality standards, different number." },
      recoMsg(pick, { relativeTo: currentProduct }),
    ], pick);
  }
  if (/cheap|budget|afford|under \$?\d+|less than|price|how much|most affordable|value/.test(t)) {
    const pick = hero([...catalog].sort((a, b) => a.priceUsd - b.priceUsd), ctx);
    return withNav([recoMsg(pick, { lead: "The most accessible piece, same construction, easier entry.", relativeTo: currentProduct })], pick);
  }
  if (/expensive|luxury|investment|splurge|best|finest|premium|high.?end|most.*cost/.test(t)) {
    const pick = hero([...catalog].sort((a, b) => b.priceUsd - a.priceUsd), ctx);
    return withNav([recoMsg(pick, { lead: "The investment piece, the one still in your wardrobe in ten years.", relativeTo: currentProduct })], pick);
  }

  // Style direction
  if (/edgy|bold|statement|dramatic|avant.?garde|fashion.?forward|structured/.test(t)) {
    const pick = hero(catalog.filter((p) => ["tailored-blazer-double", "leather-trench", "onyx-silk-slip"].includes(p.handle)), ctx);
    return withNav([recoMsg(pick, { lead: "Strong and structured, not trying too hard, the piece people notice.", relativeTo: currentProduct })], pick);
  }
  if (/minimal|minimalist|simple|clean|pared.?back|quiet|effortless/.test(t)) {
    const pick = hero(catalog.filter((p) => ["linen-relaxed-shirt", "cashmere-v-neck", "atelier-wide-leg-trouser"].includes(p.handle)), ctx);
    return withNav([recoMsg(pick, { lead: "No noise, no excess. The right material, cut right.", relativeTo: currentProduct })], pick);
  }

  // Colour preferences
  if (/\bblack\b/.test(t) && /nothing in|not in|no |avoid|without/.test(t)) {
    const pick = hero(catalog.filter((p) => !p.colors.some((c) => /black|onyx|ink|midnight/i.test(c))), ctx);
    return withNav([recoMsg(pick, { lead: "Off the dark register, camel, ivory, champagne.", relativeTo: currentProduct })], pick);
  }
  if (/\b(black|all black|monochrome|dark|only black)\b/.test(t) && !/nothing in|not in|avoid/.test(t)) {
    const pick = hero(catalog.filter((p) => p.colors.some((c) => /black|onyx|ink|midnight|charcoal/i.test(c))), ctx);
    return withNav([recoMsg(pick, { lead: "The dark register, anchors a whole look.", relativeTo: currentProduct })], pick);
  }

  // Show alternatives
  if (/different|something else|other options|don't like|not those|not that|show.*more|more options|alternatives|another option/.test(t)) {
    const pick = hero(catalog, ctx);
    return withNav([
      { from: "mira", kind: "say", text: "Different direction, here's what I'd try instead." },
      recoMsg(pick, { relativeTo: currentProduct }),
    ], pick);
  }

  // Browse / explore
  if (/show me.*everything|see.*everything|browse|explore|just.*show|idk|i don.?t know|not sure|no idea|whatever you|something nice|show.*anything|surprise|anything|no preference|whatever|you choose|pick for me/.test(t)) {
    const pick = hero(catalog, ctx);
    return withNav([
      { from: "mira", kind: "say", text: "One piece worth your time right now." },
      recoMsg(pick, { relativeTo: currentProduct }),
      { from: "mira", kind: "say", text: "Tell me what feels right or wrong about it.", quickReplies: ["Love this", "Too formal", "Too casual", "Build the look"] },
    ], pick);
  }

  // Emotional
  if (/hate shopping|dread|nothing.*fits|never.*fits|look terrible|look bad|hate my body|don't.*know.*style|no style|bad at fashion/.test(t)) {
    return [{
      from: "mira", kind: "say",
      text: "That's exactly why I'm here. Tell me one thing you've felt good in before, even years ago, and I'll work backwards from it.",
      quickReplies: ["A good coat", "A silk dress", "Honestly nothing", "Just show me something"],
    }];
  }

  // Self-awareness
  if (/real person|human|ai|robot|bot|are you real|who are you|what are you|your name/.test(t)) {
    return [{
      from: "mira", kind: "say",
      text: "I'm Mira, an AI stylist. Not a real person, but I do have opinions about what you should wear.",
      quickReplies: ["Build a look", "Evening wear", "Surprise me"],
    }];
  }

  // Off-topic
  if (/weather|restaurant|book a|reservation|\btable\b|uber|taxi|food|recipe|travel|flight|hotel/.test(t)) {
    return [{ from: "mira", kind: "say", text: "Strictly clothes over here. Speaking of which, ", quickReplies: ["Build a look", "New arrivals", "Surprise me"] }];
  }

  // Closer
  if (/\b(no|nope|nah|not yet|not right now|later|bye|goodbye|thanks|thank you|all good|i'm good)\b/.test(t)) {
    return [{ from: "mira", kind: "say", text: "Of course. I'm here when you're ready." }];
  }

  // Generic keyword search → single hero
  const found = findProducts(userText);
  if (found.length) {
    const pick = hero(found, ctx);
    return withNav([
      recoMsg(pick, { relativeTo: currentProduct }),
      { from: "mira", kind: "say", text: "Tell me more if I've missed the mark." },
    ], pick);
  }

  // Last resort, one hero + occasion prompt
  const lastPick = hero(catalog, ctx);
  return withNav([
    recoMsg(lastPick, { lead: "Let me show you what I've been pulling lately.", relativeTo: currentProduct }),
    { from: "mira", kind: "say", text: "Or tell me the occasion, I'll be more specific.", quickReplies: ["Build a look", "Evening", "Surprise me"] },
  ], lastPick);
}

// ── Hybrid layer ──────────────────────────────────────────────────────────────
// The /api/mira endpoint (stronger Gemini) returns a grounded DECISION: Mira's
// voice line + a route into our deterministic catalog engine. The LLM never
// invents products/prices, applyDecision builds every card from real catalog
// data. If the endpoint returns no decision (no key / failure), the caller
// falls back to the pure-regex getMiraResponse. Same builders either way.
type MiraDecision = {
  voice: string;
  route:
    | "reco_category" | "reco_handle" | "reco_filter" | "navigate" | "look" | "fit" | "fabric"
    | "suitability" | "size_form" | "try_on" | "returns" | "add_to_cart"
    | "search" | "talk_only";
  category?: "top" | "bottom" | "knitwear" | "outerwear" | "evening" | "dress";
  filter?:
    | "cheapest" | "premium" | "new" | "dark" | "no_dark" | "edgy" | "minimal"
    | "winter" | "summer" | "everyday" | "gift" | "evening" | "wedding";
  productHandle?: string;
  searchQuery?: string;
  disagree?: boolean;
  quickReplies?: string[];
};

// ─── ONE-BACKEND MIGRATION, real per-tenant catalog registry ────────────────
// The storefront widget talks to the real Shopify app (App Proxy → brain), which
// returns THIS shop's real products on each turn. We register them here so cards
// render real merchant data, NOT the 14 hardcoded demo products. The hardcoded
// `catalog` remains ONLY as the marketing-demo fallback (when no real product was
// returned), so the demo page keeps working. This is what ends the double system
// on every real store.
type RealProduct = { id?: string; handle: string; name: string; category?: string | null; priceUsd?: number | null; image?: string | null; sizes?: string[]; colors?: string[] };
const runtimeCatalog = new Map<string, Product>();
const CAT_SET = new Set(["outerwear", "dress", "top", "bottom", "knitwear", "accessory"]);
function realToProduct(a: RealProduct): Product {
  const category = (CAT_SET.has(a.category ?? "") ? a.category : "top") as Product["category"];
  return {
    productId: a.id,
    handle: a.handle,
    name: a.name,
    collection: "the-atelier" as CollectionSlug,
    category,
    priceUsd: a.priceUsd ?? 0,
    description: "",
    images: a.image ? [a.image] : [],
    colors: a.colors ?? [],
    sizes: a.sizes ?? [],
    fitNotes: "",
    hesitationHint: "",
    fabricComposition: "",
    careInstructions: "",
  };
}
function registerRealProducts(products?: RealProduct[]): void {
  if (!products?.length) return;
  for (const p of products) if (p?.handle) runtimeCatalog.set(p.handle, realToProduct(p));
}

// STOREFRONT CATALOG HYDRATION (founder: "Mira doesn't understand the product").
// The runtimeCatalog was populated LAZILY — only after Mira's first API turn —
// so on PDP load byHandle() returned null and Mira fell to a generic greeting,
// never recognising the piece the shopper is standing on, and reco cards had no
// real images until the shopper typed. Shopify exposes the whole catalog at the
// same-origin `/products.json` (and the current piece at `/products/<handle>.js`)
// on EVERY storefront, theme-agnostic. We fetch it once on mount so Mira knows
// the merchant's real pieces (name, price, image, sizes, colours) immediately.
// Demo (ASSET_BASE === "") keeps its bundled catalog and skips this.
async function hydrateMerchantCatalog(): Promise<number> {
  if (typeof window === "undefined" || !ASSET_BASE) return 0;
  const opt = (p: { options?: { name?: string; values?: string[] }[] }, re: RegExp) =>
    (p.options ?? []).find((o) => re.test(o.name ?? ""))?.values ?? [];
  const toReal = (p: {
    handle: string; title: string; product_type?: string;
    variants?: { price?: string }[]; images?: { src?: string }[];
    options?: { name?: string; values?: string[] }[];
  }): RealProduct => ({
    handle: p.handle,
    name: p.title,
    category: p.product_type || undefined,
    priceUsd: p.variants?.[0]?.price ? Math.round(parseFloat(p.variants[0].price)) : 0,
    image: p.images?.[0]?.src ?? null,
    sizes: opt(p, /size/i),
    colors: opt(p, /colou?r/i),
  });
  try {
    const res = await fetch("/products.json?limit=250", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { products?: Parameters<typeof toReal>[0][] };
    const reals = (data.products ?? []).filter((p) => p?.handle).map(toReal);
    registerRealProducts(reals);
    return reals.length;
  } catch {
    // Fallback: at least hydrate the CURRENT product so the PDP opener works.
    const h = (window.location.pathname.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/i, "").match(/\/products?\/([^/?#]+)/i) ?? [])[1];
    if (!h) return 0;
    try {
      const r = await fetch(`/products/${h}.js`, { headers: { Accept: "application/json" } });
      if (!r.ok) return 0;
      const p = (await r.json()) as { handle: string; title: string; product_type?: string; price?: number; featured_image?: string; images?: string[]; options?: { name?: string; values?: string[] }[] };
      registerRealProducts([{
        handle: p.handle, name: p.title, category: p.product_type || undefined,
        priceUsd: typeof p.price === "number" ? Math.round(p.price / 100) : 0,
        image: p.featured_image ?? p.images?.[0] ?? null,
        sizes: opt(p, /size/i), colors: opt(p, /colou?r/i),
      }]);
      return 1;
    } catch { return 0; }
  }
}

function byHandle(h?: string): Product | null {
  if (!h) return null;
  const k = h.trim().toLowerCase();
  const real = runtimeCatalog.get(k) ?? runtimeCatalog.get(h);
  if (real) return real;
  // Consolidation P1.3: on a REAL storefront (ASSET_BASE set) NEVER serve the
  // bundled demo catalog, its handles/prices/images are phantom inventory on the
  // merchant's store. Only synced runtimeCatalog products are valid there. The
  // same-origin demo (ASSET_BASE === "") keeps the 14-product catalog.
  if (ASSET_BASE) return null;
  return catalog.find((p) => p.handle === k) ?? catalog.find((p) => p.handle.toLowerCase() === k) ?? null;
}

// Robust PDP handle detection (panel rank 7): real storefronts serve product
// pages under locale prefixes (/en/products/…, /fr-ca/products/…) and with
// mixed case, a brittle inline regex silently returns null there, which breaks
// the contextual opener, relative scoring, and the nudge. Strip a leading locale
// segment, match /product(s)/<handle>, decode + lowercase.
function detectCurrentProductHandle(): string | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/i, "");
  const m = path.match(/\/products?\/([^/?#]+)/i);
  if (!m) return null;
  return decodeURIComponent(m[1]).trim().toLowerCase();
}

function isDark(c: string): boolean {
  return /black|onyx|ink|midnight|charcoal/i.test(c);
}

// The set Mira filters/curates over: the REAL merchant products when any have
// been registered this session (storefront), else the demo catalog. Without
// this, reco_filter / reco_category showed demo products on a live store even
// though real products were available (panel P1/P2, the "two realities" leak).
function activeProducts(): Product[] {
  if (runtimeCatalog.size) return [...runtimeCatalog.values()];
  // On a real storefront with no synced products yet, return an HONEST empty set
  // (not the demo catalog) so Mira never filters/curates phantom demo products (P1.3).
  return ASSET_BASE ? [] : catalog;
}

function filterSet(filter: NonNullable<MiraDecision["filter"]>): Product[] {
  const base = activeProducts();
  // Demo-curated handle picks; on a real store they won't match, so fall back to
  // the real set rather than showing demo products or an empty card list.
  const pick = (handles: string[]) => {
    const got = handles.map(byHandle).filter((p): p is Product => !!p && (runtimeCatalog.size === 0 || runtimeCatalog.has(p.handle)));
    return got.length ? got : base.slice(0, 3);
  };
  let out: Product[];
  switch (filter) {
    case "cheapest": out = [...base].sort((a, b) => a.priceUsd - b.priceUsd); break;
    case "premium":  out = [...base].sort((a, b) => b.priceUsd - a.priceUsd); break;
    case "new":      out = pick(["midnight-silk-gown", "leather-trench", "pleated-midi-skirt"]); break;
    case "dark":     out = base.filter((p) => p.colors.some(isDark)); break;
    case "no_dark":  out = base.filter((p) => !p.colors.some(isDark)); break;
    case "edgy":     out = base.filter((p) => ["tailored-blazer-double", "leather-trench", "onyx-silk-slip"].includes(p.handle)); break;
    case "minimal":  out = base.filter((p) => ["linen-relaxed-shirt", "cashmere-v-neck", "atelier-wide-leg-trouser"].includes(p.handle)); break;
    case "winter":   out = base.filter((p) => ["knitwear", "outerwear"].includes(p.category)); break;
    case "summer":   out = base.filter((p) => ["the-atelier", "evening"].includes(p.collection)); break;
    case "everyday": out = base.filter((p) => ["the-atelier", "knitwear"].includes(p.collection)); break;
    case "gift":     out = pick(["cashmere-v-neck", "ivory-silk-camisole"]); break;
    case "evening":  out = base.filter((p) => p.collection === "evening"); break;
    case "wedding":  out = base.filter((p) => p.collection === "evening"); break;
  }
  // Never return an empty card list on a real store, degrade to the real set.
  return out.length ? out : base;
}

function categorySet(cat: NonNullable<MiraDecision["category"]>): Product[] {
  const base = activeProducts();
  const out = cat === "evening" ? base.filter((p) => p.collection === "evening") : base.filter((p) => p.category === cat);
  return out.length ? out : base;
}

// Grounded interstitial (panel rec #7): an instant line + skeleton-card count
// derived from the shopper's words, shown within ~100ms while the brain works.
function interstitialFor(text: string): { line: string; skeletons: number } {
  const t = text.toLowerCase();
  if (/^(hi|hey|hello|thanks|thank you|ok|okay|cool|bye)\b/.test(t) && t.length < 22) return { line: "", skeletons: 0 };
  if (/\b(what size|my size|will (it|this|they) fit|size (up|down)|measure|between sizes)\b/.test(t)) return { line: "Working out your size…", skeletons: 0 };
  if (/\b(see it on|try (it |this |them )?on|on me|on a model|fitting room)\b/.test(t)) return { line: "Setting up the fitting room…", skeletons: 0 };
  if (/\b(add to (cart|bag)|i'?ll take|buy it|bag it|checkout)\b/.test(t)) return { line: "Adding that for you…", skeletons: 0 };
  if (/\bwedding\b/.test(t)) return { line: "Pulling a few wedding looks…", skeletons: 3 };
  if (/\b(dinner|date|evening|party|cocktail|gala|night out)\b/.test(t)) return { line: "Styling something for the evening…", skeletons: 3 };
  if (/\b(work|office|interview|meeting)\b/.test(t)) return { line: "Putting together a polished look…", skeletons: 3 };
  if (/\b(brunch|weekend|casual|relaxed|everyday)\b/.test(t)) return { line: "Finding something easy…", skeletons: 2 };
  if (/\b(coat|dress|shirt|trouser|skirt|knit|cashmere|wool|silk|linen|wear|outfit|show me|looking for|something)\b/.test(t)) return { line: "Pulling a few pieces…", skeletons: 2 };
  return { line: "One sec…", skeletons: 0 };
}

// Turn an LLM decision into grounded cards. Voice line first (Mira's human
// understanding), then the real product/look/insight built from the catalog.
function applyDecision(d: MiraDecision, currentProduct: Product | null, ctx: MiraContext): ChatMsg[] {
  // ONE-BRAIN: the brain's real per-shop products are registered BEFORE this runs,
  // so on a real store activeProducts() holds them — shadow the bundled demo
  // `catalog` with the real set so the hero() fallbacks here can never surface a
  // phantom demo piece. On the demo page activeProducts() === the demo catalog.
  const catalog = activeProducts();
  const voice: ChatMsg = { from: "mira", kind: "say", text: d.voice, quickReplies: d.quickReplies };
  // Price-truth guard: on card/cart routes the card below is the authoritative
  // total, so strip any price the LLM spoke in `voice` to prevent the
  // "$1950 voice vs $3,540 card" contradiction. Budget/talk routes keep prices.
  if (CARD_PRICE_ROUTES.has(d.route)) voice.text = stripSpokenPrice(voice.text);
  const out: ChatMsg[] = [voice];

  switch (d.route) {
    case "talk_only":
      return out;

    case "size_form":
      out.push({ from: "mira", kind: "say", text: SIZE_FORM_TRIGGER });
      return out;

    case "try_on": {
      // Fitting room = the closing zone. Open the try-on for the exact piece.
      const anchor = byHandle(d.productHandle) ?? currentProduct ?? hero(catalog, ctx);
      out.push({ from: "mira", kind: "say", text: `${TRYON_TRIGGER}${anchor.handle}` });
      return out;
    }

    case "returns":
      out.push({ from: "mira", kind: "insight", label: "Returns", text: "14-day window, unworn, original packaging, handled directly through the Stylique Maison team." });
      return out;

    case "fit": {
      const anchor = byHandle(d.productHandle) ?? currentProduct;
      if (anchor) {
        const sizeAlreadyAnswered =
          /\b(?:you(?:'re| are)|your size(?: is)?|i(?:'d| would) put you in)\s+(?:an?\s+)?(?:XXS|XS|S|M|L|XL|XXL|XXXL|small|medium|large|\d{1,2})\b/i.test(d.voice);
        out.push({
          from: "mira",
          kind: "insight",
          label: "Fit",
          text: anchor.fitNotes,
          quickReplies: sizeAlreadyAnswered
            ? ["See it on me", "Add to bag", "Show the look"]
            : ["Size me", "Add to bag", "Show the look"],
        });
      }
      return out;
    }

    case "fabric": {
      const anchor = byHandle(d.productHandle) ?? currentProduct;
      if (anchor?.fabricComposition) {
        // ONE clean line, no dash, fabric + care in plain language.
        const care = anchor.careInstructions ? ` ${anchor.careInstructions}.` : "";
        out.push({ from: "mira", kind: "insight", label: "Fabric & care", text: `${anchor.fabricComposition}.${care}`, quickReplies: ["Will it fit me?", "Style a full look", "Add to bag"] });
      }
      return out;
    }

    case "suitability": {
      const anchor = byHandle(d.productHandle) ?? currentProduct;
      if (anchor) {
        out.push({ from: "mira", kind: "insight", label: "My honest read", text: candidTake(anchor), quickReplies: ["Size me", "What's it made of?", "Show the look"] });
      }
      return out;
    }

    case "add_to_cart": {
      const anchor = byHandle(d.productHandle) ?? currentProduct;
      if (!anchor) return out;

      const bundleIntent = /add.*(every|all|outfit|look|full|entire)|full.*look|entire.*look|i('ll| will) take the look/i.test(ctx.lastTopic);
      // CLOSE THE PROMISE GAP (council #4): if Mira's VOICE promised a multi-piece
      // add ("I'll add both", "the whole look", "all three"), the cart MUST deliver
      // that, not silently add one. So the voice promise also triggers the bundle.
      const voiceWantsLook = /\b(add (both|all)|both of (them|these)|the (whole|entire|full) (look|outfit)|all (of )?(them|three|two))\b/i.test(d.voice ?? "");

      // PRIMARY: use active-look-memory bundle resolution (works even without a look card)
      // This is the robust path, resolveBundle is called from the widget via ctx.activeLook
      // which is passed in at callsite. We use ctx.lastLookPieces as the legacy fallback.
      if (bundleIntent || voiceWantsLook) {
        const lookPieces = ctx.lastLookPieces ?? [];
        if (lookPieces.length > 0) {
          const all = [anchor, ...lookPieces.filter((p) => p.handle !== anchor.handle)];
          const total = all.reduce((s, p) => s + p.priceUsd, 0);
          // Collapse to 2 bubbles: voice (with quickReplies) + one bundle cart chip
          out[0] = { ...voice, text: `Done, the full look is in your bag. ${all.map((p) => p.name).join(", ")}. Total ${money(total)}.`, quickReplies: ["Go to checkout", "Keep shopping"] };
          out.push({ from: "mira", kind: "cart", productName: `${all.length} pieces, ${anchor.name} look` });
          return out;
        }
      }

      // SINGLE item add (standard path) — 2 bubbles: voice (with quickReplies) + cart
      out[0] = { ...voice, text: `${anchor.name} is in your bag. Want me to complete the look before you check out?`, quickReplies: voice.quickReplies?.length ? voice.quickReplies : ["Complete the look", "Keep shopping"] };
      out.push({ from: "mira", kind: "cart", productName: anchor.name });
      return out;
    }

    case "look": {
      const anchor = byHandle(d.productHandle) ?? currentProduct ?? hero(catalog, ctx);
      out.push(lookMsg(anchor, ctx));
      return out;
    }

    case "navigate": {
      const p = byHandle(d.productHandle) ?? currentProduct;
      if (p) {
        // Only walk them there if they're not already on that page.
        const onIt = currentProduct?.handle === p.handle;
        out.push(recoMsg(p, { escalate: false, relativeTo: currentProduct }));
        if (!onIt) out.push({ from: "mira", kind: "say", text: `${NAV_TRIGGER}${p.handle}` });
      } else {
        out.push(recoMsg(hero(catalog, ctx), { relativeTo: currentProduct }));
      }
      return out;
    }

    case "reco_handle": {
      // A committed, named pick. Show the card AND walk them to the rack, a great
      // associate doesn't just say "here's the piece", she takes you to it. We
      // navigate whenever the pick differs from the page they're on.
      const p = byHandle(d.productHandle);
      if (p) {
        const onIt = currentProduct?.handle === p.handle;
        out.push(recoMsg(p, { escalate: d.disagree === false, relativeTo: currentProduct }));
        if (!onIt) out.push({ from: "mira", kind: "say", text: `${NAV_TRIGGER}${p.handle}` });
      } else {
        out.push(recoMsg(hero(catalog, ctx), { relativeTo: currentProduct }));
      }
      return out;
    }

    case "reco_category": {
      const set = d.category ? categorySet(d.category) : catalog;
      const picks = fresh(set.length ? set : catalog, ctx).slice(0, 3);
      // Put quickReplies on the voice bubble so there's only 1 text bubble + N card bubbles
      out[0] = { ...voice, quickReplies: voice.quickReplies?.length ? voice.quickReplies : ["Build the look", "Another option", "Size me"] };
      (picks.length ? picks : [hero(set.length ? set : catalog, ctx)]).forEach((p) =>
        out.push(recoMsg(p, { relativeTo: currentProduct }))
      );
      return out;
    }

    case "reco_filter": {
      const set = d.filter ? filterSet(d.filter) : catalog;
      out.push(recoMsg(hero(set.length ? set : catalog, ctx), { relativeTo: currentProduct }));
      return out;
    }

    case "search": {
      const found = findProducts(d.searchQuery ?? d.voice);
      out.push(recoMsg(hero(found.length ? found : catalog, ctx), { relativeTo: currentProduct }));
      return out;
    }
  }
  return out;
}

// Candid take, Mira flags the real caveat instead of pure approval. Credibility.
function candidTake(p: Product): string {
  const notes = p.fitNotes ?? "";
  if (/size up|sizing up|runs small|unforgiving|genuinely small/i.test(notes))
    return `It's a flattering one, but I'll be honest, this cut is unforgiving in the wrong size. Get that right and it's yours. ${whyFor(p)}`;
  if (/longer torso|petite|hem|long/i.test(notes))
    return `It suits most frames well. The one caveat: it's cut long, so if you're petite you may want the hem taken up. Otherwise, ${whyFor(p)}`;
  if (/deep v|not subtle/i.test(notes))
    return `It works on you, just know the neckline is exactly as shown, it's not subtle. If that's the look you want, ${whyFor(p)}`;
  return `Honestly? It's a flattering one. ${whyFor(p)}`;
}

// Free shipping nudge, one specific piece to close the gap.
function freeShippingNudge(cartValue: number, ctx: MiraContext): ChatMsg[] | null {
  const gap = FREE_SHIPPING_THRESHOLD - cartValue;
  if (gap <= 0 || gap > 250) return null;
  const cand = fresh([...activeProducts()].sort((a, b) => a.priceUsd - b.priceUsd), ctx)
    .filter((p) => p.priceUsd >= gap && p.priceUsd <= gap + 200)[0];
  if (!cand) return null;
  return [
    { from: "mira", kind: "say", text: `You're $${Math.round(gap)} from free shipping, and the ${cand.name} pairs perfectly with what you're looking at.` },
    recoMsg(cand),
  ];
}

// ── Size form ─────────────────────────────────────────────────────────────────
const USUAL_SIZES_MIRA = ["XS", "S", "M", "L", "XL", "XXL"] as const;

function SizeForm({ product, onResult }: { product: Product | null; onResult: (label: string, text: string, replies: string[], size: string, handle: string) => void }) {
  // Prefill from the body we already captured, so the shopper never re-enters
  // measurements when sizing a second piece, they just confirm + submit.
  const prior = loadBody();
  const [height, setHeight] = useState(prior ? String(prior.heightCm) : "");
  const [weight, setWeight] = useState(prior ? String(prior.weightKg) : "");
  const [fitPref, setFitPref] = useState<"slim" | "relaxed" | "true">(prior?.fitPref ?? "true");
  const [age, setAge] = useState<number>(prior?.age ?? 0);
  const [usualSize, setUsualSize] = useState<string>(prior?.usualBrandSize ?? "none");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // Live BoldMatrix-style confidence breakdown — shows the shopper exactly what
  // signals they've provided and how accurate the recommendation will be.
  const hNum = parseFloat(height), wNum = parseFloat(weight);
  const hValid = hNum >= 100 && hNum <= 230, wValid = wNum >= 30 && wNum <= 200;
  const cbLive = (hValid && wValid) ? confidenceBreakdown({
    heightCm: hNum, weightKg: wNum,
    age: age > 0 ? age : undefined,
    usualBrandSize: usualSize !== "none" ? usualSize : undefined,
  }) : null;

  const handleSubmit = async () => {
    const h = parseFloat(height), w = parseFloat(weight);
    if (!h || !w || h < 100 || h > 230 || w < 30 || w > 200) {
      onResult("Fit", "I need a valid height (cm) and weight (kg) to size you properly.", ["Size me"], "", product?.handle ?? "");
      return;
    }
    const anchor = product ?? catalog[0];
    const pref: FitPref = fitPref === "slim" ? "snug" : fitPref === "relaxed" ? "relaxed" : "true";

    // The installed Shopify widget must use the tenant-aware fit service. The
    // local calculator remains only for the standalone marketing demo.
    if (ASSET_BASE) {
      if (!anchor?.productId) {
        onResult("Fit unavailable", "This product has not finished syncing its sizing data yet.", ["Show another piece"], "", anchor?.handle ?? "");
        return;
      }
      setBusy(true);
      try {
        const apiPref =
          fitPref === "slim" ? "FITTED" :
          fitPref === "relaxed" ? "RELAXED" :
          "REGULAR";
        const res = await fetch(`${sqApi()}/api/fit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: anchor.productId,
            heightCm: Math.round(h),
            weightKg: Math.round(w),
            fitPreference: apiPref,
          }),
        });
        const payload = (await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          data?: {
            recommendedSize?: string;
            confidence?: number;
            rationale?: string;
            trustLine?: string;
            sizeUpAdvice?: string;
          };
        } | null;
        const result = payload?.data;
        if (!res.ok || !payload?.ok || !result?.recommendedSize) {
          const unavailable = payload?.error === "invalid_input" || payload?.error === "product_not_found";
          onResult(
            unavailable ? "Sizing data unavailable" : "Fit unavailable",
            unavailable
              ? "I do not have enough verified sizing data for this piece yet."
              : "I could not verify a size right now. Please use the product size chart.",
            ["Show the size chart", "Show another piece"],
            "",
            anchor.handle,
          );
          return;
        }
        rememberBody({
          heightCm: h,
          weightKg: w,
          fitPref,
          age: age > 0 ? age : undefined,
          usualBrandSize: usualSize !== "none" ? usualSize : undefined,
        });
        const confidencePct = Math.round((result.confidence ?? 0) * 100);
        const advice = result.sizeUpAdvice ? ` ${result.sizeUpAdvice}` : "";
        onResult(
          `Your size · ${result.recommendedSize}`,
          `${result.rationale ?? result.trustLine ?? "Matched against the available sizing data."} Confidence ${confidencePct}%.${advice}`,
          ["Add to bag", "See it on you", "Build the look"],
          result.recommendedSize,
          anchor.handle,
        );
        setDone(true);
        return;
      } catch {
        onResult("Fit unavailable", "I could not verify a size right now. Please use the product size chart.", ["Show the size chart"], "", anchor.handle);
        return;
      } finally {
        setBusy(false);
      }
    }

    const rec = recommendSize(anchor, h, w, pref, age > 0 ? age : undefined, usualSize !== "none" ? usualSize : undefined);
    const keepPct = Math.round(rec.keepRate * 100);
    const cb = confidenceBreakdown({ heightCm: h, weightKg: w, age: age > 0 ? age : undefined, usualBrandSize: usualSize !== "none" ? usualSize : undefined });
    const confidence = rec.confidence >= 80
      ? `This is a confident call (${cb.score}% sizing accuracy).`
      : rec.confidence >= 65
      ? `I'd put this at a good bet (${cb.score}%). ${cb.upgradeMessage}`
      : `Reasonably sure (${cb.score}%). ${cb.upgradeMessage}`;
    const altLine = rec.alt ? ` If you want, ${rec.alt.note}, the ${rec.alt.size}.` : "";
    const text = `For the ${anchor.name}: size ${rec.size}. ${rec.reasoning} ${confidence}${altLine} ${keepPct}% of shoppers your frame kept their ${rec.size} in this brand.`;
    // Remember the body + new signals (prefills the next piece) and this piece's size.
    rememberBody({ heightCm: h, weightKg: w, fitPref, age: age > 0 ? age : undefined, usualBrandSize: usualSize !== "none" ? usualSize : undefined });
    onResult(`Your size · ${rec.size}`, text, ["Add to bag", "See it on you", "Build the look"], rec.size, anchor.handle);
    setDone(true);
  };

  if (done) return null;
  return (
    <div style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.22)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--electric)", textTransform: "uppercase" }}>Size me</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={height} onChange={(e) => setHeight(e.target.value)} placeholder="Height (cm)" type="number" className="sq-mira-field" aria-label="Height in centimetres" style={sizeInputStyle()} />
        <input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Weight (kg)" type="number" className="sq-mira-field" aria-label="Weight in kilograms" style={sizeInputStyle()} />
      </div>
      {/* Optional BoldMatrix signals — age + usual brand size */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={age > 0 ? age : ""}
          onChange={(e) => { const v = parseInt(e.target.value, 10); setAge(isNaN(v) ? 0 : Math.max(0, Math.min(90, v))); }}
          placeholder="Age (opt · +8%)"
          type="number"
          className="sq-mira-field"
          aria-label="Your age (optional, improves sizing accuracy)"
          style={{ ...sizeInputStyle(), flex: 1 }}
        />
        <select
          value={usualSize}
          onChange={(e) => setUsualSize(e.target.value)}
          aria-label="Your usual size in a similar brand"
          style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 12px", color: usualSize === "none" ? "rgba(244,242,238,0.4)" : "#F4F2EE", fontFamily: "var(--mono)", fontSize: 11, outline: "none", cursor: "pointer" }}
        >
          <option value="none">Usual size +10%</option>
          {USUAL_SIZES_MIRA.map((s) => <option key={s} value={s}>{s} usually</option>)}
        </select>
      </div>
      {/* Live confidence strip — only shown once height + weight are valid */}
      {cbLive && (
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.1em", color: "var(--electric)", textTransform: "uppercase" }}>Confidence</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: cbLive.score >= 80 ? "#4EC49E" : cbLive.score >= 68 ? "#E8A44C" : "var(--mute)", fontWeight: 600 }}>{cbLive.score}%</span>
          </div>
          {cbLive.signals.map((s) => (
            <span key={s} style={{ fontFamily: "var(--sans)", fontSize: 10.5, color: "rgba(244,242,238,0.65)" }}>✓ {s}</span>
          ))}
          {cbLive.score < 93 && (
            <span style={{ fontFamily: "var(--sans)", fontSize: 10, color: "var(--mute)", lineHeight: 1.4 }}>{cbLive.upgradeMessage}</span>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        {(["slim", "true", "relaxed"] as const).map((pref) => (
          <button key={pref} onClick={() => setFitPref(pref)} style={{
            flex: 1, padding: "7px 8px",
            background: fitPref === pref ? "rgba(139,92,246,0.25)" : "transparent",
            border: `1px solid ${fitPref === pref ? "rgba(139,92,246,0.6)" : "rgba(255,255,255,0.12)"}`,
            borderRadius: 999, fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "capitalize",
            color: fitPref === pref ? "rgba(139,92,246,0.95)" : "var(--mute)", cursor: "pointer",
          }}>{pref === "true" ? "True fit" : pref}</button>
        ))}
      </div>
      <button disabled={busy} onClick={() => void handleSubmit()} style={{ background: "var(--grad)", border: "none", borderRadius: 8, padding: "10px", color: "#0E0A14", fontFamily: "var(--sans)", fontWeight: 600, fontSize: 13, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>{busy ? "Checking fit…" : "Get my size →"}</button>
    </div>
  );
}
function sizeInputStyle(): React.CSSProperties {
  return { flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 12px", color: "#F4F2EE", fontFamily: "var(--mono)", fontSize: 12, outline: "none" };
}

// ── Cards ─────────────────────────────────────────────────────────────────────
// Recommendation card, visual-first. Big image, name + price, WHY THIS WORKS,
// Add to bag primary. Try-on is a secondary escalation, shown only on intent.
function RecoCard({ reco, onTryOn, onAddToBag }: { reco: Reco; onTryOn: (p: Product) => void; onAddToBag: (p: Product) => void }) {
  const { product: p, why, escalateTryOn, score } = reco;
  // Navigate to the product page. On the demo this is /product/<handle>; the card
  // image + title are the natural "take me there" affordance a shopper expects.
  const goToProduct = () => { if (typeof window !== "undefined") window.location.href = productUrl(p.handle); };
  // Proactive sizing (conversion panel #6): surface the shopper's size + fit
  // confidence right on the card so they never have to ASK "what's my size", 
  // the #1 pre-purchase friction is answered before it's voiced.
  const body = loadBody();
  const bodyPref: FitPref | undefined = body ? (body.fitPref === "slim" ? "snug" : body.fitPref) : undefined;
  const sizeRec = (!ASSET_BASE && body && p.sizes.length) ? recommendSizeForProduct(p, {
    heightCm: body.heightCm, weightKg: body.weightKg, fitPref: bodyPref,
    age: body.age,
    usualBrandSize: body.usualBrandSize,
  }) : null;
  // Single decisive CTA (conversion panel #5): lead with the ONE move most likely
  // to close. Fit certain → bag it; fit unknown/uncertain → see it on you first to
  // kill the fit objection. The other action stays as a quiet secondary.
  const fitUncertain = !sizeRec || sizeRec.confidence < 70;
  const bagFirst = !fitUncertain;
  const closeLine = bagFirst
    ? (sizeRec ? `Your ${sizeRec.size} is the move, want it in the bag?` : "This is the one, want it in the bag?")
    : (sizeRec ? "Let's make sure of the fit, see it on you first." : "See it on you first, then we lock it in.");
  // Max-interactive layered card behavior (founder ask): pointer-tilt +
  // cursor-following glow + image parallax counter-shift on hover. CSS-vars
  // driven so the math stays in CSS; the JS just samples coordinates. Touch
  // devices and prefers-reduced-motion completely bypass via the media
  // queries in the <style> block — never sets the vars there.
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;   // 0 → 1
    const my = (e.clientY - rect.top) / rect.height;   // 0 → 1
    el.style.setProperty("--sq-mx", `${(mx - 0.5) * 2}`); // -1 → 1
    el.style.setProperty("--sq-my", `${(my - 0.5) * 2}`); // -1 → 1
    el.style.setProperty("--sq-gx", `${mx * 100}%`);
    el.style.setProperty("--sq-gy", `${my * 100}%`);
  };
  const handlePointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.style.setProperty("--sq-mx", "0");
    el.style.setProperty("--sq-my", "0");
    el.style.setProperty("--sq-gx", "50%");
    el.style.setProperty("--sq-gy", "50%");
  };
  return (
    <div
      className="sq-reco-card"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 16,
        overflow: "hidden",
        position: "relative",
        // CSS-var defaults — let CSS apply the transforms.
        ["--sq-mx" as string]: "0",
        ["--sq-my" as string]: "0",
        ["--sq-gx" as string]: "50%",
        ["--sq-gy" as string]: "50%",
      }}
    >
      <div onClick={goToProduct} role="link" tabIndex={0} aria-label={`View ${p.name}`} className="sq-mira-field sq-reco-card__img" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goToProduct(); } }} style={{ position: "relative", width: "100%", height: 160, background: "var(--surface)", cursor: "pointer", overflow: "hidden" }}>
        <Image src={p.images[0]} alt={p.name} fill sizes="380px" style={{ objectFit: "cover", objectPosition: "center 28%" }} />
        {p.lowStock && (
          <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(14,10,20,0.82)", border: "1px solid rgba(248,113,113,0.5)", borderRadius: 999, padding: "3px 10px", fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#F8A0A0" }}>Low stock</div>
        )}
        {score?.matchPct != null && score.matchPct > 0 && (
          <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(14,10,20,0.82)", border: "1px solid rgba(139,92,246,0.5)", borderRadius: 999, padding: "3px 10px", fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--electric)" }}>{score.matchPct}% match</div>
        )}
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 11 }}>
        {/* Name + price */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <div onClick={goToProduct} style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17, lineHeight: 1.2, cursor: "pointer" }}>{p.name}</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.06em", color: "rgba(244,242,238,0.9)", flexShrink: 0 }}>{money(p.priceUsd)}</div>
        </div>
        {/* WHY IT'S FOR YOU — the hero line, readable, personalised. */}
        {why && (
          <div style={{ fontFamily: "var(--sans)", fontSize: 14.5, lineHeight: 1.5, color: "#F4F2EE" }}>
            <span style={{ color: "var(--electric)", fontWeight: 600 }}>Why it&apos;s right for you: </span>{why}
          </div>
        )}
        {/* SIZE — clear and readable (no tiny chip). The #1 question, answered. */}
        {sizeRec && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderRadius: 11, background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.28)" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(199,184,255,0.85)" }}>Your size</span>
            <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 19, color: "#F4F2EE", lineHeight: 1 }}>{sizeRec.size}</span>
            <span style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--mute)", marginLeft: "auto" }}>{sizeRec.confidence}% fit{score?.keepPct != null ? ` · ${score.keepPct}% keep it` : ""}</span>
          </div>
        )}
        {/* One decisive closing line, then ONE primary move + a quiet secondary. */}
        <div style={{ fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.45, color: "rgba(244,242,238,0.92)" }}>{closeLine}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {bagFirst ? (
            <>
              <button onClick={() => onAddToBag(p)} style={primaryBtn()}>Add to bag · {money(p.priceUsd)}</button>
              <button onClick={() => onTryOn(p)} style={secondaryBtn()}>See it on you</button>
            </>
          ) : (
            <>
              <button onClick={() => onTryOn(p)} style={primaryBtn()}>See it on you</button>
              <button onClick={() => onAddToBag(p)} style={secondaryBtn()}>Add · {money(p.priceUsd)}</button>
            </>
          )}
        </div>
        <button onClick={goToProduct} style={{ background: "transparent", border: "none", padding: 0, margin: 0, color: "var(--mute)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", cursor: "pointer", textAlign: "left", alignSelf: "flex-start" }}>View full product →</button>
      </div>
    </div>
  );
}

/**
 * Express Checkout shortcuts (Payments panel finding: 1/10 → goal 7+/10).
 *
 * Detects which wallets the shopper's browser + the host store actually
 * support, surfaces a horizontal row of small pills, and shortcuts each one
 * to `/checkout`. Shopify Checkout's own wallet picker handles the actual
 * payment intent — we don't invoke any SDK directly, which means: no
 * Stripe / Apple Pay merchant-validation pre-handshake, no Google Pay
 * `PaymentRequest` ceremony, no flashes-of-wrong-UI before the real
 * wallet UI loads. Each pill is just an honest navigation affordance to
 * the express path Shopify already exposes.
 *
 * Detection rules (run once on mount; SSR-safe — empty list during prerender):
 *   - Shop Pay → `window.Shopify?.shop` exists (we are on a Shopify
 *     storefront; Shop Pay is universally available on Shopify checkouts).
 *   - Apple Pay → `window.ApplePaySession?.canMakePayments?.() === true`.
 *   - Google Pay → `window.PaymentRequest` exists (the W3C Payment Request
 *     API; Google Pay is exposed through it on Chrome/Android).
 *
 * Touch + safe: every pill has min-height 44px (WCAG 2.5.5). Demo
 * (non-Shopify) renders nothing — we only show real, available payment
 * paths, never aspirational ones.
 */
function ExpressCheckout() {
  const [wallets, setWallets] = useState<string[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const detected: string[] = [];
    try {
      const w = window as unknown as {
        Shopify?: { shop?: string };
        ApplePaySession?: { canMakePayments?: () => boolean };
        PaymentRequest?: unknown;
      };
      // Verification-panel cycle-9 finding: previously we detected
      // window.PaymentRequest unconditionally, which is TRUE in every
      // modern Chrome — so the demo (non-Shopify) was rendering a Google
      // Pay pill that routed to /checkout (404 on demo). Now: gate the
      // ENTIRE detection on Shopify storefront presence. Non-Shopify =
      // no wallets surfaced. Honest.
      if (!w.Shopify?.shop) return;
      detected.push("shop");
      if (typeof w.ApplePaySession?.canMakePayments === "function") {
        try { if (w.ApplePaySession.canMakePayments()) detected.push("apple"); } catch { /* ignore */ }
      }
      if (typeof w.PaymentRequest !== "undefined") detected.push("google");
    } catch { /* ignore */ }
    setWallets(detected);
  }, []);
  if (wallets.length === 0) return null;
  const labels: Record<string, { name: string; icon: string; bg: string; color: string }> = {
    shop:   { name: "Shop Pay",   icon: "▸",  bg: "#5A31F4", color: "#FFFFFF" },
    apple:  { name: "Apple Pay",  icon: "",  bg: "#000000", color: "#FFFFFF" },
    google: { name: "Google Pay", icon: "G",  bg: "#FFFFFF", color: "#1A73E8" },
  };
  return (
    <div role="group" aria-label="Express checkout" style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(244,242,238,0.6)" }}>Pay fast</span>
      {wallets.map((w) => {
        const cfg = labels[w]!;
        return (
          <button
            key={w}
            onClick={() => { window.location.href = "/checkout"; }}
            aria-label={`Express checkout with ${cfg.name}`}
            style={{
              background: cfg.bg,
              color: cfg.color,
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 999,
              minHeight: 44,
              padding: "0 14px",
              fontFamily: "var(--sans)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "transform 160ms var(--ease-spring)",
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.97)"; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>{cfg.icon}</span>
            <span>{cfg.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// A small real-stat chip, the visible scorecard atom. Never shows an invented
// number; callers only pass figures sourced from the catalog / styling engine.
function Stat({ label, tone }: { label: string; tone: "accent" | "mute" }) {
  const accent = tone === "accent";
  return (
    <span style={{
      fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase",
      padding: "3px 8px", borderRadius: 999,
      color: accent ? "var(--electric)" : "rgba(244,242,238,0.6)",
      background: accent ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.05)",
      border: `1px solid ${accent ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.1)"}`,
    }}>{label}</span>
  );
}

// Complete-the-look board, the AOV lever. Named edit, harmonised pieces, total,
// add the entire look in one tap, or try the whole look (escalation).
function LookCard({ look, onTryOn, onAddLook }: { look: LookBoard; onTryOn: (p: Product) => void; onAddLook: (anchor: Product, pieces: Product[]) => void }) {
  const all = [look.anchor, ...look.pieces];
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(139,92,246,0.22)", borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "12px 15px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--electric)", marginBottom: 3 }}>The edit{look.score?.harmonyLabel ? ` · ${look.score.harmonyLabel}` : ""}</div>
          {look.score && look.score.harmonyPct > 0 && <Stat label={`${look.score.harmonyPct}% match`} tone="accent" />}
        </div>
        <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17 }}>{look.title}</div>
      </div>
      <div style={{ display: "flex", gap: 6, padding: "0 12px" }}>
        {all.map((p) => (
          // Tap a piece → navigate to its PDP (founder: "navigate to recommended
          // products"). Whole-look try-on lives on the "Try the look" button below.
          <button key={p.handle} onClick={() => { if (typeof window !== "undefined") window.location.href = productUrl(p.handle); }} title={`${p.name} · ${money(p.priceUsd)} — view`} aria-label={`View ${p.name}`} style={{ flex: 1, position: "relative", aspectRatio: "3 / 4", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "var(--surface)", cursor: "pointer", padding: 0 }}>
            {p.images[0] ? (
              <Image src={p.images[0]} alt={p.name} fill sizes="90px" style={{ objectFit: "cover" }} />
            ) : (
              // No photo yet — render a tasteful name tile instead of a broken
              // image so the card never looks empty (the "cards don't work"
              // failure). The brain already avoids heroing photo:NO pieces.
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: 6, background: "linear-gradient(150deg, rgba(139,92,246,0.14), rgba(255,255,255,0.03))" }}>
                <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 12, lineHeight: 1.2, textAlign: "center", color: "rgba(244,242,238,0.92)" }}>{p.name}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--electric)" }}>{p.category ?? "piece"}</div>
              </div>
            )}
          </button>
        ))}
      </div>
      <div style={{ padding: "11px 15px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "var(--sans)", fontSize: 12.5, lineHeight: 1.55, color: "rgba(244,242,238,0.78)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{look.why}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onAddLook(look.anchor, look.pieces)} style={primaryBtn()}>Add entire look · {money(look.total)}</button>
          <button onClick={() => onTryOn(look.anchor)} style={secondaryBtn()}>Try the look ↗</button>
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--mute)" }}>Tap any piece to view it</div>
      </div>
    </div>
  );
}

// Style note / fit / candid, bordered insight card with a mono label + accent.
function InsightCard({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ borderLeft: "2px solid var(--electric)", paddingLeft: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--electric)" }}>{label}</div>
      <div style={{ fontFamily: "var(--sans)", fontSize: 13.5, lineHeight: 1.6, color: "#F4F2EE" }}>{renderText(text)}</div>
    </div>
  );
}

// Compact context divider — marks a product switch in the thread with a small
// thumbnail + name + price, so the new context reads at a glance (no wall of text).
function ContextCard({ product, prevName }: { product: Product; prevName?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "4px 0 2px" }}>
      <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.35))" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 9, background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.28)", borderRadius: 999, padding: "5px 12px 5px 5px" }}>
        <div style={{ position: "relative", width: 30, height: 30, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "var(--surface)" }}>
          {product.images[0]
            ? <Image src={product.images[0]} alt={product.name} fill sizes="30px" style={{ objectFit: "cover" }} />
            : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 7.5, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--electric)" }}>{prevName ? "Now viewing" : "Viewing"}</span>
          <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13, color: "#F4F2EE" }}>{product.name}</span>
        </div>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "rgba(244,242,238,0.6)", paddingLeft: 2 }}>{money(product.priceUsd)}</span>
      </div>
      <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(139,92,246,0.35), transparent)" }} />
    </div>
  );
}

function primaryBtn(): React.CSSProperties {
  return { flex: 1, background: "var(--grad)", border: "none", borderRadius: 8, padding: "10px 12px", color: "#0E0A14", fontFamily: "var(--sans)", fontWeight: 600, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" };
}
function secondaryBtn(): React.CSSProperties {
  return { background: "transparent", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, padding: "10px 12px", color: "rgba(244,242,238,0.85)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" };
}

// ── Main widget ───────────────────────────────────────────────────────────────
export default function MiraWidget() {
  const [open, setOpen]           = useState(false);
  // URL signal — polled (not next/navigation, which doesn't exist in the
  // esbuild/preact widget bundle). Drives re-approach when the shopper navigates
  // to a different product, on both the Next demo AND the Shopify storefront.
  const [pathname, setPathname] = useState<string>(typeof window !== "undefined" ? window.location.pathname : "");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tick = () => { const p = window.location.pathname; setPathname((prev) => (prev === p ? prev : p)); };
    const id = window.setInterval(tick, 500);
    window.addEventListener("popstate", tick);
    return () => { window.clearInterval(id); window.removeEventListener("popstate", tick); };
  }, []);
  // Last product Mira has "approached"; drives re-approach on navigation.
  const approachedHandle = useRef<string | null>(null);
  // Hydrate the merchant's real catalog from Shopify on mount (storefront only)
  // so Mira recognises the PDP piece + shows real product cards from turn one.
  // The bump forces a re-render once the (module-level) runtimeCatalog is filled.
  const [, setHydrated] = useState(0);
  useEffect(() => {
    let alive = true;
    hydrateMerchantCatalog().then((n) => { if (alive && n > 0) setHydrated((x) => x + 1); });
    return () => { alive = false; };
  }, []);
  const [messages, setMessages]   = useState<ChatMsg[]>([]);
  const [input, setInput]         = useState("");
  const [typing, setTyping]       = useState(false);
  // Perceived-latency (panel rec #7): an instant grounded "pull" line + shimmer
  // skeleton cards shown the MOMENT the shopper sends, so the 8, 18s brain wait
  // reads as anticipation, not a frozen dot.
  const [interstitial, setInterstitial] = useState<string | null>(null);
  const [skeletons, setSkeletons] = useState(0);
  const stopThinking = useCallback(() => { setTyping(false); setInterstitial(null); setSkeletons(0); }, []);
  const [tryOnProduct, setTryOn]  = useState<Product | null>(null);
  const [nudge, setNudge]         = useState(false);
  const [nudgeProduct, setNudgeProduct] = useState<Product | null>(null);
  const [showSizeForm, setShowSizeForm] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [cartValue, setCartValue] = useState(0);
  const [cartToast, setCartToast] = useState<string | null>(null);
  const bottomRef                 = useRef<HTMLDivElement>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);

  // Conversation memory
  const shownHandles    = useRef<Set<string>>(new Set());
  const lastTopic       = useRef<string>("");
  const sizeAsked       = useRef(false);
  const memorySurfaced  = useRef(false);
  const lastLookPieces  = useRef<Product[]>([]);
  // ACTIVE PRODUCT — the single piece Mira most recently SHOWED or the shopper
  // landed on (PDP open, reco card, look anchor). This, NOT the PDP URL alone,
  // is what "it" means when the shopper types "add it" / "see it on me" /
  // "size it". Fixes the founder-reported bug: typed add-to-cart was grabbing
  // the landing product (or any) instead of the piece Mira just recommended,
  // because every route fell back to currentProduct() (the PDP) and never to
  // the conversation's actual subject.
  const activeProductHandle = useRef<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);

  // Active look memory, tracks outfit context for bundle add and closing intelligence
  const activeLook      = useRef<ActiveLookMemory>(emptyMemory());
  // Closing intelligence signals
  const sizeConfirmed   = useRef(false);
  const tryOnCompleted  = useRef(false);
  const tryOnAbandoned  = useRef(false);
  const outfitAccepted  = useRef(false);
  const outfitPieces    = useRef(0);

  // Always-current transcript for the async LLM closure (state would be stale).
  const messagesRef = useRef<ChatMsg[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ── Restore the conversation on mount (continuity across page navigation) ──
  // Each product page is a full reload on a Shopify storefront; without this the
  // transcript + memory reset on every click. We rehydrate from sessionStorage so
  // Mira remembers the whole visit. If a real conversation is restored we mark
  // "mira_opened" so the proactive nudge doesn't re-greet a mid-conversation
  // shopper. Runs once, synchronously, before the greeting effects below.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const snap = loadConvo();
    if (!snap) return;
    shownHandles.current = new Set(snap.shownHandles ?? []);
    lastTopic.current = snap.lastTopic ?? "";
    sizeAsked.current = snap.sizeAsked ?? false;
    // Seed the approached product from the snapshot so the re-approach effect
    // (which runs right after this on mount) can tell the shopper moved from the
    // last product to the current PDP across a full page reload — instead of
    // silently treating the new PDP as a fresh first approach.
    if (snap.lastProductHandle) approachedHandle.current = snap.lastProductHandle;
    lastLookPieces.current = (snap.lastLookHandles ?? [])
      .map((h) => catalog.find((p) => p.handle === h))
      .filter((p): p is Product => Boolean(p));
    if (snap.messages.length) {
      // PRODUCT-SWITCH NOTICE across a full reload (founder #3 "Mira doesn't notice
      // product switching"). Every PDP click reloads the page, so this — not the
      // SPA re-approach effect — is where a real switch is caught. If the shopper
      // moved to a different PDP than the conversation's last product, Mira opens
      // with a compare-aware line so she's never grounded on the stale piece.
      const curHandle = detectCurrentProductHandle();
      const cur = curHandle ? byHandle(curHandle) : null;
      const prev = snap.lastProductHandle ? byHandle(snap.lastProductHandle) : null;
      const switched = cur && prev && cur.handle !== prev.handle;
      let restoredMsgs = snap.messages;
      if (switched) {
        approachedHandle.current = cur.handle;
        activeProductHandle.current = cur.handle;
        const prevShort = prev.name.split(" ").slice(-1)[0];
        restoredMsgs = [...snap.messages,
          { from: "mira", kind: "context", product: cur, prevName: prev.name },
          { from: "mira", kind: "say", text: `Compare with the ${prevShort}, or style this one?`, quickReplies: [`Compare with the ${prevShort}`, "Style this", "Will it fit me?"] },
        ];
      }
      setMessages(restoredMsgs);
      setTurnCount(snap.turnCount ?? 0);
      setCartCount(snap.cartCount ?? 0);
      setCartValue(snap.cartValue ?? 0);
      // Mid-conversation shopper, don't fire the cold nudge again.
      try { sessionStorage.setItem("mira_opened", "1"); } catch { /* ignore */ }
      // Open when the panel was open OR when she just noticed a product switch
      // (so the notice is actually seen, not buried behind the launcher).
      if (snap.open || switched) setOpen(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist the conversation whenever it changes ──
  useEffect(() => {
    if (!restored.current) return; // don't clobber storage before the restore runs
    saveConvo({
      messages,
      shownHandles: Array.from(shownHandles.current),
      lastTopic: lastTopic.current,
      sizeAsked: sizeAsked.current,
      turnCount,
      lastLookHandles: lastLookPieces.current.map((p) => p.handle),
      cartCount,
      cartValue,
      open,
      lastProductHandle: approachedHandle.current ?? undefined,
    });
  }, [messages, turnCount, cartCount, cartValue, open]);

  // ── Admin session + knowledge base ───────────────────────────────────────
  // The demo analogue of production's admin-declared brand knowledge. Enter
  // admin mode with ?mira_admin=1 (persisted), then teach Mira facts she treats
  // as authoritative and grounds on from the very next turn.
  const [adminMode, setAdminMode]   = useState(false);
  const [kbOpen, setKbOpen]         = useState(false);
  const [kbEntries, setKbEntries]   = useState<KnowledgeEntry[]>([]);
  const [kbInput, setKbInput]       = useState("");
  const [kbBusy, setKbBusy]         = useState(false);
  const adminSecret = useRef<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("mira_admin") === "1") localStorage.setItem("mira_admin", "1");
    if (params.get("mira_admin") === "0") localStorage.removeItem("mira_admin");
    const secretParam = params.get("mira_admin_secret");
    if (secretParam) localStorage.setItem("mira_admin_secret", secretParam);
    adminSecret.current = localStorage.getItem("mira_admin_secret") ?? "";
    setAdminMode(localStorage.getItem("mira_admin") === "1");
  }, []);

  const loadKnowledge = useCallback(async () => {
    try {
      const res = await fetch(`${sqApi()}/api/mira/knowledge`, { cache: "no-store" });
      const data = (await res.json()) as { entries?: KnowledgeEntry[] };
      setKbEntries(data.entries ?? []);
    } catch { /* leave as-is on failure */ }
  }, []);

  useEffect(() => { if (kbOpen) void loadKnowledge(); }, [kbOpen, loadKnowledge]);

  const teachMira = useCallback(async () => {
    const text = kbInput.trim();
    if (text.length < 2 || kbBusy) return;
    setKbBusy(true);
    try {
      const res = await fetch(`${sqApi()}/api/mira/knowledge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminSecret.current ? { "x-mira-admin": adminSecret.current } : {}),
        },
        body: JSON.stringify({ text }),
      });
      if (res.ok) { setKbInput(""); await loadKnowledge(); }
    } catch { /* swallow, drawer stays open for retry */ }
    finally { setKbBusy(false); }
  }, [kbInput, kbBusy, loadKnowledge]);

  const forgetKnowledge = useCallback(async (id: string) => {
    try {
      await fetch(`${sqApi()}/api/mira/knowledge`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(adminSecret.current ? { "x-mira-admin": adminSecret.current } : {}),
        },
        body: JSON.stringify({ id }),
      });
      await loadKnowledge();
    } catch { /* swallow */ }
  }, [loadKnowledge]);

  const currentProduct = useCallback((): Product | null => {
    if (typeof window === "undefined") return null;
    const handle = detectCurrentProductHandle();
    return handle ? byHandle(handle) : null;
  }, []);

  // The storefront PDP "TRY-ON HERE" button (injected over the product image by
  // mira-demo.tsx) dispatches `stylique:open-tryon`, open the fitting room for
  // the piece on the page (fall back to a hero if the handle isn't in catalog).
  // This listener lived in the old widget-only MiraWidget; it MUST be here now
  // that this is the single source, or the storefront try-on button does nothing.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => {
      const real = currentProduct();
      if (real) { setTryOn(real); return; }
      // On a REAL storefront (ASSET_BASE set) NEVER fall back to the demo
      // catalog — opening the fitting room on onyx-silk-slip / catalog[0] would
      // show the wrong garment (not the merchant's product). If the PDP product
      // isn't registered yet, open Mira instead — her opener fetches the real
      // product and registers it, so the next try-on click works on the right
      // piece. The demo (ASSET_BASE === "") keeps its hero fallback.
      if (ASSET_BASE) { setOpen(true); return; }
      const p = catalog.find((x) => x.handle === "onyx-silk-slip") ?? catalog[0];
      if (p) setTryOn(p);
    };
    document.addEventListener("stylique:open-tryon", onOpen as EventListener);
    return () => document.removeEventListener("stylique:open-tryon", onOpen as EventListener);
  }, [currentProduct]);

  // PROACTIVE — size-chart behavior (founder #7: "observe ... size-chart
  // behavior"). When the shopper opens the PDP SIZE GUIDE, that's a fit-doubt
  // signal — Mira offers to size this exact piece. Once per product, never if she
  // already sized it. If the panel is open she drops the offer inline; if closed
  // she nudges. Listens for the native <details> `toggle` on a size disclosure.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onToggle = (e: Event) => {
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLDetailsElement) || !el.open) return;
      if (!/size\s*(guide|chart)/i.test(el.querySelector("summary")?.textContent ?? "")) return;
      const cp = currentProduct();
      if (!cp) return;
      if (recalledSize(cp.handle)) return; // already sized this piece
      const key = `mira_sizenudge_${cp.handle}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      activeProductHandle.current = cp.handle;
      if (open) {
        setMessages((prev) => [...prev, {
          from: "mira", kind: "say",
          text: `Checking sizes? Let me size the ${cp.name} for you.`,
          quickReplies: ["Size this one", "What's my size?", "I'm just looking"],
        }]);
      } else if (!sessionStorage.getItem("mira_opened")) {
        setNudgeProduct(cp);
        setNudge(true);
        window.setTimeout(() => setNudge(false), 9000);
      }
    };
    document.addEventListener("toggle", onToggle, true);
    return () => document.removeEventListener("toggle", onToggle, true);
  }, [open, currentProduct]);

  // Passive proactivity: a quiet nudge after real PDP dwell. Never auto-opens the
  // panel, never fires on home/collection pages.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("mira_opened")) return;
    if (sessionStorage.getItem("mira_nudged")) return;
    const onPdp = /\/products?\//.test(window.location.pathname);
    let fired = false;
    const fire = () => {
      if (fired) return;
      if (sessionStorage.getItem("mira_opened")) return;
      fired = true;
      sessionStorage.setItem("mira_nudged", "1");
      // On a PDP, pitch the REAL piece they're viewing (read fresh — hydration
      // may have landed after mount). Off-PDP (home/collection) leave it null →
      // the nudge shows a generic greeting, NEVER a random or demo product. This
      // is what stops "Onyx Silk Slip" (a demo piece) popping up on a live home page.
      setNudgeProduct(currentProduct());
      setNudge(true);
      setTimeout(() => setNudge(false), 11000);
    };
    // Engagement-weighted timing (panel rank 9): fire on real READING intent, 
    // the shopper has scrolled past ~40% of the page, instead of a blunt absolute
    // timer that interrupts fast browsers. A longer dwell is the fallback so a
    // shopper who lingers without scrolling still gets the approach.
    const onScroll = () => {
      const doc = document.documentElement;
      const depth = (window.scrollY + window.innerHeight) / (doc.scrollHeight || 1);
      if (depth > 0.4) fire();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const fallback = setTimeout(fire, onPdp ? 13000 : 18000);
    return () => { window.removeEventListener("scroll", onScroll); clearTimeout(fallback); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // RE-APPROACH ON NAVIGATION (founder: "when I go to another product it still
  // thinks I'm on the old one / doesn't pop up"). The one-time nudge above only
  // fires for the FIRST product; on every subsequent product the shopper opens,
  // Mira must notice. Keyed on the route: if the panel is OPEN she drops a fresh
  // line anchored on the new piece (so she always knows what you're looking at);
  // if it's CLOSED she re-approaches with a quiet nudge for the new product.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = detectCurrentProductHandle();
    // First run records the landing product — the initial approach / restored
    // conversation owns product #1. Only ACTUAL changes re-approach.
    if (approachedHandle.current === null) { approachedHandle.current = handle; return; }
    if (!handle || handle === approachedHandle.current) return;
    const prev = byHandle(approachedHandle.current);
    approachedHandle.current = handle;
    const p = byHandle(handle);
    if (!p) return;
    // The new PDP is now the conversation's active subject ("it" = this piece).
    activeProductHandle.current = handle;
    if (open) {
      // Mark the switch with a visual context card + a SHORT line (founder: "too
      // many words" + "differentiate new product with cards"). Lead with the
      // compare when we know the piece they came from.
      if (prev && prev.handle !== p.handle) {
        const prevShort = prev.name.split(" ").slice(-1)[0];
        setMessages((prev2) => [...prev2,
          { from: "mira", kind: "context", product: p, prevName: prev.name },
          { from: "mira", kind: "say", text: `Compare with the ${prevShort}, or style this one?`, quickReplies: [`Compare with the ${prevShort}`, "Style this", "Will it fit me?"] },
        ]);
      } else {
        setMessages((prev2) => [...prev2,
          { from: "mira", kind: "context", product: p },
          { from: "mira", kind: "say", text: "Want this styled, or sized?", quickReplies: ["Style this", "Size this one", "See it on me"] },
        ]);
      }
    } else if (!sessionStorage.getItem("mira_opened")) {
      setNudgeProduct(p);
      setNudge(true);
      window.setTimeout(() => setNudge(false), 9000);
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll that SURVIVES async layout shifts. A product card's image loads
  // AFTER the message mounts, growing the card's height, a single scroll fires
  // before that and leaves the new card hidden/overlapping below the fold (founder:
  // "Mira overlaps products and stops; it should go up and down automatically").
  // So we re-pin the bottom across a few frames: immediately, then again after the
  // image-driven reflow (~150ms / ~450ms). block:"end" keeps the latest in view.
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const pin = () => el.scrollIntoView({ behavior: "smooth", block: "end" });
    pin();
    // Re-pin across the image-driven reflow so a reco card never lands half below
    // the fold while its photo is still loading (founder: "image half open").
    const t1 = setTimeout(pin, 150);
    const t2 = setTimeout(pin, 460);
    const t3 = setTimeout(pin, 950);
    const t4 = setTimeout(pin, 1500);
    // Also re-pin the instant any image inside the scroll area finishes loading.
    const onImg = () => pin();
    const root = el.parentElement ?? document;
    root.querySelectorAll?.("img").forEach((im) => { if (!(im as HTMLImageElement).complete) im.addEventListener("load", onImg, { once: true }); });
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [messages, typing, showSizeForm]);
  useEffect(() => { if (cartToast) { const t = setTimeout(() => setCartToast(null), 3000); return () => clearTimeout(t); } }, [cartToast]);

  // Track shown products for memory + freshness.
  const remember = useCallback((msg: ChatMsg) => {
    if (msg.from === "mira" && msg.kind === "reco") {
      shownHandles.current.add(msg.reco.product.handle);
      // This is now the conversation's subject — "it" resolves here.
      activeProductHandle.current = msg.reco.product.handle;
      // Feed reco into active look memory
      activeLook.current = updateFromReco(activeLook.current, msg.reco.product.handle, null);
    }
    if (msg.from === "mira" && msg.kind === "look") {
      shownHandles.current.add(msg.look.anchor.handle);
      // The look's anchor becomes the active subject for "add it" / "size it".
      activeProductHandle.current = msg.look.anchor.handle;
      msg.look.pieces.forEach((p) => shownHandles.current.add(p.handle));
      // Keep the most recent look pieces so legacy bundle add-to-cart can grab them.
      lastLookPieces.current = msg.look.pieces;
      // Feed look card into active look memory (primary path)
      activeLook.current = updateFromLookCard(
        activeLook.current,
        msg.look.anchor.handle,
        msg.look.pieces.map((p) => p.handle),
      );
      outfitPieces.current = msg.look.pieces.length + 1;
    }
    if (msg.from === "mira" && msg.kind === "say" && msg.text.length > 10) {
      // Scan every Mira say-line for product mentions, feeds voice recommendations
      // into look memory even when no look card renders.
      const cp = typeof window !== "undefined"
        ? (window.location.pathname.match(/\/products?\/([^/?#]+)/)?.[1] ?? null)
        : null;
      activeLook.current = updateFromVoice(activeLook.current, msg.text, cp);
    }
  }, []);

  // Subtle memory: once a dominant palette emerges, name it (only once).
  const maybeSurfaceMemory = useCallback(() => {
    if (memorySurfaced.current) return null;
    if (shownHandles.current.size < 3) return null;
    const counts: Record<ColorFamily, number> = { dark: 0, neutral: 0, warm: 0, cool: 0 };
    shownHandles.current.forEach((h) => {
      const p = catalog.find((x) => x.handle === h);
      if (p?.colors[0]) counts[colorFamily(p.colors[0])]++;
    });
    const top = (Object.entries(counts) as [ColorFamily, number][]).sort((a, b) => b[1] - a[1])[0];
    if (top[1] < 3) return null;
    memorySurfaced.current = true;
    return { from: "mira", kind: "insight", label: "Style note", text: `You keep landing on ${FAMILY_LABEL[top[0]]} today, I'll lean into that unless you tell me otherwise.` } as ChatMsg;
  }, []);

  const openMira = useCallback((_trigger?: string, pdpProduct?: Product) => {
    setOpen(true);
    sessionStorage.setItem("mira_opened", "1");
    if (messages.length > 0) return;
    const cp = pdpProduct ?? currentProduct();
    const lastVisited = sessionStorage.getItem("mira_last_product");
    const isReturn = lastVisited && cp?.handle === lastVisited;

    let greeting: ChatMsg[];
    if (cp) {
      const known = recalledSize(cp.handle);
      greeting = known
        ? [
            // We've sized this exact piece before, recall it and move to closing.
            { from: "mira", kind: "say", text: isReturn ? `Back on the ${cp.name}, and you're a ${known} in this one — I remember.` : `That's the ${cp.name}, you're a ${known} in this one — I'll keep that while you're browsing.` },
            { from: "mira", kind: "say", text: "Want it in your bag, or shall I put it on you first?", quickReplies: ["Add to bag", "See it on me", "What goes with it?"] },
          ]
        : [
            { from: "mira", kind: "say", text: isReturn ? `Back on the ${cp.name}? It's a good one.` : contextualOpener(cp) },
            // Per-product sizing offered proactively, every piece is cut differently.
            { from: "mira", kind: "say", text: "Want me to size it? It's cut a little differently.", quickReplies: ["Size this one", "What goes with it?", "Is it right for me?"] },
          ];
    } else {
      greeting = [
        { from: "mira", kind: "say", text: "Hi, I'm Mira. I'll find you the right piece, not a hundred." },
        { from: "mira", kind: "say", text: "What's the vibe today — or dressing for something?", quickReplies: ["A vibe in mind", "For an occasion", "Just browsing"] },
      ];
    }
    if (cp) {
      sessionStorage.setItem("mira_last_product", cp.handle);
      // Landing on a PDP makes that piece the active subject until Mira shows
      // another — so "add it" on a fresh PDP adds THIS piece, not a stale reco.
      activeProductHandle.current = cp.handle;
    }
    greeting.forEach((msg, i) => setTimeout(() => { remember(msg); setMessages((prev) => [...prev, msg]); }, i * 1100));
  }, [messages.length, currentProduct, remember]);

  const addToBag = useCallback((p: Product) => {
    setCartCount((n) => n + 1);
    setCartValue((v) => v + p.priceUsd);
    setCartToast(p.name);
    // REAL Shopify cart (P0), on a live storefront this actually adds the variant
    // at the recalled size; on the demo it's a simulated success. Roll back the
    // optimistic count/value + tell the shopper if a REAL add fails (panel P2, 
    // don't show a phantom item in the bag). Demo (real:false) never rolls back.
    const rollback = () => {
      setCartCount((n) => Math.max(0, n - 1));
      setCartValue((v) => Math.max(0, v - p.priceUsd));
      setCartToast(`Couldn't add ${p.name}, tap to try again.`);
    };
    // Record the REAL conversion (the learning loop's honest bag-rate, D60),
    // a genuine SUCCESSFUL add, NOT Mira's offer and NOT a failed add. Founder
    // panel finding: previously we recorded BEFORE Shopify confirmed → failed
    // adds inflated conversion data. Now: only fire on real:true + ok:true.
    // The demo (real:false) records on success too because the demo cart is
    // simulated-success-by-design — there's no failure mode to lie about.
    void addToCart(p.handle, recalledSize(p.handle))
      .then((r) => {
        if (r && r.real && !r.ok) { rollback(); return; }
        void fetch(`${sqApi()}/api/mira/conversion`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productHandle: p.handle }),
        }).catch(() => {});
      })
      .catch(rollback);
    const newValue = cartValue + p.priceUsd;
    const gap = FREE_SHIPPING_THRESHOLD - newValue;
    const size = recalledSize(p.handle);
    // Free-shipping nudge, TAMED (panel rank 10): only when it genuinely applies,
    // the bag isn't already full (3+), and at most once per session, so it reads as
    // a helpful styling beat, not a mercenary push. Fires fast (600ms).
    const shipNudged = (() => { try { return !!sessionStorage.getItem("mira_ship_nudged"); } catch { return false; } })();
    if (gap > 0 && gap <= 250 && cartCount < 3 && !shipNudged) {
      try { sessionStorage.setItem("mira_ship_nudged", "1"); } catch { /* ignore */ }
      const ctx: MiraContext = { shownHandles: shownHandles.current, lastTopic: lastTopic.current, turnCount, sizeAsked: sizeAsked.current, cartValue: newValue, lastLookPieces: lastLookPieces.current };
      const nudgeMsgs = freeShippingNudge(newValue, ctx);
      if (nudgeMsgs) setTimeout(() => nudgeMsgs.forEach((m, i) => setTimeout(() => { remember(m); setMessages((prev) => [...prev, m]); }, i * 800)), 600);
    } else {
      // Post-add MOMENTUM (panel rank 11): own the moment instead of going quiet, 
      // name what landed + propose the next basket move (complete-the-look / try-on
      // / checkout) so the conversation keeps driving toward a bigger, better order.
      const landed = size ? `Grabbed the ${size}.` : `Added the ${p.name}.`;
      const momentum: ChatMsg = { from: "mira", kind: "say", text: `${landed} Want me to build the full look around it, or see it on you before you check out?`, quickReplies: ["Build the look", "See it on me", "Go to checkout"] };
      setTimeout(() => { remember(momentum); setMessages((prev) => [...prev, momentum]); }, 1400);
    }
  }, [cartValue, cartCount, turnCount, remember]);

  const addLook = useCallback((anchor: Product, pieces: Product[]) => {
    const all = [anchor, ...pieces];
    const lookTotal = all.reduce((s, p) => s + p.priceUsd, 0);
    setCartCount((n) => n + all.length);
    setCartValue((v) => v + lookTotal);
    setCartToast(`${all.length} pieces, ${anchor.name} look`);
    // REAL Shopify cart (P0), add the whole look in one /cart/add.js call. Roll
    // back the optimistic count/value on a REAL failure (panel P2). Demo no-ops.
    const rollbackLook = () => {
      setCartCount((n) => Math.max(0, n - all.length));
      setCartValue((v) => Math.max(0, v - lookTotal));
      setCartToast(`Couldn't add the look, tap to try again.`);
    };
    void addOutfitToCart(all.map((p) => ({ handle: p.handle, size: recalledSize(p.handle) })))
      .then((r) => {
        if (r && r.real && !r.ok) {
          rollbackLook();
          return;
        }
        // Record only after the complete bundle succeeds. Previously each item
        // was counted before Shopify confirmed the mutation, inflating assisted
        // conversion and hiding partial/failed adds.
        all.forEach((p) =>
          void fetch(`${sqApi()}/api/mira/conversion`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productHandle: p.handle }),
          }).catch(() => {}),
        );
      })
      .catch(rollbackLook);
  }, []);

  // Stream a batch of Mira cards into the transcript with natural pacing,
  // handling the studio/size/cart sentinels and the trailing memory note.
  const emitResponses = useCallback((responses: ChatMsg[]) => {
    responses.forEach((r, i) => {
      setTimeout(() => {
        if (r.from === "mira" && r.kind === "say") {
          if (r.text === SIZE_FORM_TRIGGER) {
            setShowSizeForm(true);
            // Record that a size form opened, feeds closing intelligence
            sizeAsked.current = true;
            return;
          }
          if (r.text.startsWith(TRYON_TRIGGER)) {
            const handle = r.text.slice(TRYON_TRIGGER.length);
            const p = catalog.find((x) => x.handle === handle) ?? currentProduct();
            if (p) {
              setTryOn(p);
              // Update shared try-on context so PDP component and Mira both see it
              const epoch = Math.floor(new Date().getTime() / 1000);
              updateTryOnCtxStatus("opened", epoch);
            }
            return;
          }
          if (r.text.startsWith(NAV_TRIGGER)) {
            const handle = r.text.slice(NAV_TRIGGER.length);
            if (typeof window !== "undefined" && handle) {
              // On the DEMO (same-origin) we auto-walk the shopper to the product
              // page. On the STOREFRONT (ASSET_BASE set) we do NOT auto-redirect, 
              // the recommended product may be a demo-catalog handle that isn't a
              // real product page on the merchant's store yet (→ 404). The reco
              // card is already shown in-widget (preview works); the card's "View
              // product" button lets the shopper navigate deliberately. This is a
              // safe interim until the storefront runs the merchant's own catalog.
              if (!ASSET_BASE) {
                sessionStorage.setItem("mira_opened", "1"); // keep panel state across nav
                setTimeout(() => { window.location.href = productUrl(handle); }, 650);
              }
            }
            return;
          }
        }
        if (r.from === "mira" && r.kind === "cart") {
          // Find the product by name to get its price for the cart value, check
          // the REAL merchant products first so the cart total is right on a live
          // store, not only for demo products (panel P1).
          const cartProduct = [...runtimeCatalog.values(), ...catalog].find((p) => p.name === r.productName);
          setCartCount((n) => n + 1);
          if (cartProduct) setCartValue((v) => v + cartProduct.priceUsd);
          setCartToast(r.productName);
          return;
        }
        remember(r);
        setMessages((prev) => [...prev, r]);
        if (i === responses.length - 1) {
          const mem = maybeSurfaceMemory();
          if (mem) setTimeout(() => setMessages((prev) => [...prev, mem]), 900);
        }
      }, i * 850);
    });
  }, [remember, maybeSurfaceMemory, currentProduct]);

  // CHECKOUT HANDOFF (conversion panel #1, the single biggest funnel leak). A
  // checkout intent must NAVIGATE to the register, not loop back as a chat turn.
  // On a live storefront that's Shopify's /cart; on the same-origin demo there's
  // no real cart page, so be honest and keep the momentum.
  const goToCheckout = useCallback(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as Record<string, unknown>;
    const onStore = !!w.Shopify || !!w.__sqAssetBase;
    // Payments-panel finding: was going to /cart not /checkout, so the
    // 3-second wallet-cliff (Shop Pay / Apple Pay / Google Pay) was never
    // exposed. Shopify accepts a direct GET on /checkout that preserves
    // the cart token; this is the express path. Fallback to /cart if the
    // theme intercepts /checkout.
    if (onStore) { window.location.href = "/checkout"; return; }
    setMessages((prev) => [...prev, { from: "mira", kind: "say", text: cartCount > 0 ? "Your bag's locked in, on your live store this takes you straight to checkout." : "Add a piece first and I'll walk you to checkout." }]);
  }, [cartCount]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    setInput("");
    setMessages((prev) => [...prev, { from: "user", kind: "say", text }]);
    const t = text.toLowerCase();

    // Checkout intent → navigate, never a chat round-trip (conversion panel #1).
    if (/^(go to |open |take me to )?(the )?(checkout|check ?out|cart|register)\b/.test(t) || /^(pay|place (my )?order|complete (my )?order|lock it in|let'?s check ?out)\b/.test(t)) {
      goToCheckout();
      return;
    }

    if (/^size me$/.test(t) || /^(size me for|size me up)/.test(t) || /^size this( one| piece)?$/.test(t)) {
      setShowSizeForm(true);
      const cp0 = currentProduct();
      const prior = loadBody();
      const line = prior
        ? "I've got your measurements, just confirm them below and I'll size this exact piece."
        : cp0
        ? `Quick measurements and I'll size the ${cp0.name} exactly, it's cut a little different from most.`
        : "Fill in your measurements below:";
      setTimeout(() => setMessages((prev) => [...prev, { from: "mira", kind: "say", text: line }]), 600);
      return;
    }

    const ctx: MiraContext = { shownHandles: shownHandles.current, lastTopic: lastTopic.current, turnCount, sizeAsked: sizeAsked.current, cartValue, lastLookPieces: lastLookPieces.current };
    // "it" = the conversation's active subject (last piece Mira showed / the PDP
    // landed on), falling back to the PDP only when nothing's been shown yet.
    // This is the single resolution that fixes add-to-cart / try-on / sizing all
    // pointing at the wrong (or any) product — cp now flows into the brain
    // request (currentProductHandle), the size compute, and applyDecision.
    const cp = byHandle(activeProductHandle.current ?? undefined) ?? currentProduct();
    setTyping(true);
    // Instant grounded interstitial + skeletons (panel rec #7), appears the same
    // frame the shopper sends, turning the long brain wait into anticipation.
    { const its = interstitialFor(text); setInterstitial(its.line || null); setSkeletons(its.skeletons); }
    setTurnCount((n) => n + 1);

    // Light session-memory cues (kept from the regex era so memory survives
    // even on the LLM path).
    if (/wedding/.test(t)) lastTopic.current = "wedding";
    else if (/evening|formal|gown|dinner|party|cocktail/.test(t)) lastTopic.current = "evening";
    else if (/coat|outerwear/.test(t)) lastTopic.current = "coat";
    else if (/everyday|casual|work/.test(t)) lastTopic.current = "everyday";
    else if (/denim|trouser|bottom|skirt/.test(t)) lastTopic.current = "bottoms";
    // Bundle intent detection: "add everything / add outfit / add the look / add all"
    if (/add.*(every|all|outfit|look|full|entire)|full.*look.*bag|entire.*look/i.test(t)) {
      lastTopic.current = "add_everything";
    }
    if (/size|sizing|fit|measure|height|weight/.test(t)) sizeAsked.current = true;

    // Build the conversation tail for grounding (user/mira say-lines only).
    const history = messagesRef.current
      .filter((m): m is Extract<ChatMsg, { kind: "say" }> => m.kind === "say" && m.text !== SIZE_FORM_TRIGGER)
      .slice(-8)
      .map((m) => ({ from: m.from, text: m.text }));

    const runFallback = () => {
      stopThinking();
      emitResponses(getMiraResponse(text, cp, ctx));
    };

    // Hybrid: stronger Gemini understands; our catalog engine grounds. On any
    // failure or missing key, fall through to the deterministic regex engine.
    // SESSION MEMORY (founder: "it asks me measurements again"). Once the shopper
    // has given a body this session, Mira NEVER re-asks. If she sized this exact
    // piece before, recall it; otherwise compute the size from the saved body
    // right here so a usable size always reaches the brain, and pass the body so
    // the prompt knows measurements are on file for EVERY piece, not just one.
    // If the shopper typed their measurements this turn, save them NOW so Mira
    // sizes directly instead of routing to a form for data she just got.
    captureBodyFromText(text);
    const savedBody = loadBody();
    const cpKnownSize = cp
      ? (recalledSize(cp.handle)
         ?? (savedBody ? recommendSizeForProduct(cp, { heightCm: savedBody.heightCm, weightKg: savedBody.weightKg, fitPref: savedBody.fitPref === "slim" ? "snug" : savedBody.fitPref }).size : null))
      : null;
    (async () => {
      try {
        const miraBody = JSON.stringify({
          message: text,
          currentProductHandle: cp?.handle ?? null,
          history,
          shownHandles: Array.from(shownHandles.current),
          knownSize: cpKnownSize,
          bodyOnFile: savedBody ? {
            heightCm: savedBody.heightCm, weightKg: savedBody.weightKg, fitPref: savedBody.fitPref,
            age: savedBody.age,
            usualBrandSize: savedBody.usualBrandSize,
          } : null,
          // ── Closing intelligence context ─────────────────────────────
          sizeConfirmed: sizeConfirmed.current,
          tryOnCompleted: tryOnCompleted.current,
          tryOnAbandoned: tryOnAbandoned.current,
          outfitAccepted: outfitAccepted.current,
          outfitPiecesRecommended: outfitPieces.current,
          cartItemCount: cartCount,
          // ── Active look summary for bundle-add and stylist context ───
          activeLookSummary: buildLookContextBlock(activeLook.current) || null,
          // ── Try-on context, Mira knows what happened in the fitting room ──
          tryOnContextSummary: getTryOnSummaryForMira(Math.floor(new Date().getTime() / 1000)) || null,
        });
        const postMira = (base: string) => fetch(`${base}/api/mira`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: miraBody,
        });
        // Consolidation P1.3: the storefront hits ONLY its own brain (the App Proxy
        // via sqApi()). On failure we go straight to the LOCAL regex engine, which is
        // grounded on the merchant's runtimeCatalog, we do NOT retry the demo brain
        // on ASSET_BASE, which would surface wrong/phantom DEMO products on a real
        // store (the dangerous fallback the journey trace flagged).
        const res = await postMira(sqApi());
        if (!res.ok) return runFallback();
        const data = (await res.json()) as { source: string; decision: MiraDecision | null; products?: RealProduct[]; look?: { pieces?: RealProduct[] } };
        stopThinking();
        // ONE-BACKEND: register the real per-tenant products this turn returned so
        // cards resolve to real merchant data via byHandle (no-op on the demo,
        // which returns none → hardcoded fallback).
        registerRealProducts(data.products);
        registerRealProducts(data.look?.pieces);
        if (data.decision) emitResponses(applyDecision(data.decision, cp, ctx));
        else emitResponses(getMiraResponse(text, cp, ctx));
      } catch {
        runFallback();
      }
    })();
  }, [turnCount, cartValue, currentProduct, emitResponses]);

  return (
    <>
      {/* Floating cart badge */}
      {cartCount > 0 && (
        <div style={{ position: "fixed", top: 24, right: 24, zIndex: 91, background: "var(--grad)", borderRadius: 999, padding: "6px 14px", display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.1em", color: "#0E0A14", boxShadow: "0 4px 16px rgba(139,92,246,0.4)", animation: "miraFadeUp 300ms ease both" }}>
          {/* P1-T04: honest demo-cart label. On the marketing demo (ASSET_BASE === "")
              add-to-cart is a SIMULATED success (storefront-cart.ts real:false); on a
              real storefront the badge reflects the real /cart/add.js cart and this
              pill is hidden. */}
          {!ASSET_BASE && (
            <span title="Simulated cart — no real checkout on the demo" style={{ background: "rgba(0,0,0,0.28)", borderRadius: 999, padding: "1px 7px", fontSize: 9, letterSpacing: "0.12em" }}>DEMO</span>
          )}
          <span>Bag</span>
          <span style={{ background: "rgba(0,0,0,0.2)", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>{cartCount}</span>
          <span>{money(cartValue)}</span>
        </div>
      )}

      {/* Cart toast */}
      {cartToast && (
        <div style={{ position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", zIndex: 95, animation: "miraFadeUp 250ms ease both", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ background: "rgba(14,10,20,0.95)", border: "1px solid rgba(78,196,158,0.4)", borderRadius: 12, padding: "10px 20px", display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--sans)", fontSize: 13, color: "#4EC49E", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", whiteSpace: "nowrap" }}>
            <span>✓</span><span><strong>{cartToast}</strong> added to bag</span>
          </div>
          {/* Express Checkout (Payments-panel finding): expose detected
              wallets right at the "just added" moment, the 3-second cliff.
              Each shortcut routes to /checkout; Shopify Checkout's wallet
              picker takes it from there. Components self-detect via
              useEffect so SSR + first paint stay flat — no flash. */}
          <ExpressCheckout />
        </div>
      )}

      {/* Floating dock */}
      <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 90, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
        {nudge && !open && (
          <button onClick={() => { setNudge(false); openMira("pdp-dwell", nudgeProduct ?? undefined); }} style={{ background: "#12101A", border: "1px solid rgba(139,92,246,0.4)", borderRadius: 14, padding: "11px 16px", fontFamily: "var(--sans)", fontSize: 13, color: "#F4F2EE", maxWidth: 240, lineHeight: 1.5, textAlign: "left", cursor: "pointer", animation: "miraFadeUp 400ms var(--ease-spring) both", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
            <em style={{ fontFamily: "var(--serif)", fontSize: 15 }}>Hi,</em>{" "}
            {nudgeProduct
              ? `that ${nudgeProduct.name} has caught a lot of eyes${nudgeProduct.lowStock ? ", and we're low on it" : ""}. Want my honest read, or shall I size it for you?`
              : "looking for something? Tell me the occasion and I'll find the one piece."}
          </button>
        )}
        {open ? (
          <button onClick={() => setOpen(false)} aria-label="Close Mira" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <MiraFace size={54} />
          </button>
        ) : (
          <MiraLauncher nudging={nudge} onOpen={() => openMira()} />
        )}
      </div>

      {/* Stylist sidebar, a side panel, never full-screen. The store stays visible. */}
      {open && (
        <div style={{ position: "fixed", bottom: 96, right: 28, zIndex: 89, width: "min(400px, calc(100vw - 40px))", maxHeight: "88dvh", background: "#12101A", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.7)", animation: "miraPanelIn 320ms var(--ease-spring) both" }}>
          {/* Header */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.02)" }}>
            <MiraFace size={38} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 16, lineHeight: 1.2 }}>Mira</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.22em", color: "#4EC49E", textTransform: "uppercase" }}>● Your stylist</div>
            </div>
            {cartCount > 0 && (
              // Persistent register door (conversion panel #1): the bag count IS the
              // checkout button, always one tap from paying, never a dead-end.
              <button onClick={goToCheckout} className="sq-mira-field" aria-label={`Checkout, ${cartCount} in bag`} data-stylique-checkout="1" style={{ background: "var(--grad)", border: "none", borderRadius: 999, padding: "6px 13px", fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#0E0A14", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                Checkout · {cartCount}
              </button>
            )}
            {adminMode && (
              <button onClick={() => setKbOpen((v) => !v)} title="Teach Mira, admin knowledge base" style={{ background: kbOpen ? "var(--grad)" : "rgba(78,196,158,0.12)", border: "1px solid rgba(78,196,158,0.4)", color: kbOpen ? "#0E0A14" : "#4EC49E", borderRadius: 999, padding: "5px 11px", fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                <span>✦</span> Teach
              </button>
            )}
            <button onClick={() => setOpen(false)} aria-label="Close Mira" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--mute)", width: 44, height: 44, borderRadius: "50%", fontSize: 18, cursor: "pointer", display: "grid", placeItems: "center" }}>×</button>
          </div>

          {/* Admin knowledge drawer, visible only in admin sessions */}
          {adminMode && kbOpen && (
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(78,196,158,0.04)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "46dvh", overflowY: "auto", scrollbarWidth: "none" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 14, color: "#F4F2EE" }}>Teach Mira</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "#4EC49E" }}>● Admin · grounds next turn</div>
              </div>
              <p style={{ fontFamily: "var(--sans)", fontSize: 11.5, lineHeight: 1.5, color: "var(--mute)", margin: 0 }}>
                Facts she treats as authoritative, a running sale, fabric provenance, sizing guidance, a styling rule. She weaves it in naturally and never contradicts it.
              </p>
              <textarea
                className="sq-mira-field"
                aria-label="Teach Mira a fact"
                value={kbInput}
                onChange={(e) => setKbInput(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void teachMira(); } }}
                maxLength={600}
                rows={3}
                placeholder="e.g. The Aria silk slip runs one size large, size down for a clean line."
                style={{ width: "100%", boxSizing: "border-box", resize: "vertical", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "9px 12px", color: "#F4F2EE", fontFamily: "var(--sans)", fontSize: 16, lineHeight: 1.5, outline: "none" }}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--mute)" }}>{kbInput.trim().length}/600 · ⌘↵ to save</span>
                <button onClick={() => void teachMira()} disabled={kbInput.trim().length < 2 || kbBusy} style={{ background: kbInput.trim().length >= 2 && !kbBusy ? "var(--grad)" : "rgba(255,255,255,0.08)", color: kbInput.trim().length >= 2 && !kbBusy ? "#0E0A14" : "var(--mute)", border: "none", borderRadius: 999, padding: "7px 16px", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", cursor: kbInput.trim().length >= 2 && !kbBusy ? "pointer" : "default" }}>{kbBusy ? "Saving…" : "Teach Mira"}</button>
              </div>
              {kbEntries.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--mute)" }}>Mira knows ({kbEntries.length})</div>
                  {kbEntries.map((e) => (
                    <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "8px 10px" }}>
                      <span style={{ flex: 1, fontFamily: "var(--sans)", fontSize: 12, lineHeight: 1.5, color: "#E8E5DF" }}>{e.text}</span>
                      <button onClick={() => void forgetKnowledge(e.id)} title="Forget this" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--mute)", width: 22, height: 22, borderRadius: "50%", fontSize: 12, cursor: "pointer", flexShrink: 0, display: "grid", placeItems: "center", lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Editorial feed */}
          {/* aria-live='polite' + role='log' ensures screen readers announce new Mira messages (WCAG SC 4.1.3) */}
          <div role="log" aria-live="polite" aria-label="Mira conversation" data-stylique-widget="1" style={{ flex: 1, overflowY: "auto", padding: "18px 14px", display: "flex", flexDirection: "column", gap: 12, scrollbarWidth: "none" }}>
            {(() => {
              // Only the LATEST chip-bearing message shows its quick-replies.
              // Past assistant bubbles keep their text but drop the clickable
              // chips — otherwise every prior turn's chips stack + repeat (e.g.
              // "What's it made of?" reappearing), which read as a chatbot loop.
              let lastChipIdx = -1;
              for (let k = messages.length - 1; k >= 0; k--) {
                const mm = messages[k] as { quickReplies?: string[] };
                if (mm.quickReplies && mm.quickReplies.length) { lastChipIdx = k; break; }
              }
              return messages.map((msg, i) => {
              if (msg.from === "user") {
                return (
                  <div key={i} style={{ alignSelf: "flex-end", maxWidth: "80%", background: "rgba(139,92,246,0.16)", border: "1px solid rgba(139,92,246,0.24)", borderRadius: 12, padding: "9px 14px", fontFamily: "var(--sans)", fontSize: 14.5, lineHeight: 1.5, color: "#F4F2EE" }}>{msg.text}</div>
                );
              }
              if (msg.kind === "reco") return <RecoCard key={i} reco={msg.reco} onTryOn={(p) => setTryOn(p)} onAddToBag={addToBag} />;
              if (msg.kind === "look") return <LookCard key={i} look={msg.look} onTryOn={(p) => setTryOn(p)} onAddLook={addLook} />;
              if (msg.kind === "insight") return (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <InsightCard label={msg.label} text={msg.text} />
                  {i === lastChipIdx && msg.quickReplies && <QuickReplies replies={msg.quickReplies} onPick={sendMessage} />}
                </div>
              );
              if (msg.kind === "cart") return <CartLine key={i} productName={msg.productName} />;
              if (msg.kind === "context") return <ContextCard key={i} product={msg.product} prevName={msg.prevName} />;
              // say, each Mira line gets its own bubble so two messages never
              // read as one run-on block.
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ alignSelf: "flex-start", maxWidth: "90%", background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "4px 14px 14px 14px", padding: "11px 15px", fontFamily: "var(--sans)", fontSize: 15.5, lineHeight: 1.5, color: "#F4F2EE" }}>{renderText(msg.text)}</div>
                  {i === lastChipIdx && msg.quickReplies && <QuickReplies replies={msg.quickReplies} onPick={sendMessage} />}
                </div>
              );
              });
            })()}

            {showSizeForm && (
              <SizeForm
                product={byHandle(activeProductHandle.current ?? undefined) ?? currentProduct()}
                onResult={(label, text, replies, size, handle) => {
                  setShowSizeForm(false);
                  if (size && handle) {
                    rememberSize(handle, size);
                    sizeConfirmed.current = true; // feed closing intelligence
                  }
                  setTimeout(() => setMessages((prev) => [
                    ...prev,
                    { from: "mira", kind: "insight", label, text },
                    { from: "mira", kind: "say", text: size ? `That's your size in this one — I'll keep it for this session. Want it in your bag, or on you first?` : "Want me to take it from here?", quickReplies: replies },
                  ]), 300);
                }}
              />
            )}

            {typing && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "2px 0" }}>
                {/* Instant grounded "pull" line (panel rec #7) */}
                {interstitial && (
                  <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "#CFCBD6", display: "flex", gap: 6, alignItems: "center", animation: "miraFadeUp 240ms ease both" }}>
                    <span>{interstitial}</span>
                    <span style={{ display: "inline-flex", gap: 3 }}>
                      {[0, 1, 2].map((d) => <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--mute)", animation: `miraTypeDot 1s ${d * 0.2}s ease-in-out infinite` }} />)}
                    </span>
                  </div>
                )}
                {/* Shimmer skeleton cards while the look resolves */}
                {skeletons > 0 && (
                  <div style={{ display: "flex", gap: 8 }}>
                    {Array.from({ length: skeletons }).map((_, i) => (
                      <div key={i} style={{ flex: 1, borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", animation: `miraFadeUp 280ms ${i * 60}ms ease both` }}>
                        <div style={{ aspectRatio: "3/4", background: "linear-gradient(100deg, rgba(255,255,255,0.04) 30%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.04) 70%)", backgroundSize: "200% 100%", animation: "miraShimmer 1.3s linear infinite" }} />
                        <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ height: 8, width: "80%", borderRadius: 4, background: "linear-gradient(100deg, rgba(255,255,255,0.05) 30%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.05) 70%)", backgroundSize: "200% 100%", animation: "miraShimmer 1.3s linear infinite" }} />
                          <div style={{ height: 8, width: "45%", borderRadius: 4, background: "linear-gradient(100deg, rgba(255,255,255,0.05) 30%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.05) 70%)", backgroundSize: "200% 100%", animation: "miraShimmer 1.3s linear infinite" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!interstitial && skeletons === 0 && (
                  <div style={{ display: "flex", gap: 4, padding: "4px 2px", alignItems: "center" }}>
                    {[0, 1, 2].map((d) => <span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mute)", animation: `miraTypeDot 1s ${d * 0.2}s ease-in-out infinite` }} />)}
                  </div>
                )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} style={{ padding: "10px 14px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8 }}>
            {/* fontSize:16 prevents iOS Safari auto-zoom on focus (panel P1) */}
            <input ref={inputRef} className="sq-mira-field" aria-label="Message Mira" data-stylique-input="1" inputMode="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Tell Mira what you're after…" style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 999, padding: "10px 16px", color: "#F4F2EE", fontFamily: "var(--sans)", fontSize: 16, outline: "none" }} />
            <button type="submit" aria-label="Send message" data-stylique-send="1" disabled={!input.trim()} style={{ width: 44, height: 44, borderRadius: "50%", background: input.trim() ? "var(--grad)" : "rgba(255,255,255,0.08)", border: "none", cursor: input.trim() ? "pointer" : "default", color: input.trim() ? "#0E0A14" : "var(--mute)", fontSize: 18, display: "grid", placeItems: "center", transition: "all 200ms", flexShrink: 0 }}>↑</button>
          </form>
        </div>
      )}

      {tryOnProduct && (
        <TryOnPanel
          product={tryOnProduct}
          catalogProducts={activeProducts()}
          trigger="mira_suggest"
          onRenderComplete={(imageUrl) => {
            const epoch = Math.floor(new Date().getTime() / 1000);
            tryOnCompleted.current = true;
            tryOnAbandoned.current = false;
            updateTryOnCtxStatus("completed", epoch, imageUrl);
          }}
          onRenderFailed={(errorCode) => {
            const epoch = Math.floor(new Date().getTime() / 1000);
            updateTryOnCtxStatus("failed", epoch, undefined, errorCode);
          }}
          onClose={() => {
            const epoch = Math.floor(new Date().getTime() / 1000);
            if (tryOnCompleted.current) {
              updateTryOnCtxStatus("completed", epoch);
            } else {
              tryOnAbandoned.current = true;
              updateTryOnCtxStatus("abandoned", epoch);
            }
            setTryOn(null);
          }}
        />
      )}

      <style>{`
        @keyframes miraFadeUp   { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
        @keyframes miraPanelIn  { from { opacity:0; transform:translateY(24px) scale(0.97) } to { opacity:1; transform:translateY(0) scale(1) } }
        @keyframes miraBounce   { from { transform:translateY(0) } to { transform:translateY(-6px) } }
        @keyframes miraRingSpin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        @keyframes miraTypeDot  { 0%,80%,100% { transform:scale(1); opacity:.5 } 40% { transform:scale(1.4); opacity:1 } }
        @keyframes miraShimmer  { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
        @keyframes miraFloat    { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-7px) } }
        @keyframes miraPulse    { 0%,100% { opacity:1; transform:scale(1) } 50% { opacity:.55; transform:scale(0.85) } }
        /* Visible keyboard focus indicator (WCAG 2.4.7) for Mira's inputs +
           clickable product card, scoped to .sq-mira-field so it never leaks
           onto the merchant theme. Only shows for keyboard nav (:focus-visible). */
        .sq-mira-field:focus-visible { outline: 2px solid rgba(139,92,246,0.95) !important; outline-offset: 2px; border-radius: 10px; }
        /* ── Max-interactive reco card ─────────────────────────────────────
           Layered: 3D pointer-tilt + cursor-following glow + image parallax
           counter-shift + spring entrance + magnetic press feedback. Driven
           by CSS vars (--sq-mx, --sq-my, --sq-gx, --sq-gy) set inline by the
           card's onPointerMove handler. All effects bypassed cleanly on
           touch + reduced-motion via the media queries below. */
        @keyframes sqRecoEntrance {
          from { opacity: 0; transform: translateY(14px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .sq-reco-card {
          position: relative;
          transform-style: preserve-3d;
          transition: transform 380ms cubic-bezier(0.18, 0.9, 0.28, 1.06),
                      box-shadow 380ms ease,
                      border-color 380ms ease;
          will-change: transform;
          animation: sqRecoEntrance 520ms cubic-bezier(0.18, 0.9, 0.28, 1.06) both;
        }
        .sq-reco-card:hover {
          transform:
            perspective(900px)
            translateY(-5px)
            rotateY(calc(var(--sq-mx, 0) * 5deg))
            rotateX(calc(var(--sq-my, 0) * -5deg));
          box-shadow: 0 28px 64px rgba(0, 0, 0, 0.62),
                      0 0 0 1px rgba(139, 92, 246, 0.18) inset;
          border-color: rgba(139, 92, 246, 0.5);
        }
        .sq-reco-card:active {
          transform:
            perspective(900px)
            translateY(-2px)
            scale(0.992)
            rotateY(calc(var(--sq-mx, 0) * 3deg))
            rotateX(calc(var(--sq-my, 0) * -3deg));
          transition-duration: 90ms;
        }
        /* Cursor-following glow as a pseudo-element on top, blend-mode soft */
        .sq-reco-card::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          opacity: 0;
          transition: opacity 380ms ease;
          background: radial-gradient(
            340px circle at var(--sq-gx, 50%) var(--sq-gy, 50%),
            rgba(139, 92, 246, 0.22),
            rgba(139, 92, 246, 0.06) 28%,
            transparent 60%
          );
          mix-blend-mode: screen;
          z-index: 2;
        }
        .sq-reco-card:hover::after { opacity: 1; }
        /* Image zoom + counter-shift parallax (depth illusion) */
        .sq-reco-card__img img {
          transition: transform 760ms cubic-bezier(0.16, 1, 0.3, 1);
          will-change: transform;
        }
        .sq-reco-card:hover .sq-reco-card__img img {
          transform:
            scale(1.07)
            translate3d(
              calc(var(--sq-mx, 0) * -8px),
              calc(var(--sq-my, 0) * -6px),
              0
            );
        }
        /* Top-left low-stock and top-right match badge get a tiny float for depth */
        .sq-reco-card:hover .sq-reco-card__img > div { transform: translateZ(20px); }
        .sq-reco-card .sq-reco-card__img > div { transition: transform 380ms ease; }
        /* Touch: drop all hover-driven effects (Safari quirks + tap-on-hover) */
        @media (hover: none) {
          .sq-reco-card:hover,
          .sq-reco-card:active {
            transform: none;
            box-shadow: 0 14px 34px rgba(0, 0, 0, 0.42);
          }
          .sq-reco-card::after { display: none; }
          .sq-reco-card:hover .sq-reco-card__img img { transform: none; }
          .sq-reco-card:hover .sq-reco-card__img > div { transform: none; }
        }
        .sq-mira-launch { transition: transform 220ms var(--ease-spring), box-shadow 220ms ease; }
        .sq-mira-launch:hover { transform: translateY(-4px) scale(1.02); box-shadow: 0 24px 60px rgba(139,92,246,0.4); }
        .sq-mira-launch:active { transform: translateY(-1px) scale(0.99); }
        @media (hover: none) { .sq-mira-launch:hover { transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .sq-mira-launch { animation: none !important; }
          .sq-mira-launch:hover { transform: none; }
          /* Kill ALL looping animations in the widget (panel P0 accessibility) */
          *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
        }
      `}</style>
    </>
  );
}

// ── Small components / helpers ─────────────────────────────────────────────────
function QuickReplies({ replies, onPick }: { replies: string[]; onPick: (r: string) => void }) {
  // Defensive: never show duplicate chips, and never more than 3 (the brain
  // already caps at 3, this guards any path that doesn't).
  const shown = [...new Set(replies.map((r) => r.trim()).filter(Boolean))].slice(0, 3);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {shown.map((r) => (
        <button key={r} onClick={() => onPick(r)} style={quickReplyStyle()}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(139,92,246,0.15)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >{r}</button>
      ))}
    </div>
  );
}
function CartLine({ productName }: { productName: string }) {
  return (
    <div style={{ background: "rgba(78,196,158,0.1)", border: "1px solid rgba(78,196,158,0.3)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--sans)", fontSize: 13, color: "#4EC49E" }}>
      <span style={{ fontSize: 18 }}>✓</span><span><strong>{productName}</strong> added to bag</span>
    </div>
  );
}
function quickReplyStyle(): React.CSSProperties {
  // Sans, not mono: the monospace read like terminal code against an elegant
  // fashion brand. A soft-filled pill in the brand sans, near-natural casing, reads
  // like something a stylist would offer, not a CLI prompt.
  return { padding: "8px 14px", background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 999, fontFamily: "var(--sans)", fontSize: 12.5, fontWeight: 500, letterSpacing: "0.005em", color: "rgba(244,242,238,0.92)", cursor: "pointer", transition: "all 150ms" };
}
function renderText(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) => part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}
