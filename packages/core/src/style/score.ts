// Combo scoring (D40) — "one-look philosophy."
//
// Mira's propose_combo returns 1+ combos per turn today. The Brain
// already picks the highest-scoring combo when invoking the tool, but
// the scoring logic is implicit (heuristic in handleProposeCombo). D40
// makes the score EXPLICIT and STRUCTURED so:
//   • The Brain can return the score + breakdown to the widget
//   • The widget can surface "Why it works" with the harmony rule
//   • Two combos are deterministically comparable across surfaces
//   • Future swap-inline (D40) reuses the same scorer with one slot
//     constrained
//
// Pure function. No DB calls, no AI. Inputs are products the caller
// already has on hand (typically from search_catalog + propose_combo).

import { analyzeColorHarmony, type ColorHarmonyResult, type UndertonePref } from "./harmony.js";

// Mirrors @stylique/ai BrainProduct shape without forcing a dependency
// on the AI package — both packages converge on the same field set.
export type ComboProduct = {
  id: string;
  handle: string;
  title: string;
  category: string | null;
  primaryColor: string | null;     // hex — used by harmony engine
  // Optional metadata that improves scoring when available; missing
  // values are treated as "neutral" rather than penalised.
  fitDescriptor?: string | null;   // "fitted" | "relaxed" | "oversized" | null
  inStock?: boolean | null;        // null = unknown (treated as in-stock)
  occasionTags?: string[];         // ["evening", "work", "casual", ...]
  // ─── Conversion signals (ported from the demo engine, D-consolidation) ──
  // The math that makes a recommendation likely to be BOUGHT, not just to look
  // good. Both optional: missing values are treated as neutral (0.7), never
  // penalised, so a sparse catalog degrades gracefully.
  priceCents?: number | null;      // per-piece price — drives impulse-add elasticity
  keepRate?: number | null;        // 0..1 share who keep their size — desirability proxy
};

export type ComboInput = {
  pieces: ComboProduct[];
  // Optional shopper context the scorer leans on when present.
  shopperUndertone?: UndertonePref | null;
  shopperOccasion?: string | null;    // "dinner", "work day", "wedding guest", …
};

export type ComboScoreBreakdown = {
  // Each component in [0, 1]. The aggregate is the weighted sum below.
  coverage: number;          // shirt + bottom + outerwear/shoes vs missing slots
  colorHarmony: number;      // GRADED by harmony type — the impulse-driving combos score highest
  silhouetteBalance: number; // fitted+relaxed mix > all-same
  occasionFit: number;       // tags align with shopper.occasion
  stockOK: number;           // 1 - (fraction of out-of-stock pieces)
  conversion: number;        // desirability (keepRate) + impulse-add price elasticity
};

export type ComboScoreResult = {
  score: number;                       // 0..1 aggregate
  breakdown: ComboScoreBreakdown;
  harmony: ColorHarmonyResult;         // full harmony output for the UI
  // True when the combo is "ready to surface" — meets minimum bars on
  // coverage + stockOK so we never show a half-OOS look.
  presentable: boolean;
};

// Weights — tuned so colorHarmony + occasionFit dominate when the
// combo is otherwise complete, but a missing slot or OOS piece can't
// be papered over by a beautiful palette.
const WEIGHTS = {
  coverage: 0.28,
  colorHarmony: 0.26,
  silhouetteBalance: 0.10,
  occasionFit: 0.18,
  stockOK: 0.08,
  conversion: 0.10,
} as const;

// Graded color-theory score by harmony type — tuned for CONVERSION, not just
// "is it a valid rule". The old version scored every recognized harmony a flat
// 1.0, so a daring "pop of colour" combo and a safe two-neutrals combo were
// indistinguishable. Now the impulse-driving relationships score highest:
//   • neutral_with_accent → the "pop of colour on a neutral base": the single
//     most stylist-approved, highest-converting look (0.97)
//   • complementary       → high-impact, eye-catching, drives impulse (0.93)
//   • monochromatic/analogous → refined, easy to wear (0.95 / 0.90)
//   • split/triadic       → considered (0.82)
//   • high_contrast       → can clash (0.70); uncategorized → unknown (0.45)
function harmonyDesirability(t: ColorHarmonyResult["harmonyType"]): number {
  switch (t) {
    case "neutral_with_accent": return 0.97;
    case "monochromatic":       return 0.95;
    case "complementary":       return 0.93;
    case "analogous":           return 0.90;
    case "split_complementary": return 0.82;
    case "high_contrast":       return 0.70;
    case "uncategorized":       return 0.45;
    default:                    return 0.85;
  }
}

// Conversion math — how likely this combo is BOUGHT, not just admired. Two halves:
// desirability (do people keep these pieces) + impulse-add (is the price spread an
// easy "yes, add it"). Both neutral (0.7) when the data is absent.
function scoreConversion(pieces: ComboProduct[]): number {
  const keeps = pieces.map((p) => p.keepRate).filter((k): k is number => typeof k === "number");
  const desire = keeps.length ? keeps.reduce((a, b) => a + b, 0) / keeps.length : 0.7;

  const prices = pieces.map((p) => p.priceCents).filter((c): c is number => typeof c === "number" && c > 0);
  let impulse = 0.7;
  if (prices.length >= 2) {
    const ratio = Math.max(...prices) / Math.max(1, Math.min(...prices));
    impulse = ratio <= 1.5 ? 1 : ratio <= 3 ? 0.8 : ratio <= 6 ? 0.6 : 0.45;
  }
  return 0.5 * desire + 0.5 * impulse;
}

// ─── Component scorers ────────────────────────────────────────────────

const TOP_CATEGORIES    = new Set(["top", "shirt", "blouse", "tee", "tank", "sweater", "knitwear", "outerwear", "jacket", "coat"]);
const BOTTOM_CATEGORIES = new Set(["bottom", "pants", "trouser", "jeans", "skirt", "shorts"]);
const ACCESSORY_CATEGORIES = new Set(["accessory", "bag", "shoes", "footwear", "scarf", "belt", "jewelry"]);

function scoreCoverage(pieces: ComboProduct[]): number {
  const cats = pieces.map((p) => (p.category ?? "").toLowerCase());
  const hasTop = cats.some((c) => TOP_CATEGORIES.has(c));
  const hasBottom = cats.some((c) => BOTTOM_CATEGORIES.has(c)) || cats.includes("dress");
  const hasAccessory = cats.some((c) => ACCESSORY_CATEGORIES.has(c));
  // 3-of-3 = 1.0; 2-of-3 = 0.7; 1-of-3 = 0.3.
  const filled = [hasTop, hasBottom, hasAccessory].filter(Boolean).length;
  if (filled === 3) return 1;
  if (filled === 2) return 0.7;
  if (filled === 1) return 0.3;
  return 0.1;
}

function scoreSilhouetteBalance(pieces: ComboProduct[]): number {
  const fits = pieces
    .map((p) => (p.fitDescriptor ?? "").toLowerCase())
    .filter(Boolean);
  if (fits.length === 0) return 0.7; // unknown → neutral
  const uniq = new Set(fits);
  // 2+ different silhouettes (fitted + relaxed, etc.) reads as
  // "balanced look" — 1.0. All-same is 0.6.
  if (uniq.size >= 2) return 1;
  return 0.6;
}

function scoreOccasionFit(pieces: ComboProduct[], shopperOccasion: string | null | undefined): number {
  if (!shopperOccasion) return 0.7; // unknown → neutral
  const occ = shopperOccasion.toLowerCase();
  const allTags = pieces.flatMap((p) => p.occasionTags ?? []).map((t) => t.toLowerCase());
  if (allTags.length === 0) return 0.6;
  const hits = allTags.filter((t) => occ.includes(t) || t.includes(occ)).length;
  // Convert hit ratio into [0, 1] — capped because more tags = noisier signal.
  return Math.min(1, 0.4 + (hits / Math.max(1, allTags.length)) * 0.6);
}

function scoreStockOK(pieces: ComboProduct[]): number {
  if (pieces.length === 0) return 0;
  const out = pieces.filter((p) => p.inStock === false).length;
  return 1 - out / pieces.length;
}

// ─── Public entry ─────────────────────────────────────────────────────

export function scoreCombo(input: ComboInput): ComboScoreResult {
  const harmony = analyzeColorHarmony({
    palette: input.pieces.map((p) => p.primaryColor ?? "").filter(Boolean),
    shopperUndertone: input.shopperUndertone ?? null,
  });

  const coverage = scoreCoverage(input.pieces);
  const colorHarmony = harmonyDesirability(harmony.harmonyType);
  const silhouetteBalance = scoreSilhouetteBalance(input.pieces);
  const occasionFit = scoreOccasionFit(input.pieces, input.shopperOccasion ?? null);
  const stockOK = scoreStockOK(input.pieces);
  const conversion = scoreConversion(input.pieces);

  const breakdown: ComboScoreBreakdown = {
    coverage,
    colorHarmony,
    silhouetteBalance,
    occasionFit,
    stockOK,
    conversion,
  };

  const score =
    coverage * WEIGHTS.coverage +
    colorHarmony * WEIGHTS.colorHarmony +
    silhouetteBalance * WEIGHTS.silhouetteBalance +
    occasionFit * WEIGHTS.occasionFit +
    stockOK * WEIGHTS.stockOK +
    conversion * WEIGHTS.conversion;

  // Presentability gates — never surface a thin or OOS-heavy combo.
  const presentable = coverage >= 0.3 && stockOK >= 0.66;

  return { score, breakdown, harmony, presentable };
}

// Convenience for the Brain — given several combos, pick the highest
// presentable scorer. Falls back to the best scorer overall when none
// are presentable (caller decides whether to surface or skip).
export function pickWinningCombo<T extends ComboInput>(
  combos: T[],
): { winner: T; result: ComboScoreResult } | null {
  if (combos.length === 0) return null;
  const scored = combos.map((c) => ({ c, r: scoreCombo(c) }));
  const presentable = scored.filter((s) => s.r.presentable);
  const pool = presentable.length > 0 ? presentable : scored;
  pool.sort((a, b) => b.r.score - a.r.score);
  const top = pool[0]!;
  return { winner: top.c, result: top.r };
}
