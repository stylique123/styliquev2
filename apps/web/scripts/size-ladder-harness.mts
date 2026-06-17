// ─── Size-ladder visual harness (Step 2H Phase 3 / P3-T04) ───────────────────
// Runs the SAME garment + muse across every available size and proves two things
// the founder needs to trust the fitting room:
//   1. Each size produces a DISTINCT cache key — sizes can NEVER share a render.
//   2. The path is classified honestly: fit-visual (ease genuinely varies across
//      sizes → the render reflects fit) vs style-preview-only (ease is identical
//      → it's a STYLE preview, not a fit-accurate render) vs failed.
// Deterministic — no Gemini key, no provider call. Run:
//   pnpm --filter @stylique/web exec tsx scripts/size-ladder-harness.mts

import { products, fitBreakdown, renderEaseOf } from "../app/lib/catalog.ts";
import { buildTryOnCacheKey } from "../app/lib/tryon-render.server.ts";
import { classifyRenderHonesty } from "@stylique/core";

// A representative shopper body (the harness is about the size LADDER, not the
// body — we hold the body fixed and vary only the size).
const BODY = { heightCm: 168, weightKg: 62 };
const MUSE = "athletic";

let allDistinct = true;
let anyFailed = false;
const rows: string[] = [];

for (const product of products) {
  const sizes = product.sizes;
  if (!sizes.length) continue;
  const keys = new Map<string, string>();
  const easeBySize: Array<{ size: string; easeCm: number | null }> = [];

  for (const size of sizes) {
    let easeCm: number | null = null;
    try {
      const fit = fitBreakdown(product, size, BODY.heightCm, BODY.weightKg);
      easeCm = renderEaseOf(fit).easeCm;
    } catch {
      easeCm = null;
    }
    const key = buildTryOnCacheKey({
      shopSlug: "harness-shop",
      museId: MUSE,
      handle: product.handle,
      size,
      color: product.colors[0],
      focusImage: `/products/${product.handle}-1.png`,
      lookHandles: [],
      easeCm: easeCm ?? undefined,
    });
    keys.set(size, key);
    easeBySize.push({ size, easeCm });
  }

  // Distinct cache key per size?
  const distinct = new Set(keys.values()).size === keys.size;
  if (!distinct) allDistinct = false;

  const honesty = classifyRenderHonesty(easeBySize);
  if (honesty.honesty === "failed") anyFailed = true;

  const easeStr = easeBySize.map((e) => `${e.size}:${e.easeCm == null ? "—" : (e.easeCm > 0 ? "+" : "") + e.easeCm}`).join(" ");
  rows.push(
    `  ${distinct ? "OK " : "DUP"} | ${honesty.honesty.padEnd(18)} | ${product.handle.padEnd(28)} | ${easeStr}`,
  );
}

console.log("\n=== Size-ladder harness (Phase 3 / P3-T04) ===\n");
console.log("  key-distinct | classification     | product                      | ease(cm) by size");
console.log("  " + "-".repeat(96));
for (const r of rows) console.log(r);
console.log("");
console.log(`  All sizes get a distinct cache key: ${allDistinct ? "YES" : "NO"}`);
console.log(`  Any size ladder failed to compute fit: ${anyFailed ? "YES" : "no"}`);
console.log("");
console.log("  Honest classification per product printed above:");
console.log("    fit-visual          → render reflects fit (ease varies across sizes)");
console.log("    style-preview-only  → label as STYLE preview, NOT fit-accurate");
console.log("    failed              → couldn't compute fit\n");

if (!allDistinct) {
  console.error("FAIL: at least one product reused a cache key across sizes.");
  process.exit(1);
}
console.log("RESULT: PASS — every size has a distinct cache key; classification is honest.\n");
