// Stylique Beauty — package barrel.
// All beauty domain logic lives in this module. Imported by:
//   - apps/shopify-app/app/lib/beauty-brain.server.ts (tool handlers)
//   - apps/worker/src/jobs/beauty-*.ts (background jobs)
//   - packages/ai/src/brain/beauty-tools.ts (context, types)

export * from "./types.js";
export * from "./skin-analysis.js";
export * from "./shade-matching.js";
export * from "./routine-builder.js";
export * from "./ingredient-analyzer.js";
export * from "./merchant-intelligence.js";
