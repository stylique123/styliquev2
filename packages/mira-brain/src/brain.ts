// ─── Mira brain — prompt + resilient fallback (dependency-injected) ───────────
// buildResilientFallback + buildPrompt, extracted VERBATIM from route.ts. The
// demo-coupled helpers are INJECTED via deps so the package imports no demo
// modules: buildLook (complete-the-look over the active catalog) + the closing-
// intelligence trio. Both callers (demo route, Shopify adapter) pass their own.
import type { MiraDecision, MiraBody } from "./schemas.js";
import type { MiraProduct } from "./products.js";
import { budgetFactsBlock, situationalLead, enforceExecution, applySalesPolicy } from "./policy.js";
import { extractBodyContext } from "./text.js";
import { buildSystem, type BrandIdentity } from "./system.js";
import { callGemini } from "./gemini.js";

export interface LookEntry { product: MiraProduct; reason: string; harmonyType: string; score: number; }
export interface MiraDeps {
  buildLook: (current: MiraProduct, catalog: MiraProduct[], n: number) => LookEntry[];
  extractSignals: (history: { from: string; text: string }[], sizeConfirmed: boolean, tryOnCompleted: boolean, tryOnAbandoned: boolean, outfitAccepted: boolean, outfitPiecesRecommended: number, cartItemCount: number, hasCurrent: boolean) => unknown;
  decideClose: (signals: unknown) => unknown;
  buildClosingContextBlock: (decision: unknown) => string;
}

// Catalog + knowledge seams decideMira needs beyond the prompt/fallback helpers.
// defaultCatalog is used when the caller injects no catalog (the demo's 14-piece
// set; production always injects). knowledgeBlock supplies the demo KB fallback.
export interface BrainDeps extends MiraDeps {
  defaultCatalog: MiraProduct[];
  knowledgeBlock?: () => Promise<string>;
}

export interface MiraResult {
  source: "gemini" | "fallback";
  model: string | null;
  decision: MiraDecision;
}

// A model outage must degrade into a smaller salesperson, never a blank bubble.
// This path is grounded entirely in the local catalog and uses no generated facts.
export function buildResilientFallback(body: MiraBody, activeCatalog: MiraProduct[], deps: MiraDeps): MiraDecision {
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
    const pair = deps.buildLook(current, activeCatalog, 1)[0]?.product;
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
  const byCat = (cats: MiraProduct["category"][]) =>
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

export function buildPrompt(body: MiraBody, activeCatalog: MiraProduct[], deps: MiraDeps): string {
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
    const look = deps.buildLook(cur, activeCatalog, 3);
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
  const closingSignals = deps.extractSignals(
    history,
    body.sizeConfirmed ?? false,
    body.tryOnCompleted ?? false,
    body.tryOnAbandoned ?? false,
    body.outfitAccepted ?? false,
    body.outfitPiecesRecommended ?? 0,
    body.cartItemCount ?? 0,
    !!cur,
  );
  const closingDecision = deps.decideClose(closingSignals);
  const closingBlock = deps.buildClosingContextBlock(closingDecision);
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

// ─── decideMira — the single brain entry point ───────────────────────────────
// Orchestrates one turn: resolve the active catalog/knowledge/brand/currency,
// call Gemini with the grounded prompt+system, fall back deterministically on a
// model outage, apply the sales policy, and de-dupe a repeated voice line. The
// analytics side-effects (recordSignal / event emission) stay in each CALLER —
// they are surface-specific (demo event-bridge vs production Prisma mesh). Both
// the demo route and the Shopify adapter call this; only `deps` differs.
export async function decideMira(body: MiraBody, deps: BrainDeps): Promise<MiraResult> {
  const activeCatalog = (body.injectedCatalog && body.injectedCatalog.length > 0
    ? (body.injectedCatalog as unknown as MiraProduct[])
    : deps.defaultCatalog);
  const activeKnowledge = body.injectedKnowledge ?? (deps.knowledgeBlock ? await deps.knowledgeBlock() : "");
  const activeBrand: BrandIdentity = body.injectedBrand ?? {};
  const activeCurrency = body.injectedCurrency?.toUpperCase();
  const { decision: rawDecision, model: modelUsed } = await callGemini(
    buildPrompt(body, activeCatalog, deps),
    buildSystem(activeKnowledge, activeCatalog, activeBrand, activeCurrency),
    activeCatalog,
  );
  // Deterministic navigation execution, force the route+handle when the shopper
  // clearly asked to act on the product they're viewing but the model dead-ended.
  let decision = rawDecision
    ? enforceExecution(rawDecision, body.message, body.currentProductHandle, !!body.bodyOnFile || !!body.knownSize, activeCatalog, body.history?.length ?? 0)
    : buildResilientFallback(body, activeCatalog, deps);
  decision = applySalesPolicy(decision, body, activeCatalog);

  // ── ANTI-REPEAT GUARD ──────────────────────────────────────────────────────
  // When the model returns text byte-identical to the previous mira turn, prefix
  // a short bridge so the shopper never sees a copy-paste.
  if (decision?.voice) {
    const history = body.history ?? [];
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.from === "mira") {
        if (h.text === decision.voice) {
          const BRIDGES = ["Right — ", "Quick — ", "On that — ", "OK — "];
          const pick = BRIDGES[Math.floor(history.length / 2) % BRIDGES.length];
          decision = { ...decision, voice: pick + decision.voice };
        }
        break;
      }
    }
  }
  return { source: rawDecision ? "gemini" : "fallback", model: modelUsed, decision };
}
