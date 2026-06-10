// ═══════════════════════════════════════════════════════════════════════════
// Stylique Brain — LEGACY multi-tool stylist surface.
//
// ⚠️  DEPRECATED FOR MIRA. As of the ONE-BRAIN-1 consolidation, the unified
// brain at apps/web/app/api/mira/route.ts is the single truth for Mira; the
// production Mira path forwards through apps/shopify-app/app/lib/
// mira-adapter.server.ts which loads the merchant catalog + BrandProfile DNA
// then calls the unified brain. This package's multi-tool brain (5246 lines
// across 13 files) is NO LONGER on the Mira request path.
//
// Still consumed by the legacy `/api/chat` App Proxy path (apps/shopify-app/
// app/lib/chat.server.ts → apps/shopify-app/app/lib/brain.server.ts →
// `@stylique/ai`) for the production stylist conversation. The /api/chat path
// is scheduled for unification with /api/mira; until that lands, this stays.
//
// DO NOT add new tools or prompt rules here — they will not reach Mira. Land
// any prompt or sales-rule improvements in apps/web/app/api/mira/route.ts so
// they flow through the unified brain to all callers (demo + every Shopify
// merchant simultaneously).
// ═══════════════════════════════════════════════════════════════════════════

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
  seeOnModelToolSchema, seeOnMeToolSchema,
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
