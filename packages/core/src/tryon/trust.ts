// ─── Try-on & sizing TRUST primitives (Step 2H Phase 3) ──────────────────────
// Deterministic, dependency-free helpers that keep try-on + sizing HONEST:
//   • an explicit render state machine (P3-T05) so a failure/timeout/invalid
//     input can never read as success;
//   • a render-honesty classifier (P3-T04 + the product rule) — call it a STYLE
//     PREVIEW unless the path can actually reflect fit/drape differences;
//   • sizing confidence LEVELS (P3-T08) with an honest "unavailable" floor;
//   • fit-feedback reason capture (P3-T10) — a hook only, never automation.
// All pure → fully unit-testable in @stylique/core.

// ── Render state machine (P3-T05) ────────────────────────────────────────────
// Richer than the DB JobStatus (PENDING/RUNNING/SUCCEEDED/FAILED) so the
// lifecycle is explicit + honest. Maps onto JobStatus for persistence (no
// migration): requested/queued → PENDING, rendering → RUNNING, completed →
// SUCCEEDED, failed/expired/blocked → FAILED (errorClass distinguishes them).
export type TryOnState =
  | "requested"   // accepted, not yet enqueued
  | "queued"      // enqueued, waiting for a worker
  | "rendering"   // provider call in flight
  | "completed"   // real validated output exists
  | "failed"      // provider error / bad output
  | "expired"     // output TTL elapsed
  | "blocked";    // invalid input (bad product/variant/colour) — never rendered

export type DbJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

const TRANSITIONS: Record<TryOnState, TryOnState[]> = {
  requested: ["queued", "rendering", "blocked", "failed"],
  queued: ["rendering", "failed", "expired", "blocked"],
  rendering: ["completed", "failed"],
  completed: ["expired"],
  failed: [],
  expired: [],
  blocked: [],
};

export function canTransition(from: TryOnState, to: TryOnState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function stateToDbStatus(s: TryOnState): DbJobStatus {
  switch (s) {
    case "requested":
    case "queued":
      return "PENDING";
    case "rendering":
      return "RUNNING";
    case "completed":
      return "SUCCEEDED";
    case "failed":
    case "expired":
    case "blocked":
      return "FAILED";
  }
}

// `completed` is ONLY legitimate when a real, non-empty output exists. This is
// the structural "no fake success" guard for the render lifecycle.
export function resolveTerminalState(args: {
  hadError: boolean;
  timedOut: boolean;
  invalidInput: boolean;
  outputUrl: string | null | undefined;
}): { state: TryOnState; errorClass: string | null } {
  if (args.invalidInput) return { state: "blocked", errorClass: "invalid_input" };
  if (args.timedOut) return { state: "failed", errorClass: "timeout" };
  if (args.hadError) return { state: "failed", errorClass: "provider_error" };
  if (!args.outputUrl) return { state: "failed", errorClass: "no_output" };
  return { state: "completed", errorClass: null };
}

// ── Render honesty classifier (P3-T04 + product rule) ────────────────────────
// Given the signed ease (cm) the render received for each size, decide whether
// the path can HONESTLY claim to reflect fit. If the ease genuinely varies across
// sizes the render reflects fit ("fit-visual"); if every size renders at the same
// ease (the provider/path can't reflect size) it is a STYLE PREVIEW only — never
// a fit-accurate claim.
export type RenderHonesty = "fit-visual" | "style-preview-only" | "failed";

export function classifyRenderHonesty(easeBySize: Array<{ size: string; easeCm: number | null }>): {
  honesty: RenderHonesty;
  distinctEaseBuckets: number;
  label: string;
} {
  const valid = easeBySize.filter((e) => e.easeCm != null && Number.isFinite(e.easeCm));
  if (valid.length === 0) {
    return { honesty: "failed", distinctEaseBuckets: 0, label: "Couldn't compute fit for these sizes." };
  }
  const buckets = new Set(valid.map((e) => Math.round((e.easeCm as number) / 4) * 4));
  if (buckets.size >= 2) {
    return { honesty: "fit-visual", distinctEaseBuckets: buckets.size, label: "Fit preview — sizes render differently." };
  }
  return { honesty: "style-preview-only", distinctEaseBuckets: 1, label: "Style preview — not a fit-accurate render." };
}

// The honest UI label for a try-on render. We never imply the render IS the
// shopper's body or a fit guarantee.
export function honestTryOnLabel(honesty: RenderHonesty): string {
  switch (honesty) {
    case "fit-visual": return "Shown on a studio muse · fit mapped to your size";
    case "style-preview-only": return "Style preview · shown on a studio muse";
    case "failed": return "Preview unavailable";
  }
}

// ── Sizing confidence levels (P3-T08) ────────────────────────────────────────
export type SizingConfidence = "high" | "medium" | "low" | "unavailable";

export interface SizingConfidenceInput {
  hasSizeChart: boolean;       // a real per-product measurement chart exists
  hasMeasurements: boolean;    // shopper gave chest/waist/hip (consented)
  hasHeightWeight: boolean;    // shopper gave height/weight
  score?: number;              // 0-100 numeric score from the recommender, if any
}

// Honest: NO chart AND no body signal → "unavailable" (we won't guess). A chart
// with measurements is high; a chart or measurements alone is medium; only
// height/weight (an estimate) is low.
export function sizingConfidenceLevel(input: SizingConfidenceInput): {
  level: SizingConfidence;
  honestLine: string;
} {
  if (!input.hasSizeChart && !input.hasMeasurements && !input.hasHeightWeight) {
    return { level: "unavailable", honestLine: "I don't have this piece's size chart or your measurements yet, so I can't size it accurately — want me to size you?" };
  }
  if (input.hasSizeChart && input.hasMeasurements) {
    return { level: "high", honestLine: "Sized against this piece's real measurements and yours." };
  }
  if (input.hasSizeChart || input.hasMeasurements) {
    return { level: "medium", honestLine: "A solid estimate — add the missing detail to tighten it." };
  }
  return { level: "low", honestLine: "A rough estimate from height and weight — not a fit guarantee." };
}

// We never promise a fit. Any sizing copy passes through this guard, which strips
// guarantee language. (Defensive: a prompt/template should never produce it, but
// this is the structural backstop.)
const GUARANTEE_RX = /\b(guaranteed?|will (definitely )?fit perfectly|perfect fit|exact fit|fits? you exactly|fit you exactly|100% fit)\b/gi;
export function stripFitGuarantee(text: string): string {
  return text.replace(GUARANTEE_RX, "a strong fit");
}

// ── Fit-feedback / return-reason capture (P3-T10) — HOOK ONLY ─────────────────
export const FIT_FEEDBACK_REASONS = [
  "too_small", "too_large", "tight_chest", "tight_waist", "too_long", "too_short",
  "wrong_color", "fabric_issue", "changed_mind", "other",
] as const;
export type FitFeedbackReason = (typeof FIT_FEEDBACK_REASONS)[number];

const FB = {
  too_small: /\b(too small|runs small|too tight all over|couldn.?t fit into)\b/i,
  too_large: /\b(too (big|large)|runs (big|large)|too loose|swimming in it)\b/i,
  // Proximity match in EITHER order ("chest was too tight" / "tight in the chest").
  tight_chest: /((tight|snug).{0,20}(chest|bust)|(chest|bust).{0,20}(tight|snug)|can.?t button.*chest)/i,
  tight_waist: /((tight|snug).{0,20}waist|waist.{0,20}(tight|snug)|won.?t button.*waist)/i,
  too_long: /\b(too long|hem too long|sleeves too long|drags on the floor)\b/i,
  too_short: /\b(too short|hem too short|sleeves too short|rides up)\b/i,
  wrong_color: /\b(wrong colou?r|colou?r (was off|didn.?t match|looked different)|not the colou?r)\b/i,
  fabric_issue: /\b(fabric (felt|was) (cheap|thin|scratchy|stiff)|material (issue|problem)|itchy|see.?through)\b/i,
  changed_mind: /\b(changed my mind|don.?t want it anymore|no longer need|just don.?t like it)\b/i,
} as const;

export function classifyFitFeedback(text: string): FitFeedbackReason {
  const t = text.toLowerCase();
  for (const reason of FIT_FEEDBACK_REASONS) {
    if (reason === "other") continue;
    if ((FB as Record<string, RegExp>)[reason]?.test(t)) return reason as FitFeedbackReason;
  }
  return "other";
}

// A captured fit-feedback signal. The caller persists it as an event/session
// signal — it NEVER triggers a return/exchange/order mutation. A return/exchange
// REQUEST routes to safe handoff (Phase 2), not automation.
export interface FitFeedbackSignal {
  reason: FitFeedbackReason;
  productHandle: string | null;
  size: string | null;
  note: string;          // short, no PII
  needsHandoff: boolean; // true when the shopper wants a return/exchange action
}

export function buildFitFeedback(args: {
  text: string; productHandle: string | null; size: string | null;
}): FitFeedbackSignal {
  const reason = classifyFitFeedback(args.text);
  const wantsAction = /\b(return|exchange|refund|send (it )?back|swap)\b/i.test(args.text);
  return {
    reason,
    productHandle: args.productHandle,
    size: args.size,
    note: args.text.slice(0, 200),
    needsHandoff: wantsAction,
  };
}
