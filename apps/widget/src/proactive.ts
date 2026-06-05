// Stylique Proactive Coordinator — decides when Mira speaks without being asked.
//
// Architecture mirrors production Rufus/COSMO patterns:
//   IntentEngine detects behavioral signals → ProactiveCoordinator evaluates
//   which trigger to fire → dispatches stylique:proactive-trigger event.
//
// Suppression rules (strict):
//   1. Global 2/session hard cap (sessionStorage "sq_proactive_count")
//   2. Shopper is currently typing (input has focus)
//   3. Permanent dismiss (localStorage "sq_proactive_dismissed" === "true")
//   4. Per-trigger cooldown
//   5. Already-fired trigger IDs (sessionStorage "sq_proactive_fired")
//   6. Already engaged — Mira has received a message this session (never
//      proactively interrupt a shopper who's already in a conversation)
//   7. Tier entitlement — a trigger only fires if its required tier feature
//      is enabled for this shop (proactive triggers are a Growth+/Ultimate
//      capability; the coordinator is told the entitlement once on boot)
//
// Every fire emits a MIRA_PROACTIVE_TRIGGERED analytics event (via the
// host stylist, which owns the shopper cookie + API base) carrying the
// trigger id + reason, so the brand can see which proactive openers convert.
//
// No npm deps — pure TypeScript.

import type { IntentEngine, IntentContext, IntentState } from "./intent.js";
import {
  inferShopperState,
  type ShopperSignals,
  type ShopperStateResult,
} from "./shopper-state.js";
import {
  decideTrigger,
  type TriggerDecision,
  type TriggerHistory,
} from "./behavioral-triggers.js";

// Tier on which a trigger becomes available. Mirrors the PlanTier ordering in
// @stylique/types — kept as a local literal so the widget bundle has no
// cross-package import. STARTER triggers fire for everyone; GROWTH/ULTIMATE
// gate on the entitlement passed to the coordinator.
export type ProactiveTier = "STARTER" | "GROWTH" | "ULTIMATE";

export type ProactiveTrigger = {
  id: string;
  message: string;
  intentRequired: IntentState;
  confidenceRequired: number;
  maxPerSession: number;
  cooldownMs: number;
  requiresComparedPair?: boolean;
  // Behavioral signal the trigger keys off (used as the event `reason` and to
  // gate triggers that need a specific signal present, not just an intent
  // state). Optional — older triggers rely purely on state + confidence.
  requiresSignal?: string;
  // Optional fixed delay before the trigger is allowed to fire after its
  // condition is first met. Some moments (size-chart open, post-tryon close)
  // read better with a brief pause rather than an instant interruption.
  delayMs?: number;
  // Minimum tier this trigger requires. Defaults to STARTER (always allowed).
  minTier?: ProactiveTier;
};

const SESSION_CAP = 2;
const CAP_KEY = "sq_proactive_count";
const FIRED_KEY = "sq_proactive_fired";       // JSON array of fired trigger IDs
const DISMISS_KEY = "sq_proactive_dismissed"; // "true" = never fire again
const LAST_FIRE_KEY = "sq_proactive_last_ts"; // timestamp of most-recent fire
const ENGAGED_KEY = "sq_proactive_engaged";   // "true" = shopper sent a message

function ssGet(key: string): string | null {
  try { return sessionStorage.getItem(key); }
  catch { return null; }
}
function ssSet(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); }
  catch { /* private mode */ }
}
function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function globalCount(): number {
  return Number(ssGet(CAP_KEY) ?? "0") || 0;
}
function bumpGlobalCount(): void {
  ssSet(CAP_KEY, String(globalCount() + 1));
  ssSet(LAST_FIRE_KEY, String(Date.now()));
}
function firedIds(): string[] {
  try { return JSON.parse(ssGet(FIRED_KEY) ?? "[]") as string[]; }
  catch { return []; }
}
function markFiredId(id: string): void {
  const ids = firedIds();
  if (!ids.includes(id)) ssSet(FIRED_KEY, JSON.stringify([...ids, id]));
}
function lastFireTs(): number {
  return Number(ssGet(LAST_FIRE_KEY) ?? "0") || 0;
}

// ─── Engagement guard ───────────────────────────────────────────────────────
// Once the shopper has sent Mira a message this session, proactive triggers
// must stay silent — they exist to OPEN a conversation, never to interrupt one
// that's already running. The host stylist calls markEngaged() on first send.
export function markEngaged(): void {
  ssSet(ENGAGED_KEY, "true");
}
export function isAlreadyEngaged(): boolean {
  return ssGet(ENGAGED_KEY) === "true";
}

// Intent state priority order — used to determine if current state meets minimum.
const STATE_ORDER: IntentState[] = ["BROWSING", "DISCOVERING", "CONSIDERING", "DECIDING", "CONVERTING"];
function stateAtLeast(current: IntentState, required: IntentState): boolean {
  return STATE_ORDER.indexOf(current) >= STATE_ORDER.indexOf(required);
}

// Tier ordering for entitlement gating.
const TIER_ORDER: ProactiveTier[] = ["STARTER", "GROWTH", "ULTIMATE"];
function tierAtLeast(current: ProactiveTier, required: ProactiveTier): boolean {
  return TIER_ORDER.indexOf(current) >= TIER_ORDER.indexOf(required);
}

// ─── Registered proactive triggers ─────────────────────────────────────────
// Evaluated in priority order — first matching trigger fires. The first four
// are the original triggers (preserved verbatim in behavior); the rest are the
// Mira sales-stylist upgrade additions, each keyed off a specific behavioral
// signal and gated on tier.
export const PROACTIVE_TRIGGERS: ProactiveTrigger[] = [
  {
    id: "return_visit_consider",
    message: "You're back — still thinking about this one? I can tell you what I honestly think.",
    intentRequired: "CONSIDERING",
    confidenceRequired: 0.55,
    maxPerSession: 1,
    cooldownMs: 30_000,
    minTier: "STARTER",
  },
  {
    id: "compare_break",
    message: "I see you going back and forth between these two. Want me to just tell you which one to get?",
    intentRequired: "CONSIDERING",
    confidenceRequired: 0.50,
    maxPerSession: 1,
    cooldownMs: 45_000,
    requiresComparedPair: true,
    minTier: "STARTER",
  },
  {
    id: "deciding_size_offer",
    message: "You've been looking at this for a bit. Want me to check your size and show you how it fits?",
    intentRequired: "DECIDING",
    confidenceRequired: 0.65,
    maxPerSession: 1,
    cooldownMs: 60_000,
    minTier: "GROWTH",
  },
  {
    id: "deciding_tryon_offer",
    message: "You've been here a while — should I just show you this on a model so you can decide?",
    intentRequired: "DECIDING",
    confidenceRequired: 0.70,
    maxPerSession: 1,
    cooldownMs: 90_000,
    minTier: "GROWTH",
  },

  // ─── Mira sales-stylist upgrade triggers ─────────────────────────────────
  {
    // Shopper opened the size chart on a PDP — a strong size-uncertainty
    // signal. Short delay so it lands after they've glanced at it.
    id: "pdp.size_chart_opened",
    message: "I can help you find the right size for this. Takes 30 seconds.",
    intentRequired: "CONSIDERING",
    confidenceRequired: 0.40,
    maxPerSession: 1,
    cooldownMs: 30_000,
    requiresSignal: "size_guide_click",
    delayMs: 3_000,
    minTier: "GROWTH",
  },
  {
    // Shopper scrolled through 3+ product images without adding to cart —
    // they're trying to picture it. Offer the visual / outfit help.
    id: "pdp.image_scroll",
    message: "Trying to picture how this looks? I can show it on a model or build an outfit around it.",
    intentRequired: "CONSIDERING",
    confidenceRequired: 0.45,
    maxPerSession: 1,
    cooldownMs: 45_000,
    requiresSignal: "image_zoom",
    minTier: "GROWTH",
  },
  {
    // One item in cart but no matching pieces — the complete-the-look opening.
    id: "cart.single_item",
    message: "You might want something to complete the look — want me to find a match?",
    intentRequired: "DECIDING",
    confidenceRequired: 0.50,
    maxPerSession: 1,
    cooldownMs: 60_000,
    minTier: "GROWTH",
  },
  {
    // Same product viewed a second time this session — they keep coming back.
    id: "pdp.repeat_view",
    message: "Back again? I can help you decide — compare it, size it, or show it on a model.",
    intentRequired: "CONSIDERING",
    confidenceRequired: 0.50,
    maxPerSession: 1,
    cooldownMs: 45_000,
    requiresSignal: "return_visit",
    minTier: "GROWTH",
  },
  {
    // Shopper closed try-on without adding to cart — recover with adjacency.
    // Short delay so it follows the close naturally.
    id: "post_tryon_abandon",
    message: "Not quite right? I can show a similar cut or different color.",
    intentRequired: "CONSIDERING",
    confidenceRequired: 0.40,
    maxPerSession: 1,
    cooldownMs: 60_000,
    requiresSignal: "tryon_abandon",
    delayMs: 5_000,
    minTier: "ULTIMATE",
  },
];

export class ProactiveCoordinator {
  private engine: IntentEngine;
  private onTrigger: (trigger: ProactiveTrigger, context: IntentContext) => void;
  // Tier this shop is entitled to. Triggers above it are skipped. Defaults to
  // STARTER (most restrictive) until the host tells us otherwise.
  private tier: ProactiveTier = "STARTER";
  // Per-trigger "condition first met at" timestamps, used to honor delayMs.
  private armedAt: Record<string, number> = {};
  // Optional sink the host wires to fire the MIRA_PROACTIVE_TRIGGERED event.
  private onEvent?: (name: "MIRA_PROACTIVE_TRIGGERED", payload: Record<string, unknown>) => void;

  constructor(
    engine: IntentEngine,
    onTrigger: (trigger: ProactiveTrigger, context: IntentContext) => void,
    opts?: {
      tier?: ProactiveTier;
      onEvent?: (name: "MIRA_PROACTIVE_TRIGGERED", payload: Record<string, unknown>) => void;
    },
  ) {
    this.engine = engine;
    this.onTrigger = onTrigger;
    if (opts?.tier) this.tier = opts.tier;
    this.onEvent = opts?.onEvent;
  }

  /** Update the entitled tier after an async fetch (loadProactiveEntitlement). */
  setTier(tier: ProactiveTier): void {
    this.tier = tier;
  }

  /** Call after every signal fires. Evaluates all triggers in priority order. */
  evaluate(): void {
    // Suppress if permanently dismissed.
    if (lsGet(DISMISS_KEY) === "true") return;

    // Never interrupt a shopper who's already in a conversation with Mira.
    if (isAlreadyEngaged()) return;

    // Global session cap.
    if (globalCount() >= SESSION_CAP) return;

    // Shopper is currently typing — don't interrupt.
    if (this.isTyping()) return;

    const ctx = this.engine.getContext();
    const now = Date.now();

    for (const trigger of PROACTIVE_TRIGGERS) {
      if (!this.conditionMet(trigger, ctx)) {
        // Condition not (yet) met — clear any arm so delayMs restarts cleanly.
        delete this.armedAt[trigger.id];
        continue;
      }

      // Honor delayMs: arm on first met, fire only once enough time has passed.
      if (trigger.delayMs && trigger.delayMs > 0) {
        const armed = this.armedAt[trigger.id];
        if (armed === undefined) {
          this.armedAt[trigger.id] = now;
          continue; // come back on the next evaluate() once the delay elapses
        }
        if (now - armed < trigger.delayMs) continue;
      }

      this.markFired(trigger.id);
      bumpGlobalCount();
      this.emitTriggeredEvent(trigger, ctx);
      this.onTrigger(trigger, ctx);
      return; // fire at most one trigger per evaluate() call
    }
  }

  /**
   * Whether the given trigger's gating conditions are all satisfied. Split out
   * from the delay/arm logic so `evaluate()` can re-check it cheaply each tick.
   * Checks: already fired, tier entitlement, intent state, confidence, compared
   * pair, required signal, per-trigger cooldown.
   */
  conditionMet(trigger: ProactiveTrigger, ctx?: IntentContext): boolean {
    const context = ctx ?? this.engine.getContext();

    // Already fired in this session.
    if (firedIds().includes(trigger.id)) return false;

    // Tier entitlement.
    if (!tierAtLeast(this.tier, trigger.minTier ?? "STARTER")) return false;

    // Intent state threshold.
    if (!stateAtLeast(context.state, trigger.intentRequired)) return false;

    // Confidence threshold.
    if (context.confidenceScore < trigger.confidenceRequired) return false;

    // Compare-pair requirement.
    if (trigger.requiresComparedPair && !context.comparedPair) return false;

    // Required behavioral signal must be active this context.
    if (trigger.requiresSignal && !context.activeSignals.includes(trigger.requiresSignal as never)) {
      return false;
    }

    // Cooldown since last global fire.
    if (Date.now() - lastFireTs() < trigger.cooldownMs) return false;

    return true;
  }

  /**
   * Back-compat alias. Older call sites used `shouldFire`; it now delegates to
   * `conditionMet` (the delay arming lives in `evaluate`). Kept so nothing that
   * imported the old name breaks.
   */
  shouldFire(trigger: ProactiveTrigger, ctx?: IntentContext): boolean {
    return this.conditionMet(trigger, ctx);
  }

  /** Record a trigger as fired (prevents re-fire within session). */
  markFired(triggerId: string): void {
    markFiredId(triggerId);
  }

  /** Called from dismiss button — sets permanent local flag. */
  static permanentlyDismiss(): void {
    try { localStorage.setItem(DISMISS_KEY, "true"); }
    catch { /* private mode */ }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private emitTriggeredEvent(trigger: ProactiveTrigger, ctx: IntentContext): void {
    if (!this.onEvent) return;
    try {
      this.onEvent("MIRA_PROACTIVE_TRIGGERED", {
        triggerId: trigger.id,
        reason: trigger.requiresSignal ?? trigger.intentRequired.toLowerCase(),
        productId: ctx.currentPdpHandle ?? undefined,
        intentState: ctx.state,
        confidence: Number(ctx.confidenceScore.toFixed(2)),
      });
    } catch { /* analytics must never break a trigger */ }
  }

  private isTyping(): boolean {
    try {
      const focused = document.activeElement;
      if (!focused) return false;
      const tag = focused.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || (focused as HTMLElement).isContentEditable;
    } catch { return false; }
  }
}

// ─── Custom event type ──────────────────────────────────────────────────────
// StyliqueStylist listens for this and calls handleProactiveTrigger().
export interface ProactiveTriggerEvent extends CustomEvent {
  detail: {
    message: string;
    triggerId: string;
    intentContext: IntentContext;
  };
}

export function dispatchProactiveTrigger(
  trigger: ProactiveTrigger,
  context: IntentContext,
): void {
  try {
    document.dispatchEvent(
      new CustomEvent("stylique:proactive-trigger", {
        detail: {
          message: trigger.message,
          triggerId: trigger.id,
          intentContext: context,
        },
      }),
    );
  } catch { /* ignore */ }
}

// ─── Behavioral trigger layer (shopper-state → decideTrigger) ───────────────
// A second, richer evaluation path built on the deterministic ShopperState
// inference (shopper-state.ts) + decideTrigger engine (behavioral-triggers.ts).
// Unlike the IntentEngine/ProactiveCoordinator path above (which fires
// pre-canned PROACTIVE_TRIGGERS off intent state + signals), this reads the
// fuller behavioral signal struct, infers a shopper state, and asks the trigger
// engine whether and how Mira should intervene. The host wires the analytics
// sink so every decision — fired OR suppressed — is observable.

// Analytics sink for the behavioral layer. The host (stylist) supplies this so
// the widget bundle never imports the analytics client directly.
type BehavioralEventSink = (
  name:
    | "MIRA_BEHAVIORAL_TRIGGER_FIRED"
    | "MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED"
    | "MIRA_SHOPPER_STATE_DETECTED",
  payload: Record<string, unknown>,
) => void;

function emitBehavioralEvent(
  sink: BehavioralEventSink | undefined,
  name: Parameters<BehavioralEventSink>[0],
  payload: Record<string, unknown>,
): void {
  if (!sink) return;
  try {
    sink(name, payload);
  } catch {
    /* analytics must never break a trigger */
  }
}

/**
 * Evaluate the behavioral trigger path: infer the shopper state from the
 * signals, decide whether Mira should intervene, emit the matching analytics
 * event (FIRED or SUPPRESSED), and return the decision. Pure aside from the
 * analytics side-effect — the caller decides what to do with `shouldTrigger`.
 */
export function evaluateBehavioralTrigger(
  signals: ShopperSignals,
  history: TriggerHistory,
  onEvent?: BehavioralEventSink,
): TriggerDecision {
  const state: ShopperStateResult = inferShopperState(signals);
  const decision = decideTrigger(state, signals, history);

  const commonPayload = {
    shopperState: state.state,
    confidence: state.confidence,
    reasons: state.reasons,
    suggestedMiraMode: state.suggestedMiraMode,
    productId: signals.productId,
    cartItemCount: signals.cartItemCount,
    pageType: signals.pageType,
    urgency: decision.urgency,
  };

  if (decision.shouldTrigger) {
    emitBehavioralEvent(onEvent, "MIRA_BEHAVIORAL_TRIGGER_FIRED", {
      ...commonPayload,
      triggerType: decision.triggerType,
    });
  } else {
    emitBehavioralEvent(onEvent, "MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED", {
      ...commonPayload,
      suppressionReason: decision.suppressionReason,
    });
  }

  return decision;
}

/**
 * Build a ShopperSignals struct from the host widget's state object. Reads the
 * field names the widget already tracks (pageType / dwell / scroll wired in
 * wireIntentEmitters(); cart + conversation + fit state from the dock). Missing
 * fields default to the quiet/safe value so a partially-populated widget never
 * over-fires. `widget` is `any` because the widget custom element's shape lives
 * in index.ts/stylist.ts and isn't exported to this module.
 */
export function buildShopperSignals(widget: any): ShopperSignals {
  const w = widget ?? {};
  const num = (v: unknown, d = 0): number =>
    typeof v === "number" && !Number.isNaN(v) ? v : d;
  const bool = (v: unknown): boolean => v === true;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

  return {
    pageType: (str(w.pageType) as ShopperSignals["pageType"]) ?? "other",
    productId: str(w.currentProduct?.id) ?? str(w.productId),
    dwellMs: num(w.dwellMs ?? w.dwell),
    scrollDepth: num(w.scrollDepth),
    imageScrollCount: num(w.imageScrollCount),
    sizeChartOpened: bool(w.sizeChartOpened),
    variantSwitchCount: num(w.variantSwitchCount),
    cartItemCount: num(w.cartCount ?? w.cartItemCount),
    hasAddedToCart: bool(w.hasAddedToCart),
    tryOnCompleted: bool(w.tryOnCompleted),
    tryOnAbandoned: bool(w.tryOnAbandoned),
    repeatViewCount: num(w.repeatViewCount),
    filterChangeCount: num(w.filterChangeCount),
    productViewCount: num(w.productViewCount),
    lastMiraDismissMs:
      typeof w.lastMiraDismissMs === "number" ? w.lastMiraDismissMs : undefined,
    isInConversation: bool(w.isInConversation ?? w.isEngaged),
    conversationTurnCount: num(w.conversationTurnCount),
    priceFilterActive: bool(w.priceFilterActive),
    searchQuery: str(w.searchQuery),
    outfitAccepted: bool(w.outfitAccepted),
    sizeSelected: bool(w.sizeSelected),
    checkoutInitiated: bool(w.checkoutInitiated),
  };
}
