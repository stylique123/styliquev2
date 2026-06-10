-- Backfill migration for models/columns that were applied to the live DB via
-- `prisma db push` but never captured in a migration file, so a fresh
-- `prisma migrate deploy` would build a DB missing them (panel P1 — CartIntent
-- + SavedRoutine + Shop.currencyCode). Fully idempotent (IF NOT EXISTS + inline
-- FKs guarded by the table-level IF NOT EXISTS), so it is a no-op on any DB that
-- already has them (the pushed live DB) and creates them on a fresh deploy.

-- Shop.currencyCode (ISO 4217, fetched from Shopify per install; Mira formats
-- every price in it).
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "currencyCode" TEXT NOT NULL DEFAULT 'USD';

-- CartIntent — the "add all to bag" bundle (tracks combo CTR vs add-all conv).
CREATE TABLE IF NOT EXISTS "CartIntent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "productIds" TEXT[],
    "comboName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CartIntent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CartIntent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CartIntent_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CartIntent_shopId_shopperId_idx" ON "CartIntent"("shopId", "shopperId");

-- SavedRoutine — persisted beauty/styling routine per shopper (D58).
CREATE TABLE IF NOT EXISTS "SavedRoutine" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "productIds" TEXT[],
    "stepOrder" JSONB NOT NULL,
    "routineType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "miraSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedRoutine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SavedRoutine_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SavedRoutine_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SavedRoutine_shopId_shopperId_status_idx" ON "SavedRoutine"("shopId", "shopperId", "status");
CREATE INDEX IF NOT EXISTS "SavedRoutine_shopId_routineType_createdAt_idx" ON "SavedRoutine"("shopId", "routineType", "createdAt");
