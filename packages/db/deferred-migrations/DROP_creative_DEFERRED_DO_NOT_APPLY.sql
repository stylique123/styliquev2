-- ============================================================================
-- DEFERRED / NOT APPLIED — Creative Studio destructive migration (DRAFT)
-- ============================================================================
--
--  ⛔ DO NOT RUN THIS FILE. It lives OUTSIDE prisma/migrations/ on purpose so
--     `prisma migrate deploy` will never pick it up. It documents the physical
--     DB changes that REMAIN after the Creative Studio CODE removal landed on
--     branch `chore/phase0-remove-creative`.
--
--  Status at authoring time:
--    • Creative Studio CODE removed (emit/read sites, handlers, billing,
--      entitlement, costs, feature flags, plan-field writes, dashboard UI).
--    • Prisma SCHEMA still carries, as DEFERRED/ARCHIVAL:
--        - Plan.monthlyCreatives / Plan.monthlyCreativeSets / Plan.creativeSets
--        - enum UsageMetric: CREATIVE_GENERATED, CREATIVE_SET_GENERATED
--        - enum EventName:   CREATIVE_GENERATED, CREATIVE_SET_GENERATED,
--                            CREATIVE_JOB_FAILED, CREATIVE_IMPRESSION,
--                            CREATIVE_CLICKED, CREATIVE_APPROVED,
--                            CREATIVE_REJECTED, CREATIVE_CONVERTED
--    • Physical DB still has tables "Creative", "CreativeSet" (models already
--      removed from schema.prisma) carrying the data below.
--
--  Verified row counts (read-only, 2026-06): Creative = 0, CreativeSet = 0.
--  → This migration loses ZERO data. Still requires FOUNDER APPROVAL before apply.
--
--  ⚠ KEEP (do NOT drop): RecommendationKind values WEAK_PDP_CREATIVE and
--    STUDIO_PRODUCT_OPPORTUNITY — these are ACTIVELY USED by the
--    recommendations engine and are unrelated to Creative Studio generation.
--
--  TO APPLY (later, after review):
--    1. First remove the deferred artifacts from prisma/schema.prisma
--       (the three Plan columns + the UsageMetric/EventName values above).
--    2. Regenerate the real migration with:
--         prisma migrate diff --from-schema-datasource prisma/schema.prisma \
--           --to-schema-datamodel prisma/schema.prisma --script
--       (do NOT hand-apply the SQL below — it is a reference draft only).
--    3. Review, then `prisma migrate deploy`.
-- ============================================================================

BEGIN;

-- 1. Drop the orphaned Creative tables (models already gone from schema).
DROP TABLE IF EXISTS "Creative" CASCADE;
DROP TABLE IF EXISTS "CreativeSet" CASCADE;

-- 2. Drop the deferred Plan columns.
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "monthlyCreatives";
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "monthlyCreativeSets";
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "creativeSets";

-- 3. Remove the Creative values from the UsageMetric and EventName enums.
--    Postgres has no DROP VALUE for enums — the type must be recreated. This is
--    illustrative; the real migration must rewrite every column of these enum
--    types and re-point defaults. Generate it with `prisma migrate diff` (above)
--    rather than maintaining this by hand.
--
--    UsageMetric: drop CREATIVE_GENERATED, CREATIVE_SET_GENERATED
--    EventName:   drop CREATIVE_GENERATED, CREATIVE_SET_GENERATED,
--                 CREATIVE_JOB_FAILED, CREATIVE_IMPRESSION, CREATIVE_CLICKED,
--                 CREATIVE_APPROVED, CREATIVE_REJECTED, CREATIVE_CONVERTED
--    (Any historical rows carrying these values must be deleted or remapped
--     first — confirmed 0 creative-event rows at authoring time.)

ROLLBACK; -- ⛔ Draft ends in ROLLBACK so an accidental run is a no-op.
