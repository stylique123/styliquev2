#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const service = readFileSync(resolve(root, "packages/core/src/style/service.ts"), "utf8");
const tests = readFileSync(resolve(root, "packages/core/src/__tests__/fit-style.test.ts"), "utf8");
const adapter = readFileSync(resolve(root, "apps/shopify-app/app/lib/mira-adapter.server.ts"), "utf8");
const adapterTests = readFileSync(resolve(root, "apps/shopify-app/app/lib/mira-adapter.server.test.ts"), "utf8");
const fashionIntel = readFileSync(resolve(root, "apps/shopify-app/app/lib/fashion-intelligence.server.ts"), "utf8");

const failures = [];

if (!/export function canonicalStyleCategory/.test(service)) {
  failures.push("style service must normalize merchant category/product-type aliases before pairing");
}

if (!/export function inferStyleProductSlot/.test(service)) {
  failures.push("core style service must export the shared product slot classifier");
}

for (const alias of ["pants", "blouse", "heels", "bag", "saree", "khussa", "maang tikka"]) {
  if (!service.toLowerCase().includes(alias)) {
    failures.push(`style category normalizer must cover ${alias}`);
  }
}

if (!/canonicalStyleCategory\(p\)/.test(service) || !/wanted\.includes\(category\)/.test(service)) {
  failures.push("outfit slot selection must use canonical categories, not raw exact category strings");
}

if (!/category:\s*canonicalStyleCategory\(item\.product\)/.test(service)) {
  failures.push("combo scoring must receive canonical categories from buildOutfit");
}

if (!/normalizes merchant product-type aliases/.test(tests) || !/Pants/.test(tests) || !/Heels/.test(tests) || !/Bags/.test(tests)) {
  failures.push("fit-style tests must cover raw merchant category aliases");
}

if (!/inferStyleProductSlot/.test(tests) || !/Khussa/.test(tests) || !/Maang Tikka/.test(tests)) {
  failures.push("core tests must cover the exported shared slot classifier and regional/accessory aliases");
}

if (!/import \{[^}]*inferStyleProductSlot/.test(adapter)) {
  failures.push("Shopify Mira adapter must use the shared core product slot classifier");
}

if (!/function slotOf\(p: AdaptedProduct\)[\s\S]{0,180}inferStyleProductSlot/.test(adapter)) {
  failures.push("Shopify Mira adapter slotOf must delegate to inferStyleProductSlot");
}

if (/function slotOf\(p: AdaptedProduct\)[\s\S]{0,700}return "top";/.test(adapter)) {
  failures.push("Shopify Mira adapter must not default unknown products to top");
}

if (!/merchant product-type aliases/.test(adapterTests) || !/Blouses/.test(adapterTests) || !/Pants/.test(adapterTests) || !/Heels/.test(adapterTests)) {
  failures.push("Mira adapter tests must prove styled looks work with raw merchant product-type aliases");
}

if (!/import \{[^}]*inferStyleProductSlot/.test(fashionIntel)) {
  failures.push("Fashion Intelligence must use the shared core product slot classifier");
}

if (!/function productSlot\([^)]*\)[\s\S]{0,180}inferStyleProductSlot/.test(fashionIntel)) {
  failures.push("Fashion Intelligence productSlot must delegate to inferStyleProductSlot");
}

if (failures.length > 0) {
  console.error("Style category alias contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("style category alias verifier passed");
