#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "apps/shopify-app/app/lib/shopper.server.ts"), "utf8");
const worker = readFileSync(resolve(root, "apps/worker/src/jobs/tryon-render.ts"), "utf8");
const workerIndex = readFileSync(resolve(root, "apps/worker/src/index.ts"), "utf8");

const failures = [];

if (!/Combo try-on only supports BODY_MODEL mode/.test(source)) {
  failures.push("TryOnRenderSchema must reject PERSONAL_PHOTO combo try-on instead of silently downgrading mode");
}

if (!/if\s*\(ids\.length\s*>\s*1\)\s*\{[\s\S]{0,500}?canConsume\(\{\s*shopId,\s*metric:\s*"TRYON_BODY"\s*\}\)/.test(source)) {
  failures.push("combo try-on path must preflight TRYON_BODY quota before starting layered renders");
}

if (!/comboGate\.remaining\s*!=\s*null\s*&&\s*comboGate\.remaining\s*<\s*ids\.length/.test(source)) {
  failures.push("combo try-on preflight must require enough remaining body-render quota for every layer");
}

if (!/tryon_render_timeout_90s/.test(workerIndex) || !/Promise\.race/.test(workerIndex)) {
  failures.push("try-on worker timeout behavior must stay visible to the quota idempotency contract");
}

if (!/const\s+finalUpdate\s*=\s*await\s+prisma\.tryOnSession\.updateMany\(\{[\s\S]{0,220}?status:\s*\{\s*not:\s*"SUCCEEDED"\s*\}/.test(worker)) {
  failures.push("try-on worker success write must atomically ignore duplicate/late completions");
}

const duplicateGuardIndex = worker.indexOf("if (finalUpdate.count === 0)");
const usageMetricIndex = worker.indexOf("const usageMetric = mode ===");
const usageCounterIndex = worker.indexOf("prisma.usageCounter.upsert");
if (
  duplicateGuardIndex === -1 ||
  usageMetricIndex === -1 ||
  usageCounterIndex === -1 ||
  !(duplicateGuardIndex < usageMetricIndex && usageMetricIndex < usageCounterIndex)
) {
  failures.push("try-on worker must return before usageCounter upsert when a duplicate completion loses the idempotency race");
}

if (!/prisma\.tryOnSession\.updateMany\(\{[\s\S]{0,180}?status:\s*\{\s*not:\s*"SUCCEEDED"\s*\}[\s\S]{0,260}?status:\s*"FAILED"/.test(worker)) {
  failures.push("try-on worker failure writes must not overwrite a render that already succeeded");
}

if (failures.length > 0) {
  console.error("Try-on quota contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("try-on quota contract verifier passed");
