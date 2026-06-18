// ─── Conversation-contract regression harness (Step 2H final) ────────────────
// Deterministic, no Gemini — feeds the worst-plausible post-LLM decision through
// the REAL enforceConversationContract + support classifier and asserts the
// founder's route-by-route contract holds (the 10 known transcript failures).
//
// Run: pnpm --filter @stylique/mira-brain exec tsx scripts/contract-regression.mts

import {
  enforceConversationContract,
  classifySupportIntent,
  supportNeedsHandoff,
  type MiraDecision,
  type MiraProduct,
} from "../src/index.js";

const CAT: MiraProduct[] = [
  { handle: "trouser", name: "Atelier Wide-Leg Trouser", category: "bottom", collection: "tailoring", priceUsd: 540, colors: ["charcoal"], sizes: ["S", "M", "L"], fabricComposition: "wool blend", images: ["a.png"], inStockSizes: ["S", "M", "L"], keepRate: 0.8 },
  { handle: "denim", name: "Wide-Leg Heritage Denim", category: "bottom", collection: "essentials", priceUsd: 260, colors: ["indigo"], sizes: ["24", "26", "28"], fabricComposition: "denim", images: ["b.png"], inStockSizes: ["24", "26", "28"], keepRate: 0.78 },
  { handle: "knit", name: "Cashmere V-Neck", category: "knitwear", collection: "knitwear", priceUsd: 380, colors: ["grey"], sizes: ["S", "M", "L"], fabricComposition: "cashmere", images: ["c.png"], inStockSizes: ["S", "M", "L"], keepRate: 0.82 },
  { handle: "gown", name: "Onyx Silk Slip", category: "dress", collection: "evening", priceUsd: 320, colors: ["black"], sizes: ["XS", "S", "M"], fabricComposition: "silk", images: ["d.png"], inStockSizes: ["XS", "S", "M"], keepRate: 0.81 },
];
const cur = (h: string) => CAT.find((p) => p.handle === h) ?? null;

// A minimal raw decision the LLM might return for a given turn.
function raw(route: MiraDecision["route"], intent: string, voice = "…", handle?: string, chips?: string[]): MiraDecision {
  return { route, intent: intent as MiraDecision["intent"], voice, productHandle: handle, quickReplies: chips };
}
function ctx(message: string, handle: string | null) {
  const si = classifySupportIntent(message);
  return {
    message, catalog: CAT, currentProduct: handle ? cur(handle) : null,
    supportNeedsHandoff: !!si && supportNeedsHandoff(si),
    isPolicyReturns: si === "return_policy" || si === "exchange_policy",
    isPolicyShipping: si === "shipping_policy",
  };
}

let pass = 0, fail = 0;
const has = (a: string[] | undefined, s: string) => (a ?? []).some((c) => c.toLowerCase() === s.toLowerCase());
const check = (label: string, ok: boolean, got: unknown) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} | ${label}${ok ? "" : `  — got ${JSON.stringify(got)}`}`);
  ok ? pass++ : fail++;
};

console.log("\nConversation-contract regression — Step 2H\n");

// 1. similar → product cards (reco_category), not a "why?".
{ const d = enforceConversationContract(raw("talk_only", "discover", "Why similar?"), ctx("Show me something similar", "trouser"));
  check("1 similar → cards", d.route === "reco_category" && has(d.quickReplies, "Compare options"), { route: d.route, chips: d.quickReplies }); }
// 1b. "not this / show me another" → cards.
{ const d = enforceConversationContract(raw("suitability", "suitability", "?"), ctx("I don't like this, show me another", "trouser"));
  check("1b not-this → cards", d.route === "reco_category", { route: d.route }); }
// 2. ambiguous help → shopping/support split with a support chip.
{ const d = enforceConversationContract(raw("talk_only", "greeting", "styling pitch"), ctx("I need help", "trouser"));
  check("2 help → split + support chip", has(d.quickReplies, "Talk to support") && has(d.quickReplies, "Shopping help"), d.quickReplies); }
// 3. order issue → handoff (support chips, no styling).
{ const d = enforceConversationContract(raw("talk_only", "support", "It's a beautiful trouser, build a look?"), ctx("I have an order issue", "trouser"));
  check("3 order issue → handoff chips", has(d.quickReplies, "Connect me") && has(d.quickReplies, "Keep shopping") && !has(d.quickReplies, "Build a look"), d.quickReplies); }
// 4. return policy → support chips, no styling.
{ const d = enforceConversationContract(raw("returns", "support", "14-day window. Size this trouser?"), ctx("What's your return policy?", "trouser"));
  check("4 returns → support chips", has(d.quickReplies, "Start a return") && has(d.quickReplies, "Talk to support") && !has(d.quickReplies, "Build a look"), d.quickReplies); }
// 5. delivery → support chips, no product praise.
{ const d = enforceConversationContract(raw("talk_only", "support", "The trouser is beautiful. We ship worldwide in 2-4 business days."), ctx("Is delivery available?", "trouser"));
  check("5 delivery → support chips + no praise", has(d.quickReplies, "Track an order") && !/beautiful/i.test(d.voice), { chips: d.quickReplies, voice: d.voice }); }
// 6. add → no styling-only chips lost; cart chips canonical (no fake handled at client).
{ const d = enforceConversationContract(raw("add_to_cart", "specific", "Adding now."), ctx("Add it", "trouser"));
  check("6 add → cart chips", has(d.quickReplies, "View bag"), d.quickReplies); }
// 7. fabric → no trailing question, canonical chips.
{ const d = enforceConversationContract(raw("fabric", "fabric", "It's a wool blend. What are you after?"), ctx("The fabric", "trouser"));
  check("7 fabric → no trailing question + Find my size", !/\?\s*$/.test(d.voice) && has(d.quickReplies, "Find my size"), { voice: d.voice, chips: d.quickReplies }); }
// 8. sizing → exactly one canonical size chip.
{ const d = enforceConversationContract(raw("size_form", "size", "…", "trouser", ["Will it fit me?", "Size it for me", "Is it my size?"]), ctx("Will it fit me?", "trouser"));
  const sizeChips = (d.quickReplies ?? []).filter((c) => /size|fit/i.test(c));
  check("8 sizing → one canonical size chip", sizeChips.length === 1 && has(d.quickReplies, "Find my size"), d.quickReplies); }
// 9. occasion (office) → actionable chips, not only a question.
{ const d = enforceConversationContract(raw("talk_only", "occasion", "Sharp or relaxed?"), ctx("I need it for office", "trouser"));
  check("9 office → actionable chips", has(d.quickReplies, "Build a look"), d.quickReplies); }
// 10. black tie on a casual piece → reject + formal alternative card.
{ const d = enforceConversationContract(raw("talk_only", "occasion", "What do you want to pair?"), ctx("is this ok for a black tie gala?", "knit"));
  check("10 black-tie + knit → reject + formal alt", d.route === "reco_handle" && d.productHandle === "gown" && /too casual/i.test(d.voice), { route: d.route, handle: d.productHandle, voice: d.voice }); }

console.log(`\nRESULT: ${pass}/${pass + fail} passed${fail ? " — REGRESSION" : ""}.\n`);
process.exit(fail ? 1 : 0);
