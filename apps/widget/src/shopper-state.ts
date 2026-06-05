// Stylique Shopper Behavioral State Inference — pure, deterministic.
//
// Infers a shopper's current behavioral state from observable signals (page
// type, dwell, scroll, cart, conversation, etc). NO DOM, NO fetch, NO async,
// NO ML, NO LLM. Every output is a pure function of the ShopperSignals struct.
//
// The state drives whether and how Mira should intervene (see
// behavioral-triggers.ts). Mira must stay quiet when the inference is unsure —
// confidence is first-class and the trigger engine suppresses below 0.4.

export type ShopperState =
  | "browsing"
  | "focused_intent"
  | "hesitating"
  | "outfit_seeking"
  | "price_sensitive"
  | "decision_ready"
  | "overwhelmed"
  | "style_conscious"
  | "trust_low";

export type MiraMode =
  | "stay_quiet"
  | "light_guidance"
  | "product_explanation"
  | "outfit_completion"
  | "size_help"
  | "tryon_offer"
  | "comparison_help"
  | "closing"
  | "confidence_recovery";

export type ShopperStateResult = {
  state: ShopperState;
  confidence: number; // 0-1
  reasons: string[];
  suggestedMiraMode: MiraMode;
};

export type ShopperSignals = {
  pageType: "homepage" | "collection" | "pdp" | "cart" | "search" | "other";
  productId?: string;
  dwellMs: number; // time on current page
  scrollDepth: number; // 0-1
  imageScrollCount: number; // how many product images scrolled
  sizeChartOpened: boolean;
  variantSwitchCount: number; // how many times size/color switched
  cartItemCount: number;
  hasAddedToCart: boolean;
  tryOnCompleted: boolean;
  tryOnAbandoned: boolean;
  repeatViewCount: number; // times this product page visited this session
  filterChangeCount: number; // filter interactions this session
  productViewCount: number; // total products opened this session
  lastMiraDismissMs?: number; // ms since last Mira dismissal
  isInConversation: boolean;
  conversationTurnCount: number;
  priceFilterActive: boolean;
  searchQuery?: string;
  outfitAccepted: boolean;
  sizeSelected: boolean;
  checkoutInitiated: boolean;
};

// ─── Keyword lexicons ────────────────────────────────────────────────────────
const OUTFIT_PHRASES = ["goes with", "match", "outfit", "pair", "wear with"];
const PRICE_TERMS = ["cheap", "sale", "discount", "budget", "under"];
const STYLE_TERMS = [
  "classy",
  "elevated",
  "silhouette",
  "editorial",
  "premium",
  "clean look",
  "aesthetic",
];

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function lc(s?: string): string {
  return (s ?? "").toLowerCase();
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// A single state candidate produced by a detector.
type Candidate = {
  state: ShopperState;
  confidence: number;
  reasons: string[];
  mode: MiraMode;
};

// ─── Detectors ───────────────────────────────────────────────────────────────
// Each returns a Candidate (possibly confidence 0 = "did not fire"). The
// orchestrator picks the highest-confidence candidate.

function detectBrowsing(s: ShopperSignals): Candidate {
  const reasons: string[] = [];
  let c = 0;
  const fastPdp = s.pageType === "pdp" && s.dwellMs < 8000;
  const listingPage = s.pageType === "collection" || s.pageType === "homepage";
  if (fastPdp) {
    c += 0.3;
    reasons.push("fast PDP scan (<8s)");
  }
  if (listingPage) {
    c += 0.3;
    reasons.push(`on ${s.pageType}`);
  }
  if (s.imageScrollCount < 2) {
    c += 0.15;
    reasons.push("low image engagement");
  }
  if (s.productViewCount > 5) {
    c += 0.25;
    reasons.push(`${s.productViewCount} products skimmed`);
  }
  // Early homepage/collection visitor with no product engagement → stay quiet.
  // Mira should not interrupt a shopper who has just arrived.
  const earlyVisitor =
    listingPage &&
    s.productViewCount === 0 &&
    s.dwellMs < 5000 &&
    s.cartItemCount === 0;
  const mode: MiraMode = earlyVisitor ? "stay_quiet" : "light_guidance";
  return {
    state: "browsing",
    confidence: clamp01(c),
    reasons,
    mode,
  };
}

function detectFocusedIntent(s: ShopperSignals): Candidate {
  const reasons: string[] = [];
  let c = 0;
  if (s.pageType === "pdp" && s.dwellMs > 20000) {
    c += 0.35;
    reasons.push("long PDP dwell (>20s)");
  }
  if (s.imageScrollCount >= 3) {
    c += 0.2;
    reasons.push("scrolled 3+ images");
  }
  if (s.sizeChartOpened && s.sizeSelected) {
    // Opened AND committed a size = focused, not hesitating
    c += 0.15;
    reasons.push("used size chart to choose");
  }
  // Note: sizeChartOpened without sizeSelected is a hesitation signal,
  // not a focus signal — don't add to focusedIntent in that case.
  if (s.variantSwitchCount > 0) {
    c += 0.15;
    reasons.push(`switched variant ${s.variantSwitchCount}x`);
  }
  if (s.repeatViewCount >= 2) {
    c += 0.2;
    reasons.push(`returned to this PDP ${s.repeatViewCount}x`);
  }
  // Require the dwell anchor OR a repeat view — engagement, not a glance.
  const anchored =
    (s.pageType === "pdp" && s.dwellMs > 20000) || s.repeatViewCount >= 2;
  if (!anchored) c = 0;
  return {
    state: "focused_intent",
    confidence: clamp01(c),
    reasons,
    mode: "product_explanation",
  };
}

function detectHesitating(s: ShopperSignals): Candidate {
  const reasons: string[] = [];
  let c = 0;
  if (s.dwellMs > 30000 && !s.hasAddedToCart && s.cartItemCount === 0) {
    c += 0.3;
    reasons.push("30s+ with no cart action");
  }
  if (s.sizeChartOpened && !s.sizeSelected) {
    c += 0.3;
    reasons.push("opened size chart, no size chosen");
  }
  if (s.tryOnAbandoned) {
    // Abandoning after try-on is a strong hesitation signal — boost to 0.45
    // so it beats a basic focusedIntent (dwell>20s alone = 0.35).
    c += 0.45;
    reasons.push("abandoned try-on");
  }
  if (s.variantSwitchCount > 2) {
    c += 0.2;
    reasons.push(`flipped variants ${s.variantSwitchCount}x`);
  }
  return {
    state: "hesitating",
    confidence: clamp01(c),
    reasons,
    mode: s.sizeChartOpened ? "size_help" : "confidence_recovery",
  };
}

function detectOutfitSeeking(s: ShopperSignals): Candidate {
  const reasons: string[] = [];
  let c = 0;
  const q = lc(s.searchQuery);
  const askedOutfit =
    s.conversationTurnCount > 0 && containsAny(q, OUTFIT_PHRASES);
  if (askedOutfit) {
    c += 0.55;
    reasons.push("asked how to pair/match it");
  }
  if (s.cartItemCount === 1 && s.productViewCount > 3) {
    c += 0.45;
    reasons.push("one item in cart, still browsing");
  }
  return {
    state: "outfit_seeking",
    confidence: clamp01(c),
    reasons,
    mode: "outfit_completion",
  };
}

function detectPriceSensitive(s: ShopperSignals): Candidate {
  const reasons: string[] = [];
  let c = 0;
  if (s.priceFilterActive) {
    c += 0.45;
    reasons.push("price filter active");
  }
  if (containsAny(lc(s.searchQuery), PRICE_TERMS)) {
    c += 0.45;
    reasons.push("price-led query");
  }
  // Cart had an item but it was undone (count back to 0 after an add).
  if (s.cartItemCount === 0 && !s.hasAddedToCart && s.variantSwitchCount > 0) {
    c += 0.15;
    reasons.push("considered but didn't add");
  }
  return {
    state: "price_sensitive",
    confidence: clamp01(c),
    reasons,
    mode: "light_guidance",
  };
}

function detectDecisionReady(s: ShopperSignals): Candidate {
  const reasons: string[] = [];
  let c = 0;
  if (s.checkoutInitiated) {
    // Already heading to checkout — strong, but the trigger engine will
    // suppress on checkoutInitiated. State is still honest.
    reasons.push("checkout initiated");
    c += 0.6;
  }
  const commitment = s.sizeSelected || s.outfitAccepted || s.tryOnCompleted;
  if (commitment && s.dwellMs > 15000 && s.cartItemCount < 2) {
    c += 0.5;
    if (s.sizeSelected) reasons.push("size selected");
    if (s.outfitAccepted) reasons.push("outfit accepted");
    if (s.tryOnCompleted) reasons.push("completed try-on");
  }
  return {
    state: "decision_ready",
    confidence: clamp01(c),
    reasons,
    mode: "closing",
  };
}

function detectOverwhelmed(s: ShopperSignals): Candidate {
  const reasons: string[] = [];
  let c = 0;
  if (s.productViewCount > 8) {
    c += 0.4;
    reasons.push(`${s.productViewCount} products opened`);
  }
  if (s.filterChangeCount > 5) {
    c += 0.35;
    reasons.push(`${s.filterChangeCount} filter changes`);
  }
  if (s.conversationTurnCount > 6 && !s.hasAddedToCart && s.cartItemCount === 0) {
    c += 0.3;
    reasons.push("long conversation, nothing in cart");
  }
  return {
    state: "overwhelmed",
    confidence: clamp01(c),
    reasons,
    mode: "comparison_help",
  };
}

function detectStyleConscious(s: ShopperSignals): Candidate {
  const reasons: string[] = [];
  let c = 0;
  if (containsAny(lc(s.searchQuery), STYLE_TERMS)) {
    c += 0.5;
    reasons.push("style-led language");
  }
  if (s.outfitAccepted) {
    c += 0.3;
    reasons.push("accepted a styled look");
  }
  return {
    state: "style_conscious",
    confidence: clamp01(c),
    reasons,
    mode: "outfit_completion",
  };
}

function detectTrustLow(s: ShopperSignals): Candidate {
  const reasons: string[] = [];
  let c = 0;
  if (s.tryOnAbandoned && s.tryOnCompleted) {
    c += 0.4;
    reasons.push("abandoned after completing a try-on");
  }
  if (s.repeatViewCount > 3 && s.cartItemCount === 0 && !s.hasAddedToCart) {
    c += 0.35;
    reasons.push(`returned ${s.repeatViewCount}x, never added`);
  }
  if (s.dwellMs > 60000 && s.cartItemCount === 0 && !s.hasAddedToCart) {
    c += 0.3;
    reasons.push("60s+ studying, no commitment");
  }
  return {
    state: "trust_low",
    confidence: clamp01(c),
    reasons,
    mode: "confidence_recovery",
  };
}

const DETECTORS: Array<(s: ShopperSignals) => Candidate> = [
  detectDecisionReady,
  detectTrustLow,
  detectHesitating,
  detectOutfitSeeking,
  detectOverwhelmed,
  detectStyleConscious,
  detectPriceSensitive,
  detectFocusedIntent,
  detectBrowsing,
];

/**
 * Infer the shopper's current behavioral state from observable signals.
 * Returns the highest-confidence candidate. Pure + deterministic.
 */
export function inferShopperState(signals: ShopperSignals): ShopperStateResult {
  let best: Candidate = {
    state: "browsing",
    confidence: 0,
    reasons: [],
    mode: "stay_quiet",
  };

  for (const detect of DETECTORS) {
    const cand = detect(signals);
    // Strict-greater keeps the DETECTORS priority order as the tie-breaker.
    if (cand.confidence > best.confidence) best = cand;
  }

  // Nothing fired with any confidence — Mira stays quiet.
  if (best.confidence <= 0) {
    return {
      state: "browsing",
      confidence: 0,
      reasons: ["no strong behavioral signal"],
      suggestedMiraMode: "stay_quiet",
    };
  }

  return {
    state: best.state,
    confidence: Number(best.confidence.toFixed(2)),
    reasons: best.reasons,
    suggestedMiraMode: best.mode,
  };
}

/** One-sentence summary of the signals for logging. */
export function getStateSummary(signals: ShopperSignals): string {
  const r = inferShopperState(signals);
  const where =
    signals.pageType === "pdp" && signals.productId
      ? `PDP ${signals.productId}`
      : signals.pageType;
  return `Shopper is ${r.state} (${Math.round(
    r.confidence * 100,
  )}%) on ${where} — ${r.reasons[0] ?? "no signal"} → Mira: ${r.suggestedMiraMode}`;
}
