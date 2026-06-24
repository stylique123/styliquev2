// Smart deterministic style + complete-the-look service.
//
// Recommendation strategy (a small, defensible mix of well-known techniques —
// no paid models, no external calls):
//
//   1. Itten color theory in HSL space — hue distance grades each candidate as
//      monochrome / analogous / complementary / triadic / clashing. We collapse
//      to a 0..1 colorScore.
//   2. Polyvore-style category compatibility — anchor category drives an ordered
//      list of complementary roles, each backed by its own candidate-category set.
//   3. Body-aware proportion weighting — petite favours cropped, tall favours
//      layers, plus/curvy favours flowy/relaxed silhouettes (inferred from tags).
//   4. Style coherence — pairs by formality tier (formal/smart/casual/sporty)
//      inferred from category + tag heuristics.
//
// Final score = 0.42·color + 0.25·body + 0.18·style + 0.15·neutralityBonus.
// Returns per-item confidence so the UI can show "94 match" badges.

import { buildColorCombos } from "../colors/rules.js";
import type { ColorCombo } from "@stylique/types";
import { scoreCombo, type ComboScoreResult } from "./score.js";

export type StyleProduct = {
  id: string;
  handle: string;
  title: string;
  category: string | null;
  primaryColor: string | null;
  colorFamily: string | null;
  imageUrl?: string | null;
  tags?: string[];
};

export type OutfitItem = {
  product: StyleProduct;
  role: "ANCHOR" | "TOP" | "BOTTOM" | "OUTERWEAR" | "SHOES" | "ACCESSORY";
  colorNote: string;
  confidence: number;                  // 0..1 — surfaced in widget as a match score
  rationale: string[];                  // short reasons (color, body, style)
};

export type StyleResult = {
  outfit: OutfitItem[];                 // anchor always first
  colorCombos: ColorCombo[];
  overallConfidence: number;            // mean of complements
  comboScore: ComboScoreResult;         // D40 — structured 5-dimension score
};

export type StyleContext = {
  bodyType?: "PETITE" | "SLIM" | "REGULAR" | "CURVY" | "PLUS" | "TALL";
  fitPreference?: "FITTED" | "REGULAR" | "RELAXED" | "OVERSIZED";
};

export type StyleProductSlot = "top" | "bottom" | "dress" | "outerwear" | "footwear" | "accessory" | "unknown";

export function canonicalStyleCategory(
  product: Pick<StyleProduct, "category" | "title" | "tags"> & { productType?: string | null },
): string | null {
  const hay = [product.category ?? "", product.productType ?? "", product.title, ...(product.tags ?? [])].join(" ").toLowerCase();
  if (/\b(dress|gown|slip|saree|sari|jumpsuit|lehenga|lehnga|ghagra|gharara|sharara|anarkali|abaya|kaftan|dungaree)\b/.test(hay)) return "dress";
  if (/\b(coat|jacket|blazer|trench|outerwear|cardigan|cape|overcoat|parka|shrug|bolero|koti|waistcoat)\b/.test(hay)) return "outerwear";
  if (/\b(trouser|trousers|pant|pants|jean|jeans|denim|skirt|short|bottom|legging|leggings|culotte|culottes|palazzo|patiala|shalwar|salwar|churidar|dhoti)\b/.test(hay)) return "trouser";
  if (/\b(shoe|shoes|heel|heels|boot|boots|sneaker|sneakers|loafer|loafers|sandal|sandals|flat|flats|footwear|pump|pumps|mule|mules|chappal|khussa|jutii|juttis|kolhapuri)\b/.test(hay)) return "shoe";
  if (/\b(bag|bags|belt|scarf|dupatta|stole|shawl|jewel|jewelry|jewellery|necklace|earring|jhumka|bracelet|bangle|ring|accessory|clutch|tote|potli|hat|sunglass|sunglasses|glove|watch|maang tikka|mang tikka|tikka)\b/.test(hay)) return "accessory";
  if (/\b(knit|sweater|jumper|cashmere|merino|turtleneck|cardigan)\b/.test(hay)) return "knitwear";
  if (/\b(shirt|top|blouse|tee|t-shirt|tank|camisole|cami|kurta|kurti|kameez|choli|tunic)\b/.test(hay)) return "shirt";
  return product.category?.toLowerCase() ?? null;
}

export function inferStyleProductSlot(
  product: Pick<StyleProduct, "category" | "title" | "tags"> & { productType?: string | null },
): StyleProductSlot {
  const category = canonicalStyleCategory(product);
  if (category === "dress") return "dress";
  if (category === "outerwear") return "outerwear";
  if (category === "trouser" || category === "bottom" || category === "skirt") return "bottom";
  if (category === "shoe" || category === "footwear") return "footwear";
  if (category === "accessory") return "accessory";
  if (category === "shirt" || category === "top" || category === "knitwear") return "top";
  return "unknown";
}

// ─── Category graph ─────────────────────────────────────────────────────
const COMPLEMENT_ROLES: Record<string, Array<OutfitItem["role"]>> = {
  shirt:     ["BOTTOM", "SHOES", "OUTERWEAR", "ACCESSORY"],
  top:       ["BOTTOM", "SHOES", "OUTERWEAR", "ACCESSORY"],
  knitwear:  ["BOTTOM", "SHOES", "OUTERWEAR", "ACCESSORY"],
  trouser:   ["TOP", "SHOES", "OUTERWEAR", "ACCESSORY"],
  bottom:    ["TOP", "SHOES", "OUTERWEAR", "ACCESSORY"],
  shoe:      ["BOTTOM", "TOP", "OUTERWEAR", "ACCESSORY"],
  footwear:  ["BOTTOM", "TOP", "OUTERWEAR", "ACCESSORY"],
  outerwear: ["TOP", "BOTTOM", "SHOES"],
  dress:     ["SHOES", "OUTERWEAR", "ACCESSORY"],
  skirt:     ["TOP", "SHOES", "ACCESSORY"],
  accessory: ["TOP", "BOTTOM", "SHOES"],
};

const ROLE_CATEGORIES: Record<OutfitItem["role"], string[]> = {
  ANCHOR:    [],
  TOP:       ["shirt", "top", "knitwear"],
  BOTTOM:    ["trouser", "bottom", "skirt"],
  OUTERWEAR: ["outerwear"],
  SHOES:     ["shoe", "footwear"],
  ACCESSORY: ["accessory"],
};

// ─── Color theory (HSL distance) ────────────────────────────────────────
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d) + (g < b ? 6 : 0);
  else if (max === g) h = ((b - r) / d) + 2;
  else h = ((r - g) / d) + 4;
  return { h: h * 60, s, l };
}

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Returns 0..1 — higher = more aesthetically harmonic per Itten color theory.
function colorScore(anchorHex: string | null, candidateHex: string | null, anchorFamily: string | null, candFamily: string | null): { score: number; relation: string } {
  if (!anchorFamily || !candFamily) return { score: 0.42, relation: "neutral pairing" };
  if (anchorFamily === candFamily) return { score: 0.62, relation: "monochrome — tonal coherence" };

  // Neutrals always score well as a complement.
  const NEUTRAL = new Set(["white", "black", "grey", "beige", "cream", "tan", "neutral"]);
  if (NEUTRAL.has(candFamily) && !NEUTRAL.has(anchorFamily)) return { score: 0.92, relation: `${candFamily} neutral grounds ${anchorFamily}` };
  if (NEUTRAL.has(anchorFamily) && !NEUTRAL.has(candFamily)) return { score: 0.86, relation: `${candFamily} adds warmth to the neutral anchor` };

  // HSL hue-distance based scoring.
  const a = anchorHex ? hexToHsl(anchorHex) : null;
  const c = candidateHex ? hexToHsl(candidateHex) : null;
  if (a && c) {
    const dh = hueDelta(a.h, c.h);
    if (dh <= 18)   return { score: 0.55, relation: "analogous tones" };
    if (dh <= 45)   return { score: 0.78, relation: "soft contrast" };
    if (dh <= 90)   return { score: 0.84, relation: "triadic pairing" };
    if (dh <= 150)  return { score: 0.97, relation: "complementary contrast" };
    return { score: 0.65, relation: "split-complementary" };
  }
  return { score: 0.5, relation: "balanced pair" };
}

// ─── Body-type proportion weighting ─────────────────────────────────────
function bodyWeight(body: StyleContext["bodyType"], role: OutfitItem["role"], tagsRaw?: string[]): number {
  if (!body) return 0.6;
  const tags = (tagsRaw ?? []).map((t) => t.toLowerCase());
  const has = (...xs: string[]) => xs.some((x) => tags.includes(x));
  // Preferences are heuristics, intentionally conservative.
  switch (body) {
    case "PETITE":   return role === "BOTTOM" && has("cropped", "high-rise") ? 0.95 : role === "OUTERWEAR" ? 0.5 : 0.7;
    case "TALL":     return role === "OUTERWEAR" || role === "BOTTOM" ? 0.85 : 0.7;
    case "CURVY":    return role === "BOTTOM" && has("a-line", "draped", "flowy") ? 0.95 : 0.72;
    case "PLUS":     return has("relaxed", "drape", "flowy", "wide") ? 0.92 : role === "OUTERWEAR" ? 0.85 : 0.7;
    case "SLIM":     return role === "OUTERWEAR" && has("oversized") ? 0.85 : 0.75;
    case "REGULAR":  return 0.75;
  }
}

// ─── Style coherence (formality tier match) ─────────────────────────────
const FORMAL = new Set(["blazer", "trouser", "loafer", "derby", "oxford", "silk", "wool"]);
const CASUAL = new Set(["jean", "tee", "sneaker", "chino", "hoodie"]);
function formalityTier(p: StyleProduct): "formal" | "casual" | "neutral" {
  const hay = [canonicalStyleCategory(p) ?? "", p.category ?? "", p.title, ...(p.tags ?? [])].join(" ").toLowerCase();
  if ([...FORMAL].some((k) => hay.includes(k))) return "formal";
  if ([...CASUAL].some((k) => hay.includes(k))) return "casual";
  return "neutral";
}
function styleCoherence(anchor: StyleProduct, candidate: StyleProduct): number {
  const a = formalityTier(anchor), c = formalityTier(candidate);
  if (a === c) return 0.95;
  if (a === "neutral" || c === "neutral") return 0.75;
  return 0.4;     // formal × casual = jarring
}

// ─── Scoring + selection ────────────────────────────────────────────────
function scoreCandidate(anchor: StyleProduct, cand: StyleProduct, role: OutfitItem["role"], ctx: StyleContext) {
  const cs = colorScore(anchor.primaryColor, cand.primaryColor, anchor.colorFamily, cand.colorFamily);
  const bw = bodyWeight(ctx.bodyType, role, cand.tags);
  const sc = styleCoherence(anchor, cand);
  const neutralBonus = cand.colorFamily && ["white", "beige", "cream", "black", "grey", "neutral"].includes(cand.colorFamily) ? 0.85 : 0.55;
  const combined = 0.42 * cs.score + 0.25 * bw + 0.18 * sc + 0.15 * neutralBonus;
  return { score: Math.max(0, Math.min(1, combined)), colorScore: cs.score, colorRelation: cs.relation, bodyWeight: bw, styleCoherence: sc };
}

function pickForRole(
  role: OutfitItem["role"],
  catalog: StyleProduct[],
  anchor: StyleProduct,
  used: Set<string>,
  ctx: StyleContext,
): { product: StyleProduct; confidence: number; rationale: string[]; colorRelation: string } | null {
  const wanted = ROLE_CATEGORIES[role];
  const candidates = catalog.filter(
    (p) => {
      const category = canonicalStyleCategory(p);
      return p.id !== anchor.id && !used.has(p.id) && category != null && wanted.includes(category);
    },
  );
  if (!candidates.length) return null;

  const scored = candidates
    .map((p) => ({ p, ...scoreCandidate(anchor, p, role, ctx) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const rationale: string[] = [top.colorRelation];
  if (top.bodyWeight > 0.85 && ctx.bodyType) rationale.push(`flatters ${ctx.bodyType.toLowerCase()} proportions`);
  if (top.styleCoherence < 0.6) rationale.push("intentional formality shift");
  return { product: top.p, confidence: top.score, rationale, colorRelation: top.colorRelation };
}

function colorNoteFor(anchor: StyleProduct, item: StyleProduct, relation: string): string {
  if (!anchor.colorFamily) return "Pairs cleanly with the anchor.";
  const itemFam = item.colorFamily ? item.colorFamily[0].toUpperCase() + item.colorFamily.slice(1) : "Neutral";
  const anchorFam = anchor.colorFamily[0].toUpperCase() + anchor.colorFamily.slice(1);
  return `${itemFam} × ${anchorFam} — ${relation}.`;
}

// ─── Public API ─────────────────────────────────────────────────────────
export function buildOutfit(anchor: StyleProduct, catalog: StyleProduct[], ctx: StyleContext = {}): StyleResult {
  const anchorCategory = canonicalStyleCategory(anchor);
  const roles = COMPLEMENT_ROLES[anchorCategory ?? ""] ?? ["TOP", "BOTTOM", "SHOES", "ACCESSORY"];
  const used = new Set<string>([anchor.id]);
  const items: OutfitItem[] = [{
    product: anchor, role: "ANCHOR",
    colorNote: "The anchor — everything else builds around this piece.",
    confidence: 1, rationale: ["anchor"],
  }];

  for (const role of roles) {
    const pick = pickForRole(role, catalog, anchor, used, ctx);
    if (!pick) continue;
    used.add(pick.product.id);
    items.push({
      product: pick.product, role,
      colorNote: colorNoteFor(anchor, pick.product, pick.colorRelation),
      confidence: pick.confidence,
      rationale: pick.rationale,
    });
    if (items.length >= 4) break;     // anchor + 3 complements
  }

  const complements = items.slice(1);
  const overallConfidence = complements.length
    ? complements.reduce((s, i) => s + i.confidence, 0) / complements.length
    : 0;

  const combos = anchor.colorFamily ? buildColorCombos(anchor.colorFamily, anchor.primaryColor ?? undefined) : [];

  // D40 — run the richer 5-dimension scorer on the full outfit so there is a
  // single scoring path. stockOK=true since we just fetched from catalog;
  // occasionFit=0.5 as neutral default (no shopper occasion in this context).
  const comboScore = scoreCombo({
    pieces: items.map((item) => ({
      id: item.product.id,
      handle: item.product.handle,
      title: item.product.title,
      category: canonicalStyleCategory(item.product),
      primaryColor: item.product.primaryColor,
      inStock: true,        // catalog fetch = in stock assumption
      occasionTags: [],     // no occasion tags at this surface
    })),
    shopperOccasion: null,  // neutral
  });

  return { outfit: items, colorCombos: combos, overallConfidence, comboScore };
}
