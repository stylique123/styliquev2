#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalize = readFileSync(resolve(root, "packages/core/src/catalog/normalize.ts"), "utf8");
const sync = readFileSync(resolve(root, "packages/core/src/catalog/sync.ts"), "utf8");
const catalogWorker = readFileSync(resolve(root, "apps/worker/src/jobs/catalog-sync.ts"), "utf8");
const imageQuality = readFileSync(resolve(root, "apps/worker/src/jobs/image-quality.ts"), "utf8");
const sizeChart = readFileSync(resolve(root, "apps/worker/src/jobs/size-chart-extract.ts"), "utf8");
const brandDnaWorker = readFileSync(resolve(root, "apps/worker/src/jobs/brand-dna-catalog.ts"), "utf8");
const brandDnaCore = readFileSync(resolve(root, "packages/core/src/studio/brand-dna.ts"), "utf8");
const serialize = readFileSync(resolve(root, "apps/shopify-app/app/lib/serialize.ts"), "utf8");
const miraWidget = readFileSync(resolve(root, "apps/web/app/components/mira/MiraWidget.tsx"), "utf8");
const tryOnPanel = readFileSync(resolve(root, "apps/web/app/components/surfaces/TryOnPanel.tsx"), "utf8");
const recommendations = readFileSync(resolve(root, "packages/core/src/recommendations/service.ts"), "utf8");
const testsCatalog = readFileSync(resolve(root, "packages/core/src/__tests__/catalog.test.ts"), "utf8");
const testsImage = readFileSync(resolve(root, "packages/core/src/__tests__/imagery-quality.test.ts"), "utf8");
const testsSerialize = readFileSync(resolve(root, "apps/shopify-app/app/lib/serialize.test.ts"), "utf8");
const testsRecommendations = readFileSync(resolve(root, "packages/core/src/__tests__/recommendations.test.ts"), "utf8");
const testsFixture = readFileSync(resolve(root, "apps/shopify-app/app/lib/catalog-extraction-chain.test.ts"), "utf8");

const failures = [];

// Shopify extraction source preservation.
if (!/descriptionHtml\?: string \| null/.test(normalize) || !/metafields\?: Array/.test(normalize)) {
  failures.push("normalizeProduct must accept descriptionHtml and metafields as extraction sources");
}

if (!/altText:\s*img\.altText \?\? null/.test(normalize) || !/sizeChartJson:\s*sizeChart/.test(normalize)) {
  failures.push("normalizeProduct must preserve image alt text and metafield-derived size charts");
}

if (!/descriptionHtml:\s*n\.descriptionHtml/.test(sync) || !/altText:\s*img\.altText/.test(sync)) {
  failures.push("catalog sync must persist product description HTML and image alt text");
}

if (!/sameImageSet\([\s\S]*altText/.test(sync)) {
  failures.push("catalog sync image-change detection must include alt text so updated size-guide/product-photo labels rescore");
}

// Follow-up job acceptance after sync.
if (!/embedAllForShop\(data\.shopId\)\.catch/.test(catalogWorker) || !/providerConfigured:\s*Boolean\(process\.env\.GEMINI_API_KEY\)/.test(catalogWorker)) {
  failures.push("catalog-sync worker must keep honest worker-embedding failure/provider status in the sync payload");
}

if (!/const imageQuality = emptyEnqueueSummary\(1\)/.test(catalogWorker) || !/const sizeCharts = emptyEnqueueSummary\(activeProducts\.length\)/.test(catalogWorker)) {
  failures.push("catalog-sync worker must summarize image-quality and size-chart follow-up enqueue results");
}

if (!/brandDnaQueued = await enqueueBrandDnaRefresh/.test(catalogWorker)) {
  failures.push("catalog-sync worker must enqueue Brand DNA refresh as part of the catalog extraction chain");
}

// Image scoring writes the state the widget/card serializer consumes.
if (!/select:\s*\{ id: true, url: true, position: true, shopifyId: true, altText: true \}/.test(imageQuality)) {
  failures.push("image-quality worker must score with Shopify alt text");
}

if (!/primaryTryonImageId:\s*update\.primaryTryonImageId/.test(imageQuality) || !/tryonReady:\s*update\.tryonReady/.test(imageQuality) || !/widgetTier:\s*update\.widgetTier/.test(imageQuality)) {
  failures.push("image-quality worker must persist product-level primary image, try-on readiness, and widget tier");
}

if (!/garmentRole:\s*u\.garmentRole/.test(imageQuality) || !/preppedUrl:\s*dataUrl/.test(imageQuality)) {
  failures.push("image-quality worker must persist garment roles and prepped primary image URLs");
}

// Size-chart extraction bridges to fit recommendation input, not just product JSON.
if (!/descriptionHtml:\s*true/.test(sizeChart) || !/images:\s*\{[\s\S]*altText:\s*true[\s\S]*garmentRole:\s*true/.test(sizeChart)) {
  failures.push("size-chart worker must read description text plus image alt/role metadata");
}

if (!/ProductVariant\.measurementsJson/.test(sizeChart) || !/measurementsJson:\s*\{ \.\.\.measurements/.test(sizeChart)) {
  failures.push("size-chart worker must bridge extracted rows to ProductVariant.measurementsJson");
}

if (!/measurementsJson:\s*Prisma\.JsonNull/.test(sizeChart)) {
  failures.push("size-chart worker must clear stale bridge-owned variant measurements");
}

const sizingTests = readFileSync(resolve(root, "packages/core/src/__tests__/sizing-parsers.test.ts"), "utf8");
const imageOcrExtractor = readFileSync(resolve(root, "packages/core/src/sizing/extractors/image-ocr.ts"), "utf8");
if (!/normalizes OCR inch measurements to centimeters before fit bridging/.test(sizingTests) || !/unit:\s*"in"/.test(sizingTests)) {
  failures.push("sizing parser tests must prove OCR inch charts normalize to centimeters before bridge writes");
}

if (!/normalizeOcrChart/.test(imageOcrExtractor) || !/inchesToCm/.test(imageOcrExtractor) || !/unit:\s*normalized\.unit/.test(imageOcrExtractor)) {
  failures.push("image OCR extractor must normalize inch measurements to cm before returning a chart");
}

// Brand DNA should see scored product imagery and rich metadata.
if (!/where:\s*\{ shopId, tryonReady: true \}/.test(brandDnaWorker)) {
  failures.push("Brand DNA catalog job should prefer try-on-ready products");
}

if (!/primaryTryonImageId:\s*true/.test(brandDnaWorker) || !/qualityScore:\s*true/.test(brandDnaWorker) || !/garmentRole:\s*true/.test(brandDnaWorker) || !/altText:\s*true/.test(brandDnaWorker)) {
  failures.push("Brand DNA catalog job must read scored image role/quality/alt metadata");
}

if (!/descriptionText:\s*p\.descriptionHtml/.test(brandDnaWorker) || !/productType:\s*p\.productType/.test(brandDnaWorker) || !/tags:\s*p\.tags/.test(brandDnaWorker)) {
  failures.push("Brand DNA catalog job must pass product type, tags, and description text to the extractor");
}

if (!/orderBrandDnaImages\(p\.images, p\.primaryTryonImageId\)/.test(brandDnaWorker)) {
  failures.push("Brand DNA catalog job must order images through the scored primary/role-aware helper");
}

if (!/imageAlt=/.test(brandDnaCore) || !/description=/.test(brandDnaCore) || !/dominantFabrics/.test(brandDnaCore)) {
  failures.push("Brand DNA core prompt must include image alt, description text, and fabric/positioning extraction");
}

// Public product/card serialization must consume the same resolved imagery.
if (!/resolveTryonImage/.test(serialize) || !/tryonImageUrl = p\.tryonReady \?/.test(serialize)) {
  failures.push("shopper product serialization must use role-aware resolved images and gate try-on URL on tryonReady");
}

if (!/cardImageUrl\?: string \| null/.test(readFileSync(resolve(root, "apps/web/app/lib/catalog.ts"), "utf8")) || !/tryonImageUrl\?: string \| null/.test(readFileSync(resolve(root, "apps/web/app/lib/catalog.ts"), "utf8"))) {
  failures.push("web Product type must carry resolved cardImageUrl and tryonImageUrl fields");
}

if (!/function productCardImage\(product: Product\)/.test(miraWidget) || !/function hydrateResolvedStorefrontProduct/.test(miraWidget)) {
  failures.push("Mira widget must centralize card image selection and hydrate the current PDP from app-proxy serialized product data");
}

if (!/normalizeShopperProductPayload/.test(miraWidget) || !/tryonImageUrl: raw\.tryonImageUrl/.test(miraWidget)) {
  failures.push("Mira widget must preserve app-proxy imageUrl/tryonImageUrl when registering real products");
}

for (const forbidden of [
  /<Image src=\{p\.images\[0\]/,
  /<Image src=\{product\.images\[0\]/,
  /backgroundImage: `url\(\$\{p\.images\[0\]\}\)`/,
]) {
  if (forbidden.test(miraWidget)) {
    failures.push("Mira recommendation/look/context cards must render productCardImage(), not raw images[0]");
    break;
  }
}

if (!/function productVisualImage\(product: Product\)/.test(tryOnPanel)) {
  failures.push("TryOnPanel must centralize visual image selection through productVisualImage()");
}

if (!/data-stylique-tryon-garment-image/.test(tryOnPanel)) {
  failures.push("TryOnPanel must expose a stable resolved/rendered garment image hook for browser image-truth tests");
}

for (const forbidden of [
  /garments\.map\(\(g\) => g\.images\[0\]\)/,
  /bodyImg \?\? currentProduct\.images\[0\]/,
  /renderedUrl \?\? wornLook\[0\]\.images\[0\]/,
  /backgroundImage: `url\(\$\{p\.images\[0\]\}\)`/,
]) {
  if (forbidden.test(tryOnPanel)) {
    failures.push("TryOnPanel visible/render paths must use productVisualImage(), not raw images[0]");
    break;
  }
}

// Recommendation demand should consume real shopper demand, not maintenance rows.
if (!/recommendationCatalogGapWhere/.test(recommendations) || !/source:\s*\{ not: "size_chart_extract" \}/.test(recommendations)) {
  failures.push("recommendation catalog-gap generator must use the shared real-demand predicate");
}

// Keep fixture/unit proof around the most important handoffs.
if (!/altText\)\.toBe\("Oxford shirt size guide"\)/.test(testsCatalog) || !/resets stale try-on image state/.test(testsCatalog)) {
  failures.push("catalog tests must prove alt text persistence and stale image-state reset");
}

if (!/uses Shopify alt text to reject size-guide\/detail images/.test(testsImage) || !/does not fall back to a first-position size guide/.test(testsImage)) {
  failures.push("image tests must prove alt-aware primary image selection");
}

if (!/does not use a styled full-outfit image as the try-on garment anchor/.test(testsImage) || !/model wearing ivory shirt with trousers/.test(testsImage)) {
  failures.push("image tests must prove outfit/model/styled-with imagery is not used as the try-on garment anchor");
}

if (!/uses the role-aware product image instead of first-position size-guide imagery/.test(testsSerialize)) {
  failures.push("serializer tests must prove card image output avoids size-guide first images");
}

if (!/ignores internal size-chart extraction rows/.test(testsRecommendations)) {
  failures.push("recommendation tests must prove maintenance size-chart rows do not become shopper-demand actions");
}

if (!/turns one Shopify product into card-ready imagery, variant fit evidence, and Brand DNA inputs/.test(testsFixture)) {
  failures.push("catalog extraction chain must include an executable product-to-card fixture test");
}

for (const requiredCall of [
  "normalizeProduct",
  "scoreProductImages",
  "extractSizeChartMultiSource",
  "recommendFit",
  "orderBrandDnaImages",
  "toShopperProduct",
]) {
  if (!testsFixture.includes(requiredCall)) {
    failures.push(`catalog extraction fixture must exercise ${requiredCall}`);
  }
}

if (!/expect\(shopperProduct\.tryonImageUrl\)\.toBe\("https:\/\/cdn\.example\/linen-front-prepped\.png"\)/.test(testsFixture)) {
  failures.push("catalog extraction fixture must prove card/try-on serialization uses the prepped front product image");
}

if (failures.length > 0) {
  console.error("Catalog extraction chain contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("catalog extraction chain contract verifier passed");
