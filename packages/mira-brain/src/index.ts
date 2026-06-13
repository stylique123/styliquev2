// @stylique/mira-brain — the one Mira decision core, extracted from the demo
// route so the demo (apps/web) and the Shopify app (apps/shopify-app) can both
// call it. This first slice exports the pure, dependency-free pieces (grounded
// vocabulary, request/decision schemas, currency + text helpers). Later slices
// add the product-grounding helpers (validateHandle/catalogDigest over a
// MiraProduct interface), the system-prompt builder, the Gemini call, and the
// decideMira() entry point with dependency-injected seams.
export * from "./constants.js";
export * from "./schemas.js";
export * from "./text.js";
export * from "./products.js";
export * from "./system.js";
export * from "./gemini.js";
export * from "./policy.js";
export * from "./brain.js";
