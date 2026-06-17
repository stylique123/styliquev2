// Internal ops dashboard — data layer.
// Provides brand summaries and detail views for the Stylique team.
// All reads are cross-shop (intentional — this is an internal ops tool).

import { prisma } from "../db.server";

const DAY = 86_400_000;

export type BrandHealthStatus = "healthy" | "at_risk" | "churning" | "new" | "inactive";

export type BrandSummary = {
  shopId: string;
  shopifyDomain: string;
  installedAt: Date;
  planTier: string;
  brandHealthStatus: BrandHealthStatus;

  // Activity
  lastActiveAt: Date | null;
  totalShopperSessions: number;
  sessionsLast7Days: number;

  // VTO
  totalTryOnSessions: number;
  tryOnSuccessRate: number; // 0-1

  // Mira
  totalChatMessages: number;
  avgMessagesPerSession: number;

  // Credits / Usage
  creditsBurnedThisMonth: number;
  quotaUsagePercent: number;

  // Brand DNA
  hasBrandDNA: boolean;
  brandDNAAge: number | null; // days since last computed

  // Issues + suggestions
  openIssues: string[];
  suggestions: string[];
};

export type BrandDetail = BrandSummary & {
  recentEvents: Array<{
    id: string;
    name: string;
    createdAt: Date;
    productId: string | null;
    payload: unknown;
  }>;
  recentTryOns: Array<{
    id: string;
    status: string;
    providerKey: string | null;
    latencyMs: number | null;
    error: string | null;
    createdAt: Date;
  }>;
  brandProfile: {
    paletteJson: unknown;
    toneJson: unknown;
    trainedAt: Date | null;
  } | null;
  planFeaturesJson: unknown;
  topCatalogGaps: Array<{ query: string; count: number }>;
  activityByDay: Array<{ date: string; sessions: number }>;
};

function computeHealthStatus(
  installedAt: Date,
  sessionsLast7Days: number,
  lastActiveAt: Date | null,
): BrandHealthStatus {
  const now = Date.now();
  const ageDays = (now - installedAt.getTime()) / DAY;

  if (ageDays < 7) return "new";
  if (!lastActiveAt || now - lastActiveAt.getTime() > 30 * DAY) return "inactive";
  if (now - lastActiveAt.getTime() > 14 * DAY) return "churning";
  if (sessionsLast7Days < 2 && ageDays > 14) return "at_risk";
  if (sessionsLast7Days > 5) return "healthy";
  return "at_risk";
}

function buildIssues(
  hasBrandDNA: boolean,
  tryOnSuccessRate: number,
  sessionsLast7Days: number,
  lastActiveAt: Date | null,
): { issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!hasBrandDNA) {
    issues.push("No brand DNA computed");
    suggestions.push("Schedule a brand DNA refresh run");
  }
  if (tryOnSuccessRate > 0 && tryOnSuccessRate < 0.7) {
    issues.push(`High VTO failure rate (${Math.round((1 - tryOnSuccessRate) * 100)}%)`);
    suggestions.push("Investigate VTO provider errors for this brand");
  }
  if (sessionsLast7Days === 0 && lastActiveAt !== null) {
    const daysSince = lastActiveAt
      ? Math.round((Date.now() - lastActiveAt.getTime()) / DAY)
      : null;
    if (daysSince !== null && daysSince > 7) {
      issues.push(`No shopper activity in ${daysSince} days`);
      suggestions.push(`Reach out — brand has been inactive for ${daysSince} days`);
    }
  }

  return { issues, suggestions };
}

export async function getAllBrandSummaries(): Promise<BrandSummary[]> {
  const since7d = new Date(Date.now() - 7 * DAY);
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const shops = await prisma.shop.findMany({
    select: {
      id: true,
      shopifyDomain: true,
      installedAt: true,
      plan: {
        select: {
          tier: true,
          planFeaturesJson: true,
          monthlyTryOnPersonal: true,
          monthlyTryOnBody: true,
        },
      },
      brandProfile: {
        select: { trainedAt: true, paletteJson: true },
      },
      _count: {
        select: {
          tryOnSessions: true,
        },
      },
    },
  });

  // Batch queries — one per aggregate across all shops to avoid N+1
  const shopIds = shops.map((s) => s.id);

  const [
    sessions7d,
    allSessions,
    chatMessages,
    tryOnCompleted,
    tryOnFailed,
    usageCounters,
    lastEvents,
  ] = await Promise.all([
    // Sessions last 7 days per shop
    prisma.shopperSession.groupBy({
      by: ["shopifyDomain"],
      where: { lastSeenAt: { gte: since7d }, shopifyDomain: { in: shops.map((s) => s.shopifyDomain) } },
      _count: { _all: true },
    }),
    // All shopper sessions per shop
    prisma.shopperSession.groupBy({
      by: ["shopifyDomain"],
      where: { shopifyDomain: { in: shops.map((s) => s.shopifyDomain) } },
      _count: { _all: true },
    }),
    // Total chat messages per shop
    prisma.analyticsEvent.groupBy({
      by: ["shopId"],
      where: { shopId: { in: shopIds }, name: "CHAT_MESSAGE_SENT" },
      _count: { _all: true },
    }),
    // VTO completed
    prisma.tryOnSession.groupBy({
      by: ["shopId"],
      where: { shopId: { in: shopIds }, status: "SUCCEEDED" },
      _count: { _all: true },
    }),
    // VTO failed
    prisma.tryOnSession.groupBy({
      by: ["shopId"],
      where: { shopId: { in: shopIds }, status: "FAILED" },
      _count: { _all: true },
    }),
    // Usage counters this month
    prisma.usageCounter.findMany({
      where: { shopId: { in: shopIds }, periodStart },
      select: { shopId: true, metric: true, count: true },
    }),
    // Last activity event per shop
    prisma.analyticsEvent.findMany({
      where: { shopId: { in: shopIds } },
      select: { shopId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      distinct: ["shopId"],
    }),
  ]);

  return shops.map((shop) => {
    const domain = shop.shopifyDomain;
    const s7 = sessions7d.find((s) => s.shopifyDomain === domain)?._count._all ?? 0;
    const totalSessions = allSessions.find((s) => s.shopifyDomain === domain)?._count._all ?? 0;
    const chatMsgs = chatMessages.find((c) => c.shopId === shop.id)?._count._all ?? 0;
    const vtoOk = tryOnCompleted.find((t) => t.shopId === shop.id)?._count._all ?? 0;
    const vtoFail = tryOnFailed.find((t) => t.shopId === shop.id)?._count._all ?? 0;
    const vtoTotal = vtoOk + vtoFail;
    const vtoRate = vtoTotal > 0 ? vtoOk / vtoTotal : 0;
    const lastEvt = lastEvents.find((e) => e.shopId === shop.id);
    const lastActiveAt = lastEvt?.createdAt ?? null;

    const shopCounters = usageCounters.filter((u) => u.shopId === shop.id);
    const creditsBurned = shopCounters.reduce((sum, u) => sum + u.count, 0);

    // Approximate quota usage from plan caps
    const plan = shop.plan;
    const monthlyCap = plan
      ? (plan.monthlyTryOnPersonal ?? 50) + (plan.monthlyTryOnBody ?? 200)
      : 250;
    const quotaUsagePercent = Math.min(1, creditsBurned / monthlyCap);

    const hasBrandDNA = !!shop.brandProfile?.paletteJson;
    const brandDNAAge = shop.brandProfile?.trainedAt
      ? Math.round((Date.now() - shop.brandProfile.trainedAt.getTime()) / DAY)
      : null;

    const status = computeHealthStatus(shop.installedAt, s7, lastActiveAt);
    const { issues, suggestions } = buildIssues(hasBrandDNA, vtoRate, s7, lastActiveAt);

    return {
      shopId: shop.id,
      shopifyDomain: domain,
      installedAt: shop.installedAt,
      planTier: plan?.tier ?? "STARTER",
      brandHealthStatus: status,
      lastActiveAt,
      totalShopperSessions: totalSessions,
      sessionsLast7Days: s7,
      totalTryOnSessions: shop._count.tryOnSessions,
      tryOnSuccessRate: vtoRate,
      totalChatMessages: chatMsgs,
      avgMessagesPerSession: totalSessions > 0 ? Math.round(chatMsgs / totalSessions) : 0,
      creditsBurnedThisMonth: creditsBurned,
      quotaUsagePercent,
      hasBrandDNA,
      brandDNAAge,
      openIssues: issues,
      suggestions,
    };
  });
}

export async function getBrandDetail(shopId: string): Promise<BrandDetail | null> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopifyDomain: true,
      installedAt: true,
      plan: {
        select: {
          tier: true,
          planFeaturesJson: true,
          monthlyTryOnPersonal: true,
          monthlyTryOnBody: true,
        },
      },
      brandProfile: {
        select: { paletteJson: true, toneJson: true, trainedAt: true },
      },
      _count: { select: { tryOnSessions: true } },
    },
  });
  if (!shop) return null;

  const since7d = new Date(Date.now() - 7 * DAY);
  const since30d = new Date(Date.now() - 30 * DAY);

  const [
    recentEvents,
    recentTryOns,
    topGaps,
    sessionsAllTime,
    sessions7d,
    chatMsgCount,
    vtoOkCount,
    vtoFailCount,
    dayActivity,
  ] = await Promise.all([
    prisma.analyticsEvent.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, name: true, createdAt: true, productId: true, payload: true },
    }),
    prisma.tryOnSession.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, providerKey: true, latencyMs: true, error: true, createdAt: true },
    }),
    prisma.catalogGap.groupBy({
      by: ["normalizedQuery"],
      where: { shopId },
      _count: { _all: true },
      orderBy: { _count: { normalizedQuery: "desc" } },
      take: 10,
    }),
    prisma.shopperSession.count({ where: { shopifyDomain: shop.shopifyDomain } }),
    prisma.shopperSession.count({ where: { shopifyDomain: shop.shopifyDomain, lastSeenAt: { gte: since7d } } }),
    prisma.analyticsEvent.count({ where: { shopId, name: "CHAT_MESSAGE_SENT" } }),
    prisma.tryOnSession.count({ where: { shopId, status: "SUCCEEDED" } }),
    prisma.tryOnSession.count({ where: { shopId, status: "FAILED" } }),
    // Sessions per day for last 7 days (using events as proxy)
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "CHAT_OPENED", createdAt: { gte: since7d } },
      select: { createdAt: true },
    }),
  ]);

  // Build 7-day activity bars
  const activityMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    const key = d.toISOString().slice(0, 10);
    activityMap[key] = 0;
  }
  for (const ev of dayActivity) {
    const key = ev.createdAt.toISOString().slice(0, 10);
    if (key in activityMap) activityMap[key]++;
  }
  const activityByDay = Object.entries(activityMap).map(([date, sessions]) => ({ date, sessions }));

  const vtoTotal = vtoOkCount + vtoFailCount;
  const vtoRate = vtoTotal > 0 ? vtoOkCount / vtoTotal : 0;
  const lastActiveEvt = recentEvents[0]?.createdAt ?? null;

  const status = computeHealthStatus(shop.installedAt, sessions7d, lastActiveEvt);
  const hasBrandDNA = !!shop.brandProfile?.paletteJson;
  const brandDNAAge = shop.brandProfile?.trainedAt
    ? Math.round((Date.now() - shop.brandProfile.trainedAt.getTime()) / DAY)
    : null;
  const { issues, suggestions } = buildIssues(hasBrandDNA, vtoRate, sessions7d, lastActiveEvt);

  const shopCounters = await prisma.usageCounter.findMany({
    where: {
      shopId,
      periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    },
    select: { metric: true, count: true },
  });
  const creditsBurned = shopCounters.reduce((sum, u) => sum + u.count, 0);
  const plan = shop.plan;
  const monthlyCap = plan
    ? (plan.monthlyTryOnPersonal ?? 50) + (plan.monthlyTryOnBody ?? 200)
    : 250;

  return {
    shopId: shop.id,
    shopifyDomain: shop.shopifyDomain,
    installedAt: shop.installedAt,
    planTier: plan?.tier ?? "STARTER",
    brandHealthStatus: status,
    lastActiveAt: lastActiveEvt,
    totalShopperSessions: sessionsAllTime,
    sessionsLast7Days: sessions7d,
    totalTryOnSessions: shop._count.tryOnSessions,
    tryOnSuccessRate: vtoRate,
    totalChatMessages: chatMsgCount,
    avgMessagesPerSession: sessionsAllTime > 0 ? Math.round(chatMsgCount / sessionsAllTime) : 0,
    creditsBurnedThisMonth: creditsBurned,
    quotaUsagePercent: Math.min(1, creditsBurned / monthlyCap),
    hasBrandDNA,
    brandDNAAge,
    openIssues: issues,
    suggestions,
    recentEvents: recentEvents.map((e) => ({
      id: e.id,
      name: e.name,
      createdAt: e.createdAt,
      productId: e.productId,
      payload: e.payload,
    })),
    recentTryOns: recentTryOns.map((t) => ({
      id: t.id,
      status: t.status,
      providerKey: t.providerKey,
      latencyMs: t.latencyMs,
      error: t.error,
      createdAt: t.createdAt,
    })),
    brandProfile: shop.brandProfile
      ? {
          paletteJson: shop.brandProfile.paletteJson,
          toneJson: shop.brandProfile.toneJson,
          trainedAt: shop.brandProfile.trainedAt,
        }
      : null,
    planFeaturesJson: plan?.planFeaturesJson ?? null,
    topCatalogGaps: topGaps.map((g) => ({
      query: g.normalizedQuery,
      count: g._count._all,
    })),
    activityByDay,
  };
}
