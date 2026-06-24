#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = "apps/shopify-app/app/lib/shopper.server.ts";
const source = readFileSync(resolve(root, file), "utf8");

const failures = [];

if (!/variants:\s*\{\s*select:\s*\{[^}]*size:\s*true,\s*measurementsJson:\s*true/s.test(source)) {
  failures.push("postFit product query must select ProductVariant.measurementsJson");
}

if (!/parseVariantSkuMeasurements\(product\.variants\)\s*\?\?\s*parseSkuMeasurements\(product\.sizeChartJson\)/.test(source)) {
  failures.push("postFit must prefer variant measurementsJson before Product.sizeChartJson");
}

if (!/\(product\.sizeChartJson\s*\|\|\s*skuMeasurements\)/.test(source)) {
  failures.push("zone-fit calculation must run when variant measurements exist even without Product.sizeChartJson");
}

if (failures.length > 0) {
  console.error("Fit measurement bridge drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("fit measurement bridge verifier passed");
