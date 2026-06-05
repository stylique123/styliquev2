// Stylique Beauty — ingredient analyzer.
// Parses INCI ingredient strings and scores them for safety + concern-benefit.
// Powers the "Clean Beauty Badge" in the widget (trust signal → conversion lift).
//
// Data source: open cosmetic-ingredients-dataset (MIT license) +
// inci_score library patterns. No external API calls — pure lookup.

import type { IngredientAnalysis, IngredientSafetyLevel, SkinConcern, ProductIngredientReport } from "./types.js";

// ─── Known problematic ingredients (EWG / clean beauty consensus) ────────

const AVOID_INGREDIENTS: Record<string, { reason: string; score: number }> = {
  "fragrance": { reason: "common sensitizer, can cause contact dermatitis", score: 3 },
  "parfum": { reason: "EU term for fragrance, same concerns", score: 3 },
  "parabens": { reason: "endocrine disruptor concern (methyl/ethyl/propyl/butylparaben)", score: 3 },
  "methylparaben": { reason: "endocrine disruptor concern", score: 3 },
  "propylparaben": { reason: "endocrine disruptor concern", score: 3 },
  "butylparaben": { reason: "endocrine disruptor concern, strongest concern", score: 2 },
  "sodium lauryl sulfate": { reason: "harsh surfactant, strips skin barrier", score: 4 },
  "sodium laureth sulfate": { reason: "milder than SLS but still stripping", score: 5 },
  "phthalates": { reason: "endocrine disruptors", score: 2 },
  "dibutyl phthalate": { reason: "endocrine disruptor", score: 2 },
  "formaldehyde": { reason: "carcinogen, preservative", score: 1 },
  "dmdm hydantoin": { reason: "formaldehyde releaser", score: 3 },
  "imidazolidinyl urea": { reason: "formaldehyde releaser", score: 3 },
  "diazolidinyl urea": { reason: "formaldehyde releaser", score: 3 },
  "mineral oil": { reason: "pore-clogging for some skin types (comedogenic)", score: 4 },
  "petrolatum": { reason: "can be contaminated with PAHs if not refined", score: 5 },
  "oxybenzone": { reason: "chemical UV filter, endocrine concern", score: 4 },
  "octinoxate": { reason: "chemical UV filter, hormone disruption", score: 4 },
  "hydroquinone": { reason: "skin lightener, restricted in many countries", score: 3 },
  "alcohol denat": { reason: "drying, disrupts skin barrier at high concentrations", score: 4 },
  "isopropyl alcohol": { reason: "very drying, barrier disruption", score: 3 },
};

// ─── Beneficial actives — what they help ─────────────────────────────────

const BENEFICIAL_INGREDIENTS: Record<string, { concerns: SkinConcern[]; notes: string }> = {
  "niacinamide": { concerns: ["acne", "hyperpigmentation", "pores", "oiliness", "texture"], notes: "multi-tasking B3 vitamin" },
  "salicylic acid": { concerns: ["acne", "oiliness", "pores", "texture"], notes: "BHA — exfoliates inside pores" },
  "glycolic acid": { concerns: ["texture", "dullness", "hyperpigmentation", "fine_lines"], notes: "AHA — surface exfoliant" },
  "lactic acid": { concerns: ["texture", "dryness", "dullness"], notes: "gentler AHA, also hydrating" },
  "hyaluronic acid": { concerns: ["dryness", "fine_lines"], notes: "draws moisture into skin" },
  "sodium hyaluronate": { concerns: ["dryness"], notes: "smaller HA, penetrates better" },
  "retinol": { concerns: ["fine_lines", "texture", "hyperpigmentation", "acne"], notes: "vitamin A — introduce slowly" },
  "retinal": { concerns: ["fine_lines", "texture", "hyperpigmentation"], notes: "stronger than retinol, gentler than retinoic acid" },
  "tretinoin": { concerns: ["acne", "fine_lines", "hyperpigmentation", "texture"], notes: "prescription retinoid — strongest" },
  "vitamin c": { concerns: ["hyperpigmentation", "dullness", "uneven_tone", "fine_lines"], notes: "antioxidant + brightening" },
  "ascorbic acid": { concerns: ["hyperpigmentation", "dullness", "uneven_tone"], notes: "pure vitamin C form" },
  "l-ascorbic acid": { concerns: ["hyperpigmentation", "dullness", "uneven_tone"], notes: "pure vitamin C form" },
  "azelaic acid": { concerns: ["acne", "redness", "hyperpigmentation", "sensitivity"], notes: "gentle brightener + anti-inflammatory" },
  "tranexamic acid": { concerns: ["hyperpigmentation", "uneven_tone"], notes: "strong brightener, very well-tolerated" },
  "alpha arbutin": { concerns: ["hyperpigmentation", "uneven_tone", "dullness"], notes: "brightener, gentler than hydroquinone" },
  "kojic acid": { concerns: ["hyperpigmentation", "uneven_tone"], notes: "mushroom-derived brightener" },
  "centella asiatica": { concerns: ["redness", "sensitivity", "acne"], notes: "cica — anti-inflammatory, barrier repair" },
  "ceramides": { concerns: ["dryness", "sensitivity", "redness"], notes: "barrier lipids — essential for dry/sensitive skin" },
  "peptides": { concerns: ["fine_lines"], notes: "signal proteins for collagen production" },
  "caffeine": { concerns: ["dark_circles"], notes: "constricts vessels, reduces puffiness" },
  "benzoyl peroxide": { concerns: ["acne"], notes: "kills acne bacteria — effective but drying" },
  "tea tree": { concerns: ["acne", "oiliness"], notes: "antimicrobial, gentler than BP" },
  "zinc": { concerns: ["acne", "oiliness"], notes: "regulates sebum production" },
  "squalane": { concerns: ["dryness", "sensitivity"], notes: "lightweight, skin-identical lipid" },
  "shea butter": { concerns: ["dryness"], notes: "rich emollient — use sparingly on acne-prone skin" },
  "allantoin": { concerns: ["sensitivity", "redness"], notes: "soothing + cell turnover" },
  "glycerin": { concerns: ["dryness"], notes: "humectant — draws water to skin" },
  "witch hazel": { concerns: ["oiliness", "pores", "acne"], notes: "astringent — use alcohol-free version" },
};

// ─── Parse INCI list ──────────────────────────────────────────────────────

export function parseINCI(inciString: string): string[] {
  return inciString
    .split(/[,\n]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// ─── Analyze a single ingredient ─────────────────────────────────────────

export function analyzeIngredient(ingredient: string): IngredientAnalysis {
  const lower = ingredient.toLowerCase();

  // Check avoid list
  for (const [key, data] of Object.entries(AVOID_INGREDIENTS)) {
    if (lower.includes(key)) {
      return {
        name: ingredient,
        isSafe: data.score < 3 ? "avoid" : "caution",
        score: data.score,
        concern: data.reason,
        isActive: false,
      };
    }
  }

  // Check beneficial list
  for (const [key, data] of Object.entries(BENEFICIAL_INGREDIENTS)) {
    if (lower.includes(key)) {
      const isActive = ["retinol", "retinal", "tretinoin", "glycolic acid", "lactic acid", "salicylic acid", "vitamin c", "l-ascorbic acid", "ascorbic acid", "azelaic acid", "benzoyl peroxide"].some(a => lower.includes(a));
      return {
        name: ingredient,
        isSafe: "safe",
        score: 9,
        benefitFor: data.concerns,
        isActive,
      };
    }
  }

  // Default: unknown but assumed safe
  return {
    name: ingredient,
    isSafe: "safe",
    score: 7,
    isActive: false,
  };
}

// ─── Full product analysis ────────────────────────────────────────────────

export function analyzeProductIngredients(
  productId: string,
  inciString: string,
  shopperConcerns: SkinConcern[] = [],
): ProductIngredientReport {
  const ingredients = parseINCI(inciString);
  const analyses = ingredients.map(analyzeIngredient);

  const flagged = analyses.filter(a => a.isSafe === "avoid" || a.isSafe === "caution");
  const keyActives = analyses.filter(a => a.isActive);

  // Clean beauty badge: no fragrance, no parabens, no harsh sulfates, no formaldehyde releasers
  const cleanBeautyViolators = ["fragrance", "parfum", "paraben", "sodium lauryl sulfate", "formaldehyde", "dmdm hydantoin", "imidazolidinyl urea", "diazolidinyl urea"];
  const isClean = !ingredients.some(ing => cleanBeautyViolators.some(v => ing.includes(v)));

  // Concerns addressed
  const suitableFor = [...new Set(keyActives.flatMap(a => a.benefitFor ?? []))];

  // Concerns to avoid
  const notSuitableFor: SkinConcern[] = [];
  if (ingredients.some(i => i.includes("fragrance") || i.includes("parfum"))) notSuitableFor.push("sensitivity", "redness");
  if (ingredients.some(i => i.includes("shea") || i.includes("mineral oil") || i.includes("cocoa butter"))) notSuitableFor.push("acne");
  if (ingredients.some(i => i.includes("alcohol denat") || i.includes("isopropyl alcohol"))) notSuitableFor.push("dryness", "sensitivity");

  const overallScore = Math.round(
    analyses.reduce((sum, a) => sum + a.score, 0) / Math.max(analyses.length, 1)
  );

  const summary = buildIngredientSummary(isClean, keyActives, flagged, shopperConcerns, suitableFor);

  return {
    productId,
    overallSafetyScore: overallScore,
    cleanBeautyBadge: isClean,
    keyActives,
    flaggedIngredients: flagged,
    suitableFor,
    notSuitableFor,
    summary,
  };
}

function buildIngredientSummary(
  isClean: boolean,
  actives: IngredientAnalysis[],
  flagged: IngredientAnalysis[],
  shopperConcerns: SkinConcern[],
  suitableFor: SkinConcern[],
): string {
  const parts: string[] = [];
  if (isClean) parts.push("Clean formula");
  if (actives.length > 0) parts.push(`actives: ${actives.slice(0, 2).map(a => a.name).join(", ")}`);
  const relevantConcerns = shopperConcerns.filter(c => suitableFor.includes(c));
  if (relevantConcerns.length > 0) parts.push(`targets your ${relevantConcerns[0]}`);
  if (flagged.length > 0) parts.push(`contains ${flagged[0].name} (${flagged[0].concern})`);
  return parts.join(" · ") || "Standard formula";
}
