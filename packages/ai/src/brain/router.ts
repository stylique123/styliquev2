// Brain — AI routing layer.
//
// Decides WHICH model handles each turn, given the cheap classifier's verdict
// (classifier.ts) + the shopper's BrainContext. This is the cost lever: 70-80%
// of turns should land on the cheap provider; only genuinely complex turns —
// outfit composition, multi-constraint reasoning, vision — escalate to the
// strong provider.
//
// The router is OPTIONAL in the Brain. When it isn't wired, brain.ts behaves
// exactly as before. When it is, it returns a routing decision (provider +
// prompt variant + maxHops + a human-readable reason) that the Brain applies as
// overrides.
//
// Defensive contract: route() NEVER throws. If anything goes sideways, it
// returns the standard provider with the default variant — a safe middle path.

import type { ModelProvider, BrainContext } from "./types.js";
import type { ClassificationResult } from "./classifier.js";

export type RoutingTier = {
  cheap: ModelProvider;
  standard: ModelProvider;
  // Strong is optional — until a strong-reasoning model is configured
  // (ANTHROPIC_API_KEY / STRONG_MODEL_API_KEY), high-complexity turns fall back
  // to the standard provider.
  strong: ModelProvider | null;
};

export type RoutingDecision = {
  provider: ModelProvider;
  promptVariant: string;
  maxHops: number;
  reason: string;
};

// Turn index at which an engaged shopper gets promoted off the cheap path.
// Once the conversation is this deep AND the turn isn't casual chit-chat, the
// shopper has shown real intent — give them at least the standard model.
const ENGAGEMENT_PROMOTION_TURN = 4;

// Prompt-variant names the router selects. These must exist in
// BrainConfig.promptVariants (or the Brain falls back to "default").
const VARIANT_CONCISE = "concise";
const VARIANT_DEFAULT = "default";
const VARIANT_SALES_STYLIST = "sales_stylist";

export class BrainRouter {
  constructor(private readonly tiers: RoutingTier) {}

  /**
   * Decide the model + variant + hop budget for this turn.
   * Pure and synchronous. Never throws — defaults to standard on any surprise.
   */
  route(classification: ClassificationResult, ctx: BrainContext): RoutingDecision {
    try {
      return this.routeInner(classification, ctx);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[router] route failed, defaulting to standard:", (err as Error)?.message ?? err);
      return {
        provider: this.tiers.standard,
        promptVariant: VARIANT_DEFAULT,
        maxHops: 4,
        reason: "router_error_fallback_standard",
      };
    }
  }

  private routeInner(classification: ClassificationResult, ctx: BrainContext): RoutingDecision {
    const { complexity, intent, needsVision } = classification;

    // Effective complexity may be promoted below; track it so reasons stay honest.
    let effectiveComplexity = complexity;

    // ─── Engagement promotion ────────────────────────────────────────────
    // Deep into a non-casual conversation → the shopper is engaged. Bump a
    // "low" turn up to "medium" so we stop giving an invested shopper the
    // cheapest model. Turn count comes from recentHistory length.
    const turnCount = ctx.recentHistory?.length ?? 0;
    const engaged = turnCount >= ENGAGEMENT_PROMOTION_TURN && intent !== "casual";
    if (engaged && effectiveComplexity === "low") {
      effectiveComplexity = "medium";
    }

    // ─── Vision floor ────────────────────────────────────────────────────
    // Vision MUST run on a capable model — the cheap model may not handle
    // images well. Force standard-or-better. Strong if available + warranted.
    if (needsVision) {
      const provider = this.tiers.strong ?? this.tiers.standard;
      return this.withReason(
        provider,
        provider === this.tiers.strong ? VARIANT_SALES_STYLIST : VARIANT_DEFAULT,
        provider === this.tiers.strong ? 6 : 4,
        `vision_requires_capable_model (${provider.key})`,
      );
    }

    // ─── High complexity / heavy intents → strong ────────────────────────
    // Outfit composition and "complex" turns are exactly what the strong model
    // earns its cost on. Fall back to standard if no strong is configured.
    if (effectiveComplexity === "high" || intent === "outfit" || intent === "complex") {
      const provider = this.tiers.strong ?? this.tiers.standard;
      return this.withReason(
        provider,
        VARIANT_SALES_STYLIST,
        6,
        this.tiers.strong
          ? `high_complexity_or_heavy_intent (intent=${intent})`
          : `high_complexity_no_strong_fallback_standard (intent=${intent})`,
      );
    }

    // ─── Medium → standard ───────────────────────────────────────────────
    if (effectiveComplexity === "medium") {
      return this.withReason(
        this.tiers.standard,
        VARIANT_DEFAULT,
        4,
        engaged ? "medium_after_engagement_promotion" : "medium_complexity",
      );
    }

    // ─── Low → cheap (variant depends on tier) ───────────────────────────
    // STARTER shops get the concise variant on low-complexity turns — keeps
    // replies short + cheap and the hop budget tight. Everyone else gets the
    // default variant with a slightly larger hop budget.
    if (ctx.tier === "STARTER") {
      return this.withReason(
        this.tiers.cheap,
        VARIANT_CONCISE,
        2,
        "low_complexity_starter_concise",
      );
    }

    return this.withReason(
      this.tiers.cheap,
      VARIANT_DEFAULT,
      3,
      "low_complexity_default",
    );
  }

  /**
   * Quick pre-classifier heuristic: is this almost-certainly a casual greeting
   * that doesn't need a classifier call at all? Short, no question mark, no
   * product mention → likely "hi" / "thanks" / "ok". Cheap model.
   *
   * Callers may use this to skip the classifier entirely on obvious chit-chat.
   */
  shouldUseCheapModel(message: string): boolean {
    const trimmed = (message ?? "").trim();
    if (trimmed.length === 0) return true;
    const short = trimmed.length < 30;
    const noQuestion = !trimmed.includes("?");
    const noProductMention = !PRODUCT_HINT_RE.test(trimmed);
    return short && noQuestion && noProductMention;
  }

  private withReason(
    provider: ModelProvider,
    promptVariant: string,
    maxHops: number,
    reason: string,
  ): RoutingDecision {
    const decision: RoutingDecision = { provider, promptVariant, maxHops, reason };
    // Every routing decision is logged with its reason (server-side only).
    // eslint-disable-next-line no-console
    console.log(`[router] → ${provider.key}:${provider.defaultModel} variant=${promptVariant} hops=${maxHops} reason=${reason}`);
    return decision;
  }
}

// Loose product-vocabulary heuristic for shouldUseCheapModel. Not exhaustive —
// it only needs to catch the obvious "this is a product turn" case so we DON'T
// shortcut it to the cheap model.
const PRODUCT_HINT_RE =
  /\b(dress|shirt|top|trouser|pant|jean|jacket|coat|skirt|shoe|boot|heel|bag|size|fit|color|colour|wear|outfit|look|style|wedding|party|occasion|stock|available|cart|buy|price|cheap|expensive|linen|silk|cotton|wool|denim|cashmere)\b/i;
