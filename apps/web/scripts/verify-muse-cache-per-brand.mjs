// Verifies the muse render cache is partitioned per brand (founder fix):
// two shops with the SAME product handle produce DIFFERENT cache keys so they
// never collide; the same shop + same product + same size produces the SAME key
// so the second render is an instant hit; an unset shop slug falls to the
// sentinel "_" so the demo behaves identically to before.
//
// Run: node apps/web/scripts/verify-muse-cache-per-brand.mjs

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../app/lib/tryon-render.server.ts");

// We only need museCacheKey + shopKey for this test, but they're not exported.
// Trick: tweak the source to expose them via a small test-only export shim.
import { readFileSync } from "node:fs";
const original = readFileSync(SRC, "utf-8");
const shimmed =
  original +
  `
// === TEST SHIM (appended by verify-muse-cache-per-brand.mjs, not in real source) ===
export { museCacheKey as __museCacheKey, shopKey as __shopKey };
`;

const result = await build({
  stdin: { contents: shimmed, loader: "ts", sourcefile: "tryon-render.test.ts", resolveDir: dirname(SRC) },
  bundle: false,
  write: false,
  format: "cjs",
  platform: "node",
  target: "node18",
});
const code = result.outputFiles[0].text;
const mod = { exports: {} };
new Function("module", "exports", "require", code)(mod, mod.exports, (n) => {
  // resolve node built-ins; everything else we don't need to load here
  if (n === "crypto") return require("crypto");
  if (n === "node:fs") return require("fs");
  if (n === "fs") return require("fs");
  if (n === "node:path") return require("path");
  if (n === "path") return require("path");
  if (n === "node:os") return require("os");
  if (n === "os") return require("os");
  return {};
});
const { __museCacheKey, __shopKey } = mod.exports;
assert.equal(typeof __museCacheKey, "function", "museCacheKey shim missing");
assert.equal(typeof __shopKey, "function", "shopKey shim missing");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log("  ✓", name); pass++; }
  catch (e) { console.error("  ✗", name, "\n   ", e.message); fail++; }
};

console.log("== Per-brand partitioning ==");
t("Same handle on TWO different shops → DIFFERENT cache keys", () => {
  const a = __museCacheKey("stylee.myshopify.com", "tall", "midnight-silk-gown", "M", []);
  const b = __museCacheKey("other-brand.myshopify.com", "tall", "midnight-silk-gown", "M", []);
  assert.notEqual(a, b, `expected different keys for two shops; got identical: ${a}`);
});

t("Same shop + same handle + same size → IDENTICAL cache key (instant hit on re-render)", () => {
  const a = __museCacheKey("stylee.myshopify.com", "tall", "midnight-silk-gown", "M", []);
  const b = __museCacheKey("stylee.myshopify.com", "tall", "midnight-silk-gown", "M", []);
  assert.equal(a, b);
});

t("Same shop + same handle + DIFFERENT size → DIFFERENT keys (so XS and XL cache separately)", () => {
  const a = __museCacheKey("stylee.myshopify.com", "tall", "midnight-silk-gown", "XS", []);
  const b = __museCacheKey("stylee.myshopify.com", "tall", "midnight-silk-gown", "XL", []);
  assert.notEqual(a, b);
});

t("Demo (no shopSlug) → uses sentinel '_' partition", () => {
  const k = __museCacheKey(undefined, "tall", "midnight-silk-gown", "M", []);
  assert.ok(k.includes("s-_"), `expected '_' sentinel in key; got ${k}`);
});

console.log("\n== Shop slug sanitisation ==");
t("Domain with dots/colons sanitises to safe slug", () => {
  assert.equal(__shopKey("stylee.myshopify.com"), "stylee-myshopify-com");
});
t("Uppercase domain lowercases", () => {
  assert.equal(__shopKey("STYLEE.example.com"), "stylee-example-com");
});
t("Empty/blank slug → sentinel", () => {
  assert.equal(__shopKey(""), "_");
  assert.equal(__shopKey(undefined), "_");
});
t("Long slug clamps to 40 chars", () => {
  const long = "a".repeat(100);
  assert.ok(__shopKey(long).length <= 40);
});
t("Hostile characters stripped", () => {
  assert.equal(__shopKey("stylee/../etc/passwd"), "stylee-etc-passwd");
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
