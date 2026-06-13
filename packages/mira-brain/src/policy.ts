// ─── Mira brain — deterministic policy + fallback helpers ─────────────────────
// parseBudget, budgetFactsBlock, enforceExecution, PRODUCT_ACTION_ROUTES,
// applySalesPolicy, situationalLead — extracted VERBATIM from route.ts. All
// pure: they post-process a MiraDecision / build prompt facts over the active
// catalog, with no demo-module imports. activeCatalog is a required MiraProduct[]
// (demo-catalog default params dropped — callers always pass it).
import { z } from "zod";
import { type MiraDecision, BodySchema } from "./schemas.js";
import { ROUTES, currencyPrefix } from "./constants.js";
import { validateHandle, isSellable, type MiraProduct } from "./products.js";

// Deterministic BUDGET FACTS, the LLM cannot be trusted to add prices (v1 caught
// it pitching an $800 look as "under $600"). When the shopper signals a ceiling we
// compute the REAL affordable pieces + the REAL cheapest complete look total from
// the catalog and inject them, so Mira quotes facts instead of fabricating.
export function parseBudget(msg: string): number | null {
  if (!/budget|under|below|spend|afford|\$|dollar|price|cost|max|cheap|less than|up to|around|about/i.test(msg)) return null;
  const nums = [...msg.matchAll(/\$?\s*(\d{2,5})/g)].map((x) => parseInt(x[1], 10)).filter((n) => n >= 50 && n <= 9000);
  return nums.length ? Math.max(...nums) : null;
}

// Qualitative budget FEEL — most shoppers don't give a number, they give a vibe
// ("nothing too pricey", "I want to treat myself"). Map the vibe to a tier of
// the brand's OWN price landscape so Mira sells at the right level.
const _BUDGET_FEELS: Array<{ re: RegExp; tier: "value" | "mid" | "premium"; label: string }> = [
  { re: /\b(tight|cheap(est)?|affordable|budget[- ]?friendly|sav(e|ing)|a deal|good value|economical|inexpensive|low[- ]?budget|on a budget|don'?t want to spend|keep it (low|cheap|down)|nothing too (pricey|expensive|dear)|not too much)\b/i, tier: "value", label: "value-conscious (keep it smart)" },
  { re: /\b(splurg(e|ing)|treat( myself)?|special occasion|investment|invest in|luxe|luxury|premium|the (very )?best|top of the (line|range)|no (limit|budget)|whatever it takes|money no object|go all out|spoil( myself)?)\b/i, tier: "premium", label: "ready to invest in something special" },
  { re: /\b(mid[- ]?range|middle|reasonable|sensible|moderate|balanced|sweet spot|nothing crazy)\b/i, tier: "mid", label: "after balanced value" },
];
export function parseBudgetFeel(msg: string): { tier: "value" | "mid" | "premium"; label: string } | null {
  for (const f of _BUDGET_FEELS) if (f.re.test(msg)) return { tier: f.tier, label: f.label };
  return null;
}

// Cheapest / dearest COHERENT, SELLABLE complete 2-piece outfit under cap. Two
// honest pair shapes only — top|knit + bottom (the core outfit) OR dress + layer
// (dress + coat). NEVER top + dress (incoherent) and NEVER a piece Mira can't
// deliver: the re-audit caught the bundles naming a no-photo / out-of-stock
// "Floral Maxi Dress" and pairing a dress with trousers. Gate at the source.
function _bestLook(catalog: MiraProduct[], cap: number, pfx: string, want: "cheap" | "rich"): { total: number; text: string } | null {
  const sellable = catalog.filter(isSellable);
  const tops = sellable.filter((p) => p.category === "top" || p.category === "knitwear");
  const bottoms = sellable.filter((p) => p.category === "bottom");
  const dresses = sellable.filter((p) => p.category === "dress");
  const layers = sellable.filter((p) => p.category === "outerwear");
  const pairs: [MiraProduct, MiraProduct][] = [];
  for (const t of tops) for (const b of bottoms) pairs.push([t, b]);   // core outfit
  for (const d of dresses) for (const l of layers) pairs.push([d, l]); // dress + coat
  let pick = want === "cheap" ? Infinity : -1, text = "";
  for (const [a, b] of pairs) {
    const tot = a.priceUsd + b.priceUsd;
    if (tot <= cap && (want === "cheap" ? tot < pick : tot > pick)) { pick = tot; text = `${a.name} (${pfx}${a.priceUsd}) + ${b.name} (${pfx}${b.priceUsd}) = ${pfx}${tot}`; }
  }
  return text ? { total: pick, text } : null;
}

export function budgetFactsBlock(message: string, activeCatalog: MiraProduct[], currencyCode?: string): string | null {
  const hard = parseBudget(message);
  const feel = parseBudgetFeel(message);
  if (hard == null && !feel) return null;
  const pfx = currencyPrefix(currencyCode);
  const prices = activeCatalog.map((p) => p.priceUsd).filter((n) => n > 0).sort((a, b) => a - b);
  if (!prices.length) return null;
  const floor = prices[0]!, ceil = prices[prices.length - 1]!, median = prices[Math.floor(prices.length / 2)]!;
  const lines: string[] = [];

  // Named pieces must be DELIVERABLE (photographed + in stock) — the price
  // landscape (floor/median/top) still spans the whole catalog so the range is
  // honest, but every piece Mira is told to NAME is one she can actually sell.
  const sellable = activeCatalog.filter(isSellable);
  if (hard != null) {
    const affordable = sellable.filter((p) => p.priceUsd <= hard).sort((a, b) => a.priceUsd - b.priceUsd);
    lines.push(`BUDGET FACTS — shopper signalled a ceiling near ${pfx}${hard}. Use ONLY these real numbers; never call a piece/look "within budget" unless its real total is ≤ ${pfx}${hard}. Do the arithmetic from THESE prices.`);
    lines.push(affordable.length
      ? `  At/under ${pfx}${hard} (in stock): ${affordable.map((p) => `${p.name} ${pfx}${p.priceUsd}`).join("; ")}.`
      : `  HONEST GAP: nothing deliverable is at/under ${pfx}${hard}; floor is ${pfx}${floor}. Say so plainly; offer the closest in-stock piece as an honest stretch, do NOT pretend it fits.`);
    const look = _bestLook(activeCatalog, hard, pfx, "cheap");
    lines.push(look ? `  Cheapest complete look within budget: ${look.text} — offer this as a BUNDLE so they get a whole outfit, not one piece.` : `  No 2-piece look fits under ${pfx}${hard}; a single in-budget piece is the only option.`);
  } else if (feel) {
    const band = feel.tier === "value"
      ? sellable.filter((p) => p.priceUsd <= median).sort((a, b) => a.priceUsd - b.priceUsd)
      : feel.tier === "premium"
        ? sellable.filter((p) => p.priceUsd >= median).sort((a, b) => b.priceUsd - a.priceUsd)
        : sellable.slice().sort((a, b) => Math.abs(a.priceUsd - median) - Math.abs(b.priceUsd - median));
    lines.push(`BUDGET FEEL — the shopper is ${feel.label}. Price landscape: floor ${pfx}${floor}, typical ${pfx}${median}, top ${pfx}${ceil}. Match the FEEL; never invent prices. If you don't know their feel yet, ASK once warmly ("are we keeping it smart, or is this a treat?") then sell to it.`);
    lines.push(band.length
      ? `  Pieces that fit "${feel.label}" (in stock): ${band.slice(0, 6).map((p) => `${p.name} ${pfx}${p.priceUsd}`).join("; ")}.`
      : `  HONEST GAP: nothing deliverable sits in that band right now — offer the closest in-stock piece honestly.`);
  }

  // ALWAYS give Mira 2 tiers so she can offer the shopper a CHOICE (a real
  // salesperson presents options): a smart-value bundle and an elevated bundle.
  const valueLook = _bestLook(activeCatalog, Infinity, pfx, "cheap");
  const statementLook = _bestLook(activeCatalog, Infinity, pfx, "rich");
  if (valueLook && statementLook && valueLook.text !== statementLook.text) {
    lines.push(`  OFFER A CHOICE OF LOOKS — value bundle: ${valueLook.text}; elevated bundle: ${statementLook.text}. Present BOTH and let them pick; always name the COMBINED total of a bundle (a whole outfit converts higher than one piece). If their budget is tight, lead with the value bundle and stack WHY it's worth it (fabric, kept-rate, the cost-per-wear).`);
  }
  return lines.join("\n");
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
    // Prefer pieces that are PHOTOGRAPHED and IN STOCK as the opener — a cold-open
    // hero is the first impression on a visual-first purchase, and the re-audit
    // caught a photo:NO, fully-OOS dress winning 4/4 runs. Eligible first, then keepRate.
    const heroes = activeCatalog.length
      ? [...activeCatalog]
          .sort((a, b) => {
            const ae = isSellable(a) ? 1 : 0, be = isSellable(b) ? 1 : 0;
            return ae !== be ? be - ae : (b.keepRate ?? 0) - (a.keepRate ?? 0);
          })
          .slice(0, 5)
          .map((p) => p.handle)
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
  // CLOSE — when the shopper signals BUY intent on a known piece, advance to the
  // bag and offer ONE complementary piece for AOV; never re-qualify a ready buyer
  // (re-audit: 'OK I'm sold, what's next?' got 'what piece did you decide on?').
  if (/\bi'?m sold\b|i'?ll take (it|this|that)|\badd (it|this|that)\b|add to (bag|cart)|let'?s do it|\bbuy (it|this|that)\b|check\s?out|i want (it|this)( one)?\b|put it in( my)? (bag|cart)|^\s*yes\b.{0,12}(add|bag|buy|take)/.test(m)) {
    return { ...decision, route: "add_to_cart", productHandle: curHandle, voice: deadEnd ? `Done — I'll add the ${product.name} to your bag. Want the one piece that completes the look?` : decision.voice };
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

// ── PHANTOM-COLOUR GUARD (re-audit: "what colour is this?" → invention) ──────
// The model, even with a blank colour field in the digest, still asserted a
// colourway it had no data for: asked the colours of a product whose colors[] is
// empty, it answered "available in a classic neutral... a versatile shade." Same
// class as the phantom-name bug — a confident attribute it can't back. This
// deterministic backstop fires ONLY when the routed product's colourway is
// genuinely unknown (colors[] empty) AND a sentence in the voice asserts a
// colour/shade for it; that sentence is replaced with an honest hedge. Absent =
// unknown is the trigger, so a product WITH a real colour is never touched.
const _COLOR_WORD =
  /\b(black|white|ivory|cream|off-white|beige|oat|stone|sand|taupe|tan|camel|cognac|brown|espresso|chocolate|grey|gray|charcoal|slate|ash|navy|blue|indigo|teal|cobalt|green|olive|khaki|sage|emerald|red|cardinal|burgundy|maroon|wine|pink|blush|rose|fuchsia|purple|lilac|lavender|plum|yellow|gold|mustard|orange|rust|terracotta|coral|silver|nude|neutral|monochrome)\b/i;
const _ASSERTS =
  /\b(comes?|come in|comes in|available|available in|offered|in a|in the|in classic|in soft|in rich|in deep|in muted|it'?s|its|they'?re|are|is|looks?|feels?|a versatile|a classic|a timeless|a beautiful)\b/i;
export function guardVoiceColorClaims(decision: MiraDecision, catalog: MiraProduct[]): MiraDecision {
  if (!decision.voice) return decision;
  const focal = decision.productHandle ? catalog.find((p) => p.handle === decision.productHandle) : undefined;
  const colourKnown = (focal?.colors?.filter(Boolean).length ?? 0) > 0;
  if (!focal || colourKnown) return decision;
  const parts = decision.voice.split(/(?<=[.?!])\s+/);
  let hedged = false;
  const out: string[] = [];
  for (const s of parts) {
    const mentionsColour = _COLOR_WORD.test(s) || /\b(shade|colou?r|tone|hue)\b/i.test(s);
    if (mentionsColour && _ASSERTS.test(s)) {
      // First colour-assertion → one honest hedge; drop any further ones so the
      // line never repeats the disclaimer.
      if (!hedged) { out.push("I don't have the exact colourway noted on this one — I can confirm it for you before you decide."); hedged = true; }
      continue;
    }
    out.push(s);
  }
  return hedged ? { ...decision, voice: out.join(" ") } : decision;
}

// ── ELIGIBILITY ENFORCEMENT (re-audit: prompt rules ≠ enforcement) ───────────
// The model, even with explicit catalog flags, still (a) claimed a SOLD-OUT gown
// had sizes in stock and reached add_to_cart, (b) recommended a women's Silk Slip
// Dress to a man who asked for menswear, (c) heroed photo:NO / out-of-stock
// pieces. validateHandle guards existence and guardVoiceProductNames guards
// names; this guards SELLABILITY: for any visual/sell route the grounded product
// must be in stock AND photographed AND gender-appropriate, or it is swapped to
// the best eligible alternative (or an honest talk_only when none qualifies).
const _SELL_ROUTES = new Set(["reco_handle", "navigate", "look", "try_on", "add_to_cart", "reco_category", "reco_filter"]);
const _MALE_INTENT = /\b(menswear|men'?s\b|for men\b|i'?m a (guy|man|male|dude|bloke)|something (smart |sharp )?for me,? (a )?(guy|man)|for myself[^.]{0,15}(guy|man|male)|for him\b|my husband|my boyfriend)\b/i;
const _NOT_MALE = /\bfor (her|my (wife|girlfriend|mum|mother|sister|daughter|fianc[ée]e|partner \(she)|a woman)\b/i;
const _WOMENS_CODED = /\b(gown|lehenga|gharara|anarkali|abaya|saree|sari|kameez|camisole|bridesmaid|bridal|jhumka|maang|tikka|blouse|sports?\s*bra)\b/i;

function _isWomensCoded(p: MiraProduct): boolean {
  const s = `${p.category} ${p.name}`.toLowerCase();
  if (_WOMENS_CODED.test(s)) return true;
  // "dress/skirt/slip" are women-coded EXCEPT compounds like "dress shirt".
  return /\b(dress|skirt|slip)\b/.test(s) && !/\bdress\s+(shirt|trouser|pant|shoe|sock)/.test(s);
}

export function enforceEligibility(
  decision: MiraDecision,
  body: z.infer<typeof BodySchema>,
  catalog: MiraProduct[],
): MiraDecision {
  const convo = [body.message, ...(body.history ?? []).filter((h) => h.from === "user").map((h) => h.text)].join(" ");
  const maleIntent = _MALE_INTENT.test(convo) && !_NOT_MALE.test(body.message);
  const genderOk = (p: MiraProduct) => !maleIntent || !_isWomensCoded(p);
  // isSellable = photographed + in stock (the one shared predicate); eligibility
  // here layers gender-appropriateness on top for this conversation.
  const eligible = (p: MiraProduct) => isSellable(p) && genderOk(p);
  const bestSwap = (like?: MiraProduct) => {
    const pool = catalog.filter(eligible);
    return (like && pool.find((p) => p.category === like.category)) ?? [...pool].sort((a, b) => (b.keepRate ?? 0) - (a.keepRate ?? 0))[0];
  };

  let next = decision;

  // 1. Sell-route grounded product must be sellable → swap or be honest.
  if (next.productHandle && _SELL_ROUTES.has(next.route)) {
    const product = catalog.find((p) => p.handle === next.productHandle);
    if (product && !eligible(product)) {
      const swap = bestSwap(product);
      if (swap) {
        next = {
          ...next,
          // Never auto-ADD a piece the shopper didn't choose.
          route: next.route === "add_to_cart" ? "reco_handle" : next.route,
          productHandle: swap.handle,
          voice: `Let me point you to the ${swap.name} instead — it's in stock and ready to see.`,
        };
      } else {
        return {
          ...next,
          route: "talk_only",
          productHandle: undefined,
          voice: maleIntent && _isWomensCoded(product)
            ? "Our menswear range is still limited here — tell me the occasion and I'll pull the closest piece we can actually show you."
            : (product.inStockSizes ?? product.sizes ?? []).length === 0
              ? "Honestly, that one's just sold out right now — tell me a bit more and I'll find one that's in stock and ready to see."
              : "Let me find you one I can actually show you properly — what's the occasion?",
          quickReplies: ["What's in stock?", "Style an outfit", "Something else"],
        };
      }
    }
  }

  // 2. compare route: drop any ineligible piece from the comparison set.
  if (next.route === "compare" && Array.isArray(next.compareHandles)) {
    const keep = next.compareHandles.filter((h) => { const p = catalog.find((x) => x.handle === h); return !!p && eligible(p); });
    if (keep.length !== next.compareHandles.length) next = { ...next, compareHandles: keep };
  }

  // 3. VOICE leak (re-audit): the model can NAME an ineligible piece in voice-only
  //    copy (e.g. a compare turn pitching an OOS, unphotographed gown as
  //    "unforgettable") with no route handle to guard. Rewrite any catalog product
  //    named in the voice that is NOT sellable to an eligible same-category piece.
  if (next.voice) {
    let voice = next.voice;
    let changed = false;
    for (const p of catalog) {
      if (eligible(p) || p.name.length < 5) continue;
      const re = new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      if (re.test(voice)) {
        const alt = bestSwap(p);
        voice = voice.replace(re, alt ? alt.name : "a piece that's in stock");
        changed = true;
      }
    }
    if (changed) next = { ...next, voice };
  }

  return next;
}
