# Mira Agentic Sales Engine Root-Cause Audit

Date: 2026-06-21
Branch: `chore/mira-runtime-closeout`
Audited commit: `9dd1ef7e9eeaa445783179cf58bb086c6544a05a`

This file is the running evidence ledger for the deep review of Mira as an agentic sales engine: shopper understanding, product grounding, action execution, cart truth, learning loop, and commerce intelligence.

The audit does not treat tests or comments as proof by themselves. Every finding below is tied to current code paths and line ranges inspected in this worktree.

## Scope Reviewed In This Pass

- Web runtime entry: `apps/web/app/components/mira/MiraWidget.tsx`
- Web Mira API: `apps/web/app/api/mira/route.ts`
- Brain package: `packages/mira-brain/src/{brain,policy,verify,schemas,constants,planner}.ts`
- Shopify production adapter/proxy/event path:
  - `apps/shopify-app/app/lib/mira-adapter.server.ts`
  - `apps/shopify-app/app/routes/proxy.shopper.$.tsx`
  - `apps/shopify-app/app/routes/api.mira.event.tsx`
  - `apps/shopify-app/app/routes/webhooks.orders.fulfilled.tsx`
- Shopify merchant dashboard and commerce intelligence:
  - `apps/shopify-app/app/lib/dashboard.server.ts`
  - `apps/shopify-app/app/routes/app.dashboard.tsx`
  - `apps/shopify-app/app/lib/fashion-intelligence.server.ts`
- Shopper/session persistence:
  - `packages/db/prisma/schema.prisma`
  - `packages/db/prisma/migrations/20260621000100_add_mira_objective_to_shopper_session/migration.sql`
  - `apps/shopify-app/app/lib/session.server.ts`
- Demo learning loop/intelligence:
  - `apps/web/app/lib/mira-signals.server.ts`
  - `apps/web/app/lib/mira-intelligence.server.ts`

Remaining audit surface for later passes: worker catalog/fit jobs, broader Prisma migration/client-generation workflow, Shopify cart helper live-store proof, widget package shell, try-on render path, auth/billing enforcement, and deployment/runtime config.

## Executive Root Cause

Mira has not been “impossible to fix.” The repeated breakage pattern comes from one architectural mistake repeated in several forms: intent, presentation, action execution, catalog truth, and analytics ownership were split across multiple layers. Fixes landed in one layer while another layer still had an older vocabulary or fallback path.

The current closeout commit has repaired many P0 symptoms, but the codebase still contains multiple projection boundaries that can drift again unless they are centralized and tested as contracts:

- Brain routes and schemas are defined in `packages/mira-brain`.
- Web widget has its own local `MiraDecision` type and route switch.
- Shopify adapter maps brain decisions into another `MiraAdapterResult`.
- Event bridge, adapter analytics, and demo flat-file learning loop each count different pieces of the story.
- Commerce intelligence mixes real learning-loop data with deterministic/synthetic demo intelligence.

That is why prior fixes felt repetitive: each fix corrected one symptom while preserving more than one owner for the same sales behavior.

## Finding 1: Route Vocabulary Drift Still Exists

Severity: P1 after this branch; was P0 for comparison UX correctness.

Evidence:
- Brain route vocabulary includes `compare`: `packages/mira-brain/src/constants.ts:10-26`.
- Decision schema accepts `compareHandles`: `packages/mira-brain/src/schemas.ts:10-24`.
- Verification knows `compare`: `packages/mira-brain/src/verify.ts:73-110`.
- Shopify adapter knows `compare`: `apps/shopify-app/app/lib/mira-adapter.server.ts:640-678`.
- Pre-patch, the web widget local `MiraDecision.route` omitted `compare`: `apps/web/app/components/mira/MiraWidget.tsx:1060-1077`.
- Pre-patch, the web widget `applyDecision` had no `case "compare"`: `apps/web/app/components/mira/MiraWidget.tsx:1335-1515`.
- This branch adds `compare` and `compareHandles` to the widget decision contract: `apps/web/app/components/mira/MiraWidget.tsx:1075-1087`.
- This branch adds a grounded comparison helper that only uses resolved product data: `apps/web/app/components/mira/MiraWidget.tsx:709-722`.
- This branch adds a `compare` presenter route that renders a side-by-side insight plus the verified compared product cards, or degrades honestly if fewer than two handles resolve: `apps/web/app/components/mira/MiraWidget.tsx:1477-1505`.

Impact:
- Before this branch, the brain could correctly decide a side-by-side comparison, and production could attach compared products, but the web presenter could not render the route explicitly.
- After this branch, the shopper UI can render compare turns, but the deeper ownership issue remains: the widget still has its own local route contract instead of consuming a shared presenter contract.

Required fix:
- Export and consume the shared `MiraDecision` type from `@stylique/mira-brain` or a shared UI contract package.
- Keep the real `compare` presenter path in the widget.
- Add browser/runtime regression for “compare two named pieces” proving side-by-side cards render and no unsupported warmth/fabric claims leak.

## Finding 2: Presenter Ownership Is Still Split

Severity: P1 now; historically P0 because it caused fake claims and card drift.

Evidence:
- Brain creates/guards the decision in `decideMira`: `packages/mira-brain/src/brain.ts:257-320`.
- Sales-engine envelope then plans, routes, verifies, applies conversation contracts, and caps voice/chips: `packages/mira-brain/src/brain.ts:334-433`.
- Web widget re-clamps voice, strips prices, chooses cards, creates cart messages, triggers navigation, and opens try-on: `apps/web/app/components/mira/MiraWidget.tsx:1335-1515`.
- Widget action executor separately owns client action truth: `apps/web/app/components/mira/MiraWidget.tsx:2663-2729`.
- `emitResponses` separately interprets sentinel messages and cart cards: `apps/web/app/components/mira/MiraWidget.tsx:2731-2787`.

Impact:
- The brain may verify “no fake success,” but the widget can still rephrase or initiate UI actions in a way the brain cannot see.
- The widget can also strip prices or fill category cards after the brain has made a decision, which is necessary today but proves presentation is not centralized.

Required fix:
- Create a single presenter contract, for example `mira-presenter.ts`, that owns route-to-visible-output mapping, supported UI actions, card count rules, and compare/look/cart sentinel behavior.
- The widget should render presenter output, not reinterpret raw brain decisions.

## Finding 3: The Disabled Regex Fallback Explains Historical Recurrence

Severity: P2 now because it is outside compiled control flow; P0 if re-enabled.

Evidence:
- `getMiraResponse` now returns only a short brain-load failure message: `apps/web/app/components/mira/MiraWidget.tsx:710-718`.
- The old regex fallback remains in a large block comment with product recommendations, size advice, support copy, cart cards, navigation sentinels, hardcoded demo picks, and product filters: `apps/web/app/components/mira/MiraWidget.tsx:720-1051`.

Impact:
- The live path is safer now, but the old code still documents the prior anti-pattern: one client-side fallback attempted to be a second brain, second presenter, and second action router.
- Keeping this code in place increases the chance a future fix reuses or resurrects stale behavior.

Required fix:
- Delete the dead fallback after the presenter contract exists, or move it into an explicit archived doc/test fixture.
- Keep fallback behavior intentionally small: “brain unavailable, retry” only.

## Finding 4: Cart Truth Is Improved But Not Fully Proven In Production

Severity: P0 release gate.

Evidence:
- Verification rewrites fake cart completion claims before client confirmation: `packages/mira-brain/src/verify.ts:36-49` and `packages/mira-brain/src/verify.ts:113-120`.
- Widget `addToBag` only updates visible cart state after `addToCart(...).then(r => r.ok)`: `apps/web/app/components/mira/MiraWidget.tsx:2577-2625`.
- Widget conversion event fires only after success: `apps/web/app/components/mira/MiraWidget.tsx:2588-2605`.
- Shopify proxy records `CART_FROM_MIRA` per tenant on `/api/mira/conversion`: `apps/shopify-app/app/routes/proxy.shopper.$.tsx:213-263`.

Gap:
- The local demo cannot prove real Shopify `/cart/add.js`; the last browser closeout explicitly blocked Flow 6.

Impact:
- Demo/browser flows can pass while the most commercially important invariant remains unproven: when Mira says she is adding, Shopify really accepts the item/variant and the analytics only record that truth.

Required fix:
- Add a live/dev-store proof harness that watches the real `/cart/add.js` request, response, cart count, and `/api/mira/conversion` call.
- Gate deploy on that harness, not on local simulated cart.

## Finding 5: Learning Loop Is Split Across Demo Flat File And Production Analytics

Severity: P1 for brand value proposition.

Evidence:
- Demo `/api/mira` writes one flat-file signal per turn: `apps/web/app/api/mira/route.ts:68-101`.
- Demo conversion is a separate flat-file conversion row: `apps/web/app/lib/mira-signals.server.ts:152-173`.
- Production adapter emits chat/product/cart/catalog-gap analytics directly: `apps/shopify-app/app/lib/mira-adapter.server.ts:885-985`.
- Production proxy conversion writes `CART_FROM_MIRA`: `apps/shopify-app/app/routes/proxy.shopper.$.tsx:213-263`.
- Event bridge also writes analytics and sometimes catalog gaps: `apps/shopify-app/app/routes/api.mira.event.tsx:109-138`.

Impact:
- The brand-facing “learning loop” can show different truth depending on whether data came from demo, adapter events, bridge events, proxy conversions, or dashboard aggregations.
- There is no single canonical `MiraTurnFact` / `MiraConversionFact` event contract enforced across demo and production.

Required fix:
- Define canonical event facts: `mira_turn`, `mira_recommendation_served`, `mira_add_attempted`, `mira_add_confirmed`, `mira_gap`, `mira_near_miss`, `mira_support_intent`.
- Adapt demo flat-file and Prisma analytics from the same typed event contract.
- Add a parity test: same input turn produces the same canonical facts in demo and production adapter.

## Finding 6: Commerce Intelligence Still Blends Real And Synthetic Signals

Severity: P1 for merchant trust.

Evidence:
- `buildFashionIntelligence` reads real `aggregateInsights()`: `apps/web/app/lib/mira-intelligence.server.ts:209-211`.
- Color rows, size distribution, fit prefs, occasion shares, combo rows, conversion lift, drop-off, full-look multiplier, and stylist spend lift are deterministic/modelled values rather than measured tenant facts: `apps/web/app/lib/mira-intelligence.server.ts:214-360`.

Impact:
- This is acceptable for a demo dashboard, but not for a real brand intelligence product.
- If presented without labeling, it violates the core promise: brands pay for what their shoppers are actually teaching them.

Required fix:
- Mark synthetic/demo intelligence explicitly at the API/UI boundary.
- For production, derive these blocks from Prisma analytics/events or hide them until measured.
- Add source metadata to every intelligence card: `measured`, `modelled`, `demo`, or `insufficient_data`.

## Finding 7: Objective Memory Is Session-Scoped But Not Server-Canonical In Production

Severity: P2 after this branch; was P1 for “agentic” continuity.

Evidence:
- Brain supports `priorObjective`: `packages/mira-brain/src/schemas.ts:107-111`.
- Brain returns updated objective: `packages/mira-brain/src/brain.ts:421-433`.
- Widget stores objective in `sessionStorage` and sends it each turn: `apps/web/app/components/mira/MiraWidget.tsx:345-421` and `apps/web/app/components/mira/MiraWidget.tsx:2890-2914`.
- Pre-patch, the Shopify adapter passed objective through but did not persist it server-side beyond client replay: `apps/shopify-app/app/lib/mira-adapter.server.ts:788-822` and `apps/shopify-app/app/lib/mira-adapter.server.ts:1017`.
- This branch adds `ShopperSession.miraObjectiveJson` and `miraObjectiveUpdatedAt`: `packages/db/prisma/schema.prisma:277-278`.
- This branch adds the deploy migration for those columns: `packages/db/prisma/migrations/20260621000100_add_mira_objective_to_shopper_session/migration.sql:1-3`.
- This branch adds server helpers to read and persist the canonical objective: `apps/shopify-app/app/lib/session.server.ts:258-274`.
- This branch makes the Shopify adapter prefer the saved server objective over the browser hint before calling the brain, and persist the returned objective after the turn: `apps/shopify-app/app/lib/mira-adapter.server.ts:735-752`, `apps/shopify-app/app/lib/mira-adapter.server.ts:816`, and `apps/shopify-app/app/lib/mira-adapter.server.ts:1020-1022`.
- This branch adds focused persistence tests for objective read/write behavior: `apps/shopify-app/app/lib/session.server.test.ts:65-94`.

Impact:
- Before this branch, the agentic loop depended on browser session continuity. If storage cleared, cross-device sessions split, or client replay failed, the brain lost objective state despite having a server-side shopper session.
- After this branch, the server has the canonical objective for the current shopper/store cookie. The browser copy is still useful as a rollout fallback, but no longer the primary memory source.

Required fix:
- Keep persisting objective on `ShopperSession` and treat client objective as a hint.
- Add a browser/runtime regression proving a page refresh or cleared `sessionStorage` does not make Mira forget rejected products or the active shopping mission.
- Ensure deploy flow runs the new migration and Prisma client generation before release.

## Finding 8: Catalog Hydration Still Has A Client/Server Race

Severity: P1 for live storefront first-turn correctness.

Evidence:
- Widget hydrates storefront catalog from `/products.json` on mount: `apps/web/app/components/mira/MiraWidget.tsx:1217-1240` and `apps/web/app/components/mira/MiraWidget.tsx:2062-2070`.
- `byHandle` refuses demo catalog on storefront, returning null until hydration succeeds: `apps/web/app/components/mira/MiraWidget.tsx:1242-1252`.
- `currentProduct()` depends on `byHandle`: `apps/web/app/components/mira/MiraWidget.tsx:2259-2263`.
- If hydration fails, the storefront try-on button opens Mira rather than wrong demo product: `apps/web/app/components/mira/MiraWidget.tsx:2272-2283`.

Impact:
- This is safer than showing phantom demo products, but it means first-turn contextual understanding can still fail when `/products.json` is unavailable, blocked, delayed, or the store uses unusual URL/product APIs.

Required fix:
- Inject current product JSON server-side into the widget bootstrap when installing the Shopify extension.
- Treat `/products.json` as enrichment, not the only source for PDP context.

## Finding 9: Event Naming Aliases Reveal Legacy Dashboard Drift

Severity: P2 now; P1 if dashboards depend on old names without parity tests.

Evidence:
- Production adapter emits legacy `CHAT_*` events: `apps/shopify-app/app/lib/mira-adapter.server.ts:897-946`.
- Event bridge accepts both `CHAT_NEAR_MISS` and `MIRA_NEAR_MISS`: `apps/shopify-app/app/routes/api.mira.event.tsx:31-57`.
- Closeout changed dashboard aliases elsewhere, but the system still carries both vocabularies.

Impact:
- Multiple event names for the same business fact create counting and dashboard-maintenance risk.

Required fix:
- Move to canonical `MIRA_*` event facts, keep aliasing only at ingestion, and add dashboard tests proving aliases count once.

## Finding 10: Assisted Revenue Attribution Misses The New Mira Cart Event

Severity: P1 for merchant ROI truth.

Evidence:
- Widget records `/api/mira/conversion` only after successful cart add: `apps/web/app/components/mira/MiraWidget.tsx:2588-2605`.
- Shopify proxy persists that event as `CART_FROM_MIRA`: `apps/shopify-app/app/routes/proxy.shopper.$.tsx:213-263`.
- Dashboard headline counts `CART_FROM_MIRA`: `apps/shopify-app/app/lib/dashboard.server.ts:401-410`.
- Pre-patch order fulfillment attribution searched only `CHAT_CART_REQUESTED` and `COMBO_ADD_ALL`: `apps/shopify-app/app/routes/webhooks.orders.fulfilled.tsx:158-194`.
- This branch now searches `CHAT_CART_REQUESTED`, `MIRA_ADD_TO_CART_ASSIST`, `CART_FROM_MIRA`, `CART_FROM_WIDGET_STYLE`, and `COMBO_ADD_ALL`: `apps/shopify-app/app/routes/webhooks.orders.fulfilled.tsx:187-204`.
- Product-id extraction is now centralized and tested in `apps/shopify-app/app/lib/mira-attribution.server.ts:1-36`.

Impact:
- A successful Mira cart add can appear in engagement metrics but fail to become `MIRA_ASSISTED_ORDER` revenue when the order webhook arrives.
- This creates the exact kind of founder/CFO trust break the product is trying to avoid: “Mira drove carts but revenue is zero/low.”

Required fix:
- Keep `CART_FROM_MIRA`, `MIRA_ADD_TO_CART_ASSIST`, and `CART_FROM_WIDGET_STYLE` in attribution, with precise semantics:
  - `MIRA_ADD_TO_CART_ASSIST` / `CHAT_CART_REQUESTED`: intent or assist, not confirmed add.
  - `CART_FROM_MIRA`: confirmed widget cart mutation.
  - `MIRA_ASSISTED_ORDER`: fulfilled order revenue attribution.
- Current branch adds pure attribution coverage for direct `productId`, `payload.productId`, `payload.productIds`, ignored non-order products, and dedupe: `apps/shopify-app/app/lib/mira-attribution.server.test.ts:1-44`.
- Still add a full order-webhook integration test proving a `CART_FROM_MIRA` event within the attribution window creates `MIRA_ASSISTED_ORDER` with real line value.

## Finding 11: Cart Helper Is Source-Honest But Environment-Proof Is Missing

Severity: P0 release gate until live-store proof exists.

Evidence:
- `addToCart` detects storefront mode via `window.Shopify` or `__sqAssetBase`: `apps/web/app/lib/storefront-cart.ts:12-18`.
- It resolves a variant from `/products/<handle>.js`: `apps/web/app/lib/storefront-cart.ts:42-51`.
- It posts a real `/cart/add.js` request and returns `real:true`: `apps/web/app/lib/storefront-cart.ts:53-79`.
- Pre-patch, `pickVariantId` fell back to `variants[0]` when every variant was explicitly unavailable, which could post a sold-out variant to `/cart/add.js`: `apps/web/app/lib/storefront-cart.ts:20-40`.
- This branch now returns `variant_not_found` when no available variant exists, rather than posting a known sold-out variant: `apps/web/app/lib/storefront-cart.ts:20-40`.
- It has a local mocked harness proving the helper fires `/cart/add.js`, skips cart POST for sold-out-only products, and dispatches no success event on Shopify rejection: `apps/web/scripts/verify-cart.mjs:1-178`.

Impact:
- The helper is not fake at source level, but the existing harness is mocked. It proves intent and control flow, not compatibility with a live Shopify theme/product/variant shape.
- Before this branch, the helper could still waste a cart request on a known unavailable variant, increasing the chance of shopper-visible cart failure.
- This is why Flow 6 remained blocked in closeout even though the helper code is materially improved.

Required fix:
- Add a Playwright/live-store harness that runs on an installed Shopify dev store and asserts:
  - `/products/<handle>.js` returns variants.
  - `/cart/add.js` is called with a numeric variant ID.
  - Shopify returns 200.
  - The cart contains the line.
  - `/api/mira/conversion` records `CART_FROM_MIRA`.

## Finding 12: Fashion Intelligence Is Computed But Not Rendered In The Merchant Dashboard

Severity: P2 after this branch; was P1 for product value perception while hidden.

Evidence:
- `buildOverview` computes `fashionIntelligence`: `apps/shopify-app/app/lib/dashboard.server.ts:725-782`.
- Pre-patch, the embedded Shopify dashboard route rendered outcome metrics, engagement, reorder intelligence, and top looks, but did not render the `fashionIntelligence` object: `apps/shopify-app/app/routes/app.dashboard.tsx:76-239`.
- This branch now renders a compact, source-labelled Fashion Intelligence section from `d.fashionIntelligence`, including data mode, real signal count, executive cards, style shares, combo asks, and gated conversion metrics: `apps/shopify-app/app/routes/app.dashboard.tsx:74-75` and `apps/shopify-app/app/routes/app.dashboard.tsx:158-230`.
- The only dashboard-style rendering of `fashionIntelligence` found in this pass is the web demo/admin page: `apps/web/app/dashboard/page.tsx`.

Impact:
- Before this branch, the commerce-intelligence engine could calculate fashion/category/customer insights while the actual Shopify merchant surface hid them.
- The remaining risk is no longer total invisibility; it is claim-level honesty and regression protection.

Required fix:
- Keep the source-labeled Fashion Intelligence section in the embedded Shopify dashboard.
- Include empty/loading states that distinguish “not enough real data yet” from “modelled/demo directional insight.”
- Add a route-level test or screenshot check that the dashboard renders `fashionIntelligence` when present.

## Finding 13: Fashion Intelligence Has Data-Mode Gates But Some Cards Still Blend Real And Modelled Claims

Severity: P2 after this branch; was P1 once surfaced to merchants without labels.

Evidence:
- `FashionIntelligence` exposes `dataMode`, `realSignalCount`, and `gates`: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:119-129`.
- The builder derives `realSignalCount` and `dataMode`: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:262-266`.
- Conversion intelligence still includes fixed/modelled values such as `confidenceScore: 74`, `fullLookMultiplier: 3.2`, and `stylistSpendLift: 0.48`: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:444-482`.
- Compatibility, capsule collections, emerging trends, and executive cards include generated/modelled claims: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:538-573`.
- This branch adds `InsightSource`, `source`, and `sourceDetail` to executive cards: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:47-48` and `apps/shopify-app/app/lib/fashion-intelligence.server.ts:109-118`.
- This branch labels each executive card as measured, modelled, or insufficient-data based on the specific claim path: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:573-632`.
- The embedded Shopify dashboard now renders per-card source badges and explanations: `apps/shopify-app/app/routes/app.dashboard.tsx:44-52` and `apps/shopify-app/app/routes/app.dashboard.tsx:183-190`.
- The web demo/admin dashboard now accepts and renders the same optional source fields: `apps/web/app/dashboard/page.tsx:172-180`, `apps/web/app/dashboard/page.tsx:412-416`, and `apps/web/app/dashboard/page.tsx:595-598`.

Impact:
- Before this branch, the code had the right object-level honesty primitive, but the executive claim presentation was not source-honest.
- After this branch, the most visible executive cards no longer read as equally measured. The remaining risk is deeper: lower-level conversion/style rows still carry some modelled values without row-level provenance.

Required fix:
- Keep source/confidence labels on executive cards.
- Extend source/confidence labels to lower-level conversion, style, compatibility, collection, trend, fit, and colour rows, not only the executive summary.
- Gate merchant-facing quantified uplift claims behind real signal thresholds.
- Keep modelled/demo cards visibly marked as directional until backed by enough measured sessions/orders.

## Finding 14: Official Event Payload Contract Drifted From Order Webhook Reality

Severity: P1 for learning-loop reliability; P0 if analytics writes are centralized without this repair.

Evidence:
- The analytics service validates payloads through `safeParseEventPayload`: `packages/core/src/analytics/service.ts:5-15`.
- The service contract says modules should emit through `AnalyticsService` instead of direct Prisma writes: `packages/core/src/analytics/index.ts:1-20`.
- The fulfilled-order webhook writes `CART_CONFIRMED` payloads with `source`, `orderId`, `quantity`, `lineValue`, `linkMethod`, and `linkConfidence`: `apps/shopify-app/app/routes/webhooks.orders.fulfilled.tsx:139-155`.
- The same webhook writes `MIRA_ASSISTED_ORDER` payloads with `assistedUnits`, `linkMethod`, and `linkConfidence`: `apps/shopify-app/app/routes/webhooks.orders.fulfilled.tsx:222-239`.
- Pre-patch type schemas did not accept the webhook revenue payload shape. This branch updates `CART_CONFIRMED` and `MIRA_ASSISTED_ORDER` schemas to match the authoritative order events: `packages/types/src/index.ts:317-327` and `packages/types/src/index.ts:447-455`.
- This branch adds analytics coverage for the order-webhook revenue payloads: `packages/core/src/__tests__/analytics.test.ts:91-129`.

Impact:
- Direct Prisma writes made the mismatch invisible.
- Any future cleanup that moved the webhook to `AnalyticsService` would have rejected the very events dashboards and reports depend on.
- This is another exact recurrence pattern: comments and services describe one contract, the live money path emits another.

Required fix:
- Keep the official payload schemas aligned with every server-authoritative event writer.
- Continue migrating direct `prisma.analyticsEvent.create` writes to `AnalyticsService`, but only after payload schemas and tests are in place.
- Add a contract test per money event: `CART_CONFIRMED`, `CART_FROM_MIRA`, `MIRA_ASSISTED_ORDER`, `CART_CANCELLED`.

## Finding 15: Plan Quota Overrides Treated Explicit `null` As Missing Instead Of Unlimited

Severity: P1 for shopper-facing try-on availability and merchant entitlement trust.

Evidence:
- Plan quota type defines `number | null`, where `null` means unlimited/ungated: `packages/core/src/plans/index.ts:13-20` and `packages/core/src/plans/index.ts:46-57`.
- Demo seed creates `monthlyTryOnBody: null`: `packages/db/src/seed.ts:149-160`.
- The existing test expected `TRYON_BODY` with a null quota to stay allowed after heavy usage: `packages/core/src/__tests__/plans.test.ts:48-54`.
- Pre-patch `quotasFromPlan` used `??`, so explicit database `null` fell back to tier defaults: `packages/core/src/plans/service.ts:28-37`.
- This branch preserves explicit `null` and only falls back on `undefined`: `packages/core/src/plans/service.ts:28-40`.

Impact:
- A merchant/admin override intended to make a feature unlimited could silently become capped.
- For Mira, this can remove body-model fallback or other shopper-facing capabilities even when the plan row says they should remain available.

Required fix:
- Treat explicit `null` quota values as real configuration, not missing data.
- Add plan tests for every nullable quota field, not only `TRYON_BODY`.
- Make internal admin UI label `null` as “Unlimited” so ops teams do not mistake it for unset.

## Finding 16: Async Try-On Cache Hits Were Successful UX But Invisible Intelligence

Severity: P1 for commerce intelligence and try-on funnel truth.

Evidence:
- The synchronous try-on path emits `TRYON_RENDER_COMPLETED` even on BODY_MODEL cache hits: `apps/shopify-app/app/lib/tryon.server.ts:318-343`.
- The async worker cache-hit branch updated the pending `TryOnSession` to `SUCCEEDED` and returned early, but pre-patch it emitted no analytics event: `apps/worker/src/jobs/tryon-render.ts:125-153`.
- Monthly reports use `TRYON_RENDER_COMPLETED` to compute try-on abandon risk and co-engagement bundles: `packages/core/src/reports/monthly.ts:223-245` and `packages/core/src/reports/monthly.ts:303-316`.
- Merchant dashboard VTO tiles count `TRYON_RENDER_COMPLETED`: `apps/shopify-app/app/lib/dashboard.server.ts:511-529`.
- Fashion intelligence uses `TRYON_RENDER_COMPLETED` in conversion intelligence: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:444-452`.
- This branch now emits `TRYON_RENDER_COMPLETED` with `cached: true` in the async worker cache-hit branch: `apps/worker/src/jobs/tryon-render.ts:135-168`.

Impact:
- The shopper saw a successful cached try-on, but the brand dashboard/report could undercount completions.
- This makes the caching optimization look like lower engagement, which is exactly backwards: faster cached renders should improve the product and be visible as product value.

Required fix:
- Keep cache hits free for usage/billing, but count them as successful shopper experiences.
- Add a worker-level test harness or fake Prisma test for `processTryOnRender` cache-hit analytics.
- Longer term, centralize try-on analytics emission so sync and async paths cannot drift again.

## Finding 17: Top Combo Recommendations Inflated Clicks Across Every Combo

Severity: P1 for merchant action quality.

Evidence:
- Production emits combo proposals with product ids in `CHAT_COMBO_PROPOSED`: `apps/shopify-app/app/lib/mira-adapter.server.ts:1028-1049`.
- Pre-patch `genTopCombos` read `CHAT_PRODUCT_CLICKED`, but incremented `clicked` for every combo whenever any click payload had a handle, without checking whether the clicked product belonged to that combo: `packages/core/src/recommendations/service.ts:194-205`.
- This branch now resolves clicked product ids and increments only combos containing the clicked product: `packages/core/src/recommendations/service.ts:194-221`.
- This branch adds a regression proving an unrelated click does not inflate another combo: `packages/core/src/__tests__/recommendations.test.ts:399-451`.

Impact:
- Merchants could be told a combo was “top-performing” even if clicks belonged to a different combo.
- That corrupts the “what should I merchandise/promote?” layer of the product: the recommendation feels data-backed but is mathematically loose.

Required fix:
- Keep combo engagement attribution product-specific, not session/global.
- Strengthen `CHAT_PRODUCT_CLICKED` payloads to carry `comboName` when the click came from a combo card, so future attribution can avoid handle/product lookup.
- Add dashboard/report assertions that combo CTR is computed from matching combo membership.

## Finding 18: Monthly Reports Used The Old Cart Intent Event As The Whole Add-To-Bag Funnel

Severity: P1 for merchant report accuracy.

Evidence:
- Runtime cart attribution now has several cart-assist/add events: `CHAT_CART_REQUESTED`, `MIRA_ADD_TO_CART_ASSIST`, `CART_FROM_MIRA`, `CART_FROM_WIDGET_STYLE`, and `COMBO_ADD_ALL`: `apps/shopify-app/app/routes/webhooks.orders.fulfilled.tsx:187-204`.
- This branch now defines the canonical cart-assist event set and legacy aliases in one core contract: `packages/core/src/analytics/cart-events.ts:1-22`.
- The embedded dashboard now imports that shared alias map instead of defining a local one: `apps/shopify-app/app/lib/dashboard.server.ts:21` and `apps/shopify-app/app/lib/dashboard.server.ts:345-348`.
- Pre-patch, the monthly report counted add-to-bag activity only through `CHAT_CART_REQUESTED`: `packages/core/src/reports/monthly.ts:269`.
- Pre-patch, bundle co-intent also counted only `CHAT_CART_REQUESTED`: `packages/core/src/reports/monthly.ts:354-358`.
- This branch makes the monthly report consume the shared event set for both funnel `atcEvents` and bundle co-intent: `packages/core/src/reports/monthly.ts:27`, `packages/core/src/reports/monthly.ts:285-288`, and `packages/core/src/reports/monthly.ts:375-381`.
- This branch makes order-webhook attribution consume the same shared set: `apps/shopify-app/app/routes/webhooks.orders.fulfilled.tsx:19` and `apps/shopify-app/app/routes/webhooks.orders.fulfilled.tsx:189-196`.
- This branch first fixed the Mira-engaged cohort export undercount by including all cart-assist/add events in the cohort touchpoint query instead of only `CHAT_CART_REQUESTED`; Finding 87 later splits the exported `hadCart` success flag from `hadCartIntent`.
- This branch adds a report regression proving all five current cart event names count in the monthly funnel: `packages/core/src/__tests__/monthly-report.test.ts:54-74`.
- This branch adds a core contract regression for the canonical cart-assist alias set: `packages/core/src/__tests__/analytics.test.ts:1-19`.

Impact:
- After the cart fixes, confirmed Mira cart mutations could show in dashboard/order attribution while monthly reports undercounted the same behavior.
- The same undercount also affected the exportable Mira-engaged audience: a shopper with `CART_FROM_MIRA` could be omitted from the cohort entirely when the export only looked for `CHAT_CART_REQUESTED`.
- This is another example of why fixes seemed to “not stick”: the event vocabulary was patched in one business surface but not every downstream report.

Required fix:
- Keep report/dashboard/attribution/cohort cart event aliases in one shared helper, not local lists.
- Separate intent events from confirmed cart mutation events in the next schema cleanup, then report both explicitly instead of blending them under “Add-to-bag.”

## Finding 19: Mira Source Fixes Could Miss The Live Storefront Because The Browser Bundle Was Stale

Severity: P0 for release trust. This directly explains why a fixed `MiraWidget.tsx` could still look broken on merchant storefronts.

Evidence:
- The storefront ScriptTag is installed as `${appUrl}/widget.js`: `apps/shopify-app/app/services/scriptTag.server.ts:76-82`.
- The Remix route for `/widget.js` serves `apps/shopify-app/public/widget.js` first: `apps/shopify-app/app/routes/public.widget[.js].tsx:10-25`.
- The widget build compiles `apps/widget/src/mira-demo.tsx`, which imports the real web Mira widget from `apps/web/app/components/mira/MiraWidget.tsx`: `apps/widget/src/mira-demo.tsx:1-3`.
- Pre-patch file timestamps showed `apps/web/app/components/mira/MiraWidget.tsx` newer than both served bundles, and the repaired compare strings (`Side by side`, `I could not verify two real pieces...`) existed only in source, not `apps/shopify-app/public/widget.js` or extension `tryon.js`.
- The Shopify app Docker build generated Prisma and ran only `pnpm --filter @stylique/shopify-app build`, so production image creation could skip the widget build entirely: `apps/shopify-app/Dockerfile:23-28`.
- The public widget route fallback pointed to `extensions/stylique-widget/assets/widget.js`, but the active widget build emits `tryon.js`: `apps/widget/esbuild.config.mjs:34-37`.
- This branch now runs `pnpm --filter @stylique/widget build && pnpm --filter @stylique/widget verify:bundle` during Shopify app image creation: `apps/shopify-app/Dockerfile:26-29`.
- This branch fixes the route fallback to `extensions/stylique-widget/assets/tryon.js`: `apps/shopify-app/app/routes/public.widget[.js].tsx:10-13`.
- This branch adds `apps/widget/scripts/verify-bundle.mjs`, which fails if `public/widget.js` and extension `tryon.js` are not byte-identical or if the known compare-patch strings are missing.
- After rebuilding, `pnpm --filter @stylique/widget verify:bundle` passed and `cmp` confirmed `apps/shopify-app/public/widget.js` and `apps/shopify-app/extensions/stylique-widget/assets/tryon.js` are byte-identical.

Impact:
- Engineers could correctly patch the shared Mira source, pass TypeScript, and still ship an old browser bundle to actual shoppers.
- That creates the worst debugging loop: every new fix appears ineffective because production is not necessarily running it.
- ScriptTag and theme-app-embed entry points can drift unless byte identity is enforced.

Required fix:
- Keep the widget build and bundle verifier in every production Shopify app image build.
- Add CI/release checks that run `pnpm --filter @stylique/widget build` and `pnpm --filter @stylique/widget verify:bundle` before deploy.
- Prefer a content-hashed or versioned ScriptTag URL long-term. The current route uses `no-cache`, but an unversioned URL still makes release proof harder than it should be.

## Finding 20: Nightly Fit/Look Learning Still Used The Old Cart Event Vocabulary

Severity: P1 for the autonomous learning loop. Dashboards and reports could be corrected while the tuner still learned from stale funnel math.

Evidence:
- The canonical cart-assist family now lives in `packages/core/src/analytics/cart-events.ts:1-22` and is consumed by monthly reports, order attribution, embedded dashboard aliases, and cohort export.
- Pre-patch, the nightly fit/look tuner read only `CHAT_CART_REQUESTED` as the cart denominator: `apps/worker/src/jobs/fit-tuner.ts:78-102`.
- The same tuner writes back into `Plan.planFeaturesJson.fashion`, which can influence future look ranking and merchant learning: `apps/worker/src/jobs/fit-tuner.ts:162-172`.
- Pre-patch, a shop with enough confirmed cart mutations from `CART_FROM_MIRA`, `MIRA_ADD_TO_CART_ASSIST`, `CART_FROM_WIDGET_STYLE`, or `COMBO_ADD_ALL` could still have `cartConvertRate30d` omitted or understated.
- Pre-patch, valid 0% rates were treated as “no signal” by `if (!addAllRate && !cartConvertRate && !keepBiasBySize)`, so a statistically meaningful failure rate could be dropped instead of learned from.
- This branch imports `MIRA_CART_ASSIST_EVENT_NAMES` into the tuner and uses that shared event family for both the query and cart denominator: `apps/worker/src/jobs/fit-tuner.ts:28`, `apps/worker/src/jobs/fit-tuner.ts:83-104`.
- This branch changes the no-signal guard to nullish checks, preserving real zero rates: `apps/worker/src/jobs/fit-tuner.ts:151`.

Impact:
- Mira could keep optimizing from a narrower, older event vocabulary while merchant reports showed the newer truth.
- This is the same recurrence pattern as Finding 18, but in the feedback loop itself: analytics fixes landed in reporting surfaces without updating the system that changes future behavior.
- A zero conversion rate is important negative evidence. Dropping it makes the learning loop optimistic by omission.

Required fix:
- Keep all cart funnel learning consumers on `MIRA_CART_ASSIST_EVENT_NAMES`.
- Add a worker/service-level test for `tuneFitAndLook` proving non-`CHAT_CART_REQUESTED` events count and valid zero rates still write measured metrics.
- Longer term, split `cart intent`, `cart mutation succeeded`, and `order attributed` into separate named contracts so learning does not blend different stages.

## Finding 21: Product Webhooks Could Leave Inactive Products And Removed Variants In Mira's Catalog Truth

Severity: P1 for shopper trust and cart correctness.

Evidence:
- Full catalog sync deletes inactive Shopify products when `normalizeProduct(...).isActive` is false: `packages/core/src/catalog/sync.ts:105-111`.
- Pre-patch, single-product sync did not mirror that guard. A product update webhook returning `status: "draft"` or `status: "archived"` still called `upsertNormalized`, keeping the product available locally.
- Pre-patch, `upsertNormalized` upserted current variants but never deleted variants removed from Shopify: `packages/core/src/catalog/sync.ts:46-65`.
- Mira, fit sizing, and cart selection all depend on local `Product` and `ProductVariant` rows as product truth. Stale rows can keep discontinued sizes or inactive products visible to recommendations/cart flows.
- This branch makes `syncOne` delete local products when Shopify marks them inactive: `packages/core/src/catalog/sync.ts:130-135`.
- This branch prunes local variants not present in the latest normalized Shopify product: `packages/core/src/catalog/sync.ts:66-72`.
- This branch adds catalog regressions proving single-product draft updates delete the product and single-product variant removals prune stale variants: `packages/core/src/__tests__/catalog.test.ts:184-226`.

Impact:
- A merchant could archive a product or remove a size in Shopify, but Mira could still recommend or attempt to cart it from stale local rows.
- This creates a false “Mira failed” symptom even though the immediate failure is catalog truth drifting away from Shopify.
- The bug is worse on webhook/single-product paths than full sync, which explains intermittent recurrence: a nightly/full sync might eventually repair data, while webhook-driven updates stayed wrong in between.

Required fix:
- Keep full-sync and single-product-sync deletion semantics identical for inactive products.
- Treat variants as replace-by-current-set, not append/upsert-only.
- Add a live-store cart proof gate that attempts carting only currently available Shopify variants, because catalog correctness and cart correctness are one shopper-facing contract.

## Finding 22: Widget Injection Could Target The Wrong App URL And Leave Legacy Duplicate Widgets

Severity: P0 for live storefront trust in multi-environment deployments.

Evidence:
- The injection health job re-ensures a ScriptTag on every active shop: `apps/worker/src/jobs/inject-widget.ts:1-20`.
- Pre-patch, `SHOPIFY_APP_URL` defaulted to `https://stylique-app-production.up.railway.app`: `apps/worker/src/jobs/inject-widget.ts:18-19`.
- Pre-patch, the worker required `DATABASE_URL`, `REDIS_URL`, `SHOPIFY_API_KEY`, and `SHOPIFY_API_SECRET`, but not `SHOPIFY_APP_URL`: `apps/worker/src/index.ts:42`.
- That means a staging/local/misconfigured worker could inject the production widget URL into a merchant storefront instead of failing closed.
- Pre-patch, the injection job checked only the current `${APP_URL}/widget.js` source and did not remove legacy `${APP_URL}/public/widget.js` or `${APP_URL}/public/stylist.js` tags from active shops. Uninstall cleanup knew about those legacy paths, but active-shop health did not: `apps/shopify-app/app/services/scriptTag.server.ts:109-122`.
- Pre-patch, `scriptTagCreate` userErrors were ignored in the injection worker, so a failed create could still be counted as ensured.
- This branch adds `SHOPIFY_APP_URL` to the worker required-env list: `apps/worker/src/index.ts:42`.
- This branch removes the hard-coded production fallback, normalizes trailing slashes, and throws if the URL is missing: `apps/worker/src/jobs/inject-widget.ts:15-35`.
- This branch deletes legacy ScriptTags during the active-shop health check before ensuring the current tag: `apps/worker/src/jobs/inject-widget.ts:62-86`.
- This branch checks `scriptTagCreate.userErrors` and treats them as job errors: `apps/worker/src/jobs/inject-widget.ts:103-107`.

Impact:
- A store could run a stale/duplicate widget even after source and bundle fixes.
- A non-production worker could mutate real merchant storefronts to load the production widget, making debugging and rollback extremely confusing.
- Ignored Shopify mutation errors hide installation failures until a merchant notices Mira missing.

Required fix:
- Treat `SHOPIFY_APP_URL` as required in every worker deployment.
- Keep active-shop ScriptTag health and uninstall cleanup using the same current/legacy source list.
- Add operational alerting when injection errors are non-zero, because “Mira not appearing” is a revenue-impacting failure, not a background warning.

## Finding 23: Billing Confirmation And Enforcement Used Different JSON Contracts

Severity: P0 for commercial viability and paid feature trust.

Evidence:
- Billing checkout confirmation wrote nested `planFeaturesJson.billing = { status, subscriptionId, tier }`: `apps/shopify-app/app/routes/app.billing.tsx:82-98`.
- Entitlement enforcement, when `BILLING_ENFORCED=1`, only recognized top-level `billingActive === true` or `comp === true`: `apps/shopify-app/app/lib/entitlement.server.ts:58-63`.
- Therefore a real paid subscription confirmed through Shopify could still be degraded to Starter under enforcement because the reader did not understand the writer's shape.
- Pre-patch, billing confirmation replaced the whole `planFeaturesJson`, which could erase merchant-specific Mira config such as `stylist`, `tryon`, `policy`, `comp`, or tuner data.
- Pre-patch, billing reconciliation downgraded by setting `planFeaturesJson` to JSON null, also erasing non-billing configuration: `apps/worker/src/workers/billing-reconcile.worker.ts:147-159`.
- This branch makes entitlement recognize nested active billing status as well as legacy top-level flags: `apps/shopify-app/app/lib/entitlement.server.ts:58-69`.
- This branch makes checkout confirmation merge billing state into existing `planFeaturesJson`, preserving other overrides and writing both `billingActive` and nested `billing.active`: `apps/shopify-app/app/routes/app.billing.tsx:82-109`.
- This branch makes billing reconciliation downgrade to Starter defaults while preserving non-billing overrides and marking nested billing inactive/cancelled: `apps/worker/src/workers/billing-reconcile.worker.ts:143-184`.
- This branch adds entitlement regressions proving nested active billing keeps Growth active, cancelled billing downgrades under enforcement, and ops comp still works: `apps/shopify-app/app/lib/entitlement.server.test.ts:1-72`.

Impact:
- Paid brands could approve a subscription and still lose paid features when enforcement was enabled.
- Checkout or cancellation could erase the exact brand configuration Mira needs to act like a tailored sales agent: stylist voice/name, try-on provider, returns policy, tuning, and ops flags.
- This is a business-model root cause, not a UI bug: the product cannot sell paid intelligence reliably if billing state and entitlement state do not share one contract.

Required fix:
- Keep billing writer, entitlement reader, and reconcile worker on one JSON contract.
- Add a billing route loader/action test or integration harness that proves confirmation preserves existing `planFeaturesJson` keys.
- Consider moving billing state into first-class Plan columns or a typed helper so future routes cannot hand-roll incompatible JSON.

## Finding 24: New Mira Objective Columns Could Be Missing In Production Without A Loud Startup Failure

Severity: P0 for runtime reliability. Server-canonical Mira memory depends on new database columns.

Evidence:
- This branch added `ShopperSession.miraObjectiveJson` and `miraObjectiveUpdatedAt` to Prisma schema and migration.
- `readMiraObjective` directly queries `"miraObjectiveJson"` via raw SQL: `apps/shopify-app/app/lib/session.server.ts:263-268`.
- `persistMiraObjective` directly updates `"miraObjectiveJson"` and `"miraObjectiveUpdatedAt"` via raw SQL: `apps/shopify-app/app/lib/session.server.ts:271-279`.
- Dockerfiles generate Prisma client but do not apply migrations on boot; the migration runbook explicitly says services do not run `migrate deploy` automatically.
- Without a migration gate, deployed code can accept traffic against a DB missing these columns, causing objective memory reads/writes to throw during Mira turns.
- The original migration used plain `ADD COLUMN`, which can fail on environments that already received columns through `db push`.
- This branch changes the migration to `ADD COLUMN IF NOT EXISTS`: `packages/db/prisma/migrations/20260621000100_add_mira_objective_to_shopper_session/migration.sql:1-3`.
- This branch adds `assertRequiredDatabaseShape()`, which checks required runtime columns in `information_schema` and fails with a clear migration command before traffic: `apps/shopify-app/app/lib/database-shape.server.ts:1-38`.
- The custom Express server now runs that guard immediately after env validation and before `listen()`: `apps/shopify-app/server.ts:17-27`.

Impact:
- The team could deploy the right code but still run against an older DB, making Mira forget objectives or fail turns.
- This is the same “fixed but not actually running” recurrence class as stale widget bundles, but at the database layer.
- Idempotent migration matters because this repo has documented `db push` history; migration application must converge instead of failing on already-present columns.

Required fix:
- Run `pnpm --filter @stylique/db exec prisma migrate deploy --schema=prisma/schema.prisma` before production traffic.
- Keep startup schema guards for any future raw-SQL/runtime-critical columns.
- Longer term, make deployment orchestration perform migrations as a single release step and record the applied migration version in health/ready output.

## Finding 25: Root-Level Dockerfiles Lagged Behind The Active Production Dockerfiles

Severity: P1 for deployment reliability. A wrong Railway/Docker target can quietly reintroduce old runtime behavior.

Evidence:
- The active Shopify app Dockerfile at `apps/shopify-app/Dockerfile` now builds/verifies the widget and runs the custom Express server with raw-body preservation.
- The root-level `Dockerfile.shopify-app` pre-patch only generated Prisma, built the Shopify app, and ran `pnpm --filter @stylique/shopify-app start`, which maps to `remix-serve` rather than the custom `server.ts`.
- `server.ts` is where raw body parsing is skipped for `/webhooks`, `/proxy`, and `/api/demo`, which is required for Shopify HMAC verification and app-proxy request handling.
- The root-level app Dockerfile also skipped the widget build/verify step, recreating Finding 19 if a deploy target used that file.
- The root-level Dockerfiles did not install OpenSSL/CA certificates, while Prisma generation and outbound Shopify calls depend on those being present in slim images.
- This branch updates `Dockerfile.shopify-app` to install OpenSSL/CA certificates, run `@stylique/widget build` and `verify:bundle`, and start `apps/shopify-app/server.ts` through `tsx`.
- This branch updates `Dockerfile.worker` to install OpenSSL/CA certificates too.

Impact:
- A deployment that accidentally used the root Dockerfile could pass build but break webhooks, app-proxy requests, or ship a stale storefront widget.
- This is another “two production paths” root cause: fixes landed in the active Dockerfile but not the adjacent deploy artifact.

Required fix:
- Prefer one production Dockerfile path per service, or make alternate Dockerfiles byte-for-byte equivalent in critical behavior.
- Keep deployment docs and Railway service settings pinned to the intended Dockerfile.
- Add a deploy-config verifier that fails if any Dockerfile starts Shopify with `remix-serve` instead of the custom Express server or skips widget verification.

## Finding 26: Requested Sold-Out Sizes Could Silently Add A Different Size

Severity: P0 for shopper trust. Size accuracy is central to a fashion sales agent.

Evidence:
- `addToCart(handle, size)` resolves Shopify variants from `/products/<handle>.js` and then posts to `/cart/add.js`: `apps/web/app/lib/storefront-cart.ts:54-75`.
- Pre-patch, if the requested size matched a sold-out variant, the helper fell back to the first available variant. A shopper asking Mira to add L could receive S in the cart.
- The prior verifier explicitly expected that fallback: `apps/web/scripts/verify-cart.mjs`.
- This branch adds explicit variant-resolution outcomes and returns `requested_size_unavailable` when the requested size exists but is not available: `apps/web/app/lib/storefront-cart.ts:11-46`.
- This branch keeps fallback-to-first-available only when no size was requested: `apps/web/app/lib/storefront-cart.ts:43-45`.
- This branch updates the cart verifier to prove requested sold-out size never posts `/cart/add.js`, while null-size add still falls back honestly: `apps/web/scripts/verify-cart.mjs:138-153`.
- This branch rebuilt and verified the Shopify storefront bundle so the fix is present in both `public/widget.js` and extension `tryon.js`.

Impact:
- Wrong-size cart adds are worse than a failed add: the UI can claim success while Shopify contains a product variant the shopper did not ask for.
- This undermines Mira’s fit/sizing promise and can create returns, support burden, and brand distrust.

Required fix:
- Never substitute a different size when a shopper or fit recommender supplied a size.
- Surface a size-specific failure path so Mira can offer “Find my size” or another available size, rather than claiming success.
- Keep cart verifiers in the release gate and bundle freshness checker.

## Finding 27: Combo Add-All Logged Style Cart Events Before The Browser Proved Shopify Cart Success

Severity: P1 for dashboard truth and assisted-cart attribution.

Evidence:
- `postComboAddAll` resolves product ids and variant ids for the browser to add through Shopify cart APIs: `apps/shopify-app/app/lib/shopper-events.server.ts:141-244`.
- Pre-patch, that endpoint emitted `CART_FROM_WIDGET_STYLE` before the browser performed `/cart/add.js`.
- That meant a failed browser cart add could still increment style-cart metrics.
- The direct Mira add path already had the stricter pattern: record conversion only after `addToCart`/`addOutfitToCart` reports success in the browser: `apps/web/app/components/mira/MiraWidget.tsx:2634-2709`.
- This branch changes `postComboAddAll` to emit `COMBO_ADD_ALL` only as CTA/intent evidence and documents that `CART_FROM_WIDGET_STYLE` is post-cart-success evidence: `apps/shopify-app/app/lib/shopper-events.server.ts:236-243`.
- This branch allows `CART_FROM_WIDGET_STYLE` through the client event endpoint, matching the existing post-success `CART_FROM_TRYON` pattern: `apps/shopify-app/app/lib/shopper-events.server.ts:27-32`.
- This branch posts `CART_FROM_WIDGET_STYLE` from the Mira widget only after `addOutfitToCart` succeeds, with real merchant `productId` values when present: `apps/web/app/components/mira/MiraWidget.tsx:2698-2709`.
- The widget bundle verifier now checks for both `requested_size_unavailable` and `CART_FROM_WIDGET_STYLE`, so this cart-truth fix cannot remain source-only: `apps/widget/scripts/verify-bundle.mjs:7-12`.

Impact:
- Dashboards could show style/look cart influence even when the actual Shopify cart mutation failed.
- This repeated the earlier root cause: intent and confirmed cart mutation were blended under cart-sounding event names.

Required fix:
- Keep `COMBO_ADD_ALL` as the intent/CTA event.
- Keep `CART_FROM_WIDGET_STYLE` as post-success cart-origin evidence only.
- Long term, rename/report event families as `intent`, `cart mutation`, and `order` stages so dashboards cannot accidentally blend them again.

## Finding 28: Shared Cart Event Family Blended Intent, Cart Success, And Try-On Attribution

Severity: P1 for reporting truth and revenue attribution.

Evidence:
- The shared `MIRA_CART_ASSIST_EVENT_NAMES` constant previously mixed pre-cart intent (`CHAT_CART_REQUESTED`, `MIRA_ADD_TO_CART_ASSIST`, `COMBO_ADD_ALL`) with confirmed cart-origin signals (`CART_FROM_MIRA`, `CART_FROM_WIDGET_STYLE`): `packages/core/src/analytics/cart-events.ts`.
- `CART_FROM_TRYON` was treated as a live conversion signal in dashboards and fashion intelligence, but was not included in that shared assist family. A try-on could improve a dashboard conversion metric but fail to become assisted revenue after fulfillment.
- Monthly reports used the mixed assist family for `funnel.atcEvents`, so CTA intent could inflate the merchant-facing "Add-to-bag events" count: `packages/core/src/reports/monthly.ts:286-288`.
- Production fashion intelligence computed `bundlePurchaseRate` from `COMBO_ADD_ALL / CART_CONFIRMED`, even though `COMBO_ADD_ALL` is now explicitly a CTA/intent event: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:452-464`.
- This branch splits the shared contract into `MIRA_CART_INTENT_EVENT_NAMES`, `MIRA_CART_SUCCESS_EVENT_NAMES`, and the union `MIRA_CART_ASSIST_EVENT_NAMES`: `packages/core/src/analytics/cart-events.ts:7-24`.
- The success bucket now includes `CART_FROM_TRYON`, so fulfilled-order attribution can recognize try-on cart success without counting mere try-on views.
- Monthly report add-to-bag funnel counts now use only `MIRA_CART_SUCCESS_EVENT_NAMES`, while bundle co-intent keeps using the broader assist family because that card is about merchandising interest: `packages/core/src/reports/monthly.ts:27-288` and `packages/core/src/reports/monthly.ts:372-381`.
- Fashion intelligence now exposes `bundleIntentRate` and `aiSuggestedCartRate`; deprecated legacy fields are populated from the honest replacements only for older clients: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:79-88` and `apps/shopify-app/app/lib/fashion-intelligence.server.ts:452-474`.
- The web/demo dashboard now carries the same honest field names and no longer labels bundle intent as "Bought a recommended bundle": `apps/web/app/lib/mira-intelligence.server.ts:126-140` and `apps/web/app/dashboard/page.tsx:145-155`.
- The focused tests now assert the split and prove that intent clicks do not inflate add-to-bag funnel counts: `packages/core/src/__tests__/analytics.test.ts:3-30` and `packages/core/src/__tests__/monthly-report.test.ts:58-75`.

Impact:
- A merchant could see one dashboard claim try-on or Mira drove cart behavior while another revenue report failed to attribute the eventual order.
- Conversely, monthly funnel counts could overstate cart success by counting CTA clicks that never reached Shopify cart.
- This is the same recurring root cause in another layer: one event family was asked to mean three lifecycle stages.

Required fix:
- Use intent events for demand, merchandising, and shopper-interest learning.
- Use success events for add-to-bag/cart-mutation funnels.
- Use the assist union only where a later confirmed order is the revenue gate.
- Keep tests around every event family so future event additions must choose a lifecycle stage.

## Finding 29: Demo Event Bridge Could Accept Full Analytics Enum If The Secret Was Missing

Severity: P0 for metric integrity in preview/alternate production paths.

Evidence:
- `apps/web/app/lib/event-bridge.server.ts` can forward demo/Web events to the Shopify app at `/api/mira/event` when `SHOPIFY_APP_URL` is configured.
- The Shopify app startup env guard requires `MIRA_EVENT_BRIDGE_SECRET` in production, but the route itself previously only enforced the secret when the env var existed: `apps/shopify-app/app/routes/api.mira.event.tsx:66-69`.
- If an alternate server path, preview deploy, or misconfigured production runtime reached the route without the secret, any caller could submit a valid `EventNameSchema` event for an installed/default shop.
- The schema accepted the full analytics enum, including high-trust events that should only come from Shopify webhooks or internal workers.
- This branch makes `/api/mira/event` fail closed in production when `MIRA_EVENT_BRIDGE_SECRET` is missing: `apps/shopify-app/app/routes/api.mira.event.tsx:83-88`.
- This branch adds `BRIDGE_ACCEPTED_EVENTS`, so even a correctly authenticated bridge request can only emit the demo/Web bridge event set, not the full analytics enum: `apps/shopify-app/app/routes/api.mira.event.tsx:22-41` and `apps/shopify-app/app/routes/api.mira.event.tsx:96-98`.
- A new route regression test proves missing production secret returns 503, wrong secret returns 401, and a valid-enum but unauthorized `CART_CONFIRMED` payload returns 403 without touching persistence: `apps/shopify-app/app/routes/api.mira.event.test.ts:1-88`.

Impact:
- Misconfigured environments could poison merchant analytics, assisted attribution, and catalog-gap learning from outside the signed Shopify app-proxy/webhook paths.
- Even if the main production server was protected by startup validation, the route did not defend itself as an independent boundary.
- This is another repeated-fix overlap: startup config, route auth, and event enum validation were each partially responsible, but none owned the invariant alone.

Required fix:
- Keep production bridge auth fail-closed at route level and startup level.
- Keep a bridge-specific event allowlist separate from the global analytics enum.
- Add any future demo bridge event to the route allowlist and test with an explicit lifecycle/trust classification.

## Finding 30: Startup Readiness Used A Weaker Env Contract Than Production Runtime

Severity: P1 for deployment reliability. A service could appear ready while production-only commerce/security env was missing.

Evidence:
- `apps/shopify-app/app/env.server.ts` requires additional production secrets such as `APP_ENCRYPTION_KEY`, `MIRA_EVENT_BRIDGE_SECRET`, `PLATFORM_JWT_SECRET`, `SESSION_SECRET`, and try-on storage/provider configuration.
- The custom Express server calls `validateRequiredEnvVars()` before accepting traffic: `apps/shopify-app/server.ts:20-25`.
- Pre-patch, `validateRequiredEnvVars()` only checked the older base set (`DATABASE_URL`, `SESSION_SECRET`, Shopify keys/app URL, Redis), and only warned for `APP_ENCRYPTION_KEY`: `apps/shopify-app/app/lib/startup-validation.server.ts`.
- `/api/ready` duplicated an even smaller local env list, so load balancers could see the instance as ready while production-only requirements were absent: `apps/shopify-app/app/routes/api.ready.tsx`.
- This branch adds `missingRequiredEnvVars()` to `startup-validation.server.ts`, with the base env, production-only secrets, storage either/or, and VTO provider rule in one function.
- `validateRequiredEnvVars()` and `/api/ready` now use the same env calculation: `apps/shopify-app/app/lib/startup-validation.server.ts:62-133` and `apps/shopify-app/app/routes/api.ready.tsx:14-68`.

Impact:
- A deploy could pass readiness and accept traffic but later fail or degrade when a route imported stricter env code or needed a missing production secret.
- This is the deployment version of the earlier runtime drift: two validators claimed ownership of readiness, and the weaker one was on the traffic gate.

Required fix:
- Keep startup, readiness, and route-level checks on one env contract.
- Any future production-required env must be added to `missingRequiredEnvVars()` and covered by readiness.
- Keep sensitive/high-trust routes fail-closed even when startup validation is expected to catch missing config.

## Finding 31: Worker Boot Gate Missed Production Secrets Needed By The Jobs It Runs

Severity: P1 for background-loop reliability. Catalog sync, widget injection, billing reconcile, and try-on renders can fail after the worker reports healthy.

Evidence:
- The worker boot gate previously required only `DATABASE_URL`, `REDIS_URL`, Shopify API credentials, and `SHOPIFY_APP_URL`: `apps/worker/src/index.ts:40-46`.
- Worker jobs decrypt `Shop.accessToken` before Shopify Admin calls in catalog sync, widget injection, and billing reconcile. Without `APP_ENCRYPTION_KEY`, encrypted `enc:` tokens can pass through as unusable access tokens: `apps/worker/src/jobs/catalog-sync.ts:76-87`, `apps/worker/src/jobs/inject-widget.ts:54-63`, and `apps/worker/src/workers/billing-reconcile.worker.ts:72-80`.
- The try-on render worker needs a storage destination (`S3_TRYON_BUCKET` or `STORAGE_PATH`) and at least one render provider unless VTO is disabled: `apps/worker/src/jobs/tryon-render.ts`.
- Pre-patch, missing production-only worker env would be discovered only as job failures, not at boot.
- This branch makes worker startup require `APP_ENCRYPTION_KEY`, `STORAGE_PATH or S3_TRYON_BUCKET`, and a VTO provider in production unless `VTO_ENABLED=0`: `apps/worker/src/index.ts:40-60`.

Impact:
- A deployment could show the app as fixed while the background loop silently failed to sync catalog truth, inject the widget, reconcile billing, or complete try-on renders.
- This is another “fixes do not stick” source: foreground requests and background jobs had different readiness contracts.

Required fix:
- Keep worker production env requirements aligned with the jobs enabled in that worker process.
- If a job is optional, gate/schedule it explicitly instead of letting it start and fail repeatedly from missing env.
- Consider extracting shared production-env validation into a workspace package if app and worker requirements continue to grow.

## Finding 32: Production Could Still Opt Back Into The Legacy Cross-Service Brain

Severity: P1 for Mira behavior consistency. A single env flag could reintroduce split-brain runtime behavior.

Evidence:
- `runMiraAdapter` now defaults to calling `@stylique/mira-brain` in-process with the merchant catalog injected, which removes the old dependency on the web demo service for production storefront turns.
- The adapter still retained `USE_IN_PROCESS_BRAIN=0` as a legacy HTTP fallback to `MIRA_BRAIN_ORIGIN/api/mira`: `apps/shopify-app/app/lib/mira-adapter.server.ts:862-884`.
- That fallback was valuable during rollout, but in production it can recreate the original failure class: storefront behavior depending on a separate demo/web origin and its environment.
- This branch makes production startup/readiness reject `USE_IN_PROCESS_BRAIN=0`, while leaving the escape hatch available for local development: `apps/shopify-app/app/lib/startup-validation.server.ts:106-108`.
- This branch also updates stale adapter comments that still described the primary runtime as "POST to demo brain"; the file now documents the in-process production path and labels the HTTP resolver as legacy/dev-only: `apps/shopify-app/app/lib/mira-adapter.server.ts:345-365`.

Impact:
- A production operator could accidentally set one flag and bring back the exact drift this closeout is trying to remove: external brain host, demo fallback risk, and route/source inconsistencies.
- Stale comments made the old architecture feel current, increasing the chance of future reversion.

Required fix:
- Production Mira should run the in-process brain package only.
- Any future fallback should be treated as a migration mode with a startup/readiness gate, not a silent production option.
- Keep comments and runbooks aligned with the actual runtime owner.

## Finding 33: Proactive UI Intent Triggers Were Local-Only And Ignored Tier Entitlement

Severity: P0 for UI/UX trust and commerce-intelligence learning. Mira's proactive behavior is the difference between a chatbot and an agentic sales associate.

Evidence:
- The backend already exposes `stylist.proactiveTriggers` from `/api/entitlement`: `apps/shopify-app/app/lib/shopper.server.ts:148-163`.
- The widget did not fetch or use that entitlement, so proactive nudges could fire on any installed storefront regardless of tier.
- The widget had local proactive heuristics for multi-product browsing, variant comparison, exit intent, stranded PDP dwell, and size-chart opening, but those signals lived mostly in `sessionStorage` and UI state: `apps/web/app/components/mira/MiraWidget.tsx:2352-2468`.
- The app-proxy `/api/events` allowlist rejected behavioral/proactive event names, so the backend could not learn from the UI's outlier/intent detection even if the widget posted them.
- The proactive effect ran once on mount (`[]` deps), so route/path changes could leave stale listeners and fail to re-evaluate current PDP intent. This matched the symptom: sometimes cards/nudges appear, sometimes they do not.
- This branch fetches `/api/entitlement` on storefront mount and stores `proactiveAllowed`, defaulting to demo-only enabled and real storefront disabled on entitlement fetch failure: `apps/web/app/components/mira/MiraWidget.tsx:2138-2151`.
- This branch makes the proactive effect rerun per `pathname`, gates fired nudges by `proactiveAllowed`, and emits `MIRA_BEHAVIORAL_TRIGGER_FIRED`, `MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED`, `MIRA_PROACTIVE_TRIGGERED`, `PRODUCT_VIEWED`, and `PRODUCT_DWELL_LONG`: `apps/web/app/components/mira/MiraWidget.tsx:2387-2489`.
- Size-chart opening now emits `CHAT_SIZE_CHART_VIEWED`, respects `proactiveAllowed`, and reports fired/suppressed fit-doubt behavior: `apps/web/app/components/mira/MiraWidget.tsx:2350-2391`.
- The client event allowlist now accepts those storefront behavioral telemetry names while continuing to exclude high-trust order/revenue events: `apps/shopify-app/app/lib/shopper-events.server.ts:27-37`.
- The widget bundle verifier now checks the behavioral/proactive event strings so the fix cannot stay source-only: `apps/widget/scripts/verify-bundle.mjs:7-15`.

Impact:
- Lower-tier stores could receive proactive UI behavior they were not entitled to, while dashboards/quotas assumed it was gated.
- Higher-tier stores could show useful proactive behavior without feeding the backend learning loop, so commerce intelligence missed the exact hesitation/outlier signals that matter.
- Because the effect ran once, proactivity could feel inconsistent across product navigation, reinforcing the user's "sometimes cards come up, sometimes they don't" concern.

Required fix:
- Treat proactive Mira as a tiered, measured UI feature: backend entitlement, frontend gate, behavioral event emission, and dashboard reporting must all agree.
- Continue expanding proactive intent beyond dwell/variants/size chart into richer product-category repeated views, failed cart attempts, zoom/image interaction, and price hesitation, but each trigger must emit fired/suppressed evidence.
- Add browser-level verification for proactive nudges on a real storefront fixture so UI behavior is proven, not inferred from typecheck.

## Finding 34: Try-On Runtime And Prewarm Could Ignore The Scored Primary Garment Image

Severity: P0 for try-on quality. The image scorer can choose the right garment image, but runtime paths must actually use it.

Evidence:
- The image-quality worker scores all `ProductImage` rows and writes `Product.primaryTryonImageId`, `Product.tryonReady`, and `Product.widgetTier`: `apps/worker/src/jobs/image-quality.ts:80-105` and `apps/worker/src/jobs/image-quality.ts:205-227`.
- The scorer prefers a usable `FRONT` garment image over other roles, which is correct for try-on: `packages/core/src/imagery/service.ts:93-99`.
- Pre-patch, the live try-on service still selected `images[0]` ordered by Shopify position and used that URL/prepped URL: `apps/shopify-app/app/lib/tryon.server.ts:294-302`.
- Pre-patch, catalog-sync prewarm and brand-install prewarm also selected `images[0]`, so the cache could be warmed for a lifestyle/detail/secondary image even after scoring found a better primary: `apps/worker/src/jobs/catalog-sync.ts:198-207` and `apps/worker/src/jobs/brand-install.ts:112-130`.
- This branch changes live try-on to select the image matching `primaryTryonImageId`, falling back to position 1 only when no primary exists, and still preferring `preppedUrl`: `apps/shopify-app/app/lib/tryon.server.ts:292-304`.
- This branch applies the same primary-image selection to catalog-sync and brand-install prewarm jobs: `apps/worker/src/jobs/catalog-sync.ts:198-208` and `apps/worker/src/jobs/brand-install.ts:112-131`.
- This branch adds a core regression test proving the scorer chooses a usable `FRONT` image over position-1 lifestyle/detail images: `packages/core/src/__tests__/imagery-quality.test.ts:78-104`.

Impact:
- A merchant could have image scoring working in the backend, yet shoppers still see try-on generated from the wrong source image.
- This directly matches the user's concern: first image is not always the hero/try-on image, and a zoom/detail/lifestyle shot can produce bad try-on.
- It is another backend/UI mismatch: extraction/scoring truth existed, but rendering/prewarm did not consume it everywhere.

Required fix:
- All try-on runtime, prewarm, widget product serialization, and brand-DNA/product-understanding paths should prefer `primaryTryonImageId` where the task needs the product garment image.
- The image scorer still needs deeper garment/category validation. Filename heuristics alone cannot reliably detect "shirt product but pants-only image"; that requires a vision provider that compares image content against product title/category/tags.
- Add browser or provider-level test fixtures for wrong-image classes: lifestyle model, detail crop, swatch, flatlay with multiple garments, and category mismatch.

## Finding 35: Size-Chart Image OCR Dropped Shopify Alt Text Before Extraction

Severity: P0 for size recommendation coverage. Many stores label their size-guide images through image alt text, but that signal was lost before the extractor could use it.

Evidence:
- The Shopify worker fetches image `altText` from Admin GraphQL: `apps/worker/src/shopifyClient.ts:40-64`.
- The core product input type accepted `altText`, but the normalized image shape dropped it before persistence: `packages/core/src/catalog/normalize.ts:31-159`.
- The database `ProductImage` model had no `altText` column, so even a correct normalizer had nowhere durable to store it: `packages/db/prisma/schema.prisma:194-214`.
- The size-chart extraction job selected only image URL and garment role, then passed no alt text into `extractSizeChartMultiSource`: `apps/worker/src/jobs/size-chart-extract.ts:52-72`.
- The extractor already looks for image alt text matching size/chart/guide/measure/fit/dimension before OCR, so the lower-level capability existed but upstream code starved it: `packages/core/src/sizing/index.ts:25-60`.
- This branch adds `ProductImage.altText`, an idempotent migration, normalizer propagation, catalog persistence, and worker extraction input: `packages/db/prisma/schema.prisma:198`, `packages/db/prisma/migrations/20260621000200_add_product_image_alt_text/migration.sql:1`, `packages/core/src/catalog/normalize.ts:56-158`, `packages/core/src/catalog/sync.ts:83-89`, and `apps/worker/src/jobs/size-chart-extract.ts:55-72`.
- A catalog test now proves image alt text survives normalization: `packages/core/src/__tests__/catalog.test.ts:60-70`.

Impact:
- Brands could have a clear "size guide" image in Shopify, but Mira would miss it unless the URL happened to contain size/chart words.
- Size recommendation then fell back to generic defaults, making the user experience look broken even though the merchant data existed.
- This is another backend pipeline split: Shopify extraction had the field, core sizing knew how to use it, but catalog normalization/persistence disconnected them.

Required fix:
- Treat image metadata as first-class product intelligence, not optional UI decoration.
- Add fixtures for image alt-only size charts, URL-only size charts, OCR-only size charts, and bad non-size garment images so extractor selection is proven.
- Extend the admin/dashboard UI to show which source won for each product so merchants can see why Mira is confident or why a product still needs data.

## Finding 36: Full-Look Bundle Memory Was Hardcoded To Demo Products

Severity: P0 for real merchant UI/UX and cart bundles. Mira could render real merchant look cards, but the memory layer that resolves "add the full look" only trusted demo handles.

Evidence:
- `active-look-memory.ts` kept a static `PRODUCT_NAMES` map and `ALL_HANDLES` set for the demo catalog only. `updateFromLookCard`, `updateFromReco`, and `updateFromVoice` filtered through that set before saving a look.
- On a real storefront, `MiraWidget` hydrates merchant products into `runtimeCatalog`, and recommendation/look cards can display those real products: `apps/web/app/components/mira/MiraWidget.tsx:1227-1237`.
- Pre-patch, those real product handles were not registered with active-look memory, so a real merchant look card could be visible in the UI while bundle memory stayed empty or demo-only.
- The add-to-cart route checks full-look/bundle intent and relies on remembered look pieces before rendering the bundle cart chip: `apps/web/app/components/mira/MiraWidget.tsx:1472-1493`.
- This branch replaces the fixed demo handle gate with a dynamic product registry, seeded by demo products but extended through `registerActiveLookProducts`: `apps/web/app/lib/active-look-memory.ts:55-88`.
- Voice mention extraction now also matches registered product names/handles dynamically, instead of depending only on demo keyword aliases: `apps/web/app/lib/active-look-memory.ts:91-154`.
- The widget now registers real hydrated products and every rendered recommendation/look product into that registry: `apps/web/app/components/mira/MiraWidget.tsx:99-103`, `apps/web/app/components/mira/MiraWidget.tsx:1227-1237`, and `apps/web/app/components/mira/MiraWidget.tsx:2653-2663`.
- The storefront bundle was rebuilt and verified byte-identical with the Shopify theme asset via `pnpm --filter @stylique/widget build && pnpm --filter @stylique/widget typecheck && pnpm --filter @stylique/widget verify:bundle`.

Impact:
- Shoppers could say "add the full look" after Mira showed a real merchant look, but the UI memory could fail to resolve the bundle and fall back toward a single-item add.
- This directly matches the user's concern that cart bundles and cards sometimes do not behave consistently even when the backend/product logic seems fixed.
- It was also a scalability blocker: merchant-specific products should never require hardcoded handles in the widget.

Required fix:
- Keep demo catalog as a fallback only; every production product memory path must be driven by hydrated merchant product data or backend product IDs.
- Add browser coverage for a fake merchant product with non-demo handles: render look card, say "add the whole look", verify multi-line cart add.

## Finding 37: Billing Status UI Treated Any Plan Row As Active

Severity: P0 for quotas, tier trust, and launch readiness. Feature enforcement and merchant dashboard billing status were not reading the same contract.

Evidence:
- The billing confirmation route writes active subscription state into `Plan.planFeaturesJson.billing` and the legacy `billingActive` top-level flag: `apps/shopify-app/app/routes/app.billing.tsx:86-112`.
- Entitlement enforcement already had a helper that recognizes real active subscription state or explicit ops comp: `apps/shopify-app/app/lib/entitlement.server.ts:57-70`.
- Pre-patch, `getBillingStatus()` reported `billingActive=true` in production whenever a `Plan` row existed. A plan row proves provisioning, not payment.
- This branch exports `isBillingActive()` from the entitlement layer and makes billing status read that same contract: `apps/shopify-app/app/lib/entitlement.server.ts:61-70` and `apps/shopify-app/app/lib/billing.server.ts:166-175`.

Impact:
- The dashboard could tell a merchant or operator billing was active when the actual Shopify subscription was not active.
- This makes quota/tier debugging confusing: the entitlement layer may degrade under `BILLING_ENFORCED`, while the billing UI suggests the merchant is fine.
- It undermines the self-serve/manual hybrid onboarding model because manual provisioning creates plan rows before billing necessarily exists.

Required fix:
- Every billing display, tier gate, quota report, and ops view should use the same normalized billing state: active subscription, explicit comp, or inactive.
- Add a reconciliation job/webhook path for cancellation/charge updates so `planFeaturesJson.billing.status` is not only updated on checkout return.
- Super-admin manual provisioning must create a plan safely but mark billing inactive unless comped or linked to an active subscription.

## Finding 38: Super-Admin Could Override Existing Shops But Could Not Provision A Merchant

Severity: P1 for early enterprise onboarding. The internal ops UI had tier overrides and per-brand plan controls, but no explicit flow to create a merchant record before install.

Evidence:
- The internal brands page could change tier, send notifications, and pause/resume generation only for an existing `shopId`.
- The brand detail page could edit `planFeaturesJson`, set comp access, and set a render cap for an existing shop: `apps/shopify-app/app/routes/internal.$shopId.tsx:42-123` and `apps/shopify-app/app/routes/internal.$shopId.tsx:227-262`.
- Pre-patch, there was no `provision_brand` action. That meant early/manual enterprise onboarding still depended on a Shopify OAuth install happening before ops could create the merchant record and tier intent.
- This branch adds a protected internal `provision_brand` action that validates a Shopify domain, creates a pending-install `Shop`, creates/updates the `Plan`, records `provisioning.status="PENDING_INSTALL"`, and keeps `billingActive=false` unless comp access is explicitly selected: `apps/shopify-app/app/routes/internal._index.tsx:57-111`.
- The internal brands page now has a compact "Provision merchant" form for domain, tier, and comp access: `apps/shopify-app/app/routes/internal._index.tsx:559-583` and `apps/shopify-app/app/routes/internal._index.tsx:633-666`.

Impact:
- Ops could not stage a merchant contract, quota/tier intent, or pending install state from the dashboard.
- Manual onboarding was therefore not a first-class product flow; it lived in ad hoc DB work or required waiting for OAuth.
- This is distinct from full install: pending provision does not create real Shopify API credentials, so catalog sync and theme injection still correctly wait for OAuth to update `Shop.accessToken`.

Required fix:
- Add an install/onboarding checklist view for pending merchants: OAuth completed, app embed/script injected, first catalog sync, brand DNA extracted, image-quality scored, size charts extracted, and widget beacon seen.
- Add an explicit invite/install link workflow if the Shopify distribution mode supports it.
- Add audit logging for internal provisioning and plan changes so every manual entitlement change is attributable.

## Finding 39: Brand DNA Catalog Extraction Asked For Fields It Then Discarded

Severity: P1 for brand intelligence quality. The vision prompt requested fabric, seasonality, and price-positioning data, but the returned values were not carried into the saved DNA.

Evidence:
- The catalog Brand DNA prompt asks Gemini for `dominantFabrics`, `seasonality`, and `pricePositioning`: `packages/core/src/studio/brand-dna.ts:133-158`.
- Pre-patch, `extractDNAFromCatalogProducts()` converted each Gemini batch into a `BrandDNASignal` that only retained palette, mood, lighting, composition, archetype, and score. `mergeBrandDNA()` then defaulted `dominantFabrics=[]`, `seasonality="all_season"`, and `pricePositioning="contemporary"`.
- This branch counts fabric, seasonality, and price-positioning values across successful catalog batches and writes the top values into `toneJson`: `packages/core/src/studio/brand-dna.ts:173-244`.
- A focused test now stubs Gemini and proves those catalog-derived fields survive extraction: `packages/core/src/__tests__/brand-dna.test.ts:9-43`.

Impact:
- Brand DNA could look "computed" in UI while still carrying generic defaults for important merchandising language.
- Mira's brand voice and merchant dashboards could miss fabric/material positioning even when product imagery and metadata contained it.
- This reinforced the user's backend/UI concern: extraction appeared to run, but the useful extracted fields did not reach the persisted surface.

Required fix:
- Extend Brand DNA source reporting so the UI shows which fields came from catalog vision, Instagram, merchant override, or defaults.
- Add tests for multi-batch aggregation and Instagram/catalog merge precedence.
- Feed saved fabric/seasonality/positioning into Mira prompt and product-detail generation only when source confidence is non-default.

## Finding 40: Production Mira Prompt Read Legacy Brand DNA Keys, Not The Saved Extraction Shape

Severity: P1 for brand voice and commerce intelligence. Brand DNA could be extracted and persisted correctly, but Mira's production prompt still read older key names.

Evidence:
- Brand DNA extraction saves palette as `paletteJson.hex` and mood as `toneJson.moodAdjectives`: `packages/core/src/studio/brand-dna.ts:235-244`.
- Pre-patch, `loadMerchantBrand()` looked for `palette.dominantColors` and `tone.vibeWords`, so current extracted palette/mood values were invisible to the production Mira prompt.
- This branch reads current keys first and keeps legacy fallbacks: `apps/shopify-app/app/lib/mira-adapter.server.ts:571-589`.
- The production prompt now also includes saved seasonality in the brand POV block: `apps/shopify-app/app/lib/mira-adapter.server.ts:591-596`.

Impact:
- The admin/settings UI could show "DNA computed" while the live sales assistant still spoke from sparse/default brand context.
- This was a direct backend-to-Mira disconnect: extraction improved, persistence worked, but the final agent prompt consumed different field names.

Required fix:
- Add a unit test around `loadMerchantBrand()` or a public wrapper so BrandProfile shapes are contract-tested.
- Add schema/type helpers for BrandProfile JSON rather than freehand `Record<string, unknown>` parsing across routes.

## Finding 41: Core Styling Did Not Accept The Widget's Real-Store Category Aliases

Severity: P1 for complete-the-look quality. The core look engine used `shirt`/`trouser`/`shoe`, while hydrated real storefront products often normalize to `top`/`bottom`/`footwear`.

Evidence:
- The widget product type uses categories such as `top`, `bottom`, `knitwear`, and `accessory`: `apps/web/app/lib/catalog.ts:15`.
- Core `buildOutfit()` previously only mapped `shirt`, `trouser`, `shoe`, `outerwear`, `dress`, `skirt`, and `accessory` in its role graph.
- This branch extends the core role graph and role category lookup to include `top`, `bottom`, `knitwear`, and `footwear`: `packages/core/src/style/service.ts:55-75`.
- A focused regression test now proves a `top` anchor can select `bottom` and `footwear` complements: `packages/core/src/__tests__/fit-style.test.ts:90-106`.

Impact:
- One layer could normalize a merchant item to "top" while another layer did not consider "top" a valid anchor for bottoms/shoes.
- Complete-the-look could become incomplete or inconsistent depending on whether the backend DB category or the widget hydration category reached the scorer.
- This is another source of "cards sometimes appear, sometimes don't": the product existed, but category vocabulary drifted.

Required fix:
- Consolidate category taxonomy into one shared package used by catalog normalization, core style, Mira widget hydration, and dashboard grouping.
- Add a cross-surface taxonomy contract test that feeds the same product through Shopify normalize → backend style → widget hydrate.

## Finding 42: Fashion Intelligence Treated Fit Submissions As Chosen-Size Evidence

Severity: P1 for dashboard trust and learning-loop accuracy. The merchant dashboard could claim shoppers chose a different size even though it was only reading fit-recommendation submission events.

Evidence:
- `WIDGET_FIT_SUBMITTED` is emitted when Mira calculates a recommendation, with height, weight, fit preference, body data, `recommendedSize`, and confidence: `apps/shopify-app/app/lib/shopper.server.ts:343-357`.
- The actual event family intended for shopper choice drift is `SIZE_SELECTED`, with `chosenSize`, `recommendedSize`, and `sizeDelta`: `packages/core/src/recommendations/service.ts:141-153`.
- Pre-patch, `getFashionIntelligence()` counted `WIDGET_FIT_SUBMITTED.payload.size` as top size and compared it against `recommendedSize` for "shoppers chose a different size." In production that payload normally has no chosen `size`, so the dashboard could display a false 0% drift or silently fall back to modelled language.
- This branch now queries `SIZE_SELECTED` separately, uses fit submissions only for recommended-size mix and fit preference, uses selected-size events for actual chosen-size distribution and drift, and changes the body insight to "Collecting selected-size data" when choice evidence is absent: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:234-401`.

Impact:
- Backend learning could improve while the UI still communicated the wrong reason because two adjacent analytics events were overloaded.
- Merchants could believe shoppers were accepting or rejecting Mira's recommendation without the app having recorded final selected size.
- This is the same repeated-fix pattern: a card looked data-driven, but its event contract did not prove the sentence it rendered.

Required fix:
- Emit `SIZE_SELECTED` from every UI where shoppers change/confirm size after a recommendation, including try-on size changes and cart-size selectors.
- Add a dashboard contract test that fails when any "chose/selected/accepted" copy is backed only by recommendation events.
- Expose source labels for `consumer.topSizes`: selected sizes, recommended sizes, or modelled sizes.

## Finding 43: Closed-State Mira Re-Approached On Product Navigation Without Outlier Intent

Severity: P1 for UI/UX trust. The proactive trigger system had intent rules, but a separate product-navigation effect could still nudge whenever the shopper moved to another PDP.

Evidence:
- The main proactive block correctly tries to fire only on buying-intent signals such as repeated browsing, variant comparison, exit intent, stranded dwell, and size-chart behavior: `apps/web/app/components/mira/MiraWidget.tsx:2456-2583`.
- Pre-patch, the later "RE-APPROACH ON NAVIGATION" block opened a closed-state nudge for any product change when `mira_opened` was absent, without checking tier entitlement, prior nudge state, or whether the shopper had shown confusion/comparison intent.
- This branch changes the browsing trigger from generic "3 products viewed" to a stronger outlier: three distinct products in the same category. Generic multi-product browse now waits for four distinct products.
- The closed-state product-switch nudge now fires only when the shopper has viewed at least three products in the same category, respects `stylist.proactiveTriggers`, respects `mira_opened`/`mira_nudged`, and emits fired/suppressed telemetry: `apps/web/app/components/mira/MiraWidget.tsx:2509-2583` and `apps/web/app/components/mira/MiraWidget.tsx:2606-2663`.
- The shipped storefront widget was rebuilt and verified after the source fix: `apps/shopify-app/extensions/stylique-widget/assets/tryon.js` and `apps/shopify-app/public/widget.js`.

Impact:
- Mira could still feel like a chatbot because the shopper saw nudges on ordinary navigation, even though another part of the file said "intent-driven."
- Backend entitlement/behavioral telemetry fixes did not fully solve UI behavior because an overlapping UI effect bypassed the same guardrails.
- This also explains "sometimes cards/pop-ups come up, sometimes they don't": two proactive paths were competing, and only one was using the intended trigger model.

Required fix:
- Move proactive trigger evaluation into one shared state machine with explicit events: product_viewed, same_category_repeat, variant_compare, size_chart_opened, stranded_dwell, exit_intent, cart_hesitation.
- Add a Playwright/browser test that navigates PDP1 → PDP2 and asserts Mira does not nudge, then PDP3 in the same category and asserts she does nudge with comparison chips.
- Expose a merchant-debug event timeline in super-admin showing trigger, suppression reason, product, confidence, and UI outcome.

## Finding 44: The Selected-Size Learning Event Existed But The Try-On UI Did Not Emit It

Severity: P1 for fit learning. Backend learning and dashboard code were prepared to consume `SIZE_SELECTED`, but the primary shopper UI for changing/confirming size did not post that event.

Evidence:
- The core recommendation drift generator reads `SIZE_SELECTED` and expects `chosenSize`, `recommendedSize`, and `sizeDelta`: `packages/core/src/recommendations/service.ts:141-153`.
- Fashion Intelligence now reads `SIZE_SELECTED` for actual shopper choice drift: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:256-401`.
- Pre-patch, `TryOnPanel` changed `chosenSize` and added the selected size to cart, but only emitted try-on/cart attribution events.
- This branch emits `SIZE_SELECTED` when the shopper explicitly renders a different size and when a try-on cart add succeeds, including chosen size, recommended size, and ladder delta: `apps/web/app/components/surfaces/TryOnPanel.tsx:282-315` and `apps/web/app/components/surfaces/TryOnPanel.tsx:507-552` and `apps/web/app/components/surfaces/TryOnPanel.tsx:828-846`.
- The storefront event allowlist now accepts this safe client event: `apps/shopify-app/app/lib/shopper-events.server.ts:25-38`.
- The widget bundle was rebuilt and verified after the UI event patch.

Impact:
- Fit drift, body insight, and "accepted vs changed recommendation" learning could never become live for normal try-on shoppers.
- The dashboard would remain stuck in "collecting selected-size data" even while shoppers were actively choosing sizes in the UI.
- This is a backend/UI disconnect, not a hard algorithm problem: the event contract existed but the main UI never fulfilled it.

Required fix:
- Emit `SIZE_SELECTED` from any non-try-on size selector that can add to cart after a Mira recommendation.
- Add a test that simulates `tryThisSize()` and add-to-bag and asserts `/api/events` receives `SIZE_SELECTED`.
- Add ingestion-side validation/rate limits specific to `SIZE_SELECTED` payload shape so it remains safe as a client-postable event.

## Finding 45: Production Fashion Intelligence Still Used Demo Bundle And Compatibility Names

Severity: P1 for merchant dashboard trust. The production intelligence engine mixed real signals with fixed demo outfit names for fallback bundles and compatibility cards.

Evidence:
- Pre-patch, the fallback combo list contained fixed names like "The tailored neutral", "Tailored Blazer", "Wide-Leg Trouser", and "Silk Camisole".
- Pre-patch, the style compatibility section always returned fixed pairs such as "Tailored Blazer + Wide-Leg Trouser" and "Silk Slip + Leather Trench".
- This branch adds catalog-derived slot and color compatibility helpers that read the merchant's own products, categories/product types, tags, and color families: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:214-306`.
- Combo fallback now comes from `catalogComboFallback(products)` instead of demo products: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:553-555`.
- Compatibility now prefers measured `CHAT_COMBO_PROPOSED.productIds` pair frequency when present and otherwise uses catalog-derived merchant pairs, not demo pairs: `apps/shopify-app/app/lib/fashion-intelligence.server.ts:664-684`.

Impact:
- A merchant dashboard could show polished "intelligence" that referenced products the merchant did not stock.
- It weakened the no-hardcoding scalability requirement: backend data was partly tenant-scoped, but UI insight copy still leaked the demo brand.
- This made the system look like it understood bundles while the merchant-facing compatibility cards were not always grounded in that merchant's catalog.

Required fix:
- Add a dashboard snapshot/contract test that fails if production intelligence outputs known demo product names for a shop without those products.
- Add source metadata for compatibility rows: measured combo event, catalog model, or insufficient data.
- Reuse one shared product taxonomy/color scoring module across widget, core style, and Fashion Intelligence instead of maintaining parallel heuristics.

## Finding 46: The Production Adapter's Fallback Look Builder Picked First Slot Matches, Not Best Matches

Severity: P1 for Mira card quality. When the brain did not provide a rich combo, the Shopify adapter built a look from the merchant catalog, but it selected the first item in each slot rather than the strongest stylistic match.

Evidence:
- `decisionToAdapter()` uses `buildStyledLook()` for live `route: "look"` turns when an active tenant catalog is available: `apps/shopify-app/app/lib/mira-adapter.server.ts:681-686`.
- Pre-patch, `buildStyledLook()` grouped products by slot and `take(slot)` returned the first product in that slot. Since the active catalog is ordered by product freshness, the chosen top/bottom/layer/accessory could be "newest by slot" rather than best color/category/price/season pairing.
- This branch adds slot, color, price, and season scoring helpers, then ranks slot candidates against the anchor before selecting the look pieces: `apps/shopify-app/app/lib/mira-adapter.server.ts:207-260` and `apps/shopify-app/app/lib/mira-adapter.server.ts:263-309`.
- The existing tenant-grounding adapter tests still pass: `pnpm --filter @stylique/shopify-app test -- app/lib/mira-adapter.server.test.ts`.

Impact:
- Mira could render real merchant products while still making weak pairings, which reads as "she knows the product exists but not what goes with it."
- Backend search/brain fixes did not guarantee good UI cards because the adapter fallback had its own lower-quality styling logic.
- This is another overlap issue: widget complete-look, core style, Fashion Intelligence, and Shopify adapter each maintained separate pairing heuristics.

Required fix:
- Extract a single shared compatibility scorer for product slot, color, price friction, season, and silhouette.
- Add tests where catalog order intentionally conflicts with best match; the adapter should choose the best match, not the first match.
- Feed measured co-purchase/co-intent pair signals into the fallback scorer as a tie-breaker when available.

## Finding 47: Upgrade Hints Drifted From The Real Feature Table

Severity: P2 for billing/package clarity. Runtime entitlement correctly enabled proactive Mira triggers on Growth, but the UI helper for upgrade labels still marked that feature as Ultimate.

Evidence:
- `PLAN_FEATURES.GROWTH.stylist.proactiveTriggers` is `true`: `packages/core/src/plans/features.ts:136-146`.
- Pre-patch, `tierForFeature()` manually returned `ULTIMATE` for `stylist.proactiveTriggers`.
- This branch makes `tierForFeature()` derive the lowest matching tier from `PLAN_FEATURES` and `readFeatureFlag()`: `apps/shopify-app/app/lib/entitlement.server.ts:196-202`.
- A focused regression test now proves proactive triggers are labelled Growth, cross-brand benchmarks are Ultimate, and base widget enablement is Starter: `apps/shopify-app/app/lib/entitlement.server.test.ts:53-59`.

Impact:
- Merchants could see wrong upgrade copy even though backend gates behaved correctly.
- This undermines tier trust: a Growth customer might think they need Ultimate for a feature their package already includes.
- It is another source of repeated fixes: enforcement was centralized, but UI/package messaging used a separate manual map.

Required fix:
- Keep all future feature-to-tier UI labels derived from `PLAN_FEATURES`; do not add manual tier switch statements.
- Add dashboard UI tests for locked/unlocked feature labels on Starter/Growth/Ultimate demo plans.
- Review pricing/settings pages for static package copy that may now drift from the feature table.

## Finding 48: Runtime Shopify Scopes Drifted From The Active App Config And Broke Auto-Injection

Severity: P0/P1 for storefront availability. The active Shopify app TOML had the right scope contract for ScriptTag injection, but environment files and deployment docs still taught older scopes. That means OAuth could mint an under-scoped token: catalog sync and some backend jobs would work, while Mira would fail to auto-inject or self-heal on the storefront.

Evidence:
- The active app config declares the right minimal scopes, including `write_script_tags`: `apps/shopify-app/shopify.app.toml:69`.
- Runtime OAuth uses `env.SHOPIFY_SCOPES`, not the TOML string directly: `apps/shopify-app/app/shopify.server.ts`.
- Storefront auto-injection uses Shopify ScriptTag GraphQL in both app install and worker self-heal paths: `apps/shopify-app/app/services/scriptTag.server.ts` and `apps/worker/src/jobs/inject-widget.ts`.
- Pre-patch, multiple env files and live setup docs still used stale scope sets with `write_products`, `read_product_listings`, or `write_metafields`, and omitted `write_script_tags`.
- This branch aligns root/app env files, env examples, Railway/local/staging docs, and adds startup validation for `read_products`, `read_inventory`, `read_orders`, and `write_script_tags`: `apps/shopify-app/app/lib/startup-validation.server.ts:88-119`.
- A focused regression test now fails when `write_script_tags` is missing and passes the required scope contract: `apps/shopify-app/app/lib/startup-validation.server.test.ts`.

Impact:
- This explains the "half works, half will not" symptom: product sync, orders, and dashboards can look alive while the visible storefront widget does not appear.
- Fixing backend card or intent logic would not matter for affected shops because the browser never reliably loaded the widget.
- Stores installed before the scope correction need Shopify re-consent; updating code/env alone cannot upgrade an already-minted under-scoped access token.

Required fix:
- Add a super-admin "Shopify scopes health" check that compares each stored shop token scope set with the required runtime contract and flags re-consent.
- Show injection health in the merchant dashboard: active theme embed status, ScriptTag status, last injection attempt, last storefront load, and last widget heartbeat.
- Prefer the theme app embed path as the primary modern install path, with ScriptTag self-heal/fallback only where appropriate.
- Keep startup validation as the hard guard so this drift cannot silently recur in local, staging, or production.

## Finding 49: Image Truth Was Persisted But Not Used By The Try-On Image Scorer

Severity: P1 for UI/UX card reliability and try-on quality. Shopify image alt text was already synced into `ProductImage`, but the image-quality worker did not pass it into the scorer. At the same time, product sync deleted and recreated image rows while leaving the old `primaryTryonImageId` and `tryonReady` state in place until the async scorer ran. That made the backend look fixed while the UI could still render missing or wrong card images.

Evidence:
- Shopify catalog sync fetches image `altText` and stores it on `ProductImage`: `apps/worker/src/shopifyClient.ts:40-64` and `packages/core/src/catalog/sync.ts:91-99`.
- Pre-patch, the worker selected only `id`, `url`, `position`, and `shopifyId` before scoring, so alt labels like "front product photo", "size guide", "fabric swatch", or "detail" never reached the image scorer.
- This branch adds `altText` to image scoring input and applies front/detail/swatch/lifestyle/size-guide hints in Stage 1: `packages/core/src/imagery/types.ts`, `packages/core/src/imagery/service.ts`, `apps/worker/src/jobs/image-quality.ts:67-80`, and `packages/core/src/imagery/stage1.ts:26-112`.
- Product sync now clears `primaryTryonImageId`, `tryonReady`, `widgetTier`, and `qualityComputedAt` whenever images are replaced, preventing public APIs from trusting a deleted image id: `packages/core/src/catalog/sync.ts:76-88`.
- Regression tests now prove alt text rejects a size-guide/detail image and picks the front product photo, and catalog sync resets stale primary-image state: `packages/core/src/__tests__/imagery-quality.test.ts:111-124` and `packages/core/src/__tests__/catalog.test.ts`.

Impact:
- Mira cards could appear sometimes and disappear other times because `tryonReady=true` did not guarantee `tryonImageUrl` could resolve to a live image row.
- The scorer could choose a lifestyle, detail, size-chart, swatch, or wrong-context image when filenames were generic, even though Shopify metadata contained the right hint.
- This directly explains why backend image extraction felt "fixed" while UI cards still looked unstable.

Required fix:
- Add a true vision classifier for "single garment, correct garment type, front-facing, no model/body/lifestyle composition" and use metadata only as a cheap first pass.
- Preserve or upsert `ProductImage` rows by a unique `(productId, shopifyId)` key in a future migration so prepped image assets and quality history survive ordinary Shopify image resyncs.
- Add dashboard coverage for products with stale/missing primary image, products with only detail/swatch images, and products whose `tryonReady` changed after the last sync.

## Finding 50: Super-Admin Manual Provisioning Was Split Across Two Admin Planes

Severity: P1 for go-to-market onboarding and billing/entitlement trust. The Shopify-app internal ops dashboard already had a pending manual-provisioning path, but the Next super-admin enterprise form only upgraded shops that were already installed. Separately, a manual tier change could write `Plan.tier` without writing a billing-active or ops-comp marker, so billing enforcement could downgrade the effective plan back to Starter even though the UI said Growth or Ultimate.

Evidence:
- The Shopify internal ops route can create a pending shop with `accessToken: "manual-provisioning-pending"` and `uninstalledAt` set, then OAuth later activates the real token path: `apps/shopify-app/app/routes/internal._index.tsx:50-118`.
- Pre-patch, the Next enterprise endpoint returned 404 when the shop did not already exist, which blocked the sales-led onboarding flow from the super-admin surface.
- This branch lets the Next enterprise endpoint normalize a Shopify domain, create a pending inactive shop record, set tier quotas from `PLAN_DEFAULTS`/`PLAN_FEATURES`, and write billing/provisioning metadata including ops comp: `apps/web/app/api/admin/enterprise/route.ts:35-133`.
- The enterprise UI now exposes tier, comp/manual-contract status, and stylist-turn limits instead of hardcoding Ultimate-only onboarding: `apps/web/app/admin/enterprise/page.tsx:6-56` and `apps/web/app/admin/enterprise/page.tsx:191-210`.
- Per-brand tier changes now upsert a full plan contract with default quotas, analytics level, and optional ops comp instead of only mutating `Plan.tier`: `apps/web/app/api/admin/brands/[shopId]/route.ts:32-92`.
- The brand action UI now includes an explicit "Ops comp" control so operators understand whether a manual tier should bypass checkout enforcement: `apps/web/app/admin/brands/[shopId]/BrandActions.tsx:11-39` and `apps/web/app/admin/brands/[shopId]/BrandActions.tsx:118-139`.

Impact:
- Sales-led pilots could not be fully prepared before Shopify install from one admin surface.
- Operators could believe they upgraded a merchant while runtime entitlement still served Starter because billing was not active.
- This is another backend/UI split: quota and enforcement logic existed, but the visible admin controls did not write the complete contract.

Required fix:
- Consolidate internal ops and Next super-admin into one owner or put both behind the same shared provisioning service.
- Add a scopes/injection/install-health panel on the brand detail page: pending install, OAuth token present, required Shopify scopes present, ScriptTag/theme embed status, last sync, and last widget heartbeat.
- Add an admin test that provisions a pending merchant, simulates OAuth activation, and proves the effective plan remains the intended tier under billing enforcement.

## Finding 51: Static Follow-Up Job IDs Made Sync Fixes Run Once And Then Stop

Severity: P0/P1 for catalog freshness, card stability, size recommendations, and try-on readiness. Catalog sync correctly enqueued image-quality and size-chart extraction after products landed, but several follow-up jobs used static BullMQ `jobId`s. A completed job can remain in Redis; future attempts with the same id are treated as duplicates. Combined with image row replacement, a nightly sync could clear try-on readiness and then fail to enqueue the scorer that would restore it.

Evidence:
- Full catalog sync enqueues image-quality and size-chart extraction after every sync: `apps/worker/src/jobs/catalog-sync.ts:105-146`.
- Pre-patch, the full image-quality job used a static id like `iq-after-sync:${shopId}`, and size-chart jobs used static ids like `size-chart:${shopId}:${productId}`.
- This branch time-buckets those follow-up job ids so recurring syncs can enqueue fresh work while still deduping bursts: `apps/worker/src/jobs/catalog-sync.ts:53-55`, `apps/worker/src/jobs/catalog-sync.ts:113-121`, and `apps/worker/src/jobs/catalog-sync.ts:177-189`.
- Pre-patch, product sync deleted and recreated images on every sync. This branch now compares Shopify image truth first and preserves existing image rows, quality state, and prepped assets when the image set is unchanged: `packages/core/src/catalog/sync.ts:76-109`.
- Regression tests now prove image state resets only when images change and remains stable when the Shopify image set is unchanged: `packages/core/src/__tests__/catalog.test.ts:224-282`.

Impact:
- A first install/backfill could look fixed, then later product refreshes would not re-run the repair jobs because duplicate job ids suppressed them.
- The UI could lose cards/try-on readiness after a routine sync even though no merchant-facing product data changed.
- Size recommendations could remain stale after a product size chart changed because the extractor job id had already been consumed.

Required fix:
- Add worker health metrics for "follow-up jobs enqueued vs skipped duplicate" per sync.
- Add a catalog-sync integration test with an in-memory BullMQ/Redis harness proving two syncs across buckets enqueue the scorer/extractor again.
- Move image persistence to stable upserts by `(productId, shopifyId)` in the schema so even changed products preserve quality/prep rows where possible.

## Finding 52: Requirement Coverage Is Uneven; Several Critical Flows Are Still Manual Harnesses

Severity: P1 for regression risk. The repo has strong unit coverage for core catalog, sizing, imagery, plans, analytics, entitlement, adapter, attribution, session, startup validation, and event allowlisting. But the highest-risk user-visible flows — storefront injection, proactive UI timing, dashboard pages, worker scheduling, super-admin provisioning, and Shopify install/re-consent — are not yet protected by automated end-to-end or integration tests.

Evidence:
- Core has many Vitest tests under `packages/core/src/__tests__`, including catalog sync, imagery, sizing parsers, plans, analytics, style scoring, try-on cache/trust, and monthly reports.
- Shopify app has focused Vitest tests for entitlement, Mira adapter, attribution, session behavior, startup validation, and the event endpoint.
- Web has Playwright configured (`apps/web/playwright.config.mjs`) but the root `turbo run test` does not exercise web E2E by default because `@stylique/web` has no `test` script.
- Worker has no test script; critical queue orchestration is covered by typecheck and manual reasoning, not automated BullMQ integration tests.
- Widget has build and bundle verification but no DOM/browser regression suite for proactive trigger timing, card rendering, overlap, mobile layout, or card hydration.
- Several valuable scripts exist (`verify-cart.mjs`, `mira-self-training.mjs`, `pilot-mira-100.mjs`, `storefront-e2e.spec.mjs`), but they are manual scripts rather than a single CI gate with required pass/fail coverage.
- This branch updates the stale worker README so operators see the active queues and real schedules instead of removed creative-era queue names: `apps/worker/README.md`.

Impact:
- Bugs can be fixed in backend logic while the UI keeps failing because browser behavior is not part of the required test gate.
- Queue and install regressions can survive typecheck because they depend on Redis/Shopify/OAuth state, not TypeScript correctness.
- The team keeps rediscovering the same failures because only narrow units are protected; the actual commerce loop spans widget → proxy → Shopify app → worker → Prisma → dashboard.

Required fix:
- Add `test` scripts for `@stylique/web`, `@stylique/widget`, and `@stylique/worker`, then make root `pnpm test` run the meaningful browser/worker coverage.
- Add a Playwright storefront suite for: widget loads after install, no pop-up on entry, outlier same-category trigger fires, cards render stable images, size chart view emits signal, add-to-cart succeeds/fails honestly, and mobile layout has no overlap.
- Add BullMQ integration tests for catalog sync follow-up jobs, injection health, billing reconcile, and monthly/scheduled fan-out.
- Add super-admin API tests for pending merchant provisioning, ops comp billing enforcement, quota defaults, and tier changes.
- Add dashboard contract tests that verify UI labels and metrics come from the same backend contracts as enforcement and analytics.

## Finding 53: The Storefront Browser Contract Existed As A Test Idea, Not A Stable DOM Contract

Severity: P1 for UI/UX verification. The real-storefront Playwright scaffold expected selectors like `[data-stylique-widget]`, `[data-stylique-tryon-sheet]`, `[data-stylique-tryon-body]`, and `[data-stylique-tryon-footer]`, but the live widget only exposed some of them and only after Mira was already open. That means browser tests could fail before validating the actual behavior, and support/QA had no stable hooks to prove whether the storefront widget was mounted, open, scrollable, or overlapping.

Evidence:
- The E2E scaffold waits for `iframe[src*="stylique"], [data-stylique-widget]` before opening Mira: `apps/web/scripts/storefront-e2e.spec.mjs`.
- Pre-patch, `[data-stylique-widget]` was only on the open conversation log, not on a stable mounted root, so a closed-but-mounted launcher did not satisfy the test contract.
- This branch adds a root widget selector and open/closed state immediately around the storefront widget: `apps/web/app/components/mira/MiraWidget.tsx:3170`.
- The launcher, input, send, and checkout selectors already exist and remain the browser contract: `apps/web/app/components/mira/MiraWidget.tsx:157-160`, `apps/web/app/components/mira/MiraWidget.tsx:3246-3250`, and `apps/web/app/components/mira/MiraWidget.tsx:3396-3397`.
- This branch adds try-on sheet/body/footer selectors so mobile overlap tests can measure the actual fitting-room geometry: `apps/web/app/components/surfaces/TryOnPanel.tsx:928-933`, `apps/web/app/components/surfaces/TryOnPanel.tsx:1140-1141`, and `apps/web/app/components/surfaces/TryOnPanel.tsx:1446-1448`.
- The bundle verifier now fails if those browser-contract selectors disappear from the served storefront bundle: `apps/widget/scripts/verify-bundle.mjs:8-24`.

Impact:
- The team could say "we have a browser harness" while the harness was not connected to a reliable DOM contract.
- UI regressions such as Mira not mounting, fitting-room footer overlap, or missing checkout controls could survive because selectors were inconsistent or absent.
- This is a root cause of backend/UI mismatch: implementation, QA scripts, and merchant support were not reading the same surface.

Required fix:
- Promote `apps/web/scripts/storefront-e2e.spec.mjs` into a CI-runnable Playwright suite with a controlled storefront fixture.
- Add tests for closed mount, open panel, proactive nudge, try-on mobile sheet geometry, checkout button, accessible names, and cart add success/failure.
- Treat `data-stylique-*` attributes as a public test/support contract; changes require verifier and E2E updates in the same PR.

## Finding 54: Intent Nudges Used A Session Boolean, So Weak Signals Could Block Stronger Outliers

Severity: P1 for conversion UX. Mira did have intent-trigger code, but the suppression model was too blunt: one early nudge wrote `sessionStorage.mira_nudged = "1"` for the whole session. Later, stronger evidence such as repeated same-category comparison, route re-approach, variant indecision, dwell, or exit intent could be suppressed without considering trigger strength, product, or time.

Evidence:
- The proactive trigger effect used a local `fired` flag plus global `mira_nudged`, so it could only reason about "anything already happened", not whether the later signal was better: `apps/web/app/components/mira/MiraWidget.tsx`.
- The route re-approach effect also suppressed on the same global flag, causing a prior weak nudge to block same-category revisit intent.
- Same-category comparison previously counted `unknown` category products as if they formed a meaningful category, so poor extraction could create false positives.
- Suppressed trigger payloads included `triggerType`, but the shared event schema did not allow `triggerType` for `MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED`; strict parsing rejected those events as `invalid_payload`: `packages/types/src/index.ts`.
- This branch adds a structured `mira_nudge_state` with trigger type, confidence, product handle, and timestamp, plus arbitration that allows later stronger signals after a cooldown while still blocking spammy repeat nudges: `apps/web/app/components/mira/MiraWidget.tsx`.
- This branch changes same-category counting to ignore `unknown` category products and adds `triggerType` to the suppressed-event schema: `apps/web/app/components/mira/MiraWidget.tsx` and `packages/types/src/index.ts`.
- The rebuilt storefront bundle now contains the same intent arbitration fix: `apps/shopify-app/extensions/stylique-widget/assets/tryon.js` and `apps/shopify-app/public/widget.js`.
- Follow-up closeout: the route-local proactive effect no longer marks the whole route as `fired` when a non-open suppressed trigger occurs; each suppressed trigger type is de-duped locally, but a later stronger trigger can still fire on the same PDP route.

Impact:
- This directly explains the "Mira does not pop up at the right time" symptom. Backend/product understanding could be correct, but the UI could silence the right moment because an earlier weaker moment already set a boolean.
- It also explains why debugging was hard: the client emitted suppression telemetry, but some suppressed events were rejected by the backend schema, so dashboards/logs could under-report the reason Mira stayed quiet.
- The unknown-category false positive made intent look agentic when catalog extraction was weak, which is the opposite of scalable product understanding.

Required fix:
- Keep the structured nudge state and suppression reasons as the only client suppression contract.
- Add Playwright tests for: no nudge on entry, no same-category trigger for unknown products, stronger later signal can replace a weak earlier one after cooldown, recent repeat signals are suppressed, and suppressed telemetry is accepted by `/api/events`.
- Feed these trigger outcomes into commerce intelligence so brands can see which proactive moments convert, not just whether Mira opened.

## Finding 55: Production Fashion Intelligence Still Contained Fixed Demo-Like Merchant Claims

Severity: P1 for merchant trust and scale. The Shopify dashboard UI correctly labels many cards as measured/modelled, but the underlying production `FashionIntelligence` contract still returned several fixed values that were not derived from the merchant's products or shoppers. That means future dashboard surfaces could accidentally display non-scalable claims as if they were brand-specific intelligence.

Evidence:
- Pre-patch, conversion confidence, drop-off stages, full-look multiplier, and stylist spend lift used fixed constants instead of event-derived values.
- Pre-patch, collection performance returned fixed collection names like Tailoring/Evening/The Atelier and fixed age ranges, even for brands with completely different catalogs.
- Pre-patch, emerging trends returned fixed rows like oversized silhouettes, natural tones, silk, and neon.
- Pre-patch, the early-data fit insight claimed a fixed "65%" upsize behavior even when there was not enough selected-size evidence.
- Pre-patch, the executive "Fastest-growing colour" card always reported Natural tones with a +18% try-on trend.
- This branch changes production Fashion Intelligence to derive collection rows from the shop's own products, trends from real demand/gap text, drop-off from actual funnel counts, confidence/lift/multiplier from observed event rates, and early fit copy from available evidence: `apps/shopify-app/app/lib/fashion-intelligence.server.ts`.

Impact:
- This was not just cosmetic. If the UI later exposed the full `FashionIntelligence` contract, a Pakistani formalwear brand, a footwear brand, or a streetwear brand could receive the same "Tailoring / Evening / Natural tones" claims.
- That breaks the brand-DNA promise: merchants are paying for what Mira learns about their brand and shoppers, not generic demo merchandising copy.
- It also creates team confusion: backend may be "fixed" in extraction and analytics, while the dashboard still feels hardcoded because a later presentation layer uses fixed intelligence rows.

Required fix:
- Keep the current production contract evidence-derived, with `0`, `null`, or empty arrays when data is insufficient instead of polished guesses.
- Add dashboard/API tests for a non-fashion-demo catalog proving collections, trends, and executive cards change with merchant products and demand text.
- Add source metadata to all non-executive Fashion Intelligence sections, not only exec cards, so every future UI can preserve measured/modelled/insufficient labels.

## Finding 56: Live Storefront E2E Was Allowed To Silently Pass Without A Store

Severity: P0 release gate. The only harness that can prove real Shopify storefront behavior depends on `SHOPIFY_TEST_STORE_URL`, but the spec exited with status `0` when the variable was missing. That means CI or an operator could run the E2E command, see a green job, and still have no proof of widget mount, real `/cart/add.js`, checkout navigation, keyboard access, screen-reader labels, or mobile fitting-room layout.

Evidence:
- `apps/web/scripts/storefront-e2e.spec.mjs` requires a live Shopify dev store with the app/extension installed.
- Pre-patch, missing `SHOPIFY_TEST_STORE_URL` printed a message and called `process.exit(0)`.
- `apps/web/playwright.config.mjs` documented that missing infra should "exit 0", which made the release gate optional by default.
- This branch changes missing `SHOPIFY_TEST_STORE_URL` to `process.exit(1)` and updates the Playwright config comment to treat live storefront proof as a release gate, not a silent skip.

Impact:
- This explains how storefront/cart/UI regressions could survive repeated closeout passes. The codebase had a real-storefront script, but it could report success without touching a storefront.
- It also explains the user's "backend fixed but UI still broken" concern: no required browser gate forced the injected Shopify artifact, live cart, and mobile UI to be verified together.

Required fix:
- Provide a real `SHOPIFY_TEST_STORE_URL` in local/staging CI and run `pnpm --filter @stylique/web e2e` after the app is installed and the tunnel/app URL are synced.
- Add the app install/tunnel preflight to the harness or CI workflow so the test fails with a clear actionable reason when Shopify is not ready.
- Keep this E2E separate from unit smoke tests; do not let a missing live store count as a pass.

## Finding 57: Theme Editor Settings Existed But Were Not Wired Into The Storefront Runtime

Severity: P1 for merchant UX and implementation trust. The Shopify theme app embed exposed settings for app proxy prefix, accent color, CTA label, placement, and enable/disable toggles, but the Liquid runtime only set currency and loaded `tryon.js`. Several controls therefore looked editable in Shopify Theme Editor while the actual storefront widget ignored them.

Evidence:
- The theme block schema exposes `app_proxy_prefix`, `accent_color`, `cta_label`, `placement`, `enable_widget`, `enable_stylist`, and `enable_pdp_inline`: `apps/shopify-app/extensions/stylique-widget/blocks/stylique_widget.liquid`.
- The widget entry expects `window.__sqProxyBase` and otherwise defaults to `/apps/stylique`: `apps/widget/src/mira-demo.tsx`.
- Pre-patch, Liquid never set `window.__sqProxyBase`, so a merchant/operator changing the app proxy prefix would not change API routing.
- Pre-patch, accent color and CTA label were not passed to the bundle; the widget CSS tokens and PDP overlay label remained hardcoded.
- This branch passes `__sqProxyBase` and `__sqTheme` from Liquid into the runtime, applies accent color to widget CSS variables, applies the CTA label to the PDP inline button without unsafe `innerHTML`, and respects `enable_pdp_inline` / `enable_widget` for the inline try-on overlay.
- The bundle verifier now checks for `__sqTheme`, `__sqProxyBase`, and CTA fallback strings so this bridge cannot disappear unnoticed: `apps/widget/scripts/verify-bundle.mjs`.

Impact:
- This directly matches the user's UI/UX concern: backend/app-proxy settings could be correct, but the UI still ignored merchant configuration.
- It also creates false confidence for onboarding: merchants can believe they customized Stylique, while shoppers still see the default color/CTA/proxy behavior.
- The remaining overlap is that `enable_stylist` and `enable_widget` are not fully independent surfaces because the current bundle is one combined Mira/TryOn runtime. The inline PDP button can be disabled, but the combined dock/panel architecture needs a presenter/runtime split before those toggles are perfect.

Required fix:
- Keep passing runtime settings through Liquid and bundle verification.
- Split the storefront runtime into explicit surface flags or props so `enable_stylist=false` can hide the Mira dock while preserving try-on, and `enable_widget=false` can hide try-on without disabling the stylist.
- Add a theme fixture/browser test proving accent color, CTA label, app proxy prefix, and surface toggles alter the actual DOM/runtime behavior.

## Finding 58: Internal Ops Tier Changes Could Strip The Real Plan Contract

Severity: P1 for manual onboarding, quotas, and billing enforcement. The newer super-admin enterprise path wrote a full plan contract: tier, quota columns, analytics level, comp/billing metadata, and provisioning state. But the Shopify internal ops pages still had quick tier-change actions that only updated `Plan.tier`. A brand could be provisioned correctly, then a later ops tier click would leave quota columns, billing metadata, and analytics defaults stale or incomplete.

Evidence:
- The web super-admin enterprise API writes tier defaults from `PLAN_DEFAULTS` / `PLAN_FEATURES`, billing/comp metadata, and provisioning status.
- Pre-patch, `apps/shopify-app/app/routes/internal._index.tsx` `change_tier` only upserted `{ tier }`.
- Pre-patch, `apps/shopify-app/app/routes/internal.$shopId.tsx` `change_tier` only upserted `{ tier }`.
- Pre-patch, internal ops `provision_brand` wrote pending metadata but did not populate quota columns or analytics level from the shared plan tables.
- This branch adds shared internal helpers that compute tier defaults from `PLAN_DEFAULTS` and `PLAN_FEATURES`, preserve existing JSON, write `billing`, `billingActive`, `comp`, `provisioning`, quota columns, and `analyticsLevel` on provision and tier changes in both internal ops routes.

Impact:
- This explains why manual enterprise/onboarding fixes can seem to work and then regress from a different admin panel.
- Quota meters, entitlement checks, dashboard labels, billing enforcement, and merchant expectations can read different parts of the plan row. Updating only `tier` leaves those surfaces out of sync.
- This is especially dangerous during early sales-led onboarding, where ops manually comp and tier brands before or after Shopify OAuth.

Required fix:
- Keep all admin planes writing through one shared `buildPlanContract()` helper rather than duplicating patch logic in routes.
- Add route/action tests for internal provision, internal tier change, brand-detail tier change, and web super-admin enterprise creation proving quota columns and JSON billing metadata stay consistent.
- Add an internal "plan contract health" tile showing tier, billing state, comp state, quota columns, resolved effective tier, and required Shopify scopes.

## Finding 59: Some Internal Ops Mutations Were Authenticated But Not CSRF-Protected

Severity: P1 security. The brand-detail page had CSRF protection, but the internal ops index and jobs pages did not. Those pages can provision merchants, change tiers, pause a brand, send notifications, and pause/resume generation globally. Cookie authentication plus `SameSite=Strict` lowers risk, but it does not replace an explicit per-form mutation token on an admin plane.

Evidence:
- `apps/shopify-app/app/routes/internal.$shopId.tsx` already generated and verified CSRF tokens for destructive actions.
- Pre-patch, `apps/shopify-app/app/routes/internal._index.tsx` required internal auth but accepted destructive POSTs without `verifyCSRFToken`.
- Pre-patch, `apps/shopify-app/app/routes/internal.jobs.tsx` required internal auth but accepted `pause_all` and `resume_all` without `verifyCSRFToken`.
- This branch adds CSRF token generation to those loaders, hidden CSRF fields to their forms, and action-level verification before any mutation runs.

Impact:
- If an internal user had an active ops cookie, a malicious page or browser/plugin bug had a wider blast radius than necessary.
- A single forged mutation could change quota/billing state for a merchant or pause generation across all brands.
- This is part of the broader "super admin must be top-notch security" requirement: the admin plane is now closer to the same mutation discipline as the brand-detail route.

Required fix:
- Keep CSRF verification on every cookie-authenticated internal mutation.
- Add route tests that POST without CSRF and assert `403` for internal index, brand detail, and jobs actions.
- Consider replacing shared-password internal auth with named operator accounts, audit logs, and role-scoped permissions before real enterprise rollout.

## Finding 60: Brand DNA Catalog Extraction Ignored Rich Product Metadata And Scored Image Choice

Severity: P1 for scalable brand/product understanding. The catalog sync and image-quality pipeline now store product type, tags, description HTML, image alt text, prepped image URLs, and `primaryTryonImageId`. But Brand DNA catalog extraction only sent title, category, primary color, and the first few image URLs to Gemini. That meant the brand-DNA layer could miss the very facts the rest of the system had already extracted.

Evidence:
- Pre-patch, `apps/worker/src/jobs/brand-dna-catalog.ts` selected only `title`, `category`, `primaryColor`, and image `url`.
- Pre-patch, `packages/core/src/studio/brand-dna.ts` accepted `imageUrls: string[]` and wrote prompt metadata as only title/category/color.
- This branch expands Brand DNA catalog input to include `productType`, `tags`, sanitized `descriptionText`, and image `altText`.
- This branch updates the worker to select `productType`, `tags`, `descriptionHtml`, `primaryTryonImageId`, image `preppedUrl`, and image `altText`, then sort images so the scored primary try-on image is sent first and the prepped URL is preferred.
- A focused core test now asserts the actual Gemini prompt includes product type, tags, description text, and image alt text: `packages/core/src/__tests__/brand-dna.test.ts`.

Impact:
- Brand DNA could be "fixed" in storage and UI but still be thin at extraction time.
- This weakens scalability: different brands and product categories can collapse into generic visual DNA when product metadata is not part of the model context.
- It also undercuts image correctness: the system may know which image is the right garment/hero image, but Brand DNA used first-position images instead of the scored image.

Required fix:
- Keep Brand DNA extraction fed from the same catalog/image-quality contract as try-on and recommendations.
- Add worker integration coverage proving `primaryTryonImageId`, prepped URL, tags, and description reach `extractDNAFromCatalogProducts`.
- Extend Brand DNA output with source confidence and sample coverage so the dashboard can say whether DNA came from catalog metadata, image vision, Instagram, or manual assets.

## Finding 61: Manual Size-Chart Backfill Could Not Reliably Repair Stale Products

Severity: P1 for fit accuracy and admin trust. The admin backfill endpoint used a permanent BullMQ `jobId` per product and reported coverage using `sizeChartJson: { not: undefined }`. That creates two bad loops: repeated manual repair attempts can be silently deduped forever, and the dashboard can miscount products as covered because `undefined` is an omitted Prisma filter, not a real JSON-null test.

Evidence:
- Pre-patch, `apps/shopify-app/app/routes/api.admin.size-charts.backfill.tsx` enqueued each product as `size-chart:${shop.id}:${product.id}`.
- BullMQ job-id dedupe means a product already queued/completed with that id may not be reprocessed by a later "backfill" click.
- Pre-patch, the coverage loader counted `sizeChartJson: { not: undefined }`, which is not a reliable "has chart" predicate for nullable JSON.
- This branch scopes manual backfill job ids to a request run id and returns the number of jobs actually accepted.
- This branch changes coverage to `sizeChartJson: { not: Prisma.AnyNull }`.

Impact:
- This directly explains "we keep trying to fix it, but it does not fix": the admin action could appear successful while no new extraction job actually ran.
- Fit recommendation UI can keep falling back to generic/category sizing even after ops clicked backfill.
- Merchant dashboards can show reassuring coverage while Mira still lacks product-level chart facts.

Required fix:
- Add route tests or integration tests proving repeated manual backfills enqueue a fresh run and coverage excludes DB/JSON null values.
- Show the latest extraction timestamp, candidate source, and last failure reason per product in the merchant/admin dashboard.
- Add a "force refresh selected products" path that records an operator audit event and bypasses stale dedupe intentionally.

## Finding 62: Size-Chart Image OCR Could Miss The Real Chart In Common Shopify Galleries

Severity: P1 for size recommendation quality. The pipeline had the right concept: extract size charts from image metadata and OCR. But the implementation still depended on a narrow image window and gallery order. Generic DETAIL images could consume the three OCR attempts before an explicit size-guide image was reached, especially when merchants place size charts after model/product/detail shots.

Evidence:
- Pre-patch, `apps/worker/src/jobs/size-chart-extract.ts` selected only five product images without an explicit position order.
- Pre-patch, `packages/core/src/sizing/index.ts` iterated candidate images in input order and treated every `DETAIL` image as chart-worthy with the same three-attempt cap.
- This branch orders worker images by Shopify gallery position and widens the extraction window to 12 images.
- This branch ranks OCR candidates before calling Vision: alt text mentioning size/chart/guide first, URL keyword second, generic DETAIL role last.
- A focused regression test now proves an alt-labeled size chart behind three generic detail images is OCR'd first: `packages/core/src/__tests__/sizing-parsers.test.ts`.

Impact:
- The system could honestly say "image OCR exists" but still miss many real size charts.
- Mira would then fail size recommendations on products where the needed chart was visibly present to a human shopper.
- This is another backend/UI mismatch: the UI may show "fit unavailable" or generic guidance because extraction never reached the correct image, not because the product lacked data.

Required fix:
- Persist `sizeChartCandidatesJson` in the dashboard with source/image evidence so ops can see which image was OCR'd.
- Add extraction metrics for OCR skipped/attempted/succeeded by reason (`alt`, `url`, `detail`) and alert when products with size-guide alt text still have no chart.
- Consider a lightweight image classifier for chart/table detection before Vision OCR, so generic detail shots do not spend model quota.

## Finding 63: Recommendation Cards Had No No-Image Fallback While Look Cards Did

Severity: P1 for UI/UX reliability. The look-board UI already handled products without photos by rendering a premium fallback tile, but the single recommendation card always rendered `next/image` with `p.images[0]`. On a real Shopify catalog, products can have no images, missing images, blocked CDN images, or adapter results that omit the image. Those products could make a recommendation card look blank or fail to render, even though the backend decision and product grounding were otherwise correct.

Evidence:
- Pre-patch, `apps/web/app/components/mira/MiraWidget.tsx` `RecoCard` rendered `<Image src={p.images[0]} ... />` unconditionally.
- The same file's `LookCard` already had a no-photo fallback tile, proving the UI had solved this for one card type but not the other.
- `realToProduct()` legitimately creates `images: []` when Shopify/product adapter data has no usable image.
- This branch adds a styled no-photo fallback tile to `RecoCard`, matching the resilience already present in look cards.
- This branch adds stable `data-stylique-reco-card` and `data-stylique-look-card` hooks and extends widget bundle verification so the storefront artifact fails if those hooks disappear.
- The storefront widget bundle was rebuilt and verified after the UI change.

Impact:
- This explains why "cards sometimes come up, sometimes they don't" can persist after backend fixes: a real product row with weak/missing image data can still break the UI card.
- It also makes extraction/image-quality bugs look like Mira brain bugs, because the decision exists but the visible shopping object disappears.
- The user sees an inconsistent assistant, while the system sees "decision succeeded." That mismatch is exactly why the same bugs keep being chased in the wrong layer.

Required fix:
- Add browser/component tests for recommendation cards with image, no image, broken image, and long product names.
- Assert visible recommendation/look card counts in the live storefront E2E harness using `data-stylique-reco-card` and `data-stylique-look-card`.
- Surface no-image catalog gaps in the merchant dashboard so brands understand why cards fall back instead of silently blaming Mira.

## Finding 64: Dashboard Intelligence Mixed Internal Maintenance Rows With Shopper Demand

Severity: P1 for brand value and trust. The headline catalog-gap count had been cleaned up to exclude internal `size_chart_extract` / `no_size_chart:*` bookkeeping rows, but the Growth+ reorder-intelligence section still grouped raw `CatalogGap` rows without the same filter. The result: a dashboard could tell a brand what to stock next based partly on our own missing-size-chart maintenance jobs, not real shopper demand.

Evidence:
- Pre-patch, `topCatalogGaps()` excluded `source = size_chart_extract` and `rawQuery startsWith no_size_chart`.
- Pre-patch, `headline.catalogGaps` only excluded `source = size_chart_extract`, but did not exclude `no_size_chart:*` rows from other future/internal sources.
- Pre-patch, the Growth+ `catalog.gaps` groupBy did not exclude either internal source or `no_size_chart:*` raw queries.
- This branch adds one shared `realCatalogGapWhere(shopId, since)` helper and uses it for headline gap count, top gap summaries, and Growth+ reorder-intelligence gap ranking.
- A focused dashboard test now asserts that the merchant-demand filter excludes internal size-chart bookkeeping rows: `apps/shopify-app/app/lib/dashboard.server.test.ts`.

Impact:
- This is the exact failure mode where backend jobs are useful internally but poison the merchant-facing learning loop.
- Brands could see "what to stock next" recommendations that were really "which products need size-chart extraction."
- It makes the product feel impressive but untrustworthy: the dashboard speaks like commerce intelligence while its evidence is mixed with ops telemetry.

Required fix:
- Keep all merchant-facing demand intelligence on one reusable "real shopper demand" filter.
- Add data-quality counters to the dashboard/admin observability page: shopper gaps, near-misses, internal catalog gaps, excluded maintenance rows.
- Expand tests to cover every visible gap widget and recommendation generator that reads `CatalogGap`.

## Finding 65: Brand Taste And Network Benchmarks Counted JSON-Null Taste Sessions

Severity: P1 for learning-loop quality. Dashboard brand taste and network benchmark snapshots used `tasteVectorJson: { not: undefined }` on a nullable JSON field. As with size charts, `undefined` is not a real JSON-null predicate; it can become an omitted filter. That lets sessions with no computed taste vector into sample counts and benchmark snapshots.

Evidence:
- Pre-patch, `apps/shopify-app/app/lib/dashboard.server.ts` queried `ShopperSession` with `tasteVectorJson: { not: undefined }` for the Growth+ taste profile.
- Pre-patch, `apps/shopify-app/app/lib/network.server.ts` used the same filter in `recomputeBrandSnapshot()`.
- This branch changes both to `tasteVectorJson: { not: Prisma.AnyNull }`.
- `apps/shopify-app/app/lib/network.server.test.ts` now asserts `recomputeBrandSnapshot()` uses `Prisma.AnyNull` and only snapshots sessions with computed taste vectors.

Impact:
- Taste intelligence can show a misleading sample size or empty distributions while claiming the brand has learned from shoppers.
- Ultimate cross-brand benchmarks can be diluted by shops whose snapshots include non-taste sessions.
- This weakens one of the core business promises: "Mira learns what shoppers want and turns it into brand intelligence."

Required fix:
- Use explicit JSON-null predicates for every nullable JSON metric field.
- Add data-health tiles for taste coverage: sessions with signals, sessions with computed taste vector, stale vectors, recompute failures.
- Add a nightly assertion that `BrandTasteSnapshot.sampleSize` matches the count of non-null, signal-qualified taste vectors.

## Finding 66: Network Benchmark Try-On Volume Used A Stale Event Instead Of Real Try-On Sessions

Severity: P1 for cross-brand benchmark accuracy. The main dashboard had already moved try-on activity to `TryOnSession` rows because `WIDGET_OPENED` was not the real source of render activity. But the network snapshot builder still used `WIDGET_OPENED` for `tryOnSessions`, so Ultimate benchmark percentiles could disagree with the merchant dashboard.

Evidence:
- Pre-patch, `apps/shopify-app/app/lib/network.server.ts` set `tryOnSessions = n("WIDGET_OPENED")`.
- The dashboard headline uses `prisma.tryOnSession.count(...)` as the real try-on activity source.
- This branch changes `recomputeBrandSnapshot()` to count `TryOnSession` rows for the same shop/window.
- `apps/shopify-app/app/lib/network.server.test.ts` now asserts the snapshot writes the real try-on count from `tryOnSession.count()`.

Impact:
- A brand could see one try-on count in its dashboard and a different basis in benchmark percentiles.
- This is how "commerce intelligence" becomes internally inconsistent across surfaces.
- It also hides actual VTO adoption if render/session rows exist but legacy widget-open events do not.

Required fix:
- Keep benchmark snapshots and dashboard headlines on the same source-of-truth metric definitions.
- Add metric-contract tests that compare dashboard and benchmark source fields for chat, try-on, fit, cart, and combo counters.
- Document source ownership for every visible KPI in the audit doc and dashboard code.

## Finding 67: Successful Cart Events Lost The Selected Size Evidence

Severity: P1 for fit intelligence and attribution quality. The cart helper resolved and added the correct Shopify variant by size, and the `/api/mira/conversion` endpoint already accepted a `size` field. But the widget did not send that size when recording successful Mira cart adds. Try-on cart events also emitted `CART_FROM_TRYON` without the effective rendered size. The sale could be real, but the learning loop lost the size context.

Evidence:
- Pre-patch, `apps/web/app/components/mira/MiraWidget.tsx` posted `{ productHandle }` to `/api/mira/conversion` after single-item and full-look cart success.
- `apps/shopify-app/app/routes/proxy.shopper.$.tsx` already accepted `size` and stored it in the `CART_FROM_MIRA` payload.
- Pre-patch, `apps/web/app/components/surfaces/TryOnPanel.tsx` emitted `CART_FROM_TRYON` with only `renderId` or `comboName`, not `effectiveSize`.
- Pre-patch, `packages/types/src/index.ts` did not allow `size` on `CART_FROM_TRYON`.
- This branch sends recalled selected size on Mira conversion events, allows `size` on `CART_FROM_TRYON`, and emits `effectiveSize` from single and look try-on cart success.
- The web/types checks passed and the storefront widget bundle was rebuilt/verified.

Impact:
- Fit intelligence could know what size Mira recommended and what size the shopper selected, but lose the size at the moment of cart conversion.
- Brands would have weaker evidence for whether Mira's sizing guidance drives purchases, returns, or size drift.
- This is another source of "backend fixed but intelligence still thin": the UI performed the right action, but the analytics payload dropped the key context.

Required fix:
- Add cart-event contract tests proving `CART_FROM_MIRA`, `CART_FROM_TRYON`, and `CART_FROM_WIDGET_STYLE` preserve selected size/product/bundle context.
- Extend fulfilled-order attribution to compare purchased variant size against the prior selected/recommended size when variant mapping is available.
- Add a dashboard fit-quality tile that distinguishes recommended size, selected size, cart size, purchased variant size, and returned size.

## Finding 68: Worker Observability Missed Learning-Loop And Merchant-Value Jobs

Severity: P1 for recurrence prevention. The jobs for fit tuning, widget injection repair, and monthly reporting existed, but some of their operational wires were incomplete. That means a fix could be scheduled and locally type-safe while still failing silently enough that the first visible symptom would be Mira not improving, Mira not appearing after a theme/script issue, or merchants not receiving value reports.

Evidence:
- Pre-patch, `apps/worker/src/index.ts` created `fitTunerWorker`, `injectWidgetWorker`, and `monthlyReportWorker`.
- Pre-patch, the generic dead-letter handler list included `injectWidgetWorker`, but omitted `fitTunerWorker` and `monthlyReportWorker`.
- Pre-patch, the active worker startup log omitted `fit-tuner`, `inject-widget`, and `monthly-report`, so the process could start without clearly declaring those critical jobs.
- Pre-patch, `/health` monitored `inject-widget`, but omitted `fit-tuner` and `monthly-report`; `fit-tuner` was also missing from the critical health gate even though it is the closed-loop learning job.
- Pre-patch, `scheduleNightlyRecommendations()` created a local `inject-widget` queue handle and never closed it, while shutdown also failed to close `injectWidgetWorker`, `fitTunerQueue`, and `catalogSyncQueue`.
- This branch promotes the inject-widget queue handle to module scope, wires `fit-tuner` and `monthly-report` into dead-letter handling, exposes both jobs in health, makes `fit-tuner` health-critical, includes all active jobs in startup logging, and closes the missing worker/queue handles during shutdown.
- `pnpm --filter @stylique/worker typecheck` passes after the change.

Impact:
- A broken fit tuner could stop Mira's learning loop without Redis DLQ/Sentry parity and without health failing red.
- A broken monthly report job could quietly erode merchant trust because value reporting would not reliably surface operationally.
- The widget injection self-heal queue was scheduled through an unclosed local handle, increasing shutdown/leak risk and making this production-critical backstop less cleanly managed.
- This is exactly the kind of backend/UI gap the user called out: the system may have a backend job, but if health, logs, and failure routing do not name it, teams keep chasing symptoms in the UI.

Required fix:
- Keep every queue in four places as a contract: worker instance, scheduler/enqueue path, dead-letter handler, and health endpoint.
- Add a worker registry test that fails if a queue is scheduled but missing from health, startup logging, or failed-job routing.
- Add an ops dashboard tile for last successful run time of `catalog-sync`, `image-quality`, `size-chart-extract`, `brand-dna-catalog`, `fit-tuner`, `inject-widget`, and `monthly-report`.

## Finding 69: Billing Checkout Prices Drifted From The Commercial Source Of Truth

Severity: P0 for launch billing. The founder source of truth and dashboard ROI math use Starter/Growth/Ultimate at $199/$449/$849 per month, but the self-serve Shopify billing route defaulted to $49/$199/$499. That means a merchant could approve a real Shopify subscription at the wrong amount while the dashboard reported payback against a different list price.

Evidence:
- `CLAUDE.md` defines the commercial model as Starter $199, Growth $449, Scale/Ultimate $849.
- `packages/core/src/billing/costs.ts` exports `PLAN_PRICE_USD` as `199/449/849`.
- Pre-patch, `apps/shopify-app/app/routes/app.billing.tsx` used hardcoded defaults of `49/199/499`, with env overrides.
- Pre-patch, `apps/shopify-app/app/lib/dashboard.server.ts` carried its own separate `PLAN_PRICE_CENTS` map, plus a legacy `SCALE` alias.
- Pre-patch, the billing-confirmation loader wrote the confirmed plan to Prisma but returned the stale `shop.plan` object loaded before the upsert.
- This branch makes Shopify billing defaults derive from `PLAN_PRICE_USD`, keeps env overrides for controlled tests/promos, makes dashboard ROI derive from the same shared price table, and returns the updated plan after confirmation.
- `pnpm --filter @stylique/shopify-app typecheck` passes after the change.

Impact:
- Brands could be underbilled relative to the plan they believed they selected.
- Assisted-revenue ROI could appear lower/higher depending on which hardcoded price a surface used.
- Support and super-admin would see a plan tier that looked correct while the actual Shopify charge amount was wrong.
- This is a direct "nothing hard-coded" scale issue: commercial constants must not live separately in billing, dashboard, and cost math.

Required fix:
- Keep `PLAN_PRICE_USD` as the only default price source for checkout, dashboard ROI, and internal margin math.
- Add a billing route test that asserts Shopify subscription mutation amounts match `PLAN_PRICE_USD` unless explicit env overrides are set.
- Decide whether public naming should be `ULTIMATE` or `SCALE`, then keep enum/internal naming and merchant-facing labels mapped deliberately rather than mixed ad hoc.

## Finding 70: Shopify Scope Health Was Validated At Startup But Not Per Installed Merchant

Severity: P1 for storefront injection and catalog/order reliability. The active app config and env validation now require the correct scope set, but existing installed merchants can still hold older under-scoped OAuth tokens until they re-consent. Before this branch, super-admin issue triage did not explicitly flag that merchant-token mismatch, so operators could chase widget/UI symptoms while the real problem was stale Shopify scopes.

Evidence:
- The active Shopify app config declares `read_products,read_inventory,read_orders,write_script_tags`.
- Runtime OAuth reads `env.SHOPIFY_SCOPES`; startup validation fails if required scopes are missing.
- Existing shops persist their granted token scopes on `Shop.scopes`.
- Pre-patch, `apps/shopify-app/app/lib/internal-dashboard.server.ts` did not compare stored merchant scopes against the required contract.
- Pre-patch, `apps/shopify-app/app/routes/internal.$shopId.tsx` showed no install/scope health panel, despite widget injection and order attribution depending on those scopes.
- This branch adds stored-token scope comparison to internal brand summaries/details and adds an "Install + Shopify scopes" panel to the brand detail page with widget heartbeat, missing scopes, and the re-consent action.
- `pnpm --filter @stylique/shopify-app typecheck` passes after the change.

Impact:
- A shop installed before a scope update could have working product read paths but fail ScriptTag injection/self-heal because `write_script_tags` was not granted.
- Operators would see "Mira does not pop up" as a UI issue even when the real fix is merchant re-consent.
- Catalog sync, inventory availability, order attribution, and storefront injection now have one visible ops checkpoint.

Required fix:
- Keep startup validation for future OAuth tokens and per-shop scope health for existing tokens.
- Add a one-click internal action or documented merchant link to trigger re-consent for shops missing required scopes.
- Add an internal dashboard test that asserts missing `write_script_tags` appears in `openIssues`.

## Finding 71: Live Storefront E2E Was Still Bound To One Demo Product Handle

Severity: P2 for test realism and scale. The real-storefront Playwright harness is now correctly fail-closed when no live store URL is provided, but it still hardcoded `linen-relaxed-shirt` as the PDP under test. That makes the harness useful only for one demo catalog and easy to skip for real merchants whose product handles differ.

Evidence:
- Pre-patch, every scenario in `apps/web/scripts/storefront-e2e.spec.mjs` navigated to `/products/linen-relaxed-shirt`.
- That same harness is meant to prove live Shopify cart add, checkout CTA, keyboard access, screen-reader labels, and mobile try-on layout.
- This branch replaces the hardcoded product slug with required `SHOPIFY_TEST_PRODUCT_HANDLE` and builds the product URL from `SHOPIFY_TEST_STORE_URL`.
- `node --check apps/web/scripts/storefront-e2e.spec.mjs` and `pnpm --filter @stylique/web typecheck` pass.

Impact:
- The harness could be green only for the seeded demo product, not for a real merchant's catalog.
- Teams could accidentally treat a demo-product smoke test as proof of scalable storefront behavior.
- This directly conflicts with the "nothing hard-coded" requirement for merchant-by-merchant rollout.

Required fix:
- Keep live E2E configured by store URL and product handle.
- Extend the harness to accept category/search/cart fixture handles for multi-product recommendation and bundle tests.
- Add a preflight check that the configured product exists, has an available variant, and is try-on eligible before running action assertions.

## Finding 72: Presenter Fallbacks Could Still Try To Render Undefined Products On A Live Store

Severity: P1 for intermittent card/UI reliability. The storefront presenter correctly avoids the demo catalog when no real merchant products have hydrated yet, but several active decision routes still assumed a non-empty product set and called the old `hero(...)` fallback. On a live store during first load, failed `/products.json`, or delayed brain product registration, this could produce no card or an undefined product handoff instead of an honest loading/grounding response.

Evidence:
- `activeProducts()` intentionally returns `[]` on a real storefront when `runtimeCatalog` is empty, to prevent phantom demo inventory.
- Pre-patch, active `applyDecision()` routes for `try_on`, `look`, `navigate`, `reco_handle`, `reco_category`, `reco_filter`, and `search` still used product fallbacks shaped around `hero(...)`.
- `hero(products, ctx)` is typed as `Product`, but at runtime returns `undefined` when `products` is empty.
- This branch adds `safeHero()` and updates active presenter routes to either render a verified product card/action or answer honestly that the store catalog is still loading.
- The disabled legacy regex block still contains demo-handle `hero(...)` references, but it is outside compiled control flow. It remains a deletion/refactor target, not an active storefront path.
- `pnpm --filter @stylique/web typecheck`, `pnpm --filter @stylique/widget typecheck`, `pnpm --filter @stylique/widget build`, and `pnpm --filter @stylique/widget verify:bundle` pass.

Impact:
- This explains the user-facing pattern "cards sometimes come up, sometimes they don't": backend decisions may be valid, but the UI presenter could be asked to create a card before any real product existed locally.
- The old fallback was especially risky because the correct anti-demo guard made empty real catalogs possible by design; the presenter had not fully adopted that truth.
- Shoppers now get a grounded no-product response instead of an invisible or broken card when catalog hydration is late.

Required fix:
- Keep every presenter route null-safe against empty real catalogs.
- Delete or quarantine the legacy regex fallback so old demo-handle product logic cannot be re-enabled casually.
- Add a presenter-unit/browser test that simulates `ASSET_BASE` with an empty `runtimeCatalog` and asserts no route throws or emits an undefined product card.

## Finding 73: Active Search And Name-Based Cart Resolution Still Touched Demo Catalog Data

Severity: P1 for product grounding. The previous presenter guard stopped many undefined-card cases, but the active `search` route still called `findProducts()`, and `findProducts()` searched the bundled demo catalog directly. Separately, name-only cart resolution could fall back to `runtimeCatalog + demo catalog`. That means a real storefront could still show or attempt to add a demo product when the brain returned a search route or a cart message without a handle.

Evidence:
- Pre-patch, `findProducts()` used module-level `catalog.filter(...)` and `catalog.find(...)` instead of `activeProducts()`.
- `applyDecision("search")` calls `findProducts(d.searchQuery ?? d.voice)` in the active presenter path.
- Pre-patch, cart message execution resolved no-handle products through `[...runtimeCatalog.values(), ...catalog].find(...)`.
- Pre-patch, restored look memory and style-memory color counting used module-level `catalog.find(...)`, so restored real handles could silently fail if the demo catalog did not contain them.
- This branch changes `findProducts()` to search `activeProducts()`, restores look pieces through `byHandle()`, counts style memory through `byHandle()`, and resolves name-only cart messages through `activeProducts()`.
- `pnpm --filter @stylique/web typecheck`, `pnpm --filter @stylique/widget typecheck`, `pnpm --filter @stylique/widget build`, and `pnpm --filter @stylique/widget verify:bundle` pass.

Impact:
- A backend fix could correctly return a search route, but the UI could still choose from the wrong catalog.
- A handle-less cart chip could attempt to add a demo product by name on a merchant storefront.
- Shopper memory could lose restored look pieces across navigation because it looked only in the demo catalog.
- This is another concrete example of why fixes kept repeating: one route obeyed the real-catalog contract while a helper underneath still owned an older demo-catalog reality.

Required fix:
- Keep `activeProducts()`/`byHandle()` as the only product lookup APIs in active widget code.
- Delete the disabled legacy regex block or move it into a fixture file so `rg catalog.filter` does not hide real active-path regressions among commented code.
- Add a widget contract test that sets storefront mode, registers two merchant products, searches for one, and proves no bundled demo product can be returned.

## Finding 74: Disabled Legacy Demo Brain Lived Inside The Active Widget File

Severity: P1 for maintainability and production correctness. The commercial fallback had already been reduced to an honest retry line, but the old regex/demo brain still lived as a huge disabled comment inside `MiraWidget.tsx`. That meant every audit/search for `catalog.find`, `hero(catalog)`, or demo handles mixed real active-path problems with unreachable legacy code, making it much easier to reintroduce the wrong local-brain architecture during future fixes.

Evidence:
- Pre-patch, `getMiraResponse()` was followed by a large disabled "legacy regex fallback" block containing demo catalog routes, demo handle picks, size/fit/cart/search branching, and `hero(...)` calls.
- The active fallback now returns only: "I had trouble loading the stylist brain. Try once more and I'll pick this back up."
- Stale comments still described a "pure-regex" or "deterministic regex" fallback even after the runtime no longer did that.
- This branch deletes the disabled legacy block and updates the hybrid-layer comments to state the production invariant: product/cart routes only come from verified server decisions; failures fall back to one honest retry line.
- Post-patch search leaves only the expected guarded demo references: the demo-only `byHandle()` fallback and the local demo PDP try-on shortcut.
- `pnpm --filter @stylique/web typecheck`, `pnpm --filter @stylique/widget typecheck`, `pnpm --filter @stylique/widget build`, and `pnpm --filter @stylique/widget verify:bundle` pass.

Impact:
- This is a direct reason fixes felt like they kept coming back: dead code looked like live code, so each pass had to rediscover which product logic was commercial and which was demo-era.
- It also made code review unsafe because a future developer could uncomment or copy a stale branch that bypassed the one-brain server contract.
- Removing the block lowers the noise floor for the next UI/UX audit: remaining `catalog.find` hits are now small, explainable, and guarded.

Required fix:
- Keep demo fixtures outside commercial widget runtime code, or behind tiny explicit demo-only guards.
- Add the storefront contract test from Finding 73 so future search/card/cart paths cannot return bundled demo products in asset/runtime mode.
- Continue shrinking `MiraWidget.tsx` by extracting presenter contracts into testable helpers instead of allowing another all-in-one fallback brain to grow inside the UI file.

## Finding 75: Free-Shipping UI Used A Hardcoded USD Threshold Instead Of Merchant Configuration

Severity: P1 for storefront trust and scalable commerce UX. Mira's regular price formatting was already currency-aware, but the post-add free-shipping nudge still assumed a fixed 500 USD threshold and a dollar-sign sentence. That meant a merchant in GBP, AED, PKR, INR, or any store with a different free-shipping policy could show a confident but false sales prompt after add-to-cart.

Evidence:
- Pre-patch, `MiraWidget.tsx` had `FREE_SHIPPING_THRESHOLD = 500` and `FREE_SHIPPING_CURRENCY = "USD"`.
- Pre-patch, `freeShippingNudge()` rendered `You're $${gap} from free shipping...`, bypassing the existing `money()` helper.
- Pre-patch, the live storefront theme embed passed currency and theme colors, but no free-shipping threshold.
- This branch adds a `free_shipping_threshold` theme app embed setting, passes it into `window.__sqTheme.freeShippingThreshold`, and disables storefront free-shipping nudges when the merchant leaves it as `0`.
- The widget now formats the gap with the store currency and scales the "helpful gap" window relative to the merchant threshold instead of using USD-sized constants.
- The demo keeps a local 500 USD threshold so showcase behavior is unchanged.
- `apps/widget/scripts/verify-bundle.mjs` now requires `freeShippingThreshold` in the bundled storefront asset.
- `pnpm --filter @stylique/web typecheck`, `pnpm --filter @stylique/widget typecheck`, `pnpm --filter @stylique/widget build`, and `pnpm --filter @stylique/widget verify:bundle` pass.

Impact:
- This was a pure UI/UX truth gap: backend catalog/cart fixes could be perfect, but Mira could still say something commercially wrong immediately after a successful add.
- A wrong free-shipping promise damages shopper trust and brand trust because it looks like the brand, not the app, made a false offer.
- It also blocks enterprise readiness: retailers need policy-level knobs, not a one-size-fits-all USD assumption.

Required fix:
- Treat promotion/policy nudges as merchant configuration, not widget constants.
- Later move shipping thresholds into the merchant dashboard/super-admin provisioning flow so ops-created merchants and self-serve merchants share the same policy source.
- Add a browser contract test that sets `__sqTheme.freeShippingThreshold = 0` and proves no free-shipping nudge appears, then sets a non-USD currency + threshold and proves the sentence uses `Intl` formatting.

## Finding 76: Presenter Style Filters Still Encoded Demo Taste Instead Of Merchant Product Intelligence

Severity: P1 for agentic recommendation quality and "nothing hard-coded" scale. Mira's brain can route a shopper to a vibe filter like `edgy`, `minimal`, `gift`, or `new`, but the widget presenter still converted several of those filters through fixed Stylique demo handles. That means a real merchant's backend decision could be correct while the UI layer either fell back to arbitrary products or ranked the merchant catalog through a hidden demo-store taste list.

Evidence:
- Pre-patch, `filterSet("new")` used demo handles such as `midnight-silk-gown`, `leather-trench`, and `pleated-midi-skirt`.
- Pre-patch, `filterSet("edgy")`, `filterSet("minimal")`, and `filterSet("gift")` matched hardcoded demo handles instead of product attributes.
- These routes are active through `applyDecision("reco_filter")`, so this was not a dead-code issue.
- This branch removes the demo handle picker and ranks active merchant products using name, description, collection, category, fabric, fit notes, care notes, colors, low-stock, sizes, keep-rate, and price-position signals.
- The card rationale path now fences demo-handle copy: live storefront products use merchant/extracted product notes (`hesitationHint`, `fitNotes`, `description`) even if a merchant handle collides with a demo handle.
- A focused search confirms no `pick([...])` or demo-handle lists remain in the active filter presenter.
- `pnpm --filter @stylique/web typecheck`, `pnpm --filter @stylique/widget typecheck`, `pnpm --filter @stylique/widget build`, and `pnpm --filter @stylique/widget verify:bundle` pass.

Impact:
- This is why repeated backend fixes may still feel wrong in the storefront: the final UI presenter had its own old merchandising brain.
- Merchant recommendations for vibes and gifting were not truly Brand DNA or catalog driven; they were partly demo-store residue.
- A high-value sales assistant must translate intent into the merchant's product truth, not into the app vendor's sample catalog.

Required fix:
- Keep active widget filters attribute-driven and merchant-catalog driven.
- Move the filter scoring into a shared tested recommendation module so the brain, widget, and dashboard explain the same ranking logic.
- Add a contract test with synthetic merchant products for `edgy`, `minimal`, and `gift` proving no demo handle can influence the result.

## Finding 77: Theme Embed Surface Toggles Were Not Fully Honored By The Runtime

Severity: P1 for merchant trust, UI/UX control, and scalable Shopify rollout. The Shopify theme app embed exposed separate controls for the Try-On widget, Mira stylist dock, PDP inline CTA, size, and style surfaces, but the bundled runtime treated the loaded script as one always-on experience. That meant merchant settings could look correct in Shopify admin while the storefront still mounted Mira or while placement audits penalized intentionally disabled surfaces.

Evidence:
- `stylique_widget.liquid` exposes `enable_widget`, `enable_stylist`, `enable_pdp_inline`, `show_size`, and `show_style`.
- Pre-patch, `apps/widget/src/mira-demo.tsx` only used `enableWidget` to suppress the PDP inline button; it still mounted `MiraWidget` whenever the script loaded.
- Pre-patch, the placement audit always required `launcher_present` and PDP try-on visibility, even if the merchant disabled the relevant surface.
- `show_size` and `show_style` were present in the schema but were not passed into `window.__sqTheme`, so the runtime could not observe them at all.
- The Liquid comment still described a deployed demo backend and exact demo behavior, contradicting the one-backend App Proxy architecture.
- This branch passes `showSize` and `showStyle` into `window.__sqTheme`, reads all surface flags in the widget entry, reports them in `WIDGET_PLACEMENT_AUDIT.surfaceConfig`, and treats disabled surfaces as not-failures in placement scoring.
- `MiraWidget` now hides the visible Mira dock/sidebar when `enableStylist` is false, while retaining the try-on event listener when `enableWidget` is true.
- The stale Liquid/build comments now describe the tenant-aware App Proxy runtime instead of a demo backend.
- `apps/widget/scripts/verify-bundle.mjs` now requires `showSize` and `showStyle` in the verified bundle.
- `pnpm --filter @stylique/web typecheck`, `pnpm --filter @stylique/widget typecheck`, `pnpm --filter @stylique/widget build`, and `pnpm --filter @stylique/widget verify:bundle` pass.

Impact:
- This is another backend-vs-UI mismatch: entitlement and theme settings could be correct, but the visible storefront did not fully obey them.
- Merchants lose trust when Shopify admin controls do not map to storefront behavior.
- Placement confidence analytics could report false negatives for shops that intentionally disabled one surface, sending ops teams toward the wrong problem.

Required fix:
- Add a browser contract test for all surface combinations: stylist-only, try-on-only, both, neither.
- Continue the TryOnPanel pass so `showSize` and `showStyle` do more than transport/audit: they should hide or disable the corresponding fitting-room modules without breaking cart/try-on.
- Move surface configuration into the merchant dashboard/super-admin provisioning path so theme embed defaults, plan limits, and internal ops setup share one source.

## Finding 78: Try-On Panel UI Still Assumed Size And Styling Were Always Enabled

Severity: P1 for UI/UX correctness and merchant trust. After the embed began passing `showSize` and `showStyle`, the fitting-room UI still rendered or spoke as if size recommendation and complete-the-look styling were always part of the experience. That is exactly the backend-fixed/UI-not-fixed failure class the founder called out: configuration can be correct, but shoppers still see the wrong surface.

Evidence:
- Pre-patch, `TryOnPanel` could receive storefront theme flags but still opened the size-first flow, rendered size preview/compare modules, showed size badges and fit overlays, and exposed bundle/cart language without consistently checking merchant settings.
- Loading states still said "Reading your measurements" and "Generating your look" even when the size or styling surface was disabled.
- The add-to-bag footer could still include the internal selected size in "Add this" copy when size UI was disabled.
- This branch derives `showSize`/`showStyle` from `window.__sqTheme`, starts first-time shoppers on the model step when size is disabled, gates the size step, fit badges, size-preview ladder, compare-on-you rail, desktop fit strips, complete-look rail, worn-look strip, bundle add-all, and look rendering actions by the relevant flag.
- The render flow still keeps a safe internal size for cart correctness, but it no longer exposes size UI when the merchant has disabled the size surface.
- Mobile and desktop loading copy now follows the active surface: try-on-only shops get try-on language instead of size/style language.
- `pnpm --filter @stylique/web typecheck`, `pnpm --filter @stylique/widget typecheck`, `pnpm --filter @stylique/widget build`, and `pnpm --filter @stylique/widget verify:bundle` pass.

Impact:
- Without this, merchant controls remain unreliable: the Shopify admin can say a surface is off while the shopper still sees parts of it.
- This makes repeated fixes look ineffective because the backend entitlement/theme path is fixed, but the visible panel still contains stale UI assumptions.
- It also creates confusing analytics: shoppers can trigger size/style UI actions on shops that intended those surfaces to be off.

Required fix:
- Add an end-to-end browser matrix for `showSize/showStyle`: both on, size off, style off, both off.
- Assert not just DOM presence but visible copy, primary CTA text, footer cart text, and absence of hidden-surface telemetry.
- Move these theme flags into the same provisioning/plan contract used by billing quotas and super-admin setup so the merchant dashboard, Liquid embed, runtime, and tests all read one source of truth.

## Finding 79: Cart Variant Resolution Was Too Literal For Real Shopify Size Labels

Severity: P1 for conversion correctness. The cart helper correctly resolved variants from `/products/<handle>.js` and refused sold-out requested sizes, but it matched Mira's selected size against Shopify variant titles/options too literally. Real stores often name sizes as `Medium`, `Large`, `One Size`, `O/S`, or leave a single accessory variant as `Default Title`, while Mira and the fitting room commonly carry compact labels like `M`, `L`, or `OS`.

Evidence:
- Pre-patch, `sizeMatches()` uppercased and compared raw strings only.
- A product with variants titled `Small` / `Medium` would fail when Mira selected `M`.
- A one-size accessory titled `One Size` would fail when Mira carried `OS`.
- A single available Shopify `Default Title` variant could fail if the UI retained an internal size from try-on.
- This branch normalizes common size aliases before matching and treats a single available default variant as cartable even when internal size state is present.
- The harness now proves `M` resolves to `Medium`, `OS` resolves to `One Size`, single `Default Title` variants still add, requested sold-out sizes still fail honestly, outfits remain all-or-nothing, and demo mode still no-ops.
- `node apps/web/scripts/verify-cart.mjs` passes with 14 checks.
- `pnpm --filter @stylique/web typecheck`, `pnpm --filter @stylique/widget typecheck`, `pnpm --filter @stylique/widget build`, and `pnpm --filter @stylique/widget verify:bundle` pass.

Impact:
- This is a classic scalability bug: the code worked on demo-style variant labels but failed on normal merchant naming.
- It would look random to merchants: some products add, others do not, depending only on how the Shopify admin names variants.
- It could also make Mira look wrong after giving a good size recommendation, because the cart layer rejected the exact human-readable equivalent.

Required fix:
- Add these cart cases to a maintained CI command, not only the script harness.
- Extend normalization from size labels to color/option-aware variant resolution before multi-color PDP support is considered complete.
- Surface cart failure reasons in UI copy so `variant_not_found`, `requested_size_unavailable`, and `cart_422` do not collapse into silent failure.

## Finding 80: PDP Add-To-Bag Still Simulated Success Outside The Mira/Try-On Path

Severity: P1 for end-to-end shopping trust. The Mira and try-on cart paths had been moved to the real Shopify `/cart/add.js` helper, but the standalone PDP `ProductActions` component still showed an "Added" toast without calling the shared cart helper. This means one visible buying surface could be real while another one on the same product page was still fake/demo behavior.

Evidence:
- Pre-patch, `ProductActions.handleAddToBag()` only checked whether a size was selected, then set `addedToast` locally.
- It did not call `addToCart()`, did not resolve a Shopify variant, did not observe sold-out state, and could not surface `variant_not_found` or `cart_422`.
- This branch imports the shared storefront cart helper, calls it with the selected or single available size, shows an adding state, keeps demo-mode compatibility through the helper's `real:false` no-op, and displays honest shopper-facing error copy for unavailable or unmapped variants.
- `pnpm --filter @stylique/web typecheck` passes.
- `node apps/web/scripts/verify-cart.mjs` still passes with 14 checks.

Impact:
- This is another reason fixes appeared not to stick: the Mira-specific path could be corrected, but the adjacent PDP commerce path still trained testers to distrust cart behavior.
- It also created inconsistent analytics and QA observations: "Add to bag" could appear successful without any real Shopify cart mutation.
- For brands, this is unacceptable because the primary purchase CTA must be at least as real as Mira's assisted purchase CTA.

Required fix:
- Add a PDP browser test that clicks the normal product Add to Bag button and verifies `/cart/add.js` or `/cart.js` state.
- Route PDP cart success/failure analytics through the same confirmed-cart event vocabulary as Mira/Try-On, keeping CTA intent separate from confirmed cart mutation.
- Consider centralizing purchase CTA UI states so PDP, Mira cards, and Try-On footer cannot drift again.

## Finding 81: Fashion Intelligence Still Used Measured-Sounding Copy For Modelled Fit Signals

Severity: P1 for merchant trust and the learning-loop value proposition. Fashion Intelligence already labelled executive cards as measured/modelled, but some fit-confidence text still described catalog-modelled watchlists as observed shopper behavior. That makes early installs look smarter than the evidence supports, then undermines confidence when merchants ask where the claimed shopper behavior came from.

Evidence:
- Pre-patch, modelled product-fit rows could say "repeated size toggling before checkout" even when the engine had no measured size-toggle evidence for that product.
- Pre-patch, the fit section could claim a specific highest-trust audience behavior before enough shoppers had submitted fit data and reached cart outcomes.
- The dashboard consumer section also rendered catalog-modelled style distributions under "What shoppers are teaching Mira" and showed catalog fallback pairings as `0 asks`, which looked like shopper demand rather than a catalog-derived starting point.
- This branch adds evidence-aware fit copy helpers: observed-behavior language only appears when measured evidence exists; modelled paths now say they are catalog watchlists or collecting evidence.
- The dashboard now relabels sparse-mode consumer intelligence as "What your catalog is preparing Mira to learn", badges it as `Catalog-modelled`, shows style values as `catalog weight`, and labels fallback pairings as `catalog pairing` instead of shopper asks.
- `pnpm --filter @stylique/shopify-app test -- app/lib/fashion-intelligence.server.test.ts app/lib/dashboard.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- This is how a technically functioning analytics backend can still feel untrustworthy: the UI speaks one evidence level stronger than the data.
- Brands pay for commerce intelligence only if they can distinguish measured shopper learning from directional catalog modelling.
- Overclaiming early signals makes the agentic sales engine look like a black-box demo rather than a reliable operating system for merchandising decisions.

Required fix:
- Extend this evidence-source labelling to every Fashion Intelligence subsection, not only exec cards and fit copy.
- Add UI/route tests for sparse-mode dashboard copy so "shopper taught", "asks", "measured", and "lift" language cannot appear without the corresponding event evidence.
- Add a source field per consumer subsection (`styleMap`, `combos`, `occasions`, `fitPrefs`) so the UI does not have to infer evidence level from global `dataMode`.

## Finding 82: Legacy Insights Still Counted Internal Size-Chart Jobs As Shopper Demand

Severity: P1 for merchant intelligence correctness. The newer dashboard headline had a `realCatalogGapWhere()` filter that excluded internal size-chart extraction bookkeeping rows, but the older tiered insights engine still queried `CatalogGap` directly. That meant Starter gap counts, Growth gap opportunities, and Ultimate network trend velocity could still treat `no_size_chart:*` maintenance records as shopper demand.

Evidence:
- `dashboard.server.ts` already excluded `source = size_chart_extract` and `rawQuery` starting with `no_size_chart`.
- Pre-patch, `insights.server.ts` used plain `{ shopId, createdAt }` catalog-gap filters in Starter, Growth, brand trend, and network trend queries.
- This branch adds `realDemandCatalogGapWhere()` to the insights engine and applies it to shop-scoped and network-level catalog-gap queries.
- The new test proves the filter shape for both shop-scoped merchant demand and cross-shop network trend queries.
- `pnpm --filter @stylique/shopify-app test -- app/lib/insights.server.test.ts app/lib/fashion-intelligence.server.test.ts app/lib/dashboard.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- This is a duplicated-engine drift bug: one dashboard path was fixed, another still inflated the same business concept.
- Merchants could see "what to stock next" or network trend signals influenced by internal maintenance jobs, not real shoppers.
- It weakens the agentic sales engine because catalog extraction failures become fake demand, causing the wrong operational response.

Required fix:
- Replace duplicated demand filters with one shared core helper used by dashboard, insights, reports, recommendations, and internal ops.
- Add integration coverage proving internal maintenance rows never appear in merchant-facing demand counts, trend velocity, reorder intelligence, or recommendation triggers.
- Consider a schema-level enum/source contract for `CatalogGap` so maintenance rows and shopper demand cannot be confused by default.

## Finding 83: Ultimate Customer Segments Used Engagement Proxies As Purchase Evidence

Severity: P1 for merchant segmentation and CRM trust. Ultimate insights described high-repeat and high-engagement-no-purchase shopper segments, but the old implementation counted signal depth and account-claim status instead of joining to confirmed cart evidence. That means a deeply engaged shopper with no purchase could be counted as VIP-like repeat behavior, while an unclaimed account could be treated as "no purchase" without proving cart absence.

Evidence:
- Pre-patch, `highRepeat` counted `ShopperSession.signalCount >= 10` and did not require any `CART_CONFIRMED` event despite the comment saying "with cart confirms".
- Pre-patch, `highEngagementNoPurchase` used `accountClaimedAt: null` as a purchase proxy, which is not the same as no confirmed cart.
- Pre-patch, `singlePurchase` used a separate `groupBy` and was not joined into the same evidence model as the other segments.
- This branch adds `customerSegmentsFromEvidence()`, which builds one confirmed-cart map by `shopperId`.
- `highRepeat` now requires signal depth plus at least one confirmed cart.
- `singlePurchase` now means exactly one confirmed cart for that shopper in the window.
- `highEngagementNoPurchase` now means signal depth plus no confirmed cart evidence.
- `pnpm --filter @stylique/shopify-app test -- app/lib/insights.server.test.ts app/lib/fashion-intelligence.server.test.ts app/lib/dashboard.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- This is another evidence mismatch that makes the system look agentic while silently acting on weak proxies.
- Brands using these segments for loyalty, offers, or retention could target the wrong shoppers.
- A credible commerce intelligence loop must distinguish attention, purchase, repeat purchase, and no-purchase states from actual event evidence.

Required fix:
- Move customer segment construction to a shared analytics module and use it in dashboard, monthly reports, cohorts, and recommendations.
- Add order-id deduplication for segment counts, matching the repeat-purchase fix already made in `dashboard.server.ts`.
- Add UI labels clarifying that `highRepeat` is engagement-plus-purchase unless and until true multi-order repeat purchase is used.

## Finding 84: Recommendations And Monthly Reports Still Had Their Own Definition Of Catalog Demand

Severity: P1 for merchant actions and automated learning. Dashboard and legacy insights had been fixed to exclude internal size-chart extraction rows from shopper demand, but the core recommendation generator and monthly report synthesizer still queried all `CatalogGap` rows. That meant internal `no_size_chart:*` maintenance records could still become "Add to buying list" recommendations or revenue-at-risk report lines.

Evidence:
- Pre-patch, `packages/core/src/recommendations/service.ts` grouped catalog gaps with only `{ shopId, createdAt }`.
- Pre-patch, `packages/core/src/reports/monthly.ts` described `CatalogGap` rows as "honest signal" and queried them with only `{ shopId, createdAt }`.
- Both paths ignored `source = size_chart_extract` and `rawQuery` beginning with `no_size_chart`.
- This branch adds `recommendationCatalogGapWhere()` and `monthlyReportCatalogGapWhere()` with the same real-demand exclusion.
- Recommendation tests now prove internal size-chart rows do not generate `CATALOG_GAP` recommendations.
- Monthly report tests now prove internal size-chart rows do not affect top gaps, revenue-at-risk, or gap sample size.
- `pnpm --filter @stylique/core test -- src/__tests__/recommendations.test.ts src/__tests__/monthly-report.test.ts` passes.
- `pnpm --filter @stylique/core typecheck` passes.

Impact:
- This is the repeated root-cause pattern in miniature: multiple modules each owned a slightly different version of the same business invariant.
- The merchant could see a dashboard count fixed in one place while the recommendation engine still told them to stock against an internal maintenance gap.
- It damages the agentic loop because automated actions must be driven by real shoppers, not worker bookkeeping.

Required fix:
- Move the real-demand catalog-gap predicate into a single exported analytics/catalog module and delete local copies across dashboard, insights, reports, recommendations, and internal ops.
- Add a repo-wide test or static verifier that searches for direct `catalogGap` merchant-facing reads without the real-demand predicate.
- Add source semantics to `CatalogGap` docs/schema comments so new writers choose `shopper_demand` versus `maintenance` explicitly.

## Finding 85: Monthly Reports Averaged Line Items As If They Were Orders

Severity: P1 for revenue credibility. The orders webhook emits one `CART_CONFIRMED` analytics row per line item, with `payload.orderId` and `payload.lineValue`. The monthly report still averaged `lineValue` rows directly in its baseline AOV and gap revenue-at-risk calculation, which undercounts multi-item orders and can distort lift, AOV, and modeled opportunity.

Evidence:
- Pre-patch, monthly report AOV used the mean of `CART_CONFIRMED.payload.lineValue` rows.
- A two-line order worth `$200` could be treated as two `$100` observations instead of one `$200` order.
- `confirmedOrders` could also fall back to the raw `CART_CONFIRMED` event count, which is line count, not order count, whenever cart rows existed but were not grouped.
- This branch adds `orderTotalsFromCartRows()`, grouping `CART_CONFIRMED` rows by `payload.orderId` and summing line values before AOV/report calculations.
- Baseline AOV now excludes assisted order IDs when those IDs are present on `MIRA_ASSISTED_ORDER`.
- Confirmed order count now uses distinct grouped order totals when order evidence exists.
- Monthly report tests now prove full-order totals, baseline AOV, assisted-order exclusion, confirmed-order count, and gap revenue-at-risk behavior.
- `pnpm --filter @stylique/core test -- src/__tests__/recommendations.test.ts src/__tests__/monthly-report.test.ts` passes.
- `pnpm --filter @stylique/core typecheck` passes.

Impact:
- Brands could receive a monthly report with understated AOV and wrong revenue-at-risk math.
- This makes the commerce intelligence loop look numerically inconsistent with Shopify admin reports.
- Agentic recommendations need order-level economics, not line-level artifacts, when advising stock, bundles, and revenue opportunities.

Required fix:
- Use a shared order-total aggregation helper across dashboard, monthly reports, insights, attribution, and any future cohort exports.
- Track whether a metric is line-level, cart-level, or order-level in the type name, not just comments.
- Add report fixtures with multi-line assisted and non-assisted orders to prevent future regressions.

## Finding 86: Internal Ops Still Mixed Maintenance Gaps Into Demand And Did Not Surface Under-Scoped Shops

Severity: P1 for support operations. Merchant-facing catalog-gap widgets had been corrected to exclude internal size-chart maintenance rows, but the internal brand detail page still grouped all `CatalogGap` rows. At the same time, stored Shopify token scopes were not surfaced as an explicit missing-permission issue in the internal health model, so a shop could look like a generic sync/attribution failure instead of an under-scoped install.

Evidence:
- Pre-patch, `apps/shopify-app/app/lib/internal-dashboard.server.ts` grouped brand-detail `CatalogGap` rows with only `{ shopId }`.
- That meant `source = size_chart_extract` and `rawQuery = no_size_chart:*` rows could appear in internal top-demand diagnostics even after merchant-facing surfaces were fixed.
- This branch adds `internalDemandCatalogGapWhere()` and applies it to internal brand detail top catalog gaps.
- This branch also reads stored `Shop.scopes`, reports `missingShopifyScopes`, and adds a health issue/suggestion when required scopes are absent.
- The required active scopes match `apps/shopify-app/shopify.app.toml`, env defaults, and startup validation: `read_products`, `read_inventory`, `read_orders`, `write_script_tags`.
- `apps/shopify-app/app/lib/internal-dashboard.server.test.ts` now proves maintenance gaps are excluded and stored comma-separated scopes are normalized before missing-scope detection.
- `pnpm --filter @stylique/shopify-app test -- app/lib/cohort-export.server.test.ts app/lib/internal-dashboard.server.test.ts app/lib/insights.server.test.ts app/lib/fashion-intelligence.server.test.ts app/lib/dashboard.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- Support could chase the wrong problem because internal ops would still show worker maintenance rows as shopper demand.
- An install missing `read_inventory`, `read_orders`, or `write_script_tags` can make catalog sync, size availability, order attribution, or auto-injection partially fail; without an explicit ops flag, those failures look like random Mira/runtime bugs.
- This is why the same class of fix kept returning: the merchant surface, reports, and internal support tooling were not sharing one demand and permission-health contract.

Required fix:
- Move required Shopify scopes into one shared module consumed by startup validation, internal ops, deploy docs, and tests.
- Add an internal ops warning when stored scopes differ from configured scopes, not only when a hard-coded required scope is absent.
- Add a super-admin/onboarding checklist item that blocks "healthy" status until scope, widget-live, catalog-sync, and order-webhook health all pass.

## Finding 87: The Mira-Engaged Cohort Export Still Blended Cart Intent With Cart Success

Severity: P1 for marketing and attribution trust. The cohort export had been expanded from only `CHAT_CART_REQUESTED` to the broader cart-assist event family so shoppers with newer cart events were included. But the exported `hadCart` column then used the same broad family, which includes pre-cart intent events like `CHAT_CART_REQUESTED`, `MIRA_ADD_TO_CART_ASSIST`, and `COMBO_ADD_ALL`. That made a shopper who asked for cart help look the same as a shopper whose browser actually added an item to cart.

Evidence:
- `packages/core/src/analytics/cart-events.ts` already separates `MIRA_CART_INTENT_EVENT_NAMES` from `MIRA_CART_SUCCESS_EVENT_NAMES`.
- Pre-patch, the CSV row-level `hadCart` flag checked `MIRA_CART_ASSIST_EVENT_NAMES`, the union of intent and success.
- This branch adds `cohortCartFlags()` so `hadCart` means only confirmed cart-origin success events and `hadCartIntent` means pre-cart request/assist intent.
- The route still uses the broad assist family for inclusion in the Mira-engaged audience, but the exported columns now preserve semantic truth.
- `apps/shopify-app/app/lib/cohort-export.server.test.ts` proves `CHAT_CART_REQUESTED` sets `hadCartIntent` without setting `hadCart`, and `CART_FROM_MIRA` sets `hadCart` without being mislabeled as intent.
- `pnpm --filter @stylique/shopify-app test -- app/lib/cohort-export.server.test.ts app/lib/internal-dashboard.server.test.ts app/lib/insights.server.test.ts app/lib/fashion-intelligence.server.test.ts app/lib/dashboard.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- Brands could suppress or retarget the wrong shoppers because intent-only users looked like successful cart users.
- Campaign audiences would overstate Mira's cart outcomes and make downstream ad/ESP optimization less trustworthy.
- This is the repeated root cause again: the system had a good canonical split in core, but a UI/export surface still consumed the union because the column name did not encode the evidence level.

Required fix:
- Keep all marketing/export fields evidence-level explicit: `cartIntent`, `cartAdded`, `orderConfirmed`, and `miraAssistedOrder`.
- Add an export schema/version header or docs note before downstream tools depend on ambiguous legacy `hadCart` semantics.
- Build a small static verifier for high-trust metric columns that rejects usage of `MIRA_CART_ASSIST_EVENT_NAMES` in success-rate or success-flag contexts.

## Finding 88: Fashion Intelligence Still Counted Size-Chart Bookkeeping As Live Demand

Severity: P1 for UI/UX trust. Merchant-facing dashboard gap widgets and internal ops were corrected, but the production Fashion Intelligence engine still read raw `CatalogGap` rows with only `{ shopId, createdAt }`. That count feeds `realSignalCount`, which decides whether the UI labels cards as live or modelled. So backend maintenance rows could make a low-traffic merchant dashboard look more evidence-backed than it really was.

Evidence:
- Pre-patch, `apps/shopify-app/app/lib/fashion-intelligence.server.ts` fetched gaps for occasions/trends with `where: { shopId, createdAt: { gte: since } }`.
- The same `gaps.length` contributes to `realSignalCount`, which drives `dataMode` and UI copy.
- This branch adds `fashionIntelligenceCatalogGapWhere()` excluding `source = size_chart_extract` and `rawQuery = no_size_chart:*`.
- `apps/shopify-app/app/lib/fashion-intelligence.server.test.ts` now proves this filter is applied to live-demand thresholds.
- `pnpm --filter @stylique/shopify-app test -- app/lib/cohort-export.server.test.ts app/lib/internal-dashboard.server.test.ts app/lib/insights.server.test.ts app/lib/fashion-intelligence.server.test.ts app/lib/dashboard.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- The UI could say or imply "live shopper signal" because internal extraction jobs created enough rows, even when real shopper evidence was sparse.
- This explains the user's concern that backend fixes were not reaching UI/UX: the dashboard presentation layer had its own demand threshold path.
- It weakens brand trust because a merchant sees confident intelligence cards before the store has produced enough real signal.

Required fix:
- Replace local dashboard/internal/Fashion Intelligence predicates with one shared real-demand catalog-gap helper.
- Add a browser-visible Fashion Intelligence test that seeds only size-chart maintenance rows and asserts the UI remains in modelled/insufficient-data language.
- Add a static check for `catalogGap.findMany/groupBy/count` in merchant-facing code without the shared real-demand helper.

## Finding 89: The Outcome Learning Loop Still Learned From Maintenance Catalog Gaps

Severity: P0 for agentic learning quality. Recommendation, report, dashboard, internal, and Fashion Intelligence reads had been corrected, but the outcome service still counted all `CatalogGap` rows when measuring whether a `CATALOG_GAP` recommendation improved. That means size-chart extraction maintenance rows could feed the measure→learn loop and change future recommendation weights.

Evidence:
- Pre-patch, `packages/core/src/outcomes/service.ts` counted `prisma.catalogGap.count({ where: { shopId, createdAt: { gte: since } } })` for `CATALOG_GAP` outcome snapshots.
- That metric is used to classify whether a catalog-gap recommendation improved, worsened, or stayed flat.
- `getOutcomeWeights()` then aggregates resolved outcomes into recommendation priority multipliers.
- This branch adds `outcomeCatalogGapWhere()` excluding `source = size_chart_extract` and `rawQuery = no_size_chart:*`.
- `packages/core/src/__tests__/outcomes.test.ts` proves the outcome snapshot passes the real-demand predicate to Prisma.
- `pnpm --filter @stylique/core test -- src/__tests__/outcomes.test.ts src/__tests__/recommendations.test.ts src/__tests__/monthly-report.test.ts` passes.
- `pnpm --filter @stylique/core typecheck` passes.

Impact:
- The system could "learn" that a merchant action worked or failed because a worker created or removed size-chart bookkeeping rows, not because shoppers stopped asking for missing products.
- This is the deepest version of the repeated-fix problem: even after the UI looks corrected, the agentic ranking model could keep absorbing polluted evidence.
- Brands would see recommendation ordering drift in ways that do not match real shopper demand.

Required fix:
- Promote the real-demand catalog-gap predicate into a package-level helper used by outcomes, recommendations, reports, dashboard, insights, Fashion Intelligence, and internal ops.
- Add an outcome fixture with only maintenance gaps and assert `CATALOG_GAP` outcomes are inconclusive or zero-impact.
- Add telemetry distinguishing `shopper_demand_gap_count` from `maintenance_gap_count` so learning dashboards can audit the split.

## Finding 90: Required Shopify Scopes Were Still Duplicated Across Boot And Ops Health Checks

Severity: P1 for install reliability. Startup validation and internal ops both knew the same required scopes, but each owned its own hard-coded array. That is exactly how Shopify permission fixes drift: the app can fail fast for one scope set while the super-admin/internal health UI checks another.

Evidence:
- Pre-patch, `apps/shopify-app/app/lib/startup-validation.server.ts` defined `REQUIRED_SHOPIFY_SCOPES`.
- The internal dashboard then defined a second `REQUIRED_SHOPIFY_SCOPES` with the same values.
- This branch adds `apps/shopify-app/app/lib/shopify-scopes.server.ts` with `REQUIRED_SHOPIFY_SCOPES`, `parseShopifyScopes()`, and `missingRequiredShopifyScopes()`.
- Startup validation and internal ops now consume the shared helper.
- `rg` now finds only one active `REQUIRED_SHOPIFY_SCOPES` definition in Shopify app lib/routes.
- `pnpm --filter @stylique/shopify-app test -- app/lib/startup-validation.server.test.ts app/lib/internal-dashboard.server.test.ts app/lib/cohort-export.server.test.ts app/lib/fashion-intelligence.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- A future scope change could previously update boot but not ops, or ops but not boot, leaving merchants in the dangerous state the user described: some features work and others silently fail.
- This matters for catalog sync, inventory/size availability, order attribution, and ScriptTag auto-injection.
- It also improves super-admin onboarding because missing permissions now have one canonical testable source of truth.

Required fix:
- Use the same helper in docs generation or a config verifier for `shopify.app.toml` and `.env*` examples.
- Add an install-health endpoint that returns configured scopes, stored token scopes, missing scopes, widget-live, catalog-sync recency, and order-webhook recency in one response.
- Gate "healthy" merchant status on that install-health contract.

## Finding 91: Hot Catalog-Gap Intensity Still Counted Size-Chart Maintenance Rows

Severity: P1 for merchant UI trust. The top-gap totals and Fashion Intelligence thresholds were filtered, but `getGapIntensity()` still read `CatalogGap` rows by `{ shopId, normalizedQuery, createdAt }` only. That function powers recency-weighted "what's hot now" demand scoring, so a maintenance row could still make a gap look active/trending even when real shopper demand was absent.

Evidence:
- Pre-patch, `apps/shopify-app/app/lib/taste.server.ts` queried `prisma.catalogGap.findMany()` with only shop, normalized query, and window.
- This branch adds `gapIntensityCatalogGapWhere()` excluding `source = size_chart_extract` and `rawQuery = no_size_chart:*`.
- `apps/shopify-app/app/lib/taste.server.test.ts` proves the helper shape and the actual Prisma call use the real-demand predicate.
- `pnpm --filter @stylique/shopify-app test -- app/lib/taste.server.test.ts app/lib/startup-validation.server.test.ts app/lib/internal-dashboard.server.test.ts app/lib/cohort-export.server.test.ts app/lib/fashion-intelligence.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- A merchant-facing gap could be correctly filtered in one widget but still get inflated urgency/trending intensity in another helper.
- This is another UI/UX mismatch root cause: the visible intelligence layer had one more independent data path behind the same "catalog gap" concept.
- Agentic reorder and merchandising advice must not rank maintenance rows as shopper heat.

Required fix:
- Replace all local catalog-gap predicates with one shared helper that supports optional shop, date window, normalized query, and source exclusions.
- Add a static verifier that fails on direct `catalogGap.findMany/groupBy/count` in merchant-facing or learning code without that helper.
- Add an end-to-end dashboard fixture where only maintenance gaps exist and every visible gap/intensity/count card remains zero or modelled.

## Finding 92: There Was No Static Guard Against Reintroducing Loose CatalogGap Reads

Severity: P0 for regression prevention. After fixing the visible reads one by one, the codebase still had no guardrail preventing a future dashboard, report, or learning-loop change from adding `catalogGap.findMany/groupBy/count` with a loose `where`. That means the exact bug family that caused repeated fixes could be reintroduced by a small feature patch.

Evidence:
- Multiple modules still own local predicate helpers today: dashboard, insights, internal ops, Fashion Intelligence, taste intensity, recommendations, monthly reports, and outcomes.
- Before this branch, no verifier failed when a new read path bypassed those helpers.
- This branch adds `scripts/verify-catalog-gap-predicates.mjs`.
- The verifier scans non-test `apps` and `packages` TypeScript files for `catalogGap.findMany`, `catalogGap.groupBy`, and `catalogGap.count`, then requires an allowed real-demand predicate helper near the read.
- The root package now exposes `pnpm check:catalog-gaps`.
- `pnpm check:catalog-gaps` passes and reports 8 current non-test files scanned.

Impact:
- The team had been fixing the same invariant in individual places; without a verifier, new code could drift immediately.
- This is a structural explanation for "we fix it again and again": no automated tripwire existed for the repeated pattern.
- It turns a review-only insight into an enforceable contract that can be added to CI.

Required fix:
- Promote the local predicate helpers into one shared implementation and then tighten the verifier to allow only that shared helper.
- Add `pnpm check:catalog-gaps` to CI/build verification.
- Extend the same static-guard idea to cart success versus cart intent, Shopify scopes, and order-level versus line-level revenue metrics.

## Finding 93: Network Benchmarks Counted Line Items As Confirmed Carts

Severity: P1 for Ultimate-tier benchmark credibility. The order webhook emits one `CART_CONFIRMED` event per order line item. `recomputeBrandSnapshot()` used the grouped `CART_CONFIRMED` event count directly for `cartConfirmed`, `comboCtr`, and `fitToCartRate`. A two-line order could therefore look like two confirmed carts in network percentile benchmarks.

Evidence:
- Pre-patch, `apps/shopify-app/app/lib/network.server.ts` set `cartConfirmed = n("CART_CONFIRMED")` from `analyticsEvent.groupBy()`.
- The same value fed `comboCtr = cartConfirmed / combosProposed` and `fitToCartRate = cartConfirmed / fitSubmitted`.
- This branch adds `distinctConfirmedOrderCount()` grouping `CART_CONFIRMED.payload.orderId`, with event-id fallback for older rows.
- `recomputeBrandSnapshot()` now fetches `CART_CONFIRMED` rows and stores order-level `cartConfirmed`.
- `apps/shopify-app/app/lib/network.server.test.ts` proves two line-item rows for one order become one confirmed order and the snapshot rates use that value.
- `pnpm --filter @stylique/shopify-app test -- app/lib/network.server.test.ts app/lib/taste.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- A brand with larger baskets could appear to convert better than it really does, simply because each order has more lines.
- Network benchmarks would compare merchants on line-item density instead of shopper/order conversion.
- This weakens the agentic commerce story because benchmark advice should reflect sales outcomes, not webhook row shape.

Required fix:
- Rename or document `BrandTasteSnapshot.cartConfirmed` as order-level going forward, or add a new `ordersConfirmed` field in a future migration.
- Add a static/review rule for any `CART_CONFIRMED` metric: declare whether it is line-level, product-level, shopper-level, or order-level.
- Extend the order-level helper into dashboard, Fashion Intelligence, fit tuner, outcomes, and benchmark code so there is one source of truth.

## Finding 94: The Fit/Look Tuner Learned Conversion From Line-Item Counts

Severity: P0 for autonomous learning quality. The nightly fit/look tuner writes `cartConvertRate30d` into `Plan.planFeaturesJson.fashion`, which can influence future styling and ranking behavior. It used raw `CART_CONFIRMED` event count as the numerator, but the orders webhook emits one row per line item. A multi-line order could therefore teach the tuner that conversion was stronger than it really was.

Evidence:
- Pre-patch, `apps/worker/src/jobs/fit-tuner.ts` computed `cartConfirmed = events.filter((e) => e.name === "CART_CONFIRMED").length`.
- The same value fed `cartConvertRate30d = cartConfirmed / canonical Mira cart assists`.
- This branch adds `packages/core/src/analytics/order-events.ts` with `orderKeyFromEvent()` and `distinctOrderCountFromEvents()`.
- The Shopify network snapshot and worker fit tuner now both import the shared order-level helper from `@stylique/core`.
- The worker query now selects `id` so legacy rows without `payload.orderId` can fall back to event ids safely.
- `packages/core/src/__tests__/analytics.test.ts` proves line-item rows are grouped by `payload.orderId` and legacy rows fall back to event ids.
- `pnpm --filter @stylique/core test -- src/__tests__/analytics.test.ts src/__tests__/outcomes.test.ts src/__tests__/monthly-report.test.ts` passes.
- `pnpm --filter @stylique/core typecheck` passes.
- `pnpm --filter @stylique/worker typecheck` passes.
- `pnpm --filter @stylique/shopify-app test -- app/lib/network.server.test.ts app/lib/taste.server.test.ts` and `pnpm --filter @stylique/shopify-app typecheck` pass.

Impact:
- Autonomous ranking could learn from basket line-count rather than confirmed order outcomes.
- Stores with larger baskets could receive overly aggressive conversion tuning.
- This is another reason repeated fixes did not stick: the report layer had been corrected, but the worker learning layer still had old row-shape assumptions.

Required fix:
- Move all `CART_CONFIRMED` metric consumers to shared helpers that declare order-level, line-level, or product-level intent.
- Add a worker test harness or package-level Vitest setup so worker jobs can have first-class regression tests, not only typecheck.
- Add a static verifier for direct raw `CART_CONFIRMED` counts in learning/reporting code.

## Finding 95: Outcome, Dashboard, Starter Insights, And Fashion Intelligence Still Had Raw Cart-Confirmed Conversion Counts

Severity: P0 for learning and merchant trust. The monthly report, network benchmark, and worker tuner were corrected to count distinct confirmed orders, but several other high-trust surfaces still used raw `CART_CONFIRMED` event counts for broad conversion metrics. Because fulfilled orders emit one `CART_CONFIRMED` per line item, these paths still inflated conversion when orders had multiple products.

Evidence:
- Pre-patch, `packages/core/src/outcomes/service.ts` used `analyticsEvent.count({ name: "CART_CONFIRMED" })` for default outcome snapshots and weak-PDP creative conversion evidence.
- Pre-patch, `apps/shopify-app/app/lib/dashboard.server.ts` used `evt("CART_CONFIRMED")` for headline and stylist-funnel `cartConfirmed`, even though it already had deduped confirm rows for repeat-purchase rate.
- Pre-patch, `apps/shopify-app/app/lib/insights.server.ts` used weekly grouped `CART_CONFIRMED` event count as Starter `addToCarts` and conversion-rate numerator.
- Pre-patch, `apps/shopify-app/app/lib/fashion-intelligence.server.ts` used grouped `evt("CART_CONFIRMED")` as the denominator for baseline purchase rate, AI-suggested cart share, and stylist spend lift.
- This branch moves the outcome service to `findMany({ select: { id, payload } })` plus `distinctOrderCountFromEvents()`.
- Dashboard headline/funnel now reuse the deduped confirmation rows already fetched for repeat-purchase rate.
- Starter insights now separates product-level top-cart rows from order-level weekly conversion rows.
- Fashion Intelligence now selects `id` and `payload` for cart rows and uses `distinctOrderCountFromEvents()` for broad conversion denominators while keeping product-level cart maps product-level.
- `packages/core/src/__tests__/outcomes.test.ts` proves outcome snapshots group line-item rows into distinct confirmed orders.
- `pnpm --filter @stylique/core test -- src/__tests__/outcomes.test.ts src/__tests__/analytics.test.ts src/__tests__/monthly-report.test.ts` passes.
- `pnpm --filter @stylique/core typecheck` passes.
- `pnpm --filter @stylique/shopify-app test -- app/lib/fashion-intelligence.server.test.ts app/lib/insights.server.test.ts app/lib/dashboard.server.test.ts app/lib/network.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- A merchant with multi-item orders could see stronger dashboard/fashion-intelligence conversion than reality.
- The outcome resolver could classify recommendations as improved because orders had more line items, not because more shoppers converted.
- This is exactly why fixes felt inconsistent: report math was corrected, but dashboard, insights, and learning-loop math still had older row-shape assumptions.

Required fix:
- Continue migrating all broad conversion metrics to shared order-level helpers, while explicitly naming product-level and line-level metrics.
- Add UI labels for "confirmed orders" versus "product cart lines" wherever both appear.
- Add browser/dashboard fixtures with one multi-line order and assert the visible conversion cards show one confirmed order.

## Finding 96: There Was No Static Guard Against Reintroducing Raw Cart-Confirmed Counts

Severity: P0 for regression prevention. Even after order-level helpers existed, the repo had no automated guard against future broad metrics using raw `CART_CONFIRMED` counts. That left the same line-item/order drift free to reappear in a later dashboard, report, worker, or intelligence change.

Evidence:
- This branch adds `scripts/verify-cart-confirmed-metrics.mjs`.
- The verifier scans non-test app/package TypeScript files containing `CART_CONFIRMED`.
- It flags suspicious `analyticsEvent.count`, `eventCount(... "CART_CONFIRMED")`, `evt("CART_CONFIRMED")`, and `.filter(... "CART_CONFIRMED").length` patterns unless the local code declares/order-proves explicit order, product, or line semantics.
- The root package now exposes `pnpm check:cart-metrics`.
- `pnpm check:cart-metrics` passes and reports 18 current files scanned.
- `pnpm check:catalog-gaps` still passes after the cart verifier addition.

Impact:
- The team now has a tripwire for the second repeated failure family: treating server-authoritative line-item events as broad conversion/order metrics.
- This does not replace code review, but it makes the common regression loud and cheap to catch.
- It also documents the intended engineering discipline: every `CART_CONFIRMED` metric must say whether it is order-level, product-level, shopper-level, or line-level.

Required fix:
- Add `pnpm check:cart-metrics` to CI alongside `pnpm check:catalog-gaps`.
- Tighten the verifier over time by replacing marker-based allowances with shared helper imports and explicit allow comments.
- Build analogous verifiers for cart intent versus cart success and for assisted-revenue attribution.

## Finding 97: Demo-To-Production Bridge Dropped Proactive Intent Telemetry

Severity: P1 for UI/UX learning proof. The live storefront client event handler accepted `MIRA_PROACTIVE_TRIGGERED`, `MIRA_BEHAVIORAL_TRIGGER_FIRED`, and `MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED`, and the shared event schema supported those payloads. But the `/api/mira/event` demo-to-production bridge allowlist did not include them. That means proactive/outlier UI behavior could appear in the browser while production analytics and learning missed the proof when events came through the bridge path.

Evidence:
- `apps/web/app/components/mira/MiraWidget.tsx` emits proactive/behavioral events through `postClientEvent()`.
- `apps/shopify-app/app/lib/shopper-events.server.ts` accepts those events from the storefront client.
- `packages/types/src/index.ts` defines payload schemas for those same events.
- Pre-patch, `apps/shopify-app/app/routes/api.mira.event.tsx` did not include the proactive/behavioral events in `BRIDGE_ACCEPTED_EVENTS`.
- This branch adds `MIRA_PROACTIVE_TRIGGERED`, `MIRA_BEHAVIORAL_TRIGGER_FIRED`, and `MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED` to the bridge allowlist.
- `apps/shopify-app/app/routes/api.mira.event.test.ts` now proves `MIRA_BEHAVIORAL_TRIGGER_FIRED` is accepted, product/session scoped, and forwarded to analytics.
- `pnpm --filter @stylique/shopify-app test -- app/routes/api.mira.event.test.ts app/lib/taste.server.test.ts` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.
- `pnpm --filter @stylique/web typecheck` passes.

Impact:
- The product could look like Mira is firing the right UI/UX intent nudges, but merchant analytics would not capture those triggers through the bridge.
- Proactive intent quality, suppression reasons, and tier gating would be harder to prove or tune.
- This is the UI/backend mismatch the user warned about: visible behavior and commerce-intelligence evidence were not guaranteed to meet.

Required fix:
- Keep client-emitted behavioral telemetry, server bridge allowlists, and shared event schemas verified together.
- Build dashboard panels that show fired versus suppressed proactive triggers by trigger type and confidence, so brands can see why Mira appears.
- Add browser fixtures proving same-category revisit/size-chart-open signals both trigger the UI and persist analytics.

## Finding 98: Client Event Allowlists Had No Drift Guard

Severity: P1 for telemetry reliability. The widget has a local `ClientEventName` union, the Shopify storefront endpoint has `CLIENT_POSTABLE_EVENTS`, the bridge has `BRIDGE_ACCEPTED_EVENTS`, and the shared schema has `EventNameSchema`. Before this branch, no verifier checked that the widget's emitted events were accepted by the server paths that should receive them.

Evidence:
- This branch adds `scripts/verify-client-event-allowlists.mjs`.
- The verifier parses widget `ClientEventName`, actual `postClientEvent("...")` calls, Shopify `CLIENT_POSTABLE_EVENTS`, and bridge `BRIDGE_ACCEPTED_EVENTS`.
- It fails when the widget emits an event outside its local type, outside the Shopify client allowlist, or emits proactive/behavioral events that the bridge cannot accept.
- The root package now exposes `pnpm check:client-events`.
- `pnpm check:client-events` passes and reports 6 widget events checked.
- `pnpm check:cart-metrics` and `pnpm check:catalog-gaps` still pass after this verifier addition.

Impact:
- New UI/UX telemetry could previously be added in the widget and silently rejected server-side.
- That makes merchant dashboards, learning loops, and support diagnostics look stale even when the shopper experience is changing.
- This turns another repeated-drift boundary into an enforceable contract.

Required fix:
- Add `pnpm check:client-events` to CI.
- Extend the verifier to include widget package sources and generated Shopify bundle assets.
- Eventually replace local widget event unions with a shared generated client-safe event contract from `@stylique/types`.

## Finding 99: Brand DNA Could Still Learn From Gallery Order Instead Of The Best Product Image

Severity: P1 for catalog understanding and brand trust. Brand DNA extraction already received product metadata, alt text, descriptions, and `primaryTryonImageId`, but when no primary try-on image was available yet it preserved Shopify gallery order. That means a first-position size guide, swatch, detail crop, or lifestyle image could still lead vision extraction and skew colors, fabric, composition, and mood.

Evidence:
- Pre-patch, `apps/worker/src/jobs/brand-dna-catalog.ts` selected image `id`, `url`, `preppedUrl`, and `altText`, but not `qualityScore`, `garmentRole`, or `position`.
- Pre-patch, its local `orderBrandDnaImages()` only moved `primaryTryonImageId` to the front and otherwise returned original gallery order.
- The image-quality pipeline already stores `qualityScore` and `garmentRole`, and Stage 1 already uses alt text to detect size guides, details, swatches, and front images.
- This branch moves Brand DNA image ordering into core as `orderBrandDnaImages()`.
- The worker now selects `position`, `qualityScore`, and `garmentRole` and uses the shared core ordering.
- The shared ordering keeps `primaryTryonImageId` first when present, then prefers FRONT/BACK product images, demotes detail/lifestyle/swatch roles, demotes size-guide/detail/swatch alt hints, and uses quality score/position as tie-breakers.
- `packages/core/src/__tests__/brand-dna.test.ts` now proves a first-position size-guide/detail image does not lead extraction over a front product image, and that primary try-on image still wins when present.
- `pnpm --filter @stylique/core test -- src/__tests__/brand-dna.test.ts src/__tests__/imagery-quality.test.ts` passes.
- `pnpm --filter @stylique/core typecheck` passes.
- `pnpm --filter @stylique/worker typecheck` passes.

Impact:
- A brand could get a palette/tone/seasonality profile from the wrong visual evidence even though better product imagery was already scored.
- This directly affects Mira's product explanations, color theory, styling tone, and brand-specific merchandising recommendations.
- It also explains another repeated-fix pattern: image-quality scoring existed, but Brand DNA extraction did not consume enough of its output.

Required fix:
- Use the same image ordering helper for any future Brand DNA, creative, or merchandising vision extraction path.
- Add a worker-level test harness so `brand-dna-catalog` can be tested end-to-end with Prisma-shaped products, not only through the core helper.
- Audit try-on prewarm and render fallbacks next; they still fall back to `images[0]` when no `primaryTryonImageId` exists.

## Finding 100: Try-On And Prewarm Paths Still Fell Back To The First Gallery Image

Severity: P0 for try-on quality and cost. Brand DNA image ordering was fixed, but live try-on render and prewarm paths still resolved garment images independently with `primaryTryonImageId ?? images[0]`. If image-quality had not yet selected a primary, or a stale primary was unavailable, the renderer could use a first-position size guide, swatch, detail crop, or lifestyle shot as the garment image.

Evidence:
- Pre-patch, `apps/worker/src/jobs/brand-install.ts` selected `p.images.find(primaryTryonImageId) ?? p.images[0]` for install prewarms.
- Pre-patch, `apps/worker/src/jobs/catalog-sync.ts` used the same fallback for per-product sync prewarms.
- Pre-patch, `apps/shopify-app/app/lib/tryon.server.ts` used the same fallback for live synchronous try-on renders.
- This branch adds `resolveTryonImage()` to `packages/core/src/imagery/service.ts`.
- The resolver prefers `primaryTryonImageId`, then chooses usable FRONT/BACK product imagery using `garmentRole`, alt-text penalties, quality score, and position, instead of blindly using `images[0]`.
- Worker install prewarm, catalog-sync prewarm, and Shopify live try-on now import and use the shared resolver.
- These paths now select `position`, `qualityScore`, `garmentRole`, and `altText` so the resolver has the same evidence image-quality already produced.
- `packages/core/src/__tests__/imagery-quality.test.ts` proves first-position size-guide/detail/swatch images do not win when a front product image exists, and that the scored primary image still wins when present.
- `pnpm --filter @stylique/core test -- src/__tests__/imagery-quality.test.ts src/__tests__/brand-dna.test.ts` passes.
- `pnpm --filter @stylique/core typecheck` passes.
- `pnpm --filter @stylique/worker typecheck` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- A shopper could tap try-on and get a render based on the wrong image even though the image-quality pipeline had enough information to avoid it.
- Prewarm jobs could waste paid provider calls and cache bad renders, making later shoppers see the wrong result instantly.
- This is the same root cause pattern again: image-quality scoring existed, but downstream render/prewarm paths still owned their own fallback logic.

Required fix:
- Keep all try-on render/prewarm garment selection on `resolveTryonImage()`.
- Add a worker-level integration test for catalog-sync and brand-install prewarm payloads with a first-position size-guide image.
- Consider making live try-on fail with `no_garment_image` when no primary/front/back usable image exists, instead of using low-confidence unknown-role images.

## Finding 101: There Was No Static Guard Against Raw Try-On First-Image Fallbacks

Severity: P1 for regression prevention. After the try-on image resolver existed, nothing prevented a future worker or app path from reintroducing `primaryTryonImageId ?? images[0]` and bypassing the shared image-quality contract.

Evidence:
- This branch adds `scripts/verify-tryon-image-resolution.mjs`.
- The verifier scans worker and Shopify app lib TypeScript files that mention try-on/prewarm/garment image resolution.
- It fails on raw `primaryTryonImageId` plus `images[0]` primary-image fallbacks that do not use `resolveTryonImage()`.
- The root package now exposes `pnpm check:tryon-images`.
- `pnpm check:tryon-images` passes and reports 14 files scanned.
- `pnpm check:client-events`, `pnpm check:cart-metrics`, and `pnpm check:catalog-gaps` still pass.

Impact:
- The codebase now has a tripwire for the image-selection drift that caused Brand DNA and try-on paths to diverge.
- This keeps the "right image" requirement enforceable instead of depending on manual review memory.

Required fix:
- Add `pnpm check:tryon-images` to CI.
- Extend the verifier to public widget/web try-on surfaces after the production widget consumes richer image metadata.
- Replace demo/web `product.images[0]` try-on paths with a client-safe primary/role-aware image contract.

## Finding 102: Production Card Hydration Still Projected First-Image Order Into The UI

Severity: P0 for shopper trust and Mira perceived intelligence. The backend image-quality, Brand DNA, live try-on, and prewarm paths now use scored image metadata, but the Shopify Mira adapter still hydrated storefront product cards by placing `primaryTryonImageId ?? images[0]` into the client `Product.images` array. The UI then quite reasonably rendered `product.images[0]` in recommendation cards, look cards, context cards, and the try-on panel. That made the UI look unfixed even after the backend had better evidence.

Evidence:
- Pre-patch, `apps/shopify-app/app/lib/mira-adapter.server.ts` documented `primaryTryonImageId` as "preferred image when set, falls back to position:0".
- Pre-patch, `loadMerchantCatalog()` selected image `id`, `url`, `role`, `position`, and `qualityScore`, but not `preppedUrl`, `garmentRole`, or `altText`.
- Pre-patch, `loadMerchantCatalog()` computed `primaryImage` with `p.images.find((i) => i.id === p.primaryTryonImageId)?.url ?? p.images[0]?.url`.
- Pre-patch, the adapter fallback search path queried only the first image and returned `image: r.images[0]?.url`.
- This branch imports `resolveTryonImage()` into the adapter.
- `loadMerchantCatalog()` now selects `preppedUrl`, `garmentRole`, and `altText`, uses `resolveTryonImage()`, and puts the resolved product image first in the client `images` array.
- The fallback catalog search path now selects the same image-quality metadata, resolves the image with `resolveTryonImage()`, and only orders fallback cards ahead when a resolved image exists.
- `scripts/verify-tryon-image-resolution.mjs` now catches multi-line `primaryTryonImageId ?? images[0]` fallbacks, which the old line-local verifier would have missed.
- `pnpm --filter @stylique/shopify-app typecheck` passes.
- `pnpm --filter @stylique/shopify-app test -- app/lib/mira-adapter.server.test.ts` passes.
- `pnpm check:tryon-images` passes.

Impact:
- Recommendation and look cards could still show size guides, swatches, zoomed detail crops, or lifestyle shots even after the backend picked a better try-on image.
- The try-on panel uses `garments.map((g) => g.images[0])`; if the adapter array was wrong, the fitting room still received the wrong garment image from a card-led flow.
- This directly explains the user's repeated symptom: backend fixes did not always change visible cards because the UI contract still encoded first-gallery-image truth.

Required fix:
- Keep the adapter's client `Product.images[0]` contract as "resolved primary product image", not "Shopify first image".
- Add adapter-specific regression tests with first-position size-guide/detail images once Prisma-shaped product fixtures are available.
- Extend the public web/demo catalog contract so non-Shopify demo paths also carry image role/primary metadata instead of relying on first image comments.

## Finding 103: Intent Proactivity Missed Product Media And Zoom Inspection

Severity: P1 for agentic UX. Mira had repeated-category, variant, size-chart, exit, and stranded-dwell triggers, but it did not treat product media inspection as a first-class intent signal. A shopper zooming, enlarging, or repeatedly opening gallery media is often checking fabric, cut, texture, or uncertainty. Without that signal, Mira could stay quiet during one of the clearest "I am deciding" moments.

Evidence:
- Pre-patch, the proactive effect listed four primary signals: same-category/multi-product browsing, variant comparison, exit intent, and stranded dwell. Size-chart behavior was handled in a separate effect.
- There was no click/zoom/gallery/product-media trigger, even though the user explicitly called out zooming and deep inspection as intent outliers.
- This branch adds a `product_media_focus` trigger in `apps/web/app/components/mira/MiraWidget.tsx`.
- The trigger ignores clicks inside `#sq-mira-root`, listens only on PDP routes, detects common Shopify product media/gallery/zoom selectors and labels, and fires after two deliberate media interactions.
- The nudge copy is specific to detail inspection: fit, fabric, and alternatives, not a generic chatbot greeting.
- The same fired/suppressed telemetry path is used: `MIRA_BEHAVIORAL_TRIGGER_FIRED`, `MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED`, and `MIRA_PROACTIVE_TRIGGERED`.
- The route-local suppression logic now de-dupes suppressed trigger types without consuming the entire route's future chance to fire a stronger signal.
- `pnpm --filter @stylique/web typecheck` passes.
- `pnpm --filter @stylique/widget build` passes and writes the Shopify extension/public bundles.
- `pnpm --filter @stylique/widget verify:bundle` passes.

Impact:
- Mira could look passive while a shopper was actively inspecting the product image, exactly when a real sales associate would ask about fit, fabric, or alternatives.
- Brands would miss telemetry for a high-value hesitation pattern: product-media inspection without add-to-cart.
- This is another backend/UI mismatch class: the brain may understand fit/fabric once asked, but the UI was not surfacing that help at the moment the shopper showed the intent.

Required fix:
- Add browser tests for two product-media clicks firing/suppressing `product_media_focus`, no fire on first click, no fire on Mira UI clicks, and no fire on non-PDP pages.
- Feed product-media-focus outcomes into the dashboard alongside size-chart, variant, category-compare, and dwell intent.
- Keep adding only observable, explainable triggers; avoid entry-time greetings that make Mira feel like a chatbot.

## Finding 104: Size-Chart Extraction Bridged Variants, But Live Fit Ignored The Bridge

Severity: P0 for size recommendation quality. The worker extracted size charts from metafields, description HTML, linked pages, and image OCR, then copied row measurements onto `ProductVariant.measurementsJson`. But the live shopper fit endpoint selected only variant `size` and parsed only `Product.sizeChartJson`. That means the carefully-built per-variant bridge could be correct in the database and still not affect the size recommendation shown to the shopper.

Evidence:
- `apps/worker/src/jobs/size-chart-extract.ts` maps extracted chart rows onto matching `ProductVariant.measurementsJson`, explicitly because `recommendFit()` scores from per-SKU garment measurements.
- Pre-patch, `apps/shopify-app/app/lib/shopper.server.ts` selected `variants: { select: { size: true } }` in `postFit()`.
- Pre-patch, `postFit()` computed `skuMeasurements` only with `parseSkuMeasurements(product.sizeChartJson)`.
- This branch selects `measurementsJson` in `postFit()`, adds `parseVariantSkuMeasurements()`, and prefers `parseVariantSkuMeasurements(product.variants) ?? parseSkuMeasurements(product.sizeChartJson)`.
- Zone-fit notes now run when either `Product.sizeChartJson` or variant-level `skuMeasurements` exists, so variant-only bridges can power chest/waist/hip feedback too.
- This branch adds `scripts/verify-fit-measurement-bridge.mjs` and root script `pnpm check:fit-measurements`.
- `pnpm check:fit-measurements` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.
- `pnpm --filter @stylique/core test -- src/__tests__/sizing-parsers.test.ts src/__tests__/fit-style.test.ts` passes.

Impact:
- A merchant could have a valid extracted size chart and populated variant measurements, while the shopper still received a fallback/category-size recommendation.
- This is a direct reason "size recommendation is fixed in backend but not actually working right" can persist: extraction, storage, and live recommendation were not using the same final data source.
- Fit trust lines and zone notes could understate accuracy or miss useful garment-specific fit warnings.

Required fix:
- Keep `postFit()` on the per-variant bridge first, product chart second.
- Add integration tests around `postFit()` with a product that has only `ProductVariant.measurementsJson` and no `Product.sizeChartJson`.
- Surface fit source in merchant/admin diagnostics: fallback, body-only, chart, variant-measurement bridge, or chart+body.

## Finding 105: Shopper Product And Style APIs Still Serialized First-Image Truth

Severity: P0 for UI/UX consistency. Production Mira card hydration was fixed, but the public shopper product/style API still serialized `imageUrl` from `images[0]` and frequently queried only one image. The storefront fitting room and style widgets could therefore receive a thinner, gallery-order product contract than the adapter, even though the image-quality pipeline had richer role/score/alt metadata.

Evidence:
- Pre-patch, `apps/shopify-app/app/lib/serialize.ts` returned `imageUrl: p.images[0]?.url ?? null`.
- Pre-patch, `tryonImageUrl` only looked for `primaryTryonImageId` and returned null when no primary id existed, instead of using the same role/score fallback as live try-on.
- Pre-patch, `getProduct()` selected only image `id` and `url`, without `preppedUrl`, `position`, `qualityScore`, `garmentRole`, or `altText`.
- Pre-patch, `postStyle()` queried `images` with `take: 1` for both the anchor and catalog rows before calling `toShopperProduct()`.
- This branch imports `resolveTryonImage()` into `apps/shopify-app/app/lib/serialize.ts`.
- `toShopperProduct()` now resolves the public display image with the shared role/score/alt-aware resolver; `imageUrl` stays the raw merchant product photo and `tryonImageUrl` uses `preppedUrl` when the product is try-on ready.
- `getProduct()` and `postStyle()` now select the image-quality metadata needed by the serializer and take up to 8 images, not just the first gallery row.
- `apps/shopify-app/app/lib/serialize.test.ts` proves a first-position size-guide/detail image does not become `imageUrl` or `tryonImageUrl`, and that `tryonImageUrl` remains null when `tryonReady` is false.
- A targeted scan of shopper public serialization/style files shows no remaining `images[0]` or `take: 1` image assumptions in those paths.
- `pnpm --filter @stylique/shopify-app typecheck` passes.
- `pnpm --filter @stylique/shopify-app test -- app/lib/serialize.test.ts` passes.
- `pnpm check:tryon-images` passes and now scans 15 files.

Impact:
- A product card opened through the Mira adapter could show the correct image, while the same product fetched through `/api/product` or `/api/style` could show a size chart, swatch, detail crop, or null try-on image.
- This made card behavior appear random: one UI surface was fixed while another still consumed gallery order.
- Style recommendations and shopper product payloads could look less intelligent than the backend extraction/quality pipeline actually was.

Required fix:
- Keep public shopper product serialization on `resolveTryonImage()` and require callers to select image-quality metadata.
- Add a static verifier for shopper serializer callers if new `toShopperProduct()` call sites are introduced.
- Extend the web/demo catalog type beyond `images: string[] // first image is primary` so public demo and production contracts converge.

## Finding 106: Combo Try-On Did Not Preflight The Whole Metered Action

Severity: P1 for quota trust and shopper experience. Single-garment try-on had body/personal quota gates, but combo try-on is a layered multi-render action. Before this pass, the public try-on route could start rendering layer 1 and only discover quota exhaustion on layer 2 or 3. It also accepted `productIds[]` with `mode: PERSONAL_PHOTO` and silently ran a body-model combo instead of rejecting the unsupported mode.

Evidence:
- Pre-patch, `TryOnRenderSchema` allowed `productIds[]` with `mode: "PERSONAL_PHOTO"`.
- Pre-patch, `postTryOnRender()` entered the combo path for `ids.length > 1` and called `renderComboTryOn()` without checking that enough `TRYON_BODY` quota remained for every layer.
- `renderComboTryOn()` calls `renderTryOn()` per layer; each layer gates and records independently. That protects provider calls individually, but not the shopper-facing whole action.
- This branch rejects personal-photo combo requests at schema validation with "Combo try-on only supports BODY_MODEL mode".
- This branch preflights `canConsume({ metric: "TRYON_BODY" })` before combo rendering and returns `quota_reached` or `feature_disabled` when the remaining quota is less than the number of requested layers.
- This branch adds `scripts/verify-tryon-quota-contract.mjs` and root script `pnpm check:tryon-quota`.
- `pnpm check:tryon-quota` passes.
- `pnpm --filter @stylique/shopify-app typecheck` passes.

Impact:
- A shopper could request a full look, spend one render of quota/provider cost, and still receive a failed combo because the second or third layer hit quota.
- The merchant dashboard would show usage consumed for an action that did not produce the requested full result.
- Unsupported personal-photo combo requests silently downgraded behavior, which is a security/UX smell: privacy-sensitive modes must fail explicitly, not mutate into a different rendering path.

Required fix:
- Keep whole-action quota preflight for every multi-step metered operation.
- Add integration tests for remaining quota 1 with a 2-piece combo, remaining quota 2 with a 2-piece combo, and `PERSONAL_PHOTO` combo rejection.
- Consider a true reservation/refund model for high-concurrency quota races before launch.

## Finding 107: Root-Cause Guards Were Local Scripts, Not A Shipping Gate

Severity: P1 for regression control. The repo now has multiple targeted verifiers for exactly the repeated failure modes uncovered in this audit, but they were only individually callable root scripts. There was no aggregate command and no repository CI workflow proving these contracts before merge/deploy. That means a future change could pass ordinary typecheck/test while reintroducing first-image fallbacks, cart metric drift, client event allowlist drift, fit bridge loss, or combo quota drift.

Evidence:
- Pre-patch, `package.json` exposed individual scripts such as `check:catalog-gaps`, `check:cart-metrics`, `check:client-events`, `check:fit-measurements`, `check:tryon-quota`, and `check:tryon-images`.
- Pre-patch, there was no root aggregate script to run all agentic commerce guards.
- Pre-patch, there was no `.github/workflows` CI workflow in the repo for these contracts.
- This branch adds `pnpm check:agentic-contracts`, which runs all current root-cause guard scripts together.
- This branch adds `.github/workflows/agentic-contracts.yml` for PRs and pushes to `main`.
- `pnpm check:agentic-contracts` now includes `pnpm check:widget-bundle`, so generated storefront bundles must stay byte-identical and contain the stable `data-stylique-*` hooks plus proactive/product-media intent telemetry strings.
- The workflow installs dependencies, generates the Prisma client, runs `pnpm check:agentic-contracts`, runs the widget bundle verifier, runs focused Shopify app contract tests, and runs focused core sizing/imagery/Brand DNA tests.
- Local verification of the workflow command set passes:
  - `pnpm check:agentic-contracts`
  - `pnpm --filter @stylique/shopify-app test -- app/lib/serialize.test.ts app/lib/mira-adapter.server.test.ts`
  - `pnpm --filter @stylique/core test -- src/__tests__/sizing-parsers.test.ts src/__tests__/fit-style.test.ts src/__tests__/imagery-quality.test.ts src/__tests__/brand-dna.test.ts`

Impact:
- Fixes could remain "local" and disappear in the next branch, which is exactly how the same bug class keeps coming back.
- CI now covers the most important current contracts: no ambiguous cart-confirmed metrics, no catalog-gap maintenance pollution, no client-event allowlist drift, no dropped fit measurement bridge, no raw try-on image fallback, and no unsupported/partially metered combo try-on.

Required fix:
- Keep adding newly discovered root-cause verifiers to `check:agentic-contracts`.
- Add browser E2E to CI once the storefront fixture is stable; current CI proves the bundle contract but still does not prove rendered card geometry, proactive timing, or Shopify install/injection in a real browser.
- Consider running the full package typecheck/test matrix separately from these focused contracts once runtime env setup is stable.

## Finding 108: Dashboard UI Still Flattened Blended Fashion Intelligence Into Shopper Truth

Severity: P1 for merchant trust and repeated "backend fixed but UI still wrong" regressions. Production Fashion Intelligence correctly reports `dataMode: "live+modelled"` because several rows intentionally blend real shopper signals with deterministic catalog priors. The embedded merchant dashboard, however, still labeled the live consumer panel as "Shopper-taught", rendered style rows as plain "share", and showed live-mode combo rows as shopper "asks" even when the server returned catalog fallback pairings with `count: 0`.

Evidence:
- `apps/shopify-app/app/lib/fashion-intelligence.server.ts` intentionally builds style identity from catalog priors plus real color-click traffic.
- `catalogComboFallback()` returns catalog pairings with `count: 0` whenever there are not enough measured combo asks.
- Pre-patch, `apps/shopify-app/app/routes/app.dashboard.tsx` displayed `Shopper-taught`, live style `share`, and `${combo.count} asks` for all live-mode combos.
- This branch changes the dashboard badge to `Shopper + catalog`, changes style row copy to `shopper + catalog mix`, and labels each combo row as `catalog pairing` unless `combo.count > 0`.
- This branch adds `scripts/verify-dashboard-fashion-intelligence-truth.mjs` and wires it into `pnpm check:agentic-contracts`.

Impact:
- Merchants could read catalog-modelled or blended recommendations as fully observed shopper behavior.
- The backend could become more honest while the visible dashboard still looked overconfident, which is the exact backend/UI split causing repeated fix churn.
- Catalog fallback outfits could appear as "0 asks" in live mode, which is technically true but commercially misleading and weak UX.

Required fix:
- Keep source labels visible on every merchant-facing intelligence surface, not only executive cards.
- Promote per-row source metadata for style, combo, fit, compatibility, and collection rows so the UI does not have to infer source from counts.
- Add browser-level dashboard screenshots/tests once the app fixture is stable, because this verifier protects copy contracts but not visual hierarchy or merchant comprehension.

## Finding 109: Size-Chart Bridge Could Freeze Old Variant Measurements Forever

Severity: P0 for fit recommendations. The size-chart extractor writes the extracted chart to `Product.sizeChartJson` and bridges each chart row into `ProductVariant.measurementsJson`, which is the data the live fit API reads. Pre-patch, the bridge skipped every variant that already had `measurementsJson`. That protected explicit per-SKU data, but it also froze measurements that the bridge itself wrote on an earlier run.

Evidence:
- `apps/worker/src/jobs/size-chart-extract.ts` selected `measurementsJson` but not `measurementsSource`.
- Pre-patch bridge loop had `if (v.measurementsJson) continue`.
- The worker itself writes `measurementsSource: bridgeChart.source ?? "size_chart"`, so it has enough provenance to know which rows it owns.
- This branch now selects `measurementsSource`, preserves only non-bridge explicit per-SKU measurements, refreshes bridge-owned measurements on every extraction run, and clears stale bridge-owned rows when a refreshed chart no longer contains that variant size.
- This branch adds `scripts/verify-size-chart-bridge-refresh.mjs` and wires it into `pnpm check:agentic-contracts`.

Impact:
- A merchant could update a size chart in Shopify and see the product-level chart refresh while live fit recommendations still used old per-variant measurements.
- This creates the exact "backend says fixed, shopper still gets wrong size" loop: the extraction layer is correct, but the runtime bridge is stale.
- The bug is especially dangerous because it does not throw; it silently returns plausible but outdated fit advice.

Required fix:
- Keep source ownership on every derived field that feeds shopper decisions.
- Preserve explicit per-SKU data only when its source is not the size-chart bridge.
- Add a real DB-backed worker test for update-then-refresh and removed-size-row behavior once worker test harness setup is stable.

## Finding 110: Initial Shopify ScriptTag Injection Still Treated User Errors As Success

Severity: P1 for storefront availability. The daily injection health worker already fails a shop when Shopify returns `scriptTagCreate.userErrors`, but the initial install path in `ensureScriptTags()` only logged those user errors and returned normally. The onboarding path could therefore continue as if Mira was injected even when Shopify rejected the ScriptTag create mutation.

Evidence:
- Storefront injection depends on `write_script_tags` and creates `${appUrl}/widget.js` in `apps/shopify-app/app/services/scriptTag.server.ts`.
- The worker self-heal path already throws `script_tag_create_failed` on Shopify user errors in `apps/worker/src/jobs/inject-widget.ts`.
- Pre-patch, `ensureScriptTags()` logged `Failed to create...` but did not throw, so `afterAuth` had no actionable failure signal.
- This branch changes `ensureScriptTags()` to throw `script_tag_create_failed:...` on user errors.
- This branch adds `scripts/verify-shopify-injection-contract.mjs` and wires it into `pnpm check:agentic-contracts` to keep install scopes, install source, self-heal source, and user-error failure behavior aligned.

Impact:
- A merchant could complete install and still have no storefront Mira because Shopify rejected the ScriptTag mutation.
- Operators would see "installed" plus no widget heartbeat and waste time debugging frontend behavior when the true failure was injection.
- The daily worker might repair it later, but day-zero onboarding would still feel broken.

Required fix:
- Keep initial install and daily self-heal on the same failure contract.
- Surface injection failure in merchant/admin UI, not only logs.
- Add a live Shopify install E2E once test-store credentials are stable: OAuth, scope consent, ScriptTag present, `/widget.js` 200, storefront heartbeat.

## Finding 111: Live Storefront E2E Did Not Prove Recommendation Cards Rendered

Severity: P1 for the exact UI/UX complaint that cards "sometimes come up, sometimes don't." The live Shopify Playwright harness proved widget mount, cart add, checkout navigation, keyboard, basic accessible names, and mobile try-on sheet layout, but it did not assert that a real Mira styling prompt produced any recommendation card or look card. That allowed a green browser harness while the most visible commerce UI could be missing.

Evidence:
- `apps/web/scripts/storefront-e2e.spec.mjs` had cart, checkout, keyboard, screen-reader, and mobile tests.
- Pre-patch, there was no assertion for `[data-stylique-reco-card]` or `[data-stylique-look-card]` in the live-store test.
- The widget bundle verifier protected the selectors' existence in the generated JS, but selector existence is not proof that runtime cards render after a real prompt.
- This branch adds a live storefront test that opens Mira, asks for a full look, waits for a recommendation/look card, verifies visible card geometry, and requires either an image or the explicit no-photo fallback inside the card.
- This branch adds `scripts/verify-storefront-e2e-contract.mjs` and wires it into `pnpm check:agentic-contracts` so the browser harness cannot quietly lose card coverage.

Impact:
- Mira could appear as a text chatbot even if the commerce cards were broken.
- A backend fix to recommendation logic could still look unfixed to shoppers because the UI card path was not under live browser proof.
- The previous bundle verifier was necessary but not sufficient: it proved code contained hooks, not that the interaction flow produced cards.

Required fix:
- Keep live browser coverage for card rendering, cart mutation, checkout navigation, mobile layout, keyboard, and accessible names.
- Add a second live browser test for proactive intent timing once the test store has stable product media/size-chart fixtures.
- Add screenshot diff or visual geometry checks for recommendation cards and try-on sheet on both desktop and mobile.

## Finding 112: Proactive Intent Was In Bundle Guards, Not Live Browser Behavior Guards

Severity: P1 for the "Mira pops at the wrong time / looks like a chatbot" complaint. The widget bundle verifier protected proactive trigger strings such as `product_media_focus`, but the live storefront E2E did not exercise an outlier-intent behavior. That meant the repo could prove the string existed while never proving a closed Mira sees product-media inspection, emits proactive telemetry, and shows the shopper a visible nudge.

Evidence:
- `apps/widget/scripts/verify-bundle.mjs` required `MIRA_PROACTIVE_TRIGGERED`, `product_media_focus`, and `clicked_or_zoomed_product_media_twice`.
- Pre-patch, `apps/web/scripts/storefront-e2e.spec.mjs` did not assert any proactive nudge or proactive telemetry path.
- The visible nudge button had no stable `data-stylique-*` selector, so browser tests had no durable way to prove it appeared.
- This branch adds `data-stylique-nudge` to the closed-state proactive nudge UI.
- This branch adds a live storefront test that keeps Mira closed, enables proactive entitlement via route interception, simulates two product-media interactions, asserts `[data-stylique-nudge]` is visible, and verifies a captured `MIRA_PROACTIVE_TRIGGERED` event with `triggerId: "product_media_focus"`.
- The Shopify widget bundle was rebuilt so `apps/shopify-app/extensions/stylique-widget/assets/tryon.js` and `apps/shopify-app/public/widget.js` carry the nudge selector.

Impact:
- The system could claim proactive intent was fixed because the code contained trigger strings, while the actual storefront still behaved like a passive chatbot.
- A future refactor could break the closed-state nudge UI without failing tests.
- Product-media/zoom behavior is one of the user's named outlier intent cases; it needs browser proof, not only source-code proof.

Required fix:
- Keep proactive intent covered in both bundle guards and browser E2E.
- Add additional live browser scenarios for size-chart opened, same-category comparison, and stranded PDP dwell when stable fixtures exist.
- Capture and review proactive suppression events in test logs so "not popping" can be explained by tier/cooldown/chat-open reasons instead of looking random.

## Finding 113: Enterprise Onboarding UI Misstated Blank Quota Behavior

Severity: P1 for manual enterprise onboarding and quota trust. The super-admin enterprise page told ops that custom monthly limits could be left blank "for unlimited", but the API fills blank values with the selected tier defaults. That is the right runtime behavior for Starter/Growth cost controls, but the UI copy was commercially dangerous: ops could promise unlimited usage while enforcement applied capped defaults.

Evidence:
- `apps/web/app/api/admin/enterprise/route.ts` writes blank `monthlyTryOnPersonal`, `monthlyTryOnBody`, `monthlyStylistTurns`, `monthlyStyleRecs`, and `monthlyFitRecs` as `PLAN_DEFAULTS[tier]` / `PLAN_FEATURES[tier]` values.
- Pre-patch, `apps/web/app/admin/enterprise/page.tsx` displayed `Custom monthly limits (leave blank for unlimited)`.
- Internal ops tier changes already derive quotas from `PLAN_DEFAULTS` and `PLAN_FEATURES`, so the manual enterprise page needed to say the same thing.
- This branch changes the enterprise copy to `blank uses the selected tier default; Ultimate defaults are unlimited where shown as blank`.
- This branch adds `scripts/verify-enterprise-onboarding-contract.mjs` and wires it into `pnpm check:agentic-contracts`, checking the UI copy, blank-to-default API behavior, pending pre-install merchant support, explicit ops-comp billing contract, and internal ops shared-plan derivation.

Impact:
- Manual onboarding could create a merchant expectation of unlimited usage while the runtime correctly enforced tier caps.
- Support would see "quota reached" bugs for accounts that ops believed were unlimited.
- This is exactly the kind of super-admin/UI/backend mismatch that makes repeated fixes feel like they did not stick.

Required fix:
- Keep manual provisioning UI copy aligned with the API and entitlement model.
- Add a real admin flow test for create pending merchant → install → effective plan/quotas/dashboard usage once auth fixtures are stable.
- If bespoke unlimited contracts are needed for Growth/Starter, add explicit nullable override controls instead of relying on blank number fields.

## Finding 114: Style Pairing Still Depended On Exact Canonical Category Strings

Severity: P1 for scalable product understanding. The combo scorer had broad category aliases, but `buildOutfit()` selected pieces by exact category strings before the scorer ran. If upstream sync or live merchant payloads used real product types like `Blouses`, `Pants`, `Heels`, `Bags`, or regional categories like `saree`, the outfit picker could fail to select bottoms/shoes/accessories even though the later scorer understood similar aliases.

Evidence:
- `packages/core/src/style/service.ts` pre-patch selected candidates with `wanted.includes(p.category)`.
- The same file picked anchor roles with `COMPLEMENT_ROLES[anchor.category ?? ""]`.
- `packages/core/src/style/score.ts` already had broader alias sets for scoring, creating a selection/scoring split.
- This branch adds `canonicalStyleCategory()` to normalize common merchant category/product-type aliases before anchor-role selection, candidate-role selection, formality scoring, and combo-score category projection.
- This branch adds a regression test with raw merchant categories `Blouses`, `Pants`, `Heels`, and `Bags`, proving the outfit fills bottom, shoes, and accessory roles.
- This branch adds `scripts/verify-style-category-aliases.mjs` and wires it into `pnpm check:agentic-contracts`.

Impact:
- Mira could appear unable to build complete outfits for brands whose product types were not exactly the repo's canonical strings.
- The later combo score could be correct, but never reached because the picker failed to select complementary pieces.
- This is a classic "works on our demo catalog, breaks on real merchant vocabulary" root cause.

Required fix:
- Keep category alias normalization inside the style engine, not only in upstream sync.
- Add more locale/regional category aliases as onboarding discovers them.
- Eventually move the alias dictionary into a shared taxonomy module consumed by catalog sync, style pairing, Fashion Intelligence, and Mira adapter slot scoring.

## Finding 115: Product Slot Taxonomy Was Still Duplicated Across Sales And Reporting

Severity: P1 for UI reliability and merchant intelligence consistency. Core style pairing now understood merchant category aliases, but the Shopify Mira adapter and Fashion Intelligence still owned separate product-slot classifiers. That meant a backend outfit score, the storefront look-card builder, and merchant reporting could each interpret the same product differently. The adapter also carried the old dangerous fallback where an unknown product silently became `top`.

Evidence:
- `packages/core/src/style/service.ts` had `canonicalStyleCategory()` after the prior patch, but it was private to the style service.
- Pre-patch, `apps/shopify-app/app/lib/mira-adapter.server.ts` implemented its own `slotOf()` regex and defaulted unknown products to `top`.
- Pre-patch, `apps/shopify-app/app/lib/fashion-intelligence.server.ts` implemented a separate `productSlot()` regex for compatibility cards.
- This branch exports `canonicalStyleCategory()` and `inferStyleProductSlot()` from core and makes both the Shopify adapter and Fashion Intelligence delegate product-slot inference to core.
- This branch expands the shared classifier with regional/accessory terms from the adapter path, including `khussa`, `maang tikka`, `gharara`, `sharara`, `chappal`, `potli`, and related aliases.
- The new adapter test proved another live UX bug: top+bottom looks stopped at two pieces when there was no outerwear layer, skipping footwear/accessories. The adapter now fills a third finishing slot from footwear/accessory candidates.
- `scripts/verify-style-category-aliases.mjs` now guards that the adapter and Fashion Intelligence use the shared classifier instead of reintroducing local product-slot truth.

Impact:
- A shopper could ask for a full look and receive an incomplete two-piece card set even when the catalog had matching heels or accessories.
- Dashboard compatibility/pairing intelligence could diverge from the storefront's actual outfit builder, making merchant advice disagree with shopper experience.
- Unknown or regional categories could be forced into a top slot, causing incorrect bundles and making Mira look less product-aware than the backend evidence actually was.

Required fix:
- Keep product taxonomy shared from core and consumed by storefront, adapter, Fashion Intelligence, reports, and workers.
- Add live storefront E2E fixtures with non-canonical product types to prove rendered card sets, not only static adapter behavior.
- Move the alias dictionary into a dedicated taxonomy module if it grows beyond style pairing, so catalog normalization, sync, and reporting import the same map explicitly.

## Finding 116: Try-On Bundle Cart Success Still Learned Only The Anchor Product

Severity: P1 for the learning loop and bundle intelligence. The Try-On panel correctly waited for `addOutfitToCart()` to succeed before emitting `CART_FROM_TRYON`, but the bundle path emitted the event against only the anchor product. Companion pieces from `effectiveLookItems` were absent from the payload. That means a shopper could add a full look from try-on, the cart could be real, and the backend would still learn only that the anchor converted.

Evidence:
- `apps/web/app/components/surfaces/TryOnPanel.tsx` pre-patch emitted `CART_FROM_TRYON` after bundle cart success with `comboName` and `size`, but no `productIds`.
- `apps/shopify-app/app/lib/mira-attribution.server.ts` already reads `payload.productIds`, so the attribution layer was capable of multi-product evidence.
- `packages/types/src/index.ts` allowed `productIds` for `CART_FROM_MIRA` and `CART_FROM_WIDGET_STYLE`, but not for `CART_FROM_TRYON`.
- This branch adds optional `productIds` to the `CART_FROM_TRYON` payload schema.
- This branch makes the Try-On bundle success path collect the anchor and companion `productId`s and emit them with `CART_FROM_TRYON` only after `addOutfitToCart()` succeeds.
- This branch adds a schema regression test for multi-product try-on cart success and `scripts/verify-tryon-cart-learning.mjs`, wired into `pnpm check:agentic-contracts`.
- The rebuilt Shopify widget bundle now carries the payload fix and `verify:bundle` confirms the public/script-tag bundles are byte-identical.

Impact:
- Fashion Intelligence, attribution, recommendations, and taste learning could under-credit shoes/accessories/outerwear sold through try-on looks.
- Merchants would see weaker evidence for bundle companions than the shopper journey actually produced.
- This is another backend/UI split: cart behavior was fixed, but the UI telemetry did not carry the complete commerce truth.

Required fix:
- Keep all cart-success emitters payload-compatible with attribution: single-product `productId` plus bundle-level `productIds` when a multi-piece cart succeeds.
- Add live storefront E2E that adds a try-on look and asserts the emitted event payload includes all product ids once a stable fixture exists.
- Audit dashboard copy that reads try-on conversion counts to make sure it does not imply product-level companion learning before multi-product evidence exists.

## Finding 117: Storefront Cart-Success Ingestion Trusted Client Product Evidence

Severity: P1 for security, attribution integrity, and learning quality. The `/api/events` storefront ingestion path correctly rejected server-authoritative event names, but for allowed cart-success events it trusted `productId` and `payload.productIds` from the browser. A client-side fix could therefore emit complete bundle evidence, while the server still stored unverified or cross-shop product ids inside shop-scoped analytics.

Evidence:
- `apps/shopify-app/app/lib/shopper-events.server.ts` pre-patch validated only event name and payload shape before calling `analytics.track()`.
- `CART_FROM_TRYON` and `CART_FROM_WIDGET_STYLE` are client-postable because the browser knows whether `/cart/add.js` succeeded, but that also means their product evidence must be treated as untrusted.
- `apps/shopify-app/app/lib/mira-attribution.server.ts` intentionally reads both direct `productId` and `payload.productIds`, so unverified payload ids can influence attribution if they overlap a later order.
- This branch adds `validateClientProductEvidence()` for client cart-success events. It collects direct/payload product ids, checks them against `Product` rows for the current `shopId`, rejects cart-success events with no shop-owned product evidence, and persists only canonical shop-owned ids.
- This branch adds `apps/shopify-app/app/lib/shopper-events.server.test.ts` proving valid bundle evidence is preserved, foreign ids are stripped, no-evidence cart-success events are rejected, and non-cart telemetry can still be posted without a product id.
- `scripts/verify-tryon-cart-learning.mjs` now guards the server ingestion contract alongside the client/schema contract.

Impact:
- A malicious or buggy browser could poison merchant learning with product ids that did not belong to that shop.
- Assisted-order attribution and taste learning could receive product evidence that looked shop-scoped only because the event row had a `shopId`.
- This is a repeated-fix pattern: the UI path can become correct while the ingestion boundary still weakens the truth before it reaches intelligence.

Required fix:
- Treat every browser-posted product id as untrusted and validate it against the current merchant before analytics persistence.
- Keep cart-success events stricter than passive telemetry: if no shop-owned product evidence exists, reject instead of storing a vague success event.
- Add live-store tests that compare emitted product ids against the merchant catalog once stable Shopify fixtures exist.

## Finding 118: The Demo-To-Production Bridge Could Still Store Unverified Cart Product IDs

Severity: P1 for attribution integrity. The direct storefront `/api/events` path now validates cart-success product evidence, but `/api/mira/event` was a second ingestion route that also accepted `CART_FROM_TRYON`. That bridge had a secret and an event allowlist, but once accepted it still passed normalized payload data straight into `analytics.track()`. If a bridge caller sent `payload.productIds`, those ids were not filtered against the current shop before attribution and learning could read them.

Evidence:
- `apps/shopify-app/app/routes/api.mira.event.tsx` accepted `CART_FROM_TRYON` in `BRIDGE_ACCEPTED_EVENTS`.
- Pre-patch, the route resolved `productHandle` to one product id, but did not canonicalize `payload.productId` or `payload.productIds`.
- `apps/shopify-app/app/lib/mira-attribution.server.ts` reads `payload.productIds`, so bridge payload ids are meaningful evidence, not harmless metadata.
- This branch adds `validateBridgeProductEvidence()` for bridge cart-success events. It validates direct/payload ids against the current `shopId`, rejects cart-success events with no shop-owned product evidence, and stores only canonical shop-owned ids.
- This branch extends `apps/shopify-app/app/routes/api.mira.event.test.ts` with bridge cart-success preservation/rejection cases.
- `scripts/verify-tryon-cart-learning.mjs` now guards both `/api/events` and `/api/mira/event` product-evidence validation.

Impact:
- A bridge integration could make the UI/event layer look fixed while product-level attribution still trusted unverified ids.
- Cross-shop or stale ids could travel into the merchant's analytics payload and later be interpreted as sales or taste evidence.
- This explains why repeated fixes can miss the real issue: closing one ingestion door is not enough when another path writes the same event family.

Required fix:
- Keep all event-ingestion routes that accept cart-success events under the same shop-owned product-evidence rule.
- Prefer a shared helper for product-evidence canonicalization if more routes begin accepting cart success or bundle-success telemetry.
- Add live bridge/integration tests once a stable bridge caller exists.

## Finding 119: Dashboard Conversion Copy Still Overclaimed Cart/Proxy Metrics As Purchase Lift

Severity: P1 for merchant trust and go-to-market credibility. The production Fashion Intelligence math had been made more honest, but the merchant-facing labels still said `try-on purchase rate`, `baseline purchase rate`, `try-on lift`, `Try-on lift`, and `try → buy`. The underlying values are cart-origin events, confirmed-order proxy denominators, and attribution ratios. They are useful, but they are not controlled causal lift and not always purchase-rate truth.

Evidence:
- `apps/shopify-app/app/routes/app.dashboard.tsx` pre-patch rendered `try-on purchase rate`, `baseline purchase rate`, and `try-on lift` in the conversion panel.
- `apps/shopify-app/app/lib/fashion-intelligence.server.ts` pre-patch rendered executive cards labelled `Try-on lift`, `try → buy`, and `Return risk`.
- The conversion values are computed from `CART_FROM_TRYON`, `TRYON_RENDER_COMPLETED`, `CART_CONFIRMED`, and chat activity. That is attribution/proxy evidence, not a controlled holdout experiment.
- The fit risk card uses cart confirmations/cancellations, not real return outcomes.
- This branch changes dashboard labels to `try-on cart rate`, `baseline order proxy`, and `try-on assist ratio`, with hints disclosing the formulas and that the ratio is not causal holdout lift.
- This branch changes executive-card copy to `Try-on cart assist`, `interest → cart`, and `Fit confidence risk`, with source details explicitly saying the metrics are not controlled causal lift or a returns-rate claim.
- `scripts/verify-dashboard-fashion-intelligence-truth.mjs` now blocks these overclaiming labels from returning.

Impact:
- A merchant could believe Stylique proved purchase lift when the product had only cart-origin and attribution-proxy evidence.
- Sales/demo language could get ahead of measurable truth, causing mistrust once a brand asks how the number was calculated.
- This is the UI/UX version of the repeated-fix loop: backend metrics become more honest, but unchanged labels keep selling the old claim.

Required fix:
- Keep dashboard labels tied to the actual denominator and event family.
- Reserve `purchase rate`, `return risk`, and `lift` for cases where the evidence genuinely proves purchase/return/causal lift semantics.
- Add live dashboard visual review after the next real-store E2E run to check not just values but merchant interpretation.

## Finding 120: Shop-Owned Product Evidence Validation Was Fixed Twice Instead Of Owned Once

Severity: P1 for maintainability and security drift. After locking down `/api/events` and `/api/mira/event`, both paths carried nearly identical product-evidence canonicalization code. That made the immediate security posture better, but preserved the root cause pattern: one future route or patch could update one copy and leave the other route trusting different product evidence.

Evidence:
- `apps/shopify-app/app/lib/shopper-events.server.ts` had a local cart-success product-evidence validator.
- `apps/shopify-app/app/routes/api.mira.event.tsx` had a second local validator with the same payload parsing, current-shop lookup, and canonical payload rewrite.
- The accepted event sets intentionally differ: `/api/events` accepts `CART_FROM_TRYON` and `CART_FROM_WIDGET_STYLE`; the bridge currently accepts `CART_FROM_TRYON`. That difference should be configuration, not duplicated validation logic.
- This branch adds `apps/shopify-app/app/lib/product-evidence.server.ts` with `validateShopProductEvidence()`.
- Both ingestion paths now call the shared helper with their own allowed cart-success event set.
- This branch adds `apps/shopify-app/app/lib/product-evidence.server.test.ts`, while keeping route tests for `/api/events` and `/api/mira/event`.
- `scripts/verify-tryon-cart-learning.mjs` now verifies that both routes import/use the shared helper and no longer define local validation functions.

Impact:
- Without centralization, security and attribution semantics could drift again the next time one route adds `CART_FROM_WIDGET_STYLE`, `CART_FROM_MIRA`, or another bundle-success event.
- Repeated fixes would reappear as "we already validated product IDs" while only one ingress path actually followed the current rule.
- Central ownership makes the cart-success evidence invariant easier to audit and harder to accidentally weaken.

Required fix:
- Keep browser/bridge product-evidence validation in one helper.
- If new cart-success events become client- or bridge-postable, add them to the route-specific event set and keep canonicalization in `validateShopProductEvidence()`.
- Consider moving the route-specific cart-success event sets into a shared policy module if another ingestion route appears.

## Finding 121: Catalog Sync Did Not Refresh Brand DNA After Product Changes

Severity: P1 for scalable product understanding and UI consistency. The Brand DNA worker said it was triggered automatically after catalog sync, and install/manual settings paths could enqueue it, but the active catalog sync job did not refresh Brand DNA after full sync, product webhook sync, or product deletion. That means the catalog could be current while Mira's colors, fabrics, style voice, product mix, and visual taste stayed frozen to an older snapshot.

Evidence:
- `apps/worker/src/jobs/brand-dna-catalog.ts` documents catalog sync as an automatic trigger.
- Before this patch, `apps/worker/src/jobs/catalog-sync.ts` enqueued image-quality, size-chart extraction, embeddings, and try-on prewarm follow-ups, but not `brand-dna-catalog`.
- The install path enqueues Brand DNA once, and merchant brand settings can trigger it manually, but recurring catalog changes are the normal path for new products, seasonal drops, deleted products, and refreshed imagery.
- This branch adds a lazy `brandDnaCatalogQueue()` producer to catalog sync.
- Full sync, single-product sync, and delete sync now enqueue `brand-dna-catalog` with a six-hour dedupe bucket.
- Catalog-sync completion payload/logging now exposes `brandDnaQueued` from the actual enqueue result.
- `scripts/verify-brand-dna-refresh-contract.mjs` guards that catalog sync keeps the Brand DNA refresh contract.

Impact:
- This is a classic "backend partly fixed, UI still feels wrong" failure: image-quality and catalog rows can improve, but cards, recommendations, and Mira voice still reflect stale Brand DNA.
- New collections could appear in product search while Brand DNA still recommends old colors, fabrics, seasons, or product categories.
- Deletions could keep influencing brand taste until someone manually refreshed settings.

Required fix:
- Keep Brand DNA refresh tied to catalog mutations, not only install/manual actions.
- Add source/coverage UI for Brand DNA so ops can see when catalog DNA was last trained and from how many products/images.
- Consider a product-change digest in the Brand DNA worker so very large shops can summarize changed products while still sampling the broader catalog.

## Finding 122: Brand DNA Refresh UI And Sync Logs Could Report Success Without A Queued Job

Severity: P1 for operations truth and merchant trust. After wiring catalog sync to refresh Brand DNA, the next line-level audit found a second-order status bug: queue failures were still being swallowed. The merchant Brand DNA page redirected with a success toast even if Redis/BullMQ rejected the manual refresh, and catalog sync initially logged/notified `brandDnaQueued: true` even when the queue add was caught and ignored.

Evidence:
- `apps/shopify-app/app/routes/app.settings.brand.tsx` previously used `.catch(console.error)` around the manual `brand-dna-catalog` enqueue and then redirected to `toast=refresh_queued` regardless.
- `apps/worker/src/jobs/catalog-sync.ts` previously swallowed the catalog-triggered Brand DNA enqueue and recorded a truthy queued flag in the full-sync notification/log payload.
- This branch adds `setBrandSourceStatus()` in the merchant Brand DNA settings route so manual refresh marks the Shopify source `PENDING` before enqueue, marks it `FAILED` on enqueue failure, and returns a visible 503 error instead of a success redirect.
- This branch centralizes worker-side Brand DNA enqueue in `enqueueBrandDnaRefresh()`, marks the Shopify BrandSource `PENDING` only after BullMQ accepts the job, marks `FAILED` on enqueue failure, and returns a boolean used by catalog sync notifications/logs.
- `scripts/verify-brand-dna-refresh-contract.mjs` now guards the honest-status behavior as well as the refresh trigger paths.

Impact:
- Ops and merchants could believe Brand DNA was refreshing while no worker job existed, making stale Mira style/color behavior look like an LLM or UI bug.
- The BrandSource status could remain `READY` from an old successful run even after a fresh refresh request failed to enqueue.
- This is one reason the team kept "fixing" Brand DNA and cards repeatedly: the visibility layer reported intent, not execution.

Required fix:
- Keep queue-facing UI honest: a background job should only be reported as queued after the queue accepts it.
- Keep BrandSource status as operational truth: `PENDING` for accepted work, `READY` only when the worker saves output, and `FAILED` when enqueue or processing fails.
- Extend this pattern to other manual/backfill buttons that currently catch and continue.

## Finding 123: Instagram And Campaign DNA Uploads Also Reported Processing Without Queue Acceptance

Severity: P1 for brand intelligence and campaign merchandising. The catalog DNA refresh path was made honest, but the adjacent Instagram archive and campaign override upload paths still had the old pattern: save the uploaded ZIP, set a processing-ish state, swallow BullMQ enqueue failures, and redirect with a success toast. Campaign overrides directly affect Mira voice and look selection, so a false "processing" state can make later styling behavior look randomly stale or generic.

Evidence:
- `apps/shopify-app/app/routes/app.settings.brand.tsx` previously used `.catch(console.error)` around `instagramQueue().add("process", ...)` and then redirected to `toast=instagram_processing`.
- The same route used `.catch(console.error)` around `instagramQueue().add("process-campaign", ...)` and then redirected to `toast=campaign_processing`.
- This branch changes both upload paths to mark the `INSTAGRAM` BrandSource `PENDING` before enqueue, mark it `FAILED` on enqueue failure, and return a visible 503 JSON error instead of a success redirect.
- `apps/worker/src/jobs/brand-instagram.ts` now marks the source `FAILED` with `brand_profile_missing` if the worker cannot find a `BrandProfile` after accepting the job.
- `scripts/verify-brand-dna-refresh-contract.mjs` now blocks swallowed Instagram/campaign enqueue failures and guards the missing-profile failure status.

Impact:
- Merchants could see "Instagram archive received — processing DNA" while no processing job existed.
- Campaign-specific visual DNA could fail silently, leaving Mira and recommendations on the base/generic style while the UI claimed the campaign was processing.
- Ops would chase model quality, prompt, or card rendering issues when the root cause was that no worker job had ever been accepted.

Required fix:
- Keep every Brand DNA source upload under the same honest queue contract.
- Show source-specific failed states in the Brand DNA UI with next action: retry, check worker/Redis, or create the missing BrandProfile.
- Extend queue-honesty checks to size-chart/image-quality/admin backfills after this Brand DNA pass.

## Finding 124: Manual Size-Chart Backfill Reported `ok: true` For Partial Queue Failure

Severity: P1 for fit accuracy and repair trust. The manual size-chart backfill route was intended to repair stale or missing size data after extraction fixes. It looped through products and enqueued one job per product, but each queue failure was swallowed with `.catch(() => undefined)`. The endpoint then returned `ok: true` with a smaller `queued` count. That means a merchant/admin could trigger a repair, see a successful API response, and still have a partially unrepaired catalog feeding size recommendations.

Evidence:
- `apps/shopify-app/app/routes/api.admin.size-charts.backfill.tsx` previously caught each `queue.add()` failure and continued.
- The response returned `{ ok: true, queued }` without `total`, `failed`, or an error status when `queued < products.length`.
- This branch changes the route to collect failed product queue attempts.
- Full success now returns `{ ok: true, queued, failed: 0, total }`.
- Partial enqueue failure returns HTTP 207 with `ok: false`, `queued`, `failed`, `total`, and up to 10 failed product IDs/errors.
- Total enqueue failure returns HTTP 503 with the same honest payload shape.
- `scripts/verify-size-chart-bridge-refresh.mjs` now guards that the backfill route does not swallow per-product queue failures and reports partial/total enqueue failure.

Impact:
- Size recommendation bugs could survive a manual "repair" and still look like model/category issues.
- Ops had no way to distinguish "all products accepted for extraction" from "some products quietly failed to enqueue".
- This preserves the recurring-fix pattern: backend extraction logic improves, but the repair path fails silently for part of the catalog.

Required fix:
- Keep manual repair endpoints honest about accepted, failed, and total work.
- Surface partial failures in any UI that calls this backfill route, not just the JSON API.
- Apply the same accepted/failed/total response pattern to other fan-out admin jobs.

## Finding 125: Manual Image-Quality Re-Score Could Be Deduped Against A Completed Job

Severity: P1 for card quality, try-on quality, and brand/product understanding. Image-quality scoring chooses `primaryTryonImageId`, `tryonReady`, `widgetTier`, and role/score metadata consumed by storefront cards, try-on rendering, Brand DNA image ordering, and product serialization. The manual admin route used sticky job IDs (`img-q:<shop>:all` and `img-q:<shop>:<product>`). Because completed BullMQ jobs are retained, a later manual re-score could be deduped against an old completed job and still return `ok: true`.

Evidence:
- `apps/shopify-app/app/routes/api.admin.image-quality.backfill.tsx` previously used fixed job IDs for full-shop and single-product image scoring.
- The route copy says the button is for manual re-scoring after new product images, but a sticky completed job ID can prevent the fresh worker run that would evaluate the new gallery.
- This branch adds a per-request `backfillRunId` to manual image-quality backfill job IDs.
- The response now includes the accepted BullMQ `jobId`, so callers can distinguish an accepted job from a generic success.
- `scripts/verify-tryon-image-resolution.mjs` now guards the request-scoped image-quality repair job IDs and returned job id.

Impact:
- A merchant could click "Re-score all" after fixing product photos and see a queued/success state while the worker never re-ran.
- Mira cards, try-on anchors, and Brand DNA could keep using stale gallery choices even though the image scorer itself was improved.
- This explains another recurrence pattern: backend image selection was fixed, but the repair mechanism could be a no-op.

Required fix:
- Keep manual image-quality backfills request-scoped and rerunnable.
- Surface the returned job id and queue errors in the dashboard card UI.
- Keep scheduled maintenance deduped by time bucket, but never use sticky completed-job IDs for manual repairs.

## Finding 126: Image-Quality Dashboard Card Did Not Surface Accepted Job Or Queue Failure

Severity: P1 for UI/UX trust and operator repair loops. After the image-quality backfill route started returning the accepted BullMQ job id, the embedded dashboard card still typed the trigger response as `{ ok, jobId }`, while the actual API response is `{ ok, data: { jobId, scope } }`. It also only refreshed coverage on `ok`, without showing a success job id or visible failure state. That means the API could be honest while the UI still hid the evidence a merchant/operator needs.

Evidence:
- `apps/shopify-app/app/routes/app._index.tsx` previously typed `ImageQualityCard` trigger as `useFetcher<{ ok: boolean; jobId?: string }>()`.
- The card rendered no success banner with the accepted job id.
- The card rendered no critical banner when the API returned `{ ok: false, error }`.
- This branch changes the fetcher type to match the real API response shape.
- The card now renders `Image re-score queued` with the accepted job id and scope.
- The card now renders `Could not queue image re-score` with the API error when queueing fails.
- `scripts/verify-tryon-image-resolution.mjs` now guards the dashboard response type and visible success/failure banners.

Impact:
- Operators could not tell whether a re-score was accepted by BullMQ, only that the button stopped loading.
- Queue failures could disappear from the visible workflow, preserving the feeling that "we clicked repair and nothing changed."
- This is the UI/UX half of the same recurrence: backend fixes are not enough when the dashboard does not expose execution truth.

Required fix:
- Keep dashboard repair cards typed to their actual API response shape.
- Show accepted job ids and failure messages for every repair/backfill action.
- Extend the same visible-status pattern to embeddings, catalog sync, and size-chart repair cards.

## Finding 127: Catalog Sync Actions Could Fall Back To A Fake Queued State

Severity: P1 for onboarding and repair trust. Catalog sync is the first dependency for product cards, image scoring, size-chart extraction, Brand DNA, embeddings, and recommendations. The merchant home route returned `job.id ?? "queued"` after attempting to enqueue a full sync, and both catalog entry points relied on uncaught queue errors bubbling out instead of returning the critical banner payload their UI already supported. That means a missing BullMQ job id could still display as a successful queued sync, and queue failures could skip the intended UX path.

Evidence:
- `apps/shopify-app/app/routes/app._index.tsx` previously returned `{ ok: true, jobId: job.id ?? "queued" }`.
- `apps/shopify-app/app/routes/app.catalog.tsx` called `enqueueCatalogSync()` without catching enqueue failure into the page's existing critical banner state.
- This branch changes both actions to fail closed when `job.id` is missing.
- Both actions now catch enqueue errors and return `{ ok: false, error: "catalog_sync_enqueue_failed" }` with HTTP 503.
- `scripts/verify-catalog-sync-repair-contract.mjs` guards the missing-id failure, enqueue failure payload, and visible success/failure banners.

Impact:
- A merchant could believe a full catalog repair was queued while no traceable BullMQ job id existed.
- Sync failure would be perceived as a broken page/error boundary rather than an actionable "could not queue sync" state.
- Since catalog sync fans out image-quality, size-chart, Brand DNA, and embeddings follow-ups, a false sync success can cascade into many "Mira is still wrong" symptoms.

Required fix:
- Treat a missing job id as queue failure, not as success.
- Keep catalog sync success banners tied to real accepted job ids.
- Keep catalog sync repair actions covered by a static verifier and eventually an integration test with Redis down/up.

## Finding 128: Embeddings Backfill Could Report Success When Semantic Search Was Unavailable

Severity: P1 for Mira product understanding and catalog search quality. Embeddings power Mira's fallback for queries like "something for a wedding" when exact product text is thin. The backfill helper returned `{ embedded: 0, skipped: 0 }` when `GEMINI_API_KEY` or the embedding provider was missing, and swallowed per-product embed failures without reporting them. The admin route then returned `ok: true`, and the dashboard card showed a normal "Last run" summary. That made vector search look backfilled while it was actually unavailable or partially failed.

Evidence:
- `apps/shopify-app/app/lib/embeddings.server.ts` previously used `tryGetService()` and returned `{ embedded: 0, skipped: 0 }` when no provider was configured.
- The same helper caught product-level embed errors and continued without counting failures.
- `apps/shopify-app/app/routes/api.admin.embeddings.backfill.tsx` returned `ok: true` for that silent zero-success result.
- This branch adds `providerConfigured`, `failed`, and `total` to `embedAllForShop()`.
- The admin route now returns HTTP 503 with `embedding_provider_not_configured` when embeddings cannot run, and HTTP 207 with `embedding_backfill_partial_failure` when product embeddings fail.
- The embedded dashboard search-index card now shows failed counts and a critical banner for missing-provider or partial-failure states.
- `scripts/verify-embeddings-backfill-contract.mjs` guards the helper, route, and dashboard UI contract.

Impact:
- Mira could keep relying on weaker ILIKE/catalog fallback search while ops believed semantic search had been backfilled.
- Brands would see generic or missed recommendations for natural-language intent even though the repair button appeared to run.
- This directly weakens the agentic sales engine: product understanding is less semantic, less occasion-aware, and less resilient to thin product titles/tags.

Required fix:
- Keep embeddings repair responses honest about provider availability and product-level failures.
- Surface failed counts and missing-provider instructions in the merchant UI.
- Add integration coverage for a missing `GEMINI_API_KEY` environment and one simulated per-product embed failure.

## Finding 129: Recommendation Runs Could Hide Generator And Write Failures

Severity: P1 for commerce-intelligence trust and agentic loop quality. The recommendation engine is the bridge between shopper demand, catalog/product understanding, fit drift, bundle performance, and what the merchant dashboard tells a brand to do next. Its core service deliberately swallowed generator failures and recommendation upsert failures, returning only `{ written }`. That made the system resilient, but also ambiguous: `written: 0` could mean "nothing actionable happened" or "every generator/write failed."

Evidence:
- `packages/core/src/recommendations/service.ts` previously caught each generator failure with an empty catch and ignored upsert errors with `.catch(() => undefined)`.
- Recommendation garbage collection also swallowed deletion failure, so cleanup issues could not be observed.
- `apps/shopify-app/app/routes/api.admin.recommendations.run.tsx` called `runAllRecommendations()` directly and returned `ok: true` for any resolved result, with no partial-failure status.
- This branch changes `runAll()` to return `written`, `attempted`, `failed`, `generatorFailures`, `writeFailures`, and `maintenanceFailures`.
- Individual generator, write, and maintenance failures are now preserved in the run result while the healthy parts of the engine can still continue.
- The manual admin run route now returns HTTP 207 with `recommendations_run_partial_failure` if any generator/write/maintenance failure occurred, and HTTP 500 JSON with `recommendations_run_failed` for unexpected crashes.
- The merchant home dashboard now includes a recommendation-engine refresh card wired to `/api/admin/recommendations/run`, with visible success, partial-failure, and failed states plus written/attempted/failed counts.
- The recommendations worker now throws `recommendations_partial_failure` when a nightly run has any generator/write/maintenance failures, so BullMQ retries it and queue health/observability can surface the problem instead of treating it as a clean completion.
- Admin observability queue stats now include `recentFailed` for the last six hours, matching the public health probe's failure window and making recommendation queue failures visible to operators.
- `packages/core/src/__tests__/recommendations.test.ts` now asserts the new run result shape, generator failure reporting, and write failure reporting.
- `scripts/verify-recommendations-run-contract.mjs` guards the service, route, dashboard UI, worker, admin observability, and tests, and is now part of `pnpm check:agentic-contracts`.

Impact:
- Merchants and operators could believe recommendations were refreshed while one or more source generators silently failed.
- A dashboard with no fresh recommendation cards could be misread as "no opportunity," when the real issue was failed reads/writes.
- This fed the broader recurrence pattern: backend logic looked fixed, but the execution result had no accountable status for UI/UX, ops, or test harnesses.

Required fix:
- Keep recommendation run results structured and visible.
- Keep the dashboard refresh/status UI and worker partial-failure behavior under the aggregate contract suite.
- Add an integration test with a simulated generator failure to prove BullMQ retry/failure visibility end to end.

## Finding 130: Full Catalog Sync Could Claim Downstream Extraction Work Without Accepted Jobs

Severity: P1 for product understanding, UI card reliability, and operator trust. Full catalog sync is the root of the extraction chain: products land, embeddings backfill, image-quality scoring chooses try-on/card imagery, size-chart extraction bridges measurements to variants, Brand DNA refreshes, and recommendation generation later consumes that evidence. The full-sync worker improved many individual stages, but still used silent fallbacks for several follow-up jobs. That meant "catalog sync completed" could be true while image-quality or size-chart extraction never queued for some or all products.

Evidence:
- `apps/worker/src/jobs/catalog-sync.ts` previously used `.catch(() => ({ embedded: 0, skipped: 0 }))` for worker-side embeddings, losing provider and failure truth.
- The same full-sync path enqueued image-quality scoring with `.catch(() => undefined)`.
- It fanned out size-chart extraction with per-product `.catch(() => undefined)` and then wrote `sizeChartsQueued: activeProducts.length`, even if some queue attempts failed.
- `apps/worker/src/embeddings.ts` previously returned only `{ embedded, skipped }`, returned silent zero success when `GEMINI_API_KEY` was missing, and swallowed per-product embed failures.
- This branch updates worker embeddings to return `embedded`, `skipped`, `failed`, `total`, and `providerConfigured`, matching the app/admin embeddings contract.
- Full catalog sync now records an `imageQuality` enqueue summary and a `sizeCharts` enqueue summary with `queued`, `failed`, `total`, and sample failures.
- Catalog sync notifications and logs now include `sizeChartsQueued: sizeCharts.queued` and `sizeChartsFailed: sizeCharts.failed`, not a hard-coded active-product count.
- `scripts/verify-catalog-sync-repair-contract.mjs` now guards the downstream enqueue summaries, honest size-chart counts, and worker-side embeddings result shape.

Impact:
- Merchants and operators could believe catalog repair completed while size recommendations still used defaults because extraction jobs never reached BullMQ.
- Mira cards and try-on could keep using stale or weak imagery because image scoring failed to enqueue after sync.
- Semantic product understanding could remain disabled or partially stale while the sync notification made the product pipeline look healthy.
- This is a direct UI/UX recurrence cause: backend extraction code can be fixed, but cards still behave inconsistently if the sync-to-extraction handoff silently drops work.

Required fix:
- Keep every catalog-sync downstream follow-up under an accepted/failed/total contract.
- Surface downstream partial failures in merchant/admin sync history, not only in notification payload JSON.
- Add a fixture-based integration harness that exercises full sync → embeddings → image scoring → size chart bridge → Brand DNA → recommendations against a tiny synthetic catalog.

## Finding 131: Product Extraction Chain Had No Single Cross-File Contract

Severity: P1 for UI/UX reliability and scalable product understanding. The codebase now has strong individual tests for catalog normalization, image scoring, size-chart bridging, Brand DNA input ordering, recommendations, and shopper serialization. The missing proof was a contract across those files. Without it, one layer could preserve source data while another dropped it, or one worker could write modern image-quality fields while the storefront serializer quietly fell back to older image order behavior.

Evidence:
- Catalog normalization preserves `descriptionHtml`, metafields, image `altText`, category, color, tags, variants, and Shopify image ids in `packages/core/src/catalog/normalize.ts`.
- Catalog sync persists product description HTML and image alt text, resets stale image-quality state when the Shopify image set changes, and now reports downstream enqueue truth in `packages/core/src/catalog/sync.ts` and `apps/worker/src/jobs/catalog-sync.ts`.
- Image-quality scoring consumes image alt text and writes `primaryTryonImageId`, `tryonReady`, `widgetTier`, `garmentRole`, and `preppedUrl` in `apps/worker/src/jobs/image-quality.ts`.
- Size-chart extraction reads description text plus image alt/role metadata and bridges extracted rows into `ProductVariant.measurementsJson` in `apps/worker/src/jobs/size-chart-extract.ts`.
- Brand DNA catalog extraction reads try-on-ready products first, uses scored primary/role/quality/alt-aware images, and passes product type, tags, description text, and image alt text into the extractor in `apps/worker/src/jobs/brand-dna-catalog.ts` and `packages/core/src/studio/brand-dna.ts`.
- Shopper product serialization uses the shared role/score-aware `resolveTryonImage()` helper and gates `tryonImageUrl` on `tryonReady` in `apps/shopify-app/app/lib/serialize.ts`.
- Recommendation catalog-gap generation uses `recommendationCatalogGapWhere()` so internal size-chart maintenance rows do not become merchant demand actions in `packages/core/src/recommendations/service.ts`.
- This branch adds `scripts/verify-catalog-extraction-chain.mjs`, which guards the cross-file extraction chain from Shopify source data through card-ready product serialization and recommendation demand filtering.
- This branch also adds `apps/shopify-app/app/lib/catalog-extraction-chain.test.ts`, an executable fixture that moves one synthetic Shopify product through `normalizeProduct`, `scoreProductImages`, `extractSizeChartMultiSource`, `recommendFit`, `orderBrandDnaImages`, and `toShopperProduct`.
- The fixture proves the shopper/card output uses the prepped front product image instead of the first-position size guide, and that a description-table size chart can become variant-level garment measurement evidence for fit.
- `package.json` now runs `check:catalog-extraction-chain` inside `pnpm check:agentic-contracts`.

Impact:
- Individual fixes could pass while the product card still showed the wrong image, Brand DNA learned from a size guide/detail crop, or fit recommendations missed extracted variant measurements.
- UI/UX symptoms like cards sometimes appearing, wrong product photos, weak try-on anchors, and generic Mira recommendations can come from handoff drift, not just a broken worker or prompt.
- This is the core "backend fixed but UI not fixed" pattern: unless the chain contract proves the storefront-facing serializer consumes the extraction outputs, backend improvements may never reach shoppers.

Required fix:
- Keep the cross-file extraction-chain verifier in the aggregate contract suite.
- Keep growing the executable fixture harness from pure-function proof toward worker-backed fake Prisma proof.
- Add browser proof that a product whose first image is a size guide still renders the front/prepped product image in Mira recommendation cards and try-on.

## Finding 132: Storefront Cards Could Still Render First Gallery Images After Backend Image Resolution Was Fixed

Severity: P1 for UI/UX trust, try-on quality, and the "backend fixed but UI still wrong" recurrence pattern. Backend serialization and worker image selection now resolve role/score/alt-aware product images, but the storefront widget still had card renderers and try-on surfaces reading `images[0]` directly. On a real Shopify store, initial hydration from `/products.json` also picked the first Shopify image. That meant a product whose first image was a size guide, swatch, or detail crop could still render incorrectly in Mira cards even after the backend pipeline selected the right primary image.

Evidence:
- `apps/shopify-app/app/lib/serialize.ts` already returns resolved `imageUrl` and `tryonImageUrl` via `resolveTryonImage()`.
- Pre-patch, `apps/web/app/components/mira/MiraWidget.tsx` rendered recommendation cards, look thumbnails, and context thumbnails from `p.images[0]`.
- Pre-patch, `apps/web/app/components/surfaces/TryOnPanel.tsx` used `images[0]` in render garment collection, step rendering, worn-look image display, and thumbnail backgrounds.
- Pre-patch, `hydrateMerchantCatalog()` filled `runtimeCatalog` from `/products.json`, which only exposes the storefront's gallery ordering and can put a size guide first.
- This branch adds resolved `cardImageUrl` and `tryonImageUrl` fields to the web `Product` type.
- `MiraWidget` now preserves app-proxy `imageUrl`/`tryonImageUrl` via `normalizeShopperProductPayload()` and immediately hydrates the current PDP product through `/apps/stylique/api/product` after storefront catalog hydration.
- `RecoCard`, `LookCard`, and `ContextCard` now render via `productCardImage()` instead of raw `images[0]`.
- `TryOnPanel` now uses `productVisualImage()` for garment images, render preview, worn-look image display, and thumbnail backgrounds.
- `scripts/verify-catalog-extraction-chain.mjs` now guards those UI paths so visible cards/try-on surfaces cannot drift back to raw `images[0]`.
- The Shopify storefront widget bundle was rebuilt and verified byte-identical after the UI fix.

Impact:
- Cards could "sometimes" show the right product and sometimes show a size chart/detail crop depending on whether the product came from backend brain response or client-side `/products.json` hydration.
- Try-on could start from stale/weak imagery even when `primaryTryonImageId` and `tryonImageUrl` were correct server-side.
- This directly explains the user's concern that backend fixes were not reaching UI/UX: the card presentation layer had its own image owner.

Required fix:
- Keep card and try-on render paths behind `productCardImage()` / `productVisualImage()` helpers.
- Add live storefront browser proof that a size-guide-first product displays the resolved front/prepped image in Mira reco/look cards and Try-On.
- Prefer app-proxy serialized products for any PDP-context hydration where product-specific UI truth matters.

## Finding 133: Storefront E2E Proved Card Presence But Not Card Image Truth

Severity: P1 for UI/UX regression prevention. Finding 132 fixed the source and render helpers, but the live storefront Playwright harness still accepted any visible card with either an `img` or a fallback tile. That meant a card could pass the browser test while still rendering a size-guide, measurement-table, swatch, detail crop, or stale first-gallery image. This is exactly how backend image fixes can appear "fixed" in tests while shoppers still see wrong visual cards.

Evidence:
- Pre-patch, `apps/web/scripts/storefront-e2e.spec.mjs` asserted card geometry and counted `img, [aria-label*="No product image"]`, but never inspected the image `src`.
- Pre-patch, `scripts/verify-storefront-e2e-contract.mjs` required visible recommendation/look card selectors and geometry, but not resolved-image assertions.
- `RecoCard` and `LookCard` now expose stable `data-stylique-card-image="resolved"` hooks on rendered images and `data-stylique-card-image-fallback` on intentional no-photo fallback tiles.
- `TryOnPanel` now exposes `data-stylique-tryon-garment-image` on resolved product-image and rendered try-on image surfaces.
- The live storefront E2E now reads resolved card and fitting-room image `currentSrc`/`src`, rejects size-guide/measurement/swatch/detail/crop URL patterns, and supports `SHOPIFY_TEST_EXPECTED_CARD_IMAGE_FRAGMENT` for a controlled size-guide-first Shopify fixture.
- `scripts/verify-storefront-e2e-contract.mjs` now fails if the browser harness drops resolved-image assertions or the forbidden-image pattern gate.
- `scripts/verify-catalog-extraction-chain.mjs` now fails if `TryOnPanel` drops the stable garment-image browser hook.
- The storefront widget bundle was rebuilt after adding the UI hooks, so Shopify extension and ScriptTag assets carry the browser contract.

Impact:
- The old browser harness could still pass while Mira visually looked broken, because "card appeared" was treated as equivalent to "card rendered the right product image."
- For merchants, that would show up as inconsistent product cards and low trust in try-on recommendations even after image scoring and serializer fixes were correct.
- This closes another UI/UX blind spot in the recurring backend/UI mismatch.

Required fix:
- Run live storefront E2E with a known product whose first Shopify image is a size guide and set `SHOPIFY_TEST_EXPECTED_CARD_IMAGE_FRAGMENT` to the expected resolved front/prepped image URL fragment.
- Keep resolved image/fallback data hooks in the widget bundle.
- Keep exact-image proof on both Mira recommendation/look cards and the Try-On sheet render path.

## Finding 134: Shopify Permission Health Still Trusted Stored Scope Metadata Instead Of Live Token Truth

Severity: P1 for install reliability, security, and "half works, half doesn't" debugging. Earlier passes centralized the required Shopify scopes and showed missing stored scopes in internal ops, but the active runtime still duplicated the scope literal in env parsing, the static verifier did not guard all env/docs copies, and internal brand detail treated stored `Shop.scopes` as the permission source of truth. Stored scope metadata is useful, but Shopify's live token grant can drift from it after reinstall, failed re-consent, or manual provisioning.

Evidence:
- Shopify's official access-scope guidance is least-privilege: apps should request only the access scopes needed for the app's function, and `currentAppInstallation.accessScopes` can report the live app installation grant.
- The current code paths need `read_products` for catalog sync/product reads, `read_inventory` for availability/size stock truth, `read_orders` for order attribution/webhooks, and `write_script_tags` for ScriptTag fallback auto-injection/self-heal. No active runtime path requires `write_products`, `read_product_listings`, `write_metafields`, `read_themes`, or `write_themes`.
- Pre-patch, `apps/shopify-app/app/env.server.ts` duplicated the comma-separated scope string instead of consuming the shared scope contract.
- Pre-patch, `scripts/verify-shopify-injection-contract.mjs` checked the shared module and TOML, but not `.env.local.example`, `.env.production.example`, `.env.staging.example`, Railway docs, or the env parser's default/banner.
- Pre-patch, internal ops showed stored token scopes and missing required scopes, but it did not flag extra stale granted scopes or query Shopify for the live token scope grant.
- `apps/shopify-app/app/lib/shopify-scopes.server.ts` now exports `REQUIRED_SHOPIFY_SCOPES_STRING`, `extraGrantedShopifyScopes()`, and `fetchLiveShopifyScopeCheck()`, which queries Shopify `currentAppInstallation.accessScopes`.
- `apps/shopify-app/app/env.server.ts` now consumes `REQUIRED_SHOPIFY_SCOPES_STRING` for runtime defaults and boot guidance.
- Internal brand detail now decrypts the stored token, performs a live Shopify scope check for installed shops, surfaces checked/skipped/failed status, and lists live missing/extra scopes in the UI and open issues.
- The Shopify injection verifier now guards active env examples, Railway/local/staging docs, runtime env parser usage, live-scope helper presence, internal detail live-scope wiring, UI visibility, and tests for drift/pending-install behavior.

Impact:
- A shop could have product read paths working while ScriptTag auto-injection or order attribution failed because the live token was under-scoped.
- A shop could keep stale extra scopes after a scope cleanup, violating least-privilege even though the app no longer uses those permissions.
- Operators could previously chase widget, catalog, or dashboard symptoms without a single panel proving whether the live Shopify grant actually matched the contract.

Required fix:
- Keep all active env/docs scope strings under `verify-shopify-injection-contract`.
- Treat missing or extra live token scopes as re-consent work before declaring an install healthy.
- Run a live Shopify install E2E that proves OAuth consent, `currentAppInstallation.accessScopes`, ScriptTag presence, `/widget.js` 200, and storefront heartbeat.

## Finding 135: Non-Cart Client And Bridge Events Could Still Carry Foreign Product Evidence

Severity: P1 for learning-loop integrity, recommendation quality, and security. Earlier fixes correctly canonicalized product evidence for cart-success events (`CART_FROM_TRYON`, `CART_FROM_WIDGET_STYLE`) before analytics stored them. But the shared product-evidence helper passed non-cart events through unchanged. Many non-cart events still influence Mira's intent model, product engagement, taste learning, recommendations, dashboards, and reports: `PRODUCT_VIEWED`, `PRODUCT_DWELL_LONG`, `CHAT_SIZE_CHART_VIEWED`, `SIZE_SELECTED`, proactive/behavioral trigger events, and bridge-emitted Mira lifecycle events. If any of those carried a forged or cross-shop `productId`/`productIds`, the event row itself was shop-scoped but the product evidence inside it was not.

Evidence:
- `EventPayloadSchemas` allow product evidence on many non-cart events: product views/dwell, size-chart viewed, proactive triggers, shopper-state events, outfit recommendations, try-on lifecycle, and cart assistance.
- Pre-patch, `validateShopProductEvidence()` returned non-cart events without querying `Product`, so supplied product evidence was trusted unless the event name was in the cart-success set.
- Storefront `/api/events` and bridge `/api/mira/event` both use the helper, so the same gap existed in both ingestion paths.
- This branch changes `validateShopProductEvidence()` to allow productless non-cart telemetry, but when any `productId` or `productIds` are supplied it validates them against `Product.shopId`, canonicalizes to shop-owned ids, and rejects events whose supplied product evidence has no current-shop match.
- Product-evidence tests now prove productless telemetry still passes, non-cart product evidence is canonicalized, and non-cart events with only foreign evidence are rejected.
- Storefront event tests and bridge tests now prove non-cart product evidence cannot be stored when it is not shop-owned.
- `scripts/verify-tryon-cart-learning.mjs` now guards this broader invariant, not just cart-success evidence.

Impact:
- A malicious or buggy client could have poisoned product-level learning without needing to forge purchase events.
- Product views, dwell, size help, proactive intent, and outfit-recommendation learning could have joined against products from the wrong shop or fake ids, making Mira's recommendations and merchant dashboards drift away from real shopper behavior.
- This is the same failure pattern the user flagged: backend analytics may look "working," while the learning loop is quietly learning from untrusted UI evidence.

Required fix:
- Keep all supplied product evidence behind the shared shop-owned canonicalization helper.
- Keep productless telemetry allowed only when the event truly does not need a product.
- Extend future event-ingestion tests whenever a new client/bridge event can carry product evidence.

## Finding 136: Internal Quota UI Divided All Usage By Try-On-Only Caps

Severity: P1 for quota trust, tier support, and "backend fixed but dashboard wrong" regressions. Runtime entitlement gates each metered feature by its own metric, but internal ops collapsed all current-month `UsageCounter` rows into `creditsBurnedThisMonth` and then calculated `quotaUsagePercent` using only `monthlyTryOnPersonal + monthlyTryOnBody`. As soon as a shop had stylist turns, style recommendations, fit recommendations, or old archival creative counters, the internal UI could show a high or maxed quota gauge even when every enforced meter still had room.

Evidence:
- Pre-patch, `apps/shopify-app/app/lib/internal-dashboard.server.ts` selected only `monthlyTryOnPersonal` and `monthlyTryOnBody` for the internal summary/detail quota percent.
- Pre-patch, the numerator summed every usage counter for the month, including `STYLIST_TURN`, `STYLE_RECOMMENDATION`, `FIT_RECOMMENDATION`, and residual removed creative metrics.
- Runtime enforcement in `entitlement.server.ts` still checked per-metric caps, so this was a UI/ops-truth drift rather than the main quota gate.
- This branch adds exported `internalQuotaUsagePercent()`, which includes finite caps for `TRYON_PERSONAL`, `TRYON_BODY`, `STYLE_RECOMMENDATION`, `FIT_RECOMMENDATION`, and `STYLIST_TURN`, and ignores unlimited or archival/ungated counters for the percentage.
- Internal summary/detail queries now select `monthlyStylistTurns`, `monthlyStyleRecs`, and `monthlyFitRecs` alongside try-on caps.
- `internal-dashboard.server.test.ts` proves the helper does not let large `CREATIVE_GENERATED` archival counters distort the gauge and does not treat unlimited meters as over-quota.
- `scripts/verify-dashboard-fashion-intelligence-truth.mjs` now guards the helper, all quota metrics, and the absence of try-on-only monthly-cap math.

Impact:
- Ops could incorrectly tell a merchant they were near quota or over quota even when the real enforcement path would allow the action.
- Support could chase billing/tier bugs that were actually dashboard math bugs.
- This is another concrete example of why repeated fixes felt ineffective: backend enforcement and visible UI truth were not using the same metric boundaries.

Required fix:
- Keep quota enforcement, billing reports, merchant dashboard usage cards, and internal ops quota summaries metric-specific.
- Add a browser-level internal dashboard fixture later that renders mixed usage counters and verifies the visible quota gauge/copy.
- Decide whether `creditsBurnedThisMonth` should remain a raw activity count or become a cost-weighted value; do not use it as a quota percentage numerator unless the denominator is equally weighted.

## Finding 137: Prisma Runtime Boundary Drift Made Typecheck Failures Look Like Product Bugs

Severity: P1 for engineering trust and regression detection. The full Shopify app typecheck was failing with dozens of `unknown`, `{}`, and implicit-any errors across billing, dashboards, Fashion Intelligence, insights, Mira adapter, network, product evidence, routes, and scripts. Those files did not all suddenly lose their contracts. The root cause was lower in the stack: the workspace had Prisma client resolution drift, so downstream packages could lose generated model types or hit a broken direct `@prisma/client` runtime shell while the shared `@stylique/db` facade still worked in its own package context.

Evidence:
- Pre-patch verification showed `pnpm --filter @stylique/shopify-app typecheck` failing broadly across unrelated files with Prisma result shapes inferred as `{}`/`unknown`.
- `pnpm install` repaired the workspace install/type resolution enough for `pnpm typecheck` to pass across all 9 packages, proving the earlier broad failure was dependency/generated-client drift rather than each listed module being logically broken.
- Direct `@prisma/client` imports still bypassed the runtime-safe `@stylique/db` facade in `apps/worker/src/jobs/fit-tuner.ts`, `packages/core/src/reports/monthly.ts`, and `apps/web/scripts/pilot-measure.mjs`.
- This branch routes those imports through `@stylique/db`, leaving direct Prisma import ownership centralized in `packages/db/src/index.ts`.
- This branch adds `scripts/verify-prisma-runtime-contract.mjs`, which checks the Prisma package runtime in the DB package context, checks the `@stylique/db` facade from the Shopify app context, and blocks known drift files from importing `@prisma/client` directly.
- `pnpm check:agentic-contracts` now includes `pnpm check:prisma-runtime`.

Impact:
- Engineers could waste time fixing phantom type errors in business modules while the real issue was generated-client/install state.
- A script or worker path that imported `@prisma/client` directly could fail differently from the app path that used `@stylique/db`, creating another "half works, half doesn't" situation.
- Product audits become less reliable when the type system is noisy; real regressions hide among infrastructure-generated errors.

Required fix:
- Keep all app/worker/web/core code importing Prisma through `@stylique/db`; only the DB package may own direct `@prisma/client` runtime behavior.
- Run `pnpm db:generate`, `pnpm typecheck`, and `pnpm check:prisma-runtime` after dependency install changes.
- Consider adding a CI bootstrap step that fails fast if generated Prisma client artifacts are missing before running product-level tests.

## Finding 138: Async Try-On Worker Could Double-Count Quota On Late Duplicate Completions

Severity: P1 for billing trust, quota accuracy, and intermittent try-on bugs. The storefront/app path now preflights body/personal try-on quota before rendering, but async rendering happens in the worker. The worker is wrapped by a 90-second `Promise.race` timeout, and the underlying provider call is not cancelled when that timeout rejects. A timed-out attempt can therefore keep running while BullMQ marks the job failed or another attempt/path works on the same `renderId`. Before this pass, every successful worker completion unconditionally updated the render row and incremented `UsageCounter`, so a late duplicate success could double-count quota/provider work for one shopper-visible render.

Evidence:
- `apps/worker/src/index.ts` wraps `processTryOnRender(job.data)` in `Promise.race(... tryon_render_timeout_90s ...)`, but `processTryOnRender()` continues in the background if the timeout wins.
- Pre-patch, `apps/worker/src/jobs/tryon-render.ts` used `tryOnSession.update({ where: { id: renderId }, data: { status: "SUCCEEDED" ... } })` followed by unconditional `usageCounter.upsert(... increment: 1 ...)`.
- Pre-patch, worker failure paths also used plain `update`, so a failed late attempt could overwrite a row that another attempt had already completed.
- This branch changes the worker success write to `updateMany({ where: { id: renderId, status: { not: "SUCCEEDED" } } ... })` and returns before quota increment when `finalUpdate.count === 0`.
- Worker failure and fallback-provider audit writes now also guard with `status: { not: "SUCCEEDED" }`, so failed/late attempts cannot downgrade a completed render.
- `scripts/verify-tryon-quota-contract.mjs` now checks the worker timeout shape, idempotent success transition, no usage-counter write after a lost duplicate completion, and no failure overwrite of a succeeded render.

Impact:
- A merchant could see quota usage increase twice for one actual shopper render, especially under slow provider responses.
- Ops could chase quota/billing complaints even though the app-side preflight looked correct.
- Shopper UI could show confusing render status if a failed late attempt overwrote a successful result.
- This is another app/worker split: one path was fixed, but the async backend still had its own final-state semantics.

Required fix:
- Keep try-on worker finalization idempotent by `renderId` and successful status.
- Add a future integration test with two concurrent `processTryOnRender()` calls for the same `renderId`, proving only one usage increment and one successful finalization.
- Prefer cancellable provider calls or BullMQ job-level timeout semantics that do not leave orphaned work running after a timeout.

## Finding 139: Merchant Usage Surfaces Hid Mira Turn Meters And Could Read Stale Try-On Quota

Severity: P1 for tier trust, billing clarity, and merchant UI/UX. Entitlement enforcement meters six active usage families: personal try-on, body-model try-on, style recommendations, fit recommendations, Mira vision turns, and Mira stylist turns. The billing-status API already exposed all six, but two visible/support surfaces drifted: the embedded merchant dashboard overview only returned the four widget meters, and internal `/api/usage` totals omitted `STYLIST_TURN`. Separately, try-on settings labelled the latest personal-photo counter row as "this month" instead of filtering to the current billing period.

Evidence:
- `apps/shopify-app/app/lib/entitlement.server.ts` enforces `VISION_TURN` and `STYLIST_TURN` alongside try-on/style/fit meters.
- Pre-patch, `apps/shopify-app/app/lib/dashboard.server.ts` built `plan.usage` with only `TRYON_PERSONAL`, `TRYON_BODY`, `STYLE_RECOMMENDATION`, and `FIT_RECOMMENDATION`, so Mira turn usage could be enforced but absent from merchant overview data.
- Pre-patch, `apps/shopify-app/app/routes/api.usage.tsx` totalled `VISION_TURN` but not `STYLIST_TURN`, so internal ops could miss the main chat meter in aggregate quota monitoring.
- Pre-patch, `apps/shopify-app/app/routes/app.settings.tryon.tsx` selected the latest `TRYON_PERSONAL` counter by `periodStart desc` while rendering "this month"; a stale or future row could be shown as current usage.
- This branch adds `VISION_TURN` and `STYLIST_TURN` to merchant dashboard `plan.usage`, adds `STYLIST_TURN` to internal usage totals, and filters try-on settings quota by `currentPeriodStart()`.
- This branch adds `scripts/verify-billing-usage-contract.mjs`, which checks billing status, merchant dashboard usage, internal usage totals, and try-on settings period semantics against the enforced meter set.
- `pnpm check:agentic-contracts` now includes `pnpm check:billing-usage`.

Impact:
- A merchant could hit a Mira stylist-turn limit while the dashboard usage shape never showed that meter.
- Internal operators could underestimate total chat-meter burn when investigating tier or support issues.
- Try-on settings could display old usage as current-period quota, creating exactly the kind of UI/back-end mismatch that makes fixes feel inconsistent.

Required fix:
- Keep merchant-visible and internal usage surfaces aligned to the same enforced meter set.
- Render the expanded `plan.usage` meters in the merchant UI where space allows, rather than only returning them in JSON.
- Add a browser/dashboard fixture for a shop with non-zero `STYLIST_TURN`, `VISION_TURN`, and stale prior-period try-on usage.

## Finding 140: Merchant Dashboard Returned Correct Usage Data But Did Not Render It

Severity: P1 for UI/UX trust and billing self-serve. Finding 139 fixed the server/API usage shape so all enforced meters were returned, but the embedded Shopify merchant dashboard still never rendered `d.plan.usage`. That meant quota truth was technically available in JSON, yet invisible to the brand using the product. This is the exact backend/UI split behind the repeated "we fixed it but it still feels broken" pattern.

Evidence:
- Pre-patch, `apps/shopify-app/app/routes/app.dashboard.tsx` rendered revenue, engagement, Fashion Intelligence, reorder intelligence, and top looks, but did not read `d.plan.usage`.
- Pre-patch, the route had no visible plan usage section, so merchants could not see personal try-ons, body-model try-ons, style recommendations, fit recommendations, Mira vision turns, or Mira chat turns in one place.
- This branch adds a visible "Plan usage" dashboard card using `USAGE_METERS` for all six enforced meters.
- The usage panel labels the current billing period and explains that unlimited meters still show activity without being treated as caps.
- `scripts/verify-billing-usage-contract.mjs` now checks that the embedded dashboard renders a visible usage panel and includes every enforced meter, not just that the server returns usage JSON.

Impact:
- A merchant could hit a limit and still have no visible dashboard explanation for which meter was used.
- Support and ops would need to inspect APIs or internal tools instead of letting the merchant self-diagnose.
- This is the UI/UX half of quota correctness: enforcement, API truth, and visible brand dashboard now agree.

Required fix:
- Add browser-level dashboard fixtures proving the usage card is visible and readable on desktop and mobile.
- Keep `USAGE_METERS` aligned with entitlement/billing meter lists.
- Eventually add upgrade/action links per exhausted meter so limits lead to conversion or ops support rather than confusion.

## What Is Actually Fixed In The Closeout Commit

- Browser flows 1-5 passed in the previous closeout.
- Brain and Shopify app now share `@stylique/mira-brain` for decisions.
- Client regex fallback is fenced to a non-commercial retry line.
- Product URL segment is runtime-aware.
- Unknown categories no longer silently become tops.
- Category recommendations now fill multiple cards when same-slot inventory is scarce.
- Cart state and conversion tracking wait for add success.
- Objective state now loops back into the brain.
- The live storefront bundle is rebuilt from Mira source and verified against the theme asset during Shopify app image creation.
- The nightly fit/look tuner now learns from the same canonical cart-assist event family as reports, dashboards, cohorts, and order attribution.
- Product webhook sync now deletes inactive products and prunes removed variants instead of leaving stale catalog truth for Mira.
- Widget injection now fails closed without `SHOPIFY_APP_URL`, removes legacy duplicate tags, and surfaces Shopify create errors.
- Billing enforcement now recognizes the checkout-confirmed subscription shape, and billing state updates preserve Mira/merchant configuration instead of overwriting it.
- The Shopify app now fails before accepting traffic if the DB is missing Mira objective-memory columns, and the new migration is idempotent for db-push history.
- Root-level Dockerfiles no longer bypass widget verification or the custom Shopify Express server path.
- Cart adds now fail honestly when the requested size is sold out instead of silently adding a different size.
- Combo add-all intent and confirmed style-cart success are now separate events; style-cart metrics post only after browser cart success.
- Cart analytics are now split into intent, confirmed cart success, and attribution-union families; monthly add-to-bag reports no longer count CTA intent as cart success, and try-on cart success can feed assisted-revenue attribution.
- The demo-to-production event bridge now fails closed without its production secret and cannot emit high-trust events outside its bridge allowlist.
- Shopify app startup and readiness now share the same production env contract, including bridge, encryption, platform JWT, storage, and VTO provider requirements.
- Worker startup now fails fast in production when encrypted-token, try-on storage, or try-on provider env required by its jobs is missing.
- Production readiness now rejects `USE_IN_PROCESS_BRAIN=0`, so Mira cannot silently revert to the legacy cross-service demo/web brain path.
- Proactive Mira UI is now tier-gated by storefront entitlement, reruns per route, emits behavioral fired/suppressed telemetry, tracks size-chart/product-view/dwell signals, and ships in the verified widget bundle.
- Live try-on and prewarm jobs now consume the scored `primaryTryonImageId` instead of blindly using the first Shopify image.
- Product image alt text now persists from Shopify into `ProductImage` and is passed to size-chart image OCR, so alt-labeled size-guide images can be extracted.
- Full-look memory is now driven by hydrated/rendered merchant products instead of demo-only handles, including dynamic product-name voice matching, so real storefront bundle intent can resolve real product bundles.
- Billing status now reads the same active-subscription/ops-comp contract as entitlement enforcement instead of treating any plan row as active.
- Internal ops can now provision a pending merchant with tier intent and optional comp access without pretending Shopify OAuth or billing is already complete.
- Brand DNA catalog extraction now preserves fabrics, seasonality, and price positioning returned by vision instead of replacing them with defaults.
- Production Mira now reads the current Brand DNA JSON shape (`paletteJson.hex`, `toneJson.moodAdjectives`, fabrics, seasonality, positioning) instead of legacy-only keys.
- Core complete-the-look styling now understands widget/real-store category aliases like `top`, `bottom`, `knitwear`, and `footwear`.
- Fashion Intelligence now separates fit-recommendation submissions from actual selected-size events, so dashboard copy no longer claims shopper choice drift from recommendation-only telemetry.
- Closed-state Mira nudges are now outlier-gated by repeated same-category browsing instead of firing on ordinary product navigation, and the rebuilt storefront bundle carries that UI fix.
- The try-on UI now emits `SIZE_SELECTED` on explicit size changes and successful selected-size cart adds, and the Shopify event endpoint accepts that safe client event.
- Production Fashion Intelligence bundle and compatibility cards now use measured combo pairs or the merchant's own catalog, not fixed demo product names.
- The production adapter fallback look builder now ranks merchant catalog candidates by slot, color, price, and season instead of taking the first item in each category.
- Feature upgrade hints now derive from the same `PLAN_FEATURES` table as runtime enforcement, so proactive Mira is labelled as Growth instead of incorrectly requiring Ultimate.
- Shopify runtime scopes, env examples, and deploy docs now agree on the required auto-injection contract, and startup validation fails fast if `write_script_tags` or other required scopes are missing.
- Internal ops now surfaces stored Shopify token scopes and missing required permissions, so under-scoped installs are visible instead of masquerading as random sync/injection/attribution failures.
- Image-quality scoring now consumes Shopify alt text, rejects size-guide/detail/swatch hints earlier, and product sync clears stale try-on readiness when images are replaced.
- Super-admin enterprise onboarding now supports pending pre-install merchants, explicit tier selection, ops-comp/manual-contract activation, and quota defaults from the shared plan tables.
- Catalog sync no longer wipes unchanged product image state, and follow-up image-quality/size-chart jobs use time-bucketed ids so recurring syncs can actually repair stale products again.
- Worker queue documentation now matches the real active jobs and schedules instead of removed creative-era queues.
- The storefront widget and fitting room now expose stable `data-stylique-*` browser contracts, and bundle verification fails if those UI/UX test hooks disappear.
- Proactive intent nudges now use structured trigger confidence/time/product arbitration instead of a single stale session boolean, unknown categories no longer qualify for same-category comparison, and suppressed trigger telemetry accepts `triggerType`.
- Production Fashion Intelligence no longer ships fixed demo-like collection, trend, drop-off, fit, and growth claims; those sections now derive from the merchant's products, demand text, and observed funnel/cart events or remain empty/zero until enough evidence exists.
- The live Shopify storefront E2E harness now fails when `SHOPIFY_TEST_STORE_URL` is missing instead of silently exiting green without proving the injected widget/cart/browser path.
- Shopify theme app embed settings now pass proxy base and theme config into the widget runtime; accent color, PDP CTA label, and inline try-on enablement affect the actual storefront bundle, and bundle verification protects those hooks.
- Internal ops provision and tier-change actions now write the same quota defaults, analytics level, comp/billing metadata, and provisioning contract as the super-admin enterprise path instead of updating only `Plan.tier`.
- Internal ops index and jobs mutations now require CSRF tokens, matching the existing brand-detail protection for cookie-authenticated destructive actions.
- Brand DNA catalog extraction now receives product type, tags, sanitized description text, image alt text, prepped URLs, and the scored primary try-on image instead of relying on first-position image URLs and thin title/category/color metadata.
- Manual size-chart backfills are now actually rerunnable per request, report accepted jobs, and coverage counts only real non-null chart JSON.
- Size-chart image OCR now looks deeper into ordered Shopify galleries and prioritizes explicit size-chart alt/url metadata before generic detail images, with a regression test for this gallery-order failure.
- Recommendation cards now render a premium no-photo fallback tile instead of unconditionally rendering `p.images[0]`; recommendation/look card selectors are now present in the verified storefront bundle.
- Merchant-facing catalog-gap widgets now share one real-shopper-demand filter, excluding internal size-chart maintenance rows from top gaps, headline gap counts, and Growth+ reorder intelligence.
- Internal ops brand detail now excludes internal size-chart maintenance rows from top catalog gaps.
- Mira-engaged CSV exports now split confirmed cart success (`hadCart`) from pre-cart intent (`hadCartIntent`) while still using all Mira cart-assist events for cohort inclusion.
- Fashion Intelligence live/modelled thresholds now exclude internal size-chart maintenance rows instead of counting them as shopper demand.
- The outcome learning loop now excludes internal size-chart maintenance rows before judging whether catalog-gap recommendations worked.
- Shopify required-scope checks are now centralized for startup validation and internal ops health, instead of duplicated in two hard-coded arrays.
- Recency-weighted hot catalog-gap intensity now excludes internal size-chart maintenance rows before ranking shopper demand.
- A catalog-gap predicate verifier now blocks new non-test read paths from bypassing the real-demand filter helpers.
- Network benchmark snapshots now count distinct confirmed orders instead of raw `CART_CONFIRMED` line-item rows for conversion rates.
- The nightly fit/look tuner now computes `cartConvertRate30d` from distinct confirmed orders instead of raw `CART_CONFIRMED` line-item rows.
- Outcome snapshots, dashboard headline/funnel, Starter insights conversion, and Fashion Intelligence broad conversion denominators now use distinct confirmed orders instead of raw `CART_CONFIRMED` line-item counts.
- A cart-confirmed metric verifier now blocks ambiguous raw `CART_CONFIRMED` counts unless the code declares explicit order/product/line semantics.
- The demo-to-production event bridge now accepts proactive/behavioral trigger telemetry, matching the storefront client endpoint and shared event schema.
- A client-event allowlist verifier now blocks widget-emitted event names from drifting away from Shopify client/bridge acceptance.
- Brand DNA catalog extraction now uses scored image-quality metadata to avoid learning from first-position size guides, swatches, or detail crops when a better product image exists.
- Live try-on and prewarm jobs now use a shared role/score/alt-aware garment image resolver instead of raw first-gallery-image fallbacks.
- A try-on image verifier now blocks worker/app render paths from reintroducing raw `images[0]` fallbacks.
- Production Mira card hydration now uses the same role/score/alt-aware resolver before ordering client product images, so UI cards and card-led try-on no longer inherit Shopify gallery order.
- The try-on image verifier now catches multi-line `primaryTryonImageId ?? images[0]` fallbacks in adapter/server code.
- Proactive Mira now treats repeated product-media/zoom/gallery inspection as an intent signal, emits the same behavioral telemetry, and the rebuilt Shopify widget bundle carries the UI change.
- Route-local proactive suppression no longer lets one non-open suppressed trigger consume all later stronger triggers on that PDP route.
- Live Shopify fit recommendations now consume `ProductVariant.measurementsJson` before falling back to `Product.sizeChartJson`, so multi-source extraction and row-to-variant bridging reach the shopper.
- A fit measurement bridge verifier now blocks the live fit API from dropping variant-level extracted measurements again.
- Shopper product/style API serialization now resolves public `imageUrl` and `tryonImageUrl` with the same role/score/alt-aware image contract, instead of first-gallery-image truth.
- Combo try-on now rejects unsupported personal-photo combos and preflights enough body-render quota for every requested layer before starting provider work.
- A try-on quota contract verifier now guards combo mode and whole-action quota preflight.
- Root-cause verifiers now run through `pnpm check:agentic-contracts`, including the verified storefront widget bundle contract, and a GitHub workflow runs those guards plus focused Shopify/core contract tests on PRs and main pushes.
- Embedded dashboard Fashion Intelligence now labels live consumer rows as shopper + catalog blends, marks catalog fallback combos as catalog pairings instead of live asks, and ships a dashboard-truth verifier in the aggregate agentic contracts.
- Size-chart extraction now refreshes bridge-owned variant measurements instead of freezing the first bridge forever, while preserving explicit non-bridge SKU measurements and clearing stale bridge-owned rows.
- Initial Shopify ScriptTag injection now throws on Shopify userErrors, matching the daily self-heal worker instead of treating a rejected widget create as a successful install.
- Live storefront E2E now asserts Mira renders visible recommendation/look cards after a styling prompt, and a storefront E2E contract verifier prevents the browser harness from shrinking back to cart-only smoke coverage.
- Proactive Mira now exposes a stable `data-stylique-nudge` selector, the rebuilt Shopify widget bundle carries it, and the live storefront E2E contract covers product-media intent nudge plus proactive telemetry.
- Enterprise onboarding now tells ops that blank quota fields use the selected tier default, not unlimited, and a contract verifier protects pending-install, ops-comp, and shared plan-table quota behavior.
- Core style pairing now normalizes merchant category aliases like blouse, pants, heels, bags, and saree before selecting outfit roles and before combo scoring, with a contract verifier guarding the scalable taxonomy behavior.
- Core now exports a shared product-slot classifier consumed by the Shopify Mira adapter and Fashion Intelligence, and the adapter fills top+bottom looks with footwear/accessory finishers instead of stopping at two pieces.
- Try-on bundle cart success now emits anchor plus companion `productIds` in `CART_FROM_TRYON`, the shared event schema accepts it, and a new try-on cart-learning verifier runs inside `pnpm check:agentic-contracts`.
- Storefront `/api/events` ingestion now validates client cart-success product evidence against the current shop and stores only canonical shop-owned ids before attribution or learning can consume it.
- The `/api/mira/event` bridge now applies the same shop-owned product-evidence validation for `CART_FROM_TRYON`, closing the second cart-success ingestion path.
- Shop-owned product-evidence canonicalization now lives in one shared Shopify-app helper used by both storefront and bridge ingestion, with route tests plus a helper test guarding the invariant.
- Fashion Intelligence dashboard copy now labels conversion values as cart/order proxy evidence rather than purchase-rate or causal-lift proof, and the dashboard-truth verifier blocks those overclaims from returning.
- Catalog sync now refreshes Brand DNA after full sync, product webhook sync, and product deletion, with a six-hour dedupe bucket and an aggregate contract verifier.
- Brand DNA refresh status is now honest: manual refresh and catalog sync mark the Shopify BrandSource pending/failed based on actual queue acceptance, and catalog sync reports real `brandDnaQueued` state instead of a hard-coded success.
- Instagram archive and campaign DNA uploads now surface enqueue failures, mark the `INSTAGRAM` BrandSource failed when queue acceptance fails, and the Brand Instagram worker marks missing BrandProfile as failed instead of leaving processing ambiguous.
- Manual size-chart backfill now reports accepted, failed, and total enqueue counts, returning partial/total failure statuses instead of `ok: true` when product extraction jobs fail to enqueue.
- Manual image-quality backfill now uses request-scoped job IDs and returns the accepted BullMQ job id, so re-score actions after image fixes cannot be deduped against old completed jobs.
- The embedded dashboard image-quality repair card now shows the accepted re-score job id and visible queue failure state, with a verifier guarding the UI/API response contract.
- Catalog sync actions now fail closed when BullMQ does not return a job id or enqueue fails, and both merchant catalog entry points keep their visible success/failure banners under verifier coverage.
- Embeddings backfill now reports provider availability, failed product count, and total products; the route returns 503/207 for missing provider or partial failure, and the dashboard search-index card surfaces those states.
- Brand taste aggregation and network benchmark snapshots now require non-null `tasteVectorJson` with `Prisma.AnyNull`, and benchmark try-on volume now uses real `TryOnSession` rows.
- Successful Mira and try-on cart events now preserve selected size evidence in their analytics payloads, and the verified storefront bundle carries that fix.
- Try-on panel size/style modules now honor merchant theme flags in the visible UI, loading copy, cart footer, render actions, and generated Shopify bundle.
- Storefront cart variant resolution now handles common Shopify size aliases and single default variants, with a 14-case cart verifier proving real `/cart/add.js` behavior and failure honesty.
- The normal PDP Add to Bag button now uses the same real cart helper as Mira/Try-On instead of showing a local fake success toast.
- Sparse Fashion Intelligence no longer describes catalog-modelled fit watchlists and pairings as measured shopper behavior.
- Legacy tiered insights now exclude internal size-chart maintenance rows from merchant demand and network trend calculations.
- Ultimate customer segments now derive VIP/high-engagement/single-purchase buckets from confirmed cart evidence instead of signal-count or account-claim proxies alone.
- Core recommendations and monthly reports now exclude internal size-chart maintenance rows from catalog-demand actions and revenue-at-risk reporting.
- Monthly reports now group `CART_CONFIRMED` line rows by order id before calculating confirmed orders, AOV, baseline, and revenue-at-risk.
- Recommendation generation now reports attempted, written, generator-failed, write-failed, and maintenance-failed counts instead of collapsing every resolved run into `{ written }`; the manual run route, merchant dashboard card, worker partial-failure behavior, admin observability, and aggregate agentic contracts all preserve that execution truth.
- Full catalog sync now reports downstream extraction follow-up truth: worker embeddings expose provider/failure counts, image-quality and size-chart enqueue attempts report accepted/failed/total counts, and sync notifications/logs no longer claim every size-chart job was queued when BullMQ rejected some work.
- A catalog extraction-chain contract now guards the handoffs from Shopify product source data through image scoring, size-chart variant bridging, Brand DNA inputs, card-ready serialization, and real-demand recommendations; it also includes an executable synthetic-product fixture proving the pure-function path reaches card-ready imagery and fit evidence.
- Storefront Mira cards and Try-On now consume resolved card/try-on image fields instead of raw first-gallery images, and current PDP hydration now overlays `/apps/stylique/api/product` serializer truth on top of Shopify `/products.json` gallery order.
- Live storefront card and Try-On E2E now check resolved/rendered image URLs, reject size-guide/swatch/detail/crop image patterns, support exact expected-image fragments for controlled fixtures, and the rebuilt Shopify widget bundle exposes stable resolved-image/fallback hooks.
- Shopify scope truth now has one runtime string, active env/docs drift guards, extra-stale-scope detection, and internal brand detail live-checks Shopify `currentAppInstallation.accessScopes` before treating permissions as healthy.
- Storefront and bridge analytics now validate any supplied product evidence against the current shop, not only cart-success events, preventing fake or cross-shop product ids from polluting Mira's learning loop.
- Internal ops quota percent now uses the same metric boundaries as entitlement enforcement, including style, fit, and Mira turn caps while ignoring unlimited/archival counters, so quota UI no longer divides all activity by try-on-only limits.
- Prisma runtime ownership is now centralized behind `@stylique/db` for worker/core/web paths, a runtime verifier guards the facade from DB and Shopify app contexts, and full workspace typecheck is green again.
- Async try-on worker finalization is now idempotent by render row status, so late duplicate completions cannot double-count quota or let failure writes overwrite a successful render.
- Merchant dashboard usage data, internal usage totals, and try-on settings quota reads now expose the same active meters and current-period semantics as entitlement enforcement, with a billing-usage verifier in the aggregate contract suite.
- The embedded merchant dashboard now visibly renders all enforced plan usage meters with current-period and unlimited-meter copy, and the billing-usage verifier guards the visible UI surface.

## Why Fixes Kept Coming Back

The repeated failure was not developer incompetence; it was architectural overlap:

1. The LLM prompt tried to control behavior.
2. Deterministic policy tried to correct the prompt.
3. The widget reinterpreted corrected decisions.
4. The Shopify adapter projected corrected decisions again.
5. Analytics counted each surface through different names.
6. Demo intelligence and production intelligence were not one measured source.

Until each business invariant has one owner and one contract test, fixes will keep landing as local symptom patches.

## Next Audit Pass

The next pass should review:

- `apps/web/app/lib/storefront-cart.ts` and Shopify cart helper truth.
- Remaining storefront injection edge cases beyond bundle freshness.
- Dashboard pages that present learning-loop and commerce-intelligence claims.
- Prisma schema and migrations for shopper/session/analytics/catalog-gap persistence.
- Worker jobs that sync catalog, image quality, brand DNA, and fit tuning.
- Tests/harnesses to see which requirements are covered versus only smoke-tested.
