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

---

## Step 2H Phase 1 — Safety & Shopify Pilot Foundation — 2026-06-17

### Branch state
- Branch `chore/phase1-safety-shopify-foundation` off `chore/phase0-remove-creative`.
- Not merged, not deployed. Investigation-first (2 Explore agents mapped identity/
  session/consent + Shopify integration), then trust-but-verify on every claim before
  editing — several sub-agent claims were wrong and corrected against source.

### Tickets completed
- **P1-T01 session-safe identity — CODE.** Body + size are now SESSION-SCOPED.
  `MiraWidget.tsx` (`mira_size_memory_v1`, `mira_body_v1`) and `TryOnPanel.tsx`
  (`mira_body_v1`) moved localStorage→sessionStorage; added `purgeLegacyBodyStorage()`/
  `purgeLegacyBody()` that wipe any pre-Phase-1 device-wide localStorage residue on
  first read. A new shopper/session on the same browser can no longer inherit a prior
  shopper's body/size. (`mira_units_v1` left as localStorage — UI preference, not body
  data. Conversation/nudge keys were already sessionStorage.)
- **P1-T02 storefront cookie/session identity — VERIFIED.** `sq_shopper_id` cookie is
  `Secure; HttpOnly; SameSite=None` (session.server.ts); shop is resolved ONLY from the
  HMAC-verified App Proxy `session.shop` (proxy.shopper.$.tsx `resolveShopDomain`, query
  fallback regex-gated to `*.myshopify.com` after HMAC). Every handler scopes queries by
  `shopifyDomain`/`shopId`. Cross-shop is impossible by construction. No change needed.
- **P1-T03 save-at-end consent — VERIFIED + documented.** Soft-account claim is OTP-gated
  (account.server.ts: SHA-256 OTP, 15-min TTL, 5-try lockout, `accountClaimedAt`).
  Anonymous body lives on the per-cookie `ShopperSession` (a NEW shopper = NEW cookie =
  NEW empty session → no cross-shopper inheritance); explicit consent upgrades to a named,
  GDPR-redactable profile. Photo path fully removed (muse-only) — no shopper photo is
  ever persisted. (Flagged non-blocker: 180-day anonymous-body retention on the cookie
  session is a privacy-policy decision, not a leak.)
- **P1-T04 demo cart label + isolation — CODE + VERIFIED.** Added a visible "DEMO" pill
  to the floating cart badge when `!ASSET_BASE` (marketing demo) with a "simulated cart"
  tooltip. Storefront isolation already enforced (P1.3): `activeProducts()`/`byHandle()`
  return `[]`/null on a real storefront (never the 14-product demo catalog), and
  `storefront-cart.ts onStorefront()` gates the simulated path so the real `/cart/add.js`
  is the ONLY cart path on a storefront.
- **P1-T05 storefront smoke test — runbook.** Existing assets: `scripts/smoke-test.ts`
  (health/proxy/chat/VTO/dashboard) + `scripts/setup-live-test.sh` + `docs/live-test-
  checklist.md`. Storefront-isolation guarantees are code-enforced + verified (no demo
  catalog, no simulated cart on storefront). Runbook for a pilot store: install → app
  embed on → open a PDP → confirm widget mounts → real reco card with a real handle →
  size → real `/cart/add.js` add (devtools `[stylique] cart:add status:200`) → cookie
  `sq_shopper_id` present → dashboard widget-live banner turns green.
- **P1-T06/T07 Theme App Extension primary / ScriptTag fallback — VERIFIED.** The theme
  app embed (`extensions/stylique-widget/blocks/stylique_widget.liquid`, default-on)
  injects `tryon.js`; the afterAuth ScriptTag injects `widget.js`. esbuild proves these
  are BYTE-IDENTICAL (built from `src/mira-demo.tsx`, mirrored). Both run `mount()` whose
  `if (document.getElementById("sq-mira-root")) return;` is a DOM-level guard → both
  loaded = single mount, no double-widget. Uninstall removes the ScriptTag
  (webhooks.app-uninstalled → deleteScriptTags). ScriptTag retained as the automatic
  fallback per instruction. No risky change made.
- **P1-T08 widget-live beacon + status — CODE.** Beacon already emitted once/session
  (`WIDGET_PLACEMENT_AUDIT`, mira-demo.tsx). Added explicit `widgetLive`/`lastAuditAt` to
  `buildPlacementSummary` (false/red when no beacon in window — never a silent pass) and a
  red/green widget-live Banner at the top of the merchant dashboard (app.dashboard.tsx).
  Super-admin: `getAllBrandSummaries`/`getBrandDetail` gained `widgetLive` (7-day beacon)
  and `internal._index.tsx` shows a "● live / ● no widget" pill per brand (red when no
  beacon) — so a not-live store shows red instead of being invisible.
- **P1-T09 Shopify scope cleanup — CODE.** Verified ZERO call sites for `write_products`
  (no productCreate/productUpdate anywhere; no `app.products.new` route) and
  `read_product_listings` (catalog sync uses Admin `products` under read_products).
  Trimmed both from `shopify.app.toml` AND `env.server.ts` SHOPIFY_SCOPES (also fixed a
  pre-existing drift: the env default had omitted `write_script_tags`). New set:
  `read_products,read_inventory,read_orders,write_script_tags`. Re-consent impact
  documented inline — existing installs re-grant once on next deploy (scope set shrank;
  Shopify managed install shows the prompt). No V1 flow depends on the dropped scopes.
- **P1-T10 webhook idempotency — CODE + VERIFIED.** 6/8 handlers already dedup on
  `x-shopify-webhook-id` via `seenRecently`. Added the missing guard to
  `webhooks.orders.tsx` (orders/create — was double-emitting `PURCHASE` on retries;
  10-min window). `app-uninstalled` is naturally idempotent (delete/mark/delete-tags).
  GDPR handlers (customers.data-request/redact, shop.redact) dedup + return 200.
- **P1-T11 billing comp — VERIFIED.** `BILLING_ENFORCED` env default OFF; when ON, a paid
  tier degrades to STARTER unless `Plan.planFeaturesJson.comp === true` (pilot grandfather)
  or `billingActive === true`. Single enforcement point (`getEffectivePlan`). Comp is
  settable via the internal dashboard `set_comp` action. Pilot decision: keep enforcement
  OFF; comp the pilot merchant. Mechanism ready, not enforced.
- **P1-T12 security regression — VERIFIED (code-enforced).** App Proxy HMAC
  (`authenticate.public.appProxy`); cross-shop impossible (shopId-scoped queries);
  shop-from-body ignored (session.shop only); internal IDs/tokens not exposed
  (serialize.ts + shopper-serialize.test passes); fake cart success impossible (real
  `/cart/add.js`, ok:false on failure); invalid handle rejected (validateHandle);
  prompt-injection boundary present (demo + production prompts); admin routes fail closed
  (checkAuth → NODE_ENV!=="production" when secret unset); upload MIME/size locked (regex
  + 6MB; photo path removed entirely); rate limits on shop+shopper; shopper photos never
  persisted. No NEW automated suite added — invariants are code-enforced + verified;
  a dedicated automated security suite is a future hardening item (non-blocker).

### Typecheck/build/test
- `pnpm typecheck` 11/11 · `pnpm build` 5/5 · `pnpm test` 233 passed / 1 pre-existing
  unrelated `TRYON_BODY` failure (reproduces on parent `345a034`). Widget bundle rebuilt
  (tryon.js 197.7 KB, mirrored to widget.js).

### Phase 1 gate status
- PASSED. Identity/demo safety ✓ · Shopify foundation ✓ · widget-live ✓ ·
  scopes/webhooks/billing/security ✓ · green build · no Phase 2 work started ·
  stash untouched · DB migration not applied · Creative not resurrected.

### Blockers
- None for Phase 1. Non-blockers logged: pre-existing TRYON_BODY test (product decision);
  scope trim triggers one-time re-consent on next deploy (intended); 180-day anonymous-
  body retention is a privacy-policy decision; a dedicated automated security suite is
  future hardening; live storefront smoke (install→cart→beacon-green) needs one human
  action on a pilot store.

### Next action
- Ready for Step 2H Phase 2 (Mira Sales Engine). Recommend a human live-install smoke on
  the dev/pilot store to flip the widget-live banner green and exercise the real cart path.

---

## Step 2H Phase 2 — Mira Sales Engine — 2026-06-17

### Branch state
- Branch `chore/phase2-mira-sales-engine` off `chore/phase1-safety-shopify-foundation`
  (Phase 1 pushed: `e4c0005`). Not merged, not deployed.
- ONE brain only. Phase 2 adds a deterministic sales-engine ENVELOPE that the single
  `decideMira` runs every decision through (`applySalesEngine`) — no second brain. Both
  callers (demo `apps/web/api/mira/route.ts`, production `mira-adapter.server.ts` which
  calls `decideMira` in-process) inherit every guarantee automatically.

### Tickets completed
- **P2-T01 server-side session objective** — `SessionObjective` (pageContext, current
  product, intent, funnel stage, lastRecommended, rejectedHandles, lastRejectionReason,
  nextBestMove, turnCount). `emptyObjective()` (new session = empty) + `updateObjective()`.
  Threaded via `body.priorObjective` (caller-injected, session-scoped per Phase 1) and
  returned in the result for the caller to persist. Shop-scoped by construction (operates
  on the injected shop catalog); no body/size persisted.
- **P2-T02 planner + funnel + boundaries** — `planner.ts`: 10 funnel stages, 10 sales
  moves, `planTurn()` classifies intent → stage → nextMove → actionType + allowedActions
  (per stage) + GLOBAL_FORBIDDEN (fake cart/stock/discount, unsupported policy, invented
  product, auto-return, order mutation, strategy claims) + verificationRequired. Routes
  support to the safe hook only.
- **P2-T03 action router** — `router.ts`: every route maps to one WHITELISTED action;
  unknown/empty route FAILS CLOSED to `hesitation_capture`. Emits an `ActionAttempt` audit
  entry (route, action, failClosed, verified, notes). LLM never claims execution.
- **P2-T04 verification layer (no fake success)** — `verify.ts`: handle exists + shop-
  scoped; sellable (photo + in stock) for visual/cart routes; compareHandles exist;
  NO fake cart success (past-tense "in your bag" → intent, client does the real add);
  NO fake try-on render claim (→ fitting-room offer); NO fake ticket/SLA/order-mutation;
  policy answers require a real source else refuse + handoff. Unverifiable claims are
  DOWNGRADED, returning a `VerificationReport`.
- **P2-T05 deterministic services** — reuses the existing grounded services (validateHandle,
  isSellable, buildLook, budgetFacts, recommendSize, policy/closing) — facts come from the
  catalog; the LLM picks a route + entities, the deterministic layer renders/verifies.
- **P2-T06 rejection handling** — `rejection.ts`: detects price/fit/color/style/generic
  rejection + a steer directive. The envelope never re-recommends a piece in the
  rejected set / lastRecommended, and on "too expensive" swaps to a cheaper sellable piece.
- **P2-T07 card-first + voice/chip** — `enforce.ts`: voice trimmed to ≤2 sentences / 240
  chars, chips capped at 3. PDP cold-open leads with the product (no generic "what are you
  looking for"). Verified by eval #1/#2.
- **P2-T08 regex fallback through verification** — the server `buildResilientFallback`
  decision flows through the SAME `applySalesEngine` (router + verify) inside `decideMira`
  (eval #1/#2 exercise the fallback). The client-side last-resort regex engine is catalog-
  grounded (can't invent a product) and its cart add is the real `/cart/add.js` with P1
  rollback (can't fake the actual cart).
- **P2-T09 anti-chatbot eval harness** — `packages/mira-brain/scripts/anti-chatbot-eval.mts`,
  15 scenarios, exercises the REAL `applySalesEngine` code path with adversarial inputs.
  Result below.
- **P2-T10 policy grounding** — `support.ts groundPolicyAnswer()`: returns/shipping answered
  ONLY from `injectedBrand.returns/.shipping` (merchant) or the demo default; no source →
  null → refuse + handoff. Never invents a window/percentage/rule.
- **P2-T11 support intent + events** — `classifySupportIntent()` (9 intents); the envelope
  returns `support: { intent, needsHandoff }`; the demo records it on the turn signal
  (`MiraSignal.supportIntent`, flat-file). Order/return/exchange/complaint/order-status/
  human are NEVER automated (forced safe handoff). NOTE: a granular PRODUCTION support
  analytics event needs a new Prisma `EventName` enum value → a DB migration, which is
  forbidden this phase; the envelope sets `intent="support"` which the existing capture
  records DB-safely. Granular production event deferred (migration-gated).
- **P2-T12 safe handoff** — `buildSafeHandoff()`: captures session/product/issue summary,
  speaks an honest OFFER to connect; never claims a ticket was created, a human replied,
  or an order/return was processed.

### Anti-chatbot eval
- **15/15 scenarios PASS** (deterministic, no Gemini key). Covers: PDP cold-open shirt +
  coat (card-first, no generic open); "is this premium?" (verified explanation); "show me
  beige" (real product); "not this" (pick changes); "too expensive" (cheaper pick:
  wrap-coat→silk-slip); size (size_help_start); try-on (offer, fake render claim rewritten);
  complete outfit; add-to-cart (fake "in your bag" → intent); return policy (sourced, cites
  14-day); order status (safe handoff, invented "shipped yesterday" stripped); discount (no
  discount-applying action exists); invalid handle (dropped, no phantom card); not-sellable
  piece (can't be cart-claimed). Run: `pnpm --filter @stylique/mira-brain exec tsx scripts/anti-chatbot-eval.mts`.

### Typecheck/build/test
- `pnpm typecheck` 11/11 · `pnpm build` 5/5 · `pnpm test` 233 passed / 1 pre-existing
  unrelated `TRYON_BODY` failure (reproduces on parent `345a034`) · eval 15/15.

### Phase 2 gate status
- PASSED. Planner/router/verification ✓ · card-first sales behavior ✓ · support hooks ✓ ·
  anti-chatbot eval 15/15 ✓ · one brain (no second) ✓ · no fake success (structural) ✓ ·
  no DB migration · stash untouched · Creative not resurrected · Phase 3 not started.

### Blockers
- None for Phase 2. Non-blockers: pre-existing TRYON_BODY test; granular production support
  analytics event is migration-gated (deferred); cross-turn rejection memory in production
  needs the caller to persist `objective` on the ShopperSession (session-scoped store) —
  the brain returns it; demo can thread it via sessionStorage. A live-LLM eval pass (with a
  Gemini key) would additionally confirm the model's own outputs, on top of the structural
  guarantees proven here.

### Next action
- Ready for Step 2H Phase 3 (Try-On & Sizing Trust). Recommend persisting `objective` on
  the production ShopperSession to light up cross-turn rejection memory, and a live-LLM
  eval pass on a pilot store.

---

## Step 2H Phase 3 — Try-On & Sizing Trust — 2026-06-17

### Branch state
- Branch `chore/phase3-tryon-sizing-trust` off `chore/phase2-mira-sales-engine`
  (Phase 2 pushed: `6365efa`). Not merged, not deployed. No DB migration applied.
- Deterministic trust primitives live in `@stylique/core/tryon/trust.ts` (unit-tested);
  the demo render engine + API route enforce them; harnesses prove them.

### Tickets completed
- **P3-T01 full try-on cache key** — rewrote the demo render key (`buildTryOnCacheKey`,
  exported) to encode shop · muse · product handle · **variant** · **colour** · size ·
  ease-bucket · **pose** · **garment-image hash** · look/per-piece fits · **model** ·
  cache-version · prompt-version. Debuggable via `TRYON_DEBUG_KEYS=1` (paths/ids only, no
  secrets). Added `color`/`variantId`/`pose` to `TryOnRequest` + the `/api/tryon` Zod body.
- **P3-T02 cache invalidation / versioning** — new `TRYON_CACHE_VERSION="c1"` (distinct
  from PROMPT_VERSION) folded into every key → ALL pre-Phase-3 keys are different now →
  guaranteed cache MISS → fresh render. No destructive bulk delete; old wrong-colour/wrong-
  size keys can never resolve again.
- **P3-T03 product/color/variant correctness** — the route already validated handle+size
  against the real catalog; added colourway validation (an explicit `color` must be a real
  colour of THIS product → `invalid_color` else). THE REAL BUG FIXED: the focus piece's
  colourway was NOT in the old key (it used `handle`, no colour) → two colourways shared a
  render. Now `focusColorFromImage()` derives the colourway from the focus image filename
  AND an explicit `color` is folded in → ivory vs onyx never collide.
- **P3-T04 size-ladder harness** — `apps/web/scripts/size-ladder-harness.mts` runs every
  product across all sizes, asserts a DISTINCT cache key per size, and classifies each path
  honestly. **PASS: all sizes distinct; 13 products fit-visual, the one-size tote correctly
  style-preview-only.** Run: `pnpm --filter @stylique/web exec tsx scripts/size-ladder-harness.mts`.
- **P3-T05 render state machine** — `trust.ts`: explicit states (requested/queued/rendering/
  completed/failed/expired/blocked) + `canTransition` + `stateToDbStatus` (maps onto the DB
  JobStatus PENDING/RUNNING/SUCCEEDED/FAILED — no migration) + `resolveTerminalState()` which
  makes `completed` legitimate ONLY with real output (timeout→failed, error→failed, no
  output→failed, invalid input→blocked). Unit-tested. The demo render already throws on
  failure (returns success only with a real imageUrl), so no fake success at runtime.
- **P3-T06 TryOnSession without shopper-photo** — model already carries shop/shopper/
  product/status/provider/cacheKey/output/error/latency; product/variant/size/colour/muse
  are encoded in the (now-full) cacheKey (no new columns → no migration). `inputPhotoUrl`
  is NEVER written (only comments confirm "stays NULL").
- **P3-T07 no-photo verification** — grep of every render/route/server path for shopper-
  photo ingestion/persistence (`photoDataUrl`/`inputPhoto`/`selfie`/`userPhoto`/etc.)
  returns EMPTY (only removal comments). Try-on is muse/avatar ONLY; no shopper photo is
  accepted or stored anywhere.
- **P3-T08 sizing confidence fallback** — `sizingConfidenceLevel()`: high (chart+body) /
  medium (chart OR body) / low (height-weight estimate) / **unavailable** (no chart AND no
  body → honest "I can't size it accurately, want me to size you?"). `stripFitGuarantee()`
  backstops any "guaranteed/perfect fit/exact fit" language. Unit-tested.
- **P3-T09 FitSession row** — already created on size help (`shopper.server.ts`), shop+
  session scoped, GDPR-redacted (customers/shop redact). Enriched the `reasoning` JSON with
  the explicit **confidenceLevel** + **source** (chart+body / chart / body / fallback) — no
  migration (reasoning is Json). No body data persisted beyond the consented fit submission.
- **P3-T10 fit feedback / return-reason hook** — `classifyFitFeedback()` (10 reasons:
  too_small/too_large/tight_chest/tight_waist/too_long/too_short/wrong_color/fabric_issue/
  changed_mind/other) + `buildFitFeedback()` which flags `needsHandoff` when the shopper
  wants a return/exchange. HOOK ONLY — never automates a return/exchange/order; a
  return/exchange REQUEST routes to the Phase-2 safe handoff. Unit-tested.

### Product rule (honesty)
- `classifyRenderHonesty()` + `honestTryOnLabel()` label a render "Style preview" unless the
  ease genuinely varies across sizes ("fit-visual"). We never claim "this size fits",
  "rendered your body", "fit guaranteed", or "try-on completed" without verification.

### Verification results
- Trust unit tests: **14/14 pass** (`packages/core/src/__tests__/tryon-trust.test.ts`).
- Size-ladder harness: **PASS** (distinct keys + honest classification).
- No-photo grep: **clean** (no shopper-photo ingestion/persistence).
- Phase 2 anti-chatbot eval: **15/15** (no regression).

### Typecheck/build/test
- `pnpm typecheck` 11/11 · `pnpm build` 5/5 · `pnpm test` 247 passed / 1 pre-existing
  unrelated `TRYON_BODY` failure (reproduces on parent `345a034`).

### Phase 3 gate status
- PASSED. Try-on trust ✓ (full cache key, versioned, colour/variant correct) · sizing trust ✓
  (confidence levels + honest unavailable, no fit guarantee) · no-photo/privacy ✓ (muse-only,
  inputPhotoUrl never written) · harness ✓ · render state machine honest ✓ · FitSession +
  fit-feedback hook ✓ · no DB migration · stash untouched · Creative not resurrected · Phase 4
  not started.

### Blockers
- None for Phase 3. Non-blockers: pre-existing TRYON_BODY test; wiring `sizingConfidenceLevel`
  + the fit-feedback hook into the live UI/conversation surfaces is incremental (helpers are
  ready + tested; the post-purchase fit-feedback surface itself is Phase 4+ territory); a
  live render pass (with a Gemini key) would visually confirm colourway/size distinctness on
  top of the deterministic key-distinctness proven here.

### Next action
- Ready for Step 2H Phase 4 (Outcome Proof). Recommend a live render pass on a pilot store to
  visually confirm colourway + size distinctness, and surfacing the sizing confidence level
  in Mira's voice + the fitting-room UI.

---

## Step 2H Phase 4 — Outcome Proof — 2026-06-17

### Branch state
- Branched `chore/phase4-outcome-proof` from `chore/phase3-tryon-sizing-trust` (08cb17e).
- Phase 3 branch confirmed pushed to origin this session (`git push -u`, was un-tracked).
- No deploy, no DB migration applied, stash untouched, no Creative resurrection.

### Tickets completed
- P4-T01 proof-event audit — AUDIT done (no migration needed for the audit).
- P4-T02 CartIntent / cart proof — AUDITED; honest gaps logged + deferred (need migration / widget rebuild).
- P4-T03 session/order linkage — AUDITED + FIXED (linkage method + confidence recorded, migration-free).
- P4-T04 strict outcome resolver — AUDITED; honest conclusion + deferrals.
- P4-T05 honest dashboard tile — FIXED (pilot-pending state + attribution caveat).
- P4-T06 holdout label — VERIFIED none active, nothing shown (no change needed).
- P4-T07 dashboard honesty sweep — AUDITED; merchant hero made honest; rest already labelled.

### Proof-event audit (P4-T01)
- Event store: `AnalyticsEvent` (shopId, shopperId→ShopperSession, productId, name=EventName enum, payload Json, createdAt). Linkage fields available: shopId, shopperId, productId, payload Json (orderId/source on order events). NOT stored anywhere: variantId, cartToken, checkoutToken, event-version.
- Mapped requested journey events → real code events:
  - widget_live → `WIDGET_PLACEMENT_AUDIT` (placement) — present.
  - mira_opened/message → `CHAT_OPENED`/`CHAT_MESSAGE_SENT` — present.
  - product_recommended/clicked → `CHAT_COMBO_PROPOSED`/`CHAT_PRODUCT_CLICKED` — present.
  - tryon_* → `PDP_TRYON_CLICKED` + `TRYON_RENDER_REQUESTED/COMPLETED/FAILED`; TryOnSession row is the durable proof (5 rows live).
  - add_to_cart_assist → `CHAT_CART_REQUESTED`/`CART_FROM_TRYON`/`CART_FROM_WIDGET_STYLE` — present, but fired at REQUEST time, not on the real `/cart/add.js` result.
  - cart_add_attempted/_succeeded/_failed → **MISSING as distinct real-result events.** `storefront-cart.ts` calls real `/cart/add.js`, returns `{ok,real,error}`, dispatches a DOM event, posts NO server event. Enum already has `CART_FAILED`/`CART_FROM_*` so recording needs NO migration — but needs a widget rebuild + `CLIENT_POSTABLE_EVENTS` allowlist addition. DEFERRED.
  - order_created/purchase → `webhooks.orders.tsx` emits `PURCHASE {orderIdHash,totalCents}` with NO shopperId → NOT linkable. `webhooks.orders.fulfilled.tsx` emits `CART_CONFIRMED` (shopperId+productId+orderId+lineValue) — the linkable one.
  - checkout_started/support_intent/hesitation_detected/fit_feedback → not discrete events (DEFERRED; some need new enum values = migration).

### CartIntent / cart proof (P4-T02)
- `CartIntent`: id, shopId, shopperId, productIds[], comboName, status(pending/confirmed), timestamps. NO variantId, cartToken, orderId, real/demo flag, confidence.
- Created (pending) ONLY in `postComboAddAll` (`shopper-events.server.ts:220`) when "Add all" resolves real merchant variant ids server-side. Single-item `addToBag` creates NO CartIntent.
- Confirmed → `webhooks.orders.fulfilled.tsx` `cartIntent.updateMany({pending, productIds hasSome orderProductIds} → confirmed)` — a REAL order link; the only honest conversion-proof transition, correctly gated on a linked order. (0 rows live → nothing confirmed yet.)
- Real cart success/failure decided CLIENT-side (`storefront-cart.ts:62-74`), NOT recorded server-side. Demo cart cleanly separated: `onStorefront()===false → {ok:true, real:false}` (simulated); `postComboAddAll` reached only via real App Proxy, so demo "successes" can never become production outcomes.
- DEFERRED (migration/widget rebuild): distinct cart events from the real response; CartIntent variantId/cartToken/real-demo/confidence columns.

### Session/order linkage (P4-T03)
- `webhooks.orders.fulfilled.tsx` links order→ShopperSession by `shopifyCustomerId` first, else `email`. No cart/checkout token, note_attributes, landing cookie. `webhooks.orders.tsx` (PURCHASE) has NO linkage.
- FIX (migration-free): webhook now computes `linkMethod` (customer_id|email) + `linkConfidence` (high|medium) and writes both into the `CART_CONFIRMED` and `MIRA_ASSISTED_ORDER` payload Json. Unlinked orders return early, emit nothing (unlinked stays unlinked — no fake attribution).
- DEFERRED (migration): typed confidence column / enum on a dedicated outcome row.

### Outcome resolver (P4-T04)
- Existing `Outcome` model + `apps/worker/src/jobs/outcome-resolver.ts` are for **BrandRecommendation** outcomes (did a merchant action move a metric) — NOT shopper→cart→order. The `Outcome` shape (recommendationId/before/after/delta) does not fit a conversion outcome.
- Honest conclusion: CartIntent pending→confirmed (webhook-driven, real-order-gated) IS the conversion proof mechanism and refuses to confirm without a linked order. A DEDICATED conversion-Outcome model (assisted_conversion/tryon_to_cart/unlinked_order/no_outcome + confidence + proof-path) needs a schema migration → DEFERRED per the no-migration constraint.
- No revenue/conversion number is produced anywhere without a real linked order (verified): `miraAssistedRevenueCents` sums `MIRA_ASSISTED_ORDER.assistedRevenueCents`, emitted only on a real fulfilled+linked order.

### Honest dashboard (P4-T05)
- `app.dashboard.tsx` revenue hero: was "$0 · Measured" at zero (reads as a measured zero). Now: `miraAssistedOrders === 0` → "Pilot pending" ("measurement begins with your first linked order; we never show estimated/assumed revenue"). >0 → numbers + badge "Measured · attributed" + explicit caveat: attribution is order-linked by email/customer-id within 48h, directional, NOT a holdout/causal lift.
- Engagement funnel = measured counts — left as-is.

### Holdout status (P4-T06)
- No Experiment/holdout active and NO holdout/uplift/control-group result rendered anywhere (grep app.dashboard/internal.*/dashboard.server = none). Nothing to remove; no invented control group.

### Dashboard honesty sweep (P4-T07)
- Merchant: hero relabelled (above); reorder tiles already `~`/"Est."; `return on Stylique` explicitly "assisted revenue ÷ plan price" (cost ratio, not causal ROI).
- Internal/reports: EXPERT-PANEL-7 already converted speculative savings to `~`/"Est."; `assistedRevenue` is the only "Measured" figure and is real-order-sourced.
- Marketing `page.tsx` STATS (4.2×/18%/+23%) are hardcoded/fabricated — FLAGGED but OUT OF PHASE-4 SCOPE (T07 = merchant/internal/admin/reports dashboards, not the marketing site). Recorded for a separate pass.

### Verification results
- Linkage confidence stamped on both order events (Json, no migration).
- Dashboard pilot-pending vs measured-attributed states compile + render via existing Polaris components.

### Typecheck/build/test
- `pnpm typecheck` → 11/11 PASS.
- `pnpm build` → 5/5 PASS.
- `pnpm test` → 247 passed / 1 failed = the KNOWN pre-existing `TRYON_BODY` test (`packages/core/src/__tests__/plans.test.ts:52`), unchanged from the Phase 3 baseline, NOT touched here.

### Phase 4 gate status
- INCOMPLETE. Audit + migration-free honesty fixes (linkage confidence, honest dashboard hero, holdout verification, honesty sweep) DONE + verified. Acceptance criteria needing new schema or a widget rebuild are deliberately DEFERRED under the phase's no-migration/no-deploy constraints — recorded honestly, not faked.

### Blockers
- MIGRATION-GATED (phase forbids migration): dedicated conversion-Outcome model + confidence/proof-path (P4-T04); CartIntent variantId/cartToken/real-demo/confidence columns (P4-T02); discrete checkout_started/support_intent/fit_feedback enum events (P4-T01).
- WIDGET-REBUILD-GATED (phase forbids deploy): real cart_add_attempted/succeeded/failed events from `/cart/add.js` + `CLIENT_POSTABLE_EVENTS` allowlist (P4-T02).
- DATA-GATED: 0 CartIntent / 0 Outcome / 0 linked orders live — resolver + "measured" dashboard paths cannot be exercised until one real shopper completes a linked purchase (Phase 5).

### Next action
- Founder decision: approve a small additive migration (conversion-Outcome model + CartIntent linkage columns) to complete P4-T02/T04 strictly, OR approve a widget rebuild for real cart-result events. Then Phase 5 (Real Merchant Pilot) generates the first linked order to light up the honest dashboard.

---

## Step 2H — Local Runtime Debug Audit — 2026-06-17

### Why this audit was run
- Founder screenshots of the LOCAL widget showed chat-like behaviour: repeated chips,
  "what's it made of?" repeating, weak intent, cards not clearly loading, sizing not
  flowing — and a suspicion the local runtime was NOT running the Phase 0–4 fixes.
- Runtime-truth audit first, minimal fixes only. NO code changed (none warranted).

### Branch/runtime reality
- Branch `chore/phase4-outcome-proof`; contains e4c0005/6365efa/08cb17e/436ab40 (all phases).
- Three node servers listening: :3000 (twin-media-app — other project), :3001 (stylique-beauty
  — other project), :3002 = `pnpm --filter @stylique/web exec next dev` = THE local Stylique widget.

### Widget bundle loaded
- Local app = `apps/web` (Next dev, port 3002), serving live SOURCE (no stale dist).
- `@stylique/mira-brain` ships raw TS (`main: src/index.ts`, no dist) and IS symlinked into
  `apps/web/node_modules/@stylique/mira-brain` → resolves. NOTE: it is NOT listed in
  `apps/web` next.config `transpilePackages` (which lists ai/core/db/types) — yet it builds
  (pnpm build 5/5) and runs (200s) because Next transpiles the symlinked workspace source.
  Flagged as fragile hardening (add it to transpilePackages) but NOT a current bug — left as-is.

### Mira API route used
- Demo route `apps/web/app/api/mira/route.ts` → `decideMira` from `@stylique/mira-brain`.
- LIVE PROOF (curl localhost:3002/api/mira): HTTP 200, `source:gemini`, real decisions.

### Phase 2 envelope runtime proof
- `decideMira` runs `applySalesEngine` → planTurn → detectRejection → classifySupportIntent →
  routeToAction → verifyDecision → rejection handling → enforceCardVoiceChips → updateObjective.
- The envelope IS executing locally. (brain.ts:308-406.)

### Product card / grounding diagnosis
- ROOT CAUSE of the screenshot symptoms = product-handle grounding, NOT the brain.
  - With a WRONG handle (`wide-leg-trousers` — not in catalog) → Mira can't ground → generic
    `talk_only` + "anything specific?" + fabric chips → on repeat, same generic answer = the
    "repeats / weak intent / cards not loading" look.
  - With a REAL handle (`linen-relaxed-shirt`) everything works:
    - "what's it made of?" → grounded "100% linen", route=fabric, productHandle set, forward chips.
    - "what's my size?" → route=size_form, chips advance to "Start sizing".
    - "is it right for me?" → route=suitability, grounded.
- Real demo handles include `atelier-wide-leg-trouser` (NOT `wide-leg-trousers`). The widget
  derives the handle via `detectCurrentProductHandle()` (locale-prefix strip + /product(s)/<h>)
  + `hydrateMerchantCatalog` (/products.json + /products/<h>.js). Its own comment documents the
  prior "byHandle null → generic greeting" bug, already guarded. Residual risk: a PDP whose
  handle isn't in the demo catalog (or a real-store handle on the demo build) still falls to the
  generic path.

### Repeated chip / loop diagnosis
- `enforceCardVoiceChips` caps quickReplies at MAX_CHIPS=3 (enforce.ts:34). Live responses show
  3 DISTINCT forward-moving chips, no loop. The "repeat" in the screenshots is the generic
  ungrounded talk_only repeating its default fabric chips — i.e. the grounding issue above, not
  a chip-dedup bug.

### Sizing flow diagnosis
- "what's my size?" correctly routes to `size_form` with forward chips. The "Let's get this one
  sized… then L but messy" feel is the UI step transition, not a routing fault — routing is
  correct end-to-end at the API. No routing/display bug reproduced against current code.

### Fixes made
- NONE. The runtime is current and the brain behaves correctly; no clear code bug exists. Making
  a speculative change would risk regressing working code (minimal-fix discipline).

### Verification results
- anti-chatbot eval (`packages/mira-brain/scripts/anti-chatbot-eval.mts`) → 15/15 PASS.
- size-ladder harness (`apps/web/scripts/size-ladder-harness.mts`) → PASS.
- typecheck 11/11, build 5/5, test 247/1 (pre-existing TRYON_BODY) — unchanged tree from Phase 4.

### Remaining blockers
- The founder's screenshots could not be reproduced against the live local code with a correct
  handle. Two non-code causes remain to confirm on the founder's browser:
  (1) STALE browser bundle/cache (hard reload + clear local/sessionStorage), and/or
  (2) the PDP used had a handle not present in the demo catalog (grounding miss).

### Next action
- Founder: on the local site (port 3002) hard-reload with cache disabled + clear local/session
  storage, then open a PDP whose handle is in the demo catalog (e.g. `/product/linen-relaxed-shirt`)
  and retest. If it still misbehaves with a real handle, capture the Network-tab `/api/mira`
  request/response so we debug the exact payload — the brain itself is verified correct.

---

## Step 2H — Local UX Runtime Fix Pass — 2026-06-17

### Why this pass was run
- Founder screenshots on the `atelier-wide-leg-trouser` PDP: stacked bubbles, chips repeating,
  "what's it made of?" reappearing, cards not clearly visible, sizing felt messy. Goal = fix the
  user-visible widget flow (not re-prove the brain). MINIMAL fixes only; no broad refactor.

### Size memory behavior (Task A)
- Keys (all sessionStorage, set by Phase 1): `mira_size_memory_v1` (`{[handle]: size}`),
  `mira_body_v1` (`{heightCm,weightKg,fitPref}`), `mira_convo_v1` (transcript). One-time
  `purgeLegacyBodyStorage()` wipes any pre-Phase-1 device-wide `localStorage` residue.
- 1) Remembers size per-handle once sized in the SAME tab/session. 2) Forgets on tab close /
  new session / storage clear. 3) Survives same-tab reload+navigation (sessionStorage). 4) NOT
  across a new session. 5) NOT after storage clear. 6) Yes — Phase 1 deliberately moved body/size
  OFF device-wide localStorage to session-only (privacy). 7) No explicit "save my size" consented
  persistent path exists in the demo today. Correct target (NOT built this pass): session memory by
  default + a consented "save my size for next time" for persistence + clear "saved for this
  session only" UI copy. Deferred (needs a consent UI + a persistence store).

### Exact /api/mira payload findings (Task B/C)
- `atelier-wide-leg-trouser` IS in the demo catalog (catalog.ts:172): images (2), colors
  [Charcoal,Camel,Ink], sizes [XS..XL], fabric "72% wool…", size chart present.
- Live `/api/mira` (port 3002) with the REAL handle returns HTTP 200 grounded decisions:
  fabric → route=fabric ("100% linen" / wool for trouser) + forward chips; size → route=size_form;
  suitability → route=suitability. The earlier "generic/repeat" only reproduced with a WRONG handle
  (`wide-leg-trousers`), which doesn't ground → generic talk_only.

### Product card root cause (Task C)
- CSS/UI clutter, NOT data/brain. Card routes (reco/look) DO build cards for the trouser; fabric/
  suitability are insight-text routes (no card by design). Cards were pushed out of view by the
  stacked old-chip rows. Classification: **UI clutter from stale chips** (not handle/catalog/brain).

### Repeated chip / loop root cause (Task D)
- ROOT CAUSE: `MiraWidget` rendered `<QuickReplies>` for EVERY message in `messages.map` (both the
  insight and say branches), so every past assistant bubble kept showing its old, clickable chips →
  stacked bubbles + repeating chips (e.g. "What's it made of?" reappearing). This is the loop.

### Verbosity / bubble stacking root cause (Task E)
- Same cause: each turn appended a bubble AND its chip row, and all prior chip rows stayed on
  screen, so the panel filled with chips and read as chaotic. The brain already caps voice/chips;
  the bloat was the persistent old chip rows, not new content.

### Sizing flow root cause (Task F)
- Routing is correct ("what's my size?" → size_form with forward chips). The "messy" feel was the
  same stale-chip clutter around the size step; no routing/display bug reproduced. (The consented
  persistent-size copy from Task A remains a deferred enhancement, not a bug.)

### Fixes made (minimal, apps/web/app/components/mira/MiraWidget.tsx)
1. Gate chips to the latest turn: compute `lastChipIdx` (last message that carries quickReplies)
   and render `<QuickReplies>` only when `i === lastChipIdx`. Past bubbles keep their text, drop
   their chips. Kills the stacking/repeat loop and de-clutters so cards are visible.
2. Defensive chip hygiene in `QuickReplies`: `[...new Set(replies.trim())].slice(0,3)` — no
   duplicate chips, never more than 3, even if a future path forgets to cap.
- No brain/route/sizing code changed (they were already correct).

### Local smoke result (Task G — verified live in preview, port 3002)
- Opened the PDP `/product/atelier-wide-leg-trouser`, cleared storage, opened "Chat with Mira".
- After clicking through turns: exactly ONE chip group on screen (`groupCount: 1`) =
  `["Will it fit me?","Style a full look","Add to bag"]` — forward-moving, ≤3, no duplicates; the
  prior turn's "Is it right for me?"/"What's it made of?" chips are GONE. Dev server recompiled
  with no runtime error. Confirms the loop is fixed.

### Verification results (Task H)
- typecheck 11/11 · build 5/5 · test 247 passed / 1 failed (pre-existing TRYON_BODY, untouched) ·
  anti-chatbot eval 15/15 · size-ladder harness PASS.

### Remaining blockers
- None for the chip-loop/clutter fix. DEFERRED enhancement (not a bug): consented "save my size for
  next time" persistent path + "saved for this session only" copy (needs a small consent UI + store).

### Next action
- Founder hard-reload (cache disabled) on a real-handle PDP and confirm the cleaner flow. If a
  persistent cross-session size memory is wanted, approve the consented "save my size" path as a
  small follow-up (session-default stays the privacy-safe baseline).

---

## Step 2H — Runtime Action Integrity + Agentic Navigation Fix — 2026-06-17

### Why this pass was run
- Founder screenshots showed: "The fabric" → "is in your bag" (cart language on a fabric ask);
  "See them on me" → text only, no try-on; "Build the look" → no outfit card. Plus a request for
  an agentic layer (observe → infer → navigate → act → verify), not just chat.

### Screenshot regression — REPRODUCTION RESULT
- The three correctness regressions are NOT present in current code. Verified at every layer:
  - BRAIN (live /api/mira, port 3002, REAL handle `atelier-wide-leg-trouser`):
    - "The fabric" (+ hesitation history) → `route:fabric` (grounded wool answer), NOT cart.
    - "See them on me" → `route:try_on` (with productHandle).
    - "Build the look" → `route:look` (real pairing, 93%, $830).
  - CLIENT `applyDecision`: `fabric` → Fabric&care insight (no cart, 1124); `try_on` → TRYON_TRIGGER
    → opens panel (1095); `look` → `lookMsg` card (1173). "is in your bag" exists ONLY in the
    `add_to_cart` branch (1168) and the fallback buy-signal branch (718) — both gated to cart intent.
  - REGEX FALLBACK `getMiraResponse`: "the fabric" matches the fabric regex (line 639) → Fabric&care.
    There is NO path where "the fabric" yields cart/bag language.
- LIVE PREVIEW PROOF (port 3002, trouser PDP, dock open):
  - "build the look" → real LookCard rendered (next/image of trouser + merino turtleneck +
    camisole + blazer + cashmere v-neck + belt).
  - "see them on me" → TryOnPanel opened (muse picker ATHLETIC/CURVE/TALL w/ measurements +
    "GENERATE MY LOOK →"). tryOnPanelDetected:true.
- CONCLUSION: the screenshots were a STALE browser bundle. The current code's action-integrity is
  correct (also benefiting from the prior chip-gating fix).

### Root causes (per the symptoms)
- Fabric→bag / fake cart language: NOT in current code (stale bundle). "is in your bag" is gated to
  cart routes only; fabric/suitability/hesitation never reach it.
- See-on-me text-only: NOT in current code — `try_on` opens TryOnPanel live.
- Build-look no cards: NOT in current code — `look` renders a multi-piece LookCard live.

### Fixes made
- NONE new this pass — the verified integrity bugs are already correct; speculative edits to working
  paths were declined (minimal-fix discipline). The prior chip-gating + chip-dedup fix is retained
  and is the committed change.

### Cart-truth note (Task D)
- On the DEMO, add-to-bag is simulated-success (`onStorefront()===false → {ok:true,real:false}`), so
  "is in your bag" is accurate there. On a real store, `addToBag` inspects the real `/cart/add.js`
  result and ROLLS BACK + shows a "couldn't add" toast on failure (EXPERT-PANEL-7). The optimistic
  line is acceptable given the rollback; tightening it to await the cart result before speaking is a
  deferred polish, not a correctness bug.

### Agentic navigation + proactive (Tasks G/H) — SCOPED, NOT BUILT
- Partial foundation already exists: NAV_TRIGGER auto-nav on reco/navigate (applyDecision 1185/1200),
  try_on panel open, SIZE_FORM_TRIGGER, and a single proactive PDP nudge (`mira_nudged`).
- The FULL spec (whitelisted navigation executor: scroll_to_size_chart / open_product_comparison /
  focus_product_card / highlight_recommended_variant, + a client behavior-signal engine: dwell,
  repeated scroll, size-chart-open, image-zoom, multi-PDP, try-on-abandon, cart-hesitation, with
  throttled proactive prompts) is a substantial NEW system — NOT a minimal fix. Building it half-way
  would risk regressing a working widget. Recommend a dedicated scoped phase, not this pass.

### Regression tests / Verification results
- typecheck 11/11 · build 5/5 · test 247/1 (pre-existing TRYON_BODY) · anti-chatbot eval 15/15 ·
  size-ladder harness PASS.
- Live preview: fabric→fabric, try_on→panel-open, look→outfit-card all confirmed.

### Remaining blockers
- None for action-integrity (already correct). The agentic navigation executor + proactive
  behavior-signal engine (Tasks G/H) are a deliberately-deferred dedicated build (scope above).

### Next action
- Founder: hard-reload port 3002 (cache disabled) and reconfirm fabric/try-on/build-look behave
  correctly with a real handle (they do in code + live preview). Then decide whether to greenlight
  the dedicated Agentic Navigation + Proactive phase (Tasks G/H) as its own scoped build.
