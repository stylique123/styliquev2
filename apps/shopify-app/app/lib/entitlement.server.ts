// Single source of truth for "can shop X use feature Y right now?".
// Also exports CSRF token helpers for internal dashboard forms.
//
// Used by every offering — Studio job dispatch, Widget surface gating,
// Stylist tool gates, Dashboard section visibility, Recommendations filter.
// Replace ad-hoc checks across the codebase with calls into this module.
//
// Resolution order:
//   1. Load the shop's Plan row.
//   2. Compute effective PlanFeatures via PLAN_FEATURES[tier] ⊕ planFeaturesJson override.
//   3. For metered features, cross-check against UsageCounter for the current period.
//   4. Return { allowed, reason, remaining }.

import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.server";
import {
  PLAN_FEATURES,
  resolveFeatures,
  currentPeriodStart,
  readFeatureFlag,
  type PlanFeatures,
  type FeatureKey,
} from "@stylique/core";

// Re-export so existing app-side importers don't break.
export { readFeatureFlag };
export type { FeatureKey };
import type { PlanTier, UsageMetric } from "@stylique/types";

export type Entitlement = {
  allowed: boolean;
  reason?: "FEATURE_DISABLED" | "QUOTA_EXHAUSTED" | "PLAN_MISSING";
  remaining: number | null;        // null = unlimited
  hideFromShopper: boolean;        // for shopper-facing UI: should we hide the entry point entirely
};

export type EffectivePlan = {
  tier: PlanTier;
  features: PlanFeatures;
  analyticsLevel: PlanFeatures["analytics"]["level"];
};

// ─── Plan resolution ─────────────────────────────────────────────────────

export async function getEffectivePlan(shopId: string): Promise<EffectivePlan | null> {
  const plan = await prisma.plan.findUnique({
    where: { shopId },
    select: { tier: true, planFeaturesJson: true },
  });
  if (!plan) return null;

  const features = resolveFeatures(
    plan.tier as PlanTier,
    (plan.planFeaturesJson as Partial<PlanFeatures> | null) ?? null,
  );
  return { tier: plan.tier as PlanTier, features, analyticsLevel: features.analytics.level };
}

// ─── Feature gate ────────────────────────────────────────────────────────
// Boolean features only — no metering. Use canConsume() for metered actions.
// `readFeatureFlag` and `FeatureKey` are imported from @stylique/core (C2,
// Sprint 6 audit round 2 — was a duplicated switch with drift) and re-exported
// above so existing callers keep working.

export async function isFeatureEnabled(shopId: string, key: FeatureKey): Promise<boolean> {
  const plan = await getEffectivePlan(shopId);
  if (!plan) return false;
  return readFeatureFlag(plan.features, key);
}

// ─── Metered consume gate ───────────────────────────────────────────────
// For each metric, check the plan cap and the current-period UsageCounter.
// Caller writes the counter increment AFTER the work succeeds.

export async function canConsume(args: {
  shopId: string;
  metric: UsageMetric;
}): Promise<Entitlement> {
  const plan = await getEffectivePlan(args.shopId);
  if (!plan) {
    return { allowed: false, reason: "PLAN_MISSING", remaining: 0, hideFromShopper: false };
  }
  const cap = capForMetric(plan.features, args.metric);
  if (cap === 0) {
    return {
      allowed: false, reason: "FEATURE_DISABLED", remaining: 0,
      hideFromShopper: isShopperFacing(args.metric),
    };
  }
  if (cap === null) {
    return { allowed: true, remaining: null, hideFromShopper: false };
  }
  // Metered tier — check current-period usage.
  const counter = await prisma.usageCounter.findUnique({
    where: {
      shopId_metric_periodStart: {
        shopId: args.shopId, metric: args.metric, periodStart: currentPeriodStart(),
      },
    },
    select: { count: true },
  });
  const used = counter?.count ?? 0;
  const remaining = Math.max(0, cap - used);
  if (remaining <= 0) {
    return {
      allowed: false, reason: "QUOTA_EXHAUSTED", remaining: 0,
      hideFromShopper: isShopperFacing(args.metric),
    };
  }
  return { allowed: true, remaining, hideFromShopper: false };
}

export async function recordConsume(args: {
  shopId: string;
  metric: UsageMetric;
  by?: number;
}): Promise<void> {
  const periodStart = currentPeriodStart();
  await prisma.usageCounter.upsert({
    where: { shopId_metric_periodStart: { shopId: args.shopId, metric: args.metric, periodStart } },
    create: { shopId: args.shopId, metric: args.metric, periodStart, count: args.by ?? 1 },
    update: { count: { increment: args.by ?? 1 } },
  }).catch(() => undefined);
}

function capForMetric(f: PlanFeatures, metric: UsageMetric): number | null {
  switch (metric) {
    case "TRYON_PERSONAL":         return f.widget.monthlyTryOnPersonal;
    case "TRYON_BODY":             return f.widget.monthlyTryOnBody;
    case "CREATIVE_GENERATED":     return f.studio.monthlyCreatives;
    case "CREATIVE_SET_GENERATED": return f.studio.monthlyCreativeSets;
    case "STYLE_RECOMMENDATION":   return f.widget.monthlyStyleRecs;
    case "FIT_RECOMMENDATION":     return f.widget.monthlyFitRecs;
    case "VISION_TURN":            return f.stylist.monthlyVisionTurns;
    case "STYLIST_TURN":           return f.stylist.monthlyTurns;
  }
}

function isShopperFacing(metric: UsageMetric): boolean {
  // When these run out we want to hide the shopper-facing entry point, not
  // surface an error. (Body-model is unlimited so it never trips this.)
  return metric === "TRYON_PERSONAL" || metric === "STYLE_RECOMMENDATION" || metric === "FIT_RECOMMENDATION";
}

// ─── Dashboard helpers ──────────────────────────────────────────────────
// Used by /api/admin/* loaders to decide which sections to return.

export function tierRank(tier: PlanTier): number {
  if (tier === "STARTER")  return 1;
  if (tier === "GROWTH")   return 2;
  return 3;
}

export function tierMeets(actual: PlanTier, required: PlanTier): boolean {
  return tierRank(actual) >= tierRank(required);
}

// Quick-and-cheap entry — true if the tier alone is enough (no metering).
export function tierForFeature(_key: FeatureKey): PlanTier {
  // We rely on PLAN_FEATURES at runtime; this is a hint for UI badges so the
  // dashboard can render "Upgrade to Growth" labels next to locked rows.
  return _key.startsWith("analytics.crossBrandBenchmarks")
       || _key === "studio.autoFromGaps"
       || _key === "stylist.proactiveTriggers"
    ? "ULTIMATE"
    : _key === "studio.video" || _key === "stylist.tasteVector" || _key === "widget.personalPhotoTryOn"
    ? "GROWTH"
    : "STARTER";
}

// ─── CSRF helpers for internal dashboard forms ──────────────────────────────
//
// Usage (server — in your loader):
//   const csrf = generateCSRFToken(sessionId);
//   return json({ csrf, ...rest });
//
// Usage (component):
//   <input type="hidden" name="csrf" value={csrf} />
//
// Usage (server — in your action):
//   const csrf = formData.get("csrf") as string;
//   if (!verifyCSRFToken(csrf, sessionId)) return json({ error: "Invalid CSRF token" }, { status: 403 });
//
// The session ID is STYLIQUE_INTERNAL_SECRET (the only stable server-side secret
// the internal dashboard has at action time). A random per-session nonce baked into
// the token prevents replay across browser sessions.

const CSRF_CONTEXT = "stylique-internal-csrf-v1";

/**
 * Generate a CSRF token bound to a session identifier.
 * The token is an HMAC-SHA256 of (sessionId + ":" + nonce), encoded as hex:nonce.
 */
export function generateCSRFToken(sessionId: string): string {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const mac = createHmac("sha256", sessionId)
    .update(`${CSRF_CONTEXT}:${nonce}`)
    .digest("hex");
  return `${mac}:${nonce}`;
}

/**
 * Verify a CSRF token against the session identifier.
 * Returns true only when the HMAC is valid.
 */
export function verifyCSRFToken(token: string | null | undefined, sessionId: string): boolean {
  if (!token) return false;
  const colonIdx = token.indexOf(":");
  if (colonIdx < 1) return false;
  const mac = token.slice(0, colonIdx);
  const nonce = token.slice(colonIdx + 1);
  if (!nonce) return false;
  const expected = createHmac("sha256", sessionId)
    .update(`${CSRF_CONTEXT}:${nonce}`)
    .digest("hex");
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  if (macBuf.length !== expBuf.length) return false;
  return timingSafeEqual(new Uint8Array(macBuf), new Uint8Array(expBuf));
}

// ─── Convenience: the full features table for external surfaces (storefront (storefront
// widget) that want to know "what can this shop's widget actually do" in one
// fetch — no enum gymnastics on the client.
export async function getWidgetSurface(shopId: string): Promise<PlanFeatures["widget"]> {
  const plan = await getEffectivePlan(shopId);
  if (!plan) return PLAN_FEATURES.STARTER.widget;
  return plan.features.widget;
}

export async function getStylistSurface(shopId: string): Promise<PlanFeatures["stylist"]> {
  const plan = await getEffectivePlan(shopId);
  if (!plan) return PLAN_FEATURES.STARTER.stylist;
  return plan.features.stylist;
}
