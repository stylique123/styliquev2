// ─── Mira brain — complete-the-look engine ──────────────────────────────────
// The full styling algorithm (colour harmony + category affinity + formality +
// season + proportion + desirability/impulse + palette coherence) and buildLook,
// extracted VERBATIM from apps/web/lib/catalog.ts over MiraProduct. Pure: no I/O,
// no demo data. Both the demo route and the Shopify adapter get identical look
// pairings. (The demo-catalog `= products` default param was dropped — buildLook
// always receives the active catalog; bodyZone got a default for unknown
// production categories.)
import type { MiraProduct } from "./products.js";

export function colorHex(name: string): string {
  const n = name.toLowerCase();
  if (/onyx|black|ink|midnight/.test(n)) return "#0E0B14";
  if (/ivory|bone|oat/.test(n))          return "#EBE5D8";
  if (/camel/.test(n))                   return "#B08A5C";
  if (/stone/.test(n))                   return "#9A958A";
  if (/charcoal/.test(n))                return "#3A3A40";
  if (/champagne/.test(n))               return "#D4BE94";
  if (/cognac/.test(n))                  return "#7C4A2C";
  if (/indigo/.test(n))                  return "#1F2D52";
  if (/espresso/.test(n))                return "#3A2418";
  if (/cardinal/.test(n))                return "#8B1E2C";
  return "#888";
}

/** Warm/cool undertone of a named color.
 *  Returns  1 = warm undertone (camel, champagne, cognac, espresso, cream, etc.)
 *           -1 = cool undertone (stone, charcoal, ink, slate, ash)
 *            0 = truly neutral / pure (onyx, black, bone, oat, white, grey/gray)
 */
function warmth(name: string): -1 | 0 | 1 {
  const n = name.toLowerCase();
  if (/camel|champagne|cognac|espresso|ivory|cream|sand|tan|nude|blush|rust|terracotta|copper/.test(n)) return 1;
  if (/stone|charcoal|ink|slate|ash/.test(n)) return -1;
  // onyx, black, bone, oat, white, grey, gray, pure neutral
  return 0;
}

/** Warmth-adjustment for a pair of color names.
 *  Only applies when BOTH colors are neutrals (low-saturation / extreme lightness).
 *  A warm+cool clash between two neutrals should score LOWER than a tonal warm+warm pairing.
 */
function warmthScore(nameA: string, nameB: string): number {
  const hslA = hexToHsl(colorHex(nameA));
  const hslB = hexToHsl(colorHex(nameB));
  if (!isNeutral(hslA) || !isNeutral(hslB)) return 0; // only affects neutral pairings
  const wA = warmth(nameA);
  const wB = warmth(nameB);
  if (wA === 1 && wB === 1) return 0.04;  // warm + warm tonal bonus
  if (wA === -1 && wB === -1) return 0.02; // cool + cool tonal bonus (slightly less cohesive)
  if ((wA === 1 && wB === -1) || (wA === -1 && wB === 1)) return -0.06; // warm/cool clash penalty
  // one pure + one warm/cool → slight bonus (clean pairing)
  if (wA === 0 || wB === 0) return 0.02;
  return 0;
}

// ── Per-colorway product imagery ─────────────────────────────────────────────
// Each product is photographed in its first (index 0) color. Alternate colors
// are real AI-recolored renders of the SAME shot, same model, pose, lighting,
// background; only the garment color changes (no blend-mode tint). Files live at
// /products/<handle>-<colorslug>.png. This set is the source of truth so the
// gallery never points at a render that doesn't exist.

type Hsl = { h: number; s: number; l: number };

function hexToHsl(hex: string): Hsl {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s, l };
}

/** A color reads as "neutral" (goes with everything) when it's barely saturated,
 *  or very dark/very light, i.e. the blacks, ivories, stones, charcoals. */
function isNeutral(c: Hsl): boolean {
  return c.s < 0.18 || c.l < 0.12 || c.l > 0.86;
}

export type HarmonyType =
  | "monochromatic"
  | "analogous"
  | "complementary"
  | "triadic"
  | "neutral"
  | "accent"
  | "contrast";

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Score a single pair of resolved colors + name the harmony relationship.
 *
 * Real colour theory, tuned for CONVERSION, the combinations a stylist reaches
 * for because they sell, not just because they're "fine". The old version scored
 * EVERY neutral pairing a flat 0.9, so in a neutral-heavy catalogue colour theory
 * never differentiated anything. Now the scale separates the boring-but-safe from
 * the genuinely impulse-triggering:
 *   • two neutrals        → safe, sophisticated, but the LEAST exciting (0.78, 0.84)
 *   • neutral + a colour  → the "pop of colour on a neutral base": the single most
 *                           stylist-approved, highest-converting combo (0.90, 0.98),
 *                           scaled by how vividly the accent pops
 *   • complementary       → high-impact, eye-catching → drives impulse (0.93)
 *   • monochromatic       → tonal, refined (0.95)
 *   • analogous           → harmonious, easy to wear (0.90)
 *   • triadic / contrast   → considered / clashing (0.72 / 0.48)
 */
function pairColorHarmony(a: Hsl, b: Hsl): { score: number; type: HarmonyType } {
  const aN = isNeutral(a);
  const bN = isNeutral(b);
  // BOTH neutral, the connective tissue of a wardrobe: safe and refined, but the
  // least impulse-driving. Tonal neutrals (close in lightness) read more intentional
  // than a hard light/dark split, so reward the tonal pairing slightly more.
  if (aN && bN) {
    const lGap = Math.abs(a.l - b.l);
    return { score: lGap < 0.45 ? 0.84 : 0.79, type: "neutral" };
  }
  // ONE neutral + ONE saturated colour, the classic "pop of colour on a neutral
  // base". The highest-converting, most impulse-triggering pairing there is; the
  // more vivid the accent, the harder it pops, so scale 0.90 → 0.98 by saturation.
  if (aN || bN) {
    const accent = aN ? b : a;
    const pop = Math.max(0, Math.min(1, (accent.s - 0.18) / 0.62));
    return { score: 0.9 + 0.08 * pop, type: "accent" };
  }
  // TWO saturated colours, classic colour-wheel relationships, scored by IMPACT.
  const gap = hueGap(a.h, b.h);
  if (gap <= 18) return { score: 0.95, type: "monochromatic" };
  if (gap <= 50) return { score: 0.9, type: "analogous" };
  if (gap >= 150 && gap <= 210) return { score: 0.93, type: "complementary" };
  if (gap >= 100 && gap < 150) return { score: 0.72, type: "triadic" };
  return { score: 0.48, type: "contrast" };
}

/** Best color relationship between two products across their colorways, the
 *  shopper can always pick the matching colorway, so the best pairing wins. */
export function analyzeColorHarmony(
  colorsA: string[],
  colorsB: string[],
): { score: number; type: HarmonyType } {
  let best = { score: 0, type: "contrast" as HarmonyType };
  for (const a of colorsA) {
    for (const b of colorsB) {
      const r = pairColorHarmony(hexToHsl(colorHex(a)), hexToHsl(colorHex(b)));
      r.score = Math.min(1, Math.max(0, r.score + warmthScore(a, b)));
      if (r.score > best.score) best = r;
    }
  }
  return best;
}

//, 2/3/4. What-suits-what: category complement, formality, season, , , , , , 

type BodyZone = "upper" | "lower" | "full" | "layer" | "accent";

function bodyZone(cat: MiraProduct["category"]): BodyZone {
  switch (cat) {
    case "top":
    case "knitwear":   return "upper";
    case "bottom":     return "lower";
    case "dress":      return "full";
    case "outerwear":  return "layer";
    case "accessory":  return "accent";
    // Unknown production categories (Shopify productType outside the demo union)
    // read as a neutral accent so they pair loosely rather than force a slot.
    default:           return "accent";
  }
}

/** How naturally two garments combine into one worn outfit (0, 1). */
function categoryAffinity(a: MiraProduct, b: MiraProduct): number {
  const za = bodyZone(a.category);
  const zb = bodyZone(b.category);
  const pair = new Set([za, zb]);
  const has = (x: BodyZone, y: BodyZone) => pair.has(x) && pair.has(y);

  if (has("upper", "lower")) return 1.0;          // top + bottom = the core outfit
  if (has("full", "layer")) return 0.96;          // dress + coat/blazer
  if (has("full", "accent")) return 0.84;         // dress + accessory
  if (has("lower", "layer")) return 0.9;          // trouser + coat
  if (has("upper", "layer")) return 0.88;         // knit/top + coat
  if (has("lower", "accent")) return 0.7;
  if (has("upper", "accent")) return 0.7;
  if (has("full", "upper") || has("full", "lower")) return 0.25; // dress doesn't need either
  if (za === "layer" && zb === "layer") return 0.3;  // two coats compete
  if (za === "upper" && zb === "upper") return 0.4;  // two tops, layerable but rarely
  if (za === "lower" && zb === "lower") return 0.15; // two bottoms, never
  if (za === "full" && zb === "full") return 0.12;   // two dresses, never
  return 0.5;
}

/** Dress-code reading per piece (0 casual → 1 black-tie), from fabric + collection. */
function formalityOf(p: MiraProduct): number {
  const f = p.fabricComposition.toLowerCase();
  if (p.collection === "evening") return 0.92;
  if (/linen/.test(f)) return 0.32;
  if (/denim|selvedge/.test(f)) return 0.28;
  if (/leather/.test(f)) return 0.62;
  if (p.collection === "tailoring") return 0.72;
  if (/satin|charmeuse|silk/.test(f)) return 0.7;
  if (p.collection === "knitwear") return 0.5;
  if (p.collection === "outerwear") return 0.6;
  return 0.5;
}

/** Seasonal warmth per piece (0 high-summer → 1 deep-winter), from fabric. */
function seasonOf(p: MiraProduct): number {
  const f = p.fabricComposition.toLowerCase();
  if (/linen/.test(f)) return 0.12;
  if (/cashmere|merino|virgin wool|wool/.test(f)) return 0.85;
  if (/leather/.test(f)) return 0.7;
  if (/denim|cotton/.test(f)) return 0.45;
  if (/satin|charmeuse|silk|crepe/.test(f)) return 0.42;
  return 0.5;
}

//, 5. Silhouette / proportion, , , , , , , , , , , , , , , , , , , , , , , , 
// The oldest rule in styling: balance volume with closeness. A wide-leg trouser
// wants a fitted top; an oversized coat wants a slim base. Infer each piece's
// silhouette from its fit notes + name + description: −1 = close/fitted,
// +1 = voluminous/relaxed, 0 = regular.
const VOLUMINOUS = /\b(relaxed|oversize|oversized|wide|wide-leg|wide leg|boxy|loose|fluid|draped|drape|voluminous|slouch|slouchy|billow|a-line|flowy|flowing|generous|baggy|full)\b/;
const FITTED = /\b(fitted|slim|tailored|bias|bias-cut|skinny|cropped|close|body-?con|sleek|narrow|tapered|structured|sharp)\b/;
function silhouetteOf(p: MiraProduct): number {
  const t = `${p.fitNotes} ${p.name} ${p.description}`.toLowerCase();
  let v = 0;
  if (VOLUMINOUS.test(t)) v += 1;
  if (FITTED.test(t)) v -= 1;
  // accessories are silhouette-neutral
  if (p.category === "accessory") return 0;
  return Math.max(-1, Math.min(1, v));
}

/** How well two pieces balance in proportion (0, 1). Volume + fit = textbook;
 *  two voluminous (or two very fitted) pieces fight each other. */
function proportionScore(a: MiraProduct, b: MiraProduct): number {
  const sa = silhouetteOf(a);
  const sb = silhouetteOf(b);
  const prod = sa * sb;
  if (prod < -0.15) return 1.0;                                   // fitted + relaxed = textbook balance (the ideal)
  if (Math.abs(sa) < 0.2 && Math.abs(sb) < 0.2) return 0.74;      // both regular = safe but flat, no movement
  if (Math.abs(sa) < 0.2 || Math.abs(sb) < 0.2) return 0.85;      // one regular anchoring a shaped piece = good
  if (prod > 0.25) return 0.4;                                    // both voluminous / both tight = clash
  return 0.7;
}

//, 6. Desirability (real signal, never invented), , , , , , , , , , , , , , , 
// keepRate = % of shoppers who kept their recommended size = a real proxy for
// "this piece delivers / people want it". Used as a gentle tie-breaker so the
// top pick is also something shoppers actually love, not just a color match.
function desirabilityOf(p: MiraProduct): number {
  return typeof p.keepRate === "number" ? Math.max(0, Math.min(1, p.keepRate)) : 0.7;
}

//, 6b. Impulse-add likelihood (the conversion math), , , , , , , , , , , , , 
// A recommendation only converts on impulse if adding it feels frictionless. A
// complementary piece priced at or below the anchor is an easy "yes, add it"; a
// piece far pricier is a separate, deliberated purchase, not an impulse add. This
// is the price-elasticity half of "most likely to be bought TOGETHER", paired with
// keepRate (do people love it) and colour impact (does the combo catch the eye).
function impulseAddScore(anchor: MiraProduct, cand: MiraProduct): number {
  const ratio = cand.priceUsd / Math.max(1, anchor.priceUsd);
  if (ratio <= 1) return 1.0;     // same or cheaper, frictionless add-on
  if (ratio <= 1.4) return 0.85;  // a little more, still an easy yes
  if (ratio <= 2) return 0.6;     // noticeably pricier, some hesitation
  return 0.42;                    // a major second purchase, rarely impulse
}

//, 7. Palette coherence across a whole worn set, , , , , , , , , , , , , , , 
// A great outfit reads as a neutral base + AT MOST one hero colour. Count the
// saturated (non-neutral) pieces the set would have with `cand` added: 0, 1
// accents is clean, 2 is okay only if they harmonise, 3+ is busy.
function paletteCoherence(worn: MiraProduct[], cand: MiraProduct): number {
  const all = [...worn, cand];
  const accents = all.filter((p) => {
    const c = hexToHsl(colorHex(p.colors[0] ?? "#808080"));
    return !isNeutral(c);
  });
  if (accents.length <= 1) return 1.0;
  if (accents.length === 2) {
    const h = analyzeColorHarmony(accents[0].colors, accents[1].colors);
    return h.type === "monochromatic" || h.type === "analogous" || h.type === "complementary" ? 0.78 : 0.42;
  }
  return 0.3; // three+ competing colours, busy
}

export type LookEntry = {
  product: MiraProduct;
  score: number;        // 0, 1 overall
  harmonyType: HarmonyType;
  reason: string;       // one honest human sentence (no invented facts)
};

const HARMONY_PHRASE: Record<HarmonyType, string> = {
  monochromatic: "tonal with",
  analogous:     "sits in the same palette as",
  complementary: "plays off",
  triadic:       "adds a considered contrast to",
  neutral:       "is a clean neutral against",
  accent:        "brings a pop of colour to",
  contrast:      "is a bold contrast to",
};

function zoneVerb(a: MiraProduct, b: MiraProduct): string {
  const af = categoryAffinity(a, b);
  const za = bodyZone(a.category);
  const zb = bodyZone(b.category);
  if (af >= 0.95) return "completes the outfit";
  if (zb === "layer" || za === "layer") return "layers over it cleanly";
  if (zb === "accent") return "finishes the look";
  if (af >= 0.8) return "pairs naturally";
  return "works alongside it";
}

function lookReason(anchor: MiraProduct, cand: MiraProduct, h: HarmonyType): string {
  return `The ${cand.name.toLowerCase()} ${HARMONY_PHRASE[h]} the ${anchor.name.toLowerCase()} and ${zoneVerb(anchor, cand)}.`;
}

/**
 * The shared styling brain. Scores every other piece in the catalog against
 * `current` on color harmony + category complement + formality + season, and
 * returns them ranked with a human reason. Used by Mira AND the Try-On grid.
 */
export function buildLook(
  current: MiraProduct,
  all: MiraProduct[],
  limit = 8,
): LookEntry[] {
  const others = all.filter((p) => p.handle !== current.handle);
  const fCur = formalityOf(current);
  const sCur = seasonOf(current);

  return others
    .map((p) => {
      const color = analyzeColorHarmony(current.colors, p.colors);
      const cat = categoryAffinity(current, p);
      const formality = 1 - Math.abs(fCur - formalityOf(p));        // close dress-code = good
      const season = 1 - Math.abs(sCur - seasonOf(p)) * 0.8;        // tolerate some spread
      const proportion = proportionScore(current, p);              // balance volume with fit
      const desire = desirabilityOf(p);                            // real keepRate signal
      const impulse = impulseAddScore(current, p);                 // easy-add conversion math
      // OCCASION COHERENCE (brand panel): a formal/evening anchor must not be
      // paired with casual pieces — a sequin gown + denim jacket + sneakers reads
      // as a bot, not a stylist. When the anchor is dressy (formality >= 0.6),
      // hard-penalise low-formality candidates (denim, sweats, sneakers) so they
      // can't surface as the "complete the look" upsell.
      const fCand = formalityOf(p);
      const occasionPenalty = fCur >= 0.6 && fCand < 0.45 ? 0.25 : 1;
      const score = (
        0.30 * color.score +
        0.22 * cat +
        0.11 * formality +
        0.08 * season +
        0.11 * proportion +
        0.10 * desire +
        0.08 * impulse
      ) * occasionPenalty;
      return {
        product: p,
        score,
        harmonyType: color.type,
        reason: lookReason(current, p, color.type),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
