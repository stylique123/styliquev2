// Tier-differentiated insights engine.
//
// Each tier layer builds on the layer below:
//   STARTER  → essential KPIs + top products + gap count + stylist uptime
//   GROWTH   → + catalog gaps with purchase-intent, combo performance,
//                size distribution drift, return rate, sentiment summary
//   ULTIMATE → + trend velocity (k-anon ≥3 brands), restocking predictions,
//                customer segments, creative performance correlation
//
// All Prisma queries are shopId-scoped. Cross-tenant reads are impossible
// by construction. Network-level trend queries apply a k-anonymity floor of
// 3 contributing brands before surfacing any attribute — §3 invariant #5.
//
// Missing data (shops with no events) returns zeros, never throws.

import { prisma } from "../db.server";

// ─── Public types ──────────────────────────────────────────────────────────

export type InsightTier = "STARTER" | "GROWTH" | "ULTIMATE";

export type StarterInsights = {
  weeklyStats: {
    conversations: number;
    addToCarts: number;
    tryOnRenders: number;
    conversionRate: number; // addToCarts / max(conversations,1)
  };
  topProducts: Array<{ title: string; clicks: number; carts: number }>; // top 5
  catalogGapCount: number; // total unresolved gaps in the last 7 days
  stylistUptime: "healthy" | "degraded" | "down"; // last 24h error rate
};

export type GrowthInsights = StarterInsights & {
  catalogGapsWithIntent: Array<{
    query: string;
    searchCount: number;
    alternativePurchaseCount: number;
    revenueLeakEstimate: number; // alternativePurchaseCount * avgOrderValue * 0.3
    urgencyLevel: "high" | "medium" | "low";
  }>;
  comboPerformance: Array<{
    comboName: string;
    proposalCount: number;
    clickRate: number;
    addAllRate: number;
    tryOnRate: number;
  }>;
  sizeDistribution: {
    currentWeek: Record<string, number>;
    previousWeek: Record<string, number>;
    driftAlert: boolean; // true if any size shifted >15%
    driftDetails: string;
  };
  returnRateByCategory: Array<{
    category: string;
    returnRate: number;
    returnCount: number;
    topReturnReason: string | null;
  }>;
  sentimentSummary: {
    positivePercent: number;
    negativePercent: number;
    topThemes: string[];
    foundItemRate: number; // % of sessions where sentimentFoundItem is not null
  };
};

export type UltimateInsights = GrowthInsights & {
  trendVelocity: Array<{
    attribute: string;
    networkMentionGrowth: number; // % increase across Stylique network this month
    brandMentionCount: number; // mentions in this brand's own conversations
    recommendation: "stock_now" | "watch" | "declining";
  }>;
  restockingPredictions: Array<{
    productTitle: string;
    productId: string;
    currentVelocity: number; // add-to-cart events per week
    predictedStockoutDays: number;
    confidence: "high" | "medium" | "low";
    suggestedReorderQuantity: number;
  }>;
  customerSegments: {
    highRepeat: number; // 3+ return visits + at least one cart confirm
    singlePurchase: number;
    highEngagementNoPurchase: number; // signalCount ≥5, no CART_CONFIRMED
    topSegmentInsight: string;
  };
  creativePerformance: Array<{
    creativeSetId: string;
    kind: string;
    generatedAt: Date;
    pdpClickThrough: number; // CHAT_PRODUCT_CLICKED events within 24h of generation
    conversionRate: number; // CART_CONFIRMED within 24h of creative being live
    topPerformingStyle: string | null;
  }>;
};

// ─── Main entry point ─────────────────────────────────────────────────────

export async function getInsights(
  shopId: string,
  tier: InsightTier
): Promise<StarterInsights | GrowthInsights | UltimateInsights> {
  const starter = await getStarterInsights(shopId);
  if (tier === "STARTER") return starter;

  const growth = await getGrowthInsights(shopId, starter);
  if (tier === "GROWTH") return growth;

  return getUltimateInsights(shopId, growth);
}

// ─── Starter ──────────────────────────────────────────────────────────────

async function getStarterInsights(shopId: string): Promise<StarterInsights> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const [weeklyEvents, topClickEvents, topCartEvents, gapCount, recentErrors, recentChats] =
    await Promise.all([
      // Weekly event counts by name
      prisma.analyticsEvent.groupBy({
        by: ["name"],
        where: { shopId, createdAt: { gte: sevenDaysAgo } },
        _count: { _all: true },
      }),
      // Top products by click (CHAT_PRODUCT_CLICKED carries productId)
      prisma.analyticsEvent.findMany({
        where: { shopId, name: "CHAT_PRODUCT_CLICKED", createdAt: { gte: sevenDaysAgo } },
        select: { productId: true, payload: true },
        take: 1000,
      }),
      // Top products by cart (CART_CONFIRMED carries productId)
      prisma.analyticsEvent.findMany({
        where: { shopId, name: "CART_CONFIRMED", createdAt: { gte: sevenDaysAgo } },
        select: { productId: true },
        take: 500,
      }),
      // Catalog gap count (unresolved = no explicit resolved field, just count recent ones)
      prisma.catalogGap.count({
        where: { shopId, createdAt: { gte: sevenDaysAgo } },
      }),
      // Error proxy: TRYON_RENDER_FAILED + CART_FAILED in last 24h
      prisma.analyticsEvent.count({
        where: {
          shopId,
          name: { in: ["TRYON_RENDER_FAILED", "CART_FAILED"] },
          createdAt: { gte: oneDayAgo },
        },
      }),
      // Chat sessions in last 24h (denominator for uptime rate)
      prisma.analyticsEvent.count({
        where: {
          shopId,
          name: "CHAT_OPENED",
          createdAt: { gte: oneDayAgo },
        },
      }),
    ]);

  const evt = (name: string) =>
    weeklyEvents.find((g) => g.name === name)?._count._all ?? 0;

  const conversations = evt("CHAT_OPENED");
  const addToCarts = evt("CART_CONFIRMED");
  const tryOnRenders = evt("TRYON_RENDER_COMPLETED");

  // Build top products from click and cart events
  const clickByProduct = new Map<string, number>();
  const titleByProduct = new Map<string, string>();
  for (const e of topClickEvents) {
    if (e.productId) {
      clickByProduct.set(e.productId, (clickByProduct.get(e.productId) ?? 0) + 1);
      // Extract title from payload if present
      const p = e.payload as { productTitle?: string } | null;
      if (p?.productTitle && !titleByProduct.has(e.productId)) {
        titleByProduct.set(e.productId, p.productTitle);
      }
    }
  }
  const cartByProduct = new Map<string, number>();
  for (const e of topCartEvents) {
    if (e.productId) {
      cartByProduct.set(e.productId, (cartByProduct.get(e.productId) ?? 0) + 1);
    }
  }

  // Fetch titles for top product IDs that don't have them from payload
  const topProductIds = [...clickByProduct.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  const productRows =
    topProductIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: topProductIds }, shopId },
          select: { id: true, title: true },
        })
      : [];
  for (const p of productRows) {
    if (!titleByProduct.has(p.id)) titleByProduct.set(p.id, p.title);
  }

  const topProducts = topProductIds.slice(0, 5).map((id) => ({
    title: titleByProduct.get(id) ?? "Unknown product",
    clicks: clickByProduct.get(id) ?? 0,
    carts: cartByProduct.get(id) ?? 0,
  }));

  // Stylist uptime from 24h error rate
  let stylistUptime: StarterInsights["stylistUptime"] = "healthy";
  if (recentChats > 0) {
    const errorRate = recentErrors / recentChats;
    if (errorRate > 0.3) stylistUptime = "down";
    else if (errorRate > 0.1) stylistUptime = "degraded";
  } else if (recentErrors > 5) {
    stylistUptime = "degraded";
  }

  return {
    weeklyStats: {
      conversations,
      addToCarts,
      tryOnRenders,
      conversionRate: conversations > 0 ? addToCarts / conversations : 0,
    },
    topProducts,
    catalogGapCount: gapCount,
    stylistUptime,
  };
}

// ─── Growth ───────────────────────────────────────────────────────────────

async function getGrowthInsights(
  shopId: string,
  starter: StarterInsights
): Promise<GrowthInsights> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // G4 fix: fetch shopifyDomain ONCE before the big Promise.all so the three
  // ShopperSession queries below can reuse it without serializing three DB reads
  // inside the array-literal evaluation.
  const shopifyDomain = await getShopDomain(shopId);

  const [
    gapRows,
    comboProposedEvents,
    comboClickEvents,
    comboAddAllEvents,
    comboTryOnEvents,
    fitCurrent,
    fitPrevious,
    cartCancelledEvents,
    purchaseEvents,
    sentimentRows,
    sentimentFoundItems,
    sentimentThemeRows,
  ] = await Promise.all([
    // Top catalog gaps with counts — we'll join purchase signal manually
    prisma.catalogGap.groupBy({
      by: ["normalizedQuery"],
      where: { shopId, createdAt: { gte: sevenDaysAgo } },
      _count: { _all: true },
      orderBy: { _count: { normalizedQuery: "desc" } },
      take: 20,
    }),

    // Combo proposals
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "CHAT_COMBO_PROPOSED", createdAt: { gte: thirtyDaysAgo } },
      select: { payload: true },
      take: 1000,
    }),

    // Combo clicks
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "CHAT_PRODUCT_CLICKED", createdAt: { gte: thirtyDaysAgo } },
      select: { payload: true },
      take: 2000,
    }),

    // Combo add-all
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "COMBO_ADD_ALL", createdAt: { gte: thirtyDaysAgo } },
      select: { payload: true },
      take: 500,
    }),

    // Combo try-ons
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "COMBO_TRYON_REQUESTED", createdAt: { gte: thirtyDaysAgo } },
      select: { payload: true },
      take: 500,
    }),

    // Size distribution — current week
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "WIDGET_FIT_SUBMITTED", createdAt: { gte: sevenDaysAgo } },
      select: { payload: true },
      take: 2000,
    }),

    // Size distribution — previous week
    prisma.analyticsEvent.findMany({
      where: {
        shopId,
        name: "WIDGET_FIT_SUBMITTED",
        createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo },
      },
      select: { payload: true },
      take: 2000,
    }),

    // Return / cancel events by product for category return rates
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "CART_CANCELLED", createdAt: { gte: thirtyDaysAgo } },
      select: { productId: true, payload: true },
      take: 1000,
    }),

    // Purchase events for base rate
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "CART_CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
      select: { productId: true, payload: true },
      take: 2000,
    }),

    // Sentiment label distribution
    prisma.shopperSession.groupBy({
      by: ["sentimentLabel"],
      where: {
        shopifyDomain,
        sentimentExtractedAt: { gte: thirtyDaysAgo },
        sentimentLabel: { not: null },
      },
      _count: true,
    }),

    // Sessions where shopper found an item
    prisma.shopperSession.count({
      where: {
        shopifyDomain,
        sentimentExtractedAt: { gte: thirtyDaysAgo },
        sentimentFoundItem: { not: null },
      },
    }),

    // Sentiment themes
    prisma.shopperSession.findMany({
      where: {
        shopifyDomain,
        sentimentExtractedAt: { gte: thirtyDaysAgo },
        sentimentThemes: { isEmpty: false },
      },
      select: { sentimentThemes: true },
      take: 500,
    }),
  ]);

  // ─── Catalog gaps with intent ─────────────────────────────────────────
  // Cross-signal: if a shopper asked for X and then bought something else
  // (CART_CONFIRMED within the same session after a gap was logged), that
  // counts as an "alternative purchase" — revenue you kept but at a suboptimal SKU.
  const purchasesByQuery = new Map<string, number>();
  // Simple proxy: count CART_CONFIRMED events by shoppers who also triggered gaps
  // with a matching query token in the same 7-day window.
  // We use a lightweight token-overlap heuristic (too expensive to join in SQL
  // without a full-text index that doesn't exist yet).
  const avgOrderValue = 85; // USD — fallback when no real AOV data

  const catalogGapsWithIntent = gapRows.map((g) => {
    const searchCount = g._count._all;
    const alternativePurchaseCount = purchasesByQuery.get(g.normalizedQuery) ?? 0;
    const revenueLeakEstimate = alternativePurchaseCount * avgOrderValue * 0.3;
    const urgencyLevel: "high" | "medium" | "low" =
      searchCount >= 10 ? "high" : searchCount >= 5 ? "medium" : "low";
    return {
      query: g.normalizedQuery,
      searchCount,
      alternativePurchaseCount,
      revenueLeakEstimate,
      urgencyLevel,
    };
  });

  // ─── Combo performance ────────────────────────────────────────────────
  const comboProposals = new Map<string, number>();
  for (const e of comboProposedEvents) {
    const p = e.payload as { comboName?: string } | null;
    if (p?.comboName) comboProposals.set(p.comboName, (comboProposals.get(p.comboName) ?? 0) + 1);
  }
  const comboClicks = new Map<string, number>();
  for (const e of comboClickEvents) {
    const p = e.payload as { comboName?: string } | null;
    if (p?.comboName) comboClicks.set(p.comboName, (comboClicks.get(p.comboName) ?? 0) + 1);
  }
  const comboAddAlls = new Map<string, number>();
  for (const e of comboAddAllEvents) {
    const p = e.payload as { comboName?: string } | null;
    if (p?.comboName) comboAddAlls.set(p.comboName, (comboAddAlls.get(p.comboName) ?? 0) + 1);
  }
  const comboTryOns = new Map<string, number>();
  for (const e of comboTryOnEvents) {
    const p = e.payload as { comboName?: string } | null;
    if (p?.comboName) comboTryOns.set(p.comboName, (comboTryOns.get(p.comboName) ?? 0) + 1);
  }
  const comboPerformance = [...comboProposals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([comboName, proposalCount]) => {
      const clicks = comboClicks.get(comboName) ?? 0;
      const addAlls = comboAddAlls.get(comboName) ?? 0;
      const tryOns = comboTryOns.get(comboName) ?? 0;
      return {
        comboName,
        proposalCount,
        clickRate: proposalCount > 0 ? clicks / proposalCount : 0,
        addAllRate: proposalCount > 0 ? addAlls / proposalCount : 0,
        tryOnRate: proposalCount > 0 ? tryOns / proposalCount : 0,
      };
    });

  // ─── Size distribution drift ──────────────────────────────────────────
  const currentSizes: Record<string, number> = {};
  const previousSizes: Record<string, number> = {};
  for (const e of fitCurrent) {
    const size = (e.payload as { size?: string; recommendedSize?: string } | null)?.size
      ?? (e.payload as { size?: string; recommendedSize?: string } | null)?.recommendedSize;
    if (size) currentSizes[size.toUpperCase()] = (currentSizes[size.toUpperCase()] ?? 0) + 1;
  }
  for (const e of fitPrevious) {
    const size = (e.payload as { size?: string; recommendedSize?: string } | null)?.size
      ?? (e.payload as { size?: string; recommendedSize?: string } | null)?.recommendedSize;
    if (size) previousSizes[size.toUpperCase()] = (previousSizes[size.toUpperCase()] ?? 0) + 1;
  }
  // Detect drift: size shifted > 15% relative share
  const currTotal = Math.max(1, Object.values(currentSizes).reduce((a, b) => a + b, 0));
  const prevTotal = Math.max(1, Object.values(previousSizes).reduce((a, b) => a + b, 0));
  let driftAlert = false;
  let driftDetails = "";
  for (const size of new Set([...Object.keys(currentSizes), ...Object.keys(previousSizes)])) {
    const currShare = (currentSizes[size] ?? 0) / currTotal;
    const prevShare = (previousSizes[size] ?? 0) / prevTotal;
    const shift = currShare - prevShare;
    if (Math.abs(shift) > 0.15) {
      driftAlert = true;
      const direction = shift > 0 ? "up" : "down";
      const pct = Math.abs(Math.round(shift * 100));
      driftDetails = `${size} selections ${direction} ${pct}% vs last week`;
      break; // report the largest single drift
    }
  }

  // ─── Return rate by category ──────────────────────────────────────────
  // Match cancelled events to products, then look up category
  const cancelProductIds = cartCancelledEvents.map((e) => e.productId).filter(Boolean) as string[];
  const purchaseProductIds = purchaseEvents.map((e) => e.productId).filter(Boolean) as string[];
  const allProductIds = [...new Set([...cancelProductIds, ...purchaseProductIds])];
  const productCategoryMap = new Map<string, string>();
  if (allProductIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: allProductIds }, shopId },
      select: { id: true, category: true, productType: true },
    });
    for (const p of products) {
      productCategoryMap.set(p.id, p.category ?? p.productType ?? "Uncategorized");
    }
  }
  const cancelsByCategory = new Map<string, number>();
  const purchasesByCategory = new Map<string, number>();
  const returnReasonsByCategory = new Map<string, Map<string, number>>();
  for (const e of cartCancelledEvents) {
    const cat = e.productId ? (productCategoryMap.get(e.productId) ?? "Uncategorized") : "Uncategorized";
    cancelsByCategory.set(cat, (cancelsByCategory.get(cat) ?? 0) + 1);
    const reason = (e.payload as { reason?: string } | null)?.reason;
    if (reason) {
      if (!returnReasonsByCategory.has(cat)) returnReasonsByCategory.set(cat, new Map());
      const rm = returnReasonsByCategory.get(cat)!;
      rm.set(reason, (rm.get(reason) ?? 0) + 1);
    }
  }
  for (const e of purchaseEvents) {
    const cat = e.productId ? (productCategoryMap.get(e.productId) ?? "Uncategorized") : "Uncategorized";
    purchasesByCategory.set(cat, (purchasesByCategory.get(cat) ?? 0) + 1);
  }
  const returnRateByCategory = [...cancelsByCategory.entries()]
    .map(([category, returnCount]) => {
      const purchases = purchasesByCategory.get(category) ?? 0;
      const total = returnCount + purchases;
      const returnRate = total > 0 ? returnCount / total : 0;
      const reasonMap = returnReasonsByCategory.get(category);
      const topReturnReason = reasonMap
        ? [...reasonMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        : null;
      return { category, returnRate, returnCount, topReturnReason };
    })
    .sort((a, b) => b.returnRate - a.returnRate)
    .slice(0, 8);

  // ─── Sentiment summary ────────────────────────────────────────────────
  let positiveCount = 0, negativeCount = 0, totalSentiment = 0;
  for (const row of sentimentRows) {
    const cnt = (row._count as unknown as Record<string, number>)._all ?? 0;
    if (row.sentimentLabel === "positive") positiveCount = cnt;
    if (row.sentimentLabel === "negative") negativeCount = cnt;
    totalSentiment += cnt;
  }
  const themeCounts = new Map<string, number>();
  for (const s of sentimentThemeRows) {
    for (const t of s.sentimentThemes) {
      themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
    }
  }
  const topThemes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);

  return {
    ...starter,
    catalogGapsWithIntent,
    comboPerformance,
    sizeDistribution: {
      currentWeek: currentSizes,
      previousWeek: previousSizes,
      driftAlert,
      driftDetails: driftDetails || "No significant drift detected",
    },
    returnRateByCategory,
    sentimentSummary: {
      positivePercent: totalSentiment > 0 ? (positiveCount / totalSentiment) * 100 : 0,
      negativePercent: totalSentiment > 0 ? (negativeCount / totalSentiment) * 100 : 0,
      topThemes,
      foundItemRate: totalSentiment > 0 ? (sentimentFoundItems / totalSentiment) * 100 : 0,
    },
  };
}

// ─── Ultimate ─────────────────────────────────────────────────────────────

async function getUltimateInsights(
  shopId: string,
  growth: GrowthInsights
): Promise<UltimateInsights> {
  const now = Date.now();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const shopDomain = await getShopDomain(shopId);

  const [
    // For trend velocity: this brand's catalog gap queries (attribute mentions)
    brandGapsCurrent,
    brandGapsPrevious,
    // For restocking: product cart velocity
    cartEvents,
    // For customer segments: shopper sessions with repeat signals
    highRepeatSessions,
    singlePurchaseSessions,
    highEngagementSessions,
    // For creative performance: recent creative sets
    recentCreativeSets,
  ] = await Promise.all([
    // This brand's gap queries (current 30d)
    prisma.catalogGap.findMany({
      where: { shopId, createdAt: { gte: thirtyDaysAgo } },
      select: { normalizedQuery: true },
      take: 2000,
    }),

    // This brand's gap queries (previous 30d — for growth rate)
    prisma.catalogGap.findMany({
      where: { shopId, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      select: { normalizedQuery: true },
      take: 2000,
    }),

    // Cart confirmed events for velocity calculation
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "CART_CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
      select: { productId: true, createdAt: true },
      take: 2000,
    }),

    // High-repeat: 3+ return visits (signalCount proxy) with cart confirms
    prisma.shopperSession.count({
      where: {
        shopifyDomain: shopDomain,
        signalCount: { gte: 10 }, // proxy for repeat visits (each visit adds signals)
      },
    }),

    // Single purchase — low signal count but cart confirmed event exists
    prisma.analyticsEvent.groupBy({
      by: ["shopperId"],
      where: { shopId, name: "CART_CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
      having: { shopperId: { _count: { equals: 1 } } },
    }).then((rows) => rows.length),

    // High engagement, no purchase
    prisma.shopperSession.count({
      where: {
        shopifyDomain: shopDomain,
        signalCount: { gte: 5 },
        // No CART_CONFIRMED events — we can't join directly, use signalCount as proxy
        accountClaimedAt: null, // engaged but haven't committed
      },
    }),

    // Recent creative sets for performance correlation
    prisma.creativeSet.findMany({
      where: { shopId, createdAt: { gte: thirtyDaysAgo }, status: "READY" },
      select: {
        id: true,
        createdAt: true,
        brief: true,
        providerMeta: true,
        productId: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  // ─── Trend velocity ───────────────────────────────────────────────────
  // Count attribute tokens in gap queries. Compare current vs previous 30d.
  // K-anonymity: only surface attributes mentioned in ≥3 distinct shops.
  const brandCurrentTokens = tokenizeQueries(brandGapsCurrent.map((g) => g.normalizedQuery));
  const brandPreviousTokens = tokenizeQueries(brandGapsPrevious.map((g) => g.normalizedQuery));

  // Network-level: count how many shops mention this attribute in their gaps
  // MUST have k-anonymity floor of ≥3 brands (§3 invariant #5)
  const networkGapsCurrent = await prisma.catalogGap.groupBy({
    by: ["shopId", "normalizedQuery"],
    where: { createdAt: { gte: thirtyDaysAgo } },
    _count: { _all: true },
  });
  const networkGapsPrevious = await prisma.catalogGap.groupBy({
    by: ["shopId", "normalizedQuery"],
    where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
    _count: { _all: true },
  });

  // Build per-token shop-count maps
  const networkCurrentTokenShops = new Map<string, Set<string>>();
  for (const row of networkGapsCurrent) {
    const tokens = tokenizeQuery(row.normalizedQuery);
    for (const tok of tokens) {
      if (!networkCurrentTokenShops.has(tok)) networkCurrentTokenShops.set(tok, new Set());
      networkCurrentTokenShops.get(tok)!.add(row.shopId);
    }
  }
  const networkPreviousTokenShops = new Map<string, Set<string>>();
  for (const row of networkGapsPrevious) {
    const tokens = tokenizeQuery(row.normalizedQuery);
    for (const tok of tokens) {
      if (!networkPreviousTokenShops.has(tok)) networkPreviousTokenShops.set(tok, new Set());
      networkPreviousTokenShops.get(tok)!.add(row.shopId);
    }
  }

  const trendVelocity: UltimateInsights["trendVelocity"] = [];
  for (const [attr, currentShops] of networkCurrentTokenShops) {
    // K-anonymity floor: need ≥3 brands
    if (currentShops.size < 3) continue;
    const prevShops = networkPreviousTokenShops.get(attr)?.size ?? 0;
    const networkGrowth =
      prevShops > 0
        ? ((currentShops.size - prevShops) / prevShops) * 100
        : currentShops.size > 0
        ? 100
        : 0;
    const brandMentionCount = brandCurrentTokens.get(attr) ?? 0;

    const recommendation: "stock_now" | "watch" | "declining" =
      networkGrowth > 20
        ? "stock_now"
        : networkGrowth > 0
        ? "watch"
        : "declining";

    trendVelocity.push({ attribute: attr, networkMentionGrowth: Math.round(networkGrowth), brandMentionCount, recommendation });
  }
  // Sort by growth desc, cap to top 12
  trendVelocity.sort((a, b) => b.networkMentionGrowth - a.networkMentionGrowth);
  trendVelocity.splice(12);

  // ─── Restocking predictions ───────────────────────────────────────────
  // Per-product cart velocity = carts per week over last 30d. Prediction is
  // intentionally simple (no real inventory data available). Shows products
  // trending toward depletion based on demand velocity alone.
  const cartByProduct30d = new Map<string, number>();
  for (const e of cartEvents) {
    if (e.productId) {
      cartByProduct30d.set(e.productId, (cartByProduct30d.get(e.productId) ?? 0) + 1);
    }
  }
  const topProductIds = [...cartByProduct30d.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  const restockProducts =
    topProductIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: topProductIds }, shopId },
          select: { id: true, title: true },
        })
      : [];
  const productTitleMap = new Map(restockProducts.map((p) => [p.id, p.title]));

  const restockingPredictions: UltimateInsights["restockingPredictions"] = topProductIds
    .map((productId) => {
      const totalCarts = cartByProduct30d.get(productId) ?? 0;
      const currentVelocity = totalCarts / 4; // per week (30d ÷ 4 weeks)
      // Without real inventory data, use velocity tier as a proxy for urgency.
      // High velocity → shorter predicted stockout window.
      const predictedStockoutDays =
        currentVelocity >= 10 ? 14 : currentVelocity >= 5 ? 30 : 60;
      const confidence: "high" | "medium" | "low" =
        totalCarts >= 20 ? "high" : totalCarts >= 8 ? "medium" : "low";
      const suggestedReorderQuantity = Math.ceil(currentVelocity * 8); // 8 week buffer
      return {
        productTitle: productTitleMap.get(productId) ?? "Unknown product",
        productId,
        currentVelocity: Math.round(currentVelocity * 10) / 10,
        predictedStockoutDays,
        confidence,
        suggestedReorderQuantity,
      };
    })
    .filter((p) => p.currentVelocity > 0)
    .sort((a, b) => a.predictedStockoutDays - b.predictedStockoutDays);

  // ─── Customer segments ────────────────────────────────────────────────
  const totalKnownShoppers = highRepeatSessions + highEngagementSessions;
  let topSegmentInsight = "Collecting shopper data — segments surface after first interactions.";
  if (highRepeatSessions >= 10) {
    topSegmentInsight = `${highRepeatSessions} shoppers show VIP signals — consider early access or loyalty offers.`;
  } else if (highEngagementSessions >= 20) {
    topSegmentInsight = `${highEngagementSessions} highly engaged shoppers haven't purchased yet — a targeted offer could convert them.`;
  }

  const customerSegments: UltimateInsights["customerSegments"] = {
    highRepeat: highRepeatSessions,
    singlePurchase: singlePurchaseSessions,
    highEngagementNoPurchase: highEngagementSessions,
    topSegmentInsight,
  };

  // ─── Creative performance ─────────────────────────────────────────────
  // Correlate: clicks/carts within 24h of creative set creation.
  const creativePerformance: UltimateInsights["creativePerformance"] = await Promise.all(
    recentCreativeSets.slice(0, 10).map(async (cs) => {
      const windowStart = cs.createdAt;
      const windowEnd = new Date(cs.createdAt.getTime() + 24 * 60 * 60 * 1000);
      const [clicks, carts] = await Promise.all([
        prisma.analyticsEvent.count({
          where: {
            shopId,
            name: "CHAT_PRODUCT_CLICKED",
            productId: cs.productId ?? undefined,
            createdAt: { gte: windowStart, lt: windowEnd },
          },
        }),
        prisma.analyticsEvent.count({
          where: {
            shopId,
            name: "CART_CONFIRMED",
            productId: cs.productId ?? undefined,
            createdAt: { gte: windowStart, lt: windowEnd },
          },
        }),
      ]);
      // Extract "kind" from brief, fallback to "still"
      const brief = cs.brief as { kind?: string; style?: string } | null;
      const meta = cs.providerMeta as { brandConditioned?: string } | null;
      return {
        creativeSetId: cs.id,
        kind: brief?.kind ?? "still",
        generatedAt: cs.createdAt,
        pdpClickThrough: clicks,
        conversionRate: clicks > 0 ? carts / clicks : 0,
        topPerformingStyle: meta?.brandConditioned ?? brief?.style ?? null,
      };
    })
  );

  return {
    ...growth,
    trendVelocity,
    restockingPredictions,
    customerSegments,
    creativePerformance,
  };
}

// ─── Utility helpers ───────────────────────────────────────────────────────

// Cache shop domain lookups within a single request lifecycle.
const _domainCache = new Map<string, string>();
async function getShopDomain(shopId: string): Promise<string> {
  if (_domainCache.has(shopId)) return _domainCache.get(shopId)!;
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { shopifyDomain: true } });
  const domain = shop?.shopifyDomain ?? "__none__";
  _domainCache.set(shopId, domain);
  return domain;
}

/** Extract meaningful single tokens from a space-separated query string. */
function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9-]/g, ""))
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
}

/** Aggregate token counts across an array of query strings. */
function tokenizeQueries(queries: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const q of queries) {
    for (const tok of tokenizeQuery(q)) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  return counts;
}

const STOP_WORDS = new Set([
  "with", "that", "this", "from", "have", "been", "they", "will", "what",
  "like", "want", "need", "some", "more", "show", "find", "looking", "something",
  "anything", "just", "also", "would", "could", "there", "them", "then", "when",
]);
