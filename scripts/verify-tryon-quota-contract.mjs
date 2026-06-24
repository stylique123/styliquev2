#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "apps/shopify-app/app/lib/shopper.server.ts"), "utf8");

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

if (failures.length > 0) {
  console.error("Try-on quota contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("try-on quota contract verifier passed");
