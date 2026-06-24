#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(resolve(root, "apps/shopify-app/app/routes/app._index.tsx"), "utf8");
const catalog = readFileSync(resolve(root, "apps/shopify-app/app/routes/app.catalog.tsx"), "utf8");
const workerCatalogSync = readFileSync(resolve(root, "apps/worker/src/jobs/catalog-sync.ts"), "utf8");
const workerEmbeddings = readFileSync(resolve(root, "apps/worker/src/embeddings.ts"), "utf8");

const failures = [];

for (const [name, source] of [
  ["app._index.tsx", home],
  ["app.catalog.tsx", catalog],
]) {
  if (!/try\s*\{[\s\S]{0,240}enqueueCatalogSync\(\{ kind: "full", shopId: shop\.id \}\)/.test(source)) {
    failures.push(`${name} must catch catalog-sync enqueue failures inside the action`);
  }

  if (!/if \(!job\.id\)[\s\S]{0,140}catalog_sync_job_id_missing/.test(source)) {
    failures.push(`${name} must fail closed when BullMQ does not return a job id`);
  }

  if (/job\.id \?\? "queued"/.test(source)) {
    failures.push(`${name} must not replace a missing job id with the string "queued"`);
  }

  if (!/catch \(err\)[\s\S]{0,220}catalog_sync_enqueue_failed/.test(source)) {
    failures.push(`${name} must return a visible enqueue failure payload`);
  }
}

if (!/Catalog sync queued/.test(home) || !/Could not queue sync/.test(home)) {
  failures.push("home dashboard must render both catalog sync success and failure banners");
}

if (!/Queued job \{actionData\.jobId\}/.test(catalog) || !/<Banner tone="critical">\{actionData\.error\}<\/Banner>/.test(catalog)) {
  failures.push("catalog page must render both catalog sync success and failure banners");
}

if (!/type EnqueueSummary/.test(workerCatalogSync) || !/function emptyEnqueueSummary/.test(workerCatalogSync)) {
  failures.push("catalog-sync worker must summarize downstream enqueue accepted/failed/total counts");
}

if (!/const imageQuality = emptyEnqueueSummary\(1\)/.test(workerCatalogSync) || !/imageQuality\.failed = 1/.test(workerCatalogSync)) {
  failures.push("full catalog sync must report image-quality enqueue failure instead of swallowing it");
}

if (!/const sizeCharts = emptyEnqueueSummary\(activeProducts\.length\)/.test(workerCatalogSync) || !/sizeCharts\.failed\+\+/.test(workerCatalogSync)) {
  failures.push("full catalog sync must report per-product size-chart enqueue failures");
}

if (!/sizeChartsQueued:\s*sizeCharts\.queued/.test(workerCatalogSync) || !/sizeChartsFailed:\s*sizeCharts\.failed/.test(workerCatalogSync)) {
  failures.push("catalog sync notification/log payload must include real size-chart queued and failed counts");
}

if (/sizeChartsQueued:\s*activeProducts\.length/.test(workerCatalogSync)) {
  failures.push("catalog sync must not claim every active product was queued for size-chart extraction");
}

if (!/providerConfigured:\s*boolean/.test(workerEmbeddings) || !/failed:\s*number/.test(workerEmbeddings) || !/total:\s*number/.test(workerEmbeddings)) {
  failures.push("worker-side embeddings backfill must use the same honest result shape as the app backfill");
}

if (!/providerConfigured:\s*false/.test(workerEmbeddings) || !/failed\+\+/.test(workerEmbeddings)) {
  failures.push("worker-side embeddings must report missing provider and per-product failures");
}

if (failures.length > 0) {
  console.error("Catalog sync repair contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("catalog sync repair contract verifier passed");
