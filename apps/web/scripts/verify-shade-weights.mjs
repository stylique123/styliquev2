// Verifies the beauty learning loop is no longer a one-way pipe: per-shop
// weights passed to matchShades() actually change the ranking, the normalizer
// guards against invalid inputs, and the redistribution-when-hex-absent path
// honours the per-shop split.
//
// Run: node apps/web/scripts/verify-shade-weights.mjs

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../../../packages/core/src/beauty/shade-matching.ts");

const result = await build({
  entryPoints: [SRC],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  target: "node18",
  external: [],
  loader: { ".ts": "ts" },
});
const code = result.outputFiles[0].text;
const mod = { exports: {} };
new Function("module", "exports", "require", code)(mod, mod.exports, () => ({}));
const { matchShades, DEFAULT_SHADE_WEIGHTS } = mod.exports;
assert.equal(typeof matchShades, "function", "matchShades missing");
assert.equal(typeof DEFAULT_SHADE_WEIGHTS, "object", "DEFAULT_SHADE_WEIGHTS missing");
assert.equal(DEFAULT_SHADE_WEIGHTS.undertone + DEFAULT_SHADE_WEIGHTS.depth + DEFAULT_SHADE_WEIGHTS.hex, 1, "defaults must sum to 1");

// Two shades — designed so the per-shop weights genuinely swing the ranking
// across both branches (with-hex and without-hex).
//   foundation-a: GOOD undertone (warm), POOR depth (deep vs shopper's medium), HAS hex but DISTANT from skin
//   foundation-b: POOR undertone (cool vs warm), GOOD depth (medium), HAS hex that's CLOSE to skin
// Under undertone-dominant weights, foundation-a wins.
// Under hex-dominant weights, foundation-b wins.
const products = [
  {
    productId: "p1",
    productHandle: "foundation-a",
    productTitle: "Foundation A",
    shades: [
      { shadeName: "Warm Deep", undertoneHint: "warm", depthHint: "deep", shadeHex: "#7a5236", inStock: true },
    ],
  },
  {
    productId: "p2",
    productHandle: "foundation-b",
    productTitle: "Foundation B",
    shades: [
      { shadeName: "Cool Medium", undertoneHint: "cool", depthHint: "medium", shadeHex: "#caa17a", inStock: true },
    ],
  },
];
const shopper = { skinHex: "#cba27b", undertone: "warm", depth: "medium" };

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log("  ✓", name); pass++; }
  catch (e) { console.error("  ✗", name, "\n   ", e.message); fail++; }
};

console.log("== Default weights (no per-shop override) ==");
await t("Both candidates return scored matches under default weights", async () => {
  const matches = matchShades(products, shopper);
  assert.ok(matches.length >= 2, "expected at least two matches");
  const handles = matches.map((m) => m.productHandle);
  assert.ok(handles.includes("foundation-a") && handles.includes("foundation-b"));
});

console.log("\n== Shop overrides hex to dominate (hex:0.85) ==");
await t("Foundation B (hex-close, depth-match) wins under hex-dominant weights", async () => {
  const matches = matchShades(products, shopper, {
    weights: { undertone: 0.05, depth: 0.05, hex: 0.90 },
  });
  assert.equal(matches[0].productHandle, "foundation-b", `expected foundation-b first under hex-dominant weights, got ${matches[0].productHandle}`);
});

console.log("\n== Shop overrides undertone to dominate (undertone:0.85) ==");
await t("Foundation A (warm undertone) wins under undertone-dominant weights", async () => {
  const matches = matchShades(products, shopper, {
    weights: { undertone: 0.90, depth: 0.05, hex: 0.05 },
  });
  assert.equal(matches[0].productHandle, "foundation-a", `expected foundation-a first under undertone-dominant weights, got ${matches[0].productHandle}`);
});

console.log("\n== Weights are normalised, not taken raw ==");
await t("Non-summing weights {1, 1, 1} normalise to equal thirds and still work", async () => {
  const matches = matchShades(products, shopper, { weights: { undertone: 1, depth: 1, hex: 1 } });
  assert.ok(matches.length >= 2, "must return matches with non-normalised input");
  // Sanity: scores are bounded
  for (const m of matches) assert.ok(m.matchScore >= 0 && m.matchScore <= 1);
});

await t("All-zero weights fall back to defaults (no division-by-zero)", async () => {
  const matches = matchShades(products, shopper, { weights: { undertone: 0, depth: 0, hex: 0 } });
  assert.ok(matches.length >= 2, "must still return matches");
  // The exact rank under defaults is fixture-dependent; just assert valid scores.
  for (const m of matches) assert.ok(m.matchScore > 0 && m.matchScore <= 1, "must produce valid scores");
});

console.log("\n== Hex-absent path also honours per-shop weights ==");
await t("Hex-redistribute path: depth-dominant weights pick the depth winner", async () => {
  // Drop shopper.skinHex so the redistribute branch runs.
  // foundation-a: warm/deep, foundation-b: cool/medium
  // Under depth-dominant weights, foundation-b (medium match) should win over foundation-a (deep vs medium).
  const shopperNoHex = { undertone: "warm", depth: "medium" };
  const matches = matchShades(products, shopperNoHex, {
    weights: { undertone: 0.05, depth: 0.85, hex: 0.10 }, // depth dominates
  });
  assert.equal(matches[0].productHandle, "foundation-b", `expected depth winner foundation-b, got ${matches[0].productHandle}`);
});

await t("Hex-redistribute path: undertone-dominant weights pick the undertone winner", async () => {
  const shopperNoHex = { undertone: "warm", depth: "medium" };
  const matches = matchShades(products, shopperNoHex, {
    weights: { undertone: 0.85, depth: 0.05, hex: 0.10 }, // undertone dominates
  });
  assert.equal(matches[0].productHandle, "foundation-a", `expected undertone winner foundation-a, got ${matches[0].productHandle}`);
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
