// Stylique Beauty — merchant intelligence queries.
// The unclaimed seat: brand-side analytics that no competitor ships.
// Every metric here satisfies the "if this changes 20%, brand knows what to do"
// contract from CLAUDE.md §11.
//
// Shade gap report → brand reorders missing depth/undertone range
// Concern trend → brand launches targeting product
// Ingredient trend → brand reformulates or highlights key actives
// Replenishment window → brand sets up subscription / email cadence

import type { ShadeGap, ConcernTrend, IngredientTrend, SkinUndertone, SkinDepth, SkinConcern } from "./types.js";

// These functions take raw analytics rows (from Prisma queries in brain.server.ts)
// and transform them into actionable merchant intelligence. They are pure — no DB
// access here, matching the pattern of packages/core/src/style/service.ts.

// ─── Shade gap analysis ───────────────────────────────────────────────────

export type RawShadeRequest = {
  undertone: string | null;
  depth: string | null;
  terms: string[];  // what shopper typed ("nc25", "warm medium", "olive undertone")
};

export type CatalogShadeRange = {
  undertone: string;
  depth: string;
  productCount: number;
};

export function analyzeShadeGaps(
  requests: RawShadeRequest[],
  catalogRanges: CatalogShadeRange[],
): ShadeGap[] {
  // Group requests by undertone+depth bucket
  const buckets = new Map<string, { count: number; terms: string[] }>();

  for (const req of requests) {
    if (!req.undertone || !req.depth) continue;
    const key = `${req.undertone}:${req.depth}`;
    const existing = buckets.get(key) ?? { count: 0, terms: [] };
    existing.count++;
    existing.terms.push(...req.terms);
    buckets.set(key, existing);
  }

  const gaps: ShadeGap[] = [];

  for (const [key, { count, terms }] of buckets) {
    const [undertone, depth] = key.split(":") as [SkinUndertone, SkinDepth];
    const catalogMatch = catalogRanges.find(r => r.undertone === undertone && r.depth === depth);
    const matchedProducts = catalogMatch?.productCount ?? 0;

    const gapSeverity: ShadeGap["gapSeverity"] =
      matchedProducts === 0 ? "critical" :
      matchedProducts < 2 ? "high" :
      matchedProducts < 4 ? "medium" : "low";

    gaps.push({
      undertone,
      depth,
      requestCount: count,
      requestedTerms: [...new Set(terms)].slice(0, 5),
      matchedProducts,
      gapSeverity,
    });
  }

  // Sort by request count desc, gap severity second
  return gaps.sort((a, b) => {
    const severityScore = { critical: 4, high: 3, medium: 2, low: 1 };
    return b.requestCount - a.requestCount || severityScore[b.gapSeverity] - severityScore[a.gapSeverity];
  });
}

// ─── Concern trend analysis ───────────────────────────────────────────────

export type RawConcernEvent = {
  concern: string;
  sessionCount: number;
  previousWeekCount: number;
  topTerms: string[];
};

export type CatalogConcernCoverage = {
  concern: string;
  productCount: number;
};

export function analyzeConcernTrends(
  events: RawConcernEvent[],
  catalogCoverage: CatalogConcernCoverage[],
): ConcernTrend[] {
  return events.map(e => {
    const coverage = catalogCoverage.find(c => c.concern === e.concern);
    const productsAddressed = coverage?.productCount ?? 0;
    const weekOverWeekChange = e.previousWeekCount > 0
      ? Math.round(((e.sessionCount - e.previousWeekCount) / e.previousWeekCount) * 100)
      : 0;

    const catalogCoverageLevel: ConcernTrend["catalogCoverage"] =
      productsAddressed === 0 ? "gap" :
      productsAddressed < 3 ? "partial" : "good";

    return {
      concern: e.concern as SkinConcern,
      sessionCount: e.sessionCount,
      weekOverWeekChange,
      topQueriedTerms: e.topTerms.slice(0, 4),
      productsAddressed,
      catalogCoverage: catalogCoverageLevel,
    };
  }).sort((a, b) => b.sessionCount - a.sessionCount);
}

// ─── Ingredient trend analysis ────────────────────────────────────────────

export type RawIngredientSignal = {
  ingredient: string;
  requestedCount: number;    // shoppers who asked FOR it ("contains niacinamide?")
  avoidedCount: number;      // shoppers who asked to AVOID it ("no fragrance please")
  previousWeekRequested: number;
};

export function analyzeIngredientTrends(signals: RawIngredientSignal[]): IngredientTrend[] {
  return signals.map(s => {
    const totalCurrent = s.requestedCount + s.avoidedCount;
    const trend: IngredientTrend["trend"] =
      s.requestedCount > s.previousWeekRequested * 1.2 ? "rising" :
      s.requestedCount < s.previousWeekRequested * 0.8 ? "falling" : "stable";

    return {
      ingredient: s.ingredient,
      requestedCount: s.requestedCount,
      avoidedCount: s.avoidedCount,
      trend,
    };
  }).sort((a, b) => (b.requestedCount + b.avoidedCount) - (a.requestedCount + a.avoidedCount));
}

// ─── Replenishment window calculator ─────────────────────────────────────

export type ProductReplenishmentWindow = {
  productId: string;
  category: string;
  avgDaysToReplenish: number;
  shopperCount: number;
  nextWindowOpens: number;   // days from now when first shoppers are due to replenish
};

// Category average replenishment cadences (days) — industry benchmarks
const CATEGORY_REPLENISHMENT_DAYS: Record<string, number> = {
  cleanser:    45,
  toner:       60,
  serum:       45,
  eye_cream:   90,
  moisturizer: 60,
  spf:         45,
  foundation:  90,
  concealer:   120,
  lip:         60,
  mascara:     90,
  setting:     120,
  treatment:   60,
};

export function estimateReplenishmentWindow(
  category: string,
  firstPurchasedDaysAgo: number,
): { isDue: boolean; daysUntilDue: number; urgency: "now" | "soon" | "later" } {
  const avgDays = CATEGORY_REPLENISHMENT_DAYS[category] ?? 60;
  const daysUntilDue = avgDays - firstPurchasedDaysAgo;

  return {
    isDue: daysUntilDue <= 0,
    daysUntilDue: Math.max(0, daysUntilDue),
    urgency: daysUntilDue <= 0 ? "now" : daysUntilDue <= 14 ? "soon" : "later",
  };
}

// ─── Beauty dashboard overview builder ───────────────────────────────────
// Called by buildOverview() in dashboard.server.ts — same pattern as the
// fashion dashboard. Returns a beauty intelligence block.

export type BeautyDashboardBlock = {
  topShadeGap: ShadeGap | null;
  topConcernTrend: ConcernTrend | null;
  risingIngredient: IngredientTrend | null;
  routineCompletionRate: number;
  avgRoutineAOV: number | null;
  replenishmentDue: number;    // shoppers whose replenishment window opens in next 14 days
};

export function buildBeautyDashboardBlock(
  shadeGaps: ShadeGap[],
  concernTrends: ConcernTrend[],
  ingredientTrends: IngredientTrend[],
  routineStats: { completionRate: number; avgAOV: number | null },
  replenishmentDue: number,
): BeautyDashboardBlock {
  return {
    topShadeGap: shadeGaps.find(g => g.gapSeverity === "critical") ?? shadeGaps[0] ?? null,
    topConcernTrend: concernTrends.find(t => t.catalogCoverage === "gap") ?? concernTrends[0] ?? null,
    risingIngredient: ingredientTrends.find(t => t.trend === "rising") ?? null,
    routineCompletionRate: routineStats.completionRate,
    avgRoutineAOV: routineStats.avgAOV,
    replenishmentDue,
  };
}
