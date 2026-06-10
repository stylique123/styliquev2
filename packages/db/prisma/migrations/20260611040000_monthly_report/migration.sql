-- MonthlyReport — Session 1 of the founder's 4-session plan.
-- Idempotent: CREATE TABLE IF NOT EXISTS so a fresh deploy or a re-run is safe.
CREATE TABLE IF NOT EXISTS "MonthlyReport" (
  "id"          TEXT PRIMARY KEY,
  "shopId"      TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd"   TIMESTAMP(3) NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dataJson"    JSONB NOT NULL,
  "markdown"    TEXT NOT NULL,
  CONSTRAINT "MonthlyReport_shop_fk" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyReport_shopId_periodStart_key" ON "MonthlyReport" ("shopId", "periodStart");
CREATE INDEX IF NOT EXISTS "MonthlyReport_shopId_periodEnd_idx" ON "MonthlyReport" ("shopId", "periodEnd");
