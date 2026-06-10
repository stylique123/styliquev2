// Verifies the storefront-cart chain: that addToCart() and addOutfitToCart()
// genuinely fire POST /cart/add.js when run on a "storefront-shaped" window.
//
// Proves the reality panel's claim ("real /cart/add.js never fires") is FALSE
// in the current code — and gives us a runnable proof artefact for the audit.
//
// Run: node apps/web/scripts/verify-cart.mjs
//
// We import the TS source via tsx-style on-the-fly compilation; since this
// repo's apps/web has no test runner, we transpile the small file with esbuild
// in-process and execute the result. Zero new deps — esbuild is already in the
// monorepo.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../app/lib/storefront-cart.ts");

// Transpile the TS source to a single CJS string, eval it, grab the exports.
const result = await build({
  entryPoints: [SRC],
  bundle: false,
  write: false,
  format: "cjs",
  platform: "node",
  target: "node18",
  loader: { ".ts": "ts" },
});
const code = result.outputFiles[0].text;
const mod = { exports: {} };
new Function("module", "exports", "require", code)(mod, mod.exports, () => ({}));
const { addToCart, addOutfitToCart } = mod.exports;
assert.equal(typeof addToCart, "function", "addToCart export missing");
assert.equal(typeof addOutfitToCart, "function", "addOutfitToCart export missing");

// ─── Mock window + fetch ───────────────────────────────────────────────────
const fetchCalls = [];
const dispatched = [];

function setupStorefront({ withShopify = true } = {}) {
  fetchCalls.length = 0;
  dispatched.length = 0;
  globalThis.window = {
    Shopify: withShopify ? { shop: "stylee.myshopify.com" } : undefined,
    __sqAssetBase: withShopify ? undefined : "https://cdn.example.com",
    dispatchEvent: (e) => { dispatched.push(e); return true; },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  };
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    // /products/<handle>.js → return a product with two variants
    if (typeof url === "string" && url.startsWith("/products/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          variants: [
            { id: 4001, title: "S", available: true, options: ["S"] },
            { id: 4002, title: "M", available: true, options: ["M"] },
            { id: 4003, title: "L", available: false, options: ["L"] },
          ],
        }),
      };
    }
    // /cart/add.js → success
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

function setupDemo() {
  fetchCalls.length = 0;
  dispatched.length = 0;
  globalThis.window = undefined;
  delete globalThis.fetch;
}

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log("  ✓", name); pass++; }
  catch (e) { console.error("  ✗", name, "\n   ", e.message); fail++; }
};

console.log("== Storefront mode (window.Shopify present) ==");
await t("addToCart fires /cart/add.js with the size-matched variant id", async () => {
  setupStorefront({ withShopify: true });
  const r = await addToCart("linen-relaxed-shirt", "M");
  assert.equal(r.ok, true);
  assert.equal(r.real, true, "must be a real call, not simulated");
  const lookup = fetchCalls.find((c) => c.url.startsWith("/products/"));
  const cart   = fetchCalls.find((c) => c.url === "/cart/add.js");
  assert.ok(lookup, "expected /products/<handle>.js lookup");
  assert.ok(cart, "expected /cart/add.js POST");
  assert.equal(cart.method, "POST");
  assert.deepEqual(cart.body.items, [{ id: 4002, quantity: 1 }], "must POST the M variant id");
});

await t("addToCart returns variant_not_found when size lookup fails", async () => {
  setupStorefront({ withShopify: true });
  globalThis.fetch = async (url) => {
    if (url.startsWith("/products/")) return { ok: false, status: 404 };
    return { ok: true, status: 200 };
  };
  const r = await addToCart("does-not-exist", "M");
  assert.equal(r.ok, false);
  assert.equal(r.error, "variant_not_found");
});

await t("addToCart skips sold-out size variant and falls back to first available", async () => {
  setupStorefront({ withShopify: true });
  const r = await addToCart("linen-relaxed-shirt", "L"); // L is unavailable
  assert.equal(r.ok, true);
  const cart = fetchCalls.find((c) => c.url === "/cart/add.js");
  assert.equal(cart.body.items[0].id, 4001, "expected fallback to first available variant (S id 4001)");
});

await t("addOutfitToCart fires ONE POST with all piece items", async () => {
  setupStorefront({ withShopify: true });
  const r = await addOutfitToCart([
    { handle: "linen-relaxed-shirt", size: "M" },
    { handle: "wide-leg-denim", size: "S" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.real, true);
  const posts = fetchCalls.filter((c) => c.url === "/cart/add.js");
  assert.equal(posts.length, 1, "expected exactly ONE /cart/add.js call for the whole outfit");
  assert.equal(posts[0].body.items.length, 2, "expected two items in the cart payload");
});

await t("addOutfitToCart dispatches stylique:cart-added on success", async () => {
  setupStorefront({ withShopify: true });
  await addOutfitToCart([{ handle: "linen-relaxed-shirt", size: "M" }]);
  const evt = dispatched.find((e) => e.type === "stylique:cart-added");
  assert.ok(evt, "expected stylique:cart-added CustomEvent on the window");
  assert.equal(evt.detail.kind, "outfit");
});

console.log("\n== Storefront mode (only __sqAssetBase set, no Shopify global) ==");
await t("addToCart STILL fires real /cart/add.js with __sqAssetBase alone", async () => {
  setupStorefront({ withShopify: false });
  const r = await addToCart("linen-relaxed-shirt", "M");
  assert.equal(r.real, true, "must detect storefront via __sqAssetBase fallback");
  const cart = fetchCalls.find((c) => c.url === "/cart/add.js");
  assert.ok(cart, "expected /cart/add.js POST even without window.Shopify");
});

console.log("\n== Demo mode (no window) ==");
await t("addToCart NO-OPs with real:false in demo", async () => {
  setupDemo();
  const r = await addToCart("linen-relaxed-shirt", "M");
  assert.equal(r.ok, true);
  assert.equal(r.real, false, "demo must report real:false so the widget can skip rollback");
  assert.equal(fetchCalls.length, 0, "must NOT hit /cart/add.js in demo");
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
