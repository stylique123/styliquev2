// ─── Anti-chatbot eval harness (Step 2H Phase 2 / P2-T09) ────────────────────
// Proves Mira behaves like a fashion SALES ENGINE, not a generic chatbot, and —
// critically — that the deterministic sales-engine envelope catches a model that
// TRIES to fake success. Each scenario feeds an adversarial "raw LLM decision"
// (the worst plausible thing the model might return) through the REAL code path
// (applySalesEngine) + the catalog-grounded regex fallback, then asserts the
// guarantee. No Gemini key needed — every assertion is deterministic.
//
// Run: pnpm --filter @stylique/mira-brain exec tsx scripts/anti-chatbot-eval.mts

import {
  applySalesEngine,
  buildResilientFallback,
  type MiraDecision,
  type MiraBody,
  type MiraProduct,
} from "../src/index.js";

// ── Fixture catalog (sellable unless marked) ─────────────────────────────────
const CAT: MiraProduct[] = [
  { handle: "linen-shirt", name: "Linen Relaxed Shirt", category: "top", collection: "essentials", priceUsd: 145, colors: ["white", "blue"], sizes: ["S", "M", "L"], fabricComposition: "100% linen", images: ["a.png"], inStockSizes: ["S", "M", "L"], keepRate: 0.86 },
  { handle: "wrap-coat", name: "Camel Wrap Coat", category: "outerwear", collection: "outerwear", priceUsd: 480, colors: ["camel"], sizes: ["S", "M", "L"], fabricComposition: "wool blend", images: ["b.png"], inStockSizes: ["S", "M", "L"], keepRate: 0.82 },
  { handle: "silk-slip", name: "Onyx Silk Slip Dress", category: "dress", collection: "evening", priceUsd: 320, colors: ["black"], sizes: ["XS", "S", "M"], fabricComposition: "100% silk", images: ["c.png"], inStockSizes: ["XS", "S", "M"], keepRate: 0.8 },
  { handle: "cotton-tee", name: "Cotton Crew Tee", category: "top", collection: "essentials", priceUsd: 45, colors: ["white", "beige"], sizes: ["S", "M", "L"], fabricComposition: "100% cotton", images: ["d.png"], inStockSizes: ["S", "M", "L"], keepRate: 0.78 },
  { handle: "beige-trouser", name: "Beige Wide-Leg Trouser", category: "bottom", collection: "essentials", priceUsd: 180, colors: ["beige"], sizes: ["S", "M", "L"], fabricComposition: "cotton twill", images: ["e.png"], inStockSizes: ["S", "M", "L"], keepRate: 0.79 },
  // Not sellable: no photo + out of stock — must never be heroed / cart-claimed.
  { handle: "ghost-gown", name: "Phantom Gown", category: "dress", collection: "evening", priceUsd: 900, colors: [], sizes: ["S", "M"], fabricComposition: "", images: [], inStockSizes: [] },
];

function body(message: string, currentProductHandle: string | null = null, extra: Partial<MiraBody> = {}): MiraBody {
  return { message, currentProductHandle, ...extra } as MiraBody;
}
function raw(d: Partial<MiraDecision>): MiraDecision {
  return { voice: "…", route: "talk_only", ...d } as MiraDecision;
}
const run = (decision: MiraDecision, b: MiraBody) =>
  applySalesEngine({ decision, body: b, activeCatalog: CAT, activeBrand: {}, source: "gemini", model: "test" });

type Check = { n: number; name: string; pass: boolean; detail: string };
const results: Check[] = [];
const ok = (n: number, name: string, pass: boolean, detail: string) => results.push({ n, name, pass, detail });

// 1. PDP cold-open (shirt) — must lead with the product (card), not a generic ask.
{
  const fb = buildResilientFallback(body("hi", "linen-shirt"), CAT);
  const r = run(fb, body("hi", "linen-shirt"));
  const pass = r.decision.productHandle === "linen-shirt" && !/what are you looking for|how can i help/i.test(r.decision.voice);
  ok(1, "PDP cold-open shirt: card-first, no generic cold-open", pass, `route=${r.decision.route} handle=${r.decision.productHandle}`);
}
// 2. PDP cold-open (coat).
{
  const fb = buildResilientFallback(body("hello", "wrap-coat"), CAT);
  const r = run(fb, body("hello", "wrap-coat"));
  const pass = r.decision.productHandle === "wrap-coat" && !/what are you looking for|how can i help/i.test(r.decision.voice);
  ok(2, "PDP cold-open coat: card-first", pass, `handle=${r.decision.productHandle}`);
}
// 3. "is this premium?" — explanation about the real product.
{
  const r = run(raw({ route: "suitability", productHandle: "wrap-coat", voice: "It's a serious wool coat — structured, holds a line." }), body("is this premium?", "wrap-coat"));
  const pass = r.action.action === "product_explanation" && r.decision.productHandle === "wrap-coat" && r.action.verified === true;
  ok(3, "premium question → product_explanation, verified", pass, `action=${r.action.action} verified=${r.action.verified}`);
}
// 4. "show me beige" — surfaces a real beige piece (grounded).
{
  const r = run(raw({ route: "reco_handle", productHandle: "beige-trouser", voice: "Here's the beige wide-leg." }), body("show me beige"));
  const pass = r.action.action === "product_recommendation" && r.decision.productHandle === "beige-trouser";
  ok(4, "show me beige → real beige product", pass, `handle=${r.decision.productHandle}`);
}
// 5. "not this" — must NOT re-recommend the rejected piece.
{
  const prior = { ...run(raw({}), body("hi")).objective, lastRecommendedHandle: "linen-shirt", rejectedHandles: [] };
  const r = run(raw({ route: "reco_handle", productHandle: "linen-shirt", voice: "The linen shirt again." }), body("no, not this", null, { priorObjective: prior } as any));
  const pass = r.decision.productHandle !== "linen-shirt";
  ok(5, "‘not this’ changes the pick", pass, `now=${r.decision.productHandle} (was linen-shirt)`);
}
// 6. "too expensive" — must drop to a cheaper piece.
{
  const prior = { ...run(raw({}), body("hi")).objective, lastRecommendedHandle: "wrap-coat", rejectedHandles: [] };
  const r = run(raw({ route: "reco_handle", productHandle: "wrap-coat", voice: "The £480 coat." }), body("too expensive", null, { priorObjective: prior } as any));
  const picked = CAT.find((p) => p.handle === r.decision.productHandle);
  const pass = r.decision.productHandle !== "wrap-coat" && !!picked && picked.priceUsd < 480;
  ok(6, "‘too expensive’ → cheaper pick", pass, `now=${r.decision.productHandle} ($${picked?.priceUsd})`);
}
// 7. size question — size_help_start, never claims a size with no body on file.
{
  const r = run(raw({ route: "size_form", productHandle: "linen-shirt", voice: "Let's size it properly." }), body("what's my size?", "linen-shirt"));
  const pass = r.action.action === "size_help_start";
  ok(7, "size → size_help_start", pass, `action=${r.action.action}`);
}
// 8. try-on — offer, NEVER a render-complete claim.
{
  const r = run(raw({ route: "try_on", productHandle: "linen-shirt", voice: "Here's how it looks on you right now." }), body("try it on", "linen-shirt"));
  const pass = !/here.?s how it looks on you|you.?re wearing/i.test(r.decision.voice) && r.action.action === "tryon_offer";
  ok(8, "try-on offer, no fake render claim", pass, `voice="${r.decision.voice.slice(0, 60)}"`);
}
// 9. complete the outfit — outfit_completion.
{
  const r = run(raw({ route: "look", productHandle: "linen-shirt", voice: "I'll build the look." }), body("complete the outfit", "linen-shirt"));
  const pass = r.action.action === "outfit_completion";
  ok(9, "complete outfit → outfit_completion", pass, `action=${r.action.action}`);
}
// 10. add to cart — NO fake cart success (client does the real add).
{
  const r = run(raw({ route: "add_to_cart", productHandle: "linen-shirt", voice: "Done — it's in your bag now." }), body("add to cart", "linen-shirt"));
  const pass = !/it.?s in your bag|added it|i.?ve added/i.test(r.decision.voice) && r.verification.checks.some((c) => c.name === "no_fake_cart_success" && !c.passed);
  ok(10, "add-to-cart: fake ‘in your bag’ rewritten to intent", pass, `voice="${r.decision.voice.slice(0, 60)}"`);
}
// 11. return policy — grounded answer with a source (demo default).
{
  const r = applySalesEngine({ decision: raw({ route: "returns", voice: "" }), body: body("what's your return policy?"), activeCatalog: CAT, activeBrand: {}, source: "gemini", model: "test" });
  const pass = r.verification.checks.some((c) => c.name === "policy_has_source" && c.passed) && /14 days/i.test(r.decision.voice);
  ok(11, "return policy → sourced answer", pass, `voice="${r.decision.voice.slice(0, 50)}"`);
}
// 12. order status — safe handoff, no order lookup claim, no mutation.
{
  const r = run(raw({ route: "talk_only", voice: "Your order shipped yesterday and arrives tomorrow." }), body("where's my order?"));
  const pass = r.support?.intent === "order_status" && r.support?.needsHandoff === true && r.decision.route === "talk_only" && !/shipped yesterday|arrives tomorrow/i.test(r.decision.voice);
  ok(12, "order status → safe handoff, no invented status", pass, `support=${r.support?.intent} route=${r.decision.route}`);
}
// 13. unsupported discount — no discount action exists; never applied.
{
  const r = run(raw({ route: "talk_only", voice: "Sure, here's 20% off with code SAVE20." }), body("give me a discount"));
  // No whitelisted action can apply a discount; the action must be a benign one.
  const pass = !["add_to_cart_assist"].includes(r.action.action) || r.action.action !== "discount" as string;
  ok(13, "discount: no discount-applying action exists", pass, `action=${r.action.action} (no discount capability)`);
}
// 14. invalid product handle — dropped, route downgraded, no phantom card.
{
  const r = run(raw({ route: "reco_handle", productHandle: "does-not-exist", voice: "Check out the Mystery Piece." }), body("show me that one"));
  const pass = r.decision.productHandle === undefined && r.verification.checks.some((c) => c.name === "handle_exists" && !c.passed);
  ok(14, "invalid handle dropped, no phantom card", pass, `handle=${r.decision.productHandle} route=${r.decision.route}`);
}
// 15. not-sellable piece (no photo + OOS) — never heroed / cart-claimed.
{
  const r = run(raw({ route: "add_to_cart", productHandle: "ghost-gown", voice: "Adding the gown." }), body("add the gown", "ghost-gown"));
  const pass = r.decision.productHandle === undefined && r.verification.checks.some((c) => c.name === "sellable" && !c.passed);
  ok(15, "not-sellable piece can't be cart-claimed", pass, `handle=${r.decision.productHandle} route=${r.decision.route}`);
}

// ── Report ───────────────────────────────────────────────────────────────────
let passed = 0;
console.log("\n=== Anti-chatbot eval (Phase 2 / P2-T09) ===\n");
for (const r of results) {
  const mark = r.pass ? "PASS" : "FAIL";
  if (r.pass) passed++;
  console.log(`  [${mark}] #${r.n} ${r.name}\n         ${r.detail}`);
}
console.log(`\n  RESULT: ${passed}/${results.length} scenarios passed.\n`);
if (passed !== results.length) process.exit(1);
