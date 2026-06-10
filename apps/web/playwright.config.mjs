// Playwright config for storefront E2E.
//
// Gated on SHOPIFY_TEST_STORE_URL — if not set, the test runner exits 0 with
// a "skipped" marker so CI doesn't fail on missing infra. To run locally:
//   SHOPIFY_TEST_STORE_URL=https://stylique-fashion-dev.myshopify.com \
//     pnpm --filter @stylique/web e2e
//
// Requires Playwright browsers downloaded once:
//   pnpm --filter @stylique/web exec playwright install chromium
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts",
  testMatch: /storefront-e2e\.spec\.mjs$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "playwright-report.json" }]],
  use: {
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-iphone-14", use: { ...devices["iPhone 14"] } },
  ],
});
