-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventName" ADD VALUE 'CHAT_OPENED';
ALTER TYPE "EventName" ADD VALUE 'CHAT_CLOSED';
ALTER TYPE "EventName" ADD VALUE 'CHAT_MESSAGE_SENT';
ALTER TYPE "EventName" ADD VALUE 'CHAT_REPLY_RECEIVED';
ALTER TYPE "EventName" ADD VALUE 'CHAT_PRODUCT_CLICKED';
ALTER TYPE "EventName" ADD VALUE 'CHAT_COMBO_PROPOSED';
ALTER TYPE "EventName" ADD VALUE 'CHAT_SEARCH_RUN';
ALTER TYPE "EventName" ADD VALUE 'CHAT_NAV_REQUESTED';
ALTER TYPE "EventName" ADD VALUE 'CHAT_CART_REQUESTED';
ALTER TYPE "EventName" ADD VALUE 'CART_CONFIRMED';
ALTER TYPE "EventName" ADD VALUE 'CART_CANCELLED';
ALTER TYPE "EventName" ADD VALUE 'CART_FAILED';
ALTER TYPE "EventName" ADD VALUE 'SIGNUP_OFFERED';
ALTER TYPE "EventName" ADD VALUE 'SIGNUP_CARD_SHOWN';
ALTER TYPE "EventName" ADD VALUE 'SIGNUP_CLAIMED';
ALTER TYPE "EventName" ADD VALUE 'SIGNUP_DISMISSED';
ALTER TYPE "EventName" ADD VALUE 'ACCOUNT_CLAIMED';
ALTER TYPE "EventName" ADD VALUE 'WIDGET_STEP_VIEWED';
ALTER TYPE "EventName" ADD VALUE 'WIDGET_MOOD_SELECTED';
ALTER TYPE "EventName" ADD VALUE 'WIDGET_MODEL_SELECTED';
ALTER TYPE "EventName" ADD VALUE 'WIDGET_EXPERIENCE_SELECTED';

-- AlterTable
ALTER TABLE "ShopperSession" ADD COLUMN     "signalCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tasteComputedAt" TIMESTAMP(3),
ADD COLUMN     "tasteVectorJson" JSONB;

-- CreateTable
CREATE TABLE "CatalogGap" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopperId" TEXT,
    "rawQuery" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "category" TEXT,
    "colorFamily" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogGap_shopId_normalizedQuery_idx" ON "CatalogGap"("shopId", "normalizedQuery");

-- CreateIndex
CREATE INDEX "CatalogGap_shopId_createdAt_idx" ON "CatalogGap"("shopId", "createdAt");

-- AddForeignKey
ALTER TABLE "CatalogGap" ADD CONSTRAINT "CatalogGap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogGap" ADD CONSTRAINT "CatalogGap_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
