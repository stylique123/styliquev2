#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const service = readFileSync(resolve(root, "apps/shopify-app/app/services/scriptTag.server.ts"), "utf8");
const worker = readFileSync(resolve(root, "apps/worker/src/jobs/inject-widget.ts"), "utf8");
const scopes = readFileSync(resolve(root, "apps/shopify-app/app/lib/shopify-scopes.server.ts"), "utf8");
const envServer = readFileSync(resolve(root, "apps/shopify-app/app/env.server.ts"), "utf8");
const internalDashboard = readFileSync(resolve(root, "apps/shopify-app/app/lib/internal-dashboard.server.ts"), "utf8");
const internalDetail = readFileSync(resolve(root, "apps/shopify-app/app/routes/internal.$shopId.tsx"), "utf8");
const internalTests = readFileSync(resolve(root, "apps/shopify-app/app/lib/internal-dashboard.server.test.ts"), "utf8");
const toml = readFileSync(resolve(root, "apps/shopify-app/shopify.app.toml"), "utf8");
const scopeFiles = [
  ".env.example",
  ".env.local.example",
  ".env.production.example",
  ".env.staging.example",
  "apps/shopify-app/.env.example",
  "RAILWAY_DEPLOY.md",
  "docs/STAGING_DEPLOY.md",
  "docs/LOCAL_SHOPIFY_DEV.md",
];

const failures = [];

if (!/write_script_tags/.test(scopes) || !/write_script_tags/.test(toml)) {
  failures.push("required Shopify scopes and app TOML must include write_script_tags");
}

if (!/REQUIRED_SHOPIFY_SCOPES_STRING/.test(envServer)) {
  failures.push("runtime env defaults and boot banner must consume REQUIRED_SHOPIFY_SCOPES_STRING instead of duplicating scope literals");
}

const expectedScopeString = "read_products,read_inventory,read_orders,write_script_tags";
for (const file of scopeFiles) {
  const contents = readFileSync(resolve(root, file), "utf8");
  if (!contents.includes(expectedScopeString)) {
    failures.push(`${file} must document the canonical Shopify scope string`);
  }
  for (const retired of ["write_products", "read_product_listings", "write_metafields"]) {
    if (contents.includes(retired)) {
      failures.push(`${file} must not document retired/unneeded Shopify scope ${retired}`);
    }
  }
}

if (!/extraGrantedShopifyScopes/.test(scopes)) {
  failures.push("Shopify scope helper must detect stale extra token scopes for least-privilege re-consent");
}

if (!/fetchLiveShopifyScopeCheck/.test(scopes) || !/currentAppInstallation/.test(scopes) || !/accessScopes/.test(scopes)) {
  failures.push("Shopify scope helper must query Shopify currentAppInstallation.accessScopes for live token truth");
}

if (!/fetchLiveShopifyScopeCheck/.test(internalDashboard) || !/decryptField\(shop\.accessToken\)/.test(internalDashboard)) {
  failures.push("internal brand detail must attempt live Shopify scope checks with the decrypted shop token");
}

if (!/Live Shopify scope check/.test(internalDetail) || !/Live token missing/.test(internalDetail) || !/Live token extra/.test(internalDetail)) {
  failures.push("internal brand detail UI must surface live Shopify scope check status, missing scopes, and extra scopes");
}

if (!/fetchLiveShopifyScopeCheck/.test(internalTests) || !/write_products/.test(internalTests) || !/manual-provisioning-pending/.test(internalTests)) {
  failures.push("internal scope tests must cover live Shopify scope drift and pending-install skip behavior");
}

if (!/throw new Error\(\s*`script_tag_create_failed/.test(service)) {
  failures.push("initial install ScriptTag creation must throw on Shopify userErrors");
}

if (!/script_tag_create_failed/.test(worker) || !/throw new Error\(`script_tag_create_failed/.test(worker)) {
  failures.push("daily injection worker must throw on Shopify userErrors");
}

if (!/\$\{appUrl\}\/widget\.js/.test(service) || !/const WIDGET_SRC = `\$\{APP_URL\}\/widget\.js`/.test(worker)) {
  failures.push("install and self-heal paths must target the same /widget.js ScriptTag source");
}

if (/\/public\/widget\.js/.test(service.match(/const scripts = \[[\s\S]*?\];/)?.[0] ?? "")) {
  failures.push("initial install must not create retired /public/widget.js ScriptTags");
}

if (failures.length > 0) {
  console.error("Shopify injection contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("Shopify injection contract verifier passed");
