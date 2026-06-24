#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const toml = readFileSync(resolve(root, "apps/shopify-app/shopify.app.toml"), "utf8");
const shopifyServer = readFileSync(resolve(root, "apps/shopify-app/app/shopify.server.ts"), "utf8");
const envServer = readFileSync(resolve(root, "apps/shopify-app/app/env.server.ts"), "utf8");
const startupValidation = readFileSync(resolve(root, "apps/shopify-app/app/lib/startup-validation.server.ts"), "utf8");
const scopeHelper = readFileSync(resolve(root, "apps/shopify-app/app/lib/shopify-scopes.server.ts"), "utf8");
const scriptTagService = readFileSync(resolve(root, "apps/shopify-app/app/services/scriptTag.server.ts"), "utf8");
const injectionWorker = readFileSync(resolve(root, "apps/worker/src/jobs/inject-widget.ts"), "utf8");
const catalogClient = readFileSync(resolve(root, "apps/worker/src/shopifyClient.ts"), "utf8");

const failures = [];
const expectedScopes = ["read_products", "read_inventory", "read_orders", "write_script_tags"];
const expectedScopeString = expectedScopes.join(",");
const retiredScopes = ["write_products", "read_product_listings", "write_metafields", "read_themes", "write_themes"];

function expectIncludes(label, source, needle) {
  if (!source.includes(needle)) failures.push(`${label} must include ${needle}`);
}

const scopeMatch = /^scopes\s*=\s*"([^"]+)"/m.exec(toml);
const tomlScopes = scopeMatch?.[1] ?? "";
if (tomlScopes !== expectedScopeString) {
  failures.push(`shopify.app.toml scopes must be exactly ${expectedScopeString}; got ${tomlScopes || "(missing)"}`);
}

for (const scope of expectedScopes) {
  expectIncludes("shopify scope helper", scopeHelper, `"${scope}"`);
  expectIncludes("startup validation", startupValidation, scope);
}

for (const scope of retiredScopes) {
  if (tomlScopes.split(",").map((s) => s.trim()).includes(scope)) {
    failures.push(`shopify.app.toml must not request retired/unneeded scope ${scope}`);
  }
}

if (!/SHOPIFY_SCOPES:\s*z\.string\(\)\.default\(REQUIRED_SHOPIFY_SCOPES_STRING\)/.test(envServer)) {
  failures.push("env.server must default SHOPIFY_SCOPES from REQUIRED_SHOPIFY_SCOPES_STRING");
}

if (!/scopes:\s*env\.SHOPIFY_SCOPES\.split\(",\"\)/.test(shopifyServer)) {
  failures.push("Shopify OAuth setup must use env.SHOPIFY_SCOPES, not a duplicated literal scope list");
}

if (!/scopes:\s*session\.scope \?\? env\.SHOPIFY_SCOPES/.test(shopifyServer)) {
  failures.push("install persistence must store the granted session.scope for live scope diagnosis");
}

if (!/missingRequiredShopifyScopes\(process\.env\.SHOPIFY_SCOPES\)/.test(startupValidation)) {
  failures.push("startup validation must fail fast when required Shopify scopes are missing");
}

for (const [label, source] of [
  ["scriptTag install service", scriptTagService],
  ["daily injection worker", injectionWorker],
]) {
  expectIncludes(label, source, "scriptTagCreate");
  expectIncludes(label, source, "scriptTagDelete");
}

for (const needle of ["products(first: 50", "variants(first: 100)", "inventoryQuantity", "availableForSale", "images(first: 10)", "metafields(first: 20)"]) {
  expectIncludes("worker catalog client", catalogClient, needle);
}

for (const mutation of ["productCreate", "productUpdate", "productDelete", "themeCreate", "themeUpdate", "assetCreate", "assetUpdate"]) {
  if (new RegExp(`\\b${mutation}\\b`).test(catalogClient + "\n" + shopifyServer + "\n" + scriptTagService + "\n" + injectionWorker)) {
    failures.push(`active Shopify runtime must not call ${mutation} without an explicit scope review`);
  }
}

for (const [topic, uri] of [
  ['topics = ["products/create", "products/update", "products/delete"]', 'uri = "/webhooks/products"'],
  ['topics = ["app/uninstalled"]', 'uri = "/webhooks/app-uninstalled"'],
  ['topics = ["orders/create"]', 'uri = "/webhooks/orders"'],
  ['topics = ["orders/fulfilled"]', 'uri = "/webhooks/orders/fulfilled"'],
  ['topics = ["refunds/create"]', 'uri = "/webhooks/orders/returned"'],
]) {
  expectIncludes("shopify.app.toml webhook subscriptions", toml, topic);
  expectIncludes("shopify.app.toml webhook subscriptions", toml, uri);
}

for (const gdprUrl of [
  "customer_data_request_url",
  "customer_deletion_url",
  "shop_deletion_url",
]) {
  expectIncludes("Shopify GDPR webhook config", toml, gdprUrl);
}

if (!/api_version\s*=\s*"2025-01"/.test(toml) || !/ApiVersion\.January25/.test(shopifyServer) || !/const API_VERSION = "2025-01"/.test(catalogClient)) {
  failures.push("Shopify API versions must stay aligned across TOML, Shopify SDK setup, and worker catalog client");
}

if (!/currentAppInstallation/.test(scopeHelper) || !/accessScopes/.test(scopeHelper)) {
  failures.push("scope helper must support live currentAppInstallation.accessScopes checks");
}

if (failures.length > 0) {
  console.error("Shopify permissions contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("Shopify permissions contract verifier passed");
