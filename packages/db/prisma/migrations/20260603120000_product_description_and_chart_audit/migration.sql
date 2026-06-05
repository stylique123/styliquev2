-- Additive columns that were previously applied to the live DB via `db push`
-- but had no migration file (schema/DB drift). Making them reproducible so a
-- clean `prisma migrate deploy` (or a second environment) builds the same DB.
-- All additive + nullable → safe, no data loss, no backfill.
--
-- Product.descriptionHtml         — Shopify body_html (text/image size-chart source)
-- Product.sizeChartCandidatesJson — per-source extraction audit (D39)
-- Product.sizeChartExtractedAt    — last extraction timestamp (D39)

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "descriptionHtml" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeChartCandidatesJson" JSONB;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeChartExtractedAt" TIMESTAMP(3);
