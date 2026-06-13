// ─── Mira brain — closing intelligence ───────────────────────────────────────
// extractSignals + decideClose + buildClosingContextBlock (+ types), ported
// VERBATIM from apps/web/lib/closing-intelligence.ts. Pure + self-contained
// (zero imports) — deterministic closing state from conversation signals. Now
// part of the package so it is no longer an injected seam.
/**
 * Mira Closing Intelligence Engine
 * ──────────────────────────────────
 * Deterministic, pure, no DOM/async. Reads conversation signals and returns:
 *   - the current ClosingState (how ready is this shopper to buy?)
 *   - the CloseType (which close technique fits?)
 *   - a concrete suggested message template
 *   - a boolean: should Mira attempt a close on this turn?
 *
 * The caller (route.ts buildPrompt) injects this into the system context so
 * the model knows exactly when and how to close without guessing.
 *
 * Design principle: Mira closes when the shopper has shown enough proof of
 * readiness. She NEVER closes on cold first contact and NEVER closes again
 * within 2 turns of a rejection. The engine tracks both signals.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ClosingState =
  | "not_ready"                  // no meaningful engagement yet
  | "warming"                    // interest shown, qualification in progress
  | "confidence_high"            // strong positive signals, no blocker
  | "decision_ready"             // explicit buy signal or outfit accepted
  | "hesitating_after_validation" // tried-on / sized / explained, still unsure
  | "post_tryon_ready"           // try-on completed, confidence window open
  | "cart_ready";                // item in cart, upsell or checkout moment

export type CloseType =
  | "none"           // don't close — too early or just rejected
  | "soft"           // "This is probably the safest choice from what you've been looking at."
  | "assumptive"     // "Should I add it in your size?"
  | "bundle"         // "The look works best together — want the full outfit or just this piece?"
  | "comparison"     // "Between the two, I'd go with X — the Y is the deciding factor."
  | "reassurance"    // "If the hesitation is mainly fit, Medium is the safer call." + "Want me to add it?"
  | "post_tryon";    // "Now that you've seen it on you, this is the moment — want me to add it?"

export type ClosingDecision = {
  state: ClosingState;
  closeType: CloseType;
  shouldClose: boolean;
  confidence: number;       // 0–1
  suggestedClose?: string;  // injected into the prompt as a closing template
  reason: string;           // one-line explanation for logging
};

export type ConversationSignals = {
  // Product + outfit state
  hasPdpProduct: boolean;
  sizeConfirmed: boolean;
  tryOnCompleted: boolean;
  tryOnAbandoned: boolean;
  outfitAccepted: boolean;
  outfitPiecesRecommended: number;
  priceObjectionMade: boolean;
  priceObjectionResolved: boolean;
  hesitationExpressed: boolean;
  hesitationResolved: boolean;
  // Conversation state
  turnsTotal: number;
  turnsSinceLastPositive: number;
  turnsSinceClose: number;     // how many turns since Mira last tried to close
  closingAttempts: number;     // total close attempts this session
  lastCloseRejected: boolean;  // shopper said no / "not yet" / "maybe later" within last 2 turns
  // Shopper intent signals
  shopperExpressedPositive: boolean;  // "I love it", "perfect", "exactly what I wanted"
  shopperExpressedCartIntent: boolean; // "add it", "I'll take it", "bag it"
  cartHasItems: boolean;
  cartItemCount: number;
  // Emotional signals
  validationSought: boolean;   // asked "does this look good?" / "is this right?"
  fearOfRegret: boolean;       // "I don't know if I'll wear it" / "is it practical?"
  luxuryExpectation: boolean;  // asked "is this worth it?" / "does this feel premium?"
};

// ── Signal extractors from conversation history ────────────────────────────

const POSITIVE_PATTERNS = [
  /i love (it|this|that)/i, /perfect/i, /exactly (what|right)/i,
  /yes[,.]?\s*(this|that|it)/i, /i('m| am) sold/i, /that('s| is) the one/i,
  /beautiful/i, /stunning/i, /this is (it|perfect|great)/i,
];

const CART_INTENT_PATTERNS = [
  /add (it|this|that)/i, /i('ll| will) take (it|this)/i, /bag (it|this)/i,
  /buy (it|this)/i, /i('m| am) getting (it|this)/i, /put it in/i,
];

const HESITATION_PATTERNS = [
  /not sure/i, /i don't know/i, /maybe/i, /unsure/i,
  /let me think/i, /i'm not convinced/i, /still deciding/i, /on the fence/i,
];

const HESITATION_RESOLVED_PATTERNS = [
  /ok (yes|fine|go ahead|let's|sure)/i, /that helps/i,
  /you've convinced me/i, /fair enough/i, /ok i'll/i,
];

const PRICE_OBJECTION_PATTERNS = [
  /too expensive/i, /too much/i, /can't afford/i, /out of my budget/i,
  /cheaper/i, /more affordable/i, /way too pricey/i,
];

const REJECTION_PATTERNS = [
  /not yet/i, /maybe later/i, /i'll think about it/i, /not today/i,
  /let me come back/i, /not right now/i, /still browsing/i,
];

const VALIDATION_PATTERNS = [
  /does (it|this) (look|suit|work)/i, /will this (suit|look)/i,
  /does this (look|work|fit)/i, /is it (right|good|ok)/i,
  /what do you think/i, /am i making the right choice/i,
];

const FEAR_PATTERNS = [
  /won't wear it/i, /will i wear it/i, /is it practical/i,
  /don't want to waste/i, /will i use it/i, /is it versatile/i,
];

const LUXURY_PATTERNS = [
  /worth it/i, /feel (premium|expensive|luxury)/i, /look (expensive|premium)/i,
  /is it (really|actually|genuinely) good/i, /quality/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((p) => p.test(lower));
}

/**
 * Extract conversation signals from the raw message history.
 * Called once per turn — cheap string ops only.
 */
export function extractSignals(
  history: { from: string; text: string }[],
  sizeConfirmed: boolean,
  tryOnCompleted: boolean,
  tryOnAbandoned: boolean,
  outfitAccepted: boolean,
  outfitPiecesRecommended: number,
  cartItemCount: number,
  hasPdpProduct: boolean,
): ConversationSignals {
  const userTurns = history.filter((h) => h.from === "user");
  const miraTurns = history.filter((h) => h.from === "mira");

  // Scan the full conversation for signals
  let hesitationExpressed = false;
  let hesitationResolved = false;
  let priceObjectionMade = false;
  let priceObjectionResolved = false;
  let shopperExpressedPositive = false;
  let shopperExpressedCartIntent = false;
  let lastCloseRejected = false;
  let validationSought = false;
  let fearOfRegret = false;
  let luxuryExpectation = false;
  let closingAttempts = 0;
  let turnsSinceLastPositive = userTurns.length;
  let turnsSinceClose = miraTurns.length;

  // Detect Mira close attempts (past tense — "should I add it", "want me to")
  const MIRA_CLOSE_RE = /should i add|want me to add|shall i add|add it in your/i;
  miraTurns.forEach((m, i) => {
    if (MIRA_CLOSE_RE.test(m.text)) {
      closingAttempts++;
      turnsSinceClose = miraTurns.length - 1 - i;
    }
  });

  userTurns.forEach((u, i) => {
    const t = u.text;
    if (matchesAny(t, HESITATION_PATTERNS)) hesitationExpressed = true;
    if (matchesAny(t, HESITATION_RESOLVED_PATTERNS)) hesitationResolved = true;
    if (matchesAny(t, PRICE_OBJECTION_PATTERNS)) priceObjectionMade = true;
    if (matchesAny(t, POSITIVE_PATTERNS)) { shopperExpressedPositive = true; turnsSinceLastPositive = userTurns.length - 1 - i; }
    if (matchesAny(t, CART_INTENT_PATTERNS)) shopperExpressedCartIntent = true;
    if (matchesAny(t, VALIDATION_PATTERNS)) validationSought = true;
    if (matchesAny(t, FEAR_PATTERNS)) fearOfRegret = true;
    if (matchesAny(t, LUXURY_PATTERNS)) luxuryExpectation = true;
    // Check if last 2 user turns contain a rejection
    if (i >= userTurns.length - 2 && matchesAny(t, REJECTION_PATTERNS)) lastCloseRejected = true;
  });

  // Price objection resolved if a price objection was made and later a positive appeared
  priceObjectionResolved = priceObjectionMade && shopperExpressedPositive && turnsSinceLastPositive < 3;

  return {
    hasPdpProduct,
    sizeConfirmed,
    tryOnCompleted,
    tryOnAbandoned,
    outfitAccepted,
    outfitPiecesRecommended,
    priceObjectionMade,
    priceObjectionResolved,
    hesitationExpressed,
    hesitationResolved,
    turnsTotal: history.length,
    turnsSinceLastPositive,
    turnsSinceClose,
    closingAttempts,
    lastCloseRejected,
    shopperExpressedPositive,
    shopperExpressedCartIntent,
    cartHasItems: cartItemCount > 0,
    cartItemCount,
    validationSought,
    fearOfRegret,
    luxuryExpectation,
  };
}

// ── Closing state detector ────────────────────────────────────────────────────

function detectClosingState(s: ConversationSignals): ClosingState {
  // Explicit cart intent → cart_ready
  if (s.shopperExpressedCartIntent) return "cart_ready";

  // Try-on completed without an immediate rejection → post_tryon_ready
  if (s.tryOnCompleted && !s.lastCloseRejected) return "post_tryon_ready";

  // Outfit accepted or size confirmed + positive signal → decision_ready
  if ((s.outfitAccepted || s.sizeConfirmed) && s.shopperExpressedPositive) return "decision_ready";

  // Strong positive in last 2 turns, no active hesitation → confidence_high
  if (s.shopperExpressedPositive && s.turnsSinceLastPositive <= 2 && !s.hesitationExpressed) return "confidence_high";

  // Hesitation expressed but validation/reassurance given and still on the fence
  if (s.hesitationExpressed && !s.hesitationResolved && s.turnsTotal >= 4) return "hesitating_after_validation";

  // Early-stage engagement — product context exists, some turns in
  if (s.hasPdpProduct && s.turnsTotal >= 2) return "warming";

  return "not_ready";
}

// ── Close type selector ───────────────────────────────────────────────────────

function selectCloseType(state: ClosingState, s: ConversationSignals): CloseType {
  // Never close if recently rejected or haven't warmed up
  if (state === "not_ready") return "none";
  if (s.lastCloseRejected && s.turnsSinceClose < 3) return "none";

  // Don't spam — if Mira has attempted 2+ closes, back off
  if (s.closingAttempts >= 2 && s.turnsSinceClose < 4) return "none";

  switch (state) {
    case "cart_ready":
      return "assumptive";

    case "post_tryon_ready":
      return "post_tryon";

    case "decision_ready":
      return s.outfitPiecesRecommended >= 2 ? "bundle" : "assumptive";

    case "confidence_high":
      return "soft";

    case "hesitating_after_validation":
      // If hesitation is price-related, offer the reassurance close
      if (s.priceObjectionMade && !s.priceObjectionResolved) return "none"; // wait for objection to resolve
      return "reassurance";

    case "warming":
      return "none"; // don't close yet — still qualifying

    default:
      return "none";
  }
}

// ── Message templates ─────────────────────────────────────────────────────────
// These are SUGGESTIONS injected into the prompt — Mira adapts them in her voice.
// Templates use simple tokens the model can slot real product/size data into.

const CLOSE_TEMPLATES: Record<CloseType, string> = {
  none:         "",
  soft:         "This is probably the safest choice from the ones you've been looking at.",
  assumptive:   "Should I add it in your size?",
  bundle:       "The look works best together — want the full outfit or just this piece?",
  comparison:   "Between the two, I'd go with [the one with stronger fit for their stated occasion] — [one concrete reason].",
  reassurance:  "If the hesitation is mainly [size/fit/price], [specific resolution]. Want me to add it?",
  post_tryon:   "Now that you've seen it on you — this is the point where most people either know it's right or move on. Want me to add it in your size?",
};

// ── Main export ───────────────────────────────────────────────────────────────

export function decideClose(
  signals: ConversationSignals,
): ClosingDecision {
  const state = detectClosingState(signals);
  const closeType = selectCloseType(state, signals);
  const shouldClose = closeType !== "none";

  // Confidence is a rough 0–1 signal for logging / prompt weighting
  const confidenceMap: Record<ClosingState, number> = {
    not_ready:                    0.05,
    warming:                      0.25,
    confidence_high:              0.65,
    decision_ready:               0.85,
    hesitating_after_validation:  0.45,
    post_tryon_ready:             0.90,
    cart_ready:                   0.95,
  };
  const confidence = confidenceMap[state] ?? 0;

  const reason = [
    `state=${state}`,
    signals.tryOnCompleted ? "tryon_done" : "",
    signals.sizeConfirmed ? "size_confirmed" : "",
    signals.shopperExpressedPositive ? "positive_expressed" : "",
    signals.hesitationExpressed && !signals.hesitationResolved ? "hesitation_unresolved" : "",
    signals.lastCloseRejected ? "last_close_rejected" : "",
    `attempts=${signals.closingAttempts}`,
  ].filter(Boolean).join(" | ");

  return {
    state,
    closeType,
    shouldClose,
    confidence,
    suggestedClose: shouldClose ? CLOSE_TEMPLATES[closeType] : undefined,
    reason,
  };
}

/**
 * Build the closing context block injected into buildPrompt().
 * Returns a short, precise instruction the model can act on immediately.
 */
export function buildClosingContextBlock(decision: ClosingDecision): string {
  if (!decision.shouldClose) {
    if (decision.state === "not_ready" || decision.state === "warming") return "";
    if (decision.state === "hesitating_after_validation") {
      return "CLOSING CONTEXT: Shopper is hesitating. Do NOT push to close. Ask what specifically is holding them back — then wait for the answer.";
    }
    return "";
  }
  return [
    `CLOSING CONTEXT (act on this now): State = ${decision.state}. Close type = ${decision.closeType}.`,
    `Suggested close: "${decision.suggestedClose}"`,
    "Adapt this into your natural voice. Keep it one sentence. Do not explain, just close.",
    `Confidence: ${Math.round(decision.confidence * 100)}%.`,
  ].join(" ");
}
