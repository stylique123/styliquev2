# Stylique Fashion AI

Shopify-installable fashion AI suite for fashion brands. Three shopper-facing surfaces sharing one brain, one event mesh, and one shopper identity layer.

## Surfaces

| Surface | What it does |
| --- | --- |
| **Mira — AI Stylist** | Conversational stylist (friend persona). Chat, image input, combo proposals, size capture, cross-surface try-on hand-off. Powered by Gemini 2.5 Flash via the Brain orchestrator. |
| **PDP Widget** | 3-step flow: Try-On (body-model preview, optional personal-photo upload) → Fit (size recommendation) → Style (complete-the-look). No shopper login. |
| **Creative Studio** | Brand-facing AI campaign creative generation. Triggered from Mira combos or the admin dashboard. |

## Hard rules (never break in any module)

1. Full catalog support — never cap by product count.
2. Pricing tiers gate on usage, creative sets, analytics depth, and support — never on catalog size.
3. PDP widget works on mobile + desktop.
4. Shopper flow requires **no login**.
5. Shopper inputs are minimal: height, weight, fit preference, optional body type or photo.
6. When personal-photo try-on usage is exhausted: **hide the upload-photo entry point**, keep body-model preview live. Never show "credits exhausted" to a shopper.
7. The brand dashboard is the only place fair-usage warnings appear.
8. Complete-the-look output must include color combination guidance, not just product picks.

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Web / Dashboard:** Next.js 15 (App Router) + TypeScript + Tailwind CSS — dark editorial theme
- **Shopify embedded app:** Remix + `@shopify/shopify-app-remix`
- **Storefront widget:** vanilla TypeScript bundle, Shopify Theme App Extension, all shopper requests through the Shopify App Proxy (HMAC-authenticated, shopper stays unauthenticated)
- **Worker:** Node + BullMQ (Redis) — 7 queues: catalog-sync, recommendations, creative-set, brand-install, tryon-render, sentiment-extract, image-quality
- **DB:** Postgres + Prisma (`packages/db`)
- **Object storage:** local disk in dev (`STORAGE_PATH`); S3/R2 in prod (OI-31 — not yet wired, `@aws-sdk` not installed)
- **AI — the Brain (`packages/ai/src/brain/`):**
  - Provider-agnostic orchestrator (`Brain` class, `ToolRegistry`, 16 registered tools)
  - **Gemini 2.5 Flash** — primary and only live provider (raw `fetch`, no SDK)
  - Claude / GPT-4 — throw-stubs; `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` are reserved for future use
  - VTO render: Gemini-image (dev), Replicate IDM-VTON (configured via `TRYON_FALLBACK_PROVIDER`); Vertex VTO-001 rebuild pending (OI-29..34)
  - Embeddings: Gemini text-embedding-004 for vector catalog search + reference-photo matching
  - Image quality: Stage 1 heuristic (free, always on) + Stage 2 AWS Rekognition (optional, env-gated)

## Packages

```
apps/
  web/          # Next.js — marketing landing page + client dashboard
  shopify-app/  # Remix — embedded admin app, OAuth, App Proxy, webhooks
  widget/       # Storefront PDP widget (theme app extension)
  worker/       # BullMQ workers for all async AI jobs
packages/
  db/           # Prisma schema + client
  core/         # Plans, usage, analytics, catalog sync, brand profile,
                #   fit engine, style engine, tryon service, imagery pipeline,
                #   embeddings service
  ai/           # Brain orchestrator + tool registry + provider adapters
  types/        # Shared TS types + Zod schemas (shopper inputs, events, plans)
infra/          # Docker Compose for local Postgres + Redis
scripts/        # Dev utilities (set-tunnel-url, real-test)
```

> `packages/shopify`, `packages/ui`, `packages/config` are not present — the README was
> historically ahead of the actual workspace. Shopify API wrappers live in
> `apps/shopify-app/app/lib/shopify.server.ts`. UI components are inlined per app.

## Tiers

**STARTER / GROWTH / ULTIMATE** — all three get every surface; differences are usage caps, analytics depth, which recommendations appear, and support level. Catalog size never gates any tier.

## Key files

| File | Owns |
| --- | --- |
| `apps/shopify-app/app/routes/proxy.shopper.$.tsx` | App Proxy entry — all shopper HTTP |
| `apps/shopify-app/app/lib/shopper.server.ts` | All shopper API handlers (chat, fit, style, signal, account, tryon) |
| `apps/shopify-app/app/lib/brain.server.ts` | Brain singleton, tool handlers, `buildBrainContext()` |
| `packages/ai/src/brain/brain.ts` | Multi-hop tool loop (max 6 hops) |
| `packages/ai/src/brain/tools.ts` | 16 tool schemas |
| `packages/ai/src/brain/providers/gemini.ts` | Real Gemini implementation |
| `apps/shopify-app/app/lib/entitlement.server.ts` | Single source of truth for tier / feature / usage gates |
| `packages/core/src/plans/features.ts` | PLAN_FEATURES matrix |
| `packages/db/prisma/schema.prisma` | All models |

See `CLAUDE.md` for the full architecture decision log, sprint history, open issues, and security invariants.
