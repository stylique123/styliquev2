// Stylique Beauty — routine builder.
// The "complete the routine" AOV lever. Average routine = 3-6 products.
// Benchmark: $45 single product → $189 routine basket (Alhena AI, 2025).
//
// The routine is the "complete the look" equivalent for beauty — but with
// a clinical logic backbone: AM/PM split, concern targeting, introduce-last
// for actives (retinol, AHAs), SPF always last in AM.

import type { RoutineStep, RoutineProduct, BeautyRoutine, SkinConcern, SkinType } from "./types.js";

// ─── Routine step order ──────────────────────────────────────────────────

const AM_STEP_ORDER: RoutineStep[] = [
  "cleanser",
  "toner",
  "serum",
  "eye_cream",
  "moisturizer",
  "spf",               // always LAST in AM — invariant
  "makeup_base",
  "foundation",
  "concealer",
  "blush_bronzer",
  "highlight",
  "eye_makeup",
  "lip",
  "setting",
];

const PM_STEP_ORDER: RoutineStep[] = [
  "remover",
  "cleanser",
  "toner",
  "treatment",         // AHAs, retinol — PM only
  "serum",
  "eye_cream",
  "moisturizer",
  // No SPF in PM
];

// ─── Concern → step priority mapping ────────────────────────────────────
// When building a concern-targeted routine, these steps are prioritised.

const CONCERN_PRIORITY_STEPS: Record<SkinConcern, RoutineStep[]> = {
  acne:              ["cleanser", "treatment", "serum", "moisturizer", "spf"],
  hyperpigmentation: ["serum", "spf", "treatment", "moisturizer"],
  redness:           ["moisturizer", "serum", "cleanser", "spf"],
  dryness:           ["moisturizer", "serum", "toner", "cleanser"],
  oiliness:          ["cleanser", "toner", "moisturizer", "treatment"],
  texture:           ["serum", "treatment", "cleanser", "toner"],
  fine_lines:        ["serum", "eye_cream", "moisturizer", "treatment"],
  dark_circles:      ["eye_cream", "concealer", "serum"],
  pores:             ["cleanser", "toner", "treatment", "moisturizer"],
  sensitivity:       ["moisturizer", "cleanser", "serum"],
  uneven_tone:       ["serum", "spf", "treatment", "moisturizer"],
  dullness:          ["serum", "moisturizer", "treatment", "toner"],
};

// ─── Ingredient keywords that target each concern ────────────────────────
// Used to score catalog products against shopper concerns without requiring
// structured ingredient data — we search tags, descriptions, and titles.

export const CONCERN_INGREDIENT_KEYWORDS: Record<SkinConcern, string[]> = {
  acne:              ["salicylic", "benzoyl", "tea tree", "niacinamide", "zinc", "sulfur", "BHA"],
  hyperpigmentation: ["vitamin C", "kojic", "niacinamide", "tranexamic", "alpha arbutin", "AHA", "glycolic"],
  redness:           ["centella", "azelaic", "green tea", "aloe", "chamomile", "allantoin", "bisabolol"],
  dryness:           ["hyaluronic", "ceramide", "squalane", "shea", "glycerin", "peptide"],
  oiliness:          ["niacinamide", "salicylic", "witch hazel", "BHA", "clay", "zinc"],
  texture:           ["AHA", "glycolic", "lactic", "retinol", "BHA", "exfoliant"],
  fine_lines:        ["retinol", "retinoid", "peptide", "vitamin C", "collagen", "hyaluronic"],
  dark_circles:      ["caffeine", "vitamin K", "retinol", "peptide", "vitamin C"],
  pores:             ["niacinamide", "BHA", "salicylic", "retinol", "clay"],
  sensitivity:       ["centella", "aloe", "chamomile", "oat", "ceramide", "allantoin"],
  uneven_tone:       ["vitamin C", "niacinamide", "tranexamic", "AHA", "kojic"],
  dullness:          ["vitamin C", "AHA", "glycolic", "niacinamide", "glow", "brightening"],
};

// ─── Skin type product compatibility ─────────────────────────────────────

const SKIN_TYPE_AVOID_TERMS: Record<SkinType, string[]> = {
  oily:        ["heavy oil", "rich cream", "ultra-nourishing", "facial oil"],
  dry:         ["gel", "mattifying", "oil-free", "pore-minimizing"],
  combination: [],
  normal:      [],
  sensitive:   ["fragrance", "essential oil", "alcohol denat", "retinol acid"],
};

// ─── Routine scaffold (what steps we build toward) ──────────────────────

export type RoutineSlot = {
  step: RoutineStep;
  label: string;      // human-readable ("Vitamin C Serum" vs just "Serum")
  required: boolean;
  whyForConcern: string;  // pre-composed rationale
};

export function buildRoutineScaffold(
  concerns: SkinConcern[],
  timeOfDay: "AM" | "PM" | "both",
  includesMakeup: boolean,
): RoutineSlot[] {
  const stepOrder = timeOfDay === "PM" ? PM_STEP_ORDER :
    timeOfDay === "AM" ? AM_STEP_ORDER :
    [...new Set([...AM_STEP_ORDER, ...PM_STEP_ORDER])];

  // Score each step by how many concerns it addresses
  const stepScores = new Map<RoutineStep, number>();
  for (const concern of concerns) {
    const prioritySteps = CONCERN_PRIORITY_STEPS[concern] ?? [];
    for (let i = 0; i < prioritySteps.length; i++) {
      const step = prioritySteps[i];
      stepScores.set(step, (stepScores.get(step) ?? 0) + (prioritySteps.length - i));
    }
  }

  const slots: RoutineSlot[] = [];

  for (const step of stepOrder) {
    // Skip makeup steps if not including makeup
    if (!includesMakeup && ["makeup_base", "foundation", "concealer", "blush_bronzer", "highlight", "eye_makeup", "lip", "setting"].includes(step)) continue;

    const score = stepScores.get(step) ?? 0;
    const isRequired = step === "spf" && timeOfDay === "AM"
      ? true
      : score > 0;

    if (!isRequired && step !== "cleanser" && step !== "moisturizer") continue;

    slots.push({
      step,
      label: STEP_LABELS[step],
      required: step === "spf" || step === "cleanser" || step === "moisturizer",
      whyForConcern: buildStepRationale(step, concerns),
    });
  }

  return slots;
}

const STEP_LABELS: Record<RoutineStep, string> = {
  cleanser:     "Cleanser",
  toner:        "Toner / Essence",
  serum:        "Treatment Serum",
  eye_cream:    "Eye Cream",
  moisturizer:  "Moisturizer",
  spf:          "SPF (non-negotiable AM)",
  treatment:    "Active Treatment",
  makeup_base:  "Primer / Base",
  foundation:   "Foundation",
  concealer:    "Concealer",
  blush_bronzer:"Blush & Bronzer",
  highlight:    "Highlighter",
  lip:          "Lip Color",
  eye_makeup:   "Eye Makeup",
  setting:      "Setting Powder / Spray",
  remover:      "Makeup Remover",
};

function buildStepRationale(step: RoutineStep, concerns: SkinConcern[]): string {
  const rationales: Partial<Record<RoutineStep, string>> = {
    cleanser:    "Removes buildup without stripping — the foundation of everything that comes after.",
    toner:       "Preps skin to absorb actives 40% better.",
    serum:       concerns.includes("hyperpigmentation") ? "Vitamin C here targets your uneven tone." :
                 concerns.includes("acne") ? "Niacinamide or salicylic hits blemishes at the source." :
                 concerns.includes("fine_lines") ? "Peptides and retinol work best in this step." :
                 "High-concentration actives targeted to your top concerns.",
    eye_cream:   "The under-eye area needs its own formula — thinner skin, different needs.",
    moisturizer: "Locks in everything above. Never skip, even for oily skin.",
    spf:         "SPF undoes every serum if skipped. This is non-negotiable.",
    treatment:   "Retinol / AHA / spot treatment — PM only, introduce slowly.",
    makeup_base: "Primer extends foundation wear and smooths texture.",
    foundation:  "Shade-matched to your skin — the return-rate killer.",
    concealer:   "Spot-corrects any breakthrough coverage needs.",
    setting:     "Locks everything in for 8+ hours.",
  };
  return rationales[step] ?? `${STEP_LABELS[step]} step.`;
}

// ─── Score a product for a given routine slot ────────────────────────────

export function scoreProductForSlot(
  product: { title: string; tags: string[]; description?: string; category?: string | null },
  slot: RoutineSlot,
  concerns: SkinConcern[],
  skinType?: SkinType,
): number {
  let score = 0;
  const text = `${product.title} ${product.tags.join(" ")} ${product.description ?? ""}`.toLowerCase();

  // Step category match
  const stepKeywords = STEP_CATEGORY_KEYWORDS[slot.step] ?? [];
  for (const kw of stepKeywords) {
    if (text.includes(kw)) { score += 3; break; }
  }

  // Concern ingredient match
  for (const concern of concerns) {
    const keywords = CONCERN_INGREDIENT_KEYWORDS[concern] ?? [];
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) score += 2;
    }
  }

  // Skin type avoid penalty
  if (skinType) {
    const avoidTerms = SKIN_TYPE_AVOID_TERMS[skinType] ?? [];
    for (const term of avoidTerms) {
      if (text.includes(term.toLowerCase())) score -= 4;
    }
  }

  return Math.max(0, score);
}

const STEP_CATEGORY_KEYWORDS: Partial<Record<RoutineStep, string[]>> = {
  cleanser:     ["cleanser", "face wash", "micellar", "cleansing balm", "cleansing oil"],
  toner:        ["toner", "essence", "mist", "facial water"],
  serum:        ["serum", "treatment", "ampoule", "concentrate"],
  eye_cream:    ["eye cream", "eye serum", "eye treatment", "under eye"],
  moisturizer:  ["moisturizer", "moisturiser", "cream", "lotion", "gel cream", "day cream", "night cream"],
  spf:          ["spf", "sunscreen", "sunblock", "sun protection", "uv"],
  treatment:    ["mask", "exfoliant", "peel", "spot treatment", "retinol", "aha", "bha"],
  makeup_base:  ["primer", "base", "pore-filler", "smoothing"],
  foundation:   ["foundation", "tinted moisturizer", "bb cream", "cc cream", "coverage"],
  concealer:    ["concealer", "corrector", "spot cover"],
  blush_bronzer:["blush", "bronzer", "contour", "color"],
  highlight:    ["highlighter", "luminizer", "glow", "shimmer"],
  lip:          ["lipstick", "lip gloss", "lip liner", "lip color", "lip oil", "lip balm"],
  eye_makeup:   ["eyeshadow", "eyeliner", "mascara", "brow"],
  setting:      ["setting powder", "setting spray", "finishing powder"],
  remover:      ["remover", "micellar", "cleansing oil", "makeup wipe"],
};

// ─── Build a final routine from products ─────────────────────────────────

export function buildRoutineName(concerns: SkinConcern[], timeOfDay: "AM" | "PM" | "both"): string {
  const topConcern = concerns[0];
  const timePrefix = timeOfDay === "AM" ? "Morning" : timeOfDay === "PM" ? "Evening" : "Full";
  if (!topConcern) return `${timePrefix} Routine`;
  const concernLabels: Partial<Record<SkinConcern, string>> = {
    acne:              "Clear Skin",
    hyperpigmentation: "Glow & Even Tone",
    redness:           "Calming",
    dryness:           "Deep Hydration",
    oiliness:          "Balanced & Matte",
    texture:           "Smooth & Refined",
    fine_lines:        "Anti-Aging",
    dark_circles:      "Brightening",
    pores:             "Pore-Minimizing",
    sensitivity:       "Gentle Care",
    uneven_tone:       "Even & Radiant",
    dullness:          "Glow-Boosting",
  };
  return `${timePrefix} ${concernLabels[topConcern] ?? "Custom"} Routine`;
}
