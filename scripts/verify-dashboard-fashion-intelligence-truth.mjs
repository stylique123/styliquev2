#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = "apps/shopify-app/app/routes/app.dashboard.tsx";
const source = readFileSync(resolve(root, file), "utf8");
const intelligence = readFileSync(resolve(root, "apps/shopify-app/app/lib/fashion-intelligence.server.ts"), "utf8");

const failures = [];

if (/Shopper-taught/.test(source)) {
  failures.push("dashboard must not label blended Fashion Intelligence as purely shopper-taught");
}

if (!/Shopper \+ catalog/.test(source)) {
  failures.push("live Fashion Intelligence consumer evidence badge must disclose shopper + catalog blend");
}

if (!/shopper \+ catalog mix/.test(source)) {
  failures.push("style shares must disclose blended shopper/catalog weighting");
}

if (!/combo\.count\s*>\s*0\s*\?\s*`\$\{combo\.count\} asks`\s*:\s*"catalog pairing"/.test(source)) {
  failures.push("combo rows must not present catalog fallback pairings as live shopper asks");
}

if (!/catalog pairings are directional until shoppers ask for that look/.test(source)) {
  failures.push("dashboard source note must explain catalog fallback pairings");
}

if (/label="try-on purchase rate"/.test(source) || /label="baseline purchase rate"/.test(source) || /label="try-on lift"/.test(source)) {
  failures.push("dashboard conversion labels must not call cart/order proxy metrics purchase rate or lift");
}

if (!/label="try-on cart rate"/.test(source) || !/label="baseline order proxy"/.test(source) || !/label="try-on assist ratio"/.test(source)) {
  failures.push("dashboard conversion labels must describe cart/order proxy evidence honestly");
}

if (!/not a causal holdout lift/.test(source) || !/cart\/order attribution proxies, not controlled causal lift/.test(source)) {
  failures.push("dashboard conversion notes must disclaim causal lift");
}

if (/label:\s*"Try-on lift"/.test(intelligence) || /try → buy/.test(intelligence) || /label:\s*"Return risk"/.test(intelligence)) {
  failures.push("Fashion Intelligence exec cards must not overclaim try-on lift, try-to-buy, or return risk");
}

if (!/label:\s*"Try-on cart assist"/.test(intelligence) || !/interest → cart/.test(intelligence) || !/label:\s*"Fit confidence risk"/.test(intelligence)) {
  failures.push("Fashion Intelligence exec cards must use cart/fit-confidence evidence wording");
}

if (!/Not a controlled causal lift/.test(intelligence) || !/not a returns-rate claim/.test(intelligence)) {
  failures.push("Fashion Intelligence source details must disclose proxy metrics");
}

if (failures.length > 0) {
  console.error("Dashboard Fashion Intelligence truth drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("dashboard Fashion Intelligence truth verifier passed");
