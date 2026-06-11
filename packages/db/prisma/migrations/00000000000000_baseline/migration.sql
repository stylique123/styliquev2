-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('STARTER', 'GROWTH', 'ULTIMATE');

-- CreateEnum
CREATE TYPE "AnalyticsLevel" AS ENUM ('BASIC', 'ADVANCED', 'ULTIMATE');

-- CreateEnum
CREATE TYPE "SupportLevel" AS ENUM ('STANDARD', 'PRIORITY', 'DEDICATED');

-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('TRYON_PERSONAL', 'TRYON_BODY', 'CREATIVE_GENERATED', 'CREATIVE_SET_GENERATED', 'STYLE_RECOMMENDATION', 'FIT_RECOMMENDATION', 'VISION_TURN', 'STYLIST_TURN');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('FAIR_USE_REACHED', 'CATALOG_SYNC_FAILED', 'CATALOG_SYNC_COMPLETED', 'INSTALL_COMPLETE', 'CREATIVE_JOB_FAILED', 'PLAN_RENEWED', 'PRODUCT_AUDIT_READY', 'APP_UNINSTALLED');

-- CreateEnum
CREATE TYPE "BrandSourceKind" AS ENUM ('SHOPIFY', 'INSTAGRAM', 'WEBSITE', 'UPLOADED_REFERENCE', 'MANUAL_INPUT');

-- CreateEnum
CREATE TYPE "BrandSourceStatus" AS ENUM ('PENDING', 'SYNCING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ImageRole" AS ENUM ('CATALOG', 'GENERATED', 'TRYON_OUTPUT', 'BRAND_REFERENCE');

-- CreateEnum
CREATE TYPE "GarmentRole" AS ENUM ('FRONT', 'BACK', 'DETAIL', 'LIFESTYLE', 'SWATCH');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('BRAND_REFERENCE', 'INSTAGRAM_REFERENCE', 'USER_PHOTO', 'GENERATED', 'VIDEO');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "FitPreference" AS ENUM ('FITTED', 'SLIM', 'REGULAR', 'RELAXED', 'OVERSIZED');

-- CreateEnum
CREATE TYPE "TryOnMode" AS ENUM ('BODY_MODEL', 'PERSONAL_PHOTO');

-- CreateEnum
CREATE TYPE "EventName" AS ENUM ('WIDGET_VIEWED', 'TRYON_STARTED', 'TRYON_COMPLETED', 'TRYON_PHOTO_UPLOADED', 'FIT_RECOMMENDED', 'SIZE_SELECTED', 'STYLE_VIEWED', 'STYLE_PRODUCT_CLICKED', 'COLOR_COMBO_VIEWED', 'CREATIVE_IMPRESSION', 'CREATIVE_SET_GENERATED', 'PRODUCT_AUDIT_GENERATED', 'ADD_TO_CART', 'CHECKOUT_STARTED', 'PURCHASE', 'DEMO_PRODUCT_VIEWED', 'DEMO_TRYON_BODY_SELECTED', 'DEMO_TRYON_PHOTO_REQUESTED', 'DEMO_FIT_SUBMITTED', 'DEMO_STYLE_RECOMMENDATION_VIEWED', 'DEMO_COLOR_COMBO_VIEWED', 'DEMO_AUDIT_VIEWED', 'WIDGET_OPENED', 'WIDGET_CLOSED', 'WIDGET_CTA_CLICKED', 'WIDGET_BODY_MODEL_SELECTED', 'WIDGET_FIT_SUBMITTED', 'WIDGET_STYLE_VIEWED', 'CHAT_OPENED', 'CHAT_CLOSED', 'CHAT_MESSAGE_SENT', 'CHAT_REPLY_RECEIVED', 'CHAT_PRODUCT_CLICKED', 'CHAT_COMBO_PROPOSED', 'CHAT_SEARCH_RUN', 'CHAT_IMAGE_MATCH_RUN', 'CHAT_NAV_REQUESTED', 'CHAT_CART_REQUESTED', 'CART_CONFIRMED', 'CART_CANCELLED', 'CART_FAILED', 'SIGNUP_OFFERED', 'SIGNUP_CARD_SHOWN', 'SIGNUP_CLAIMED', 'SIGNUP_DISMISSED', 'ACCOUNT_CLAIMED', 'WIDGET_STEP_VIEWED', 'WIDGET_MOOD_SELECTED', 'WIDGET_MODEL_SELECTED', 'WIDGET_EXPERIENCE_SELECTED', 'PDP_TRYON_CLICKED', 'TRYON_RENDER_REQUESTED', 'TRYON_RENDER_COMPLETED', 'TRYON_RENDER_FAILED', 'TRYON_ABANDONED', 'CHAT_PROFILE_CAPTURED', 'CHAT_COMBO_VOTED', 'WIDGET_COMBO_VIEWED', 'COMBO_TRYON_REQUESTED', 'COMBO_ADD_ALL', 'COMBO_PIECE_SWAPPED', 'PRODUCT_DWELL_LONG', 'STYLE_VOTED', 'PRODUCT_VIEWED', 'MIRA_ASSISTED_ORDER', 'CART_FROM_MIRA', 'CART_FROM_TRYON', 'CART_FROM_WIDGET_STYLE', 'CHAT_STOCK_CHECKED', 'CHAT_SIZE_CHART_VIEWED', 'WIDGET_PLACEMENT_AUDIT', 'PRODUCT_CREATED_VIA_AI', 'CHAT_NEAR_MISS', 'CREATIVE_CLICKED', 'CREATIVE_APPROVED', 'CREATIVE_REJECTED', 'CREATIVE_CONVERTED', 'OUTCOME_RESOLVED', 'MIRA_OPENED', 'MIRA_PROACTIVE_TRIGGERED', 'MIRA_INTENT_CAPTURED', 'MIRA_PRODUCT_EXPLAINED', 'MIRA_PRODUCT_RECOMMENDED', 'MIRA_OUTFIT_RECOMMENDED', 'MIRA_OUTFIT_ACCEPTED', 'MIRA_OUTFIT_REJECTED', 'MIRA_SIZE_HELP_STARTED', 'MIRA_SIZE_SAVED', 'MIRA_TRYON_OFFERED', 'MIRA_TRYON_STARTED', 'MIRA_TRYON_COMPLETED', 'MIRA_ADD_TO_CART_ASSIST', 'MIRA_CART_COMPLETED', 'MIRA_HESITATION_DETECTED', 'MIRA_UNMET_DEMAND', 'MIRA_NEAR_MISS', 'MIRA_NAVIGATION_FAILED', 'MIRA_SHOPPER_STATE_DETECTED', 'MIRA_BEHAVIORAL_TRIGGER_FIRED', 'MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED');

-- CreateEnum
CREATE TYPE "RecommendationKind" AS ENUM ('CATALOG_GAP', 'WEAK_PDP_CREATIVE', 'FIT_ACCURACY_DRIFT', 'TOP_COMBO_TO_PROMOTE', 'UNDERUSED_MOOD', 'TASTE_SEGMENT_EMERGING', 'CART_ABANDON_PATTERN', 'STUDIO_PRODUCT_OPPORTUNITY', 'STYLIST_DEMAND_SIGNAL', 'CROSS_OFFERING');

-- CreateEnum
CREATE TYPE "RecommendationSeverity" AS ENUM ('INFO', 'ATTENTION', 'URGENT');

-- CreateEnum
CREATE TYPE "RecommendationSurface" AS ENUM ('STUDIO', 'WIDGET', 'STYLIST', 'CATALOG', 'CROSS');

-- CreateEnum
CREATE TYPE "OutcomeStatus" AS ENUM ('PENDING', 'RESOLVED', 'INCONCLUSIVE', 'ABANDONED');

-- CreateEnum
CREATE TYPE "OutcomeResult" AS ENUM ('IMPROVED', 'NO_CHANGE', 'WORSENED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL DEFAULT 'STARTER',
    "monthlyTryOnPersonal" INTEGER,
    "monthlyTryOnBody" INTEGER,
    "monthlyCreatives" INTEGER,
    "monthlyCreativeSets" INTEGER,
    "monthlyStylistTurns" INTEGER,
    "monthlyStyleRecs" INTEGER,
    "monthlyFitRecs" INTEGER,
    "creativeSets" INTEGER,
    "analyticsLevel" "AnalyticsLevel" NOT NULL DEFAULT 'BASIC',
    "supportLevel" "SupportLevel" NOT NULL DEFAULT 'STANDARD',
    "planFeaturesJson" JSONB,
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
    "descriptionHtml" TEXT,
    "primaryColor" TEXT,
    "colorFamily" TEXT,
    "category" TEXT,
    "primaryTryonImageId" TEXT,
    "tryonReady" BOOLEAN NOT NULL DEFAULT false,
    "widgetTier" INTEGER NOT NULL DEFAULT 1,
    "qualityComputedAt" TIMESTAMP(3),
    "sizeChartJson" JSONB,
    "sizeChartSource" TEXT,
    "sizeChartCandidatesJson" JSONB,
    "sizeChartExtractedAt" TIMESTAMP(3),
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
    "inventoryQuantity" INTEGER,
    "availableForSale" BOOLEAN,
    "inventorySyncedAt" TIMESTAMP(3),
    "measurementsJson" JSONB,
    "measurementsSource" TEXT,

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
    "qualityScore" DOUBLE PRECISION,
    "qualityCheckedAt" TIMESTAMP(3),
    "qualityReasons" TEXT[],
    "qualityProvider" TEXT,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "bytes" INTEGER,
    "garmentRole" "GarmentRole",
    "preppedUrl" TEXT,
    "preppedAt" TIMESTAMP(3),

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
    "shopifyCustomerId" TEXT,
    "heightCm" INTEGER,
    "weightKg" INTEGER,
    "chestCm" DOUBLE PRECISION,
    "waistCm" DOUBLE PRECISION,
    "hipCm" DOUBLE PRECISION,
    "fitPreference" "FitPreference",
    "bodyType" TEXT,
    "photoAssetId" TEXT,
    "budgetMin" DOUBLE PRECISION,
    "budgetMax" DOUBLE PRECISION,
    "budgetCurrency" TEXT DEFAULT 'USD',
    "skinTone" TEXT,
    "email" TEXT,
    "displayName" TEXT,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "accountClaimedAt" TIMESTAMP(3),
    "emailVerifyToken" TEXT,
    "emailVerifyExpiry" TIMESTAMP(3),
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailVerifyLockedAt" TIMESTAMP(3),
    "chatHistoryJson" JSONB,
    "signupOfferedAt" TIMESTAMP(3),
    "sentimentLabel" TEXT,
    "sentimentThemes" TEXT[],
    "sentimentSummary" TEXT,
    "sentimentFoundItem" TEXT,
    "sentimentExtractedAt" TIMESTAMP(3),
    "tasteVectorJson" JSONB,
    "tasteComputedAt" TIMESTAMP(3),
    "signalCount" INTEGER NOT NULL DEFAULT 0,
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
    "providerKey" TEXT,
    "modelKey" TEXT,
    "modelHint" TEXT,
    "latencyMs" INTEGER,
    "completedAt" TIMESTAMP(3),
    "cacheKey" TEXT,

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
    "variantTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "BrandRecommendation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT,
    "kind" "RecommendationKind" NOT NULL,
    "severity" "RecommendationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "surface" "RecommendationSurface" NOT NULL,
    "minTierToView" "PlanTier" NOT NULL,
    "actionUrl" TEXT,
    "ctaLabel" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),
    "takenAt" TIMESTAMP(3),

    CONSTRAINT "BrandRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandTasteSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "colorFamilyJson" JSONB NOT NULL,
    "silhouetteJson" JSONB NOT NULL,
    "categoryJson" JSONB NOT NULL,
    "priceTierJson" JSONB NOT NULL,
    "moodJson" JSONB NOT NULL,
    "modelJson" JSONB NOT NULL,
    "chatSessions" INTEGER NOT NULL DEFAULT 0,
    "combosProposed" INTEGER NOT NULL DEFAULT 0,
    "cartConfirmed" INTEGER NOT NULL DEFAULT 0,
    "signupsClaimed" INTEGER NOT NULL DEFAULT 0,
    "tryOnSessions" INTEGER NOT NULL DEFAULT 0,
    "fitSubmitted" INTEGER NOT NULL DEFAULT 0,
    "creativesCount" INTEGER NOT NULL DEFAULT 0,
    "comboCtr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "signupRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fitToCartRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandTasteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkBenchmark" (
    "id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "p25" DOUBLE PRECISION NOT NULL,
    "p50" DOUBLE PRECISION NOT NULL,
    "p75" DOUBLE PRECISION NOT NULL,
    "p90" DOUBLE PRECISION NOT NULL,
    "mean" DOUBLE PRECISION NOT NULL,
    "sampleBrands" INTEGER NOT NULL,
    "segment" TEXT DEFAULT 'all',

    CONSTRAINT "NetworkBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartIntent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "productIds" TEXT[],
    "comboName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "allocation" JSONB NOT NULL,
    "variantConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEmbedding" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],
    "modelKey" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "recommendationType" TEXT NOT NULL,
    "workflowId" TEXT,
    "entityId" TEXT,
    "entityType" TEXT,
    "beforeMetrics" JSONB NOT NULL,
    "afterMetrics" JSONB NOT NULL,
    "delta" JSONB NOT NULL,
    "status" "OutcomeStatus" NOT NULL DEFAULT 'PENDING',
    "resultClass" "OutcomeResult",
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "resolutionWindowDays" INTEGER NOT NULL DEFAULT 7,
    "resolutionDue" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "learnedSignal" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyReport" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataJson" JSONB NOT NULL,
    "markdown" TEXT NOT NULL,

    CONSTRAINT "MonthlyReport_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "Product_shopId_tryonReady_idx" ON "Product"("shopId", "tryonReady");

-- CreateIndex
CREATE UNIQUE INDEX "Product_shopId_shopifyId_key" ON "Product"("shopId", "shopifyId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_color_idx" ON "ProductVariant"("productId", "color");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_shopifyId_key" ON "ProductVariant"("productId", "shopifyId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_qualityScore_idx" ON "ProductImage"("productId", "qualityScore");

-- CreateIndex
CREATE INDEX "ProductAudit_shopId_priorityScore_idx" ON "ProductAudit"("shopId", "priorityScore");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAudit_shopId_productId_key" ON "ProductAudit"("shopId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopperSession_sessionId_key" ON "ShopperSession"("sessionId");

-- CreateIndex
CREATE INDEX "ShopperSession_shopifyDomain_shopifyCustomerId_idx" ON "ShopperSession"("shopifyDomain", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "ShopperSession_shopifyDomain_idx" ON "ShopperSession"("shopifyDomain");

-- CreateIndex
CREATE INDEX "ShopperSession_email_idx" ON "ShopperSession"("email");

-- CreateIndex
CREATE INDEX "TryOnSession_shopId_productId_idx" ON "TryOnSession"("shopId", "productId");

-- CreateIndex
CREATE INDEX "TryOnSession_shopperId_idx" ON "TryOnSession"("shopperId");

-- CreateIndex
CREATE INDEX "TryOnSession_shopId_cacheKey_idx" ON "TryOnSession"("shopId", "cacheKey");

-- CreateIndex
CREATE INDEX "FitSession_shopId_productId_idx" ON "FitSession"("shopId", "productId");

-- CreateIndex
CREATE INDEX "StyleSession_shopId_productId_idx" ON "StyleSession"("shopId", "productId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_shopId_name_createdAt_idx" ON "AnalyticsEvent"("shopId", "name", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_shopId_productId_createdAt_idx" ON "AnalyticsEvent"("shopId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogGap_shopId_normalizedQuery_idx" ON "CatalogGap"("shopId", "normalizedQuery");

-- CreateIndex
CREATE INDEX "CatalogGap_shopId_createdAt_idx" ON "CatalogGap"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "BrandRecommendation_shopId_dismissedAt_severity_idx" ON "BrandRecommendation"("shopId", "dismissedAt", "severity");

-- CreateIndex
CREATE INDEX "BrandRecommendation_shopId_surface_generatedAt_idx" ON "BrandRecommendation"("shopId", "surface", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrandRecommendation_shopId_kind_dedupeKey_key" ON "BrandRecommendation"("shopId", "kind", "dedupeKey");

-- CreateIndex
CREATE INDEX "BrandTasteSnapshot_shopId_snapshotDate_idx" ON "BrandTasteSnapshot"("shopId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "BrandTasteSnapshot_shopId_snapshotDate_key" ON "BrandTasteSnapshot"("shopId", "snapshotDate");

-- CreateIndex
CREATE INDEX "NetworkBenchmark_dimension_segment_computedAt_idx" ON "NetworkBenchmark"("dimension", "segment", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkBenchmark_dimension_segment_computedAt_key" ON "NetworkBenchmark"("dimension", "segment", "computedAt");

-- CreateIndex
CREATE INDEX "CartIntent_shopId_shopperId_idx" ON "CartIntent"("shopId", "shopperId");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_key_key" ON "Experiment"("key");

-- CreateIndex
CREATE INDEX "Experiment_shopId_active_idx" ON "Experiment"("shopId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEmbedding_productId_key" ON "ProductEmbedding"("productId");

-- CreateIndex
CREATE INDEX "ProductEmbedding_shopId_idx" ON "ProductEmbedding"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Outcome_recommendationId_key" ON "Outcome"("recommendationId");

-- CreateIndex
CREATE INDEX "Outcome_shopId_status_idx" ON "Outcome"("shopId", "status");

-- CreateIndex
CREATE INDEX "Outcome_shopId_recommendationType_idx" ON "Outcome"("shopId", "recommendationType");

-- CreateIndex
CREATE INDEX "Outcome_recommendationId_idx" ON "Outcome"("recommendationId");

-- CreateIndex
CREATE INDEX "Outcome_resolutionDue_status_idx" ON "Outcome"("resolutionDue", "status");

-- CreateIndex
CREATE INDEX "MonthlyReport_shopId_periodEnd_idx" ON "MonthlyReport"("shopId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyReport_shopId_periodStart_key" ON "MonthlyReport"("shopId", "periodStart");

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
ALTER TABLE "ProductAudit" ADD CONSTRAINT "ProductAudit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAudit" ADD CONSTRAINT "ProductAudit_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnSession" ADD CONSTRAINT "TryOnSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnSession" ADD CONSTRAINT "TryOnSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnSession" ADD CONSTRAINT "TryOnSession_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitSession" ADD CONSTRAINT "FitSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitSession" ADD CONSTRAINT "FitSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitSession" ADD CONSTRAINT "FitSession_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleSession" ADD CONSTRAINT "StyleSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleSession" ADD CONSTRAINT "StyleSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleSession" ADD CONSTRAINT "StyleSession_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogGap" ADD CONSTRAINT "CatalogGap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogGap" ADD CONSTRAINT "CatalogGap_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandRecommendation" ADD CONSTRAINT "BrandRecommendation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandRecommendation" ADD CONSTRAINT "BrandRecommendation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandTasteSnapshot" ADD CONSTRAINT "BrandTasteSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartIntent" ADD CONSTRAINT "CartIntent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartIntent" ADD CONSTRAINT "CartIntent_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEmbedding" ADD CONSTRAINT "ProductEmbedding_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEmbedding" ADD CONSTRAINT "ProductEmbedding_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "BrandRecommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyReport" ADD CONSTRAINT "MonthlyReport_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

