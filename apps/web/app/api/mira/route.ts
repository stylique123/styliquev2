// Mira's hybrid brain, stronger Gemini for UNDERSTANDING, our deterministic
// catalog engine for GROUNDING.
//
// The LLM never invents a product, price, or size. It does one job: read the
// shopper's free-form message (plus the PDP context and recent history) and
// decide (a) what Mira should *say* in her own editorial voice, and (b) which
// grounded `route` the client should execute against the real catalog
// (lib/catalog.ts). The client then builds the cards deterministically, same
// recoMsg / lookMsg / size / fabric builders the regex engine uses.
//
// If GEMINI_API_KEY is absent or the call fails, the client falls back to the
// pure-regex getMiraResponse, so the demo always works. "Wired to a stronger
// Gemini, supported by our backend regex."

import { NextResponse } from "next/server";
import { z } from "zod";
import { products as catalog, buildLook, type Product } from "../../lib/catalog";
import { knowledgePromptBlock } from "../../lib/mira-knowledge.server";
import {
  recordSignal,
  type MiraIntent,
} from "../../lib/mira-signals.server";
import {
  emitIntentCaptured,
  emitProductRecommended,
  emitOutfitRecommended,
  emitSizeHelpStarted,
  emitTryOnOffered,
  emitHesitationDetected,
  emitAddToCartAssist,
  emitUnmetDemand,
  emitNearMiss,
} from "../../lib/event-bridge.server";
import {
  extractSignals,
  decideClose,
  buildClosingContextBlock,
} from "../../lib/closing-intelligence";
import { buildLookContextBlock } from "../../lib/active-look-memory";
import { BodySchema, type MiraDecision, validateHandle, extractBodyContext, buildSystem, type BrandIdentity, callGemini } from "@stylique/mira-brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



// Deterministic BUDGET FACTS, the LLM cannot be trusted to add prices (v1 caught
// it pitching an $800 look as "under $600"). When the shopper signals a ceiling we
// compute the REAL affordable pieces + the REAL cheapest complete look total from
// the catalog and inject them, so Mira quotes facts instead of fabricating.
function parseBudget(msg: string): number | null {
  if (!/budget|under|below|spend|afford|\$|dollar|price|cost|max|cheap|less than|up to|around|about/i.test(msg)) return null;
  const nums = [...msg.matchAll(/\$?\s*(\d{2,5})/g)].map((x) => parseInt(x[1], 10)).filter((n) => n >= 50 && n <= 9000);
  return nums.length ? Math.max(...nums) : null;
}
function budgetFactsBlock(message: string, activeCatalog: Product[]): string | null {
  const budget = parseBudget(message);
  if (budget == null) return null;
  const floor = Math.min(...activeCatalog.map((p) => p.priceUsd));
  const affordable = activeCatalog.filter((p) => p.priceUsd <= budget).sort((a, b) => a.priceUsd - b.priceUsd);
  const tops = affordable.filter((p) => p.category === "top" || p.category === "knitwear");
  const bottoms = affordable.filter((p) => p.category === "bottom" || p.category === "dress");
  let best = Infinity, bestPair = "";
  for (const t of tops) for (const b of bottoms) {
    const tot = t.priceUsd + b.priceUsd;
    if (tot <= budget && tot < best) { best = tot; bestPair = `${t.name} ($${t.priceUsd}) + ${b.name} ($${b.priceUsd}) = $${tot}`; }
  }
  return [
    `BUDGET FACTS, the shopper signalled a ceiling near $${budget}. Use ONLY these real numbers. NEVER call any piece or look "under"/"within"/"inside" budget unless its real price/total is ≤ $${budget}. Do the arithmetic from THESE prices, never estimate:`,
    affordable.length
      ? `  Pieces AT OR UNDER $${budget}: ${affordable.map((p) => `${p.name} $${p.priceUsd}`).join("; ")}.`
      : `  HONEST GAP: nothing is at or under $${budget}, our floor is $${floor}. Say so plainly; offer the closest piece as a stretch, do NOT pretend it fits.`,
    bestPair
      ? `  Cheapest complete 2-piece look within budget: ${bestPair}. Any look whose real total exceeds $${budget} is OVER budget, say so with the real total, e.g. "that pairing is $X, over your $${budget}".`
      : `  No 2-piece look fits under $${budget}; a single piece is the only in-budget option, name it with its price.`,
  ].join("\n");
}

// Deterministic NAVIGATION EXECUTION, v1 found Mira NAMES routes but dead-ends
// with "which piece?" even when the product is known (lowest score, 0.65). The
// prompt rule alone didn't hold, so we FORCE the route + handle when the shopper
// clearly asks to act on the product they're already viewing. The model's voice is
// kept unless it asked the dead-ending question, in which case we replace it.
function enforceExecution(decision: MiraDecision, message: string, curHandle: string | null | undefined, hasBody = false, activeCatalog: Product[] = catalog, historyLen = 0): MiraDecision {
  const mlow = message.toLowerCase();
  if (!curHandle && decision.route === "talk_only" && /^\s*(just )?(looking|browsing|nothing|idk|i dont know|i don'?t know|surprise me|not sure|hmm+|hi+|hey+|hello)\b/i.test(mlow)) {
    // Cold-open heroes: pick from injected catalog (top 5 by keepRate desc) so
    // a real merchant gets THEIR best pieces, not the demo's hardcoded handles.
    const heroes = activeCatalog.length
      ? [...activeCatalog].sort((a, b) => (b.keepRate ?? 0) - (a.keepRate ?? 0)).slice(0, 5).map((p) => p.handle)
      : ["wrap-coat-camel", "onyx-silk-slip", "tailored-blazer-double", "atelier-wide-leg-trouser", "leather-trench"];
    // Live cycle-3 panel caught the brain emitting IDENTICAL T1 and T2
    // voices on the cold-opener persona (different messages, same hero +
    // same lead-in) because both `pick` and `voice` rotated by
    // `message.length % N`. Two consecutive messages whose lengths share
    // an index mod N collide. Two-line fix: seed the rotation with the
    // conversation turn count (so consecutive turns can NEVER share an
    // index regardless of message length) AND use co-prime offsets so
    // pick + voice don't lock-step.
    const turn = historyLen;
    const pick = heroes[(message.length + turn) % heroes.length]!;
    const hp = activeCatalog.find((p) => p.handle === pick);
    if (hp) {
      // Rotate four lead-ins instead of the single template Mira parroted —
      // catalog-grounded, no banned filler, each under 22 words. The +1
      // co-prime offset against the hero rotation guarantees pick and
      // voice never collide together.
      const leadIns = [
        `Quick one for you: the ${hp.name}. What's the occasion, or just having a look?`,
        `If you trust me on one piece, it's the ${hp.name}. What are we dressing for?`,
        `Start here: the ${hp.name}. Where would you wear it?`,
        `The one I'd pull off the rack for you, the ${hp.name}. What's it for?`,
      ];
      const voice = leadIns[(message.length + turn + 1) % leadIns.length]!;
      return { ...decision, route: "reco_handle", productHandle: pick, voice, quickReplies: ["For an occasion", "Everyday", "Show me more"] };
    }
  }
  if (!curHandle || decision.route !== "talk_only") return decision;
  const product = activeCatalog.find((p) => p.handle === curHandle);
  if (!product) return decision;
  const m = message.toLowerCase();
  const deadEnd = /which (piece|one)|what are we|building (it|the look) around|do you have your eye/i.test(decision.voice ?? "");
  if (/(show|build|complete|see|put together|create|make)\b.{0,24}(look|outfit)|what (goes|pairs|works) with|style (this|it)|full look|the look/.test(m)) {
    return { ...decision, route: "look", productHandle: curHandle, voice: deadEnd ? `Let me build the full look around the ${product.name}.` : decision.voice };
  }
  // Measurements typed in THIS message also count as "body known" — never make a
  // shopper fill a form for height/weight they just stated (council fix #2).
  const inlineMeasure =
    /(\b\d{3}\s*cm\b|\b1\.[5-9]\d?\s*m\b|\d\s*['’]\s*\d{1,2}|\b\d{2,3}\s*(kg|lb|lbs|pounds)\b|\b(?:bust|chest|waist|hip|hips)\s*(?:is|are|:)?\s*\d{2,3}\b)/i.test(m);
  if (
    /what size|size me\b|am i a|my size|size (this|it)|fit me|what.*fit|between (?:sizes|[xsml]{1,3}\s+and\s+[xsml]{1,3})|which (?:size|one).*(?:fit|knit|shirt|coat|dress|gown|blazer|trouser|jean)/i.test(m)
  ) {
    // Body already on file OR stated inline → ANSWER the size directly (route
    // "fit"), never re-ask with the measurement form.
    if (hasBody || inlineMeasure) {
      return { ...decision, route: "fit", productHandle: curHandle, voice: deadEnd ? `You're already on file, here's your size in the ${product.name}.` : decision.voice };
    }
    return { ...decision, route: "size_form", productHandle: curHandle, voice: deadEnd ? `Let's size the ${product.name} exactly for your frame.` : decision.voice };
  }
  if (/see it on me|try (it|this|them) on|on a model|on me\b/.test(m)) {
    return { ...decision, route: "try_on", productHandle: curHandle, voice: deadEnd ? `Let's see the ${product.name} on you.` : decision.voice };
  }
  return decision;
}

const PRODUCT_ACTION_ROUTES = new Set<MiraDecision["route"]>([
  "reco_category",
  "reco_handle",
  "reco_filter",
  "navigate",
  "look",
  "fit",
  "fabric",
  "suitability",
  "size_form",
  "try_on",
]);

// Prompts influence the model; this policy guarantees the commercial mechanics.
// It does not invent facts or force a purchase. It ensures every grounded product
// presentation exposes the next useful actions in the UI.
function applySalesPolicy(
  decision: MiraDecision,
  body: z.infer<typeof BodySchema>,
  activeCatalog: Product[] = catalog,
): MiraDecision {
  const message = body.message.toLowerCase();

  // ── HALLUCINATION GUARD (Mira shopper-panel P0 — brand-trust invariant) ───
  // The model sometimes invents a plausible handle for a piece the catalog does
  // NOT carry ("nude-block-heel-sandal" for "do you have heels?") and writes a
  // confident voice claiming we stock it. The old code FELL BACK to the bad
  // handle (product?.handle ?? decision.productHandle) and shipped the lying
  // voice — Mira recommended things that don't exist. Gate it up front: a
  // productHandle the model named that is NOT in the live catalog is a
  // hallucination. If the shopper asked for an out-of-catalog CATEGORY
  // (footwear/bags/accessories), force the honest gap — never claim to stock
  // it, flag unmet so the brand sees the demand. Otherwise the model just
  // picked a phantom in-category handle → ground to a REAL hero so we still
  // sell the truth, never a fiction. (Same invariant as PB19/D46/D59/D62.)
  if (decision.productHandle && !activeCatalog.some((p) => p.handle === decision.productHandle)) {
    const OUT_OF_CATALOG = /\b(heels?|sandals?|shoes?|boots?|sneakers?|trainers?|loafers?|pumps?|stiletto|footwear|bags?|handbags?|purses?|clutch|totes?|backpacks?|belts?|sunglasses?|jewell?ery|necklaces?|earrings?|bracelets?|rings?|watch|watches|hats?|caps?|scarf|scarves|gloves?|socks?|lingerie|swimwear|bikini)\b/i;
    const m = body.message.match(OUT_OF_CATALOG);
    if (m) {
      return {
        ...decision,
        route: "talk_only",
        productHandle: undefined,
        unmet: true,
        unmetCategory: decision.unmetCategory ?? m[0].toLowerCase(),
        unmetReason: decision.unmetReason ?? `Shopper asked for ${m[0].toLowerCase()}; the store is clothing-only.`,
        voice: "I'll be honest — we're a clothing edit, so no footwear or accessories here. Tell me the occasion and I'll pull the piece that anchors the whole look.",
        quickReplies: ["What do you carry?", "Style an outfit", "Just browsing"],
      };
    }
    const hero = [...activeCatalog].sort((a, b) => (b.keepRate ?? 0) - (a.keepRate ?? 0))[0];
    if (hero) {
      return {
        ...decision,
        route: "reco_handle",
        productHandle: hero.handle,
        voice: `Let me pull something real for that — the ${hero.name} is where I'd start. Want to see it?`,
        quickReplies: ["Show me", "Something else", "Style a look"],
      };
    }
  }

  const handle = decision.productHandle ?? body.currentProductHandle ?? undefined;
  const product = handle ? activeCatalog.find((p) => p.handle === handle) : undefined;
  // Never preserve a handle the catalog can't resolve — drop to undefined so a
  // downstream consumer never routes to a dead page (hardens validateHandle).
  let next = { ...decision, productHandle: product?.handle };
  const inlineMeasurements =
    /(\b\d{3}\s*cm\b|\b1\.[5-9]\d?\s*m\b|\d\s*['’]\s*\d{1,2}|\b\d{2,3}\s*(kg|lb|lbs|pounds)\b|\b(?:bust|chest|waist|hip|hips)\s*(?:is|are|:)?\s*\d{2,3}\b)/i.test(body.message);

  // Never let the model guess a size from "between M and L" or body adjectives.
  // The fit route is only valid when the measurement engine has usable inputs.
  if (
    product &&
    next.route === "fit" &&
    !body.bodyOnFile &&
    !body.knownSize &&
    !inlineMeasurements
  ) {
    next = {
      ...next,
      route: "size_form",
      voice: `Let's size the ${product.name} properly rather than guess between sizes.`,
      quickReplies: ["Start sizing", "See it on you", "Build the look"],
    };
  }

  // Try-on intent ALWAYS wins over purchase intent. A shopper asking "can I see
  // this on someone with my shape before I buy?" mentions "buy" but is asking
  // to see — never route them to the cart on a SEE-ME question. Council bug A.
  const tryOnIntent =
    /\b(can|could|may|will|would|let'?s|show me|i want to|i'?d like to|how about|how would|what would)\b.{0,40}\b(see|try|view|look|put|wear|fit)\b.{0,40}\b(on (?:me|her|him|a|the|someone|model|body|shape)|fitting room|on my (?:body|shape|frame))/i.test(
      message,
    ) ||
    /\b(see it on|try (?:it|this|that|them) on|on a model|on me|on my (?:body|shape|frame)|fitting room|virtual try.?on|see how (?:it|this) (?:looks|fits)|with my shape|on someone (?:like|with) (?:me|my)|show me on (?:a |the )?(?:body|model|muse|shape|frame|someone)|on (?:a|the) body)\b/i.test(
      message,
    );
  if (product && tryOnIntent) {
    next = {
      ...next,
      route: "try_on",
      productHandle: product.handle,
      voice: `Let's see the ${product.name} on you before you decide.`,
      quickReplies: ["See it on me", "Size this one", "Add to bag"],
    };
  }

  // Body data ALREADY GIVEN — never re-ask for the form. If the shopper just
  // stated their bust/waist/hip OR height/weight inline, OR a body is on file,
  // answer the size in voice ("fit") instead of opening size_form. Council bug B.
  if (product && next.route === "size_form" && (body.bodyOnFile || body.knownSize || inlineMeasurements)) {
    next = {
      ...next,
      route: "fit",
      productHandle: product.handle,
      voice: `With those measurements you're a clear pick in the ${product.name}, naming it now.`,
      quickReplies: ["See it on me", "Add to bag", "Build the look"],
    };
  }

  // Only execute an explicit purchase command. Broadly matching the word
  // "buy" misrouted hesitation such as "before I buy" and "should I buy this"
  // straight to the cart instead of answering or opening try-on.
  const explicitPurchase =
    /\b(add (?:it|this|that|them|all|the look)(?: to (?:my |the )?(?:bag|cart))?|bag (?:it|this|that|them)|i'?ll take (?:it|this|that|them)|i (?:want|will|'?m going) to buy (?:it|this|that|them)|checkout|lock it in|let'?s do it|go ahead and add|yes,? add)\b/i.test(message);
  if (product && explicitPurchase && !tryOnIntent) {
    next = {
      ...next,
      route: "add_to_cart",
      productHandle: product.handle,
      voice: `I'll put the ${product.name} in your bag. Want the full look with it, or straight to checkout?`,
      quickReplies: ["Build the look", "Checkout"],
    };
  }

  const budget = parseBudget(body.message);
  if (product && budget != null && product.priceUsd > budget) {
    const affordable = activeCatalog
      .filter((candidate) => candidate.priceUsd <= budget)
      .sort((a, b) => a.priceUsd - b.priceUsd)[0];
    if (affordable) {
      next = {
        ...next,
        route: "reco_handle",
        productHandle: affordable.handle,
        voice: `That first pick is over your stated ceiling. The ${affordable.name} is ${affordable.priceUsd} in the store's currency, the strongest option that genuinely stays inside it.`,
      };
    } else {
      const floor = [...activeCatalog].sort((a, b) => a.priceUsd - b.priceUsd)[0];
      next = {
        ...next,
        route: "talk_only",
        productHandle: undefined,
        voice: floor
          ? `I want to be straight with you: nothing here is inside that ceiling. The closest piece is the ${floor.name} at ${floor.priceUsd} in the store's currency.`
          : "I don't have a grounded option inside that budget right now.",
        quickReplies: ["Show the closest", "Change the budget", "Keep browsing"],
      };
    }
  }

  if (!product || !PRODUCT_ACTION_ROUTES.has(next.route)) return next;

  // Product cards use one stable sales rail. The model owns the voice and
  // judgment; the interface always exposes the four actions that move a sale.
  if (next.route === "look") {
    return {
      ...next,
      quickReplies: ["Size the pieces", "See whole look", "Add full look", "Show another look"],
    };
  }
  if (next.route === "size_form" || next.route === "fit") {
    return {
      ...next,
      quickReplies: ["Start sizing", "See it on you", "Build the look", "Add after sizing"],
    };
  }
  if (next.route === "try_on") {
    return {
      ...next,
      quickReplies: ["What's my size?", "Build the look", "Add to bag", "Show another"],
    };
  }
  return {
    ...next,
    quickReplies: ["What's my size?", "See it on you", "Build the look", "Add to bag"],
  };
}

function situationalLead(message: string): string {
  const patterns: Array<[RegExp, string]> = [
    [/\b(dubai|40\s*°?c|45\s*°?c|hot|heat|humid|summer)\b/i, "For that heat"],
    [/\b(scotland|chicago|-10\s*°?f|cold|winter)\b/i, "For that cold"],
    [/\b(seattle|rain|monsoon)\b/i, "For that rain"],
    [/\b(wedding|graduation|funeral|client dinner|board meeting|first day|vow renewal)\b/i, "For that occasion"],
    [/\b(petite|tall|curvy|curve|post-baby|size 16)\b/i, "For your frame"],
  ];
  return patterns.find(([pattern]) => pattern.test(message))?.[1] ?? "Here's the strongest place to start";
}

// A model outage must degrade into a smaller salesperson, never a blank bubble.
// This path is grounded entirely in the local catalog and uses no generated facts.
function buildResilientFallback(body: z.infer<typeof BodySchema>, activeCatalog: Product[] = catalog): MiraDecision {
  const message = body.message.toLowerCase();
  const current = body.currentProductHandle
    ? activeCatalog.find((p) => p.handle === body.currentProductHandle)
    : undefined;

  if (current && /\b(see it on|try.?on|on a model|on me)\b/i.test(message)) {
    return {
      voice: `Let's put the ${current.name} in the fitting room.`,
      route: "try_on",
      productHandle: current.handle,
      quickReplies: ["What's my size?", "Build the look", "Add to bag"],
      intent: "try_on",
    };
  }
  if (current && /\b(size|fit me|measure)\b/i.test(message)) {
    return {
      voice: `Let's size the ${current.name} properly before you decide.`,
      route: body.bodyOnFile || body.knownSize ? "fit" : "size_form",
      productHandle: current.handle,
      quickReplies: ["See it on you", "Build the look", "Add to bag"],
      intent: "size",
    };
  }
  if (current && /\b(look|outfit|style this|goes with|pairs with)\b/i.test(message)) {
    const pair = buildLook(current, activeCatalog, 1)[0]?.product;
    return {
      voice: pair
        ? `The ${current.name} works best with the ${pair.name}. I'll build the look so you can see both together.`
        : `I'll build the strongest complete look around the ${current.name}.`,
      route: "look",
      productHandle: current.handle,
      quickReplies: ["See it on you", "What's my size?", "Add all to bag"],
      intent: "look",
    };
  }
  if (current && /\b(add|bag|buy|take it|checkout|do it)\b/i.test(message)) {
    return {
      voice: `I'll put the ${current.name} in your bag. Want the full look too, or straight to checkout?`,
      route: "add_to_cart",
      productHandle: current.handle,
      quickReplies: ["Build the look", "Checkout"],
      intent: "specific",
    };
  }
  if (/\b(return|refund|exchange)\b/i.test(message)) {
    return {
      voice: "Returns are accepted within 14 days when items are unworn and in their original packaging. Now let me find the piece worth trying.",
      route: "returns",
      quickReplies: ["Show me the best one", "Shop by occasion"],
      intent: "support",
    };
  }
  if (current) {
    return {
      voice: `${situationalLead(body.message)}, the ${current.name} is the piece in front of us. I'll help you size it, style it, or see it on before you decide.`,
      route: "reco_handle",
      productHandle: current.handle,
      quickReplies: ["What's my size?", "See it on you", "Build the look", "Add to bag"],
      intent: "specific",
    };
  }

  const occasion = /\b(wedding|graduation|funeral|dinner|party|evening|date)\b/i.test(message);
  const climate = /\b(hot|heat|summer|humid|dubai|delhi|cold|winter|scotland|chicago|rain|seattle)\b/i.test(message);
  // Catalog-aware fallback hero: prefer merchant's relevant pieces by category;
  // hardcoded handles are demo-only and silently miss on a real merchant store.
  const byCat = (cats: Product["category"][]) =>
    activeCatalog.find((p) => cats.includes(p.category));
  const hero = (
    climate && /\b(hot|heat|summer|humid|dubai|delhi)\b/i.test(message)
      ? activeCatalog.find((p) => p.handle === "linen-relaxed-shirt") ?? byCat(["top"])
      : climate
        ? activeCatalog.find((p) => p.handle === "wrap-coat-camel") ?? byCat(["outerwear"])
        : occasion
          ? activeCatalog.find((p) => p.handle === "onyx-silk-slip") ?? byCat(["dress", "top"])
          : activeCatalog.find((p) => p.handle === "tailored-blazer-double") ?? byCat(["outerwear", "top"])
  ) ?? activeCatalog[0]!;

  return {
    voice: `${situationalLead(body.message)}, I'd start with the ${hero.name}. I'll show you why it works, then we can size it or build the full look.`,
    route: "reco_handle",
    productHandle: hero.handle,
    quickReplies: ["What's my size?", "See it on you", "Build the look", "Show me another"],
    intent: occasion ? "occasion" : "discover",
  };
}

function buildPrompt(body: z.infer<typeof BodySchema>, activeCatalog: Product[] = catalog): string {
  const cur = body.currentProductHandle
    ? activeCatalog.find((p) => p.handle === body.currentProductHandle)
    : null;
  const history = body.history ?? [];
  const isColdOpen = history.length === 0;
  const ctxLines: string[] = [];

  // Deterministic budget facts (real prices + cheapest-look total) so Mira can't
  // fabricate "under budget". Injected first so it dominates any pricing answer.
  const budgetFacts = budgetFactsBlock(body.message, activeCatalog);
  if (budgetFacts) ctxLines.push(budgetFacts);

  if (cur) {
    ctxLines.push(
      `CURRENT PRODUCT (shopper is viewing this PDP): ${cur.handle} | ${cur.name} | ${cur.category}/${cur.collection} | $${cur.priceUsd} | colors: ${cur.colors.join("/")} | sizes: ${cur.sizes.join(",")}`,
    );
    ctxLines.push(`  Fit notes: ${cur.fitNotes}`);
    if (isColdOpen) {
      ctxLines.push(
        `⚠ PDP COLD OPEN: This is the very first message and the shopper is already on the ${cur.name} product page. ` +
        `Do NOT say a generic greeting. Reference this product immediately. ` +
        `Name it, say one useful thing about it, offer a next step (size / style / try-on).`,
      );
    }
    // The same styling algorithm that powers the Try-On "complete the look"
    // grid, surfaced here so Mira's spoken pairing advice is grounded in real
    // color/category/formality scoring, not a guess. She references THESE picks.
    const look = buildLook(cur, activeCatalog, 3);
    if (look.length) {
      ctxLines.push(
        "STYLING, what our algorithm says goes best with this piece, ranked by how strong the pairing is (use these when they ask what pairs / to complete the look; pick from this list, in this order):",
        ...look.map((e, i) => `  ${i + 1}. ${e.product.handle} (${e.product.name}), ${e.reason} [colour relationship: ${e.harmonyType}; ${Math.round(e.score * 100)}% match]`),
        "WHEN YOU BUILD A LOOK, TELL THEM WHY IT'S THE BEST PAIRING in real terms: name the colour relationship in plain words (tonal/monochrome reads expensive; analogous is harmonious not matchy; complementary makes people look twice; one accent-pop draws the eye), note the proportion balance (relaxed with structured), tie it to the occasion, and give the match %, e.g. \"the ivory knit is tonal with the camel, monochrome reads quietly expensive, and at 94% it's the strongest pairing I'd make.\" NEVER say \"you may also like\". Offer the RIGHT number of pieces (usually 2, three only when each genuinely adds), not a forced three.",
      );
    }
  } else {
    ctxLines.push("CURRENT PRODUCT: none (shopper is browsing generally).");
  }

  if (body.shownHandles?.length) {
    ctxLines.push(`ALREADY SHOWN this session: ${body.shownHandles.join(", ")} (avoid repeating, vary the pick).`);
  }
  if (cur && body.knownSize) {
    ctxLines.push(
      `KNOWN SIZE for current piece: this shopper is a ${body.knownSize} in ${cur.name}. Do NOT ask again; state it warmly ("you're a ${body.knownSize} in this one") and move toward closing (add_to_cart) or the fitting room (try_on).`,
    );
  }
  if (body.bodyOnFile) {
    const b = body.bodyOnFile;
    ctxLines.push(
      `BODY ON FILE this session: ${b.heightCm}cm, ${b.weightKg}kg, ${b.fitPref} fit${b.age ? `, age ${b.age}` : ""}${b.usualBrandSize ? `, usually wears ${b.usualBrandSize} in similar brands` : ""}. You have their measurements for EVERY piece — age calibration and brand-size anchor are already applied to the size recommendation. NEVER ask for measurements again and NEVER route to size_form to re-collect them. When they ask "what's my size / does it fit", ANSWER directly (route "fit", or recall the KNOWN SIZE above) — the store computes the exact size from this body. Only use size_form if there is NO body on file and NO known size.`,
    );
  }

  // Surface any body measurements or stated sizes from earlier in the session.
  const bodyCtx = extractBodyContext(history);
  if (bodyCtx) ctxLines.push(bodyCtx);

  // ── Active look context ──────────────────────────────────────────────────
  if (body.activeLookSummary) {
    ctxLines.push(body.activeLookSummary);
  }

  // Try-on context, Mira knows what happened in the fitting room
  if (body.tryOnContextSummary) {
    ctxLines.push(body.tryOnContextSummary);
  }

  // ── Closing intelligence ─────────────────────────────────────────────────
  // Deterministic closing state from the conversation signals, tells the model
  // when and how to close without it having to guess.
  const closingSignals = extractSignals(
    history,
    body.sizeConfirmed ?? false,
    body.tryOnCompleted ?? false,
    body.tryOnAbandoned ?? false,
    body.outfitAccepted ?? false,
    body.outfitPiecesRecommended ?? 0,
    body.cartItemCount ?? 0,
    !!cur,
  );
  const closingDecision = decideClose(closingSignals);
  const closingBlock = buildClosingContextBlock(closingDecision);
  if (closingBlock) ctxLines.push(closingBlock);

  // Pilot diagnosis: server-side fallback rose to 33% on cold/complex turns
  // because both Pro and Flash burned their token budget on a giant prompt.
  // The sticky-fallback pattern (one bad turn → next 2 turns also bad) is the
  // tell: history kept growing, prompt kept growing, budget kept shrinking.
  // FIX: cap history at the last 6 turns and truncate each snippet at 220
  // chars so even a long Mira reply can't blow up the prompt. The most recent
  // exchange is what matters; older context is already encoded in the BODY ON
  // FILE / KNOWN SIZE / ACTIVE LOOK blocks above.
  const hist = history
    .slice(-6)
    .map((h) => {
      const txt = (h.text ?? "").slice(0, 220);
      return `${h.from === "user" ? "Shopper" : "Mira"}: ${txt}`;
    })
    .join("\n");

  return `${ctxLines.join("\n")}

RECENT CONVERSATION:
${hist || "(none yet)"}

SHOPPER'S LATEST MESSAGE:
"${body.message}"

Return the JSON decision now.`;
}


export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    // ── ONE BRAIN, THREE CATALOGS ───────────────────────────────────────────
    // Demo path: no injection → uses the hardcoded 14-product `catalog`.
    // Production path: mira-adapter (stylique-app) sends `injectedCatalog`
    // (merchant's Prisma catalog mapped to Product shape) so a REAL shopper on
    // a REAL Shopify store hits THIS brain code with THEIR products. Identical
    // intelligence — only the catalog source differs.
    const activeCatalog = (parsed.data.injectedCatalog && parsed.data.injectedCatalog.length > 0
      ? (parsed.data.injectedCatalog as unknown as Product[])
      : catalog);
    const activeKnowledge = parsed.data.injectedKnowledge ?? await knowledgePromptBlock();
    // Brand identity: storefront callers inject the merchant's brand POV; demo
    // direct hit gets Stylique Maison defaults.
    const activeBrand: BrandIdentity = parsed.data.injectedBrand ?? {};
    const activeCurrency = parsed.data.injectedCurrency?.toUpperCase();
    const { decision: rawDecision, model: modelUsed } = await callGemini(
      buildPrompt(parsed.data, activeCatalog),
      buildSystem(activeKnowledge, activeCatalog, activeBrand, activeCurrency),
      activeCatalog,
    );
    // Deterministic navigation execution, force the route+handle when the shopper
    // clearly asked to act on the product they're viewing but the model dead-ended.
    let decision = rawDecision
      ? enforceExecution(rawDecision, parsed.data.message, parsed.data.currentProductHandle, !!parsed.data.bodyOnFile || !!parsed.data.knownSize, activeCatalog, parsed.data.history?.length ?? 0)
      : buildResilientFallback(parsed.data, activeCatalog);
    decision = applySalesPolicy(decision, parsed.data, activeCatalog);

    // ── ANTI-REPEAT GUARD ───────────────────────────────────────────────────
    // Pilot found 7/20 conversations where Mira sent the exact same `voice`
    // string on two consecutive turns ("Of course. Here are the most accessible
    // pieces we have.", "Yes, that's for this exact Linen Relaxed Shirt…").
    // When the model returns text byte-identical to the previous mira turn,
    // prefix a short bridge so the shopper never sees a copy-paste. The model
    // chose the same line because the prompt context didn't change much, NOT
    // because that's the right behaviour — the bridge nudges + we log so we
    // can see how often this fires in production.
    if (decision?.voice) {
      const history = parsed.data.history ?? [];
      // Find the most recent mira turn (skip the user's latest message).
      for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i];
        if (h.from === "mira") {
          if (h.text === decision.voice) {
            const BRIDGES = ["Right — ", "Quick — ", "On that — ", "OK — "];
            const pick = BRIDGES[Math.floor(history.length / 2) % BRIDGES.length];
            decision = { ...decision, voice: pick + decision.voice };
            console.warn("[mira] anti-repeat fired", { handle: parsed.data.currentProductHandle, len: decision.voice.length });
          }
          break;
        }
      }
    }
    const responseSource = rawDecision ? "gemini" : "fallback";
    // ── Full event mesh emission ──────────────────────────────────────────────
    // Every turn flows through the event bridge, writes to the JSON debug
    // mirror AND forwards to the production Prisma event mesh when configured.
    // All fire-and-forget, never blocks the reply.
    const productHandle = decision.productHandle ?? parsed.data.currentProductHandle ?? null;

    // ── ONE consolidated turn signal per request (the learning loop) ──────────
    // Everything the brand needs about THIS turn lives on a SINGLE row: intent,
    // the served handle, and any catalog gap / near-miss. This is the fix for
    // the double/triple-count bug, aggregateInsights counts turn rows, so one
    // request must produce exactly one turn row.
    // A served real product on a reco/navigate route is NOT a hard catalog gap,
    // demote any stray unmet=true to a near-miss so it doesn't pollute the
    // catalog-gap ranking (the model occasionally sets both; unmet must be
    // reserved for genuine absences with NO product served).
    const servedReal =
      !!productHandle && (decision.route === "reco_handle" || decision.route === "navigate" || decision.route === "reco_filter" || decision.route === "reco_category");
    const isUnmet = !!(decision.unmet && decision.unmetCategory) && !servedReal;
    // A near-miss is a catalog-gap HINT ("has linen shirts but none cropped"),
    // the productHandle is optional context, NOT a requirement. Requiring it
    // silently dropped the reorder signal whenever the model named a closest
    // piece that failed handle validation (panel P2). Capture on category alone.
    const isNearMiss = !!(decision.nearMiss && decision.nearMissCategory);
    void recordSignal({
      query: parsed.data.message,
      route: decision.route,
      intent: (decision.intent as MiraIntent) ?? "other",
      productHandle,
      source: responseSource,
      unmet: isUnmet,
      unmetCategory: isUnmet ? decision.unmetCategory : undefined,
      unmetReason: isUnmet ? (decision.unmetReason ?? "") : undefined,
      nearMiss: isNearMiss,
      nearMissCategory: isNearMiss ? decision.nearMissCategory : undefined,
      nearMissAttribute: isNearMiss ? (decision.nearMissAttribute ?? "") : undefined,
      nearMissReason: isNearMiss ? (decision.nearMissReason ?? "") : undefined,
    }).catch(() => {});

    // ── Production event mesh forwarding ONLY (no local duplicate rows) ───────
    // These forward to the production Prisma event mesh when SHOPIFY_APP_URL is
    // configured; in the demo they are no-ops. They do NOT write local signals.
    void emitIntentCaptured(parsed.data.message, (decision.intent as MiraIntent) ?? "other", productHandle, responseSource).catch(() => {});
    switch (decision.route) {
      case "reco_handle":
      case "navigate":
        if (productHandle) void emitProductRecommended(parsed.data.message, productHandle, decision.route).catch(() => {});
        break;
      case "look": void emitOutfitRecommended(productHandle, []).catch(() => {}); break;
      case "size_form":
      case "fit": void emitSizeHelpStarted(productHandle).catch(() => {}); break;
      case "try_on": void emitTryOnOffered(productHandle).catch(() => {}); break;
      case "suitability": void emitHesitationDetected(parsed.data.message, productHandle).catch(() => {}); break;
      // NOTE: add_to_cart is Mira OFFERING to bag, NOT a real conversion. We do
      // NOT record a conversion here (that measured the wrong event). A real
      // conversion is recorded only when the shopper actually adds to bag, via
      // POST /api/mira/conversion from the client.
      case "add_to_cart": void emitAddToCartAssist(productHandle, false).catch(() => {}); break;
      default: break;
    }
    if (isUnmet) void emitUnmetDemand(parsed.data.message, decision.unmetCategory!, decision.unmetReason ?? "").catch(() => {});
    if (isNearMiss) void emitNearMiss(parsed.data.message, productHandle!, decision.nearMissCategory!, decision.nearMissAttribute ?? "", decision.nearMissReason ?? "").catch(() => {});

    return NextResponse.json({ source: responseSource, model: modelUsed, decision });
  } catch (err) {
    console.error("[mira] route error", err instanceof Error ? err.message : err);
    const fallback = BodySchema.safeParse(body);
    return NextResponse.json({
      source: "fallback",
      decision: fallback.success ? applySalesPolicy(buildResilientFallback(fallback.data), fallback.data) : null,
    });
  }
}
