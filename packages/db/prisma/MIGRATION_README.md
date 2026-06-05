# Migration debt — read before deploying

## The situation

The Prisma migration history in `prisma/migrations/` is **6 migrations behind** the current schema:

```
20260526034443_init
20260526035622_step2_shopify
20260526075653_step3_demo_events
20260526093809_step4_widget_events
20260527032800_shopper_account_and_chat_history
20260527112758_layer_2_taste_and_events   ← last migration file
                                            ↑ everything below was db pushed
```

Since `20260527112758`, the following landed via `prisma db push --accept-data-loss` and **has no migration file**:

| Change | Where |
|---|---|
| Tier rename `PRO/SCALE/ENTERPRISE → STARTER/GROWTH/ULTIMATE` | Sprint, D4 |
| `Plan.planFeaturesJson` JSON column | D5 |
| `Plan.monthlyStylistTurns` / `monthlyStyleRecs` / `monthlyFitRecs` | Sprint 2 |
| `BrandRecommendation` table + enums | D7 |
| `BrandTasteSnapshot` table | Layer 3 |
| `NetworkBenchmark` table | Layer 3 |
| `Experiment` table | Sprint 1 A/B |
| `AnalyticsEvent.variantTag` column | Sprint 1 A/B |
| `ShopperSession.tasteVectorJson` + `tasteComputedAt` + `signalCount` + `signupOfferedAt` | Layer 2 |
| `Creative.sourceComboName` + `sourceComboIds` | Sprint 2 |
| `CreativeSet.triggeredBy` | Sprint 2 |
| `EventName` enum additions (`CHAT_*`, `CART_*`, `SIGNUP_*`, `WIDGET_STEP_VIEWED`, `WIDGET_MOOD_SELECTED`, `WIDGET_MODEL_SELECTED`, `WIDGET_EXPERIENCE_SELECTED`, `CHAT_PROFILE_CAPTURED`) | Layer 2 + Sprint 5 audit |
| `UsageMetric.VISION_TURN` | Sprint 5 audit |
| `CatalogGap` table | Layer 2 |

## Why this matters

- **A fresh checkout will not match the schema.** `prisma migrate dev` will only apply the 6 committed migrations and the resulting DB will be 6 steps behind the codebase.
- **Production deploy will fail or partially apply.** Any environment running `migrate deploy` against a clean DB ends up with an incomplete schema.

## How to fix (when shadow DB privileges are available)

Prisma's migration diff requires a *shadow database* — a temporary DB it can spin up to validate the migration before writing it. This needs `CREATEDB` privilege which the default `stylique` Postgres user does not have on this dev box.

When you have a Postgres superuser handy (local or remote), run:

```bash
# Option A — let Prisma auto-create the shadow DB:
SHADOW_DATABASE_URL="postgres://<super>:<pw>@localhost:5432/stylique_shadow" \
  pnpm --filter @stylique/db exec prisma migrate dev \
    --schema=prisma/schema.prisma \
    --name consolidate_post_layer2

# Option B — generate the SQL manually for review:
pnpm --filter @stylique/db exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url $SHADOW_DATABASE_URL \
  --script > prisma/migrations/<timestamp>_consolidate/migration.sql
```

Then commit the new migration file.

## Until then — known constraints

- ✅ The currently-running local DB matches the schema (was kept in sync via `db push`)
- ❌ No teammate can `git clone` + `prisma migrate dev` and get a working DB
- ❌ No production deploy possible

## Workarounds for now

- Fresh dev clones: `pnpm dlx dotenv-cli -e .env -- pnpm --filter @stylique/db exec prisma db push --accept-data-loss --skip-generate` (same path we've been using)
- Staging/prod: blocked until consolidation runs against a shadow DB

This is the single highest-priority CTO debt item. Recorded as OI-10 since Sprint 1.
