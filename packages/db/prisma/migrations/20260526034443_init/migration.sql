-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('GROWTH', 'PRO', 'SCALE', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "AnalyticsLevel" AS ENUM ('BASIC', 'ADVANCED', 'PRO');

-- CreateEnum
CREATE TYPE "SupportLevel" AS ENUM ('STANDARD', 'PRIORITY', 'DEDICATED');

-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('TRYON_PERSONAL', 'TRYON_BODY', 'CREATIVE_GENERATED', 'CREATIVE_SET_GENERATED', 'STYLE_RECOMMENDATION', 'FIT_RECOMMENDATION');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('FAIR_USE_REACHED', 'CATALOG_SYNC_FAILED', 'CREATIVE_JOB_FAILED', 'PLAN_RENEWED', 'PRODUCT_AUDIT_READY');

-- CreateEnum
CREATE TYPE "BrandSourceKind" AS ENUM ('SHOPIFY', 'INSTAGRAM', 'WEBSITE', 'UPLOADED_REFERENCE', 'MANUAL_INPUT');

-- CreateEnum
CREATE TYPE "BrandSourceStatus" AS ENUM ('PENDING', 'SYNCING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ImageRole" AS ENUM ('CATALOG', 'GENERATED', 'TRYON_OUTPUT', 'BRAND_REFERENCE');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('BRAND_REFERENCE', 'INSTAGRAM_REFERENCE', 'USER_PHOTO', 'GENERATED', 'VIDEO');

-- CreateEnum
CREATE TYPE "CreativeSetStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "QcState" AS ENUM ('NONE', 'AUTO_PASSED', 'AUTO_FLAGGED', 'HUMAN_APPROVED', 'HUMAN_REJECTED');

-- CreateEnum
CREATE TYPE "CreativeRole" AS ENUM ('STILL', 'MOTION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "FitPreference" AS ENUM ('SLIM', 'REGULAR', 'RELAXED', 'OVERSIZED');

-- CreateEnum
CREATE TYPE "TryOnMode" AS ENUM ('BODY_MODEL', 'PERSONAL_PHOTO');

-- CreateEnum
CREATE TYPE "EventName" AS ENUM ('WIDGET_VIEWED', 'TRYON_STARTED', 'TRYON_COMPLETED', 'TRYON_PHOTO_UPLOADED', 'FIT_RECOMMENDED', 'SIZE_SELECTED', 'STYLE_VIEWED', 'STYLE_PRODUCT_CLICKED', 'COLOR_COMBO_VIEWED', 'CREATIVE_IMPRESSION', 'CREATIVE_SET_GENERATED', 'PRODUCT_AUDIT_GENERATED', 'ADD_TO_CART', 'CHECKOUT_STARTED', 'PURCHASE');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL DEFAULT 'GROWTH',
    "monthlyTryOnPersonal" INTEGER,
    "monthlyTryOnBody" INTEGER,
    "monthlyCreatives" INTEGER,
    "creativeSets" INTEGER,
    "analyticsLevel" "AnalyticsLevel" NOT NULL DEFAULT 'BASIC',
    "supportLevel" "SupportLevel" NOT NULL DEFAULT 'STANDARD',
    "fairUseWarnAt" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "renewsAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "paletteJson" JSONB,
    "toneJson" JSONB,
    "styleVectors" JSONB,
    "trainedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandSource" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" "BrandSourceKind" NOT NULL,
    "identifier" TEXT,
    "payload" JSONB,
    "status" "BrandSourceStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "productType" TEXT,
    "vendor" TEXT,
    "tags" TEXT[],
    "primaryColor" TEXT,
    "colorFamily" TEXT,
    "category" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "sku" TEXT,
    "size" TEXT,
    "color" TEXT,
    "priceCents" INTEGER,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyId" TEXT,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "role" "ImageRole" NOT NULL DEFAULT 'CATALOG',

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "brandProfileId" TEXT,
    "url" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeSet" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT,
    "status" "CreativeSetStatus" NOT NULL DEFAULT 'PENDING',
    "brief" JSONB,
    "providerMeta" JSONB,
    "qcState" "QcState" NOT NULL DEFAULT 'NONE',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creative" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT,
    "setId" TEXT,
    "role" "CreativeRole" NOT NULL DEFAULT 'STILL',
    "assetKind" "AssetKind" NOT NULL DEFAULT 'GENERATED',
    "prompt" TEXT NOT NULL,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "providerJob" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Creative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAudit" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "missingSizeChart" BOOLEAN NOT NULL DEFAULT false,
    "weakImageQuality" BOOLEAN NOT NULL DEFAULT false,
    "missingStyling" BOOLEAN NOT NULL DEFAULT false,
    "missingTryOnReady" BOOLEAN NOT NULL DEFAULT false,
    "missingColorCombos" BOOLEAN NOT NULL DEFAULT false,
    "recommendations" JSONB NOT NULL,
    "priorityScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopperSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "heightCm" INTEGER,
    "weightKg" INTEGER,
    "fitPreference" "FitPreference",
    "bodyType" TEXT,
    "photoAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopperSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TryOnSession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mode" "TryOnMode" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "inputPhotoUrl" TEXT,
    "outputImageUrl" TEXT,
    "providerJob" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TryOnSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FitSession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "recommendedSize" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" JSONB,
    "chosenSize" TEXT,
    "sizeDelta" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FitSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleSession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "outfitJson" JSONB NOT NULL,
    "colorCombosJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopperId" TEXT,
    "name" "EventName" NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "payload" JSONB NOT NULL,
    "url" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX "Shop_shopifyDomain_idx" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_shopId_key" ON "Plan"("shopId");

-- CreateIndex
CREATE INDEX "UsageCounter_shopId_metric_idx" ON "UsageCounter"("shopId", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_shopId_metric_periodStart_key" ON "UsageCounter"("shopId", "metric", "periodStart");

-- CreateIndex
CREATE INDEX "Notification_shopId_readAt_idx" ON "Notification"("shopId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_shopId_key" ON "BrandProfile"("shopId");

-- CreateIndex
CREATE INDEX "BrandSource_shopId_kind_idx" ON "BrandSource"("shopId", "kind");

-- CreateIndex
CREATE INDEX "Product_shopId_category_idx" ON "Product"("shopId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Product_shopId_shopifyId_key" ON "Product"("shopId", "shopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_shopifyId_key" ON "ProductVariant"("productId", "shopifyId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE INDEX "CreativeSet_shopId_productId_idx" ON "CreativeSet"("shopId", "productId");

-- CreateIndex
CREATE INDEX "CreativeSet_shopId_status_idx" ON "CreativeSet"("shopId", "status");

-- CreateIndex
CREATE INDEX "Creative_shopId_setId_idx" ON "Creative"("shopId", "setId");

-- CreateIndex
CREATE INDEX "ProductAudit_shopId_priorityScore_idx" ON "ProductAudit"("shopId", "priorityScore");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAudit_shopId_productId_key" ON "ProductAudit"("shopId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopperSession_sessionId_key" ON "ShopperSession"("sessionId");

-- CreateIndex
CREATE INDEX "ShopperSession_shopifyDomain_idx" ON "ShopperSession"("shopifyDomain");

-- CreateIndex
CREATE INDEX "TryOnSession_shopId_productId_idx" ON "TryOnSession"("shopId", "productId");

-- CreateIndex
CREATE INDEX "TryOnSession_shopperId_idx" ON "TryOnSession"("shopperId");

-- CreateIndex
CREATE INDEX "FitSession_shopId_productId_idx" ON "FitSession"("shopId", "productId");

-- CreateIndex
CREATE INDEX "StyleSession_shopId_productId_idx" ON "StyleSession"("shopId", "productId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_shopId_name_createdAt_idx" ON "AnalyticsEvent"("shopId", "name", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_shopId_productId_createdAt_idx" ON "AnalyticsEvent"("shopId", "productId", "createdAt");

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSource" ADD CONSTRAINT "BrandSource_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "BrandProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeSet" ADD CONSTRAINT "CreativeSet_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeSet" ADD CONSTRAINT "CreativeSet_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_setId_fkey" FOREIGN KEY ("setId") REFERENCES "CreativeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAudit" ADD CONSTRAINT "ProductAudit_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAudit" ADD CONSTRAINT "ProductAudit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnSession" ADD CONSTRAINT "TryOnSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnSession" ADD CONSTRAINT "TryOnSession_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnSession" ADD CONSTRAINT "TryOnSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitSession" ADD CONSTRAINT "FitSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitSession" ADD CONSTRAINT "FitSession_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitSession" ADD CONSTRAINT "FitSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleSession" ADD CONSTRAINT "StyleSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleSession" ADD CONSTRAINT "StyleSession_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleSession" ADD CONSTRAINT "StyleSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
