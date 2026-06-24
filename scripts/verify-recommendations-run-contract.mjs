#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const service = readFileSync(resolve(root, "packages/core/src/recommendations/service.ts"), "utf8");
const route = readFileSync(resolve(root, "apps/shopify-app/app/routes/api.admin.recommendations.run.tsx"), "utf8");
const dashboard = readFileSync(resolve(root, "apps/shopify-app/app/routes/app._index.tsx"), "utf8");
const observability = readFileSync(resolve(root, "apps/shopify-app/app/routes/api.admin.observability.tsx"), "utf8");
const worker = readFileSync(resolve(root, "apps/worker/src/jobs/recommendations.ts"), "utf8");
const tests = readFileSync(resolve(root, "packages/core/src/__tests__/recommendations.test.ts"), "utf8");

const failures = [];

if (!/attempted:\s*number/.test(service) || !/failed:\s*number/.test(service)) {
  failures.push("recommendations runAll must report attempted and failed counts, not only written");
}

if (!/generatorFailures:\s*Array<\{ generator: string; error: string \}>/.test(service)) {
  failures.push("recommendations runAll must expose generator failure details");
}

if (!/writeFailures:\s*Array<\{ kind: string; dedupeKey: string; error: string \}>/.test(service)) {
  failures.push("recommendations runAll must expose write failure details");
}

if (!/maintenanceFailures:\s*Array<\{ step: string; error: string \}>/.test(service)) {
  failures.push("recommendations runAll must expose maintenance failure details");
}

if (/\.catch\(\(\) => undefined\)/.test(service)) {
  failures.push("recommendation generation/writes must not silently swallow failures with .catch(() => undefined)");
}

if (!/recommendations_run_partial_failure/.test(route) || !/status:\s*207/.test(route)) {
  failures.push("manual recommendations run route must return partial failure status when any generator/write fails");
}

if (!/recommendations_run_failed/.test(route) || !/status:\s*500/.test(route)) {
  failures.push("manual recommendations run route must return structured JSON for unexpected run failure");
}

if (!/function RecommendationsCard/.test(dashboard) || !/action="\/api\/admin\/recommendations\/run"/.test(dashboard)) {
  failures.push("merchant dashboard must expose a recommendation refresh card wired to the manual run route");
}

if (!/Recommendations refreshed/.test(dashboard) || !/Recommendations partially refreshed/.test(dashboard) || !/Could not refresh recommendations/.test(dashboard)) {
  failures.push("recommendation refresh UI must surface success, partial failure, and failed states");
}

if (!/Last run: wrote \{lastRun\.written\} of \{lastRun\.attempted\}; failures \{lastRun\.failed\}/.test(dashboard)) {
  failures.push("recommendation refresh UI must show written, attempted, and failed counts");
}

if (!/recentFailed/.test(observability) || !/zcount\(`bull:\$\{name\}:failed`, since, "\+inf"\)/.test(observability)) {
  failures.push("admin observability must expose recent queue failures for recommendation jobs and other queues");
}

if (!/result\.failed > 0/.test(worker) || !/recommendations_partial_failure/.test(worker)) {
  failures.push("recommendations worker must fail/retry partial recommendation runs instead of completing with hidden failures");
}

if (!/r\.attempted/.test(tests) || !/r\.writeFailures/.test(tests) || !/r\.generatorFailures/.test(tests)) {
  failures.push("recommendations tests must assert attempted, generatorFailures, and writeFailures");
}

if (failures.length > 0) {
  console.error("Recommendations run contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("recommendations run contract verifier passed");
