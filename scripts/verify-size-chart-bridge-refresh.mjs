#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = "apps/worker/src/jobs/size-chart-extract.ts";
const source = readFileSync(resolve(root, file), "utf8");
const backfillRoute = readFileSync(resolve(root, "apps/shopify-app/app/routes/api.admin.size-charts.backfill.tsx"), "utf8");

const failures = [];

if (!/measurementsSource:\s*true/.test(source)) {
  failures.push("size-chart worker must select ProductVariant.measurementsSource");
}

if (!/SIZE_CHART_MEASUREMENT_SOURCES/.test(source) || !/bridgeOwnsMeasurements/.test(source)) {
  failures.push("size-chart worker must distinguish bridge-owned measurements from explicit per-SKU measurements");
}

if (/if\s*\(\s*v\.measurementsJson\s*\)\s*continue/.test(source)) {
  failures.push("size-chart bridge must not skip all existing measurements; bridge-owned rows need refresh");
}

if (!/v\.measurementsJson\s*&&\s*!bridgeOwnsMeasurements\(v\.measurementsSource\)\)\s*continue/.test(source)) {
  failures.push("size-chart bridge must preserve only non-bridge explicit per-SKU measurements");
}

if (!/measurementsJson:\s*Prisma\.JsonNull/.test(source) || !/measurementsSource:\s*null/.test(source)) {
  failures.push("size-chart bridge must clear stale bridge-owned measurements when a chart no longer has that variant row");
}

if (/queue\s*\n?\s*\.add\([\s\S]{0,600}\)\s*\n?\s*\.catch\(\(\)\s*=>\s*undefined\)/.test(backfillRoute)) {
  failures.push("manual size-chart backfill must not swallow per-product queue failures");
}

if (!/failures:\s*Array<\{ productId: string; error: string \}>/.test(backfillRoute)) {
  failures.push("manual size-chart backfill must collect failed product queue attempts");
}

if (!/size_chart_backfill_partial_enqueue_failure/.test(backfillRoute) || !/status:\s*queued > 0 \? 207 : 503/.test(backfillRoute)) {
  failures.push("manual size-chart backfill must report partial/total enqueue failure honestly");
}

if (!/return json\(\{ ok: true, queued, failed: 0, total: products\.length \}\)/.test(backfillRoute)) {
  failures.push("manual size-chart backfill success response must include queued, failed, and total counts");
}

if (failures.length > 0) {
  console.error("Size-chart bridge refresh drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("size-chart bridge refresh verifier passed");
