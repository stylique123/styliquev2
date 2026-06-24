#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const panel = readFileSync(resolve(root, "apps/web/app/components/surfaces/TryOnPanel.tsx"), "utf8");
const types = readFileSync(resolve(root, "packages/types/src/index.ts"), "utf8");
const analyticsTest = readFileSync(resolve(root, "packages/core/src/__tests__/analytics.test.ts"), "utf8");
const shopperEvents = readFileSync(resolve(root, "apps/shopify-app/app/lib/shopper-events.server.ts"), "utf8");
const shopperEventsTest = readFileSync(resolve(root, "apps/shopify-app/app/lib/shopper-events.server.test.ts"), "utf8");
const bridgeEvents = readFileSync(resolve(root, "apps/shopify-app/app/routes/api.mira.event.tsx"), "utf8");
const bridgeEventsTest = readFileSync(resolve(root, "apps/shopify-app/app/routes/api.mira.event.test.ts"), "utf8");
const productEvidence = readFileSync(resolve(root, "apps/shopify-app/app/lib/product-evidence.server.ts"), "utf8");
const productEvidenceTest = readFileSync(resolve(root, "apps/shopify-app/app/lib/product-evidence.server.test.ts"), "utf8");

const failures = [];

if (!/CART_FROM_TRYON:\s*z\.object\(\{[\s\S]{0,220}productIds:\s*z\.array\(z\.string\(\)\)\.optional\(\)/.test(types)) {
  failures.push("CART_FROM_TRYON payload schema must accept productIds for multi-piece try-on cart success");
}

if (!/const productIds = \[[\s\S]{0,220}currentProduct\.productId[\s\S]{0,220}effectiveLookItems\.map\(\(p\) => p\.productId\)/.test(panel)) {
  failures.push("TryOnPanel add-look success must collect productIds for the anchor and look pieces");
}

if (!/emitStorefrontEvent\("CART_FROM_TRYON", currentProduct, \{[\s\S]{0,180}comboName:[\s\S]{0,180}productIds,[\s\S]{0,180}size: effectiveSize/.test(panel)) {
  failures.push("TryOnPanel add-look success must emit productIds with CART_FROM_TRYON after addOutfitToCart succeeds");
}

if (!/addOutfitToCart\(pieces\)[\s\S]{0,420}if \(!result\.ok\)[\s\S]{0,420}emitStorefrontEvent\("CART_FROM_TRYON"/.test(panel)) {
  failures.push("TryOnPanel must emit CART_FROM_TRYON only after addOutfitToCart succeeds");
}

if (!/multi-product try-on cart success evidence/.test(analyticsTest) || !/product-shoe/.test(analyticsTest) || !/product-bag/.test(analyticsTest)) {
  failures.push("Analytics tests must prove multi-product CART_FROM_TRYON payloads are valid");
}

if (!/CLIENT_CART_SUCCESS_EVENTS[\s\S]{0,120}CART_FROM_TRYON[\s\S]{0,120}CART_FROM_WIDGET_STYLE/.test(shopperEvents)) {
  failures.push("Shopper event ingestion must identify client cart-success events for product-evidence validation");
}

if (!/validateShopProductEvidence/.test(productEvidence) || !/prisma\.product\.findMany/.test(productEvidence) || !/shopId:\s*args\.shopId/.test(productEvidence)) {
  failures.push("Shared product-evidence helper must validate product evidence against the current shop");
}

if (!/requiresProductEvidence/.test(productEvidence) || !/ids\.length === 0/.test(productEvidence) || !/validIds\.length === 0/.test(productEvidence)) {
  failures.push("Shared product-evidence helper must validate all supplied product evidence while allowing productless non-cart telemetry");
}

if (!/validateShopProductEvidence/.test(shopperEvents) || /function validateClientProductEvidence/.test(shopperEvents)) {
  failures.push("Shopper event ingestion must use the shared product-evidence helper instead of local validation");
}

if (!/payload:\s*productEvidence\.payload/.test(shopperEvents) || !/productId:\s*productEvidence\.productId/.test(shopperEvents)) {
  failures.push("Shopper event ingestion must persist canonicalized product evidence");
}

if (!/preserves only shop-owned productIds/.test(shopperEventsTest) || !/rejects client cart-success events with no shop-owned product evidence/.test(shopperEventsTest)) {
  failures.push("Shopper event tests must prove cart-success product IDs are shop-owned before analytics stores them");
}

if (!/rejects non-cart telemetry when supplied product evidence is not shop-owned/.test(shopperEventsTest)) {
  failures.push("Shopper event tests must reject non-cart product evidence that is not shop-owned");
}

if (!/BRIDGE_CART_SUCCESS_EVENTS[\s\S]{0,80}CART_FROM_TRYON/.test(bridgeEvents)) {
  failures.push("Bridge event ingestion must identify bridge cart-success events for product-evidence validation");
}

if (!/validateShopProductEvidence/.test(bridgeEvents) || /function validateBridgeProductEvidence/.test(bridgeEvents)) {
  failures.push("Bridge event ingestion must use the shared product-evidence helper instead of local validation");
}

if (!/payload:\s*productEvidence\.payload/.test(bridgeEvents) || !/productId:\s*productEvidence\.productId/.test(bridgeEvents)) {
  failures.push("Bridge event ingestion must persist canonicalized product evidence");
}

if (!/canonicalizes bridge cart-success productIds/.test(bridgeEventsTest) || !/rejects bridge cart-success events with no shop-owned product evidence/.test(bridgeEventsTest)) {
  failures.push("Bridge event tests must prove cart-success product IDs are shop-owned before analytics stores them");
}

if (!/rejects bridge non-cart events when supplied product evidence is not shop-owned/.test(bridgeEventsTest)) {
  failures.push("Bridge event tests must reject non-cart product evidence that is not shop-owned");
}

if (!/keeps only current-shop product ids/.test(productEvidenceTest) || !/rejects cart-success events with no current-shop product evidence/.test(productEvidenceTest) || !/canonicalizes non-cart product evidence/.test(productEvidenceTest) || !/rejects non-cart events that carry only foreign product evidence/.test(productEvidenceTest)) {
  failures.push("Shared product-evidence helper tests must prove canonicalization and rejection behavior");
}

if (failures.length > 0) {
  console.error("Try-on cart learning contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("try-on cart learning verifier passed");
