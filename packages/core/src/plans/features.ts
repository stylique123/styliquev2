// Source of truth for what each Stylique tier unlocks across the offerings:
// VTO + Size + Style, and the AI Stylist (Mira).
//
// Rule: every tier gets every offering — what changes is LIMITS, FEATURE
// FLAGS, and ANALYTICS DEPTH. Recommendations are also gated by tier.
//
// A shop's effective feature set =
//   PLAN_FEATURES[shop.plan.tier] ⊕ (shop.plan.planFeaturesJson || {})
//
// Bespoke contracts override individual flags via planFeaturesJson.

import type { PlanTier } from "@stylique/types";

export type PlanFeatures = {
  // ─── VTO + Size + Style ──────────────────────────────────────────────
  widget: {
    enabled: boolean;
    monthlyTryOnPersonal: number | null;
    monthlyTryOnBody: number | null;
    monthlyFitRecs: number | null;
    monthlyStyleRecs: number | null;
    bodyModels: number;                        // how many of the 6 models accessible
    moods: number;                             // how many style moods exposed
    personalPhotoTryOn: boolean;
    multiAngleTryOn: boolean;
    sizeChartCustomization: boolean;
  };

  // ─── AI Stylist (chat) ────────────────────────────────────────────────
  stylist: {
    enabled: boolean;
    monthlyTurns: number | null;
    monthlyVisionTurns: number | null;         // Mira's Gemini Vision calls
    persistedMemoryTurns: number;              // capped chat history depth
    tasteVectorEnabled: boolean;               // Layer 2 ranking
    signupOfferEnabled: boolean;               // soft account capture
    cartActionsEnabled: boolean;               // add_to_cart tool
    navigateActionsEnabled: boolean;
    proactiveTriggers: boolean;                // intent-triggered popups
    crossSurfaceContext: boolean;              // stylist sees widget signals
    voice: "warm_friend" | "older_sister" | "editorial" | "streetwear_casual" | "fashion_press";
    stylistName: string;
    valueFirstHook: boolean;
  };

  // ─── Analytics + Recommendations ─────────────────────────────────────
  analytics: {
    level: "BASIC" | "ADVANCED" | "ULTIMATE";
    historyDays: number;                       // how far back the dashboard can show
    exportEnabled: boolean;                    // CSV / API export
    customSegmentsEnabled: boolean;
    crossBrandBenchmarks: boolean;
  };
  recommendations: {
    // Which recommendation kinds surface in the dashboard.
    visibleKinds: Array<
      "CATALOG_GAP" | "WEAK_PDP_CREATIVE" | "FIT_ACCURACY_DRIFT"
      | "TOP_COMBO_TO_PROMOTE" | "UNDERUSED_MOOD" | "TASTE_SEGMENT_EMERGING"
      | "CART_ABANDON_PATTERN" | "STUDIO_PRODUCT_OPPORTUNITY"
      | "STYLIST_DEMAND_SIGNAL" | "CROSS_OFFERING"
    >;
    autoActionsEnabled: boolean;               // one-click "do it" buttons in the dashboard
    dailyDigestEmail: boolean;
  };
};

const ALL_REC_KINDS: PlanFeatures["recommendations"]["visibleKinds"] = [
  "CATALOG_GAP", "WEAK_PDP_CREATIVE", "FIT_ACCURACY_DRIFT",
  "TOP_COMBO_TO_PROMOTE", "UNDERUSED_MOOD", "TASTE_SEGMENT_EMERGING",
  "CART_ABANDON_PATTERN", "STUDIO_PRODUCT_OPPORTUNITY",
  "STYLIST_DEMAND_SIGNAL", "CROSS_OFFERING",
];

export const PLAN_FEATURES: Record<PlanTier, PlanFeatures> = {
  // ─── STARTER ──────────────────────────────────────────────────────────
  // For a brand running their first AI styling experiment. Limits low,
  // recommendations focused on quick wins.
  STARTER: {
    widget: {
      enabled: true,
      monthlyTryOnPersonal: 300,
      monthlyTryOnBody: 3000,                  // cost ceiling — only NEW renders count (cache hits are free); raise per-brand from the ops dashboard
      monthlyFitRecs: 500,
      monthlyStyleRecs: 300,
      bodyModels: 4,
      moods: 3,
      personalPhotoTryOn: false,               // body-model only at Starter
      multiAngleTryOn: false,
      sizeChartCustomization: false,
    },
    stylist: {
      enabled: true,
      monthlyTurns: 1000,
      monthlyVisionTurns: 30,
      persistedMemoryTurns: 20,
      tasteVectorEnabled: false,
      signupOfferEnabled: true,
      cartActionsEnabled: true,
      navigateActionsEnabled: true,
      proactiveTriggers: false,
      crossSurfaceContext: true,
      voice: "warm_friend",
      stylistName: "Mira",
      valueFirstHook: false,                    // Starter: no nightly look prebake
    },
    analytics: {
      level: "BASIC",
      historyDays: 30,
      exportEnabled: false,
      customSegmentsEnabled: false,
      crossBrandBenchmarks: false,
    },
    recommendations: {
      visibleKinds: ["TOP_COMBO_TO_PROMOTE", "UNDERUSED_MOOD", "WEAK_PDP_CREATIVE"],
      autoActionsEnabled: false,
      dailyDigestEmail: false,
    },
  },

  // ─── GROWTH ───────────────────────────────────────────────────────────
  // Working brand running real campaigns. Everything visible, most caps
  // generous but not unlimited.
  GROWTH: {
    widget: {
      enabled: true,
      monthlyTryOnPersonal: 3000,
      monthlyTryOnBody: 30000,                 // cost ceiling — new renders only (cache hits free); per-brand override in ops dashboard
      monthlyFitRecs: 8000,
      monthlyStyleRecs: 5000,
      bodyModels: 6,
      moods: 5,
      personalPhotoTryOn: true,
      multiAngleTryOn: true,
      sizeChartCustomization: true,
    },
    stylist: {
      enabled: true,
      monthlyTurns: 15000,
      monthlyVisionTurns: 500,
      persistedMemoryTurns: 60,
      tasteVectorEnabled: true,
      signupOfferEnabled: true,
      cartActionsEnabled: true,
      navigateActionsEnabled: true,
      proactiveTriggers: true,                  // Growth: intent triggers on
      crossSurfaceContext: true,
      voice: "warm_friend",
      stylistName: "Mira",
      valueFirstHook: true,                     // Growth: nightly look prebake
    },
    analytics: {
      level: "ADVANCED",
      historyDays: 180,
      exportEnabled: true,
      customSegmentsEnabled: false,
      crossBrandBenchmarks: false,
    },
    recommendations: {
      visibleKinds: [
        "CATALOG_GAP", "WEAK_PDP_CREATIVE", "FIT_ACCURACY_DRIFT",
        "TOP_COMBO_TO_PROMOTE", "UNDERUSED_MOOD",
        "CART_ABANDON_PATTERN", "STUDIO_PRODUCT_OPPORTUNITY",
        "STYLIST_DEMAND_SIGNAL",
      ],
      autoActionsEnabled: true,
      dailyDigestEmail: true,
    },
  },

  // ─── ULTIMATE ─────────────────────────────────────────────────────────
  // Established brand or atelier. Unlimited usage on the meters that matter,
  // full visibility into every recommendation kind, cross-brand benchmarks,
  // API access, dedicated rec digest.
  ULTIMATE: {
    widget: {
      enabled: true,
      monthlyTryOnPersonal: null,
      monthlyTryOnBody: 200000,                // abuse ceiling only — effectively unlimited for any real store; per-brand override in ops dashboard
      monthlyFitRecs: null,
      monthlyStyleRecs: null,
      bodyModels: 6,
      moods: 5,
      personalPhotoTryOn: true,
      multiAngleTryOn: true,
      sizeChartCustomization: true,
    },
    stylist: {
      enabled: true,
      monthlyTurns: null,
      monthlyVisionTurns: null,
      persistedMemoryTurns: 120,
      tasteVectorEnabled: true,
      signupOfferEnabled: true,
      cartActionsEnabled: true,
      navigateActionsEnabled: true,
      proactiveTriggers: true,
      crossSurfaceContext: true,
      voice: "editorial",                       // Ultimate default: editorial
      stylistName: "Mira",
      valueFirstHook: true,
    },
    analytics: {
      level: "ULTIMATE",
      historyDays: 730,
      exportEnabled: true,
      customSegmentsEnabled: true,
      crossBrandBenchmarks: true,
    },
    recommendations: {
      visibleKinds: ALL_REC_KINDS,
      autoActionsEnabled: true,
      dailyDigestEmail: true,
    },
  },
};

// Convenience used by entitlement.server.ts.
export function resolveFeatures(
  tier: PlanTier,
  override: Partial<PlanFeatures> | null | undefined,
): PlanFeatures {
  const base = PLAN_FEATURES[tier];
  if (!override) return base;
  // Shallow-merge each top-level section. Override JSON should only contain
  // partials of the inner objects.
  return {
    widget:          { ...base.widget,          ...(override.widget          ?? {}) },
    stylist:         { ...base.stylist,         ...(override.stylist         ?? {}) },
    analytics:       { ...base.analytics,       ...(override.analytics       ?? {}) },
    recommendations: { ...base.recommendations, ...(override.recommendations ?? {}) },
  };
}

// ─── Shared feature-flag reader (Sprint 6 audit round 2 / C2) ─────────────
// Was duplicated in apps/shopify-app/app/lib/entitlement.server.ts AND in
// packages/ai/src/brain/registry.ts with a "keep in sync" comment that drifted.
// Single source now — both consumers import this.

export type FeatureKey =
  | "widget.enabled" | "widget.personalPhotoTryOn" | "widget.multiAngleTryOn" | "widget.sizeChartCustomization"
  | "stylist.enabled" | "stylist.tasteVector" | "stylist.signupOffer" | "stylist.cartActions"
  | "stylist.navigateActions" | "stylist.proactiveTriggers"
  | "analytics.export" | "analytics.customSegments" | "analytics.crossBrandBenchmarks"
  | "recommendations.autoActions" | "recommendations.dailyDigest";

// Signature accepts `string` because Brain's ToolDef.requiresFeature is
// typed as plain string (it's declared in a package that doesn't import this
// type). The `default: false` is therefore intentional, not a missing
// guard — an unknown key means "feature not advertised, hide the tool."
// Add new cases here AND new entries to FeatureKey so app-side callers
// passing a FeatureKey-narrowed value still get IDE autocomplete.
export function readFeatureFlag(f: PlanFeatures, key: FeatureKey | string): boolean {
  switch (key) {
    case "widget.enabled":                    return f.widget.enabled;
    case "widget.personalPhotoTryOn":         return f.widget.personalPhotoTryOn;
    case "widget.multiAngleTryOn":            return f.widget.multiAngleTryOn;
    case "widget.sizeChartCustomization":     return f.widget.sizeChartCustomization;
    case "stylist.enabled":                   return f.stylist.enabled;
    case "stylist.tasteVector":               return f.stylist.tasteVectorEnabled;
    case "stylist.signupOffer":               return f.stylist.signupOfferEnabled;
    case "stylist.cartActions":               return f.stylist.cartActionsEnabled;
    case "stylist.navigateActions":           return f.stylist.navigateActionsEnabled;
    case "stylist.proactiveTriggers":         return f.stylist.proactiveTriggers;
    case "analytics.export":                  return f.analytics.exportEnabled;
    case "analytics.customSegments":          return f.analytics.customSegmentsEnabled;
    case "analytics.crossBrandBenchmarks":    return f.analytics.crossBrandBenchmarks;
    case "recommendations.autoActions":       return f.recommendations.autoActionsEnabled;
    case "recommendations.dailyDigest":       return f.recommendations.dailyDigestEmail;
    default:                                  return false;
  }
}
