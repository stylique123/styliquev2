// ─── Mira support hooks (Step 2H Phase 2 / P2-T10,T11,T12) ───────────────────
// Mira can HELP with support without AUTOMATING it. She answers return/shipping
// policy ONLY from the real store policy (never invented), captures the support
// intent as an event for the merchant, and hands off safely — she never mutates
// an order, processes a return/exchange, or claims a ticket/human reply that
// didn't happen. Pure + deterministic.

import type { BrandIdentity } from "./system.js";

// ── Support intents (P2-T11) ─────────────────────────────────────────────────
export const SUPPORT_INTENTS = [
  "return_policy",
  "exchange_policy",
  "shipping_policy",
  "order_status",
  "order_problem",
  "return_request",
  "exchange_request",
  "fit_feedback",
  "complaint",
  "human_handoff",
] as const;
export type SupportIntent = (typeof SUPPORT_INTENTS)[number];

const SI = {
  human_handoff: /\b(speak to|talk to|real person|human|agent|representative|customer service|contact you|email (you|someone)|call (you|someone))\b/i,
  order_status: /\b(order status|where.?s my order|track(ing)?|has my order shipped|when will (it|my order) (arrive|ship)|delivery date)\b/i,
  // A reported problem WITH AN ORDER (not styling) — must hand off, never sell.
  order_problem: /\b(order (issue|problem|help)|issue with (my|the|an) order|problem with (my|the|an) order|something.?s wrong with (my|the) order|my order (is|has|hasn.?t|didn.?t|never)|wrong (size|item|colour|color) (arrived|came)|missing (item|piece))\b/i,
  return_request: /\b(i want to return|how do i return|start a return|return this|send (it|this) back|return my order)\b/i,
  exchange_request: /\b(i want to exchange|how do i exchange|swap (it|this)|exchange this|different size instead)\b/i,
  return_policy: /\b(return policy|can i return|returnable|refund policy|do you (accept|take) returns|how long.* return)\b/i,
  exchange_policy: /\b(exchange policy|can i exchange|do you (do|accept|offer) exchanges)\b/i,
  shipping_policy: /\b(shipping (policy|cost|time)|delivery (policy|time|cost)|how long.* (ship|deliver)|do you ship|free shipping|when will it ship)\b/i,
  fit_feedback: /\b(ran (small|large|big)|didn.?t fit|too (small|big|tight|loose) when it arrived|sizing was off)\b/i,
  complaint: /\b(complaint|disappointed|terrible|awful|broken|damaged|defective|wrong item|not what i ordered|unhappy|refund me)\b/i,
};

export function classifySupportIntent(message: string): SupportIntent | null {
  const m = message.toLowerCase();
  // Order matters: specific requests/actions before generic policy questions.
  if (SI.human_handoff.test(m)) return "human_handoff";
  if (SI.return_request.test(m)) return "return_request";
  if (SI.exchange_request.test(m)) return "exchange_request";
  if (SI.order_problem.test(m)) return "order_problem";
  if (SI.order_status.test(m)) return "order_status";
  if (SI.complaint.test(m)) return "complaint";
  if (SI.fit_feedback.test(m)) return "fit_feedback";
  if (SI.return_policy.test(m)) return "return_policy";
  if (SI.exchange_policy.test(m)) return "exchange_policy";
  if (SI.shipping_policy.test(m)) return "shipping_policy";
  return null;
}

// Which support intents are POLICY questions (answerable from a source) vs which
// require a handoff / non-automated path. Order mutation is NEVER automated.
export function supportNeedsHandoff(intent: SupportIntent): boolean {
  return (
    intent === "human_handoff" ||
    intent === "order_status" ||      // we don't expose order lookup in V1
    intent === "order_problem" ||     // a reported order problem → straight to the team
    intent === "return_request" ||    // do NOT process returns
    intent === "exchange_request" ||  // do NOT process exchanges
    intent === "complaint"
  );
}

// ── Policy grounding (P2-T10) ────────────────────────────────────────────────
// Answer return/shipping/exchange policy ONLY from the real store policy. The
// source is the merchant's injectedBrand.returns / .shipping (synthesized from
// BrandProfile server-side); the demo passes its known Stylique Maison policy.
// If there is no source for the asked policy → return null so the caller refuses
// honestly + offers handoff. NEVER invent a window, percentage, or rule.
export interface PolicyAnswer {
  text: string;
  source: "merchant_brand_policy" | "demo_default_policy";
  intent: SupportIntent;
}

// The demo's authoritative policy (matches the hardcoded 14-day card + the
// returns route copy). Production merchants override via injectedBrand.
const DEMO_RETURNS = "Returns are accepted within 14 days when items are unworn and in their original packaging.";
const DEMO_SHIPPING = "Standard shipping is 3–5 business days; you'll get a tracking link by email once it ships.";

export function groundPolicyAnswer(
  intent: SupportIntent,
  brand: BrandIdentity | undefined,
  isDemo: boolean,
): PolicyAnswer | null {
  const hasMerchantReturns = !!brand?.returns && brand.returns.trim().length > 0;
  const hasMerchantShipping = !!brand?.shipping && brand.shipping.trim().length > 0;

  if (intent === "return_policy" || intent === "exchange_policy" || intent === "return_request" || intent === "exchange_request") {
    if (hasMerchantReturns) return { text: brand!.returns!.trim(), source: "merchant_brand_policy", intent };
    if (isDemo) return { text: DEMO_RETURNS, source: "demo_default_policy", intent };
    return null; // no real source → refuse + handoff
  }
  if (intent === "shipping_policy") {
    if (hasMerchantShipping) return { text: brand!.shipping!.trim(), source: "merchant_brand_policy", intent };
    if (isDemo) return { text: DEMO_SHIPPING, source: "demo_default_policy", intent };
    return null;
  }
  // order_status / fit_feedback / complaint / human_handoff are not policy answers.
  return null;
}

// ── Safe handoff (P2-T12) ────────────────────────────────────────────────────
// Captures the shopper's session + product + a short issue summary so the
// merchant's human support has context. It does NOT create a ticket, mutate an
// order, or promise a human reply time — the voice the brain speaks is an OFFER
// to connect, not a claim that a human is on the line.
export interface SafeHandoff {
  reason: SupportIntent;
  productHandle: string | null;
  issueSummary: string;
  // Honest voice — no fake ticket, no promised SLA unless a merchant configures one.
  voice: string;
}

export function buildSafeHandoff(
  intent: SupportIntent,
  message: string,
  currentProductHandle: string | null,
): SafeHandoff {
  const summary = message.slice(0, 200);
  const reasonLine: Record<SupportIntent, string> = {
    human_handoff: "I'll pass you to the store's team — they can pick this up directly.",
    order_status: "I can't look up live order status here, but the store's team can — I'll flag it for them.",
    order_problem: "Let me get the store's team onto your order — they can sort this directly. Want me to connect you?",
    return_request: "I can't process the return myself, but I'll hand this to the store's team to set up.",
    exchange_request: "I can't run the exchange here, but the store's team can sort it — I'll flag it.",
    complaint: "I'm sorry this fell short. I'll make sure the store's team sees this.",
    fit_feedback: "Thanks for the fit note — I'll pass it to the store's team so they can help.",
    return_policy: "Let me get the store's team to confirm the details for your order.",
    exchange_policy: "Let me get the store's team to confirm the exchange details for your order.",
    shipping_policy: "Let me get the store's team to confirm shipping for your order.",
  };
  return {
    reason: intent,
    productHandle: currentProductHandle,
    issueSummary: summary,
    voice: reasonLine[intent],
  };
}
