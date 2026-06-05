-- ============================================================
-- STYLIQUE — CLEAN BASELINE MIGRATION
-- Generated: 2025-05-28
-- Consolidates all sprint sessions into a single idempotent script.
-- Safe to apply on a fresh DB; existing DBs must mark this as
-- applied via: prisma migrate resolve --applied 20250528000000_clean_baseline
-- ============================================================

-- ─── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE "PlanTier" AS ENUM ('STARTER', 'GROWTH', 'ULTIMATE');

CREATE TYPE "AnalyticsLevel" AS ENUM ('BASIC', 'ADVANCED', 'ULTIMATE');

CREATE TYPE "SupportLevel" AS ENUM ('STANDARD', 'PRIORITY', 'DEDICATED');

CREATE TYPE "UsageMetric" AS ENUM (
  'TRYON_PERSONAL',
  'TRYON_BODY',
  'CREATIVE_GENERATED',
  'CREATIVE_SET_GENERATED',
  'STYLE_RECOMMENDATION',
  'FIT_RECOMMENDATION',
  'VISION_TURN'
);

CREATE TYPE "NotificationKind" AS ENUM (
  'FAIR_USE_REACHED',
  'CATALOG_SYNC_FAILED',
  'CATALOG_SYNC_COMPLETED',
  'INSTALL_COMPLETE',
  'CREATIVE_JOB_FAILED',
  'PLAN_RENEWED',
  'PRODUCT_AUDIT_READY',
  'APP_UNINSTALLED'
);

CREATE TYPE "BrandSourceKind" AS ENUM (
  'SHOPIFY',
  'INSTAGRAM',
  'WEBSITE',
  'UPLOADED_REFERENCE',
  'MANUAL_INPUT'
);

CREATE TYPE "BrandSourceStatus" AS ENUM ('PENDING', 'SYNCING', 'READY', 'FAILED');

CREATE TYPE "ImageRole" AS ENUM ('CATALOG', 'GENERATED', 'TRYON_OUTPUT', 'BRAND_REFERENCE');

CREATE TYPE "GarmentRole" AS ENUM ('FRONT', 'BACK', 'DETAIL', 'LIFESTYLE', 'SWATCH');

CREATE TYPE "AssetKind" AS ENUM (
  'BRAND_REFERENCE',
  'INSTAGRAM_REFERENCE',
  'USER_PHOTO',
  'GENERATED',
  'VIDEO'
);

CREATE TYPE "CreativeSetStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'PARTIAL', 'FAILED');

CREATE TYPE "QcState" AS ENUM (
  'NONE',
  'AUTO_PASSED',
  'AUTO_FLAGGED',
  'HUMAN_APPROVED',
  'HUMAN_REJECTED'
);

CREATE TYPE "CreativeRole" AS ENUM ('STILL', 'MOTION');

CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TYPE "FitPreference" AS ENUM ('FITTED', 'SLIM', 'REGULAR', 'RELAXED', 'OVERSIZED');

CREATE TYPE "TryOnMode" AS ENUM ('BODY_MODEL', 'PERSONAL_PHOTO');

CREATE TYPE "EventName" AS ENUM (
  'WIDGET_VIEWED',
  'TRYON_STARTED',
  'TRYON_COMPLETED',
  'TRYON_PHOTO_UPLOADED',
  'FIT_RECOMMENDED',
  'SIZE_SELECTED',
  'STYLE_VIEWED',
  'STYLE_PRODUCT_CLICKED',
  'COLOR_COMBO_VIEWED',
  'CREATIVE_IMPRESSION',
  'CREATIVE_SET_GENERATED',
  'PRODUCT_AUDIT_GENERATED',
  'ADD_TO_CART',
  'CHECKOUT_STARTED',
  'PURCHASE',
  'DEMO_PRODUCT_VIEWED',
  'DEMO_TRYON_BODY_SELECTED',
  'DEMO_TRYON_PHOTO_REQUESTED',
  'DEMO_FIT_SUBMITTED',
  'DEMO_STYLE_RECOMMENDATION_VIEWED',
  'DEMO_COLOR_COMBO_VIEWED',
  'DEMO_AUDIT_VIEWED',
  'WIDGET_OPENED',
  'WIDGET_CLOSED',
  'WIDGET_CTA_CLICKED',
  'WIDGET_BODY_MODEL_SELECTED',
  'WIDGET_FIT_SUBMITTED',
  'WIDGET_STYLE_VIEWED',
  'CHAT_OPENED',
  'CHAT_CLOSED',
  'CHAT_MESSAGE_SENT',
  'CHAT_REPLY_RECEIVED',
  'CHAT_PRODUCT_CLICKED',
  'CHAT_COMBO_PROPOSED',
  'CHAT_SEARCH_RUN',
  'CHAT_IMAGE_MATCH_RUN',
  'CHAT_NAV_REQUESTED',
  'CHAT_CART_REQUESTED',
  'CART_CONFIRMED',
  'CART_CANCELLED',
  'CART_FAILED',
  'SIGNUP_OFFERED',
  'SIGNUP_CARD_SHOWN',
  'SIGNUP_CLAIMED',
  'SIGNUP_DISMISSED',
  'ACCOUNT_CLAIMED',
  'WIDGET_STEP_VIEWED',
  'WIDGET_MOOD_SELECTED',
  'WIDGET_MODEL_SELECTED',
  'WIDGET_EXPERIENCE_SELECTED',
  'TRYON_RENDER_REQUESTED',
  'TRYON_RENDER_COMPLETED',
  'TRYON_RENDER_FAILED',
  'CHAT_PROFILE_CAPTURED',
  'CHAT_COMBO_VOTED',
  'WIDGET_COMBO_VIEWED'
);

CREATE TYPE "RecommendationKind" AS ENUM (
  'CATALOG_GAP',
  'WEAK_PDP_CREATIVE',
  'FIT_ACCURACY_DRIFT',
  'TOP_COMBO_TO_PROMOTE',
  'UNDERUSED_MOOD',
  'TASTE_SEGMENT_EMERGING',
  'CART_ABANDON_PATTERN',
  'STUDIO_PRODUCT_OPPORTUNITY',
  'STYLIST_DEMAND_SIGNAL',
  'CROSS_OFFERING'
);

CREATE TYPE "RecommendationSeverity" AS ENUM ('INFO', 'ATTENTION', 'URGENT');

CREATE TYPE "RecommendationSurface" AS ENUM ('STUDIO', 'WIDGET', 'STYLIST', 'CATALOG', 'CROSS');

-- ─── Tables ───────────────────────────────────────────────────────────────

-- Shopify session storage (required by @shopify/shopify-app-session-storage-prisma)
CREATE TABLE "Session" (
  "id"            TEXT         NOT NULL,
  "shop"          TEXT         NOT NULL,
  "state"         TEXT         NOT NULL,
  "isOnline"      BOOLEAN      NOT NULL DEFAULT false,
  "scope"         TEXT,
  "expires"       TIMESTAMP(3),
  "accessToken"   TEXT         NOT NULL,
  "userId"        BIGINT,
  "firstName"     TEXT,
  "lastName"      TEXT,
  "email"         TEXT,
  "accountOwner"  BOOLEAN      NOT NULL DEFAULT false,
  "locale"        TEXT,
  "collaborator"  BOOLEAN               DEFAULT false,
  "emailVerified" BOOLEAN               DEFAULT false,

  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- Core tenancy
CREATE TABLE "Shop" (
  "id"            TEXT         NOT NULL,
  "shopifyDomain" TEXT         NOT NULL,
  "accessToken"   TEXT         NOT NULL,
  "scopes"        TEXT         NOT NULL,
  "installedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uninstalledAt" TIMESTAMP(3),

  CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");
CREATE INDEX "Shop_shopifyDomain_idx" ON "Shop"("shopifyDomain");

-- Plan
CREATE TABLE "Plan" (
  "id"                   TEXT         NOT NULL,
  "shopId"               TEXT         NOT NULL,
  "tier"                 "PlanTier"   NOT NULL DEFAULT 'STARTER',
  "monthlyTryOnPersonal" INTEGER,
  "monthlyTryOnBody"     INTEGER,
  "monthlyCreatives"     INTEGER,
  "monthlyCreativeSets"  INTEGER,
  "monthlyStylistTurns"  INTEGER,
  "monthlyStyleRecs"     INTEGER,
  "monthlyFitRecs"       INTEGER,
  "creativeSets"         INTEGER,
  "analyticsLevel"       "AnalyticsLevel" NOT NULL DEFAULT 'BASIC',
  "supportLevel"         "SupportLevel"   NOT NULL DEFAULT 'STANDARD',
  "planFeaturesJson"     JSONB,
  "fairUseWarnAt"        DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "renewsAt"             TIMESTAMP(3),
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_shopId_key" ON "Plan"("shopId");

-- UsageCounter
CREATE TABLE "UsageCounter" (
  "id"          TEXT          NOT NULL,
  "shopId"      TEXT          NOT NULL,
  "metric"      "UsageMetric" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "count"       INTEGER      NOT NULL DEFAULT 0,

  CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageCounter_shopId_metric_periodStart_key"
  ON "UsageCounter"("shopId", "metric", "periodStart");
CREATE INDEX "UsageCounter_shopId_metric_idx" ON "UsageCounter"("shopId", "metric");

-- Notification
CREATE TABLE "Notification" (
  "id"        TEXT                NOT NULL,
  "shopId"    TEXT                NOT NULL,
  "kind"      "NotificationKind"  NOT NULL,
  "payload"   JSONB               NOT NULL,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_shopId_readAt_idx" ON "Notification"("shopId", "readAt");

-- BrandProfile
CREATE TABLE "BrandProfile" (
  "id"             TEXT         NOT NULL,
  "shopId"         TEXT         NOT NULL,
  "paletteJson"    JSONB,
  "toneJson"       JSONB,
  "styleVectors"   JSONB,
  "trainedAt"      TIMESTAMP(3),
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandProfile_shopId_key" ON "BrandProfile"("shopId");

-- BrandSource
CREATE TABLE "BrandSource" (
  "id"           TEXT                NOT NULL,
  "shopId"       TEXT                NOT NULL,
  "kind"         "BrandSourceKind"   NOT NULL,
  "identifier"   TEXT,
  "payload"      JSONB,
  "status"       "BrandSourceStatus" NOT NULL DEFAULT 'PENDING',
  "lastSyncedAt" TIMESTAMP(3),
  "error"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BrandSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BrandSource_shopId_kind_idx" ON "BrandSource"("shopId", "kind");

-- Asset
CREATE TABLE "Asset" (
  "id"             TEXT        NOT NULL,
  "brandProfileId" TEXT,
  "url"            TEXT        NOT NULL,
  "kind"           "AssetKind" NOT NULL,
  "meta"           JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- Product
CREATE TABLE "Product" (
  "id"                  TEXT         NOT NULL,
  "shopId"              TEXT         NOT NULL,
  "shopifyId"           TEXT         NOT NULL,
  "handle"              TEXT         NOT NULL,
  "title"               TEXT         NOT NULL,
  "productType"         TEXT,
  "vendor"              TEXT,
  "tags"                TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "primaryColor"        TEXT,
  "colorFamily"         TEXT,
  "category"            TEXT,
  "primaryTryonImageId" TEXT,
  "tryonReady"          BOOLEAN      NOT NULL DEFAULT false,
  "widgetTier"          INTEGER      NOT NULL DEFAULT 1,
  "qualityComputedAt"   TIMESTAMP(3),
  "sizeChartJson"       JSONB,
  "sizeChartSource"     TEXT,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Product_shopId_shopifyId_key" ON "Product"("shopId", "shopifyId");
CREATE INDEX "Product_shopId_category_idx" ON "Product"("shopId", "category");
CREATE INDEX "Product_shopId_tryonReady_idx" ON "Product"("shopId", "tryonReady");

-- ProductVariant
CREATE TABLE "ProductVariant" (
  "id"                TEXT    NOT NULL,
  "productId"         TEXT    NOT NULL,
  "shopifyId"         TEXT    NOT NULL,
  "sku"               TEXT,
  "size"              TEXT,
  "color"             TEXT,
  "priceCents"        INTEGER,
  "measurementsJson"  JSONB,
  "measurementsSource" TEXT,

  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductVariant_productId_shopifyId_key"
  ON "ProductVariant"("productId", "shopifyId");

-- ProductImage
CREATE TABLE "ProductImage" (
  "id"               TEXT         NOT NULL,
  "productId"        TEXT         NOT NULL,
  "shopifyId"        TEXT,
  "url"              TEXT         NOT NULL,
  "position"         INTEGER      NOT NULL DEFAULT 0,
  "role"             "ImageRole"  NOT NULL DEFAULT 'CATALOG',
  "qualityScore"     DOUBLE PRECISION,
  "qualityCheckedAt" TIMESTAMP(3),
  "qualityReasons"   TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "qualityProvider"  TEXT,
  "widthPx"          INTEGER,
  "heightPx"         INTEGER,
  "bytes"            INTEGER,
  "garmentRole"      "GarmentRole",
  "preppedUrl"       TEXT,
  "preppedAt"        TIMESTAMP(3),

  CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");
CREATE INDEX "ProductImage_productId_qualityScore_idx"
  ON "ProductImage"("productId", "qualityScore");

-- CreativeSet
CREATE TABLE "CreativeSet" (
  "id"           TEXT                NOT NULL,
  "shopId"       TEXT                NOT NULL,
  "productId"    TEXT,
  "status"       "CreativeSetStatus" NOT NULL DEFAULT 'PENDING',
  "brief"        JSONB,
  "providerMeta" JSONB,
  "qcState"      "QcState"           NOT NULL DEFAULT 'NONE',
  "retryCount"   INTEGER             NOT NULL DEFAULT 0,
  "error"        TEXT,
  "triggeredBy"  TEXT,
  "createdAt"    TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)        NOT NULL,

  CONSTRAINT "CreativeSet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CreativeSet_shopId_productId_idx" ON "CreativeSet"("shopId", "productId");
CREATE INDEX "CreativeSet_shopId_status_idx" ON "CreativeSet"("shopId", "status");

-- Creative
CREATE TABLE "Creative" (
  "id"              TEXT          NOT NULL,
  "shopId"          TEXT          NOT NULL,
  "productId"       TEXT,
  "setId"           TEXT,
  "role"            "CreativeRole" NOT NULL DEFAULT 'STILL',
  "assetKind"       "AssetKind"   NOT NULL DEFAULT 'GENERATED',
  "sourceComboName" TEXT,
  "sourceComboIds"  TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "prompt"          TEXT          NOT NULL,
  "imageUrl"        TEXT,
  "videoUrl"        TEXT,
  "status"          "JobStatus"   NOT NULL DEFAULT 'PENDING',
  "providerJob"     TEXT,
  "error"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Creative_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Creative_shopId_setId_idx" ON "Creative"("shopId", "setId");

-- ProductAudit
CREATE TABLE "ProductAudit" (
  "id"                  TEXT         NOT NULL,
  "shopId"              TEXT         NOT NULL,
  "productId"           TEXT         NOT NULL,
  "missingSizeChart"    BOOLEAN      NOT NULL DEFAULT false,
  "weakImageQuality"    BOOLEAN      NOT NULL DEFAULT false,
  "missingStyling"      BOOLEAN      NOT NULL DEFAULT false,
  "missingTryOnReady"   BOOLEAN      NOT NULL DEFAULT false,
  "missingColorCombos"  BOOLEAN      NOT NULL DEFAULT false,
  "recommendations"     JSONB        NOT NULL,
  "priorityScore"       DOUBLE PRECISION NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductAudit_shopId_productId_key"
  ON "ProductAudit"("shopId", "productId");
CREATE INDEX "ProductAudit_shopId_priorityScore_idx"
  ON "ProductAudit"("shopId", "priorityScore");

-- ShopperSession
CREATE TABLE "ShopperSession" (
  "id"                   TEXT         NOT NULL,
  "sessionId"            TEXT         NOT NULL,
  "shopifyDomain"        TEXT         NOT NULL,
  "shopifyCustomerId"    TEXT,
  "heightCm"             INTEGER,
  "weightKg"             INTEGER,
  "fitPreference"        "FitPreference",
  "bodyType"             TEXT,
  "photoAssetId"         TEXT,
  "email"                TEXT,
  "displayName"          TEXT,
  "marketingOptIn"       BOOLEAN      NOT NULL DEFAULT false,
  "accountClaimedAt"     TIMESTAMP(3),
  "emailVerifyToken"     TEXT,
  "emailVerifyExpiry"    TIMESTAMP(3),
  "emailVerified"        BOOLEAN      NOT NULL DEFAULT false,
  "chatHistoryJson"      JSONB,
  "signupOfferedAt"      TIMESTAMP(3),
  "sentimentLabel"       TEXT,
  "sentimentThemes"      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sentimentSummary"     TEXT,
  "sentimentFoundItem"   TEXT,
  "sentimentExtractedAt" TIMESTAMP(3),
  "tasteVectorJson"      JSONB,
  "tasteComputedAt"      TIMESTAMP(3),
  "signalCount"          INTEGER      NOT NULL DEFAULT 0,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ShopperSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopperSession_sessionId_key" ON "ShopperSession"("sessionId");
CREATE INDEX "ShopperSession_shopifyDomain_shopifyCustomerId_idx"
  ON "ShopperSession"("shopifyDomain", "shopifyCustomerId");
CREATE INDEX "ShopperSession_shopifyDomain_idx" ON "ShopperSession"("shopifyDomain");
CREATE INDEX "ShopperSession_email_idx" ON "ShopperSession"("email");

-- TryOnSession
CREATE TABLE "TryOnSession" (
  "id"             TEXT         NOT NULL,
  "shopId"         TEXT         NOT NULL,
  "shopperId"      TEXT         NOT NULL,
  "productId"      TEXT         NOT NULL,
  "mode"           "TryOnMode"  NOT NULL,
  "status"         "JobStatus"  NOT NULL DEFAULT 'PENDING',
  "inputPhotoUrl"  TEXT,
  "outputImageUrl" TEXT,
  "providerJob"    TEXT,
  "error"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "providerKey"    TEXT,
  "modelKey"       TEXT,
  "modelHint"      TEXT,
  "latencyMs"      INTEGER,
  "completedAt"    TIMESTAMP(3),
  "cacheKey"       TEXT,

  CONSTRAINT "TryOnSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TryOnSession_shopId_productId_idx" ON "TryOnSession"("shopId", "productId");
CREATE INDEX "TryOnSession_shopperId_idx" ON "TryOnSession"("shopperId");
CREATE INDEX "TryOnSession_shopId_cacheKey_idx" ON "TryOnSession"("shopId", "cacheKey");

-- FitSession
CREATE TABLE "FitSession" (
  "id"              TEXT         NOT NULL,
  "shopId"          TEXT         NOT NULL,
  "shopperId"       TEXT         NOT NULL,
  "productId"       TEXT         NOT NULL,
  "recommendedSize" TEXT         NOT NULL,
  "confidence"      DOUBLE PRECISION NOT NULL,
  "reasoning"       JSONB,
  "chosenSize"      TEXT,
  "sizeDelta"       INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FitSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FitSession_shopId_productId_idx" ON "FitSession"("shopId", "productId");

-- StyleSession
CREATE TABLE "StyleSession" (
  "id"             TEXT         NOT NULL,
  "shopId"         TEXT         NOT NULL,
  "shopperId"      TEXT         NOT NULL,
  "productId"      TEXT         NOT NULL,
  "outfitJson"     JSONB        NOT NULL,
  "colorCombosJson" JSONB       NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StyleSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StyleSession_shopId_productId_idx" ON "StyleSession"("shopId", "productId");

-- AnalyticsEvent
CREATE TABLE "AnalyticsEvent" (
  "id"         TEXT         NOT NULL,
  "shopId"     TEXT         NOT NULL,
  "shopperId"  TEXT,
  "name"       "EventName"  NOT NULL,
  "productId"  TEXT,
  "variantId"  TEXT,
  "payload"    JSONB        NOT NULL,
  "url"        TEXT,
  "userAgent"  TEXT,
  "variantTag" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsEvent_shopId_name_createdAt_idx"
  ON "AnalyticsEvent"("shopId", "name", "createdAt");
CREATE INDEX "AnalyticsEvent_shopId_productId_createdAt_idx"
  ON "AnalyticsEvent"("shopId", "productId", "createdAt");

-- CatalogGap
CREATE TABLE "CatalogGap" (
  "id"              TEXT         NOT NULL,
  "shopId"          TEXT         NOT NULL,
  "shopperId"       TEXT,
  "rawQuery"        TEXT         NOT NULL,
  "normalizedQuery" TEXT         NOT NULL,
  "resultCount"     INTEGER      NOT NULL,
  "category"        TEXT,
  "colorFamily"     TEXT,
  "source"          TEXT         NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CatalogGap_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CatalogGap_shopId_normalizedQuery_idx"
  ON "CatalogGap"("shopId", "normalizedQuery");
CREATE INDEX "CatalogGap_shopId_createdAt_idx" ON "CatalogGap"("shopId", "createdAt");

-- BrandRecommendation
CREATE TABLE "BrandRecommendation" (
  "id"            TEXT                    NOT NULL,
  "shopId"        TEXT                    NOT NULL,
  "productId"     TEXT,
  "kind"          "RecommendationKind"    NOT NULL,
  "severity"      "RecommendationSeverity" NOT NULL DEFAULT 'INFO',
  "title"         TEXT                    NOT NULL,
  "body"          TEXT                    NOT NULL,
  "evidence"      JSONB                   NOT NULL,
  "source"        TEXT                    NOT NULL,
  "surface"       "RecommendationSurface" NOT NULL,
  "minTierToView" "PlanTier"              NOT NULL,
  "actionUrl"     TEXT,
  "ctaLabel"      TEXT,
  "dedupeKey"     TEXT                    NOT NULL,
  "generatedAt"   TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dismissedAt"   TIMESTAMP(3),
  "takenAt"       TIMESTAMP(3),

  CONSTRAINT "BrandRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandRecommendation_shopId_kind_dedupeKey_key"
  ON "BrandRecommendation"("shopId", "kind", "dedupeKey");
CREATE INDEX "BrandRecommendation_shopId_dismissedAt_severity_idx"
  ON "BrandRecommendation"("shopId", "dismissedAt", "severity");
CREATE INDEX "BrandRecommendation_shopId_surface_generatedAt_idx"
  ON "BrandRecommendation"("shopId", "surface", "generatedAt");

-- BrandTasteSnapshot
CREATE TABLE "BrandTasteSnapshot" (
  "id"              TEXT         NOT NULL,
  "shopId"          TEXT         NOT NULL,
  "snapshotDate"    TIMESTAMP(3) NOT NULL,
  "colorFamilyJson" JSONB        NOT NULL,
  "silhouetteJson"  JSONB        NOT NULL,
  "categoryJson"    JSONB        NOT NULL,
  "priceTierJson"   JSONB        NOT NULL,
  "moodJson"        JSONB        NOT NULL,
  "modelJson"       JSONB        NOT NULL,
  "chatSessions"    INTEGER      NOT NULL DEFAULT 0,
  "combosProposed"  INTEGER      NOT NULL DEFAULT 0,
  "cartConfirmed"   INTEGER      NOT NULL DEFAULT 0,
  "signupsClaimed"  INTEGER      NOT NULL DEFAULT 0,
  "tryOnSessions"   INTEGER      NOT NULL DEFAULT 0,
  "fitSubmitted"    INTEGER      NOT NULL DEFAULT 0,
  "creativesCount"  INTEGER      NOT NULL DEFAULT 0,
  "comboCtr"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "signupRate"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fitToCartRate"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sampleSize"      INTEGER      NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BrandTasteSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandTasteSnapshot_shopId_snapshotDate_key"
  ON "BrandTasteSnapshot"("shopId", "snapshotDate");
CREATE INDEX "BrandTasteSnapshot_shopId_snapshotDate_idx"
  ON "BrandTasteSnapshot"("shopId", "snapshotDate");

-- NetworkBenchmark
CREATE TABLE "NetworkBenchmark" (
  "id"           TEXT         NOT NULL,
  "dimension"    TEXT         NOT NULL,
  "computedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "p25"          DOUBLE PRECISION NOT NULL,
  "p50"          DOUBLE PRECISION NOT NULL,
  "p75"          DOUBLE PRECISION NOT NULL,
  "p90"          DOUBLE PRECISION NOT NULL,
  "mean"         DOUBLE PRECISION NOT NULL,
  "sampleBrands" INTEGER      NOT NULL,
  "segment"      TEXT                  DEFAULT 'all',

  CONSTRAINT "NetworkBenchmark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NetworkBenchmark_dimension_segment_computedAt_key"
  ON "NetworkBenchmark"("dimension", "segment", "computedAt");
CREATE INDEX "NetworkBenchmark_dimension_segment_computedAt_idx"
  ON "NetworkBenchmark"("dimension", "segment", "computedAt");

-- Experiment
CREATE TABLE "Experiment" (
  "id"            TEXT         NOT NULL,
  "shopId"        TEXT,
  "key"           TEXT         NOT NULL,
  "description"   TEXT,
  "active"        BOOLEAN      NOT NULL DEFAULT false,
  "startedAt"     TIMESTAMP(3),
  "endedAt"       TIMESTAMP(3),
  "allocation"    JSONB        NOT NULL,
  "variantConfig" JSONB        NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Experiment_key_key" ON "Experiment"("key");
CREATE INDEX "Experiment_shopId_active_idx" ON "Experiment"("shopId", "active");

-- ProductEmbedding
CREATE TABLE "ProductEmbedding" (
  "id"         TEXT         NOT NULL,
  "shopId"     TEXT         NOT NULL,
  "productId"  TEXT         NOT NULL,
  "vector"     DOUBLE PRECISION[] NOT NULL,
  "modelKey"   TEXT         NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductEmbedding_productId_key" ON "ProductEmbedding"("productId");
CREATE INDEX "ProductEmbedding_shopId_idx" ON "ProductEmbedding"("shopId");

-- ─── Foreign Keys ─────────────────────────────────────────────────────────

ALTER TABLE "Plan" ADD CONSTRAINT "Plan_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BrandSource" ADD CONSTRAINT "BrandSource_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_brandProfileId_fkey"
  FOREIGN KEY ("brandProfileId") REFERENCES "BrandProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CreativeSet" ADD CONSTRAINT "CreativeSet_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CreativeSet" ADD CONSTRAINT "CreativeSet_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Creative" ADD CONSTRAINT "Creative_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Creative" ADD CONSTRAINT "Creative_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Creative" ADD CONSTRAINT "Creative_setId_fkey"
  FOREIGN KEY ("setId") REFERENCES "CreativeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductAudit" ADD CONSTRAINT "ProductAudit_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductAudit" ADD CONSTRAINT "ProductAudit_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TryOnSession" ADD CONSTRAINT "TryOnSession_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TryOnSession" ADD CONSTRAINT "TryOnSession_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TryOnSession" ADD CONSTRAINT "TryOnSession_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FitSession" ADD CONSTRAINT "FitSession_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FitSession" ADD CONSTRAINT "FitSession_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FitSession" ADD CONSTRAINT "FitSession_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StyleSession" ADD CONSTRAINT "StyleSession_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StyleSession" ADD CONSTRAINT "StyleSession_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StyleSession" ADD CONSTRAINT "StyleSession_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogGap" ADD CONSTRAINT "CatalogGap_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogGap" ADD CONSTRAINT "CatalogGap_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "ShopperSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BrandRecommendation" ADD CONSTRAINT "BrandRecommendation_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BrandRecommendation" ADD CONSTRAINT "BrandRecommendation_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BrandTasteSnapshot" ADD CONSTRAINT "BrandTasteSnapshot_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductEmbedding" ADD CONSTRAINT "ProductEmbedding_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductEmbedding" ADD CONSTRAINT "ProductEmbedding_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
