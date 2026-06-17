# STYLIQUE V1 — IMPLEMENTATION LOG

> Single running record for Step 2H onward. Newest entries on top. Detailed planning docs (2C–2G) + the prior Phase-0 report set were created untracked and are preserved in `stash@{0}` + `../stylique-untracked-docs-pre-phase0.tar.gz` (consolidated here per the "one central file" rule).

---

## Step 2H Phase 0 — Credential rotation CONFIRMED; Creative removal attempted + reverted (true scope discovered) — 2026-06-17

### Credential rotation
- **CONFIRMED.** Founder rotated the Neon credential + updated envs. Verified locally read-only (`SELECT 'db_ok'`) → new cred works. No secret printed/written. The leaked credential is now dead.

### Task E — destructive-migration row counts (read-only, captured)
- `Creative` = **0 rows**, `CreativeSet` = **0 rows**, `SavedRoutine` = **0 rows**, `ShopperSession` beauty columns = **0 rows with data**. → The eventual destructive migration (drop those tables/columns + Creative enum values) loses **zero data**. Still founder-approved + deferred; NOT applied.

### Creative code removal — ATTEMPTED, then REVERTED to keep the branch green
- Began Pass 2 in `packages/core/src/plans/features.ts` (removed the `studio` feature-flag object + type + FeatureKey + reader cases — 8 clean edits), then discovered the removal is **materially larger and more entangled than the contract assumed**, with a direct conflict against the "defer Prisma enum" rule. **Reverted** `features.ts` to baseline (`git checkout --`) so the branch is **clean + green**, not a broken half-refactor.

### TRUE SCOPE of Creative (corrects the contract's "~dormant sweep")
1. **TWO `studio` modules** — `packages/core/src/studio/` = **KEEP** (it's the brand-DNA engine, feeds Mira/recs); `packages/core/src/imagery/studio.ts` (225 lines) = **Creative image-gen, REMOVE** (imported by `imagery/index.ts` + re-exported via `core/src/index.ts`).
2. **PlanFeatures.studio** flag object (features.ts) + **PlanQuotas** creative fields (`monthlyCreatives`, `monthlyCreativeSets`, `creativeSets` in `plans/index.ts` + `plans/service.ts`).
3. **Prisma `UsageMetric` enum**: `CREATIVE_GENERATED`, `CREATIVE_SET_GENERATED` (schema 585-586) — referenced by canConsume/metering (`plans/index.ts` cases), billing (`billing.server.ts`, `costs.ts`), and the **test suite** (`plans.test.ts`, `fakePrisma.ts`). **Enum values = defer (your rule); code handlers = remove.**
4. **Prisma `EventName` enum**: `CREATIVE_IMPRESSION`, `CREATIVE_SET_GENERATED`, `CREATIVE_CLICKED/CONVERTED/APPROVED/REJECTED` (live DB) + `packages/types` `EventNameSchema` + 2 Zod payload schemas + emit/read sites. **Enum = defer; types/Zod/emit = remove.**
5. **Dashboards/analytics:** `insights.server.ts` (`creativePerformance`), `internal-dashboard.server.ts` (27 refs), `internal._index.tsx`/`internal.jobs.tsx` (super-admin), `network.server.ts` (`creative_volume`), `dashboard.server.ts` (`creativesGenerated`), `analytics/index.ts`.
6. **Merchant-visible:** `app.billing.tsx` plan display (`monthlyCreativeSets`/`creativeSets`).
7. **feature-flags.server.ts** `ENABLE_CREATIVE`; env `CREATIVE_ENABLED`/`STUDIO_PROVIDER`.
8. **Recommendation kinds** `WEAK_PDP_CREATIVE` / `STUDIO_PRODUCT_OPPORTUNITY` = Prisma `RecommendationKind` enum values → **defer** (enum); leave in `visibleKinds`.
9. **False positives (KEEP):** `app.settings.brand.tsx` "creative director" (Brand-DNA copy); `colors/rules.ts` "creative freedom" (English).

### Why no clean partial-green
`@stylique/core` exports the creative surfaces that `apps/shopify-app` imports, so removing them in core breaks the apps until the apps are also updated → the whole removal must land as **one atomic change** verified by a final `pnpm typecheck/build/test`. There is no safe intermediate green checkpoint; a half-done branch is red.

### Re-plan (one focused atomic pass on this branch)
A→ remove `imagery/studio.ts` + its `imagery/index.ts` re-exports + `core/src/index.ts` export/comment (check no kept consumer uses creative image-gen). B→ remove `studio` flag (features.ts) + `PlanQuotas` creative fields (plans/index, plans/service) + FeatureKey/reader. C→ remove creative metric/billing/cost **code handlers** (entitlement, billing, costs) — **keep** the `UsageMetric` enum values. D→ remove creative **events** from `packages/types` (EventNameSchema + payloads) + emit/read sites — **keep** the Prisma `EventName` enum values. E→ remove creative dashboard/insights/internal/network surfaces. F→ remove `ENABLE_CREATIVE`/env + the creative **tests** (`plans.test.ts` creative cases, `fakePrisma` fields). G→ `pnpm typecheck && build && test` to green. H→ Task-E **migration file authored but NOT applied** (drops Creative/CreativeSet/SavedRoutine tables + beauty cols + Creative enum values; 0-data confirmed).

### Decisions needed before the atomic pass
1. **Confirm the enum approach:** remove all creative *code* refs now but **keep** the `UsageMetric`/`EventName`/`RecommendationKind` enum values in Prisma (archival), to be dropped only in the deferred destructive migration (Task E). (Recommended — honors your defer rule + leaves zero broken code.)
2. **Confirm `imagery/studio.ts` has no kept consumer** beyond Creative (a quick grep at pass start).

### Phase 0 gate status (running)
GitHub current ✅ · clean baseline + branch ✅ (reverted, green) · Railway deployment IDs ✅ · credential rotation ✅ CONFIRMED · DB archival ✅ GO (0 rows) · Task-E row counts ✅ (all 0) · prisma validate ✅ · migrate diff captured ✅ (destructive, not applied) · **Creative code removed ❌ (re-planned as one atomic pass; needs the 2 confirmations above)** · schema↔DB reconcile ❌ (deferred destructive migration).

### Next action
Get the 2 confirmations above, then execute the atomic Creative-removal pass (A–H) on `chore/phase0-remove-creative` ending in green typecheck/build/test, + author (not apply) the Task-E migration.

---

## Step 2H Phase 0 — Security gate (credential rotation) — STOPPED at Task A — 2026-06-17

### Credential rotation
- **STATUS: BLOCKED — not rotated / not confirmed.** I **cannot** rotate the Neon credential myself (Neon-console action; changing credentials/security settings is outside my allowed actions). The founder did not mark it as externally completed in this turn → per the founder's own gate, I stopped.
- **No DB connection made this turn. No secret printed or written to any file.**
- **Founder action required (rotation runbook):**
  1. Neon console → project `stylique-fashion` DB `neondb` → reset the `neondb_owner` password (or create a new role + deprecate the old).
  2. Update `DATABASE_URL` to the new credential on Railway: `stylique-app`, `stylique-worker`, `stylique-web`.
  3. Update local `.env`, `.env.local`, `apps/shopify-app/.env` (note: `.env.local` uses the `-pooler` host; keep pooler for that one).
  4. Redeploy/restart the 3 Railway services so they pick up the new env (Railway env change → redeploy).
  5. Verify the OLD credential no longer authenticates; verify the app `/api/health` is 200 on the new credential.
  6. Reply here "rotated + envs updated" (do NOT paste the password).

### Actions performed (this turn)
- Evaluated Task A gate only. **No DB checks, no code removal, no migration, no stash pop, no Phase 1.** Branch `chore/phase0-remove-creative` unchanged/clean.

### Creative surfaces removed
- **NONE** — gated behind credential rotation (Task A unsatisfied).

### Remaining references
- ~225 active Creative refs / 30+ files (unchanged). `app.settings.brand.tsx` "creative director" remains a reviewed false positive (keep).

### Typecheck/build/test
- Not run (no code changed).

### DB migration plan
- **Deferred** — the destructive-drift migration plan (Creative/CreativeSet/SavedRoutine tables + beauty columns) requires row counts, which require DB access, which is gated behind rotation. To be authored once rotation is confirmed (still planning-only, never applied here).

### Blockers
1. **Neon credential rotation NOT confirmed** — founder must rotate externally (runbook above), then confirm. This blocks Tasks B–E.

### Phase 0 gate status (running)
GitHub current ✅ · clean baseline + branch ✅ · Railway deployment IDs ✅ · Creative archival decision ✅ GO (0 rows) · prisma validate ✅ · migrate diff captured ✅ (destructive — not applied) · **credential rotation ⛔ BLOCKED (founder action)** · Creative code removed ❌ (gated) · schema↔DB reconcile ❌ (deferred destructive migration).

### Next action
Founder rotates the Neon credential + updates envs (+ redeploy) and replies "rotated." Then I run: safe `prisma validate`, the Creative code removal (Passes 1–7, typecheck after each), Task D verification, and the Task E destructive-migration PLAN (no apply).

---

## Step 2H Phase 0 Creative Removal (analysis + decision; code removal NOT started) — 2026-06-17

### 🔴 SECURITY INCIDENT (action required)
- The production **Neon DB password was exposed** in a prior tool output: `prisma migrate diff` failed on a wrong relative path and **pnpm's `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` echoed the full `--from-url` command including the password.** All subsequent outputs are redacted, and the password is NOT written to any file.
- **Recommendation: rotate the Neon `neondb_owner` credential** (Neon console → reset password) and update `DATABASE_URL` on Railway `stylique-app`/`stylique-worker`/`stylique-web` + local `.env*`. Until then, avoid passing the URL on a CLI that may echo it (prefer `psql "$URL"` which doesn't echo on success, or load via env).

### Actions performed (all read-only; NO code/schema/DB writes)
- Confirmed branch `chore/phase0-remove-creative` clean.
- Ran read-only archival counts + `prisma validate` + `migrate diff --script` against production Neon (founder-authorized).
- Recorded Railway deployment IDs for all 3 services.
- **Did NOT start Creative code removal** (checkpoint — see blockers).

### Railway deployment identifiers (git SHA not exposed by CLI → deployment IDs recorded)
| Service | Latest SUCCESS deployment ID | Timestamp |
|---|---|---|
| stylique-app | `c0fd5363-b50b-47da-a0c9-fa6c33c2a338` | 2026-06-14 12:11:08 +05:00 |
| stylique-worker | `5f8e3e0a-e53a-4702-88de-5dbee6e666c6` | 2026-06-14 12:11:15 +05:00 |
| stylique-web | `20ee8899-9aa9-47c7-bbab-5f1acd114d59` | 2026-06-14 11:54:37 +05:00 |
- All 3 services exist + Online (stylique-web confirmed; earlier `railway status` list was truncated). Exact git SHA per deployment still needs `railway deployment <id>` detail or the dashboard.

### DB archival check — DECISION: GO (clean removal data-safe)
- `SELECT … WHERE name::text ILIKE 'CREATIVE%'` → **0 rows.** No historical Creative-event rows. → Creative event enum values can be removed cleanly.
- Live `EventName` enum creative labels: `CREATIVE_IMPRESSION, CREATIVE_SET_GENERATED, CREATIVE_CLICKED, CREATIVE_CONVERTED, CREATIVE_APPROVED, CREATIVE_REJECTED` (6; note live enum does NOT have `CREATIVE_GENERATED`, which the schema declares — drift).
- `Plan` creative fields snapshot: **1 row →** `monthlyCreatives=60, monthlyCreativeSets=10`. Live `Plan` also has a 3rd column `creativeSets` (not in schema). Dropping these loses only those ints (recorded here).
- Total AnalyticsEvent rows: 2733.

### Prisma validation / diff
- `prisma validate`: **PASS** ("schema is valid").
- `migrate diff` (schema vs live): **NON-EMPTY — NOT applied.** Reveals major drift (schema is AHEAD of the live DB):
  - Live DB still has tables **`Creative`, `CreativeSet`** (+ FKs) and **`SavedRoutine`** (+ FKs) — all removed from schema.
  - Live `ShopperSession` still has 9 **beauty** columns (`skinDepth, skinUndertone, skinHex, skinTypeBeauty, skinConcernsJson, skinAnalyzedAt, skinRoutineSavedAt, savedBeautyRoutineJson, routinePreference`) + a beauty index — removed from schema.
  - EventName enum recreation to add newer non-creative values (MIRA_*, OUTCOME_RESOLVED, etc.).
  - → Reconciling the DB to the schema = **destructive DROPs** (tables + columns). Must be a deliberate, reviewed migration (P0-T11), NOT a blind run. **Check Creative/CreativeSet/SavedRoutine table row counts before any drop.**

### Creative removal surfaces changed
- **NONE this turn** (code deletion not started). The removal remains scoped per `STYLIQUE_CREATIVE_REFERENCE_INVENTORY` (in stash): ~225 active refs / 30+ files incl. `packages/core/src/studio/` module, `f.studio` flags (all tiers), entitlement/billing switch cases, **merchant-visible billing display** (`app.billing.tsx`), insights `creativePerformance`, super-admin (`internal.*`, `internal-dashboard.server.ts`), network `creative_volume`, feature-flags `ENABLE_CREATIVE`, types + Zod, schema enum (6 values) + `Plan.monthly*`/`creativeSets`, env, stale `dist`.
- **False positive (KEEP):** `app.settings.brand.tsx` "creative director" = Brand-DNA language, not Creative Studio → reviewed, retain.

### Verification results
- N/A (no code changed). `prisma validate` PASS. typecheck/build/tests not run (no edits this turn).

### Remaining references
- ~225 active Creative refs across 30+ files (unchanged). Classification done in the inventory (stashed).

### Blockers
1. **SECURITY:** rotate the leaked Neon credential (above) — recommended before further prod-DB interaction.
2. **Destructive DB drift:** live DB has Creative/CreativeSet/SavedRoutine tables + beauty columns the schema lacks; the schema-side Creative model removal is already done, so the DB reconcile (P0-T11) + any column/enum drop is a **deliberate destructive migration** needing row-count checks + review — not a blind run.
3. **Scope:** Creative CODE removal is a large, build-critical refactor (merchant-visible + super-admin surfaces) → execute as its own focused pass with iterative `pnpm typecheck`, not bundled.

### Phase 0 gate status (running)
GitHub current ✅ · clean baseline + branch ✅ · Railway deployment IDs ✅ (git SHA ⛔) · Creative archival decision ✅ GO (0 rows) · Plan values snapshotted ✅ · prisma validate ✅ · migrate diff captured ✅ (NON-EMPTY, destructive — not applied) · Creative removed ❌ (not started) · schema↔DB reconciled ❌ (destructive drift; deliberate migration needed) · credential rotation ⛔ pending.

### Next action
Rotate the Neon credential; then on `chore/phase0-remove-creative` execute the Creative code removal surface-by-surface with `pnpm typecheck` after each surface; separately plan the destructive DB migration (Creative/CreativeSet/SavedRoutine tables + beauty columns + enum/Plan-field drops) with row-count checks. Do NOT pop the stash; do NOT start Phase 1.

---

## Step 2H Phase 0 Unblock — 2026-06-17

### Actions performed
- Backed up the 11 uncommitted "local-only" Mira/try-on/widget/demo edits (patch + tar of untracked docs), then `git stash push -u` → clean baseline.
- Pushed the 27 committed commits to `origin/main` (founder-authorized). GitHub now current.
- Created clean branch `chore/phase0-remove-creative` off updated `main` — **no Creative removed**.
- Read-only access checks: Railway (works), DB env (identified, NOT run — production).

### Commands run
- `git diff --binary > ../stylique-local-demo-edits-pre-phase0.patch` (808 KB)
- `git ls-files --others --exclude-standard > ../stylique-untracked-pre-phase0.txt` (36 files)
- `tar -czf ../stylique-untracked-docs-pre-phase0.tar.gz` (untracked docs, 146 KB) — extra safety
- `git stash push -u -m "preserve local Mira tryon widget demo edits before Phase 0"`
- `git push origin main` → `9787f3a..345a034`
- `git fetch origin`; `git checkout -b chore/phase0-remove-creative`
- `railway whoami` / `railway status`; DB host id (redacted); `prisma validate` (env-load error, deferred)

### Results
- Push: SUCCESS (`9787f3a..345a034`). Origin/HEAD gap now `0 0`.
- Stash: SUCCESS (`stash@{0}` named). Working tree clean.
- Branch: `chore/phase0-remove-creative` created, clean, based on `345a034`.

### Git state
- Branch: `chore/phase0-remove-creative` (clean) · `main` and `origin/main` aligned at `345a034`.
- Gap: `0 0`. Latest SHA: `345a034`.

### Stash / patch backup
- `stash@{0}: On main: preserve local Mira tryon widget demo edits before Phase 0` (DO NOT pop yet).
- Code patch: `../stylique-local-demo-edits-pre-phase0.patch` (808 KB, the 11 tracked-modified files).
- Untracked docs: `../stylique-untracked-docs-pre-phase0.tar.gz` (146 KB) + filename list `../stylique-untracked-pre-phase0.txt`.

### Railway state
- Logged in (itsabs126@gmail.com). Project `stylique-fashion` (`0abd1c6d-…`), env **production**.
- Services: `stylique-app` ● Online (`stylique-app-production.up.railway.app`), `stylique-worker` ● Online. `stylique-web` not shown in `railway status` output (truncated or separate project — VERIFY).
- **Deployed git SHA per service = UNKNOWN.** `railway status` doesn't expose it. Method: link each service → `railway deployment list`, or read the Railway dashboard → Deployments → commit.

### DB state
- `DATABASE_URL` present in `.env` / `.env.local` (pooler) / `apps/shopify-app/.env` → Neon `ep-wispy-hall-apr92h8f…/neondb`, single project.
- **Environment = production (not a confirmed-safe isolated dev DB).** Per safety rule, **NO DB checks run** (no `migrate diff`, no archival counts). `prisma validate` failed only on env-var loading (DATABASE_URL not exported), not a schema fault — re-run with env loaded later.

### Blockers
- **Deployed SHAs UNKNOWN** — need `railway deployment list` (per linked service) or dashboard; confirm whether `stylique-web` exists in this project.
- **DB checks (P0-T04 archival, P0-T11 reconcile) DEFERRED** — need a confirmed-safe environment to run read-only against (or an explicit OK to run read-only diff/counts against the production Neon).
- **Creative removal NOT done** — large refactor (~225 refs / 30+ files, incl. merchant-visible billing + super-admin UI; `app.settings.brand.tsx` "creative director" is likely brand language, not Studio). To run next on `chore/phase0-remove-creative`, surface-by-surface, with the archival decision first.

### Next action
On `chore/phase0-remove-creative`: resolve the DB archival check (or get OK to run read-only counts against prod), then execute Creative removal per surface with typecheck/build/test, then P0-T10 verification. Separately, record the 3 deployed SHAs via `railway deployment list`/dashboard. Do NOT pop the stash; do NOT start Phase 1 until the Phase-0 gate passes.

### Phase 0 gate status (running)
GitHub current ✅ · deploy runbook/env/rollback ✅ (SHAs ⛔ UNKNOWN) · Creative inventory ✅ · scope plan ✅ · clean baseline + branch ✅ · Creative removed ❌ (pending) · DB reconcile ⛔ UNKNOWN · archival check ⛔ UNKNOWN.

---

## Creative Atomic Code Removal — DONE (branch `chore/phase0-remove-creative`)

Executed as one atomic pass per founder confirmation (keep Prisma enum values as
archival; brand-DNA kept; DB destructive migration plan-only). Ends GREEN:
**typecheck 11/11 · build 5/5 · tests 233 passed / 1 pre-existing unrelated fail.**

### What was removed (active Creative code)
- **packages/core** — `plans/features.ts` (`studio` flag object off `PlanFeatures` +
  all 3 tiers + `resolveFeatures` + `FeatureKey`/`readFeatureFlag` studio cases);
  `plans/index.ts` (`PlanQuotas` creative fields + `quotaForMetric` creative cases
  → `default: null`); `plans/service.ts` (creative quota mapping);
  `billing/costs.ts` (`computeCost` creative case → `default: 0`; `replicate-flux-1.1-pro`
  PROVIDER_RATES entry); `analytics/index.ts` (`creative_impressions_by_set` view);
  `index.ts` (stale Studio export comment → brand-DNA); `__tests__/fakePrisma.ts` +
  `__tests__/plans.test.ts` (creative Plan fields + the CREATIVE_GENERATED test).
- **apps/shopify-app** — `lib/feature-flags.server.ts` (`creative` flag +
  `ENABLE_CREATIVE` + disabled-message); `lib/billing.server.ts` +
  `lib/entitlement.server.ts` (creative metric→studio cap cases → `default: null`;
  entitlement `studio.*` FeatureKey hints); `routes/app.billing.tsx` +
  `services/shop.server.ts` (creative plan-field writes); `routes/api.usage.tsx`
  (creative metrics in the summary array); `routes/api.health.tsx` +
  `routes/api.admin.observability.tsx` (dead `creative-set` queue from monitors).
- **apps/web** — `api/admin/enterprise/route.ts` (`monthlyCreatives` plan write).
- **apps/worker** — `jobs/outcome-resolver.ts` (stale creative-set comment).
- **packages/db** — `src/seed.ts` (creative plan-field seed values).

### Deliberately KEPT (founder decisions / false positives)
- **Prisma enum values** `UsageMetric.{CREATIVE_GENERATED,CREATIVE_SET_GENERATED}`
  + the `EventName.CREATIVE_*` family + the `packages/types` Zod mirrors of them
  + Plan columns `monthlyCreatives`/`monthlyCreativeSets`/`creativeSets` — all
  **archival/deferred** until the reviewed DB migration runs.
- **`RecommendationKind` `WEAK_PDP_CREATIVE` + `STUDIO_PRODUCT_OPPORTUNITY`** —
  ACTIVELY used by the recommendations engine; not Creative Studio; permanent keep.
- **Brand DNA** (`packages/core/src/studio/brand-dna.ts` via `studio/index.ts`) —
  feeds Mira's voice + recs (palette/tone/style).
- **"creative director" brand copy** (`app.settings.brand.tsx`) + **"creative
  freedom"** (`colors/rules.ts`) — founder-mandated keep.
- **`productNeedingCreativeRefresh`** (`apps/web .../insights/merchant/route.ts`) —
  merchant-imagery demand insight ("commission a worn editorial shot"), i.e.
  commerce intelligence, NOT Creative Studio generation.

### Residual stubs left as-is (green, internal-only, prior-pass decision)
Internal-ops dashboard creative-set tiles (`internal-dashboard.server.ts`,
`internal.jobs.tsx`, `internal._index.tsx`, `internal.$shopId.tsx`,
`network.server.ts` `creativesCount`/`creative_volume`, `insights.server.ts`
`creativePerformance`, `dashboard.server.ts` `studio` type) were neutralized to
0 / `[]` / `null` by the earlier pass — they reference NO removed Prisma model,
typecheck + build clean, and are internal-only. Full UI deletion deferred
(high-churn, zero user-facing benefit).

### DB migration — PLAN ONLY, NOT APPLIED
Draft at `packages/db/deferred-migrations/DROP_creative_DEFERRED_DO_NOT_APPLY.sql`
(outside `prisma/migrations/`, ends in ROLLBACK). Drops orphaned Creative/CreativeSet
tables + the deferred Plan columns + Creative enum values. Verified 0 Creative /
0 CreativeSet rows → zero data loss. **Requires founder approval + schema edit +
`prisma migrate diff` regeneration before apply.**

### Known pre-existing failure (NOT a regression)
`plans.test.ts > "treats null quota as unlimited (TRYON_BODY)"` fails on HEAD
(commit `345a034` set STARTER `monthlyTryOnBody` to 3000, contradicting the test's
"unlimited" premise). Identical 233-pass/1-fail before and after this pass.
Left untouched — it's a product/test-expectation question outside Creative scope.

---

## Step 2H Phase 0 — Final Creative Verification — 2026-06-17

### Branch state
- Branch: `chore/phase0-remove-creative`; HEAD before this pass = `704d6c4` (atomic
  Creative code removal). 1 commit ahead of origin/main, working tree clean at start.
- This pass removes the remaining internal-ops Creative stubs (full removal, not
  neutralize-to-0) per founder: "No ghost internal UI. No neutralized Creative tile."

### Remaining Creative reference classification (code only; docs excluded)
After this pass, every code-level hit falls into an ALLOWED class — zero active
UI/API/code references remain:
1. **Historical/removal notes** — `billing.server.ts`, `entitlement.server.ts`,
   `recommendations.server.ts`, `costs.ts`, `plans/index.ts`, `core/index.ts`,
   `studio/index.ts`, `schema.prisma:227` ("Creative + CreativeSet models removed").
2. **Normal-English false positives** — `colors/rules.ts` "creative freedom";
   `recommendations/service.ts:247` "hero/landing creative" (merchant-imagery copy);
   `app.settings.brand.tsx` "creative director" (brand copy, founder keep);
   `apps/web .../insights/merchant/route.ts` `productNeedingCreativeRefresh` — a
   MERCHANT-imagery demand insight ("commission a worn editorial shot"), i.e.
   commerce intelligence, NOT Creative Studio. (Flagged for founder visibility:
   the field name contains "Creative" but it is not a Studio metric.)
3. **Deferred Prisma enum / DB compatibility** — `schema.prisma` Plan columns
   (`monthlyCreatives`/`monthlyCreativeSets`/`creativeSets`), `BrandTasteSnapshot.creativesCount`,
   `UsageMetric`/`EventName` `CREATIVE_*` values, + their `packages/types` Zod mirrors.
4. **Actively-used `RecommendationKind WEAK_PDP_CREATIVE`** — NOT Creative Studio;
   generated by the recommendations engine, surfaced on dashboards, covered by tests.
   Permanent keep (alongside `STUDIO_PRODUCT_OPPORTUNITY`).

### Internal stubs removed (full removal this pass)
- `internal-dashboard.server.ts` — removed `totalCreativeSets`/`pendingCreativeSets`/
  `failedCreativeSets` from `BrandSummary`, `recentCreativeSets` from `BrandDetail`,
  the `failedCreativeSets` params from `computeHealthStatus`/`buildIssues`, the
  `monthlyCreatives` plan-select + credit-cap math, and all stub-to-0 Promise.all
  entries. No Creative field returns from this module.
- `internal._index.tsx` — removed `totalCreativeSets`/`pending`/`failed` from the row
  type + the `totalCreativeSets` stat + the "Creative sets (all time)" tile (grid 4→3).
- `internal.$shopId.tsx` — deleted the dead `CreativeSetRow` component + the
  `requeue_set` form (no action handler existed) + Studio comments.
- `internal.jobs.tsx` — removed the `creative-set` queue card, the "Re-queue all
  failed creative sets" button (no handler), the "Failed creative sets" table, and
  the `csStats`/`recentFailedCS`/`pendingCS` loader stubs + `queues.creativeSet`.
- `network.server.ts` — removed the `creative_volume` benchmark dimension + the
  `creativesCount` read/write/select (the Prisma column stays as deferred DB-compat,
  added to the migration draft; the benchmark no longer surfaces it).
- `insights.server.ts` — removed the `creativePerformance` Ultimate-insights field +
  its empty-stub plumbing + `recentCreativeSets`.
- `dashboard.server.ts` — removed the `studio` overview section (type + null const +
  return). No consumer referenced it.
- `packages/ai/src/brain/types.ts` — removed the unused `brandDNA.creativeMemory`
  field (Brand DNA itself kept).
- Stale doc-comments corrected (`tenant.server.ts` examples used `prisma.creativeSet`;
  `api.admin.brand-profile.tsx`/`api.admin.products.tsx`/`brand-instagram.ts`/
  `queue.server.ts` mentioned the deleted Creative Studio / apps/creative).

### Typecheck/build/test
- `pnpm typecheck` → **11/11 green**.
- `pnpm build` → **5/5 green**.
- `pnpm test` → **233 passed / 1 failed**. The one failure —
  `PlansService.canConsume > "treats null quota as unlimited (TRYON_BODY)"` — is
  PRE-EXISTING: it reproduces on parent commit `345a034` (which set STARTER
  `monthlyTryOnBody`=3000, contradicting the test's "unlimited" premise). NOT a
  Creative regression; left untouched per scope.

### DB migration status
- Plan-only. Draft: `packages/db/deferred-migrations/DROP_creative_DEFERRED_DO_NOT_APPLY.sql`.
- OUTSIDE `prisma/migrations/` (which holds only `00000000000000_baseline` +
  `migration_lock.toml`) → `prisma migrate deploy` never picks it up.
- Wrapped `BEGIN … ROLLBACK` → an accidental run is a no-op. Filename + header marked
  DEFERRED / DO NOT APPLY. Carries row-count evidence (Creative=0, CreativeSet=0).
- Now also drops `BrandTasteSnapshot.creativesCount` (newly unwritten this pass).
- Nothing applied. Requires founder approval + schema edit + `prisma migrate diff`
  regeneration before apply.

### Phase 0 gate status
- Credential rotation ✅ · Creative active-code removal ✅ · Creative internal-stub
  removal ✅ (this pass) · typecheck 11/11 ✅ · build 5/5 ✅ · tests 233✅/1 pre-existing
  unrelated · DB migration plan-only ✅ (not applied) · stash untouched ✅ · Phase 1
  not started ✅.
- **Phase 0 Creative removal: COMPLETE.** No ghost internal UI, no neutralized tile,
  no Creative metric/queue/API field remains; only allowed historical/false-positive/
  deferred-enum/actively-used-RecommendationKind references.

### Blockers
- None for Creative removal. Open (out of scope): the pre-existing TRYON_BODY test
  expectation (product decision: fix test vs. the 3000 cap); founder sign-off on the
  deferred DB migration before it can be applied.

---

## Step 2H Phase 0 — Final Gate Close — 2026-06-17

### Branch push
- `git push -u origin chore/phase0-remove-creative` → **pushed** (new remote branch,
  no force, no merge). Local tracks `origin/chore/phase0-remove-creative`; HEAD == remote
  (`0 0`). Still **2 commits ahead of origin/main** (`704d6c4`, `7f491b5`); not merged.
- Working tree clean. Latest commit `7f491b5`.

### Final Creative reference check
- Final grep over `apps`/`packages` (excl. node_modules/dist/build/.next/deferred-migrations):
  **PASS — zero active Creative Studio references.** All hits are allowed:
  historical/removal notes; normal-English false positives ("creative director" brand
  copy, "hero/landing creative" merchant copy, `productNeedingCreativeRefresh`
  merchant-imagery insight); deferred Prisma enum/DB-compat (`schema.prisma` Plan cols +
  `BrandTasteSnapshot.creativesCount` + `CREATIVE_*` enum values + `packages/types` Zod
  mirrors); actively-used `RecommendationKind WEAK_PDP_CREATIVE`. No edits required.

### Railway deployment state (read-only; current LIVE = pre-Creative-branch)
- Project `stylique-fashion` (`0abd1c6d-…`), env production. All services ● Online.
- Current SUCCESS deployments (git SHA unavailable through CLI — `deployment list`
  exposes deployment ID/status/timestamp only):
  - **stylique-app**   — `c0fd5363-b50b-47da-a0c9-fa6c33c2a338` · SUCCESS · 2026-06-14 12:11:08 +05
  - **stylique-worker**— `5f8e3e0a-e53a-4702-88de-5dbee6e666c6` · SUCCESS · 2026-06-14 12:11:15 +05
  - **stylique-web**   — `20ee8899-9aa9-47c7-bbab-5f1acd114d59` · SUCCESS · 2026-06-14 11:54:37 +05
- These predate the Creative branch → live prod does NOT yet include Creative removal
  (expected: branch is pushed but not merged/deployed). To map a deployment to a git
  SHA, read the Railway dashboard → Deployments → commit (CLI does not expose it).

### Test/build status (confirmed unchanged from the verification pass)
- typecheck **11/11** · build **5/5** · tests **233 passed / 1 pre-existing unrelated
  fail** (`TRYON_BODY` unlimited-quota test; reproduces on parent `345a034`).

### DB migration status
- **Plan-only, NOT applied.** Draft `packages/db/deferred-migrations/DROP_creative_DEFERRED_DO_NOT_APPLY.sql`
  (outside `prisma/migrations/`, `BEGIN…ROLLBACK`). `prisma/migrations/` holds only
  `00000000000000_baseline` + `migration_lock.toml`.

### Final Phase 0 gate decision
- **PASSED.** Credential rotation ✅ · Creative active-code + internal-stub removal ✅ ·
  final grep clean ✅ · typecheck 11/11 ✅ · build 5/5 ✅ · tests 233✅/1 pre-existing ·
  DB migration plan-only/not-applied ✅ · branch pushed (not merged) ✅ · stash untouched ✅ ·
  Phase 1 not started ✅.

### Remaining non-blockers
- Pre-existing `TRYON_BODY` test expectation (product decision: fix test vs. the 3000
  STARTER body cap) — explicitly out of this branch's scope.
- Deferred DB migration awaits founder approval + schema edit + `prisma migrate diff`
  regeneration before any apply.
- Live Railway deploys still on the pre-Creative branch — they update only on a future
  merge + deploy, which is intentionally not done here.
- Exact deployed git SHA per service still only readable from the Railway dashboard.

### Next action
- Phase 0 is closed. Ready to begin Step 2H Phase 1 (Safety & Shopify Pilot Foundation)
  on a new branch off this one (or off main after a reviewed merge — founder's call).
