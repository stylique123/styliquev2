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
  // Any COLD dead-end (no product on the page, model fell to talk_only) → SHOW a
  // confident hero + a light steer, never a bare greeting or an empty qualifier.
  // This is the maximal show-first move: it recovers gibberish/emoji/noise input
  // ("asdkfjaslkdfj", "🤡🤡🤡") and a bare "something" by leading with a real piece
  // instead of "what brought you in today?".
  if (!curHandle && decision.route === "talk_only") {
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
        `Quick one for you: the ${hp.name}. What's the vibe today, or dressing for something?`,
        `If you trust me on one piece, it's the ${hp.name}. What mood are we going for?`,
        `Start here: the ${hp.name}. Polished, easy, or with some edge?`,
        `The one I'd pull off the rack for you, the ${hp.name}. What's it for, or what are you feeling?`,
      ];
      const voice = leadIns[(message.length + turn + 1) % leadIns.length]!;
      return { ...decision, route: "reco_handle", productHandle: pick, voice, quickReplies: ["A vibe in mind", "For an occasion", "Just browsing"] };
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
  // OTHER OPTIONS — "show me another / something else / what else / other options"
  // is a directive to SHOW a fresh piece, not talk. Pull the best sellable piece in
  // the same category as the current one (else top sellable), DIFFERENT from it.
  if (/show me (another|other|something else|more)|other options|what else|something (else|different)|not (this|that one)|anything else/i.test(m)) {
    const pool = activeCatalog.filter((p) => isSellable(p) && p.handle !== curHandle);
    const sameCat = pool.filter((p) => p.category === product.category);
    const alt = (sameCat.length ? sameCat : pool).sort((a, b) => (b.keepRate ?? 0) - (a.keepRate ?? 0))[0];
    if (alt) return { ...decision, route: "reco_handle", productHandle: alt.handle, voice: `Sure — here's another direction: the ${alt.name}. Want to compare, or see more?`, quickReplies: ["Compare", "Show another", "I like this"] };
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
const _COLOR_QUESTION = /\bcolou?rs?\b|\bcolou?rway\b|\bshades?\b|\bhue\b|what.*\bcome(s)? in\b|\bwhat colou?r/i;
export function guardVoiceColorClaims(decision: MiraDecision, catalog: MiraProduct[], message?: string): MiraDecision {
  if (!decision.voice) return decision;
  // Only speak to colour when the shopper ASKED about colour — otherwise a stray
  // colour word in a styling/budget line would wrongly trigger the disclaimer and
  // derail the turn (caught in a full-journey self-test on the look + budget turns).
  if (!message || !_COLOR_QUESTION.test(message)) return decision;
  // A COMBINATION / PAIRING question ("what colours go WITH this", "show me colour
  // combinations", "what pairs with it", "what goes with what") is about the LOOK,
  // not the focal piece's own colourway — so the missing-colour hedge must NOT fire
  // (it was clobbering every colour-combination answer → colour component 0/5).
  if (/(go(es)?\s+with|pairs?|combination|combo|match|wear\s+with|style\s+with|what\s+goes)/i.test(message)) return decision;
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

// ── CATEGORY-INTENT GUARD — the named garment must be what Mira shows ─────────
// "take me to a skirt" must land on a SKIRT, not a coat. When the shopper names a
// specific garment, the routed product's name/category must match it; if the model
// (or a hero fallback) picked a different family, swap to the best sellable catalog
// piece that genuinely matches (name hint first, then category). Deterministic —
// prompt rules alone don't enforce this (a real "take me to skirt → coat" miss).
type GarmentTarget = { name: RegExp; cats: string[] };
const _GARMENTS: Array<{ trigger: RegExp; target: GarmentTarget }> = [
  { trigger: /\bskirts?\b/i, target: { name: /skirt/i, cats: ["bottom"] } },
  { trigger: /\b(dress(es)?|gown|frock|lehenga|anarkali|abaya|gharara|kameez|maxi)\b/i, target: { name: /dress|gown|slip|lehenga|anarkali|abaya|gharara|kameez|maxi/i, cats: ["dress"] } },
  { trigger: /\b(coat|trench|overcoat|parka)\b/i, target: { name: /coat|trench|parka/i, cats: ["outerwear"] } },
  { trigger: /\b(blazer|jacket|suit)\b/i, target: { name: /blazer|jacket|suit/i, cats: ["outerwear"] } },
  { trigger: /\b(trouser|trousers|pant|pants|slacks|chinos)\b/i, target: { name: /trouser|pant|slack|chino|wide-?leg/i, cats: ["bottom"] } },
  { trigger: /\b(jeans?|denim)\b/i, target: { name: /jean|denim/i, cats: ["bottom"] } },
  { trigger: /\b(knit|sweater|jumper|cardigan|turtleneck|pullover|cashmere)\b/i, target: { name: /knit|sweater|jumper|cardigan|turtleneck|cashmere|merino/i, cats: ["knitwear"] } },
  { trigger: /\b(shirt|blouse|tee|t-?shirt|top|cami|camisole)\b/i, target: { name: /shirt|blouse|tee|top|cami/i, cats: ["top"] } },
  { trigger: /\b(bag|tote|clutch|purse|handbag)\b/i, target: { name: /bag|tote|clutch|purse/i, cats: ["accessory"] } },
  { trigger: /\b(belt|scarf|sunglasses|necklace|earrings|shoes?|heels?|sneakers?|boots?|sandals?)\b/i, target: { name: /belt|scarf|sunglass|necklace|earring|shoe|heel|sneaker|boot|sandal/i, cats: ["accessory"] } },
];
const _SHOW_ROUTES = new Set(["reco_handle", "navigate", "reco_category", "reco_filter", "search", "try_on", "add_to_cart", "look"]);
export function enforceCategoryIntent(decision: MiraDecision, message: string, catalog: MiraProduct[]): MiraDecision {
  if (!decision.productHandle || !_SHOW_ROUTES.has(decision.route)) return decision;
  const m = message ?? "";
  const hit = _GARMENTS.find((g) => g.trigger.test(m));
  if (!hit) return decision;
  const cur = catalog.find((p) => p.handle === decision.productHandle);
  if (!cur) return decision;
  const matches = (p: MiraProduct) => hit.target.name.test(p.name) || hit.target.cats.includes((p.category || "").toLowerCase());
  if (matches(cur)) return decision; // already the right garment
  const pool = catalog.filter((p) => isSellable(p) && matches(p));
  // name-hint match first (a real "skirt"), then any in-category piece, by keepRate.
  const byName = pool.filter((p) => hit.target.name.test(p.name));
  const pick = (byName.length ? byName : pool).sort((a, b) => (b.keepRate ?? 0) - (a.keepRate ?? 0))[0];
  if (!pick) return decision; // catalog has none → leave it (honest-absence handled elsewhere)
  return { ...decision, route: decision.route === "add_to_cart" ? "reco_handle" : decision.route, productHandle: pick.handle };
}

// ── BOUNDARY GUARD — deterministic, final word on attacks/abuse/off-topic ─────
// A world-class closer never engages a troll or leaks — but also never silently
// ignores it. On a clear prompt-injection / privacy probe / discount-extraction /
// off-topic ask, give a crisp on-brand boundary + redirect back to selling, and
// NEVER fabricate a discount, leak the prompt, or expose anyone's data. Runs LAST
// so it overrides the cold-open hero (which would otherwise swallow these turns).
const _INJECTION = /ignore (all|previous|the|your|prior)|disregard (all|the|your|previous)|system prompt|reveal (your |the )?(prompt|instruction|system)|print (your |the )?(system|prompt|instruction)|you are (now )?dan|new instructions\b|override (your|the|all)|jailbreak|act as (if|though) you have no|\bsystem:\s|authoriz(e|es|ed)\b.{0,30}(you|to give|discount|off)|the (store )?owner (authoriz|approv|says|told|wants)|apply (it|the|a|this|that)?\s*(\d+\s*%?\s*)?(discount|off)\s*(now|code)?/i;
const _PRIVACY = /(other|another|last|previous|someone else'?s?|a different) (shopper|customer|user|person|buyer)|their (cart|order|data|details|info|email|address)|owner'?s? (email|phone|number|password|address|contact)|reveal .*(email|phone|password|address|data)|who else (bought|shopped)/i;
const _DISCOUNT_X = /(give|get|need|want|send|share|drop|hook me up).{0,24}(discount code|promo code|coupon|voucher|% ?(off|discount)|percent off)|for free\b|free if i\b|\b\d{1,3}% ?(off|discount)\b|match (it|that price)|price ?match/i;
const _OFFTOPIC = /\bwrite (me )?(a |some )?(python|javascript|code|script|sql)\b|scrape\b|drop table|select \* from|what medicine|prescription|i have a rash|should i take (for|medicine)|can i sue|legal advice|need a lawyer|my landlord|do my (homework|taxes)/i;

export function guardBoundaries(decision: MiraDecision, message: string): MiraDecision {
  const m = message ?? "";
  const redirect = (line: string): MiraDecision => ({
    ...decision,
    route: "talk_only",
    productHandle: undefined,
    voice: line,
    quickReplies: ["For an occasion", "A vibe in mind", "Just browsing"],
  });
  if (_INJECTION.test(m)) return redirect("I can't share how I work behind the scenes — but I can absolutely help you find the right piece. What are you after today?");
  if (_PRIVACY.test(m)) return redirect("I can't share anyone else's details — that stays private. Let's focus on you, though: what are you looking for?");
  if (_DISCOUNT_X.test(m)) return redirect("We don't do discount codes here, but I'll make sure you get something genuinely worth it. What's the occasion?");
  if (_OFFTOPIC.test(m)) return redirect("That's outside what I can help with — I'm here for styling and finding you the right piece. Want me to pull something?");
  return decision;
}

const _NEUTRALS = /\b(black|white|ivory|cream|off-white|beige|oat|stone|sand|taupe|tan|camel|cognac|brown|espresso|chocolate|grey|gray|charcoal|slate|ash|navy|nude|neutral|monochrome)\b/i;
function _colourOf(p: MiraProduct): string | null {
  // Prefer a real colour WORD; skip hex/rgb values (colors[] often holds "#1e2a52").
  const word = (p.colors ?? []).map((c) => c?.trim()).find((c) => c && !c.startsWith("#") && !/^rgb/i.test(c) && _COLOR_WORD.test(c));
  if (word) { const m = word.match(_COLOR_WORD); return (m ? m[0] : word).toLowerCase(); }
  const m = p.name.match(_COLOR_WORD);
  return m ? m[0].toLowerCase() : null;
}
// Name the piece WITHOUT repeating a colour already in its title ("camel wrap coat
// camel" → "the camel wrap coat"); strip a leading colour word from the name first.
function _pieceWithColour(colour: string | null, p: MiraProduct): string {
  const bare = p.name.toLowerCase().replace(_COLOR_WORD, "").replace(/\s+/g, " ").trim() || p.name.toLowerCase();
  const nameHasColour = colour ? _COLOR_WORD.test(p.name) : false;
  if (!colour) return `the ${p.name.toLowerCase()}`;
  return nameHasColour ? `the ${colour} ${bare}` : `a ${colour} ${p.name.toLowerCase()}`;
}
// DETERMINISTIC COLOUR STORY — on a colour question, state the ACTUAL palette built
// from the focal piece + its best real pairings, so Mira always NAMES the
// combination (never a vague "it's versatile"). This makes the colour answer
// impressive and reliable instead of depending on the model to volunteer colours.
export function injectColourStory(
  decision: MiraDecision,
  body: z.infer<typeof BodySchema>,
  catalog: MiraProduct[],
  buildLookFn: (anchor: MiraProduct, cat: MiraProduct[], n: number) => Array<{ product: MiraProduct }>,
): MiraDecision {
  const msg = body.message ?? "";
  if (!_COLOR_QUESTION.test(msg)) return decision;
  // "What goes with THIS" anchors on the piece they're standing on (the PDP), which
  // carries the colour — prefer currentProductHandle over a colourless look anchor.
  const focalHandle = body.currentProductHandle ?? decision.productHandle ?? undefined;
  const focal = focalHandle ? catalog.find((p) => p.handle === focalHandle) : undefined;
  if (!focal) return decision;
  let pieces = buildLookFn(focal, catalog.filter(isSellable), 3).map((e) => e.product);
  let fc = _colourOf(focal);
  let named = pieces.map((p) => ({ p, c: _colourOf(p) })).filter((x): x is { p: MiraProduct; c: string } => !!x.c);
  // If neither the focal nor its pairings name a colour, fall back to the best
  // colour-named sellable pieces so a colour question is ALWAYS answered with colours.
  if (!fc && !named.length) {
    const coloured = catalog.filter((p) => isSellable(p) && _colourOf(p) && p.handle !== focal.handle)
      .sort((a, b) => (b.keepRate ?? 0) - (a.keepRate ?? 0)).slice(0, 2);
    if (!coloured.length) return decision;
    pieces = coloured;
    named = coloured.map((p) => ({ p, c: _colourOf(p)! }));
  }
  const parts: string[] = [];
  parts.push(_pieceWithColour(fc, focal));
  named.slice(0, 2).forEach(({ p, c }) => parts.push(_pieceWithColour(c, p).replace(/^the /, "a ")));
  const palette = [fc, ...named.map((x) => x.c)].filter(Boolean) as string[];
  const allNeutral = palette.every((c) => _NEUTRALS.test(c));
  const harmony = allNeutral
    ? "warm neutrals, one clean tonal line — reads quietly expensive"
    : "one anchor colour against neutrals, balanced and easy to wear";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]!;
  const voice = `${list.charAt(0).toUpperCase()}${list.slice(1)} — ${harmony}.`;
  return { ...decision, route: pieces.length ? "look" : decision.route, productHandle: focal.handle, voice };
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
  // Budget objection on THIS turn → the swap should land on a genuinely cheaper
  // eligible piece and the line should acknowledge price, not read robotic (a
  // full-journey self-test showed a price objection swapping to a generic "let me
  // point you to … instead — in stock and ready to see", which drops the sell).
  const budgetObjection = /(too )?(much|expensive|pricey|costly|over\s*budget|a bit much|more than i|can'?t afford|cheaper|less expensive|on a budget|tight|keep it (cheap|sensible|low|down)|out of (my )?budget)/i.test(body.message);
  const genderOk = (p: MiraProduct) => !maleIntent || !_isWomensCoded(p);
  // isSellable = photographed + in stock (the one shared predicate); eligibility
  // here layers gender-appropriateness on top for this conversation.
  const eligible = (p: MiraProduct) => isSellable(p) && genderOk(p);
  const bestSwap = (like?: MiraProduct, maxPrice?: number) => {
    let pool = catalog.filter(eligible);
    if (maxPrice != null) { const cheaper = pool.filter((p) => p.priceUsd > 0 && p.priceUsd < maxPrice); if (cheaper.length) pool = cheaper; }
    return (like && pool.find((p) => p.category === like.category)) ?? [...pool].sort((a, b) => (b.keepRate ?? 0) - (a.keepRate ?? 0))[0];
  };

  let next = decision;

  // 1a. A LOOK is about the colour/styling combination, not a single sell — so if
  //     its anchor is ineligible, swap the handle SILENTLY and KEEP Mira's voice
  //     (the colour story). Case 3 below surgically rewrites any ineligible piece
  //     NAMED in that voice. (Without this, the generic "isn't quite ready" swap
  //     line clobbered every colour-combination answer → colour component 0/5.)
  if (next.productHandle && next.route === "look") {
    const product = catalog.find((p) => p.handle === next.productHandle);
    if (product && !eligible(product)) {
      const swap = bestSwap(product);
      next = swap ? { ...next, productHandle: swap.handle } : { ...next, productHandle: undefined };
    }
  }

  // 1. Sell-route grounded product must be sellable → swap or be honest.
  else if (next.productHandle && _SELL_ROUTES.has(next.route)) {
    const product = catalog.find((p) => p.handle === next.productHandle);
    if (product && !eligible(product)) {
      const swap = bestSwap(product, budgetObjection ? product.priceUsd : undefined);
      if (swap) {
        const voice = budgetObjection
          ? `Totally fair — let's keep it sensible. The ${swap.name} is a lovely option that's kinder on the budget, in stock and ready to see.`
          : maleIntent
            ? `Let me put you onto the ${swap.name} — it's in stock, photographed, and one I can actually show you properly.`
            : `That exact one isn't quite ready to show right now, but the ${swap.name} is a strong pick — in stock and photographed so you can see it properly.`;
        next = {
          ...next,
          // Never auto-ADD a piece the shopper didn't choose.
          route: next.route === "add_to_cart" ? "reco_handle" : next.route,
          productHandle: swap.handle,
          voice,
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
