// Plan + entitlement contracts. Implementation in ./service.ts.
//
// Rule: when a quota is exhausted for a shopper-facing feature, return
// { allowed: false, hideFromShopper: true }. The UI uses hideFromShopper
// to decide between "hide entry point" vs "show a brand-facing notice".

import type { PlanTier, UsageMetric } from "@stylique/types";

export type EntitlementCheck =
  | { allowed: true; remaining: number | null }
  | { allowed: false; hideFromShopper: boolean; reason: "QUOTA_EXHAUSTED" | "PLAN_DISABLED" };

export interface PlanQuotas {
  monthlyTryOnPersonal: number | null;
  monthlyTryOnBody: number | null;
  monthlyCreatives: number | null;
  monthlyCreativeSets: number | null;
  monthlyStyleRecs: number | null;
  monthlyFitRecs: number | null;
  monthlyVisionTurns: number | null;
  monthlyTurns: number | null; // STYLIST_TURN cap (P1)
  creativeSets: number | null;
}

// Quota-only view of the three tiers. The full feature set lives in
// ./features.ts (PLAN_FEATURES) — keep numeric quotas here in sync with that
// file. resolvePlanQuotas() below derives this from the richer features map so
// we never drift.
import { PLAN_FEATURES } from "./features.js";

function quotasFromFeatures(tier: PlanTier): PlanQuotas {
  const f = PLAN_FEATURES[tier];
  return {
    monthlyTryOnPersonal: f.widget.monthlyTryOnPersonal,
    monthlyTryOnBody:     f.widget.monthlyTryOnBody,
    monthlyCreatives:     f.studio.monthlyCreatives,
    monthlyCreativeSets:  f.studio.monthlyCreativeSets,
    monthlyStyleRecs:     f.widget.monthlyStyleRecs,
    monthlyFitRecs:       f.widget.monthlyFitRecs,
    monthlyVisionTurns:   f.stylist.monthlyVisionTurns,
    monthlyTurns:         f.stylist.monthlyTurns,
    creativeSets:         f.studio.monthlyCreativeSets,
  };
}

export const PLAN_DEFAULTS: Record<PlanTier, PlanQuotas> = {
  STARTER:  quotasFromFeatures("STARTER"),
  GROWTH:   quotasFromFeatures("GROWTH"),
  ULTIMATE: quotasFromFeatures("ULTIMATE"),
};

// Map a metric to the plan field that limits it. null = unlimited / not gated.
export function quotaForMetric(quotas: PlanQuotas, metric: UsageMetric): number | null {
  switch (metric) {
    case "TRYON_PERSONAL":         return quotas.monthlyTryOnPersonal;
    case "TRYON_BODY":             return quotas.monthlyTryOnBody;
    case "CREATIVE_GENERATED":     return quotas.monthlyCreatives;
    case "CREATIVE_SET_GENERATED": return quotas.monthlyCreativeSets;
    case "STYLE_RECOMMENDATION":   return quotas.monthlyStyleRecs;
    case "FIT_RECOMMENDATION":     return quotas.monthlyFitRecs;
    case "VISION_TURN":            return quotas.monthlyVisionTurns;
    case "STYLIST_TURN":           return quotas.monthlyTurns;
  }
}

// Which metrics, when exhausted, must be HIDDEN from the shopper (not error-messaged).
// TRYON_PERSONAL is the canonical case: hide upload UI, keep body-model alive.
export function hidesFromShopperOnExhaust(metric: UsageMetric): boolean {
  return metric === "TRYON_PERSONAL" || metric === "STYLE_RECOMMENDATION" || metric === "FIT_RECOMMENDATION";
}

// First day of the current month in UTC — the period key for UsageCounter.
export function currentPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
