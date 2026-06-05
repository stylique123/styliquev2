#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const appDir = resolve(process.cwd(), "apps", "shopify-app");
const files = readdirSync(appDir)
  .filter((name) => /^shopify\.app.*\.toml$/.test(name))
  .sort();

// Collapsed to ONE canonical config. local/staging/production were archived
// (apps/shopify-app/_archive) — deploy URLs become env-driven on the fresh app.
const requiredFiles = [
  "shopify.app.toml",
];

const errors = [];
const warnings = [];

for (const file of requiredFiles) {
  if (!existsSync(resolve(appDir, file))) errors.push(`${file}: missing`);
}

function values(src, key) {
  const out = [];
  const single = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m").exec(src);
  if (single) out.push(single[1]);
  const list = new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m").exec(src);
  if (list) {
    for (const match of list[1].matchAll(/"([^"]+)"/g)) out.push(match[1]);
  }
  return out;
}

for (const file of files) {
  const src = readFileSync(resolve(appDir, file), "utf8");
  const appUrls = values(src, "application_url");
  const redirectUrls = values(src, "redirect_urls");
  const proxyUrls = values(src, "url");
  const allUrls = [...appUrls, ...redirectUrls, ...proxyUrls];

  if (src.includes("https://shopify.dev/apps/default-app-home")) {
    errors.push(`${file}: contains Shopify default app-home URL`);
  }
  if (!src.includes("dev_command")) {
    errors.push(`${file}: missing [build].dev_command`);
  }
  if (!redirectUrls.some((url) => url.endsWith("/auth/callback"))) {
    errors.push(`${file}: redirect_urls must include actual Remix route /auth/callback`);
  }
  if (redirectUrls.some((url) => url.includes("/api/auth"))) {
    errors.push(`${file}: redirect_urls includes non-existent /api/auth callback`);
  }
  if (file.includes("staging") && !appUrls.includes("https://staging.stylique.ai")) {
    errors.push(`${file}: staging application_url must be https://staging.stylique.ai`);
  }
  if (file.includes("production") && !appUrls.includes("https://app.stylique.ai")) {
    errors.push(`${file}: production application_url must be https://app.stylique.ai`);
  }
  if ((file === "shopify.app.toml" || file.includes("local")) && !src.includes("5d64194b12c927c4cbe2507fd4824250")) {
    errors.push(`${file}: local config must use confirmed stylique-fashion client_id`);
  }
  for (const url of allUrls) {
    if (!url.startsWith("https://")) errors.push(`${file}: non-https URL ${url}`);
  }
  if (src.includes("replace_with_")) warnings.push(`${file}: contains deployment placeholder client_id`);
}

const result = { ok: errors.length === 0, files, errors, warnings };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exit(1);
