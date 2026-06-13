// ─── Mira brain — deterministic policy + fallback helpers ─────────────────────
// parseBudget, budgetFactsBlock, enforceExecution, PRODUCT_ACTION_ROUTES,
// applySalesPolicy, situationalLead — extracted VERBATIM from route.ts. All
// pure: they post-process a MiraDecision / build prompt facts over the active
// catalog, with no demo-module imports. activeCatalog is a required MiraProduct[]
// (demo-catalog default params dropped — callers always pass it).
import { z } from "zod";
import { type MiraDecision, BodySchema } from "./schemas.js";
import { ROUTES } from "./constants.js";
import { validateHandle, type MiraProduct } from "./products.js";

// Deterministic BUDGET FACTS, the LLM cannot be trusted to add prices (v1 caught
// it pitching an $800 look as "under $600"). When the shopper signals a ceiling we
// compute the REAL affordable pieces + the REAL cheapest complete look total from
// the catalog and inject them, so Mira quotes facts instead of fabricating.
export function parseBudget(msg: string): number | null {
  if (!/budget|under|below|spend|afford|\$|dollar|price|cost|max|cheap|less than|up to|around|about/i.test(msg)) return null;
  const nums = [...msg.matchAll(/\$?\s*(\d{2,5})/g)].map((x) => parseInt(x[1], 10)).filter((n) => n >= 50 && n <= 9000);
  return nums.length ? Math.max(...nums) : null;
}
export function budgetFactsBlock(message: string, activeCatalog: MiraProduct[]): string | null {
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
export function enforceExecution(decision: MiraDecision, message: string, curHandle: string | null | undefined, hasBody = false, activeCatalog: MiraProduct[], historyLen = 0): MiraDecision {
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

export const PRODUCT_ACTION_ROUTES = new Set<MiraDecision["route"]>([
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
export function applySalesPolicy(
  decision: MiraDecision,
  body: z.infer<typeof BodySchema>,
  activeCatalog: MiraProduct[],
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

export function situationalLead(message: string): string {
  const patterns: Array<[RegExp, string]> = [
    [/\b(dubai|40\s*°?c|45\s*°?c|hot|heat|humid|summer)\b/i, "For that heat"],
    [/\b(scotland|chicago|-10\s*°?f|cold|winter)\b/i, "For that cold"],
    [/\b(seattle|rain|monsoon)\b/i, "For that rain"],
    [/\b(wedding|graduation|funeral|client dinner|board meeting|first day|vow renewal)\b/i, "For that occasion"],
    [/\b(petite|tall|curvy|curve|post-baby|size 16)\b/i, "For your frame"],
  ];
  return patterns.find(([pattern]) => pattern.test(message))?.[1] ?? "Here's the strongest place to start";
}

// ── VOICE-NAME GUARD (brand-panel P0) ────────────────────────────────────────
// validateHandle guards the ROUTE target, but the model can still NAME a product
// in its spoken voice that does not exist ("...I'd put you in the Midnight Silk
// Gown") even when the route handle is clean — a confident pitch for a phantom,
// which destroys trust on the closing step. This is the symmetric guard for the
// COPY: detect specific "the <Title-Case…> <garment>" references and, if the
// named piece is not a real catalog title, rewrite it to the grounded product's
// real name (or a neutral phrase). Title-case + the "the " prefix keep it to
// SPECIFIC product references, not generic category mentions ("a linen shirt").
const _GARMENT_NOUN =
  "(Gown|Dress|Coat|Trench|Shirt|Blouse|Skirt|Trousers|Pants|Jeans|Jacket|Blazer|Top|Camisole|Slip|Suit|Sweater|Cardigan|Hoodie|Tee|Maxi|Midi|Lehenga|Abaya|Anarkali|Gharara|Sari|Saree|Kurta|Kaftan|Romper|Jumpsuit|Bodysuit|Tunic|Vest|Waistcoat|Scarf|Wrap|Shawl|Heels|Trainers|Sneakers|Boots|Loafers|Bag|Clutch|Tote)";
// [Tt]he so sentence-initial "The …" is caught too; the product name itself
// stays Title-Case (case-sensitive) so generic lowercase phrases don't match.
const _NAMED_PRODUCT = new RegExp(
  `\\b([Tt]he)\\s+([A-Z][\\w'-]+(?:\\s+[A-Z][\\w'-]+){0,4}\\s+${_GARMENT_NOUN})\\b`,
  "g",
);

export function guardVoiceProductNames(decision: MiraDecision, catalog: MiraProduct[]): MiraDecision {
  if (!decision.voice) return decision;
  const titles = catalog.map((p) => p.name.toLowerCase().trim()).filter(Boolean);
  const grounded = decision.productHandle ? catalog.find((p) => p.handle === decision.productHandle) : undefined;
  let changed = false;
  const newVoice = decision.voice.replace(_NAMED_PRODUCT, (full: string, article: string, name: string) => {
    const lc = name.toLowerCase().trim();
    // Real if it matches a catalog title in either direction (handles "Champagne
    // Sequin Gown" vs the fuller "Champagne Sequin Evening Gown").
    const isReal = titles.some((t) => t === lc || t.includes(lc) || lc.includes(t));
    if (isReal) return full;
    changed = true;
    // Preserve the article's case ("The …" at a sentence start stays "This …").
    if (grounded) return `${article} ${grounded.name}`;
    return article[0] === "T" ? "This piece" : "this piece";
  });
  return changed ? { ...decision, voice: newVoice } : decision;
}
