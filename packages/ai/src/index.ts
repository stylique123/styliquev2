// Public surface of @stylique/ai.
//
// History note:
//   • Sprint 6 dead-code sweep removed four `*Adapter` interfaces
//     (TryOnAdapter, StudioAdapter, StylingAdapter, FitAdapter) that lived
//     here pre-Brain-refactor and had zero importers.
//   • Sprint 6 round 3 deleted `packages/ai/src/chat/` entirely (OI-11).
//     The three types still used externally (`ChatMessage` / `ChatProduct` /
//     `ChatCombo`) live in `brain/types.ts` as `@deprecated` aliases of the
//     `Brain*` shapes for backward compatibility.
//
// Only barrel left.

export * from "./brain/index.js";
