// ─── Runtime UX regression harness (Step 2H Task D) ──────────────────────────
// Deterministic, local, no Gemini/browser — guards the EXACT UX guarantees the
// Product Runtime UX sprint shipped, so none of them can silently regress.
// Logic cases run the real catalog engine; wiring cases assert the source of
// `MiraWidget.tsx` carries the guarantee (the live browser E2E lives in
// scripts/storefront-e2e.spec.mjs and needs a tunnelled Shopify store).
//
//   pnpm --filter @stylique/web exec tsx scripts/runtime-ux-regression.mts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { products, buildLook } from "../app/lib/catalog.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "../app/components/mira/MiraWidget.tsx"), "utf8");

let pass = 0;
let fail = 0;
const log = (ok: boolean, label: string, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"} | ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
const has = (...needles: string[]) => needles.every((n) => SRC.includes(n));

console.log("\nRuntime UX regression — Step 2H\n");

// 1. Build the look → outfit card visible (look kind rendered as LookCard).
log(has('msg.kind === "look"', "<LookCard"), "1. build-look renders an outfit card");

// 2. Look-card product click → navigates to the correct PDP (via executor).
log(has("onView", 'executeAction("navigate_to_product"'), "2. look-card piece click navigates through the executor");

// 3. Product switch → Mira notices + offers compare/style (slot-aware).
log(has("function switchLine", "pairs with the", "same slot"), "3. product-switch notice (complement vs compare)");

// 4. Size chart opened → proactive size prompt (once per product).
log(has("Checking sizes?", "mira_sizenudge_"), "4. size-chart-open proactive prompt, once per product");

// 5. See them on me → fitting room opens (TryOnPanel on tryOnProduct truthy).
log(has("{tryOnProduct && (", "<TryOnPanel"), "5. try-on opens the fitting room panel");

// 6. Open fitting room then abandon → try-on-abandon nudge, once per product.
log(has("TASK C — abandon nudge", "mira_abandon_", "different size or colour"), "6. try-on-abandon nudge, once per product, no fake render");

// 7. Size wording honest/session-scoped (no permanent 'saved' claim).
const honest = has("I'll keep it for this session", "I'll keep that while you're browsing");
const noFakeSave = !SRC.includes("I've got it saved");
log(honest && noFakeSave, "7. size wording is session-honest (no fake permanent save)", honest ? (noFakeSave ? "" : "stale 'saved' copy still present") : "session copy missing");

// 8. Only the latest chip row is visible.
log(has("lastChipIdx", "i === lastChipIdx"), "8. quick-reply chips render on the latest turn only");

// 9. No duplicate chips (dedup + cap in the chip pipeline).
log(/lastChipIdx/.test(SRC) && (SRC.includes("slice(0, 3)") || SRC.includes("dedup") || SRC.includes("Array.from(new Set")), "9. chip dedup/cap present");

// 10. Add-to-bag never claims success unless the real cart result is ok.
log(has("r.real && !r.ok", "executeAction(\"add_to_bag\""), "10. add-to-bag goes through the executor; success only on the real cart result");

// Logic — the complement engine actually pairs a real piece (buildLook works).
const trouser = products.find((p) => p.category === "bottom");
if (trouser) {
  const ranked = buildLook(trouser, products);
  const topUpper = ranked.find((e) => ["top", "knitwear"].includes(e.product.category));
  log(!!topUpper && (topUpper.score ?? 0) > 0.5, "11. buildLook pairs a coherent upper with a bottom", topUpper ? `${topUpper.product.name} @ ${(topUpper.score ?? 0).toFixed(2)}` : "no upper found");
} else {
  log(false, "11. buildLook pairs a coherent upper with a bottom", "no bottom in catalog");
}

console.log(`\nRESULT: ${pass}/${pass + fail} passed${fail ? " — REGRESSION DETECTED" : ""}.\n`);
process.exit(fail ? 1 : 0);
