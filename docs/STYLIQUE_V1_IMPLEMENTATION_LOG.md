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

---

## Step 2H — Runtime Action Integrity Fix (re-run) — 2026-06-17

### Why this pass was run
- Founder retested and reported the SAME screenshots still failing ("The fabric" → "is in your
  bag", "See them on me" → text only, "Build the look" → no card). This pass re-investigated with
  the assumption the prior "stale bundle" conclusion might be wrong.

### Screenshot regression — DEFINITIVE REPRODUCTION
- The screenshot voice lines ("What's been your experience…", "What's making you unsure…") are
  FREE-FORM LLM voice (`DecisionSchema.voice`, gemini, max 600 chars) — not hardcoded. So those
  lines are normal model output for a hesitation/suitability turn.
- The hardcoded "is in your bag" exists ONLY in the `add_to_cart` branch (MiraWidget 1168) and the
  fallback buy-signal branch (718) — both gated to cart intent. For "The fabric" to produce it, the
  BRAIN must return `route:add_to_cart`.
- TRIPLE PROOF that current code does NOT do this:
  1. Brain API (live, exact screenshot history) → "The fabric" returned `route:fabric` 5/5 times.
  2. Code trace → fabric routes to a Fabric&care answer in the brain, the regex fallback (line 639
     matches `fabric`), AND `applyDecision` (1124). No path maps "the fabric" → cart.
  3. LIVE RENDER on the founder's exact server (port 3002, dock driven through the real sequence
     "I'm not sure" → "The fabric"): Mira replied "…a soft wool blend, lovely drape…" + a
     "FABRIC & CARE" card (72% wool…); `FALSE_CART_CLAIM_PRESENT:false`. Earlier in this same pass,
     "build the look" rendered a real multi-piece LookCard and "see them on me" opened the
     TryOnPanel (muse picker + GENERATE MY LOOK). All correct.

### Root causes
- Fabric→bag / fake cart language / see-on-me text-only / build-look no-card: NONE exist in current
  code. CAUSE = a STALE BROWSER BUNDLE on the founder's tab serving old JS.
- Verified there is NO code-level forced-staleness: no service worker, no PWA/workbox, no
  next-pwa, no aggressive Cache-Control on the JS bundle (only the try-on IMAGE route caches, by
  immutable key — correct). The demo page mounts the React `MiraWidget` directly; it does NOT load
  the `public/widget.js` storefront artifact.

### Fabric / Cart / Try-on / Build-look fixes
- None warranted — the code is correct (proven 3 ways). No speculative edits made.

### Card/action renderer fix
- None needed — cards/actions render live (LookCard images via next/image; TryOnPanel opens).

### Regression tests / Verification results
- typecheck 11/11 · build 5/5 (fresh compile — proves source→output is correct) · test 247/1
  (pre-existing TRYON_BODY) · anti-chatbot eval 15/15 · size-ladder harness PASS.

### Remaining blockers
- The founder's browser is not loading fresh JS. To force fresh code, ANY of: (a) DevTools open →
  Network tab "Disable cache" checked → right-click reload → "Empty Cache and Hard Reload"; (b)
  Application tab → Storage → "Clear site data"; (c) test in an Incognito window. If it still
  reproduces in Incognito on port 3002, the dev server's `.next` cache may hold a stale chunk —
  ask CTO to clear it (`rm -rf apps/web/.next` + the running `next dev` recompiles) — NOT done
  this pass to avoid disrupting the founder's running server.

### Next action
- Founder: reload port 3002 in an INCOGNITO window (guarantees no cached bundle) and re-run the
  exact flow. It will show the correct fabric card + no cart claim (verified live). If — and only
  if — it still fails in Incognito, authorize clearing the dev `.next` cache, then capture the
  Network-tab `/api/mira` response so we have the exact server payload.

---

## Pricing-fix — voice/card price contradiction (durable)

**Symptom (founder):** on a "build the look" turn, Mira's voice said "…for a total of
$1950" while the card below said "Add entire look · US$3,540" — two totals = "it's lying."

**Root cause:** `applyDecision` (MiraWidget.tsx) pushes the raw LLM `d.voice` (free text that
names its own pieces+price) AND, separately, a card rebuilt from the catalog with the
AUTHORITATIVE total (`lookMsg`/`buildLook`). The two are built independently and never
reconciled.

**Fix:** added `stripSpokenPrice()` near `money()` and call it on `voice.text` ONLY for
card/cart-bearing routes (`CARD_PRICE_ROUTES` = look, add_to_cart, reco_handle,
reco_category, reco_filter, navigate, search). The CARD is now the single source of price
truth; the voice can never contradict it. Budget/talk_only routes keep their prices (Mira
must still answer "how much" plainly). Scrubber strips lead-in clauses ("for a total of $X",
"Together, those two pieces are $X"), tidies leftover punctuation, and re-capitalises.

**Verified:** `npx tsc --noEmit` exit 0; pure-function tested against the real failing voices
(clean output, non-price sentences untouched, prices preserved on budget turns).

---

## Step 2H — Product Runtime UX Fix Sprint — 2026-06-17

### Why this sprint was run
Founder retested the real local widget (apps/web port 3002) and the visible shopping
experience was still unacceptable: build-look returned a wall of text, recommended pieces
weren't navigable, Mira didn't notice product switches, size wording over-claimed ("saved"),
and Mira wasn't observant. This sprint fixed the ACTUAL runtime, verified in a live browser
(Claude_Preview, port 3002) — not from API tests.

### Runtime failures observed (live, port 3002)
- `Build the look` → card rendered WITH product thumbnails, but a long ~280-char "Why it's
  the strongest pairing…" paragraph (wall of text) and the pieces were NOT clickable to a PDP.
- `See them on me` → fitting room DID open with the correct product ("THE FITTING ROOM …
  Atelier Wide-Leg Trouser", h:934). This task was already working in current code.
- Product switch (trouser → turtleneck, full reload) → Mira did NOT notice: on a full-reload
  navigation the widget remounts, `approachedHandle` starts null, the SPA re-approach effect
  treats the new PDP as a fresh first approach, so no "you moved to X" line ever fired.
- Size wording → "I've got it saved" / "I've got it saved" at two sites, but the store is
  `sessionStorage` (genuinely session-scoped) — over-claims persistence.

### Product context refresh fix (Task C) — VERIFIED LIVE
`ConvoSnapshot` gains `lastProductHandle` (persisted from `approachedHandle.current`). On
restore, if the current PDP differs from the snapshot's last product, Mira opens with a
compare-aware line + chip. Live proof (trouser → turtleneck): *"You moved to the Merino
Ribbed Turtleneck — want me to compare it with the Atelier Wide-Leg Trouser, or style this
one?"* + a "Compare with the Trouser" chip. `activeProductHandle` is also re-pointed to the
new PDP so "it" means the current piece. The SPA-navigation re-approach effect got the same
compare-aware upgrade.

### Recommendation cards / navigation fix (Task D) — VERIFIED LIVE
LookCard pieces are now navigable buttons (`aria-label="View {name}"`, title shows price) →
click navigates to that piece's PDP. Live proof: clicking "View Merino Ribbed Turtleneck"
navigated to `/product/merino-ribbed-turtleneck`. Added a "Tap any piece to view" affordance
line. Whole-look try-on stays on the "Try the look ↗" button.

### Build-look visual output fix (Task E) — VERIFIED LIVE
Shortened the look reason at source (dropped the redundant "% match, the best of everything…"
tail — the % already shows as a Stat chip) and capped the rendered reason to 2 lines
(`-webkit-line-clamp:2`). Live: reason is now one clamped sentence (~139 chars vs ~280),
card still shows title + match chip + 4 product thumbnails + total + Add/Try actions.

### Try-on action fix (Task F) — VERIFIED working (no change needed)
`See them on me` opens the real TryOnPanel ("THE FITTING ROOM") for the correct product. The
earlier symptom was a stale browser bundle; current code is correct.

### Size memory wording fix (Task G) — code-verified
Both over-claiming strings changed to honest session-scoped wording:
- openMira recall → "…I'll keep that while you're browsing."
- SizeForm result → "…I'll keep it for this session."
(Store is `sessionStorage`; no consented persistent/account save exists, so no "saved for next
time" claim is made.)

### Agentic navigation layer (Task H) — existing executor documented
Client actions execute only via the whitelisted sentinels interpreted in `emitResponses`:
`NAV_TRIGGER` (navigate_to_product), `TRYON_TRIGGER` (open_tryon), `SIZE_FORM_TRIGGER`
(open_fit_helper), plus look/add-to-bag via card callbacks. Unknown text fails closed (shown
as a bubble, no action). LookCard piece navigation (Task D) extends this. No new abstraction
was introduced (lower risk than a rewrite).

### Proactive behavior (Task I) — 2 triggers added/verified
- #2 product-changed → compare offer (Task C above). VERIFIED LIVE.
- #3 size-chart opened → "Checking the size chart? Let me size the {piece} for you…" + "Size
  this one" chip, once per product, suppressed if already sized. VERIFIED LIVE by toggling the
  PDP SIZE GUIDE disclosure with the panel open.
- #1 PDP dwell nudge → pre-existing. #4 try-on-abandon → NOT added this sprint (remaining).

### Chat clutter reduction (Task J) — pre-existing, confirmed
Quick-reply chips render only on the latest turn (`i === lastChipIdx`), deduped + capped at 3
(commit 9e029c0). The shortened look reason + 2-line clamp further reduce text density.

### Runtime regression results (live, port 3002)
1. Build the look → outfit card with thumbnails + short reason: PASS
2. See them on me → TryOnPanel opens (correct product): PASS
3. Recommended look piece click → navigates to PDP: PASS
4. Product change (full reload) → Mira notices + offers compare: PASS
5. Size wording → "for this session" / "while you're browsing" (no fake save): code-verified
6. Size-chart open → proactive size offer (once/product): PASS

### Verification results
- `pnpm typecheck` (root): 11/11 successful.
- anti-chatbot-eval: 15/15 passed (no brain regression).
- size-ladder-harness: PASS (distinct cache key per size; honest classification).
- Live browser verification on port 3002 for Tasks C/D/E/F/I.
- (Also includes the prior voice/card pricing-truth fix in the same file.)

### Remaining blockers / not done this sprint
- Task I #4 (try-on opened → abandoned → offer different size/colour): not added.
- Task H formal action-executor abstraction: intentionally not built (existing sentinel
  whitelist covers it; a rewrite is higher risk).
- Task K formal runtime regression test file: live-verified instead; an automated DOM test
  harness for the widget is not yet added.
- Task G live click-through of the size form wording: code-verified only (pure string swap).

### Next action
Founder: reload port 3002 (cache disabled), run the exact flow (build look → tap a piece →
switch product → open size guide). If anything still reads wrong, capture the rendered bubble
text so we fix the exact string. Then decide whether to add Task I #4 + a Task K DOM test.

### Follow-up — context cards + tighter copy (2026-06-17)
Founder: "too many words reduce value; differentiate a new product in chat with a card."
- New `ContextCard` (ChatMsg kind `context`): a compact divider with a 30px thumbnail +
  "Now viewing" + product name + price, inserted on every product switch (restore + SPA
  re-approach paths). The thread now SHOWS the new context instead of describing it.
- Trimmed copy: product-switch line "You moved to the … want me to compare it with the …,
  or style this one?" → context card + "Compare with the {Short}, or style this one?";
  opener size offer → "Want me to size it? It's cut a little differently."; size-chart offer
  → "Checking sizes? Let me size the {piece} for you." VERIFIED LIVE on trouser→turtleneck.

### Panel-driven — complement-vs-compare + context divider redesign (2026-06-17)
Ran a 10-persona panel (6 shoppers + 4 consultants: luxury clienteling, conversational-UX,
CRO, premium-UI). Headline: "Fix the slot-based compare-vs-complement bug, turn the context
pill into a quiet serif-on-hairline divider, hard-cap every Mira line to one sentence."
Implemented the HIGH-impact items:
- **Complement vs compare (credibility fix):** new `garmentSlot()` (top/knitwear=upper,
  bottom=lower, outerwear=layer, dress=full, accessory=accent) + `switchLine()`. Different
  slot → "This pairs with the {prev}. Want the full look?" (and an honest "different lane" when
  `buildLook(cur,[prev]).score < 0.6`); SAME slot → "Two takes on the same slot — want them side
  by side?". Slot-aware chip #1 (cross-slot "Build the look", same-slot "Compare with the {x}").
  Applied at both switch sites. VERIFIED LIVE: trouser→turtleneck pairs; trouser→denim compares.
- **Context card → divider:** killed the glowing pill/box/"NOW VIEWING" caps. Now a single
  faint full-width hairline interrupted at center by a squared 28px thumbnail + serif-italic
  product name (loudest) + muted price, 14px breathing room, soft fade-in — reads like turning
  a lookbook page. VERIFIED LIVE.
- **Tighter copy:** dropped the look-card "Tap any piece to view" hint (thumbnails are visibly
  tappable); switch line is now one short sentence.

---

## Step 2H (close-out) — Action executor + abandon nudge + regression test — 2026-06-17

### Tasks closed
- **Task B — whitelisted action executor:** new `executeAction(action, params)` in `MiraWidget.tsx`
  — the ONE strict entry point for the 7 allowed actions (`navigate_to_product`, `open_tryon`,
  `open_fit_helper`, `show_outfit_builder`, `focus_product_card`, `open_cart`, `add_to_bag`).
  Fails closed on an unknown action; navigation/focus/add require a real product (`byHandle`);
  `open_tryon` mounts `TryOnPanel`; `open_fit_helper` opens `SizeForm`; **cart success is never
  claimed by the executor** — `add_to_bag` only INITIATES the add and the real Shopify
  `CartResult` (`r.real && !r.ok` → rollback) owns success. Returns `{ executed, reason, action }`.
  Wired: `emitResponses` sentinels (SIZE_FORM/TRYON/NAV → executor), reco/look card try-on +
  add-to-bag, and LookCard piece navigation (new `onView` prop) all route through it.
- **Task C — try-on-abandon nudge:** in the `TryOnPanel onClose`, when the room is closed
  WITHOUT a completed render, Mira drops ONE nudge — "No rush on the {piece}. Want me to try a
  different size or colour instead?" + chips [Try another size / Try another colour / Build the
  look]. Guarded once-per-product/session (`sessionStorage mira_abandon_<handle>`); never after a
  completed render (`abandoned = !tryOnCompleted.current`); never claims a render happened.
- **Task D — runtime regression harness:** new `apps/web/scripts/runtime-ux-regression.mts`
  (deterministic, local, no Gemini/browser — same convention as `size-ladder-harness.mts`).
  Asserts all 10 sprint UX guarantees at the source/logic level + a live `buildLook` pairing
  check. **11/11 pass.** (The live-store browser E2E remains `scripts/storefront-e2e.spec.mjs`,
  which needs a tunnelled Shopify store.)

### Manual browser smoke (port 3002, storage cleared) — VERIFIED LIVE
- See them on me → fitting room opens (THE FITTING ROOM panel) — PASS
- Close without generating → abandon nudge "…try a different size or colour instead?" + 3 chips — PASS
- Re-open + close again → NO second nudge (`mira_abandon_…=1`, spammed=false) — PASS (no spam)
- Completed-render → abandon nudge suppressed — logic-verified (`abandoned = !tryOnCompleted`)
  + asserted by the regression harness.

### Verification (Task F)
- `pnpm typecheck` — 11/11 successful.
- `pnpm build` — 5/5 successful.
- `pnpm test` — 247/248; the ONE failure is the pre-existing `TRYON_BODY` case
  (`packages/core/src/__tests__/plans.test.ts:52`) the founder said NOT to fix here.
- anti-chatbot-eval — 15/15. size-ladder-harness — PASS. runtime-ux-regression — 11/11.

### Runtime artifacts (NOT committed)
`.turbo/*.log`, `apps/web/data/*.json`, `apps/shopify-app/vite.config.ts.timestamp-*.mjs`.

### Next action
Branch `chore/phase4-outcome-proof` pushed. Founder: review, then decide on merge/deploy
(held per sprint instructions). Billing enforcement (Task #24) remains a founder decision.

---

## Step 2H — Pre-Merge 50-Scenario Mira Conversation QA — 2026-06-17

### Why this audit was run
Pre-merge product acceptance test of Mira as a real shopping agent (not just route tests).
Founder concerns: inconsistent intent, confusing/duplicate chips, semantically-wrong pairings
(e.g. dress + trouser), cards-not-text, support routing, agentic navigation.

### Scenario coverage
Drove the REAL `/api/mira` (smart Gemini path, GEMINI_API_KEY present) for the 26 conversational
scenarios (Cat 2 intent, Cat 3 build-look, Cat 5 support) + a deterministic catalog-engine
classifier for the 7 slot-pairing cases (Cat 3 complement/compare) + prior live-verified UI
behaviours (Cat 1 proactive, Cat 4 panels/nav from the Step-2H close-out turn). Route→card/action
mapped from `applyDecision`.

### Pass/fail summary
- **Cat 1 (PDP/proactive 1-8):** PASS — dwell nudge, size-chart prompt (once), try-on-abandon
  nudge (once, no spam), product-switch notice, convo memory all verified live in the close-out turn.
- **Cat 2 (intent 9-25):** 16/17 clean. fabric→InsightCard no-cart ✅; will-it-fit/my-size/size-it
  → size_form ✅; suitability/not-sure/dislike/too-formal → consultative talk_only ✅; too-expensive
  → price-objection + budget chips ✅; dinner/office/modest → occasion ✅; "goes with this" → look
  card ✅; "add it" → CartLine ✅. **One soft miss:** "show me something similar" → talk_only that
  qualifies first (chips lead to alternatives on one tap) — defensible consultative behaviour, not
  a wrong action → P2.
- **Cat 3 (pairing 26-36):** build-look returns a real LookCard with a coherent complement on all 4
  anchors (trouser→turtleneck, shirt→denim, turtleneck→trouser, skirt→camisole). Slot logic correct
  for 31 (pairs), 32 (compare), 34 (compare), 30 (pairs) — **except 33 dress→trouser, FIXED below.**
- **Cat 4 (cards/nav/actions 37-45):** PASS — reco/look cards render with image+price; card click →
  PDP; "see it on me" → fitting room; size chip → SizeForm; add-to-bag → real CartResult (no fake
  success); all routed through the whitelisted `executeAction` executor (Step-2H close-out).
- **Cat 5 (support 46-50):** PASS — "talk to someone"/"order issue" → handoff voice ("I'll pass you
  to the store's team", "flag the team to reach out") with intent=support, NOT styling; "return
  policy" → grounded 14-day policy; "delivery" → grounded "complimentary worldwide shipping" (an
  authoritative brand SHIPPING POLICY fact, not a fabrication). "I need help" → discover (ambiguous
  shopping-help read; no support chip) → P2.

### P0 blockers found
NONE. No fake cart success, no wrong-action intent, no card-missing-where-required, no
support→styling misroute, no stale-context, no crash.

### P1 fixes made
**Semantic pairing — dress + bottom wrongly "pairs" (scenario 33).** `switchLine` branched only on
same-slot vs different-slot, so a dress (full-body) + trouser scored 0.73 on `buildLook` and Mira
said "This pairs with the Trouser." A dress is a whole outfit. Fix: a `full`-slot piece now only
COMPLEMENTS a `layer` (coat/jacket) or `accent` (bag/belt/jewellery); against a top/bottom/other
dress it's COMPARE ("A dress is a whole look on its own — want them side by side?"). Symmetric
(dress→trouser AND trouser→dress). Verified via the catalog engine: 33 dress→trouser → COMPARE,
33c dress→coat → PAIRS-as-LAYER, 30 shirt→skirt still PAIRS, 34 shirt→shirt still COMPARE.

### P2 deferred items
- "Show me something similar" qualifies before showing alternative cards (one extra tap to cards) —
  prompt-behaviour tradeoff with the qualify-first rule; not a wrong action.
- "I need help" reads as shopping-discovery, no explicit "Talk to support" chip (ambiguous input).
- A dedicated visual support BUBBLE (vs a say-bubble + handoff chip) — current handoff is functional.

### Pairing logic findings
top+bottom / knitwear+bottom / shirt+skirt → complement (pairs). bottom+bottom / shirt+shirt →
compare (same slot). dress + top/bottom/dress → compare (whole look). dress + coat/accessory →
layer/accent complement. All now honest; no forced pairs.

### Support/handoff findings
Support intent (return/order-issue/human) correctly classified intent=support and produces a safe
handoff voice with no order mutation and no invented ticket. Policy questions (returns/shipping)
answered from the authoritative brand facts only.

### Cards/navigation findings
reco/look routes render real cards; look pieces + reco cards navigate to PDP via the executor;
try-on/size chips open the real panels; add-to-bag never claims success without the real cart result.

### Chip/bubble findings
Chips are distinct and action-based (e.g. "Build the look / Style this / My size?"), latest-row-only,
deduped/capped at 3. Sizing chips read "Start sizing" (not three near-duplicate "size it/will it
fit/is it my size" together). No duplicate-meaning chips observed across the 26 live turns.

### Verification results
typecheck 11/11 · build 5/5 · test 247/248 (only the pre-existing TRYON_BODY) · anti-chatbot-eval
15/15 · size-ladder PASS · runtime-ux-regression 11/11.

### Merge recommendation
MERGE — no P0 blockers; the one proven P1 (dress-pairing) is fixed + verified. P2 items are
polish, not pilot-blocking.

---

## Step 2H — Intent-driven proactivity (Mira is not a chatbot) — 2026-06-17

### Why
Founder: "as soon as we enter the store Mira pops up — but it's not a chatbot. It should
appear at INTENT: when the user is stranded a long time, shifts to multiple articles without
checking out, looks at different colours/sizes, or zooms out." The old proactive nudge fired on
a blunt timer / 40%-scroll on ANY page (incl. the homepage on entry) — that reads as a chatbot.

### What changed (apps/web/.../MiraWidget.tsx)
Replaced the timer/scroll nudge effect with an INTENT-driven trigger system. Mira never pops on
store entry or a plain timer; she approaches once per session (never auto-opens) on a real
buying-intent signal, each with its own honest line + intent-specific `nudgeText`:
1. **Multi-article browsing** — ≥3 distinct PDPs viewed this session (`mira_viewed` sessionStorage
   set), no checkout → "You've looked across a few pieces — want me to narrow it to the one…?"
2. **Variant interaction** — color/size toggled twice (capture-phase click detector: size tokens
   XS–XXXL/numeric, or buttons inside size/colour/swatch/variant containers, or colour-word labels)
   → "Comparing the colours and sizes? Tell me your usual and I'll pin the right one."
3. **Exit / zoom-out intent** — `mouseout` with `clientY<=0` (cursor leaves toward the address
   bar/close) → "Before you go — want me to save your size on the {piece}, or build the look first?"
4. **Stranded** — long PDP dwell (22s) with NO scroll and no add-to-cart → "Still deciding? I can
   give you my honest read or size it in a few seconds."
The homepage/collection timer pop was removed entirely.

### Verified live (port 3002, fresh server)
- **No pop on store entry** — homepage, scrolled 60%, waited: NO nudge. PASS.
- **Variant interaction** — clicked XS then L on a PDP → "Comparing the colours and sizes…". PASS.
- **Exit intent** — `mouseout clientY:0` on a PDP → "Before you go — want me to save your size on
  the Atelier Wide-Leg Trouser…". PASS.
- **Stranded** — 22s on a PDP without scrolling → "Still deciding?…". PASS (fired during testing).
- **Multi-article** — 3rd distinct PDP → fire() executed (`mira_nudged=1`, `mira_viewed` length 3);
  bubble auto-hid before capture due to tool latency, text is the deterministic source line. PASS
  (functional).

### Verification
typecheck 11/11 · anti-chatbot-eval 15/15 · runtime-ux-regression 11/11.

### Note
Each signal fires at most once per session (`mira_nudged` guard) and only when the panel isn't
already open — no spam, no double-greet on a restored conversation.

---

## Step 2H — 50-scenario REAL transcripts + order-issue handoff fix — 2026-06-17

### What this is
Verbatim Mira output captured live from `/api/mira` (smart Gemini path) — the actual message,
chips, and card she presents per scenario. Running the real conversations surfaced one genuine
P0 the summary table had missed, now fixed.

### P0 FOUND + FIXED — "I have an order issue" was getting a SALES pitch, not a handoff
Live #50 returned: *"This is a beautiful trouser, it hangs perfectly. I can help with sizing, or
build a full look?"* with styling chips — an order problem must hand off, not sell. Root cause:
`classifySupportIntent("I have an order issue")` returned `null` (no pattern matched "order
issue"), so the deterministic handoff was skipped and the LLM free-styled. Fix
(`packages/mira-brain/src/support.ts`): new `order_problem` support intent (regex: order
issue/problem, issue/problem with my order, my order is/hasn't/didn't, wrong size/item arrived,
missing item) classified BEFORE order_status and routed through `supportNeedsHandoff` → the brain
forces `talk_only` + handoff voice + ["Connect me", "Keep shopping"]. VERIFIED LIVE across 4
phrasings:
- "I have an order issue" → "Let me get the store's team onto your order — they can sort this
  directly. Want me to connect you?" [Connect me | Keep shopping]
- "my order hasn't arrived" / "wrong size arrived" / "there's a problem with my order" → same handoff.
- "I need help with my order" → support chip ("General support") offered.
Bare "I need help" → stays shopping-help (a floor associate's correct read on a PDP) — P2, left.

### Real transcripts (live /api/mira, verbatim) — representative
- **#9 "What's it made of?"** → *"The Atelier Wide-Leg Trouser is a premium wool blend, designed
  for structure and drape. What are you looking to wear it for?"* · [What's my size? | See it on
  you | Build the look] · INSIGHT CARD (fabric) · no cart.
- **#12 "Will it fit me?"** → *"…runs true to size in the waist, but it's cut for a longer torso.
  If you're under 5'4", you'd likely need a slight hem."* · [Start sizing | See it on you | Build
  the look] · opens SIZE HELPER.
- **#17 "Too expensive"** → *"That's fair. What were you hoping it would come in around?"* ·
  [Under $300 | Under $400 | Open] · price objection.
- **#23 "Show me something that goes with this"** → *"…I'd pair it with the Merino Ribbed
  Turtleneck for a clean, monochromatic look, or the Ivory Silk Camisole for a soft contrast."* ·
  [Size the pieces | See whole look | Add full look] · OUTFIT CARD.
- **#25 "Add it"** → *"I'll put the Atelier Wide-Leg Trouser in your bag. Want the full look, or
  straight to checkout?"* · [Build the look | Checkout] · CART LINE.
- **#26 build-look (trouser)** → *"…with the Merino Ribbed Turtleneck… The two together would be
  $830."* · OUTFIT CARD with total.
- **#29 build-look (skirt)** → *"The Pleated Satin Midi Skirt pairs with the Ivory Silk Camisole…
  finish with the Saddle Leather Belt. Together, those three pieces are $1290."* · OUTFIT CARD.
- **#47 "Can I talk to someone?"** → *"I'll pass you to the store's team — they can pick this up
  directly."* · [Connect me | Keep shopping] · support handoff.
- **#48 "What's your return policy?"** → *"We offer returns within a 14-day window, on unworn
  items with original packaging…"* · grounded policy, no fabrication.
- **#49 "Is delivery available?"** → *"…complimentary worldwide shipping, 2–4 business days within
  the country, 5–9 internationally."* · grounded shipping fact.
(Full 26-row capture is reproducible via /tmp/mira-50-proof.mjs against the running dev server.)

### Pass tally (live)
Cat 2 intent 17/17 honest routes (fabric→insight, fit→size_form, price→objection, occasion→qualify);
Cat 3 build-look 4/4 coherent OUTFIT CARDS with totals; Cat 5 support 5/5 (after the order_problem
fix). 0 fabrications, 0 fake cart success.

### Verification
typecheck 11/11 · anti-chatbot-eval 15/15 · runtime-ux-regression 11/11.

---

## Step 2H — Final Mira Conversation Contract Fix — 2026-06-17

### Why this pass was run
Founder reviewed the real `/api/mira` transcript and found Mira identifies intent but the
user-facing behaviour still drifts: support/policy turns sell, "show me similar" asks "why?"
instead of showing cards, ambiguous "help" gives a styling pitch, chips duplicate meaning, and
cart language claims success early. This pass enforces a deterministic route-by-route contract.

### Real transcript failures (from the live run)
- "Show me something similar" → talk_only, "What made you want similar?", NO cards.
- "I need help" → styling pitch, no support option.
- "I have an order issue" → previously sold (fixed bc75c89; re-tested).
- "What's your return policy?" → policy then SALES chips (Size this trouser / Build a look).
- "Is delivery available?" → product praise + shipping + styling chips.
- "The fabric" → answer + a vague "what are you after?" tail.
- sizing → near-duplicate sizing chips risk.
- "I need it for office" → only a follow-up question.
- black tie on a casual piece → didn't reject the piece.

### Conversation contract changes
New `packages/mira-brain/src/contract.ts` → `enforceConversationContract()`, run after the LLM
decision + support handoff, before the voice/chip cap (`brain.ts`). Deterministic, pure:
- support handoff → ["Connect me", "Keep shopping"], no styling.
- returns/exchange policy → grounded answer (non-policy sentences stripped) + ["Start a return",
  "Talk to support", "Keep shopping"].
- shipping/delivery → grounded fact only (product praise stripped) + ["Track an order", "Talk to
  support", "Keep shopping"]. Broadened `shipping_policy` regex (`support.ts`) to catch "delivery
  available / do you deliver / is delivery / ship to".
- "show me similar / alternatives / not this" + valid same-category alternatives → route
  reco_category (same slot) → PRODUCT CARDS + ["Compare options", "Show cheaper", "Build a look"].
- ambiguous "I need help" → shopping-vs-support split + ["Shopping help", "Talk to support",
  "Keep shopping"].
- black tie / gala on a CASUAL piece (top/knit/bottom/accessory) → honest reject + a real formal
  alternative as a card + ["Show formal options", "Build a look", "Keep it casual"].
- fabric → trailing follow-up question dropped.
- canonical, de-duplicated chips per route (one sizing chip = "Find my size").

### Chip/bubble normalization
Canonical vocabulary (Find my size · See it on me · Build a look · Compare options · Show cheaper ·
Talk to support · Connect me · Keep shopping · View bag · Track an order · Start a return · Shopping
help). Max 3, deduped, route-specific override of the LLM chips; one sizing chip only.

### Support bubble / handoff
Client renders every `intent==="support"` turn as a visually distinct **"STORE SUPPORT"** insight
card (accent border + label), never a normal styling bubble. Verified live (DOM): "I have an order
issue" → STORE SUPPORT card + [Connect me | Keep shopping]. No fake ticket / SLA / order mutation.

### Cart truth fix
Client add bubbles no longer claim success before the result: single → "Adding the {name} to your
bag now…", bundle → "Adding the full look now…"; the CartLine + optimistic-rollback toast carry the
real outcome.

### Before/after transcript proof (live /api/mira, verbatim)
| # | user | BEFORE | AFTER |
|---|------|--------|-------|
| 1 | Show me something similar | talk_only · "What made you want similar?" · no cards | **reco_category** · "Here are a few pieces close to the Atelier Wide-Leg Trouser." · [Compare options \| Show cheaper \| Build a look] · CARDS |
| 2 | I need help | talk_only styling pitch · no support | "I can help with fit or styling… or connect you to the store team — which way?" · [Shopping help \| Talk to support \| Keep shopping] |
| 3 | I have an order issue | sold the trouser | "Let me get the store's team onto your order… Want me to connect you?" · [Connect me \| Keep shopping] |
| 4 | What's your return policy? | policy + Size/Build chips | "We offer returns within a 14-day window for unworn items with original packaging." · [Start a return \| Talk to support \| Keep shopping] |
| 5 | Is delivery available? | praise + shipping + styling chips | "We offer complimentary worldwide shipping… Duties settled at checkout." · [Track an order \| Talk to support \| Keep shopping] |
| 7 | The fabric | "…linen. What are you after?" | "The Linen Relaxed Shirt is a beautiful, breathable linen, meant to drape." · [Find my size \| See it on me \| Build a look] |
| 8 | Will it fit me? | sizing | size_form · [Find my size \| See it on me \| Build a look] (one size chip) |
| 9 | I need it for office | only a question | qualifier + [Build a look \| Show me options \| Find my size] |
| 10 | black tie + casual knit | didn't reject | **reco_handle** → Onyx Silk Slip · "The Cashmere V-Neck is too casual for black tie — I'd put you in the Onyx Silk Slip instead." · [Show formal options \| Build a look \| Keep it casual] |

### Regression coverage
New `packages/mira-brain/scripts/contract-regression.mts` (deterministic, no Gemini) — 11 cases
covering all 10 contract rules → **11/11 pass**.

### Verification results
typecheck 11/11 · build 5/5 · test 247/248 (only the pre-existing TRYON_BODY) · anti-chatbot-eval
15/15 · size-ladder PASS · runtime-ux-regression 11/11 · contract-regression 11/11.

### Remaining P2 deferred
Shipping/returns voice praise-strip is sentence-level (keeps any sentence mentioning the policy) —
an unusual phrasing could keep a stray clause; chips are always correct. "I need help with my
order" (mid case) → support chip offered but not a full handoff. Bare "I need help" → split (done).

### Merge recommendation
MERGE — all 10 transcript failures fixed + verified live, deterministic regression added, gates green.

---

## Step 2H — Stage-Aware Mira Sales Associate Fix — 2026-06-17

### Why this pass was run
Founder: Mira still behaves like a reactive chatbot — chips are random options, not
stage-aware next moves. A shopper unsure about fabric doesn't need "Build the look"; an
"office?" shopper needs a direction, not another question; a comparison shopper needs
"Pick this one / Compare / Show cheaper". Founder correction: a shirt CAN go with a skirt —
block bad pairing logic (shirt+shirt, bottom+bottom, dress+trouser), not shirt+skirt.

### Conversation stage model
New `deriveStage(message, decision, isSupport)` (`packages/mira-brain/src/contract.ts`) →
10 stages: arrival · product_understanding · fit_sizing · style_direction · outfit_building ·
comparison · alternative_search · try_on_decision · cart_decision · support_policy. Derived
from route + intent + message regex, support-first.

### Stage-aware chip planner
`planStageChips(stage)` returns ≤3 distinct, mutually-supportive next-move chips, replacing the
route-canonical defaults. Verified live per stage:
- product_understanding / fit_sizing → Find my size · See it on me · Build a look (ONE size chip)
- style_direction → Build a look · Show me options · Find my size (actionable, never only a question)
- outfit_building → Add the look · Try the look · Find my size
- comparison → Pick this one · Compare options · Show cheaper
- alternative_search → Compare options · Show cheaper · Build a look (+ product CARDS)
- try_on_decision → See it on me · Find my size · Build a look
- cart_decision → View bag · Complete the look · Keep shopping
- support_policy → Connect me · Keep shopping

### Product knowledge / outfit logic
Slot compatibility verified 8/8 (client `switchLine` slot + buildLook colour/proportion score):
shirt+skirt → **PAIR (valid)**, shirt+shirt → COMPARE, trouser+turtleneck → PAIR, trouser+denim →
COMPARE, dress+trouser → COMPARE (a dress is a whole look), dress+coat → PAIR (layer), bottom+bottom
→ COMPARE, coat+coat → COMPARE. The founder's correction (shirt+skirt valid) holds.

### Color harmony / navigation
buildLook already scores colour harmony (HSL) + proportion + slot + formality + desirability; reco
+ look cards render image/price/why and navigate to the PDP via the whitelisted executor (prior
passes). No regression. (Deeper named-colour prescriptions remain P2.)

### Proactive behavior changes (Task I)
The 4 intent nudges now carry stage-specific copy + chips and, when clicked, SEED Mira into that
stage instead of the generic opener: multi-product → "narrow it to the best one" + [Pick the best
one · Compare options · Build a look]; variant → "deciding between size or colour" + [Find my size
· Compare colours · See it on me]; exit → "save you time" + [Find my size · Build a look · Show
better option]; stranded → "worth it for you?" + [Give me the verdict · Find my size · Build a
look]. Still: no entry/homepage pop, once per session, none during a support issue.

### Support and policy behavior
Unchanged from the contract pass (73db0f3): support/policy turns render as a distinct STORE
SUPPORT bubble + support chips, grounded answers (no praise/styling), order issues hand off.

### Before/after transcript proof (live /api/mira)
| stage | user | BEFORE chips | AFTER chips |
|-------|------|--------------|-------------|
| product_understanding | What's it made of? | mixed | Find my size · See it on me · Build a look |
| fit_sizing | Will it fit me? | dup-sizing risk | Find my size · See it on me · Build a look |
| style_direction | I need it for office | only a question | Build a look · Show me options · Find my size |
| outfit_building | Build the look | generic | Add the look · Try the look · Find my size |
| comparison | compare these | poetic | Pick this one · Compare options · Show cheaper |
| alternative_search | Show me similar | "why?" no cards | reco_category CARDS + Compare options · Show cheaper · Build a look |
| cart_decision | Add it | mixed | View bag · Complete the look · Keep shopping |
| support_policy | I have an order issue | sold | Connect me · Keep shopping |

### Regression coverage
`packages/mira-brain/scripts/contract-regression.mts` extended → **21/21** (10 contract rules +
10 stage-model cases + one-size-chip). Pairing matrix verified 8/8 via the client engine.

### Verification results
typecheck 11/11 · build 5/5 · test 247/248 (only pre-existing TRYON_BODY) · anti-chatbot-eval
15/15 · size-ladder PASS · runtime-ux-regression 11/11 · contract-regression 21/21 · pairing 8/8.

### Remaining deferred items
P2: named-colour prescriptions ("use ivory with this black trouser") — engine scores harmony but
voice doesn't always name the exact colour; bare "I need help with my order" offers a support chip
but not a full handoff. Live nudge-seeding DOM re-confirm pending a clean preview (logic typecheck-
clean; trigger verified in 2442a55).

### Merge recommendation
MERGE — stage model + stage-aware chips live-verified, pairing matrix correct (incl. shirt+skirt),
all gates green, deterministic regression 21/21.

---

## Step 2H — Final Stage-Aware Mira Visual Confirmation — 2026-06-17

### Browser confirmation (live, port 3002, DOM-verified — not just API)
1. Entry chips → [Find my size · See it on me · Build a look] — PASS (after fix below)
2. "Will it fit me?" → size helper opens + ONE size chip [Find my size · See it on me · Build a look] — PASS
3. "Show me something similar" → 3 same-slot reco CARDS + "Here are a few pieces close to the …" +
   [Compare options · Show cheaper · Build a look], no "why?" — PASS (after fix below)
4. "Build the look" → outfit card "THE EDIT", total $2,040, 4 clickable pieces, match %,
   [Add the look · Try the look · Find my size] — PASS
5. "I have an order issue" → distinct STORE SUPPORT bubble + [Connect me · Keep shopping], no styling — PASS
6. "What's your return policy?" → grounded 14-day + [Start a return · Talk to support · Keep shopping] — PASS (API + live)
7. "Is delivery available?" → grounded shipping (no praise) + [Track an order · Talk to support · Keep shopping] — PASS (API + live)
8. Homepage landing + scroll → NO pop (mira_nudged null) — PASS
9. **Proactive nudge seeding (the previously-pending item)** — variant nudge fired ONCE with
   intent-specific copy ("deciding between size or colour"); clicking it opened Mira and SEEDED the
   conversation with stage-specific chips [Find my size · Compare colours · See it on me] (not
   generic) — PASS
10. trouser→turtleneck → "This pairs with the Trouser…" + context card + [Build the look · Style this
    · My size?] (complement); trouser→denim → "Two takes on the same slot…" + [Compare with the
    Trouser · Style this · My size?] (compare) — PASS

### Two small fixes needed for full visual pass
- `MiraWidget.tsx` openMira arrival opener chips: "Size this one / What goes with it? / Is it right
  for me?" → canonical [Find my size · See it on me · Build a look] (matches the stage planner).
- `contract.ts` "similar" branch: now forces same-slot reco_category multi-cards regardless of the
  LLM's route (was gated to talk_only/suitability), so "show me similar" always renders alternatives
  + [Compare options · Show cheaper · Build a look], never a single piece or a "why?".

### Quality gates
typecheck 11/11 · build 5/5 · test 247/248 (only pre-existing TRYON_BODY) · anti-chatbot-eval 15/15
· size-ladder PASS · runtime-ux-regression 11/11 · contract-regression 21/21.

### Delta safety
No schema.prisma / migrations / shopify.app.toml / env / Railway changes — brain + widget
conversation logic only.

### Merge recommendation
MERGE — all 10 user-visible behaviours confirmed in the browser; the pending nudge-seeding item is
now visually verified; gates green.

## V1 Live Store Smoke + Dashboard Scorecard Audit — 2026-06-20

### Deployment state
- `origin/main = 0546c7f` (HEAD confirmed); Shopify app `stylique-fashion-41` released.
- Railway: stylique-app / stylique-worker / stylique-web all ● Online; Redis ● Online.
- Working tree has uncommitted prior-turn changes (dead-code sweep, landing-page positioning/photo fixes, types CREATIVE_* sweep, storefront catalog.ts harmony floor) — NONE touch dashboard code; NOT deployed; awaiting founder go-ahead.

### Shopify app / re-consent (Tasks B) — BLOCKED (cannot execute)
- Requires authenticated session in the merchant Shopify admin. The App Proxy is HMAC-signed and cannot be driven externally. Not faking a PASS. Code wiring (embedded auth, app.dashboard loader) verified present.

### Storefront widget (Task C) — BLOCKED (cannot execute)
- Requires the live storefront browser. `/public/widget.js` = 200 (served). Single-source widget confirmed in code (no ScriptTag+TAE double-mount path in source).

### Mira PDP smoke (Task D) — BLOCKED (cannot execute live)
- Requires the installed storefront. Contract/stage-chip/support-routing logic verified GREEN in prior harnesses (contract-regression 21/21, anti-chatbot 15/15). Live browser confirmation still owed by founder.

### Widget-live beacon (Task E) — PASS (server evidence)
- `WIDGET_PLACEMENT_AUDIT` = 6 rows, all within 30d window → `widgetLive=true` (GREEN). Logic at dashboard.server.ts:40-104 correct.

### Dashboard scorecards (Task F) — PASS (code honest; live DB cross-checked)
Live DB (shop stylique-fashion-dev), 30d window:
- chatSessions (CHAT_OPENED)=5 · chatTurns (CHAT_MESSAGE_SENT)=46 · combosProposed (CHAT_COMBO_PROPOSED)=176 · WIDGET_FIT_SUBMITTED=1 · tryOnSession=5 · catalogGap(real)=1807 → ALL REAL, correctly sourced.
- CART_CONFIRMED / CART_FROM_MIRA / CART_FROM_TRYON / CART_FROM_WIDGET_STYLE / MIRA_ASSISTED_ORDER / SIGNUP_CLAIMED = 0 (never fired) → revenue/ROI/AOV/repeat/conversion all 0.
- Outcome hero gated on miraAssistedOrders>0 → renders "pilot pending", NOT a fake $0 Measured headline. HONEST.
- Reorder intelligence = "Est." labeled. No fake revenue/ROI/uplift. No Creative Studio metrics.

### Event pipeline (Task G) — Partial (server-side verified)
- Stored & read correctly: CHAT_OPENED, CHAT_MESSAGE_SENT, CHAT_COMBO_PROPOSED, CHAT_SEARCH_RUN(1768), CHAT_PRODUCT_CLICKED(27), WIDGET_FIT_SUBMITTED, WIDGET_PLACEMENT_AUDIT, MIRA_SIZE_HELP_STARTED(5).
- Never stored: CART_CONFIRMED + CART_FROM_* + MIRA_ASSISTED_ORDER + SIGNUP_CLAIMED. 4 CHAT_CART_REQUESTED exist but 0 cart-add/confirm events — needs live add-to-cart verification (founder browser).
- TRYON_RENDER_FAILED=24 with 0 TRYON_RENDER_REQUESTED/COMPLETED — render path failing; OUT OF SCOPE ("do not change try-on") — flagged.

### Scorecard root-cause classification (Task H)
- Revenue / ROI / AOV / repeat / conversion / cart-from-* / signups = **Category 1 (no live event yet)** — honest empty already implemented ("pilot pending"). No code fix.
- VTO requested/completed=0 vs failed=24 = render-emission inconsistency → try-on pipeline (Category 2/3) but EXPLICITLY out of scope.
- No Category 6 (deprecated) or Category 7 (fake) metrics found — those were already cleaned (Creative Studio removed, Est. labels added).

### Issues found / Fixes applied
- No new P0/P1 DASHBOARD code bug found — the dashboard is honest and correctly sourced. NO dashboard code edited this pass.
- P1 (storefront, separate surface, fix already staged uncommitted last turn): Mira reco-card "% match" badge collapsed to 0 on empty colors → analyzeColorHarmony neutral floor. Not part of this dashboard task; awaiting deploy decision.

### Verification
- No source changed this pass → no new harness run required. (Prior staged changes: typecheck 11/11, core 230/231 with pre-existing TRYON_BODY.)

### Remaining P2 / Phase 5
- Live browser smoke (Tasks B/C/D + add-to-cart truth + widget visual) — founder action on the installed store.
- TRYON_RENDER_FAILED investigation (out of scope here).

### Final verdict
- Dashboard scorecards: CORRECT + HONEST (zeros are real no-purchase-yet empties, not bugs). Deployed code at 0546c7f. Live storefront UX smoke still requires founder browser confirmation.

## Live Widget Runtime Reset — 2026-06-20

Founder visually tested the live/demo widget; 8 visible runtime issues. Fixed only the widget runtime layer (`apps/web/.../MiraWidget.tsx`) — no DB/schema/migration, no billing, no try-on engine, no Phase 5.

### Root causes + fixes (all in MiraWidget.tsx unless noted)
1. **Proactive "Before you go" fired on arrival/scroll.** `onExit` triggered on the FIRST `mouseout` past the top edge — no dwell/engagement gate. → Gated to TRUE exit-intent only: `!relatedTarget` (cursor genuinely left the window) + ≥18s dwell + prior scroll engagement. Copy de-guilted.
4. **Stale "A dress is a whole look on its own" on non-dress pages.** `switchLine` dress branch fired when the PREVIOUS piece was a dress and the current is a trouser/top. → Dress-completeness copy now only when the CURRENT piece is the dress; prev-was-dress → neutral compare line.
5. **Repetitive/generic + inconsistent chips ("My size?" / "Size me" vs brain's "Find my size").** → Canonicalized the widget fallback/nudge chip vocabulary to the brain's single source: `"Size me"`/`"Size this one"`→`"Find my size"`, `"Style this"`→`"Build a look"`; verified no duplicate chip in any array.
6. **"Try the look" misleading** — the LookCard button calls `onTryOn(look.anchor)` (anchor piece only, not the whole look). → Relabelled per-piece from the anchor's garment noun ("Try the trouser ↗"), fallback "Try this piece ↗". (TryOnPanel's real combined "Try the look on · N pieces" button is genuine multi-garment try-on — left as is.)
8. **Verbose filler.** Removed the trailing "Tell me more if I've missed the mark." bubble from the regex fallback.

### Not changed (verified already-correct or out of scope)
- #2 intent/state, #3 card consistency, #7 navigation: card render path + nav are single-sourced + harness-green (runtime-ux 11/11); the storefront card "% match" empty-color collapse was already fixed (catalog.ts harmony neutral floor, prior turn). Support/order routing → Store Support verified by contract-regression 21/21.

### Verification
- typecheck 11/11 · anti-chatbot-eval 15/15 · contract-regression 21/21 · runtime-ux-regression 11/11 · size-ladder PASS.
- Widget bundle rebuilt (206.9KB → shopify-app/public/widget.js). Demo serves 200.

### Visual flows
- Logic-verified + harness-green. Full interactive storefront flows (install/support/cart-truth) still require founder-browser confirmation on the installed store — cannot be driven externally (HMAC App Proxy).

## Mira Runtime Unification Remediation — 2026-06-20

### Active deploy source
- `ACTIVE_DEPLOY_SOURCE = /Users/apple/Desktop/stylique  re build/fashion`
- Parent repo `/Users/apple/Desktop/stylique  re build` is a separate dirty git repo with deleted old app tree and untracked `fashion/`; active deploy docs/TOML point to `fashion/` + Railway `stylique-app-production.up.railway.app`.

### Root cause
Repeated fixes were landing against overlapping layers: server brain/contract, client regex fallback, widget cart messages, Shopify product hydration, and dashboard event vocabulary. The remediation tightened those boundaries without migrations, billing, or try-on rendering changes.

### Fixes applied
1. **Mandatory cart executor path.** Chat `kind:"cart"` now carries handles/pieces and routes through `executeAction("add_to_bag")` / `addLook`; no local cart/toast success branch remains.
2. **Cart truth.** `addToBag` and `addLook` update the visible bag only after `addToCart` / `addOutfitToCart` returns `ok`; failures show honest retry copy.
3. **Client fallback constrained.** Legacy regex fallback is fenced off; fallback now emits only a short brain-loading failure message, with no product recs, look builds, size advice, navigation, or fake cart.
4. **Live product normalization.** Shopify product hydration now runs through `normalizeShopifyProduct`, maps dress/trouser/V-neck/cardigan/etc deterministically, extracts tags/description/fabric/fit/care hints where present, and marks unknown taxonomy as `category:"unknown"` instead of silently `top`.
5. **Unknown-slot copy guard.** Product switch/opening copy avoids dress/top-specific language when category confidence is low.
6. **Navigation source.** Product URLs read `window.__sqProductSeg` lazily and server navigation triggers use the executor on storefronts only when the handle resolves in the current catalog.
7. **Proactive nudge thresholds.** Stranded PDP dwell is 45s, exit intent is top-edge after 20s, and copy uses the approved restrained lines.
8. **Event bridge transition.** Dashboard counts old chat names plus available Mira aliases; `MIRA_NEAR_MISS` ingests without becoming CatalogGap unless explicitly marked missing, while `MIRA_UNMET_DEMAND` remains the deliberate gap event.
9. **Objective persistence.** Brain `objective` is returned by web and Shopify adapter APIs, stored in sessionStorage per host/API base, and sent back as `priorObjective` on the next turn.
10. **Widget bundle rebuilt.** `apps/shopify-app/extensions/stylique-widget/assets/tryon.js` and `apps/shopify-app/public/widget.js` regenerated from the shared widget source.

### Verification
- PASS: `pnpm typecheck`
- PASS: `pnpm build` (warnings only: existing Next metadata/workspace-root and Vite dynamic/static import chunking warnings)
- FAIL: `pnpm test` due pre-existing `packages/core/src/__tests__/plans.test.ts` null-quota expectation for `TRYON_BODY` (`expected true, received false`) unrelated to Mira runtime changes.
- PASS: `pnpm --filter @stylique/mira-brain exec tsx scripts/anti-chatbot-eval.mts` — 15/15.
- PASS: `pnpm --filter @stylique/web exec tsx scripts/size-ladder-harness.mts`.
- PASS: `pnpm --filter @stylique/web exec tsx scripts/runtime-ux-regression.mts` — 11/11.
- PASS: `pnpm --filter @stylique/mira-brain exec tsx scripts/contract-regression.mts` — 21/21.

### Remaining
- P0/P1 visible runtime fixes are code-complete locally, but not committed, pushed, deployed, or live-browser verified.
- Full Phase 5 presenter centralization and new dedicated unit/visual tests remain incomplete; this pass constrained the worst overlapping sources rather than moving every visible reply through a new presenter module.
- Live founder flows still require storefront/browser proof after deploy.

## Mira Runtime Closeout Browser Proof — 2026-06-20

### Preservation
- Branch: `chore/mira-runtime-closeout`
- Commit: `611681b73a2737c6c63116d7fb09ce77d0539e2c`
- Staged/committed only source, intentional widget bundles, and this implementation log. `apps/web/data/mira-signals.json` remains unstaged runtime/debug data.

### Browser proof
- Tested URL: `http://localhost:3002`
- Browser mode: local Chromium via Playwright, fresh context per flow.
- Cache disabled: yes, via browser protocol `Network.setCacheDisabled`.
- Fresh bundle: yes, local dev chunks served with cache-busting timestamp after rebuild; widget bundle rebuilt after source change.
- App source path: `/Users/apple/Desktop/stylique  re build/fashion`

### Founder flows
1. **Camisole:** PASS. No entry nudge. Product-aware opener. Build look rendered outfit card. Show similar rendered 3 full product cards with images and `VIEW FULL PRODUCT` actions.
2. **Linen shirt:** PASS. Recognized as shirt/top. Build look rendered valid complements. No dress copy. No generic duplicate size chips.
3. **Wide-leg trouser:** PASS. Recognized as trouser/bottom. Build look rendered top/layer complements. No `Try the look`; button says `Try the trouser`; try-on opened for anchor product without fake render claim.
4. **Product switch:** PASS. Trouser to Cashmere V-Neck preserved prior/current context. No dress copy. Complement/style path used instead of same-slot compare.
5. **Support/order issue:** PASS. `I have an order issue` rendered Store Support, no styling pitch, chips `Connect me` and `Keep shopping`.
6. **Cart truth:** BLOCKED locally. Local demo has simulated cart (`real:false`) and no real Shopify `/cart/add.js` context. Do not claim pass until tested on installed Shopify storefront/dev store.

### Presenter centralization decision
Presenter centralization: **DEFERRED TO P2 WITH SAFE V1 JUSTIFICATION**.
- Current runtime is stable enough for V1 because browser flows 1-5, runtime harness, and contract harness prove the visible paths that were breaking: build-look cards, similar cards, chips, try-on wording, support card, product switch, navigation, and no fake chat-cart success.
- Visible paths still bypass a new standalone presenter module: `applyDecision`, `recoMsg`, `lookMsg`, support insight rendering, size-form result copy, proactive nudge copy.
- Why safe for V1: unsafe legacy fallback is fenced to one network-error message; cart actions route through the executor; category routes now fill multiple full cards; unknown taxonomy avoids slot-specific copy.
- Phase 5 task: create `mira-presenter.ts` that owns message clamp, stage chips, card layout, route/action mapping, unsupported try-look prevention, dress-copy guard, and product-card navigation tests, then migrate `applyDecision`/card builders into it.
