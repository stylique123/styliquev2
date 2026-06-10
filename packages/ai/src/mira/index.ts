// ═══════════════════════════════════════════════════════════════════════════
// Mira — public package surface.
//
// ONE TRUTH consumed by every store (Shopify production, demo, future stores).
// This barrel exports the CONTRACT — input shape, output shape, brand identity,
// catalog product shape, sink callbacks. Every consumer speaks this language.
//
// Architecture intent (target state):
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │  packages/ai/src/mira/  ← THE ONE BRAIN                          │
//   │    types.ts        (contract — DONE this turn)                    │
//   │    schema.ts       (DecisionSchema, BodySchema, route enums)       │
//   │    prompts.ts      (48-block sales prompt, parameterized brand)    │
//   │    enforce.ts      (deterministic route repair + sales policy)     │
//   │    fallback.ts     (catalog-aware resilient fallback)              │
//   │    gemini.ts       (single-shot Flash-default provider)            │
//   │    runMira.ts      (orchestrator — runMira(input, ctx, helpers))   │
//   │    index.ts        (public exports)                                │
//   └──────────────────────────────────────────────────────────────────┘
//                                ▲
//                                │ direct import (no HTTP forward)
//                                │
//          ┌─────────────────────┴────────────────────┐
//          │                                          │
//   apps/shopify-app                          apps/web (demo store)
//   mira-adapter.server.ts                    api/mira/route.ts
//      ├─ Prisma catalog                          ├─ hardcoded 14 products
//      ├─ BrandProfile DNA → brand POV            ├─ Stylique Maison defaults
//      ├─ Plan.knowledge                          ├─ flat-file knowledge
//      ├─ Prisma signals/events                   ├─ flat-file signals
//      ├─ Shop.currencyCode + Accept-Language     ├─ USD + en
//      └─ runMira(input, ctx, helpers)            └─ runMira(input, ctx, helpers)
//
// Current state (this turn):
//   - Contract DONE: packages/ai/src/mira/types.ts exports every type the
//     truth needs (MiraProduct, MiraBrandIdentity, MiraInput, MiraContext,
//     MiraSinks, MiraResult, MiraDecision, route/filter/category/intent enums).
//   - Catalog/brand/knowledge injection plumbed in apps/web brain (it already
//     accepts injectedCatalog + injectedBrand + injectedKnowledge per
//     ONE-BRAIN-1 + MERCHANT-INTELLIGENCE-PLUMBED).
//   - mira-adapter loads merchant Prisma catalog + BrandProfile DNA + Plan
//     stylist override → forwards via HTTP to apps/web brain. ONE behavioural
//     truth even before the physical move completes.
//
// Next turn (the physical port):
//   - Move apps/web/app/api/mira/route.ts brain logic into this package
//     (buildSystem + buildPrompt + enforceExecution + applySalesPolicy +
//     buildResilientFallback + callGemini + attemptModel + anti-repeat guard).
//   - Parameterise the 6 remaining apps/web dependencies as MiraStyleHelpers
//     (buildLook, extractSignals, decideClose, buildClosingContextBlock,
//     buildLookContextBlock) and MiraSinks (recordSignal + 9 emit* callbacks).
//   - apps/web/app/api/mira/route.ts becomes a ~40-line HTTP wrapper.
//   - apps/shopify-app/app/lib/mira-adapter.server.ts calls runMira DIRECTLY
//     (no HTTP forward — pure code import). Saves the round-trip latency.
//   - Delete the multi-tool production brain (packages/ai/src/brain/*) since
//     nothing consumes it anymore.
// ═══════════════════════════════════════════════════════════════════════════

export type {
  MiraProduct,
  MiraBrandIdentity,
  MiraInput,
  MiraContext,
  MiraSinks,
  MiraResult,
  MiraRoute,
  MiraFilter,
  MiraCategoryEnum,
  MiraIntent,
  MiraDecision,
} from "./types.js";

export {
  MIRA_ROUTES,
  MIRA_FILTERS,
  MIRA_CATEGORIES,
  MIRA_INTENTS,
} from "./types.js";
