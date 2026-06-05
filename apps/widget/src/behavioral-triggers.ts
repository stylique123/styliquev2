// Stylique Behavioral Trigger Engine — combines inferred shopper state +
// context to decide whether and HOW Mira should intervene.
//
// Pure, deterministic, no DOM / fetch / async. Suppression is STRICT — Mira
// must stay quiet whenever the inference isn't sure or the moment is wrong
// (in conversation, in checkout, on the cart page, recently dismissed, etc).
//
// Every fired trigger maps to exactly ONE tool (or no tool for guidance), with
// a short suggested message (max ~25 words), an urgency score, and a per-type
// cooldown.

import type { ShopperState, ShopperStateResult, ShopperSignals } from "./shopper-state.js";

export type TriggerType =
  | "guidance"
  | "product_explanation"
  | "size_help"
  | "outfit_completion"
  | "tryon_offer"
  | "comparison_help"
  | "closing"
  | "catalog_gap"
  | "confidence_recovery";

export type TriggerTool =
  | "explain_product"
  | "complete_outfit"
  | "offer_tryon_natural"
  | "capture_hesitation"
  | "close_sale"
  | "capture_unmet_demand";

export type TriggerDecision = {
  shouldTrigger: boolean;
  triggerType?: TriggerType;
  shopperState: ShopperState;
  confidence: number;
  urgency: number; // 0-1
  cooldownMs: number; // how long before the next trigger is allowed
  reason: string;
  suggestedMessage: string;
  suppressionReason?: string;
  requiredTool?: TriggerTool;
};

export type TriggerHistory = {
  lastTriggerMs: number; // ms since the last trigger fired
  lastTriggerType?: string;
  dismissCount: number;
  totalTriggers: number;
};

const COOLDOWN_DEFAULT = 90_000;
const COOLDOWN_LONG = 120_000; // closing / tryon_offer

// Per-state urgency.
function urgencyFor(state: ShopperState): number {
  switch (state) {
    case "decision_ready":
    case "hesitating":
      return 0.8;
    case "trust_low":
    case "outfit_seeking":
      return 0.6;
    default:
      return 0.4;
  }
}

function cooldownFor(type: TriggerType): number {
  return type === "closing" || type === "tryon_offer"
    ? COOLDOWN_LONG
    : COOLDOWN_DEFAULT;
}

type Mapping = {
  triggerType: TriggerType;
  requiredTool?: TriggerTool;
  suggestedMessage: string;
  reason: string;
};

// Map an inferred state (+ signals) to the intervention. Returns null when the
// state has no intervention worth firing.
function mapStateToTrigger(
  state: ShopperStateResult,
  signals: ShopperSignals,
): Mapping | null {
  switch (state.state) {
    case "focused_intent":
      if (state.confidence > 0.6) {
        return {
          triggerType: "product_explanation",
          requiredTool: "explain_product",
          suggestedMessage:
            "This one looks close. I can explain the fit, suggest the right size, or style it into a complete look.",
          reason: "focused intent on a single piece",
        };
      }
      return null;

    case "hesitating":
      if (signals.sizeChartOpened) {
        return {
          triggerType: "size_help",
          requiredTool: "capture_hesitation",
          suggestedMessage:
            "Still figuring out the size? I can help — takes 30 seconds.",
          reason: "hesitating on size",
        };
      }
      if (signals.tryOnAbandoned) {
        return {
          triggerType: "tryon_offer",
          requiredTool: "offer_tryon_natural",
          suggestedMessage:
            "Not quite right in the preview? I can show a different model or a closer size.",
          reason: "hesitating after try-on",
        };
      }
      return {
        triggerType: "confidence_recovery",
        requiredTool: "capture_hesitation",
        suggestedMessage:
          "Want a second opinion? I can tell you honestly whether this is the right call.",
        reason: "general hesitation",
      };

    case "outfit_seeking":
      return {
        triggerType: "outfit_completion",
        requiredTool: "complete_outfit",
        suggestedMessage:
          "I can build the full look around this piece — not just similar items, an actual outfit.",
        reason: "shopper wants the full look",
      };

    case "decision_ready":
      return {
        triggerType: "closing",
        requiredTool: "close_sale",
        suggestedMessage:
          "This looks like your strongest match. Want me to add the piece, or the full outfit?",
        reason: "shopper is ready to decide",
      };

    case "overwhelmed":
      return {
        triggerType: "comparison_help",
        requiredTool: "explain_product",
        suggestedMessage:
          "You've looked through a lot. I can narrow this to the two strongest options.",
        reason: "too many options viewed",
      };

    case "trust_low":
      return {
        triggerType: "confidence_recovery",
        requiredTool: "capture_hesitation",
        suggestedMessage:
          "The main question is whether it fits right. I can help clarify without you having to guess.",
        reason: "low trust, fit uncertainty",
      };

    case "price_sensitive":
      return {
        triggerType: "guidance",
        requiredTool: "close_sale",
        suggestedMessage:
          "I'll keep the recommendations under budget and prioritize the most versatile pieces first.",
        reason: "price-conscious shopper",
      };

    case "browsing":
      // Only open on a short session — a quiet narrowing offer, low urgency.
      return {
        triggerType: "guidance",
        requiredTool: undefined,
        suggestedMessage:
          "Want help narrowing this by occasion, color, or budget?",
        reason: "early browsing",
      };

    case "style_conscious":
      return {
        triggerType: "outfit_completion",
        requiredTool: "complete_outfit",
        suggestedMessage:
          "I can pull a look with the silhouette and palette you're going for.",
        reason: "style-led shopper",
      };

    default:
      return null;
  }
}

/**
 * Decide whether and how Mira should intervene. STRICT suppression first, then
 * map the inferred state to a single trigger + tool.
 */
export function decideTrigger(
  state: ShopperStateResult,
  signals: ShopperSignals,
  history: TriggerHistory,
): TriggerDecision {
  const base = {
    shopperState: state.state,
    confidence: state.confidence,
    urgency: urgencyFor(state.state),
    cooldownMs: COOLDOWN_DEFAULT,
    reason: state.reasons[0] ?? "no signal",
    suggestedMessage: "",
  };

  const suppress = (suppressionReason: string): TriggerDecision => ({
    ...base,
    shouldTrigger: false,
    suppressionReason,
  });

  // ─── STRICT suppression rules ──────────────────────────────────────────────
  if (signals.isInConversation) return suppress("already in conversation");
  if (signals.checkoutInitiated) return suppress("checkout in progress");
  if (signals.pageType === "cart") return suppress("on cart page");
  if (history.lastTriggerMs < 90_000) return suppress("global 90s cooldown");
  if (history.dismissCount >= 2 && history.lastTriggerMs < 300_000) {
    return suppress("dismissal penalty (5 min)");
  }
  if (state.confidence < 0.4) return suppress("confidence below threshold");
  if (state.suggestedMiraMode === "stay_quiet") return suppress("state says stay quiet");

  // ─── Map to a trigger ──────────────────────────────────────────────────────
  const mapping = mapStateToTrigger(state, signals);
  if (!mapping) return suppress("state has no actionable trigger");

  const cooldownMs = cooldownFor(mapping.triggerType);

  return {
    ...base,
    shouldTrigger: true,
    triggerType: mapping.triggerType,
    requiredTool: mapping.requiredTool,
    suggestedMessage: mapping.suggestedMessage,
    reason: mapping.reason,
    cooldownMs,
  };
}
