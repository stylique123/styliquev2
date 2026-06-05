// Stylique Beauty — core domain types.
// These are the "fit data" equivalent for beauty — everything we capture
// about a shopper's skin so the advisor never asks twice and the routine
// builder has real inputs to work with.

// ─── Skin profile ────────────────────────────────────────────────────────

export type SkinType = "oily" | "dry" | "combination" | "normal" | "sensitive";

export type SkinUndertone = "warm" | "cool" | "neutral" | "olive";

// Monk Skin Tone Scale (Google, open standard — 10-point scale)
// We map to 5 practical depth bands for shade matching.
export type SkinDepth = "light" | "light-medium" | "medium" | "medium-deep" | "deep";

export type SkinConcern =
  | "acne"
  | "hyperpigmentation"
  | "redness"
  | "dryness"
  | "oiliness"
  | "texture"
  | "fine_lines"
  | "dark_circles"
  | "pores"
  | "sensitivity"
  | "uneven_tone"
  | "dullness";

// ITA (Individual Typology Angle) — derived from Lab color values of skin.
// ITA = arctan((L* - 50) / b*) × (180/π)
// ITA > 55° → Very light | 41–55 → Light | 28–41 → Intermediate
// 10–28 → Tan | -30–10 → Brown | < -30 → Dark
export type ITARange = "very_light" | "light" | "intermediate" | "tan" | "brown" | "dark";

export type BeautySkinProfile = {
  // Captured from selfie analysis (Gemini Vision bridge) or manual quiz
  skinType?: SkinType;
  undertone?: SkinUndertone;
  depth?: SkinDepth;
  itaRange?: ITARange;
  // Shopper's actual hex value extracted from selfie (Lab colorspace)
  skinHex?: string;
  // Top concerns ranked by confidence (from vision analysis or shopper input)
  concerns?: SkinConcern[];
  // Seasonal color analysis (Spring/Summer/Autumn/Winter)
  colorSeason?: "spring" | "summer" | "autumn" | "winter";
  // Shade range for foundation (e.g. "NC20-NC25", "W2-W3", "Light-Medium")
  shadeRange?: string;
  // Budget (mirrors ShopperSession.budgetMax)
  budgetMax?: number;
  // Whether we've done a selfie analysis this session
  selfieAnalyzedAt?: string;
};

// ─── Routine step categories ─────────────────────────────────────────────

// Beauty routine taxonomy — the complete chain a brand's catalog maps to.
// "complete the routine" AOV lever: average routine = 3-6 products.
export type RoutineStep =
  | "cleanser"          // face wash, micellar water, balm cleanser
  | "toner"             // toner, essence, mist
  | "serum"             // vitamin C, retinol, hyaluronic acid, niacinamide
  | "eye_cream"         // eye cream, eye serum
  | "moisturizer"       // day cream, gel moisturizer, night cream
  | "spf"               // SPF, tinted SPF, mineral sunscreen
  | "treatment"         // mask, exfoliant, spot treatment, oil
  | "makeup_base"       // primer, color corrector, setting spray
  | "foundation"        // foundation, tinted moisturizer, BB/CC cream
  | "concealer"         // concealer, color corrector
  | "blush_bronzer"     // blush, bronzer, contour
  | "highlight"         // highlighter, luminizer
  | "lip"               // lipstick, lip gloss, lip liner, lip oil
  | "eye_makeup"        // eyeshadow, eyeliner, mascara, brow
  | "setting"           // setting powder, spray
  | "remover";          // makeup remover, cleansing oil

// ─── Shade matching ──────────────────────────────────────────────────────

export type ShadeMatch = {
  productId: string;
  productHandle: string;
  productTitle: string;
  shadeName: string;
  shadeHex?: string;
  matchScore: number;        // 0-1, higher = better match
  matchReason: string;       // "Your warm NC25 undertone matches this W4"
  isRecommended: boolean;    // top pick
};

// ─── Routine recommendation ──────────────────────────────────────────────

export type RoutineProduct = {
  step: RoutineStep;
  productId: string;
  productHandle: string;
  productTitle: string;
  imageUrl: string | null;
  priceUsd: number | null;
  whyForYou: string;         // skin-concern-specific reason
  shadeMatch?: ShadeMatch;   // for color products
  inStock: boolean;
};

export type BeautyRoutine = {
  name: string;              // e.g. "Your AM Glow Routine"
  timeOfDay: "AM" | "PM" | "both";
  steps: RoutineProduct[];
  totalPriceUsd: number | null;
  concernsAddressed: SkinConcern[];
  addToCartItems: Array<{ productId: string; shadeHint?: string }>;
};

// ─── Ingredient analysis ─────────────────────────────────────────────────

export type IngredientSafetyLevel = "safe" | "caution" | "avoid" | "unknown";

export type IngredientAnalysis = {
  name: string;
  isSafe: IngredientSafetyLevel;
  score: number;             // 0 (avoid) - 10 (safe)
  concern?: string;          // why caution/avoid (e.g. "comedogenic", "fragrance-free risk")
  benefitFor?: SkinConcern[];
  isActive: boolean;         // retinol, AHA, vitamin C — require intro protocol
};

export type ProductIngredientReport = {
  productId: string;
  overallSafetyScore: number;
  cleanBeautyBadge: boolean; // no fragrance, parabens, sulfates, phthalates
  keyActives: IngredientAnalysis[];
  flaggedIngredients: IngredientAnalysis[];
  suitableFor: SkinConcern[];
  notSuitableFor: SkinConcern[];
  summary: string;
};

// ─── Merchant intelligence (beauty dashboard) ────────────────────────────

export type ShadeGap = {
  undertone: SkinUndertone;
  depth: SkinDepth;
  requestCount: number;
  requestedTerms: string[];  // what shoppers actually said
  matchedProducts: number;   // how many products we have for this range
  gapSeverity: "critical" | "high" | "medium" | "low";
};

export type ConcernTrend = {
  concern: SkinConcern;
  sessionCount: number;
  weekOverWeekChange: number; // %
  topQueriedTerms: string[];
  productsAddressed: number;  // how many catalog products target this concern
  catalogCoverage: "good" | "partial" | "gap";
};

export type IngredientTrend = {
  ingredient: string;
  requestedCount: number;
  avoidedCount: number;
  trend: "rising" | "stable" | "falling";
};

export type BeautyMerchantIntelligence = {
  shadeGaps: ShadeGap[];
  concernTrends: ConcernTrend[];
  ingredientTrends: IngredientTrend[];
  routineCompletionRate: number;      // % of sessions that add 2+ step products
  returnRiskProducts: Array<{ productId: string; title: string; shadeReturnRisk: number }>;
  replenishmentOpportunities: Array<{ productId: string; title: string; avgDaysToReplenish: number; shopperCount: number }>;
};
