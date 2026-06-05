# Stylique — Production Readiness Audit
_Date: 2026-06-05 · Method: direct code inspection across the monorepo + live API buyer simulations (24-buyer Mira panel complete; 2 of 100 demographic journeys complete; live try-on render tests viewed)._

> Honesty note: this audit is grounded in first-hand reading of the actual code this session, not "TypeScript passes." Where a component was not fully traced, it is scored conservatively and flagged **(needs verification)** rather than assumed working.

---

## 1. Executive Verdict

**PILOT-BLOCKED — strong internal demo, NOT production-ready.**

Stylique is **architecturally promising with a genuinely working demo**, but the **live storefront path runs on the demo backend**, so the things that make it a *business* — real per-merchant catalog, real cart, the learning loop, multi-tenancy, and scale — are built in the real backend but **not wired to the shopper surface**. It demos beautifully on one curated catalog; it cannot yet run a real pilot store end-to-end, and it does not scale on the current live path.

The single root cause behind most P0s is one architectural fact:

> **The storefront widget (`apps/widget/src/mira-demo.tsx`) hardcodes `ORIGIN = stylique-web` (the demo backend, 14 hardcoded products) and never calls the App Proxy.** The real Shopify backend (`apps/shopify-app`, `proxy.shopper.$.tsx`, `brain.server.ts`, Prisma catalog, BullMQ workers, S3, per-shop tenancy) exists but is disconnected from the shopper.

---

## 2. System Scorecard

| # | Component | Score /5 | Status | Main Problem | Blocker? |
|---|-----------|---------:|--------|--------------|----------|
| 1 | Shopify App (install/oauth) | 4 | Works | Webhook auto-sync proven; minor hardening needed | No |
| 2 | Storefront Widget | 3 | Works but disconnected | Loads & injects fine, but points at demo backend | **P0** |
| 3 | Mira (chat brain) | 3 | Works, weak core | On Gemini Pro; strong closer (0.84) but uses **demo catalog** on storefront; honesty/sizing/nav gaps (partly fixed this session) | **P0** |
| 4 | Try-On render | 4 (demo) / 2 (scale) | Works, won't scale | Renders correctly; cache is **ephemeral**, synchronous, single-service | **P0 at scale** |
| 5 | Size Recommendation | 3 | Real engine, thin data | Works with real measurements; storefront lacks synced charts (fallback added) | P1 |
| 6 | Style Recommendation | 4 | Real | Color theory + conversion math ported to `packages/core` | No |
| 7 | Outfit Completion | 4 | Real | Slot-diverse `completeLookFor`; needs accessories/bags | P2 |
| 8 | Cart / Add-to-Cart | 1 | **Fake on storefront** | No `/cart/add.js`; no real variant IDs → no real conversion | **P0** |
| 9 | Catalog Sync | 4 | Works | Auto-sync via webhooks + worker proven live | No |
| 10 | Brand DNA | 2 | Partial **(needs verification)** | Exists; unclear if it influences Mira/creative | P1 |
| 11 | Creative Engine | 2 | Partial **(needs verification)** | `packages/core/imagery` present; real generation path unconfirmed | P1 |
| 12 | Creative Studio | 2 | Partial **(needs verification)** | UI exists; approve/regenerate/export wiring unconfirmed | P1 |
| 13 | Merchant Dashboard | 3 | Partial | Stack B routes exist; real-data coverage uneven | P1 |
| 14 | Super Admin Dashboard | 2 | Partial **(needs verification)** | Health/jobs/usage monitoring unconfirmed | P1 |
| 15 | Worker Infrastructure | 4 | Works | BullMQ jobs run (sync, render, install, size-extract) | No |
| 16 | Event System | 3 | Works but split | Emit fns exist; persist in Stack B; storefront path partly no-op | **P0** |
| 17 | Outcome Intelligence | 2 | Not closed from storefront | Loop exists in Stack B; storefront never feeds it | **P0** |
| 18 | Recommendation Engine | 4 | Real | Genuine HSL color theory + conversion math + fit | No |
| 19 | Shopper Memory | 3 | Split | sessionStorage on demo; cookie/profile in Stack B | P1 |
| 20 | Brand Memory | 3 | Works | Knowledge block feeds Mira | P2 |
| 21 | Billing / Plans / Usage | 3 | Partial | `plans.ts` + tests exist; enforcement coverage unconfirmed | P1 |
| 22 | Error Handling | 3 | Decent | Routes have try/catch + Mira regex fallback; null-turn dead-ends seen in sim | P1 |
| 23 | Security / Permissions | 3 | Mixed | Stack B shop-scoped; **demo `/api/mira` + `/api/tryon` are public** (rate-limited only) | P1 |
| 24 | Deployment Readiness | 4 | Works | Railway 3-service deploys reliable | No |

**Unweighted average ≈ 3.0 / 5.**

---

## 3. Flow Test Results

| Flow | Pass/Fail | What Worked | What Broke | Fix Needed |
|------|-----------|-------------|------------|------------|
| Shopper | **Partial** | Mira opens, product-aware, recommends, try-on renders | Add-to-cart fake; recommends demo products on a real store; outcome not created from storefront | Wire widget→proxy + real cart |
| Merchant | **Partial** | Install, oauth, catalog sync work | Dashboard real-data coverage uneven; creative flow unconfirmed | Verify dashboards on real data |
| Admin | **Fail/Unverified** | — | Super-admin health/jobs/usage monitoring unconfirmed | Build/verify admin observability |
| Creative | **Unverified** | Imagery scaffolding present | Generate/regenerate/approve/export path unconfirmed | Trace + confirm real generation |
| Intelligence | **Fail (from storefront)** | Emit + persist + outcome primitives exist in Stack B | Storefront never calls them → loop never closes for real shoppers | Migrate shopper surface to Stack B |

---

## 4. P0 Blockers (must fix before any pilot)
1. **Wire the storefront to the real backend (Migration #7).** `mira-demo.tsx` → App Proxy; feed the **real synced catalog** into Mira + try-on (kills the "recommends demo products / 404 PDPs" problem).
2. **Real add-to-cart.** Call Shopify `/cart/add.js` with real variant IDs for single item *and* full outfit. Without this there is **no conversion**.
3. **Close the outcome loop from the live surface.** Shopper signals → events persisted → recommendation → action → outcome → weight update, originating from the real storefront, not the demo no-op path.
4. **Scale the try-on path.** Durable DB+S3 render cache (Stack B) with a key including muse+size+ease, + pre-warm; move renders to the worker queue. Current ephemeral cache + synchronous in-service renders = unbounded cost + rate-limits at scale.

## 5. P1 Fixes (needed for a strong pilot)
- Sync real per-product **measurements** so fit bars/sizing run on real data (not the size-relative fallback).
- Make Mira's routes **execute and return artifacts** (PDP, rendered look, completed size form) — navigation scored lowest (0.65); eliminate null-turn dead-ends.
- Verify **dashboards, creative engine/studio, super-admin, billing enforcement** render/enforce real data (several **needs-verification** above).
- Lock down the **public demo endpoints** or retire them once migrated.
- Try-on **UX overhaul** (full-screen muse, cinematic split, consistent boxes, responsive) + the recurring **image-loss-after-deploy** stability bug.

## 6. P2 Improvements (can wait)
- Bags/accessories as try-on-able; 3-piece combined try-on polish.
- DB write **retention/aggregation** for signal/event volume.
- Cheaper-tier Mira routing for trivial turns (cost at scale).

---

## 7. Fake / Mock / Decorative (looks real, isn't production-connected)
- **Add-to-cart** on the storefront (no real cart call).
- **Mira's catalog** on the storefront (14 hardcoded demo products, not the merchant's).
- **Event/outcome flow** from the demo surface (partly no-op).
- **Muse render persistence** (ephemeral volume with no DB record on the demo path).
- **Pre-warm** route exists but **was never triggered** (no startup hook/cron).

## 8. Dead / Disconnected Routes & APIs (file evidence)
- `apps/widget/src/mira-demo.tsx` — App Proxy `api_base` computed in the liquid block is **unused**; bundle hardcodes the demo origin.
- `apps/shopify-app/app/routes/proxy.shopper.$.tsx` — full shopper backend (`api/chat`, `api/style`, `api/fit`, `api/tryon`) that the widget **never calls**.
- `apps/web/app/api/tryon/prewarm/route.ts` — correct but **never invoked**.

## 9. Data Flow Breaks
- Shopper turn on storefront → demo `/api/mira` (Stack A) → **does not** reach the Prisma event/outcome tables (Stack B). The learning loop is severed at the surface.
- Try-on render bytes → ephemeral disk (Stack A) with **no DB index** → lost on redeploy/replica.

## 10. Security / Tenant Risk
- **Demo `/api/mira` + `/api/tryon` are public** (only rate-limited) — fine for a demo, must not be the production path.
- Stack B queries appear **shop-scoped (`shopId`)** — good, but full RLS/tenant-isolation review **not completed** (flag for a dedicated pass).
- No evidence of cross-brand leakage in Stack B, but unverified at scale.

---

## 11. Production Readiness Rating
- **Current: ~55 / 100** (excellent demo, non-scaling/disconnected live path)
- **Pilot readiness today: ~35 / 100** (fake cart + demo catalog block a real pilot)
- **After P0 fixes: ~75 / 100** (real pilot-capable on the dev store)
- **After P1 fixes: ~85 / 100** (strong pilot, scale-hardening still ongoing)

### Scale verdict (hundreds/thousands of users, thousands of try-ons, thousands of stores)
**Not ready, by design of the live path.** The demo stack collapses at scale (ephemeral cache → unbounded render cost + rate-limits; single service; synchronous renders; one shared catalog; no tenancy). The real stack has the right primitives (BullMQ queue, S3, DB render cache, per-shop isolation) but is unwired. **Scale-readiness == the same migration + durable cache/pre-warm + cost controls + DB retention.**

---

## 12. Final Recommendation
**Fix P0 first — do not pilot yet, do not call it production-ready.** The work is not a rebuild; it's a **wiring + scale-hardening** job, because the scalable backend already exists. Sequence:
1. **Migration #7** (widget → App Proxy + real catalog) — unblocks cart, learning loop, tenancy.
2. **Real add-to-cart** + **outcome-loop closure** from the live surface.
3. **Durable render cache + pre-warm + queue** (scale).
4. Then P1 verification sweep (dashboards, creative, admin, billing) + try-on UX.

After P0, Stylique becomes **pilot-ready on a single real store**; after P1 + scale-hardening, **multi-store pilot-ready**.
