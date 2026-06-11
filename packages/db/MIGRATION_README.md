# Stylique — Prisma migration runbook

> **State after the audit fix (P0 #3):** the migration history is now a **single
> authoritative baseline** — `prisma/migrations/00000000000000_baseline`, generated
> from the current `schema.prisma`. The old 15-migration chain (two conflicting full
> baselines: `20250528000000_clean_baseline` creating `PlanTier` as
> `STARTER/GROWTH/ULTIMATE` and `20260526034443_init` re-creating it as
> `GROWTH/PRO/SCALE/ENTERPRISE`) is **deleted** — that chain aborted a fresh
> `prisma migrate deploy` with `duplicate_object` on `CREATE TYPE "PlanTier"`.

## Fresh database (CI / staging / DR / a new Railway DB)

```bash
cd packages/db
DATABASE_URL="<fresh empty postgres>" npx prisma migrate deploy
```

Applies the single baseline → a clean DB that **exactly matches `schema.prisma`**.
Verified: a fresh `migrate deploy` on a scratch Postgres, then
`migrate diff --from-url <db> --to-schema-datamodel prisma/schema.prisma`, returns an
empty migration. No collision, no manual steps.

## The LIVE production DB — ONE-TIME reconciliation (deliberate, not on a deploy)

The live Neon DB was provisioned via `prisma db push`, so it already has the schema but
**no `_prisma_migrations` row for the baseline**. Today the Railway services do NOT run
`migrate` on boot, so nothing is broken right now. Before the live DB could ever run
`migrate deploy`, mark the baseline as already-applied so deploy doesn't try to re-create
existing tables:

```bash
cd packages/db
DATABASE_URL="<live neon url>" npx prisma migrate resolve --applied 00000000000000_baseline
```

Metadata-only (writes one `_prisma_migrations` row); touches no table. Run once.

### Beauty-removal drift (separate, optional cleanup)

`schema.prisma` dropped the beauty fields / `SavedRoutine` / `BEAUTY_*` enum values, but
the **live** DB still has those orphan columns/values (db-push history, never dropped).
They are harmless — no code reads them. To converge the live DB with the schema, after a
backup:

```bash
DATABASE_URL="<live>" npx prisma migrate diff \
  --from-url "<live>" --to-schema-datamodel prisma/schema.prisma --script
# shows the DROP COLUMN / DROP TYPE for the orphan beauty objects → review, then apply.
```

Not required for correctness.

## Changing the schema going forward

```bash
cd packages/db
# edit prisma/schema.prisma, then:
DATABASE_URL="<a shadow/dev db>" npx prisma migrate dev --name <change>
```

Creates a new incremental migration on top of the baseline. Commit it. A fresh
`migrate deploy` then runs baseline → your new migration.

## Railway deploy note

`.railwayignore` (excludes `node_modules/.git/.next/build/dist`, keeps `apps/web/public`)
is unchanged. The services do **not** run `migrate deploy` on boot — provisioning is an
explicit operator step per the above.
