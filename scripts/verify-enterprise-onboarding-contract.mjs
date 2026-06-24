#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(resolve(root, "apps/web/app/admin/enterprise/page.tsx"), "utf8");
const route = readFileSync(resolve(root, "apps/web/app/api/admin/enterprise/route.ts"), "utf8");
const internalIndex = readFileSync(resolve(root, "apps/shopify-app/app/routes/internal._index.tsx"), "utf8");
const brandDetail = readFileSync(resolve(root, "apps/shopify-app/app/routes/internal.$shopId.tsx"), "utf8");

const failures = [];

if (/leave blank for unlimited/i.test(page)) {
  failures.push("enterprise onboarding UI must not claim blank limits are unlimited");
}

if (!/blank uses the selected tier default/i.test(page)) {
  failures.push("enterprise onboarding UI must explain blank limit fields use tier defaults");
}

if (!/monthlyTryOnPersonal:\s*body\.monthlyTryOnPersonal\s*\?\?\s*defaults\.monthlyTryOnPersonal/.test(route)) {
  failures.push("enterprise API must keep blank personal try-on limit aligned to tier default");
}

if (!/monthlyStylistTurns:\s*body\.monthlyStylistTurns\s*\?\?\s*features\.stylist\.monthlyTurns/.test(route)) {
  failures.push("enterprise API must keep blank stylist turns aligned to tier default");
}

if (!/billingActive:\s*comp/.test(route) || !/status:\s*comp\s*\?\s*"ops_comp"\s*:\s*"pending"/.test(route)) {
  failures.push("enterprise API must write explicit comp/pending billing contract");
}

if (!/manual-provisioning-pending/.test(route) || !/PENDING_INSTALL/.test(route)) {
  failures.push("enterprise API must support pending pre-install merchants");
}

for (const [label, source] of [["internal index", internalIndex], ["brand detail", brandDetail]]) {
  if (!/PLAN_DEFAULTS/.test(source) || !/PLAN_FEATURES/.test(source)) {
    failures.push(`${label} tier changes must derive quotas/features from shared plan tables`);
  }
  if (!/billingActive:\s*comp/.test(source) || !/ops_comp/.test(source)) {
    failures.push(`${label} tier changes must preserve explicit ops-comp billing contract`);
  }
}

if (failures.length > 0) {
  console.error("Enterprise onboarding contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("enterprise onboarding contract verifier passed");
