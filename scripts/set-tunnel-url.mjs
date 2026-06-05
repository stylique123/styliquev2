#!/usr/bin/env node
// Rewrite every URL in local Shopify TOMLs to use the given tunnel host.
// Touches: application_url, [auth].redirect_urls[*], [app_proxy].url.
//
// Usage:
//   node scripts/set-tunnel-url.mjs https://abc-123.trycloudflare.com
//   pnpm shopify:link-tunnel https://abc-123.trycloudflare.com

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOML_PATHS = [
  resolve(__dirname, "..", "apps", "shopify-app", "shopify.app.toml"),
  resolve(__dirname, "..", "apps", "shopify-app", "shopify.app.local.toml"),
];

const arg = process.argv[2];
if (!arg) {
  console.error("usage: set-tunnel-url.mjs <https://your-tunnel-host>");
  process.exit(2);
}

let url;
try {
  url = new URL(arg);
} catch {
  console.error(`Invalid URL: ${arg}`);
  process.exit(2);
}
if (url.protocol !== "https:") {
  console.error("Tunnel URL must be https://…");
  process.exit(2);
}

const newOrigin = `${url.protocol}//${url.host}`;
// Replace ANY https://<host>/path inside the toml that looks like an app URL
// (i.e. has one of these path roots). Leaves placeholder hosts in comments alone.
const PATH_ROOTS = ["", "/auth/callback", "/auth/shopify/callback", "/api/auth/callback", "/proxy/shopper"];
const ANY_HOST = /https:\/\/[^"\s]+/g;

let changed = 0;
for (const tomlPath of TOML_PATHS) {
  const src = readFileSync(tomlPath, "utf8");
  const next = src.replace(ANY_HOST, (match) => {
    // Skip URLs that aren't ours (docs, schemas).
    if (match.includes("shopify.dev") || match.includes("shopify.com") || match.includes("trycloudflare.com/docs")) {
      return match;
    }
    // Preserve the path; swap only the origin.
    try {
      const u = new URL(match);
      if (!PATH_ROOTS.some((root) => u.pathname === root || u.pathname.startsWith(root))) return match;
      return `${newOrigin}${u.pathname === "/" ? "" : u.pathname}`;
    } catch {
      return match;
    }
  });
  if (next !== src) {
    writeFileSync(tomlPath, next);
    changed++;
  }
}

if (changed === 0) {
  console.warn("No URLs changed — nothing matched the expected patterns.");
  process.exit(1);
}

console.log(`✓ Rewrote ${changed} local Shopify config file(s) to use ${newOrigin}`);
console.log("  Next: pnpm check:shopify-config");
