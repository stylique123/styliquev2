#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const billing = readFileSync(resolve(root, "apps/shopify-app/app/lib/billing.server.ts"), "utf8");
const dashboard = readFileSync(resolve(root, "apps/shopify-app/app/lib/dashboard.server.ts"), "utf8");
const dashboardRoute = readFileSync(resolve(root, "apps/shopify-app/app/routes/app.dashboard.tsx"), "utf8");
const embeddedDashboardUsageComponent = readFileSync(resolve(root, "apps/shopify-app/app/components/dashboard-plan-usage.tsx"), "utf8");
const embeddedDashboardUsageTest = readFileSync(resolve(root, "apps/shopify-app/app/components/dashboard-plan-usage.test.tsx"), "utf8");
const externalDashboardRoute = readFileSync(resolve(root, "apps/web/app/dashboard/page.tsx"), "utf8");
const externalDashboardSpec = readFileSync(resolve(root, "apps/web/scripts/dashboard-usage.spec.mjs"), "utf8");
const externalDashboardPlaywrightConfig = readFileSync(resolve(root, "apps/web/playwright.dashboard.config.mjs"), "utf8");
const usageApi = readFileSync(resolve(root, "apps/shopify-app/app/routes/api.usage.tsx"), "utf8");
const tryonSettings = readFileSync(resolve(root, "apps/shopify-app/app/routes/app.settings.tryon.tsx"), "utf8");

const failures = [];
const enforcedMetrics = [
  "TRYON_PERSONAL",
  "TRYON_BODY",
  "STYLE_RECOMMENDATION",
  "FIT_RECOMMENDATION",
  "VISION_TURN",
  "STYLIST_TURN",
];

for (const metric of enforcedMetrics) {
  for (const [label, source] of [
    ["billing status", billing],
    ["merchant dashboard usage", dashboard],
    ["internal usage API totals", usageApi],
  ]) {
    if (!new RegExp(`["']?${metric}["']?\\s*[:\\],]`).test(source)) {
      failures.push(`${label} must expose enforced usage metric ${metric}`);
    }
  }
}

if (!/DashboardPlanUsageCard/.test(dashboardRoute) || !/Plan usage/.test(embeddedDashboardUsageComponent) || !/EMBEDDED_USAGE_METERS/.test(embeddedDashboardUsageComponent)) {
  failures.push("embedded merchant dashboard must visibly render plan usage meters, not only return usage JSON");
}

for (const metric of enforcedMetrics) {
  if (!new RegExp(`"${metric}"`).test(embeddedDashboardUsageComponent)) {
    failures.push(`embedded merchant dashboard visible usage panel must include ${metric}`);
  }
}

if (!/Current billing period/.test(embeddedDashboardUsageComponent) || !/Unlimited meters still show usage/.test(embeddedDashboardUsageComponent)) {
  failures.push("embedded merchant dashboard usage panel must explain current-period and unlimited-meter semantics");
}

for (const required of [
  "renderToStaticMarkup",
  "AppProvider",
  "Plan usage",
  "Current billing period",
  "Unlimited meters still show usage",
  "EMBEDDED_USAGE_METERS",
  "44 / Unlimited",
  "critical",
  "attention",
]) {
  if (!embeddedDashboardUsageTest.includes(required)) {
    failures.push(`embedded dashboard usage render test must assert ${required}`);
  }
}

if (!/Plan usage/.test(externalDashboardRoute) || !/USAGE_METERS/.test(externalDashboardRoute)) {
  failures.push("external brand dashboard must visibly render plan usage meters, not only type the usage JSON");
}

for (const metric of enforcedMetrics) {
  if (!new RegExp(`"${metric}"`).test(externalDashboardRoute)) {
    failures.push(`external brand dashboard visible usage panel must include ${metric}`);
  }
}

if (!/Current billing period/.test(externalDashboardRoute) || !/Unlimited meters still show activity/.test(externalDashboardRoute)) {
  failures.push("external brand dashboard usage panel must explain current-period and unlimited-meter semantics");
}

if (!externalDashboardPlaywrightConfig.includes("dashboard-usage") || !/webServer/.test(externalDashboardPlaywrightConfig)) {
  failures.push("external dashboard usage UI must have a dedicated Playwright browser fixture with a local webServer");
}

for (const required of [
  "sq_dashboard_token",
  "sq_dashboard_shop",
  "**/api/external-overview",
  "Plan usage",
  "Current billing period.",
  "Unlimited meters still show activity",
  "Personal try-ons",
  "Body-model try-ons",
  "Style recommendations",
  "Fit recommendations",
  "Mira vision turns",
  "Mira chat turns",
  "44 / Unlimited",
  "Limit reached",
]) {
  if (!externalDashboardSpec.includes(required)) {
    failures.push(`external dashboard browser fixture must assert ${required}`);
  }
}

if (!/VISION_TURN:\s*cap\(f\.stylist\.monthlyVisionTurns\)/.test(dashboard)) {
  failures.push("merchant dashboard usage must cap VISION_TURN from stylist.monthlyVisionTurns");
}

if (!/STYLIST_TURN:\s*cap\(f\.stylist\.monthlyTurns\)/.test(dashboard)) {
  failures.push("merchant dashboard usage must cap STYLIST_TURN from stylist.monthlyTurns");
}

if (!/periodStart:\s*currentPeriodStart\(\)/.test(tryonSettings)) {
  failures.push("try-on settings personal-photo quota must read the current billing period, not the latest counter row");
}

if (/orderBy:\s*\{\s*periodStart:\s*"desc"\s*\}/.test(tryonSettings)) {
  failures.push("try-on settings must not label latest historical usage as this month");
}

if (failures.length > 0) {
  console.error("Billing/usage contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("billing usage contract verifier passed");
