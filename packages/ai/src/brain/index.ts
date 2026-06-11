// ═══════════════════════════════════════════════════════════════════════════
// @stylique/ai — TYPES-ONLY package.
//
// The legacy multi-tool brain runtime (Brain class, ToolRegistry, providers,
// prompts, router, rules, classifier, tool schemas — ~3,200 lines) was DELETED
// in the ONE-BRAIN consolidation. The single Mira brain lives at
// apps/web/app/api/mira/route.ts; the production path forwards through
// apps/shopify-app/app/lib/mira-adapter.server.ts (merchant catalog + brand
// DNA injected per shop). The old /api/chat App Proxy path was removed with it.
//
// What remains here is the shared TYPE vocabulary (BrainMessage, BrainProduct,
// BrainCombo, BrainClientAction, ChatMessage aliases, …) still imported by
// session.server.ts, Tour.tsx, and other surfaces. Do not add runtime code.
// ═══════════════════════════════════════════════════════════════════════════

export * from "./types.js";
