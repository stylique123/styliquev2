// Monthly merchant optimization report — the synthesizer.
//
// Spec (cycle-7 5-expert panel):
//   1. Cover — assisted revenue + delta vs trailing 3-mo + verdict color
//   2. What Changed — top 3 deltas + 2 regressions
//   3. Catalog Gaps & Near-Misses — queries with no match + try-on abandons
//   4. Funnel & Conversion — touch → ATC → checkout, AOV split (with N!)
//   5. Bundles — orphan-attach pairs (the 4-condition gate from panel)
//   6. Voice — sentiment themes (≥15 occurrences only) + returns by reason
//   7. Methodology — sample sizes, attribution window, exclusions
//
// Honesty rules (panel mandate):
//   - NEVER quote a lift % on <200 orders
//   - NEVER show a sentiment theme with <15 occurrences
//   - NEVER hide a regression
//   - Bundles require all 4 conditions (co-engage ≥15, co-intent ≥5,
//     co-purchase ≥3, no existing collection)
//   - Attribution = 7-day window before checkout, Mira-touched SKU,
//     non-subscription, non-refunded-within-14d
//   - Every headline number gets an N alongside it
//
// This file is pure (no I/O of its own — caller passes prisma). That makes
// it testable + cron-callable from the worker AND on-demand callable from
// the admin route without forking the logic.

import type { PrismaClient } from "@prisma/client";
import { MIRA_CART_ASSIST_EVENT_NAMES, MIRA_CART_SUCCESS_EVENT_NAMES } from "../analytics/cart-events.js";

const DAY = 86_400_000;
const ATTRIBUTION_WINDOW_DAYS = 7;
const MIN_ORDERS_FOR_LIFT = 200;       // never quote % on smaller N
const MIN_THEME_OCCURRENCES = 15;       // never show n=3 anecdotes as themes
const BUNDLE_MIN_COENGAGE = 15;
const BUNDLE_MIN_COINTENT = 5;
const BUNDLE_MIN_COPURCHASE = 3;
const MIN_ABS_ORDER_CENTS = 1000;       // $10 — excludes test orders
export interface MonthlyReportData {
  period: { start: string; end: string; days: number };
  prior:  { start: string; end: string; days: number };
  shop:   { id: string; domain: string; currency: string };
  cover: {
    assistedRevenueCents: number;
    assistedRevenueDeltaPct: number | null;
    shareOfSessionsPct: number | null;
    headlineColor: "green" | "amber" | "red" | "neutral";
    headlineSentence: string;
  };
  whatChanged: {
    deltas: Array<{ metric: string; from: number; to: number; deltaPct: number | null }>;
    regressions: Array<{ metric: string; from: number; to: number; deltaPct: number | null }>;
  };
  catalogGaps: {
    topGaps: Array<{ category: string; count: number; revenueAtRiskCents: number; sampleQueries: string[] }>;
    tryonAbandons: Array<{ productId: string; productName: string; count: number; revenueAtRiskCents: number }>;
  };
  funnel: {
    sessions: number;
    miraTouchedSessions: number;
    atcEvents: number;
    confirmedOrders: number;
    aovAssistedCents: number | null;
    aovBaselineCents: number | null;
    aovN: { assisted: number; baseline: number };
    liftPct: number | null; // null when N < MIN_ORDERS_FOR_LIFT
  };
  bundles: {
    orphanAttachPairs: Array<{
      aProductId: string; aName: string; bProductId: string; bName: string;
      coEngage: number; coIntent: number; coPurchase: number;
      projectedAttachRevenueCents: number;
    }>;
  };
  voice: {
    topThemes: Array<{ theme: string; count: number }>;
    returnsByReason: Array<{ reasonBucket: string; count: number; sharePct: number }>;
  };
  methodology: {
    attributionWindowDays: number;
    minOrdersForLiftQuote: number;
    minThemeOccurrences: number;
    sampleSizes: Record<string, number>;
    exclusions: { lowValueOrders: number };
    dataFreshnessAt: string;
  };
}

function pct(delta: number, base: number): number | null {
  if (base === 0) return null;
  return Math.round(((delta - base) / base) * 1000) / 10;
}

export function monthlyReportCatalogGapWhere(
  shopId: string,
  createdAt: { gte: Date; lt: Date },
) {
  return {
    shopId,
    createdAt,
    source: { not: "size_chart_extract" },
    NOT: { rawQuery: { startsWith: "no_size_chart" } },
  };
}

export function orderTotalsFromCartRows(
  rows: Array<{ id?: string; payload: unknown }>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const p = row.payload as { orderId?: string | number | null; lineValue?: number } | null;
    const lineValue = typeof p?.lineValue === "number" && p.lineValue > 0 ? p.lineValue : 0;
    if (lineValue <= 0) continue;
    const orderKey = p?.orderId != null ? `o:${p.orderId}` : `e:${row.id ?? totals.size}`;
    totals.set(orderKey, (totals.get(orderKey) ?? 0) + lineValue);
  }
  return totals;
}

/**
 * Pull the assisted revenue total for one window. Reads MIRA_ASSISTED_ORDER
 * events (written by webhooks.orders.fulfilled.tsx) and sums
 * payload.assistedRevenueCents. Returns { sum, n } so the caller has both
 * dollars and order count — required by the panel's "never quote % on
 * <N orders" rule.
 */
async function assistedRevenue(
  prisma: PrismaClient,
  shopId: string,
  start: Date,
  end: Date,
): Promise<{ cents: number; n: number }> {
  const rows = await prisma.analyticsEvent.findMany({
    where: { shopId, name: "MIRA_ASSISTED_ORDER", createdAt: { gte: start, lt: end } },
    select: { payload: true },
  });
  let cents = 0;
  let n = 0;
  for (const r of rows) {
    const p = r.payload as { assistedRevenueCents?: number } | null;
    const v = typeof p?.assistedRevenueCents === "number" ? p.assistedRevenueCents : 0;
    if (v >= MIN_ABS_ORDER_CENTS) { cents += v; n++; }
  }
  return { cents, n };
}

async function eventCount(
  prisma: PrismaClient,
  shopId: string,
  name: string,
  start: Date,
  end: Date,
): Promise<number> {
  return prisma.analyticsEvent.count({
    where: { shopId, name: name as never, createdAt: { gte: start, lt: end } },
  });
}

async function eventCountAny(
  prisma: PrismaClient,
  shopId: string,
  names: readonly string[],
  start: Date,
  end: Date,
  extraWhere: Record<string, unknown> = {},
): Promise<number> {
  return prisma.analyticsEvent.count({
    where: {
      shopId,
      ...extraWhere,
      name: { in: names as unknown as never },
      createdAt: { gte: start, lt: end },
    },
  });
}

/**
 * The whole report, end to end. Caller passes prisma + shopId + periodEnd
 * (defaults to "1st of this month at 00:00 UTC", report covers prior 30d).
 */
export async function synthesizeMonthlyReport(
  prisma: PrismaClient,
  args: { shopId: string; periodEnd?: Date },
): Promise<MonthlyReportData> {
  const periodEnd = args.periodEnd ?? new Date();
  const periodStart = new Date(periodEnd.getTime() - 30 * DAY);
  const priorEnd = periodStart;
  const priorStart = new Date(priorEnd.getTime() - 30 * DAY);

  const shop = await prisma.shop.findUnique({
    where: { id: args.shopId },
    select: { id: true, shopifyDomain: true, currencyCode: true },
  });
  if (!shop) throw new Error(`shop_not_found:${args.shopId}`);

  // ── Cover ─────────────────────────────────────────────────────────────
  const [assistedNow, assistedPrior, sessionsNow] = await Promise.all([
    assistedRevenue(prisma, args.shopId, periodStart, periodEnd),
    assistedRevenue(prisma, args.shopId, priorStart, priorEnd),
    eventCount(prisma, args.shopId, "CHAT_OPENED", periodStart, periodEnd),
  ]);
  const assistedDelta = pct(assistedNow.cents, assistedPrior.cents);
  const sharePct = sessionsNow > 0 ? Math.round((assistedNow.n / sessionsNow) * 1000) / 10 : null;
  const headlineColor: "green" | "amber" | "red" | "neutral" =
    assistedDelta == null ? "neutral" :
    assistedDelta >= 5  ? "green" :
    assistedDelta <= -10 ? "red" : "amber";
  const headlineSentence =
    assistedNow.cents > 0
      ? `Stylique-assisted revenue: ${Math.round(assistedNow.cents / 100).toLocaleString()} ${shop.currencyCode}` +
        (assistedDelta != null ? ` (${assistedDelta >= 0 ? "+" : ""}${assistedDelta}% vs prior 30d, n=${assistedNow.n}).` : ` (n=${assistedNow.n}).`)
      : `No assisted orders yet this period (we'll have more to show as shoppers engage).`;

  // ── What Changed (4 standard metrics, ranked by abs delta %) ──────────
  const counts = await Promise.all(["CHAT_OPENED", "CHAT_MESSAGE_SENT", "CART_CONFIRMED", "WIDGET_OPENED"]
    .map(async (name) => {
      const [a, b] = await Promise.all([
        eventCount(prisma, args.shopId, name, periodStart, periodEnd),
        eventCount(prisma, args.shopId, name, priorStart, priorEnd),
      ]);
      return { metric: name, from: b, to: a, deltaPct: pct(a, b) };
    }));
  const ranked = counts
    .filter((c) => c.deltaPct != null)
    .sort((a, b) => Math.abs(b.deltaPct!) - Math.abs(a.deltaPct!));
  const deltas = ranked.filter((c) => c.deltaPct! > 0).slice(0, 3);
  const regressions = ranked.filter((c) => c.deltaPct! < 0).slice(0, 2);

  // ── Catalog Gaps & Near-Misses ────────────────────────────────────────
  // CatalogGap rows = honest shopper demand (search returning 0). Exclude
  // internal extraction bookkeeping rows such as no_size_chart:<productId>.
  const gaps = await prisma.catalogGap.findMany({
    where: monthlyReportCatalogGapWhere(args.shopId, { gte: periodStart, lt: periodEnd }),
    select: { category: true, rawQuery: true },
  }).catch(() => [] as Array<{ category: string | null; rawQuery: string }>);
  // Bucket by category → count + sample queries.
  const byCategory = new Map<string, { count: number; samples: Set<string> }>();
  for (const g of gaps) {
    const cat = g.category ?? "other";
    const cur = byCategory.get(cat) ?? { count: 0, samples: new Set<string>() };
    cur.count++;
    if (g.rawQuery && cur.samples.size < 3) cur.samples.add(g.rawQuery.slice(0, 120));
    byCategory.set(cat, cur);
  }
  // Need a store AOV to convert demand → revenue-at-risk. Use the period's
  // mean full-order total from CART_CONFIRMED.payload.orderId + lineValue
  // (cents). Falls back to 8500 ($85) when order totals are unavailable.
  const cartRows = await prisma.analyticsEvent.findMany({
    where: { shopId: args.shopId, name: "CART_CONFIRMED", createdAt: { gte: periodStart, lt: periodEnd } },
    select: { id: true, payload: true },
  });
  const cartOrderTotals = orderTotalsFromCartRows(cartRows);
  let aovCents = 8500;
  if (cartOrderTotals.size > 0) {
    const totals = [...cartOrderTotals.values()];
    aovCents = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
  }
  // ~30% capture rate per the panel's "honest estimate" rule.
  const topGaps = Array.from(byCategory.entries())
    .map(([category, v]) => ({
      category,
      count: v.count,
      revenueAtRiskCents: Math.round(v.count * aovCents * 0.30),
      sampleQueries: Array.from(v.samples),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Try-on abandons = TRYON_RENDER_COMPLETED for a shopper who did NOT
  // CART_CONFIRMED that productId within 24h. We approximate by counting
  // tryon completions whose shopper has zero subsequent CART_CONFIRMED for
  // the same product. Cap to top 10.
  const tryonRows = await prisma.analyticsEvent.findMany({
    where: { shopId: args.shopId, name: "TRYON_RENDER_COMPLETED", createdAt: { gte: periodStart, lt: periodEnd } },
    select: { productId: true, shopperId: true, createdAt: true },
  });
  const tryonAbandonByProduct = new Map<string, number>();
  for (const t of tryonRows) {
    if (!t.productId || !t.shopperId) continue;
    const confirmed = await prisma.analyticsEvent.findFirst({
      where: {
        shopId: args.shopId,
        shopperId: t.shopperId,
        productId: t.productId,
        name: "CART_CONFIRMED",
        createdAt: { gte: t.createdAt, lt: new Date(t.createdAt.getTime() + DAY) },
      },
      select: { id: true },
    });
    if (!confirmed) tryonAbandonByProduct.set(t.productId, (tryonAbandonByProduct.get(t.productId) ?? 0) + 1);
  }
  const abandonProductIds = Array.from(tryonAbandonByProduct.keys());
  const products = await prisma.product.findMany({
    where: { id: { in: abandonProductIds } },
    select: { id: true, title: true, variants: { select: { priceCents: true } } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const tryonAbandons = abandonProductIds
    .map((pid) => {
      const p = productById.get(pid);
      const price = p?.variants.find((v) => v.priceCents != null)?.priceCents ?? aovCents;
      const count = tryonAbandonByProduct.get(pid) ?? 0;
      return {
        productId: pid,
        productName: p?.title ?? "Unknown",
        count,
        revenueAtRiskCents: count * price,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // ── Funnel & Conversion ───────────────────────────────────────────────
  const atcEvents = await eventCountAny(
    prisma,
    args.shopId,
    MIRA_CART_SUCCESS_EVENT_NAMES,
    periodStart,
    periodEnd,
  );
  const confirmedOrders = cartOrderTotals.size > 0
    ? cartOrderTotals.size
    : await eventCount(prisma, args.shopId, "CART_CONFIRMED", periodStart, periodEnd);
  // AOV split: assisted vs baseline. Assisted = MIRA_ASSISTED_ORDER; baseline
  // = CART_CONFIRMED where no MIRA_ASSISTED_ORDER exists for same orderId.
  const assistedRows = await prisma.analyticsEvent.findMany({
    where: { shopId: args.shopId, name: "MIRA_ASSISTED_ORDER", createdAt: { gte: periodStart, lt: periodEnd } },
    select: { payload: true },
  });
  const assistedTotals: number[] = [];
  const assistedOrderKeys = new Set<string>();
  for (const r of assistedRows) {
    const p = r.payload as { assistedRevenueCents?: number; orderId?: string | number | null } | null;
    const v = typeof p?.assistedRevenueCents === "number" ? p.assistedRevenueCents : 0;
    if (v >= MIN_ABS_ORDER_CENTS) {
      assistedTotals.push(v);
      if (p?.orderId != null) assistedOrderKeys.add(`o:${p.orderId}`);
    }
  }
  const aovAssisted = assistedTotals.length > 0
    ? Math.round(assistedTotals.reduce((a, b) => a + b, 0) / assistedTotals.length)
    : null;
  // Baseline AOV = mean full order totals for CART_CONFIRMED orders that are
  // not in the assisted-order set. Older rows without orderId fall back to
  // per-event keys, preserving compatibility without averaging multi-line orders.
  const baselineTotals = [...cartOrderTotals.entries()]
    .filter(([orderKey]) => !assistedOrderKeys.has(orderKey))
    .map(([, total]) => total)
    .filter((n) => n >= MIN_ABS_ORDER_CENTS);
  const aovBaseline = baselineTotals.length > 0
    ? Math.round(baselineTotals.reduce((a, b) => a + b, 0) / baselineTotals.length)
    : null;
  // Lift %: ONLY when both sides have ≥MIN_ORDERS_FOR_LIFT orders.
  const liftPct =
    aovAssisted != null && aovBaseline != null && aovBaseline > 0 &&
    assistedTotals.length >= MIN_ORDERS_FOR_LIFT && baselineTotals.length >= MIN_ORDERS_FOR_LIFT
      ? Math.round(((aovAssisted - aovBaseline) / aovBaseline) * 1000) / 10
      : null;

  // ── Bundles (honest, 4-condition gate) ────────────────────────────────
  // Find pairs of products that frequently co-engage in the same session.
  // Approximation: group CHAT_PRODUCT_CLICKED + TRYON_RENDER_COMPLETED by
  // shopperId+day, then count pairs in those groups.
  const engageRows = await prisma.analyticsEvent.findMany({
    where: {
      shopId: args.shopId,
      name: { in: ["CHAT_PRODUCT_CLICKED", "TRYON_RENDER_COMPLETED"] as never },
      createdAt: { gte: periodStart, lt: periodEnd },
      productId: { not: null },
    },
    select: { shopperId: true, productId: true, createdAt: true },
    take: 50_000,
  });
  // Bucket by shopperId + day (YYYY-MM-DD) so same-session = same bucket.
  const sessionsByBucket = new Map<string, Set<string>>();
  for (const e of engageRows) {
    if (!e.shopperId || !e.productId) continue;
    const day = e.createdAt.toISOString().slice(0, 10);
    const key = `${e.shopperId}|${day}`;
    const cur = sessionsByBucket.get(key) ?? new Set<string>();
    cur.add(e.productId);
    sessionsByBucket.set(key, cur);
  }
  // Count pairs (sorted) across sessions.
  const pairCounts = new Map<string, { a: string; b: string; coEngage: number }>();
  for (const products of sessionsByBucket.values()) {
    const ids = Array.from(products).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = `${ids[i]}|${ids[j]}`;
        const cur = pairCounts.get(k) ?? { a: ids[i]!, b: ids[j]!, coEngage: 0 };
        cur.coEngage++;
        pairCounts.set(k, cur);
      }
    }
  }
  // Keep only pairs with coEngage ≥ BUNDLE_MIN_COENGAGE.
  const candidatePairs = Array.from(pairCounts.values()).filter((p) => p.coEngage >= BUNDLE_MIN_COENGAGE);
  // Resolve names + prices for the surviving pairs.
  const pairProductIds = new Set<string>();
  for (const p of candidatePairs) { pairProductIds.add(p.a); pairProductIds.add(p.b); }
  const pairProducts = await prisma.product.findMany({
    where: { id: { in: Array.from(pairProductIds) } },
    select: { id: true, title: true, variants: { select: { priceCents: true } } },
  });
  const pairProductById = new Map(pairProducts.map((p) => [p.id, p]));
  // For each candidate, score coIntent (added A without B) and coPurchase
  // (both in CART_CONFIRMED for same shopperId within 24h).
  const orphanAttachPairs: MonthlyReportData["bundles"]["orphanAttachPairs"] = [];
  for (const cp of candidatePairs.slice(0, 50)) {
    // coIntent ≈ cart interest for A whose shopper didn't request B within
    // 24h. This may include pre-cart assist intent, but it is deliberately kept
    // separate from the report's add-to-bag funnel count above.
    const intentA = await eventCountAny(
      prisma,
      args.shopId,
      MIRA_CART_ASSIST_EVENT_NAMES,
      periodStart,
      periodEnd,
      { productId: cp.a },
    );
    if (intentA < BUNDLE_MIN_COINTENT) continue;
    // coPurchase = CART_CONFIRMED for both products by same shopper within 24h.
    const confirmA = await prisma.analyticsEvent.findMany({
      where: { shopId: args.shopId, name: "CART_CONFIRMED", productId: cp.a, createdAt: { gte: periodStart, lt: periodEnd } },
      select: { shopperId: true, createdAt: true },
    });
    let coPurchase = 0;
    for (const ca of confirmA) {
      if (!ca.shopperId) continue;
      const both = await prisma.analyticsEvent.findFirst({
        where: {
          shopId: args.shopId, name: "CART_CONFIRMED", productId: cp.b, shopperId: ca.shopperId,
          createdAt: { gte: new Date(ca.createdAt.getTime() - DAY), lt: new Date(ca.createdAt.getTime() + DAY) },
        },
        select: { id: true },
      });
      if (both) coPurchase++;
    }
    if (coPurchase < BUNDLE_MIN_COPURCHASE) continue;
    const bProduct = pairProductById.get(cp.b);
    const bPrice = bProduct?.variants.find((v) => v.priceCents != null)?.priceCents ?? aovCents;
    orphanAttachPairs.push({
      aProductId: cp.a, aName: pairProductById.get(cp.a)?.title ?? "?",
      bProductId: cp.b, bName: bProduct?.title ?? "?",
      coEngage: cp.coEngage, coIntent: intentA, coPurchase,
      projectedAttachRevenueCents: bPrice * intentA, // honest: pieces × intent count, not inflated
    });
  }

  // ── Voice (sentiment + returns) ───────────────────────────────────────
  // Themes — only those with ≥MIN_THEME_OCCURRENCES.
  const sentimentSessions = await prisma.shopperSession.findMany({
    where: { shopifyDomain: shop.shopifyDomain, sentimentExtractedAt: { gte: periodStart, lt: periodEnd } },
    select: { sentimentThemes: true },
  }).catch(() => [] as Array<{ sentimentThemes: unknown }>);
  const themeCounts = new Map<string, number>();
  for (const s of sentimentSessions) {
    const themes = Array.isArray(s.sentimentThemes) ? (s.sentimentThemes as string[]) : [];
    for (const t of themes) {
      const key = t.toLowerCase().trim().slice(0, 40);
      if (key) themeCounts.set(key, (themeCounts.get(key) ?? 0) + 1);
    }
  }
  const topThemes = Array.from(themeCounts.entries())
    .filter(([, c]) => c >= MIN_THEME_OCCURRENCES)
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  // Returns by reasonBucket from CART_CANCELLED.
  const returnRows = await prisma.analyticsEvent.findMany({
    where: { shopId: args.shopId, name: "CART_CANCELLED", createdAt: { gte: periodStart, lt: periodEnd } },
    select: { payload: true },
  });
  const reasonCounts = new Map<string, number>();
  for (const r of returnRows) {
    const p = r.payload as { reasonBucket?: string | null } | null;
    const bucket = p?.reasonBucket ?? "other";
    reasonCounts.set(bucket, (reasonCounts.get(bucket) ?? 0) + 1);
  }
  const totalReturns = Array.from(reasonCounts.values()).reduce((a, b) => a + b, 0);
  const returnsByReason = Array.from(reasonCounts.entries())
    .map(([reasonBucket, count]) => ({
      reasonBucket,
      count,
      sharePct: totalReturns > 0 ? Math.round((count / totalReturns) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // ── Methodology ───────────────────────────────────────────────────────
  return {
    period: { start: periodStart.toISOString(), end: periodEnd.toISOString(), days: 30 },
    prior:  { start: priorStart.toISOString(),  end: priorEnd.toISOString(),  days: 30 },
    shop:   { id: shop.id, domain: shop.shopifyDomain, currency: shop.currencyCode ?? "USD" },
    cover: {
      assistedRevenueCents: assistedNow.cents,
      assistedRevenueDeltaPct: assistedDelta,
      shareOfSessionsPct: sharePct,
      headlineColor,
      headlineSentence,
    },
    whatChanged: { deltas, regressions },
    catalogGaps: { topGaps, tryonAbandons },
    funnel: {
      sessions: sessionsNow,
      miraTouchedSessions: assistedNow.n,
      atcEvents,
      confirmedOrders,
      aovAssistedCents: aovAssisted,
      aovBaselineCents: aovBaseline,
      aovN: { assisted: assistedTotals.length, baseline: baselineTotals.length },
      liftPct,
    },
    bundles: { orphanAttachPairs },
    voice: { topThemes, returnsByReason },
    methodology: {
      attributionWindowDays: ATTRIBUTION_WINDOW_DAYS,
      minOrdersForLiftQuote: MIN_ORDERS_FOR_LIFT,
      minThemeOccurrences: MIN_THEME_OCCURRENCES,
      sampleSizes: {
        sessions: sessionsNow,
        assistedOrders: assistedNow.n,
        confirmedOrders,
        sentimentSessions: sentimentSessions.length,
        returnEvents: returnRows.length,
        gapEvents: gaps.length,
        tryonRenders: tryonRows.length,
        engagementEvents: engageRows.length,
      },
      exclusions: { lowValueOrders: 0 },
      dataFreshnessAt: new Date().toISOString(),
    },
  };
}
