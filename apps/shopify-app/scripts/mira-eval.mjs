#!/usr/bin/env node
// Mira combo/occasion eval harness (panel rec #16).
//
// Fires a fixed battery of product/occasion prompts at the live demo brain and
// asserts the qualities the expert panel flagged: no blank turns, readable money,
// occasion variety (different occasions → different products), season-correct
// anchors, deterministic route overrides (try-on/size/cart), and an escape chip.
// Also reports the formed-look rate (brain proposing its own combo). Designed to
// be a CI gate: exits non-zero if the hard assertions fail.
//
// Usage: node apps/shopify-app/scripts/mira-eval.mjs [endpointUrl]
import process from "node:process";

const APP = process.argv[2] || "https://stylique-app-production.up.railway.app/api/demo/mira";
const SLEEP_MS = 4000; // space requests to avoid self-inflicted 429
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(message, currentProductHandle) {
  const body = { message, history: [] };
  if (currentProductHandle) body.currentProductHandle = currentProductHandle;
  const t0 = Date.now();
  try {
    const res = await fetch(APP, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(70000) });
    const json = await res.json();
    return { json, ms: Date.now() - t0 };
  } catch (e) {
    return { json: null, ms: Date.now() - t0, err: String(e) };
  }
}

const PROMPTS = [
  { id: "wedding",  msg: "I need an elegant outfit for an autumn wedding", group: "occasion" },
  { id: "office",   msg: "something polished for the office", group: "occasion" },
  { id: "brunch",   msg: "relaxed look for weekend brunch", group: "occasion" },
  { id: "dinner",   msg: "what should I wear to a nice dinner", group: "occasion" },
  { id: "summer",   msg: "something light for a summer beach holiday", group: "season-summer" },
  { id: "winter",   msg: "warm cozy outfit for deep winter", group: "season-winter" },
  { id: "tryon",    msg: "can I see this on me?", handle: "silk-slip-dress", group: "route-tryon" },
  { id: "size",     msg: "what size am I, I'm usually a medium", handle: "wide-leg-trousers", group: "route-size" },
  { id: "cart",     msg: "ok add it to my cart", handle: "cashmere-v-neck", group: "route-cart" },
  { id: "greeting", msg: "hi", group: "greeting" },
];

function priceLooksFormatted(voice) {
  // any 4+ digit run NOT comma-separated is a fail (e.g. "(14500)")
  const bare = voice.match(/(?<![\d,])\d{4,}(?![\d,])/g);
  return !bare || bare.length === 0;
}

const results = [];
for (const p of PROMPTS) {
  const { json, ms, err } = await call(p.msg, p.handle);
  if (err || !json) { results.push({ ...p, ok: false, note: `request failed: ${err || "no json"}`, ms }); await sleep(SLEEP_MS); continue; }
  const dec = json.decision || {};
  const voice = (dec.voice || "").replace(/\s+/g, " ").trim();
  const products = json.products || [];
  const look = json.look || null;
  const names = products.map((x) => x.name);
  const pieces = (look?.pieces || []).map((x) => ({ name: x.name, handle: x.handle, category: x.category }));
  results.push({ ...p, ms, voice, route: dec.route, productHandle: dec.productHandle ?? null, chips: dec.quickReplies || [], look: look?.title || null, names, pieces, n: products.length });
  await sleep(SLEEP_MS);
}

// ── Assertions ──
const byId = Object.fromEntries(results.map((r) => [r.id, r]));
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

// 1. No blank product turns (occasion/season must return products or be greeting)
const productTurns = results.filter((r) => ["occasion", "season-summer", "season-winter"].includes(r.group));
check("no-blank-product-turns", productTurns.every((r) => r.n > 0 || /don'?t (carry|have)/i.test(r.voice || "")),
  productTurns.filter((r) => r.n === 0).map((r) => r.id).join(",") || "all have products");

// 2. Money readable (no bare 4+ digit integers in any voice)
const moneyBad = results.filter((r) => r.voice && !priceLooksFormatted(r.voice));
check("money-formatted", moneyBad.length === 0, moneyBad.map((r) => `${r.id}:"${r.voice.slice(0,40)}"`).join(" | ") || "ok");

// 3. Occasion variety — wedding vs office vs brunch should not be identical sets
const sets = ["wedding", "office", "brunch"].map((id) => (byId[id]?.names || []).join("|"));
const uniqueSets = new Set(sets.filter(Boolean));
check("occasion-variety", uniqueSets.size >= 2, `distinct product sets across wedding/office/brunch: ${uniqueSets.size}/3`);

// 4. Season correctness — summer anchor not wool/cashmere
const summer = byId["summer"];
const summerAnchorOk = !summer?.names?.[0] || !/(wool|cashmere)/i.test(summer.names[0]);
check("summer-anchor-not-wool", summerAnchorOk, `summer anchor: ${summer?.names?.[0] || "none"}`);

// 5. Route overrides
check("route-tryon", byId["tryon"]?.route === "try_on", `got ${byId["tryon"]?.route}`);
check("route-size", byId["size"]?.route === "size_form", `got ${byId["size"]?.route}`);
check("route-cart", byId["cart"]?.route === "add_to_cart", `got ${byId["cart"]?.route}`);

// 6. Greeting stays product-free + conversational
check("greeting-no-products", (byId["greeting"]?.n ?? 0) === 0, `greeting products: ${byId["greeting"]?.n}`);

// 7. Escape chip present on product turns
check("escape-chip", productTurns.every((r) => (r.chips || []).some((c) => /another|something else|keep looking|browsing/i.test(c))),
  "every product turn offers an escape chip");

// ── Assertions added after the expert re-review found these RED (panel P0/P1) ──
const slotOf = (s) => {
  s = (s || "").toLowerCase();
  if (/(dress|gown|slip|jumpsuit)/.test(s)) return "dress";
  if (/(coat|blazer|jacket|trench|cardigan|overcoat|parka)/.test(s)) return "outerwear";
  if (/(trouser|pant|jean|skirt|short|legging|culotte)/.test(s)) return "bottom";
  if (/(shoe|heel|boot|sneaker|flat|loafer|sandal|pump)/.test(s)) return "footwear";
  if (/(bag|belt|scarf|jewel|necklace|earring|hat|clutch|tote|accessor|sunglass|glove)/.test(s)) return "accessory";
  return "top";
};

// 8. (panel P0 #1) On a PDP, the product action must target the ON-SCREEN product.
check("pdp-handle-on-tryon", byId["tryon"]?.productHandle === "silk-slip-dress",
  `try-on on silk-slip PDP → productHandle=${byId["tryon"]?.productHandle} (must be silk-slip-dress)`);

// 9. (panel #8) The action handle is the look anchor (single-sourced).
const lookTurns = results.filter((r) => r.pieces && r.pieces.length >= 2 && !r.handle);
check("handle-is-look-anchor", lookTurns.every((r) => !r.productHandle || r.productHandle === r.pieces[0].handle),
  lookTurns.filter((r) => r.productHandle && r.productHandle !== r.pieces[0]?.handle).map((r) => r.id).join(",") || "anchor matches");

// 10. (panel P1 #4) No two look pieces share a slot (no shirt+slip-dress, no two bottoms).
const slotBad = results.filter((r) => {
  const slots = (r.pieces || []).map((p) => slotOf(`${p.name} ${p.category || ""}`));
  return new Set(slots).size !== slots.length;
});
check("look-slot-coherent", slotBad.length === 0,
  slotBad.map((r) => `${r.id}:[${r.pieces.map((p) => p.name).join("+")}]`).join(" | ") || "all looks slot-coherent");

// 11. (panel P1 #4) Summer LOOK has no wool/cashmere piece.
const sp = byId["summer"]?.pieces || [];
check("summer-look-no-wool", sp.every((p) => !/(wool|cashmere)/i.test(`${p.name} ${p.category || ""}`)),
  `summer look pieces: ${sp.map((p) => p.name).join(", ") || "none"}`);

// ── Report ──
console.log("\n=== Mira eval ===");
for (const r of results) {
  console.log(`[${r.id}] route=${r.route} look=${r.look} n=${r.n} ${r.ms}ms`);
  if (r.voice) console.log(`   "${r.voice.slice(0, 120)}"`);
  if (r.names?.length) console.log(`   ${r.names.slice(0, 4).join(", ")}`);
}
const formedLook = results.filter((r) => r.look).length;
console.log(`\nFORMED-LOOK rate (brain or styled-net look.title): ${formedLook}/${results.length}`);
console.log("\n=== Assertions ===");
let failed = 0;
for (const c of checks) { console.log(`${c.pass ? "✅" : "❌"} ${c.name} — ${c.detail}`); if (!c.pass) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed > 0 ? 1 : 0);
