#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = readFileSync(resolve(root, "apps/web/scripts/storefront-e2e.spec.mjs"), "utf8");
const config = readFileSync(resolve(root, "apps/web/playwright.config.mjs"), "utf8");

const failures = [];

if (!/process\.exit\(1\)/.test(spec) || !/SHOPIFY_TEST_STORE_URL/.test(spec) || !/SHOPIFY_TEST_PRODUCT_HANDLE/.test(spec)) {
  failures.push("live storefront E2E must fail closed when store URL or product handle is missing");
}

if (!/data-stylique-reco-card/.test(spec) || !/data-stylique-look-card/.test(spec)) {
  failures.push("live storefront E2E must assert recommendation/look card rendering");
}

if (!/product_media_focus/.test(spec) || !/data-stylique-nudge/.test(spec) || !/MIRA_PROACTIVE_TRIGGERED/.test(spec)) {
  failures.push("live storefront E2E must assert proactive product-media intent nudge and telemetry");
}

if (!/boundingBox\(\)/.test(spec) || !/toBeGreaterThan\(180\)/.test(spec) || !/toBeGreaterThan\(120\)/.test(spec)) {
  failures.push("card E2E must prove visible card geometry, not only selector existence");
}

if (!/assertResolvedCardImagery/.test(spec) || !/data-stylique-card-image="resolved"/.test(spec) || !/SHOPIFY_TEST_EXPECTED_CARD_IMAGE_FRAGMENT/.test(spec)) {
  failures.push("card E2E must assert resolved card image srcs and support an exact expected-image fragment for size-guide-first fixtures");
}

if (!/SHOPIFY_TEST_FORBIDDEN_CARD_IMAGE_PATTERN/.test(spec) || !/size\[-_ \]\?guide/.test(spec) || !/expect\(src\)\.not\.toMatch/.test(spec)) {
  failures.push("card E2E must reject size-guide/swatch/detail image URLs in visible cards");
}

if (!/assertResolvedTryOnImagery/.test(spec) || !/data-stylique-tryon-garment-image/.test(spec) || !/record\.kind === "resolved"/.test(spec)) {
  failures.push("try-on E2E must assert the fitting-room garment image source and exact resolved-image fixture when provided");
}

if (!/cart\\\/add\\\.js|cart\/add\\\.js|cart\/add\.js/.test(spec) || !/fetch\(["']\/cart\.js["']\)/.test(spec)) {
  failures.push("live storefront E2E must prove real Shopify cart mutation and cart readback");
}

if (!/mobile-iphone-14/.test(config) || !/desktop-chromium/.test(config)) {
  failures.push("Playwright config must cover desktop and mobile projects");
}

if (failures.length > 0) {
  console.error("Storefront E2E contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("storefront E2E contract verifier passed");
