// Dashboard data contract. Single loader called by /api/admin/overview that
// returns a tier-shaped JSON the future dashboard UI consumes wholesale.
//
// Sections covered (each shaped so a starter brand sees the basics and an
// ultimate brand sees the full picture):
//
//   • plan      — tier name, feature flags, current period usage
//   • headline  — top-line KPIs across all 3 offerings
//   • stylist   — chat funnel + top combos
//   • widget    — try-on / fit / style funnel + mood + model splits
//   • studio    — sets generated, top-performing creatives, gaps
//   • catalog   — top requested queries + catalog gaps (when tier allows)
//   • taste     — aggregated brand-side taste profile (Growth+)
//   • recs      — tier-filtered BrandRecommendation rows

import { prisma } from "../db.server";
import { getEffectivePlan } from "./entitlement.server";
import { listRecommendations } from "./recommendations.server";
import { readBenchmarksForShop, readLatestSnapshot } from "./network.server";
import { getInsights, type StarterInsights, type GrowthInsights, type UltimateInsights } from "./insights.server";
import { getFashionIntelligence, type FashionIntelligence } from "./fashion-intelligence.server";
import { buildBeautyAnalyticsBlock, type IngredientTrendsResult } from "./beauty-brain.server";
import { currentPeriodStart, type PlanFeatures } from "@stylique/core";
import type { PlanTier } from "@stylique/types";

const DAY = 86_400_000;

export async function buildOverview(args: {
  shopId: string;
  windowDays?: number;
}): Promise<{
  plan: {
    tier: PlanTier;
    analyticsLevel: PlanFeatures["analytics"]["level"];
    features: PlanFeatures;
    usage: Record<string, { used: number; cap: number | null; remaining: number | null }>;
  };
  headline: {
    chatSessions: number;
    chatTurns: number;
    combosProposed: number;
    cartConfirmed: number;
    cartFromMira: number;
    cartFromTryon: number;
    cartFromWidgetStyle: number;
    tryOnSessions: number;
    fitSubmitted: number;
    creativesGenerated: number;
    signupsClaimed: number;
    catalogGaps: number;
    windowDays: number;
  };
  stylist: {
    funnel: { opened: number; messaged: number; combosShown: number; productClicked: number; cartConfirmed: number };
    topCombos: Array<{ name: string; proposed: number; clicked: number; ctr: number; productIds: string[] }>;
  };
  widget: {
    funnel: { opened: number; experienceChosen: number; modelSelected: number; fitSubmitted: number; styleViewed: number; moodSelected: number };
    topMoods: Array<{ moodId: string; count: number }>;
    topModels: Array<{ modelId: string; count: number }>;
    // VTO render (Sprint 6 / D34). Counts + success-rate + p50 latency over
    // the dashboard window. providerKey reflects the brand's current engine
    // (see /app/settings/tryon).
    tryon: {
      requested: number;
      completed: number;
      failed: number;
      successRate: number | null;            // % of (completed + failed)
      p50LatencyMs: number | null;
      providerKey: "gemini-image" | "replicate-idm-vton" | "replicate-catvton" | "vertex-vto-001" | "vertex-nano-banana" | string;
    };
  };
  studio: {
    setsGenerated: number;
    creativesGenerated: number;
    pendingFromRecommendations: number;
    sourcedFromCombos: number;
  } | null;
  catalog: {
    topQueries: Array<{ query: string; count: number }>;
    gaps: Array<{ query: string; count: number; lastSeen: Date }>;
  } | null;
  taste: {
    topColorFamilies: Array<{ key: string; share: number }>;
    topSilhouettes: Array<{ key: string; share: number }>;
    topCategories: Array<{ key: string; share: number }>;
    sampleSize: number;
  } | null;
  recs: Array<{
    id: string; kind: string; severity: string; surface: string;
    title: string; body: string;
    actionUrl: string | null; ctaLabel: string | null;
    productId: string | null; generatedAt: Date;
  }>;
  // Sentiment analysis — populated by nightly Gemini extraction job.
  sentiment: {
    totalAnalyzed: number;
    positive: number;
    neutral: number;
    negative: number;
    topThemes: Array<{ theme: string; count: number }>;
    recentSummaries: Array<{ summary: string; sentiment: string; date: Date }>;
  };
  // Ultimate-tier only — network percentiles per metric. Null on lower tiers.
  benchmarks: Array<{
    dimension: string; brandValue: number; percentile: number;
    network: { p25: number; p50: number; p75: number; p90: number; mean: number; sampleBrands: number };
  }> | null;
  // Tier-differentiated insights engine (insights.server.ts).
  // Starter = StarterInsights; Growth = GrowthInsights; Ultimate = UltimateInsights.
  insights: StarterInsights | GrowthInsights | UltimateInsights;
  // Four-pillar fashion intelligence — consumer / conversion / fit / style.
  // Mirrors the demo's mira-intelligence shape; tier-gated, shopId-scoped,
  // honest dataMode (live+modelled vs modelled). See fashion-intelligence.server.ts.
  fashionIntelligence: FashionIntelligence;
  // Count of high-urgency items for the nav badge (red dot).
  insightsBadgeCount: number;
  // Beauty intelligence — only present when brandMode === "beauty".
  beauty: {
    topConcerns: Array<{ concern: string; count: number }>;
    replenishmentDueSoon: number;
    shadeGapCount: number;
    ingredientTrends: IngredientTrendsResult;
  } | null;
}> {
  const win = args.windowDays ?? 30;
  const since = new Date(Date.now() - win * DAY);
  const plan = await getEffectivePlan(args.shopId);
  if (!plan) throw new Error("plan_missing");

  // ─── plan + usage ────────────────────────────────────────────────────
  const counters = await prisma.usageCounter.findMany({
    where: { shopId: args.shopId, periodStart: currentPeriodStart() },
    select: { metric: true, count: true },
  });
  const cap = (n: number | null) => n;
  const f = plan.features;
  const capByMetric: Record<string, number | null> = {
    TRYON_PERSONAL:         cap(f.widget.monthlyTryOnPersonal),
    TRYON_BODY:             cap(f.widget.monthlyTryOnBody),
    CREATIVE_GENERATED:     cap(f.studio.monthlyCreatives),
    CREATIVE_SET_GENERATED: cap(f.studio.monthlyCreativeSets),
    STYLE_RECOMMENDATION:   cap(f.widget.monthlyStyleRecs),
    FIT_RECOMMENDATION:     cap(f.widget.monthlyFitRecs),
  };
  const usage: Record<string, { used: number; cap: number | null; remaining: number | null }> = {};
  for (const [metric, capValue] of Object.entries(capByMetric)) {
    const used = counters.find((c) => c.metric === metric)?.count ?? 0;
    usage[metric] = { used, cap: capValue, remaining: capValue === null ? null : Math.max(0, capValue - used) };
  }

  // ─── event aggregation ──────────────────────────────────────────────
  // One groupBy gets us every event count in the window. Cheap and accurate.
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ["name"],
    where: { shopId: args.shopId, createdAt: { gte: since } },
    _count: { _all: true },
  });
  const evt = (name: string) => grouped.find((g) => g.name === name)?._count._all ?? 0;

  // ─── headline ────────────────────────────────────────────────────────
  const headline = {
    chatSessions:        evt("CHAT_OPENED"),
    chatTurns:           evt("CHAT_MESSAGE_SENT"),
    combosProposed:      evt("CHAT_COMBO_PROPOSED"),
    cartConfirmed:       evt("CART_CONFIRMED"),
    cartFromMira:        evt("CART_FROM_MIRA"),
    cartFromTryon:       evt("CART_FROM_TRYON"),
    cartFromWidgetStyle: evt("CART_FROM_WIDGET_STYLE"),
    tryOnSessions:       evt("WIDGET_OPENED"),
    fitSubmitted:        evt("WIDGET_FIT_SUBMITTED"),
    creativesGenerated:  evt("CREATIVE_SET_GENERATED") + evt("CREATIVE_IMPRESSION"),
    signupsClaimed:      evt("SIGNUP_CLAIMED"),
    catalogGaps:         await prisma.catalogGap.count({ where: { shopId: args.shopId, createdAt: { gte: since } } }),
    windowDays:          win,
  };

  // ─── stylist funnel ─────────────────────────────────────────────────
  const stylistFunnel = {
    opened:         evt("CHAT_OPENED"),
    messaged:       evt("CHAT_MESSAGE_SENT"),
    combosShown:    evt("CHAT_COMBO_PROPOSED"),
    productClicked: evt("CHAT_PRODUCT_CLICKED"),
    cartConfirmed:  evt("CART_CONFIRMED"),
  };
  // Real combo CTR (F3 fix, Sprint 6 audit round 2). Was hardcoded 0.
  // Combo proposals carry { comboName, productIds }. Product clicks carry
  // { productHandle, comboName }. We join on comboName + tally clicks across
  // products that belong to combos with that name. Approximate (multiple
  // combos can share a name in theory) — but matches what brands actually
  // care about ("Sunday brunch energy" CTR = 12%).
  const [comboEvents, clickEvents] = await Promise.all([
    prisma.analyticsEvent.findMany({
      where: { shopId: args.shopId, name: "CHAT_COMBO_PROPOSED", createdAt: { gte: since } },
      select: { payload: true },
      take: 500,
    }),
    prisma.analyticsEvent.findMany({
      where: { shopId: args.shopId, name: "CHAT_PRODUCT_CLICKED", createdAt: { gte: since } },
      select: { payload: true },
      take: 2000,
    }),
  ]);
  const comboCount = new Map<string, number>();
  const comboProductIds = new Map<string, string[]>(); // most recent productIds per combo name
  for (const e of comboEvents) {
    const payload = e.payload as { comboName?: string; productIds?: string[] } | null;
    const n = payload?.comboName;
    if (n) {
      comboCount.set(n, (comboCount.get(n) ?? 0) + 1);
      // Keep the first set of productIds we see for this combo name.
      if (!comboProductIds.has(n) && Array.isArray(payload?.productIds)) {
        comboProductIds.set(n, payload.productIds as string[]);
      }
    }
  }
  const clickCountByCombo = new Map<string, number>();
  for (const e of clickEvents) {
    const n = (e.payload as { comboName?: string } | null)?.comboName;
    if (n) clickCountByCombo.set(n, (clickCountByCombo.get(n) ?? 0) + 1);
  }
  const topCombos = [...comboCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, proposed]) => {
      const clicked = clickCountByCombo.get(name) ?? 0;
      const ctr = proposed > 0 ? Math.round((clicked * 100) / proposed) : 0;
      const productIds = comboProductIds.get(name) ?? [];
      return { name, proposed, clicked, ctr, productIds };
    });

  // ─── widget funnel + moods + models ─────────────────────────────────
  const widgetFunnel = {
    opened:            evt("WIDGET_OPENED"),
    experienceChosen:  evt("WIDGET_EXPERIENCE_SELECTED"),
    modelSelected:     evt("WIDGET_MODEL_SELECTED"),
    fitSubmitted:      evt("WIDGET_FIT_SUBMITTED"),
    styleViewed:       evt("WIDGET_STYLE_VIEWED"),
    moodSelected:      evt("WIDGET_MOOD_SELECTED"),
  };
  const moodEvents = await prisma.analyticsEvent.findMany({
    where: { shopId: args.shopId, name: "WIDGET_MOOD_SELECTED", createdAt: { gte: since } },
    select: { payload: true }, take: 500,
  });
  const modelEvents = await prisma.analyticsEvent.findMany({
    where: { shopId: args.shopId, name: "WIDGET_MODEL_SELECTED", createdAt: { gte: since } },
    select: { payload: true }, take: 500,
  });
  const topMoods = countBy(moodEvents.map((e) => (e.payload as { moodId?: string } | null)?.moodId)).map(([k, v]) => ({ moodId: k, count: v }));
  const topModels = countBy(modelEvents.map((e) => (e.payload as { modelId?: string } | null)?.modelId)).map(([k, v]) => ({ modelId: k, count: v }));

  // ─── VTO render tile (Sprint 6 / D34) ───────────────────────────────
  // Pull TRYON_RENDER_* events in the window. Latency lives on the
  // _COMPLETED payload; we compute p50 from the sorted array. Provider is
  // the brand's *current* setting — historical events may have used a
  // different one, which is fine for at-a-glance reporting.
  const tryonEvents = await prisma.analyticsEvent.findMany({
    where: {
      shopId: args.shopId,
      createdAt: { gte: since },
      name: { in: ["TRYON_RENDER_REQUESTED", "TRYON_RENDER_COMPLETED", "TRYON_RENDER_FAILED"] },
    },
    select: { name: true, payload: true },
  });
  let tryonRequested = 0, tryonCompleted = 0, tryonFailed = 0;
  const tryonLatencies: number[] = [];
  for (const e of tryonEvents) {
    if (e.name === "TRYON_RENDER_REQUESTED")  tryonRequested++;
    if (e.name === "TRYON_RENDER_COMPLETED") {
      tryonCompleted++;
      const lat = (e.payload as { latencyMs?: number } | null)?.latencyMs;
      if (typeof lat === "number" && lat > 0) tryonLatencies.push(lat);
    }
    if (e.name === "TRYON_RENDER_FAILED")     tryonFailed++;
  }
  tryonLatencies.sort((a, b) => a - b);
  const tryonP50 = tryonLatencies.length ? tryonLatencies[Math.floor(tryonLatencies.length / 2)]! : null;
  const tryonDenom = tryonCompleted + tryonFailed;
  const tryonSuccessRate = tryonDenom > 0 ? Math.round((tryonCompleted * 100) / tryonDenom) : null;
  // Provider key lives on the raw planFeaturesJson, not the resolved features.
  const rawPlan = await prisma.plan.findUnique({
    where: { shopId: args.shopId },
    select: { planFeaturesJson: true },
  });
  const rawTryon = (rawPlan?.planFeaturesJson as { tryon?: { providerKey?: string } } | null)?.tryon ?? null;
  // Pass the providerKey through as-is so the dashboard tile reflects the actual
  // configured provider (vertex-vto-001, replicate-catvton, vertex-nano-banana, etc.)
  // rather than defaulting everything unknown to "gemini-image" (D38a-r1).
  const tryonProvider: string = rawTryon?.providerKey ?? "gemini-image";

  // ─── studio (only if enabled) ───────────────────────────────────────
  let studio: Awaited<ReturnType<typeof buildOverview>>["studio"] = null;
  if (f.studio.enabled) {
    const [sets, creatives, pending, sourced] = await Promise.all([
      prisma.creativeSet.count({ where: { shopId: args.shopId, createdAt: { gte: since } } }),
      prisma.creative.count({ where: { shopId: args.shopId, createdAt: { gte: since } } }),
      prisma.creativeSet.count({ where: { shopId: args.shopId, triggeredBy: { startsWith: "recommendation:" } } }),
      prisma.creative.count({ where: { shopId: args.shopId, sourceComboName: { not: null }, createdAt: { gte: since } } }),
    ]);
    studio = { setsGenerated: sets, creativesGenerated: creatives, pendingFromRecommendations: pending, sourcedFromCombos: sourced };
  }

  // ─── catalog (top queries + gaps), Growth+ only ─────────────────────
  let catalog: Awaited<ReturnType<typeof buildOverview>>["catalog"] = null;
  if (plan.tier !== "STARTER") {
    const queryRows = await prisma.analyticsEvent.findMany({
      where: { shopId: args.shopId, name: "CHAT_SEARCH_RUN", createdAt: { gte: since } },
      select: { payload: true }, take: 1000,
    });
    const qCount = countBy(queryRows.map((r) => (r.payload as { query?: string } | null)?.query?.toLowerCase()));
    const gapRows = await prisma.catalogGap.groupBy({
      by: ["normalizedQuery"],
      where: { shopId: args.shopId, createdAt: { gte: since } },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _count: { normalizedQuery: "desc" } },
      take: 10,
    });
    catalog = {
      topQueries: qCount.slice(0, 10).map(([k, v]) => ({ query: k, count: v })),
      gaps: gapRows.map((g) => ({ query: g.normalizedQuery, count: g._count._all, lastSeen: g._max.createdAt ?? new Date(0) })),
    };
  }

  // ─── aggregated brand taste profile (Growth+) ───────────────────────
  let taste: Awaited<ReturnType<typeof buildOverview>>["taste"] = null;
  if (plan.tier !== "STARTER" && f.stylist.tasteVectorEnabled) {
    const sessions = await prisma.shopperSession.findMany({
      where: { shopifyDomain: (await prisma.shop.findUnique({ where: { id: args.shopId }, select: { shopifyDomain: true } }))?.shopifyDomain ?? "__none__",
               tasteVectorJson: { not: undefined }, signalCount: { gte: 3 } },
      select: { tasteVectorJson: true }, take: 2000,
    });
    const agg = { colorFamily: {} as Record<string, number>, silhouette: {} as Record<string, number>, category: {} as Record<string, number> };
    for (const s of sessions) {
      const v = s.tasteVectorJson as { colorFamily?: Record<string, number>; silhouette?: Record<string, number>; category?: Record<string, number> } | null;
      if (!v) continue;
      for (const [k, val] of Object.entries(v.colorFamily ?? {})) agg.colorFamily[k] = (agg.colorFamily[k] ?? 0) + val;
      for (const [k, val] of Object.entries(v.silhouette  ?? {})) agg.silhouette[k]  = (agg.silhouette[k]  ?? 0) + val;
      for (const [k, val] of Object.entries(v.category    ?? {})) agg.category[k]    = (agg.category[k]    ?? 0) + val;
    }
    taste = {
      topColorFamilies: shareTop(agg.colorFamily),
      topSilhouettes:   shareTop(agg.silhouette),
      topCategories:    shareTop(agg.category),
      sampleSize: sessions.length,
    };
  }

  // ─── sentiment analysis (nightly Gemini extraction) ─────────────────
  // ShopperSession is scoped by shopifyDomain (no shopId FK) — resolve once.
  const shopDomainForSentiment = (await prisma.shop.findUnique({
    where: { id: args.shopId }, select: { shopifyDomain: true },
  }))?.shopifyDomain ?? "__none__";
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sentimentRows = await prisma.shopperSession.groupBy({
    by: ["sentimentLabel"] as ["sentimentLabel"],
    where: {
      shopifyDomain: shopDomainForSentiment,
      sentimentExtractedAt: { gte: thirtyDaysAgo },
      sentimentLabel: { not: null },
    },
    _count: true,
  });

  // Get top themes — unnest arrays in JS since we don't have pgvector unnest
  const themedSessions = await prisma.shopperSession.findMany({
    where: {
      shopifyDomain: shopDomainForSentiment,
      sentimentExtractedAt: { gte: thirtyDaysAgo },
      sentimentThemes: { isEmpty: false },
    },
    select: { sentimentThemes: true },
    take: 200,
  });
  const themeCounts = new Map<string, number>();
  for (const s of themedSessions) {
    for (const t of s.sentimentThemes) {
      themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
    }
  }
  const topThemes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme, count]) => ({ theme, count }));

  const recentSummaries = await prisma.shopperSession.findMany({
    where: {
      shopifyDomain: shopDomainForSentiment,
      sentimentSummary: { not: null },
      sentimentExtractedAt: { gte: thirtyDaysAgo },
    },
    select: { sentimentSummary: true, sentimentLabel: true, sentimentExtractedAt: true },
    orderBy: { sentimentExtractedAt: "desc" },
    take: 5,
  });

  const sentimentCounts = { positive: 0, neutral: 0, negative: 0, total: 0 };
  for (const row of sentimentRows) {
    const label = row.sentimentLabel as "positive" | "neutral" | "negative" | null;
    if (label && label in sentimentCounts) {
      // _count is the count of matched rows when using `_count: true`
      const cnt = (row._count as unknown as Record<string, number>)._all ?? 0;
      sentimentCounts[label] = cnt;
      sentimentCounts.total += cnt;
    }
  }

  // ─── tier-filtered recommendations ──────────────────────────────────
  const recs = await listRecommendations({
    shopId: args.shopId,
    visibleKinds: f.recommendations.visibleKinds as Parameters<typeof listRecommendations>[0]["visibleKinds"],
  });

  // ─── Layer 3 — cross-brand benchmarks (Ultimate tier) ───────────────
  let benchmarks: Awaited<ReturnType<typeof buildOverview>>["benchmarks"] = null;
  if (plan.tier === "ULTIMATE" && f.analytics.crossBrandBenchmarks) {
    benchmarks = await readBenchmarksForShop(args.shopId);
  }

  // ─── Tier-differentiated insights ───────────────────────────────────
  const insights = await getInsights(args.shopId, plan.tier as "STARTER" | "GROWTH" | "ULTIMATE");

  // ─── Four-pillar fashion intelligence (consumer/conversion/fit/style) ─
  const fashionIntelligence = await getFashionIntelligence(
    args.shopId,
    plan.tier as "STARTER" | "GROWTH" | "ULTIMATE",
  );

  // ─── Beauty intelligence (beauty brandMode only) ────────────────────
  const rawBrandMode = (rawPlan?.planFeaturesJson as { brandMode?: string } | null)?.brandMode ?? "fashion";
  let beauty: Awaited<ReturnType<typeof buildOverview>>["beauty"] = null;
  if (rawBrandMode === "beauty") {
    beauty = await buildBeautyAnalyticsBlock(args.shopId);
  }

  // ─── Nav badge count: high-urgency items the brand should see ────────
  // Counts: failed jobs (from usage rail) + high-urgency catalog gaps +
  // size drift alerts + stockout predictions < 7 days + URGENT recs.
  let insightsBadgeCount = 0;
  if ("catalogGapsWithIntent" in insights) {
    insightsBadgeCount += insights.catalogGapsWithIntent.filter((g) => g.urgencyLevel === "high").length;
    if (insights.sizeDistribution.driftAlert) insightsBadgeCount++;
  }
  if ("restockingPredictions" in insights) {
    insightsBadgeCount += insights.restockingPredictions.filter(
      (r) => r.predictedStockoutDays < 7
    ).length;
  }
  insightsBadgeCount += recs.filter((r) => r.severity === "URGENT").length;

  return {
    plan: { tier: plan.tier, analyticsLevel: plan.analyticsLevel, features: plan.features, usage },
    headline,
    stylist: { funnel: stylistFunnel, topCombos },
    widget:  {
      funnel: widgetFunnel, topMoods, topModels,
      tryon: {
        requested: tryonRequested,
        completed: tryonCompleted,
        failed: tryonFailed,
        successRate: tryonSuccessRate,
        p50LatencyMs: tryonP50,
        providerKey: tryonProvider,
      },
    },
    studio,
    catalog,
    taste,
    recs: recs.map((r) => ({
      id: r.id, kind: r.kind, severity: r.severity, surface: r.surface,
      title: r.title, body: r.body, actionUrl: r.actionUrl, ctaLabel: r.ctaLabel,
      productId: r.productId, generatedAt: r.generatedAt,
    })),
    sentiment: {
      totalAnalyzed: sentimentCounts.total,
      positive: sentimentCounts.positive,
      neutral: sentimentCounts.neutral,
      negative: sentimentCounts.negative,
      topThemes,
      recentSummaries: recentSummaries.map((s) => ({
        summary: s.sentimentSummary!,
        sentiment: s.sentimentLabel ?? "neutral",
        date: s.sentimentExtractedAt!,
      })),
    },
    benchmarks,
    insights,
    fashionIntelligence,
    insightsBadgeCount,
    beauty,
  };
}

function countBy<T extends string | null | undefined>(xs: T[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const x of xs) { if (!x) continue; m.set(x, (m.get(x) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function shareTop(m: Record<string, number>): Array<{ key: string; share: number }> {
  const total = Object.values(m).reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => ({ key: k, share: +(v / total).toFixed(3) }));
}
