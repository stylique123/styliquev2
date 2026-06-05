# Stylique Architecture

## 1. Folder structure (recommended)

```
stylique/
├─ apps/
│  ├─ web/              Next.js 15 — marketing, /demo, /dashboard, /api/shopper/*
│  ├─ shopify-app/      Remix — OAuth, App Proxy, webhooks, theme app extension
│  ├─ widget/           Vanilla TS storefront PDP widget (≤200KB gz)
│  └─ worker/           BullMQ workers for AI + sync + rollups
├─ packages/
│  ├─ db/               Prisma schema + client (single source of truth)
│  ├─ core/             plans, usage, analytics, catalog, brand (no AI deps)
│  ├─ ai/               Provider-agnostic adapters (tryon/studio/styling/colors/fit)
│  ├─ shopify/          Admin/Storefront API wrappers
│  ├─ types/            Zod schemas + TS types shared end-to-end
│  ├─ ui/               Shared React components for web + shopify-app
│  └─ config/           eslint, tsconfig, tailwind preset
├─ docs/                ADRs and this file
└─ infra/               Docker, deploy
```

## 2. Database schema

See `packages/db/prisma/schema.prisma`. Key tables and the rule each enforces:

| Table | Owns | Hard rule it enforces |
| --- | --- | --- |
| `Shop` | Tenancy | All data is shop-scoped. |
| `Plan` | Entitlements | Quotas on usage/creatives/sets/analytics — **no field for product count** (full catalog rule). |
| `UsageCounter` | Metering | `(shop, metric, periodStart)` unique — atomic increments. |
| `Notification` | Brand-facing alerts only | Fair-use warnings live here, never reach shopper. |
| `BrandProfile` | Brand understanding | Trained from Shopify products + uploaded refs + (later) IG. |
| `Product` / `ProductVariant` / `ProductImage` | Catalog mirror | Color + category extracted for Style + Fit. |
| `Asset` | Files | `USER_PHOTO` has retention; `BRAND_REFERENCE` doesn't. |
| `Creative` | Stylique Studio output | Grouped by `setId` for "creative sets" plan limit. |
| `ShopperSession` | Anonymous shopper | No userId — `sessionId` only. Captures minimal inputs. |
| `TryOnSession` | Try-On runs | `mode` distinguishes BODY_MODEL (always on) from PERSONAL_PHOTO (gated). |
| `FitSession` | Size rec + actual choice | Tracks `sizeDelta` for up/down analytics. |
| `StyleSession` | Outfit + color combos | `colorCombosJson` is mandatory output. |
| `AnalyticsEvent` | Append-only event stream | Single source for every dashboard view. |

## 3. Main backend services (`packages/core`)

- `plans.PlansService` — `canConsume`, `consume`, `shouldFireFairUseWarning`. **Every metered action calls this first.**
- `usage.UsageService` — atomic counter increments + period rollover.
- `analytics.AnalyticsService` — `track()`; validates payload against `EventPayloadSchemas`.
- `catalog.CatalogService` — Shopify sync, color extraction, category inference.
- `brand.BrandService` — trains/refreshes `BrandProfile`.
- `notifications.NotificationService` — brand-facing only.

And `packages/ai`:

- `TryOnAdapter`, `StudioAdapter`, `StylingAdapter`, `FitAdapter` — interfaces; swap providers without touching modules.

## 4. Main frontend pages (`apps/web`)

- `/` marketing home
- `/pricing`, `/contact`
- `/demo`, `/demo/[productHandle]` — public showcase with seeded catalog
- `/dashboard` (auth) — Studio, Try-On, Fit, Style, Analytics, Settings

## 5. Main API routes

**Shopper (no auth, called via Shopify App Proxy):**

- `POST /api/shopper/profile` — upsert ShopperSession
- `POST /api/shopper/upload` — presigned URL for personal photo
- `GET  /api/shopper/tryon/entitlement?productId=` — returns `{ personalPhotoAllowed }` so widget can hide the upload control
- `POST /api/shopper/tryon` — enqueue try-on (BODY_MODEL or PERSONAL_PHOTO)
- `POST /api/shopper/fit` — size recommendation
- `POST /api/shopper/style` — outfit + color combos
- `POST /api/shopper/events` — batched analytics

**Brand (session-protected):**

- `GET/POST /api/dashboard/studio/...`
- `GET /api/dashboard/analytics/:view`
- `GET/POST /api/dashboard/plan`, `/api/dashboard/notifications`

## 6. Shopify app structure (`apps/shopify-app`)

- Remix routes: `auth.$`, `app._index`, `app.catalog`, `app.brand`, `app.billing`
- Webhook routes: `webhooks.products`, `webhooks.orders`, `webhooks.uninstalled`
- App Proxy: `proxy.shopper.$` forwards `/apps/stylique/*` → `apps/web /api/shopper/*`
- Theme App Extension: `extensions/stylique-widget/` — Liquid snippet + `<script>` to load widget bundle

## 7. Demo page route

`apps/web/app/demo/` reads from a seeded `Shop { shopifyDomain: "demo.stylique.local" }` with ~20 products covering shirts, trousers, shoes, accessories — enough to exercise Try-On, Fit, Style, and color combos. The widget renders identically to the production storefront widget.

## 8. Analytics event model

Single append-only `AnalyticsEvent` table. Event names enumerated in `EventName` enum; per-event payload contracts in `packages/types` `EventPayloadSchemas`. Dashboard views listed in `packages/core/analytics/DASHBOARD_VIEWS` and materialized by the `analytics-rollup` job. Tracked: try-ons, size choices, size up/down (`sizeDelta`), outfit clicks, color combo views, creative impressions, PDP-improvement signals (high views + low try-on + high size churn).

## 9. Plan / usage model

- `Plan` per shop with: `tier`, quotas (`monthlyTryOnPersonal`, `monthlyTryOnBody`, `monthlyCreatives`, `creativeSets`), `analyticsLevel`, `supportLevel`, `fairUseWarnAt`. **No catalog cap field exists** — full catalog is non-negotiable.
- `UsageCounter` rows per `(shop, metric, periodStart)`. `PlansService.canConsume` returns `{ allowed, hideFromShopper }`. When `TRYON_PERSONAL` is exhausted, the widget hides the upload control; body-model preview keeps working.
- When usage crosses `fairUseWarnAt * quota`, a `Notification { kind: FAIR_USE_REACHED }` is created. The dashboard shows it. Shoppers never see it.

## 10. Exact next implementation steps

1. **Install + bootstrap.** `pnpm install`, fill `.env` from `.env.example`, `docker-compose up -d` for Postgres + Redis (add `infra/docker-compose.yml`), then `pnpm db:migrate`.
2. **`packages/core` skeleton.** Implement `PlansService`, `UsageService`, `AnalyticsService` against Prisma. Unit tests for `canConsume` + `shouldFireFairUseWarning`.
3. **`packages/ai` stub providers.** Mock implementations of all four adapters that return placeholder URLs, so every module can be wired end-to-end before real provider keys.
4. **`apps/shopify-app` OAuth + App Proxy.** Get install flow working against a dev store; create `Shop` row on install; wire `app/uninstalled` webhook.
5. **Catalog sync worker.** `catalog-sync` job + `products/*` webhooks → mirror into `Product`/`ProductImage`. Extract `primaryColor` + `colorFamily`.
6. **`apps/web` shopper APIs.** Implement `/api/shopper/profile`, `/upload`, `/tryon/entitlement`, `/tryon`, `/fit`, `/style`, `/events`. Zod-validate every input.
7. **`apps/widget` v0.** Mounts on PDP via Theme App Extension, calls shopper APIs through App Proxy, renders Try-On (body model only first), Fit, Style tabs.
8. **Stylique Studio v0.** Dashboard `/dashboard/studio` + worker `studio-generate` using the stub adapter. Creative sets grouped by `setId`.
9. **Personal-photo Try-On.** Add `upload` flow, wire entitlement check, confirm widget hides the control when exhausted, dashboard notification fires.
10. **Analytics rollup + dashboard views.** `analytics-rollup` cron + `/dashboard/analytics/*` reads of materialized views.
11. **`/demo` route.** Seed `demo.stylique.local` shop with 20 products. Reuse the same widget — same code path as production.
12. **Swap stub AI providers for real ones** (fal.ai / Replicate / Claude). No module code changes required because of the adapter pattern.

Architecture is frozen at this point — every subsequent module prompt only fills in implementations behind these contracts.
