// Stylique Brain — public surface.

export * from "./types.js";
export { ToolRegistry } from "./registry.js";
export { Brain, type BrainConfig, type BrainSignal } from "./brain.js";
export {
  salesStylistVariant,
  defaultStylistVariant,
  concisedStylistVariant,
  beautyAdvisorVariant,
  type PromptVariant,
} from "./prompts.js";

// ─── Hybrid AI + Rules layer ────────────────────────────────────────────
// Multi-model routing (cheap → standard → strong), a cheap pre-flight intent
// classifier, and the deterministic rules engine that validates Brain outputs
// against catalog facts. All optional — wire them into BrainConfig to enable.
export {
  BrainRouter,
  type RoutingTier,
  type RoutingDecision,
} from "./router.js";
export { RulesEngine } from "./rules.js";
export {
  classifyShopperIntent,
  type ClassificationResult,
  type ClassificationIntent,
  type ClassificationComplexity,
  type PageContext,
  type PageType,
} from "./classifier.js";

export { createGeminiProvider } from "./providers/gemini.js";
export { createAnthropicProvider } from "./providers/anthropic.js";
export { createOpenAIProvider } from "./providers/openai.js";

export {
  searchCatalogToolSchema, proposeComboToolSchema,
  navigateToolSchema, addToCartToolSchema, addOutfitToCartToolSchema, offerSignupToolSchema,
  seeOnModelToolSchema, seeOnMeToolSchema, requestCreativeSetToolSchema,
  applyColorRuleToolSchema, suggestOccasionDressingToolSchema,
  compareTwoItemsToolSchema, explainWhyComboWorksToolSchema,
  recallPastPreferenceToolSchema, interpretFitLanguageToolSchema,
  captureShopperProfileToolSchema,
  matchReferencePhotoToolSchema,
  // Guided shopping — Rufus-pattern page-aware tools
  leadBrowseToolSchema,
  guideComboWalkthroughToolSchema,
  highlightProductDetailToolSchema,
  showSizeRecommendationToolSchema,
  // Stock + size-chart intelligence (Request B)
  checkStockToolSchema,
  getSizeChartToolSchema,
  ALL_TOOL_SCHEMAS,
} from "./tools.js";

export { BEAUTY_TOOL_SCHEMAS } from "./beauty-tools.js";
