-- AlterTable
ALTER TABLE "ShopperSession" ADD COLUMN     "accountClaimedAt" TIMESTAMP(3),
ADD COLUMN     "chatHistoryJson" JSONB,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signupOfferedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ShopperSession_email_idx" ON "ShopperSession"("email");
