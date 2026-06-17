export * from "./plans/index.js";
export * from "./plans/service.js";
export * from "./plans/features.js";
// P2 — Provider cost catalog + computeCost + per-shop rollup (super-admin).
export * from "./billing/costs.js";
export * from "./usage/service.js";
export * from "./analytics/index.js";
export * from "./analytics/service.js";
export * from "./colors/rules.js";
export * from "./catalog/index.js";
export * from "./fit/service.js";
export * from "./style/service.js";
// D40 — combo color harmony engine + structured combo scoring.
export * from "./style/harmony.js";
export * from "./style/score.js";
// D40 — multi-garment sequential VTO chain.
export * from "./tryon/combo.js";
export * from "./tryon/cache.js";
export * from "./recommendations/service.js";
// Intelligence loop — measure→learn (Outcome tracking).
export * from "./outcomes/index.js";
// Session 1 — monthly merchant optimization report (synthesizer + markdown renderer).
export * from "./reports/monthly.js";
export * from "./reports/render-markdown.js";
export * from "./embeddings/service.js";
export * from "./embeddings/image-match.js";
export * from "./tryon/service.js";
// D35 — image-quality pipeline + Shopify size-chart metafield parser.
export * from "./imagery/index.js";
export * from "./sizing/index.js";
// OI-25 — at-app AES-256-GCM encryption for sensitive DB fields.
export * from "./crypto.js";
// PB6 reversal — multi-language infrastructure stub.
export { t, detectLocale } from "./i18n/index.js";
export type { SupportedLocale, TranslationKey } from "./i18n/index.js";
// Brand DNA — palette / tone / style extracted from the catalog. Feeds Mira's
// voice + the recommendations engine. (Creative Studio generation was removed.)
export * from "./studio/index.js";
// Shared Vertex AI auth helpers (JWT signing, OAuth token exchange, token cache).
export * from "./vertex/auth.js";
