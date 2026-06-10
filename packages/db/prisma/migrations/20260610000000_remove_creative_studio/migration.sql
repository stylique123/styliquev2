-- Remove Creative Studio (creative / content generation).
-- Stylique is repositioned as a pure AI Sales Engine + Commerce Intelligence
-- layer, not a content generator. The `Creative` and `CreativeSet` models and
-- their enums were deleted from schema.prisma; this drops the tables + types.
--
-- NOTE: The Plan quota columns (monthlyCreatives, monthlyCreativeSets,
-- creativeSets) and the dormant CREATIVE_* values in the EventName / UsageMetric
-- enums are intentionally LEFT in place for now (they don't depend on these
-- tables) and can be removed in a later cleanup migration. Idempotent.

DROP TABLE IF EXISTS "Creative" CASCADE;
DROP TABLE IF EXISTS "CreativeSet" CASCADE;

DROP TYPE IF EXISTS "CreativeRole";
DROP TYPE IF EXISTS "QcState";
DROP TYPE IF EXISTS "CreativeSetStatus";
