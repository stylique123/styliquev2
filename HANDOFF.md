# Stylique — Session Handoff (carry-on brief)

> Read this first, then `CLAUDE.md` (the source of truth — §8 is the running fix-log,
> newest entries at top). This file tells you WHERE we are, WHAT is blocked, and
> WHAT to do next. Repo root: `/Users/apple/Desktop/stylique  re build/fashion`
> (note the DOUBLE SPACE in the path).

---

## 0. TL;DR — where we are right now

- The product (Mira AI stylist + try-on + sizing + complete-the-look + brand learning-loop + Creative Studio + beauty mode) is **architecturally rich but NOT production-ready**. A runtime audit scored it ~43/100 (pilot-readiness 24/100): "changes were layered around failures instead of forcing one canonical production path."
- We are mid-way through a **consolidation pass (Phase 1)** to fix runtime fragmentation. **4 of 7 Phase-1 items are shipped + verified + deployed.**
- A big **business/strategy question is open** (a possible pivot — see §4) that the founder wants decided AFTER external market research. That research run **failed** and needs re-running.
- **TWO AUTH BLOCKERS now gate all deploy + DB + live verification** (see §1). Everything downstream is stuck until the founder clears them.

---

## 1. 🚨 BLOCKERS — founder must clear these (you cannot)

1. **Railway CLI auth is dead** — `railway whoami` → `invalid_grant ... run railway login`. This means **no deploys** (`railway up`), **no DB access** (`railway run ... prisma`), and **no live verification** until the founder runs `railway login` (interactive browser — a user action; do NOT attempt to enter credentials).
2. **Shopify access token is 401 (invalid)** — the stored token for the dev store returns `401 Invalid API key or access token`, so install / webhooks / catalog-sync / cart / order flows cannot be verified. The founder must **reinstall the app on the dev store once** to mint a fresh token (audit "step 7" — the only manual step).

**Until both are cleared:** you can only do **pure-code, typecheck-verifiable** consolidation. Do NOT claim anything is "deployed" or "live-verified" — it isn't, because Railway is down. Be honest about verified-vs-pending.

Three Railway services: `stylique-app` (apps/shopify-app — App Proxy + brain + worker entry), `stylique-web` (apps/web — demo + try-on render + /api/mira), `stylique-worker` (apps/worker — BullMQ). Deploy each with `railway up --detach` from its app dir (once auth is restored). Neon Postgres (pooled). DB ops: `railway run --service stylique-app npx prisma <cmd> --schema=prisma/schema.prisma` from `packages/db`.

---

## 2. Consolidation Phase 1 — status (the active work)

Plan (founder's order): **consolidate, don't layer.** Full detail in `CLAUDE.md §8 → CONSOLIDATE-P1`.

| # | Item | Status |
|---|---|---|
| P1.1 | Scheduler global jobs → per-shop fan-out (kill `shopId:undefined` no-ops; removed double-scheduled recommendations/billing globals) | ✅ DONE (worker tsc green) |
| P1.2 | `/health` fails loud → 503 on recent critical-queue failures (timestamp-filtered) / backlog | ✅ DONE |
| P1.3 | No storefront demo behavior — removed demo-brain fallback + gated `byHandle`/`activeProducts` so a real store never serves phantom demo products | ✅ DONE |
| P1.7 | Root typecheck GREEN — `apps/widget/tsconfig.json` `jsx` fix; `turbo typecheck` now **10/10** | ✅ DONE |
| P1.4 | Unify Mira **event vocabulary** (dashboard zeros) **+ price-unit bug** | 🟡 IN PROGRESS — see §3 |
| P1.5 | Unify the **two Try-On paths** (delete direct `/api/tryon` bypass; route storefront try-on through App-Proxy → production metered `TryOnSession`/quota/events service) | ⬜ NOT STARTED (code-draftable now; verify needs live store) |
| P1.6 | **Baseline 11 Prisma migrations** (`prisma migrate resolve --applied <name>` ×11 — they report unapplied because DB was `db push`'d) | ⬜ BLOCKED on Railway auth (needs DB) |

The 4 shipped items were typecheck-clean (root 10/10), eval 13/13, widget built — **and were deployed earlier in the session BEFORE Railway auth died.** They are live. Anything from here is NOT deployed until auth is restored.

---

## 3. P1.4 detail — exactly where I left off

**Event-vocabulary mismatch (real, dashboard shows zeros):** the merchant dashboard QUERIES these event names but the storefront EMITS different ones. Confirmed divergence:
- Dashboard (`apps/shopify-app/app/lib/dashboard.server.ts`) consumes: `CHAT_OPENED, CHAT_MESSAGE_SENT, CHAT_PRODUCT_CLICKED, CHAT_SEARCH_RUN, CHAT_COMBO_PROPOSED, CART_CONFIRMED, CART_FROM_MIRA, CART_FROM_TRYON, CART_FROM_WIDGET_STYLE, SIGNUP_CLAIMED, WIDGET_*`.
- Storefront chat path (`apps/shopify-app/app/lib/chat.server.ts`) emits e.g. `CHAT_OPENED, CHAT_COMBO_VOTED, CHAT_REPLY_RECEIVED` — but NOT `CHAT_MESSAGE_SENT`, so the funnel reads zero.
- **NEXT STEP:** audit every emitter in `chat.server.ts` + `shopper-events.server.ts` + the widget against the dashboard's expected names; emit one canonical contract at one site per event (esp. emit `CHAT_MESSAGE_SENT` on shopper send, and `CART_FROM_MIRA` + a `lineValue` on single-item add — the orders.fulfilled webhook only matches `CHAT_CART_REQUESTED`/`COMBO_ADD_ALL`, so single-item Mira carts never attribute → MIRA_ASSISTED_ORDER stays $0). This is the foundation of any ROI/attribution story.

**Price-unit bug ("under 200" returned 18500):** I VERIFIED the brain budget filter (`brain.server.ts handleSearchCatalog priceMatches`) AND the adapter display (`mira-adapter.server.ts`) BOTH correctly do `priceCents / 100`. So the root cause is most likely a **currency-unit ambiguity** (e.g. PKR store, "under 200" vs 18500 PKR≈$66) OR the **LLM not passing `maxPriceUsd`** for "under 200". This needs **live-store reproduction** (token-gated). Do NOT fake a fix. A defensive option once reproduced: enforce the budget in the adapter on the final products (defense-in-depth), not just rely on the LLM tool.

---

## 4. 🔑 The OPEN STRATEGIC DECISION (founder's call, research-gated)

The founder pushed back hard: **"we already pitched try-on for lower returns + conversion and NOBODY cared."** So we ran panels + analysis. Findings (all in workflow result files under `/private/tmp/claude-501/-Users-apple-Desktop-stylique--re-build/c38412c3-5c16-43b5-872a-f7b784a855be/tasks/`):

- **16 buyer personas** (`w0gslad7x.output` = first 8, `why2f55f1.output` = second 8 + business-plan synthesis). Verdict: **brands will NOT pay as-is**; willingness $0–$2,000/mo, all conditional on **live proof that does not exist**.
- The business-plan synthesis recommends a **PIVOT**: stop selling the shopper-UX/try-on/returns wedge (proven dead); **reposition the same stack as "AI Creative Studio → on-brand ad creative + ROAS-correlation"** sold to the **growth/creative buyer** (the one segment with a live recurring budget — they already pay Midjourney/AdCreative/Foreplay). Hero offer: *"Stylique turns your catalog into unlimited on-brand ad creative — and tells you which ones actually sell."* ICP $3–30M DTC fashion/beauty on heavy paid social. Pricing $199/$599/$1,500, ~75–80% gross margin. #1 move: a **proof-before-purchase sample generator** (store URL → 3 on-brand creatives) + a **ROAS-correlation MVP**. (Full plan in `CLAUDE.md`-adjacent notes and the `why2f55f1.output` `businessPlan` object.)
- **Founder's instruction:** *"research and then decide"* — i.e., do **external cited market research FIRST**, then decide the pivot. **That deep-research run FAILED** (`wmuae3ee2.output`, status failed — agent didn't emit StructuredOutput). **RE-RUN the deep-research** (offer/market validation: what fashion+beauty brands actually pay for, competitor pricing, why VTO/returns pitches under-monetize) before presenting the final pivot recommendation. The detailed brief is in the prior `Workflow({name:"deep-research", args:...})` call — reuse it.
- **DO NOT execute the pivot (cut/reposition components) unilaterally.** Present it; it's the founder's decision.

Also done: a **technical risk register** (`w7s4czccr.output`, 45 verified risks — top: billing has zero enforcement [task #24, founder decision], VTO cost-bombing has no spend cap, cross-tenant ShopperSession leak on reused domains) and a **micro journey + integration trace** (`wq35mycjj.output` — fragile integration seams: client/server `museCacheKey` drift, demo-catalog-on-storefront [now fixed in P1.3], optimistic-cart-not-reconciled). NOTE: panel "criticals" sometimes cite wiring that exists one component away — **VERIFY every claim before fixing** (a "size not persisted" critical was a FALSE ALARM; `rememberSize` IS wired at `MiraWidget.tsx:1941`).

---

## 5. Exact next steps (in order)

1. **Ask the founder to clear the two blockers** (§1): `railway login` + reinstall the Shopify app on the dev store. Nothing deploys or verifies until then.
2. **Re-run the deep-research** offer/market workflow (§4) — it failed; reuse the brief. Then present the **final pivot recommendation** (corroborate/challenge the Creative+ROAS pivot with cited competitor/pricing data) and get the founder's GO/NO-GO. This is the gating decision.
3. **Finish Phase-1 code-only** while waiting on auth: P1.4b (event vocabulary unification — §3), P1.5 (draft the App-Proxy try-on route → production metered service). Typecheck them (`turbo typecheck` must stay 10/10). Do NOT mark "deployed" — they're staged until Railway returns.
4. **When Railway auth is back:** deploy the staged work; run **P1.6 migration baseline** (`migrate resolve --applied` ×11 — names listed in `packages/db/prisma/migrations/`).
5. **When the Shopify token is fresh (Phase 2):** run ONE clean end-to-end trace: install → catalog sync → widget injection → PDP Mira → cart → `/cart/add.js` → order webhook → outcome resolution. Capture each step.
6. **Phase 3:** wire `/api/mira/conversion` + `/api/mira/knowledge` on the App Proxy (widget calls them → currently **404**); close ONE recommendation→outcome loop (44 recommendations exist, ZERO outcomes — the learning-loop "moat" is unproven on real data).
7. **Founder decisions still open:** task #24 (billing enforcement — paid tiers work unpaid; scaffold env-gated `BILLING_ENFORCED` default-off when greenlit), and the §4 pivot.

---

## 6. Operating rules / how to work here

- **Verify before fixing.** Panel/audit "criticals" are candidates — read the actual code (and check `CLAUDE.md §8` for "already fixed") before touching anything. Several were stale/false alarms.
- **Quality gate per change:** root `pnpm typecheck` (turbo, must be 10/10) → Mira eval `cd apps/shopify-app && node scripts/mira-eval.mjs` (must be 13/13; re-run once if a transient Gemini try-on flake drops it to 12/13 — it self-recovers) → rebuild widget if a widget-bundled file changed (`pnpm --filter @stylique/widget build`, auto-mirrors to `public/widget.js`) → deploy (when auth back) → **VIEW/verify live** (Claude_Preview against the `web` launch.json server; clear sessionStorage + set `localStorage.sq_tour_seen=1`; optionally seed `localStorage.mira_body_v1={heightCm,weightKg,fitPref}` to surface the size pill).
- **Record every change in `CLAUDE.md §8`** (newest at top), honestly (verified vs pending).
- **Single-source discipline:** the widget single-sources `apps/web/app/components/mira/MiraWidget.tsx` + `surfaces/TryOnPanel.tsx` via esbuild (react→preact + next/image alias). A fix to one surface must not break the other (demo vs storefront). `ASSET_BASE` truthy = storefront, "" = demo. `sqApi()`/`__sqApi` is the App-Proxy base on storefront (read LAZILY — never a module const).
- **Don't enter credentials / reinstall apps / run `railway login` yourself** — surface those to the founder.

---

## 7. Recent shipped work (context, see CLAUDE.md §8 for full detail)
CONSOLIDATE-P1 (this session, §2) · CONV-1/CONV-2 (conversion+AOV: checkout handoff + persistent Checkout button, warm-lead commit, anchor-the-look, proactive size pill, single decisive CTA) · MIRA-UX-1/2 (reco quality, opener rotation, premium reco card, post-add momentum, tamed nudges, robust PDP detection) · EXPERT-PANEL-1..8 (security boundary, tenancy, App-Store /privacy+/terms+/health, honest metrics, a11y, cart availability, error copy) · DEDUP-1..5 (single-sourcing the widget, storefront→merchant-brain wiring).

The conversion/AOV panel scored Mira ~44% end-to-end conversion / 6.5-of-10 sales-agent, +12–18% AOV today. Diagnosis: "qualifies + describes brilliantly but doesn't CLOSE" — CONV-1/2 fixed the biggest leaks (checkout had no door; anchored one piece not the look).
