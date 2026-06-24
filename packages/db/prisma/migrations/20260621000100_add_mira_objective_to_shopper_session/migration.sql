ALTER TABLE "ShopperSession"
ADD COLUMN IF NOT EXISTS "miraObjectiveJson" JSONB,
ADD COLUMN IF NOT EXISTS "miraObjectiveUpdatedAt" TIMESTAMP(3);
