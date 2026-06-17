// ─── Mira sales planner (Step 2H Phase 2 / P2-T01,T02) ───────────────────────
// Mira must behave like a fashion sales associate, not a turn-by-turn chatbot.
// This module makes the funnel EXPLICIT: a deterministic planner classifies the
// shopper's funnel stage + intent every turn and declares the next sales move,
// the allowed actions, the forbidden actions, and whether the move's success
// must be verified before Mira can claim it. It also tracks a server-side
// SessionObjective so the brain reasons about where the shopper is, not just the
// last message.
//
// This is pure + deterministic (no LLM, no I/O). It runs ALONGSIDE the one brain
// (decideMira) — it never replaces it. The brain still writes the voice/card; the
// planner declares the rails and the router/verify layers enforce them.

import type { MiraDecision, MiraBody } from "./schemas.js";
import type { MiraProduct } from "./products.js";

// ── Funnel stages (where the shopper is) ─────────────────────────────────────
export const FUNNEL_STAGES = [
  "browsing",
  "product_interest",
  "comparison",
  "sizing_help",
  "tryon_consideration",
  "outfit_building",
  "cart_intent",
  "objection_handling",
  "support_intent",
  "handoff",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// ── Sales moves (the next thing Mira does) ───────────────────────────────────
export const SALES_MOVES = [
  "recommend_product",
  "explain_product",
  "compare_products",
  "offer_size_help",
  "offer_tryon",
  "complete_outfit",
  "add_to_cart_assist",
  "capture_hesitation",
  "answer_policy_from_source",
  "safe_handoff",
] as const;
export type SalesMove = (typeof SALES_MOVES)[number];

// ── The whitelisted action a move resolves to (router executes only these) ───
export const WHITELISTED_ACTIONS = [
  "product_recommendation",
  "product_explanation",
  "product_comparison",
  "size_help_start",
  "tryon_offer",
  "outfit_completion",
  "add_to_cart_assist",
  "hesitation_capture",
  "policy_answer",
  "support_intent_capture",
  "safe_handoff",
] as const;
export type WhitelistedAction = (typeof WHITELISTED_ACTIONS)[number];

// Hard boundaries — things Mira must NEVER do, regardless of stage. The router +
// verify layers enforce these; the planner names them so they are explicit.
export const GLOBAL_FORBIDDEN = [
  "fake_cart_success",
  "fake_stock",
  "fake_discount",
  "unsupported_policy_answer",
  "invented_product",
  "auto_return_or_exchange",
  "order_mutation",
  "company_brain_or_strategy_claim",
] as const;
export type ForbiddenAction = (typeof GLOBAL_FORBIDDEN)[number];

export interface TurnPlan {
  funnelStage: FunnelStage;
  intent: string;            // mirrors the brain's INTENTS vocabulary
  nextMove: SalesMove;
  actionType: WhitelistedAction;
  allowedActions: WhitelistedAction[];
  forbiddenActions: ForbiddenAction[];
  verificationRequired: boolean;
}

// The server-side objective — the running understanding of the session. New
// session = empty. Shop-scoped + session-scoped by construction (the caller
// persists it keyed by shopperSession; the brain never stores it itself).
export interface SessionObjective {
  pageContext: "pdp" | "browse";
  currentProductHandle: string | null;
  shopperIntent: string;
  funnelStage: FunnelStage;
  lastRecommendedHandle: string | null;
  rejectedHandles: string[];        // pieces the shopper turned down
  lastRejectionReason: "price" | "style" | "fit" | "color" | "generic" | null;
  nextBestMove: SalesMove;
  turnCount: number;
}

export function emptyObjective(): SessionObjective {
  return {
    pageContext: "browse",
    currentProductHandle: null,
    shopperIntent: "discover",
    funnelStage: "browsing",
    lastRecommendedHandle: null,
    rejectedHandles: [],
    lastRejectionReason: null,
    nextBestMove: "recommend_product",
    turnCount: 0,
  };
}

// ── Lightweight intent + stage classifier (deterministic, message-driven) ────
// Mirrors the brain's INTENTS but adds funnel-stage reasoning. The LLM still
// classifies `intent` on the decision; this is the independent rail so a drifted
// model decision can be checked against the deterministic plan.
const RX = {
  size: /\b(size|sizing|fit me|what.?s my size|measure|too (big|small|tight|loose))\b/i,
  tryon: /\b(try.?on|see it on|on a model|on me|fitting room|how (would|will|does) it look)\b/i,
  look: /\b(look|outfit|style this|goes with|pairs? with|complete the|what else|wear with)\b/i,
  cart: /\b(add|bag|buy|take it|checkout|purchase|i.?ll take|cart)\b/i,
  compare: /\b(compare|vs\.?|versus|difference between|which (is|one)|or the)\b/i,
  support: /\b(return|refund|exchange|shipping|delivery|order status|where.?s my order|track|policy|warranty|complaint)\b/i,
  handoff: /\b(speak to|talk to|human|agent|representative|customer service|contact|email you|call you)\b/i,
  price: /\b(price|cost|how much|cheaper|expensive|budget|afford|under \$?\d)\b/i,
  occasion: /\b(wedding|graduation|funeral|interview|dinner|party|evening|date|work|office|vacation|holiday|beach)\b/i,
  greeting: /^(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/i,
};

export function classifyIntent(message: string): string {
  const m = message.toLowerCase();
  if (RX.handoff.test(m)) return "support";
  if (RX.support.test(m)) return "support";
  if (RX.compare.test(m)) return "specific";
  if (RX.tryon.test(m)) return "try_on";
  if (RX.size.test(m)) return "size";
  if (RX.look.test(m)) return "look";
  if (RX.cart.test(m)) return "specific";
  if (RX.price.test(m)) return "price";
  if (RX.occasion.test(m)) return "occasion";
  if (RX.greeting.test(m) && message.trim().length < 24) return "greeting";
  return "discover";
}

// Map an intent + page context to the funnel stage + next sales move. This is
// the deterministic rail; the brain's actual route is checked against it by the
// router so a sell-route on a support turn (or vice-versa) is caught.
export function planTurn(body: MiraBody, _activeCatalog: MiraProduct[]): TurnPlan {
  const intent = classifyIntent(body.message);
  const onPdp = !!body.currentProductHandle;
  const m = body.message.toLowerCase();
  const wantsHandoff = RX.handoff.test(m);

  let funnelStage: FunnelStage;
  let nextMove: SalesMove;
  let actionType: WhitelistedAction;

  if (wantsHandoff) {
    funnelStage = "handoff";
    nextMove = "safe_handoff";
    actionType = "safe_handoff";
  } else if (intent === "support") {
    funnelStage = "support_intent";
    nextMove = "answer_policy_from_source";
    actionType = "policy_answer";
  } else if (RX.compare.test(m)) {
    funnelStage = "comparison";
    nextMove = "compare_products";
    actionType = "product_comparison";
  } else if (intent === "size") {
    funnelStage = "sizing_help";
    nextMove = "offer_size_help";
    actionType = "size_help_start";
  } else if (intent === "try_on") {
    funnelStage = "tryon_consideration";
    nextMove = "offer_tryon";
    actionType = "tryon_offer";
  } else if (intent === "look") {
    funnelStage = "outfit_building";
    nextMove = "complete_outfit";
    actionType = "outfit_completion";
  } else if (RX.cart.test(m)) {
    funnelStage = "cart_intent";
    nextMove = "add_to_cart_assist";
    actionType = "add_to_cart_assist";
  } else if (onPdp || intent === "specific" || intent === "occasion" || intent === "price") {
    funnelStage = "product_interest";
    nextMove = "recommend_product";
    actionType = "product_recommendation";
  } else {
    funnelStage = "browsing";
    nextMove = "recommend_product";
    actionType = "product_recommendation";
  }

  // Allowed actions per stage — a small, honest set. Forbidden is always global.
  const allowedByStage: Record<FunnelStage, WhitelistedAction[]> = {
    browsing: ["product_recommendation", "product_explanation", "hesitation_capture"],
    product_interest: ["product_recommendation", "product_explanation", "size_help_start", "tryon_offer", "outfit_completion", "add_to_cart_assist", "hesitation_capture"],
    comparison: ["product_comparison", "product_explanation", "product_recommendation"],
    sizing_help: ["size_help_start", "product_explanation", "tryon_offer"],
    tryon_consideration: ["tryon_offer", "size_help_start", "add_to_cart_assist"],
    outfit_building: ["outfit_completion", "add_to_cart_assist", "product_recommendation"],
    cart_intent: ["add_to_cart_assist", "outfit_completion"],
    objection_handling: ["product_recommendation", "product_explanation", "hesitation_capture"],
    support_intent: ["policy_answer", "support_intent_capture", "safe_handoff"],
    handoff: ["safe_handoff", "support_intent_capture"],
  };

  // Every planned move asserts a real fact (product existence, price, stock, a
  // cart result, a policy fact, a render, a handoff), so all require verification
  // before Mira may claim them. (Pure hesitation_capture — which makes no claim —
  // only arises from the router's fail-closed path, not from a planned move.)
  const verificationRequired = true;

  return {
    funnelStage,
    intent,
    nextMove,
    actionType,
    allowedActions: allowedByStage[funnelStage],
    forbiddenActions: [...GLOBAL_FORBIDDEN],
    verificationRequired,
  };
}

// ── Objective update (P2-T01) ────────────────────────────────────────────────
// Folds the just-completed turn into the running objective. The caller persists
// the returned object on the shopper's SESSION (session-scoped; never device-wide
// per Phase 1). A fresh session passes emptyObjective().
export function updateObjective(
  prev: SessionObjective,
  body: MiraBody,
  decision: MiraDecision,
  plan: TurnPlan,
  rejection: { rejected: boolean; reason: SessionObjective["lastRejectionReason"] },
): SessionObjective {
  const recommended = decision.productHandle ?? null;
  const rejectedHandles = [...prev.rejectedHandles];
  // A rejection turns the PREVIOUS recommendation down.
  if (rejection.rejected && prev.lastRecommendedHandle && !rejectedHandles.includes(prev.lastRecommendedHandle)) {
    rejectedHandles.push(prev.lastRecommendedHandle);
  }
  return {
    pageContext: body.currentProductHandle ? "pdp" : "browse",
    currentProductHandle: body.currentProductHandle ?? null,
    shopperIntent: plan.intent,
    funnelStage: plan.funnelStage,
    lastRecommendedHandle: recommended ?? prev.lastRecommendedHandle,
    rejectedHandles: rejectedHandles.slice(-12), // bound the memory
    lastRejectionReason: rejection.rejected ? rejection.reason : prev.lastRejectionReason,
    nextBestMove: plan.nextMove,
    turnCount: prev.turnCount + 1,
  };
}
