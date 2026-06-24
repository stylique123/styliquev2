#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const service = readFileSync(resolve(root, "apps/shopify-app/app/lib/embeddings.server.ts"), "utf8");
const route = readFileSync(resolve(root, "apps/shopify-app/app/routes/api.admin.embeddings.backfill.tsx"), "utf8");
const dashboard = readFileSync(resolve(root, "apps/shopify-app/app/routes/app._index.tsx"), "utf8");

const failures = [];

if (!/providerConfigured:\s*boolean/.test(service) || !/failed:\s*number/.test(service) || !/total:\s*number/.test(service)) {
  failures.push("embedAllForShop must return providerConfigured, failed, and total fields");
}

if (!/providerConfigured:\s*false/.test(service)) {
  failures.push("embedAllForShop must expose missing provider instead of returning a silent zero-success result");
}

if (!/failed\+\+/.test(service)) {
  failures.push("embedAllForShop must count per-product embed failures");
}

if (!/embedding_provider_not_configured/.test(route) || !/status:\s*503/.test(route)) {
  failures.push("embeddings backfill route must return 503 when the provider is not configured");
}

if (!/embedding_backfill_partial_failure/.test(route) || !/status:\s*207/.test(route)) {
  failures.push("embeddings backfill route must return partial failure when product embeddings fail");
}

if (!/failed:\s*number; total:\s*number; providerConfigured:\s*boolean/.test(dashboard)) {
  failures.push("dashboard embeddings trigger must type the honest backfill result shape");
}

if (!/Could not refresh search index/.test(dashboard) || !/embedding_provider_not_configured/.test(dashboard)) {
  failures.push("dashboard embeddings card must surface missing-provider and partial-failure states");
}

if (!/failed \{trigger\.data\.data\?\.failed/.test(dashboard)) {
  failures.push("dashboard embeddings card must show failed count after a run");
}

if (failures.length > 0) {
  console.error("Embeddings backfill contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("embeddings backfill contract verifier passed");
