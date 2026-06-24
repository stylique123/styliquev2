// Layer 3 — brand-wide aggregates + cross-brand network benchmarks.
//
// Two surfaces:
//   • Brand snapshot: per-shop, daily, derived from the last 30 days of
//     interactions. Cached in BrandTasteSnapshot so the dashboard renders
//     instantly without re-aggregating.
//   • Network benchmark: anonymized cross-shop percentiles (p25/p50/p75/p90)
//     per dimension, computed by rolling up all latest snapshots. Powers
//     Ultimate-tier "you're in the top X%" widgets.
//
// Privacy invariants:
//   • Network benchmarks never contain a shopId, brand name, or any field
//     that could identify a contributor.
//   • The contributor count (sampleBrands) must be ≥ 3 before we publish a
//     dimension — k-anonymity floor.
//   • Per-shop snapshots stay tenant-scoped (queried only via shopId).

import { prisma } from "../db.server";
import { PrismaRuntime } from "@stylique/db";
import { distinctOrderCountFromEvents } from "@stylique/core";

const DAY = 86_400_000;
const WINDOW_DAYS = 30;
const NETWORK_MIN_BRANDS = 3;

// ─── Brand snapshot ──────────────────────────────────────────────────────

export async function recomputeBrandSnapshot(shopId: string): Promise<void> {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const shop = await prisma.shop.findUnique({
    where: { id: shopId }, select: { shopifyDomain: true },
  });
  if (!shop) return;

  // Pull every shopper session with enough signal to be representative.
  const sessions = await prisma.shopperSession.findMany({
    where: {
      shopifyDomain: shop.shopifyDomain,
      tasteVectorJson: { not: PrismaRuntime.AnyNull },
      signalCount: { gte: 3 },
    },
    select: { tasteVectorJson: true },
    take: 5000,
  });

  const agg = {
    colorFamily: {} as Record<string, number>,
    silhouette:  {} as Record<string, number>,
    category:    {} as Record<string, number>,
    priceTier:   {} as Record<string, number>,
  };
  for (const s of sessions) {
    const v = s.tasteVectorJson as {
      colorFamily?: Record<string, number>;
      silhouette?:  Record<string, number>;
      category?:    Record<string, number>;
      priceTier?:   Record<string, number>;
    } | null;
    if (!v) continue;
    for (const dim of ["colorFamily", "silhouette", "category", "priceTier"] as const) {
      for (const [k, val] of Object.entries(v[dim] ?? {})) {
        agg[dim][k] = (agg[dim][k] ?? 0) + val;
      }
    }
  }

  // Mood + model splits from raw events (last 30d).
  const moodAgg: Record<string, number> = {};
  const modelAgg: Record<string, number> = {};
  const moodRows = await prisma.analyticsEvent.findMany({
    where: { shopId, name: "WIDGET_MOOD_SELECTED", createdAt: { gte: since } },
    select: { payload: true }, take: 2000,
  });
  for (const e of moodRows) {
    const m = (e.payload as { moodId?: string } | null)?.moodId;
    if (m) moodAgg[m] = (moodAgg[m] ?? 0) + 1;
  }
  const modelRows = await prisma.analyticsEvent.findMany({
    where: { shopId, name: "WIDGET_MODEL_SELECTED", createdAt: { gte: since } },
    select: { payload: true }, take: 2000,
  });
  for (const e of modelRows) {
    const m = (e.payload as { modelId?: string } | null)?.modelId;
    if (m) modelAgg[m] = (modelAgg[m] ?? 0) + 1;
  }

  // Funnel counts.
  const [grouped, confirmedCartRows] = await Promise.all([
    prisma.analyticsEvent.groupBy({
      by: ["name"],
      where: { shopId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "CART_CONFIRMED", createdAt: { gte: since } },
      select: { id: true, payload: true },
      take: 5000,
    }),
  ]);
  const n = (key: string) => grouped.find((g) => g.name === key)?._count._all ?? 0;
  const chatSessions    = n("CHAT_OPENED");
  const combosProposed  = n("CHAT_COMBO_PROPOSED");
  // CART_CONFIRMED is emitted once per line item by the orders webhook; network
  // conversion benchmarks need order-level counts, not line counts.
  const cartConfirmed   = distinctOrderCountFromEvents(confirmedCartRows);
  const signupsClaimed  = n("SIGNUP_CLAIMED");
  const tryOnSessions = await prisma.tryOnSession.count({
    where: { shopId, createdAt: { gte: since } },
  });
  const fitSubmitted    = n("WIDGET_FIT_SUBMITTED");

  const comboCtr      = combosProposed > 0 ? cartConfirmed / combosProposed : 0;
  const signupRate    = chatSessions   > 0 ? signupsClaimed / chatSessions   : 0;
  const fitToCartRate = fitSubmitted   > 0 ? cartConfirmed / fitSubmitted   : 0;

  await prisma.brandTasteSnapshot.upsert({
    where: { shopId_snapshotDate: { shopId, snapshotDate: today } },
    create: {
      shopId, snapshotDate: today,
      colorFamilyJson: normalize(agg.colorFamily) as object,
      silhouetteJson:  normalize(agg.silhouette)  as object,
      categoryJson:    normalize(agg.category)    as object,
      priceTierJson:   normalize(agg.priceTier)   as object,
      moodJson:        normalize(moodAgg)         as object,
      modelJson:       normalize(modelAgg)        as object,
      chatSessions, combosProposed, cartConfirmed, signupsClaimed,
      tryOnSessions, fitSubmitted,
      comboCtr: +comboCtr.toFixed(4),
      signupRate: +signupRate.toFixed(4),
      fitToCartRate: +fitToCartRate.toFixed(4),
      sampleSize: sessions.length,
    },
    update: {
      colorFamilyJson: normalize(agg.colorFamily) as object,
      silhouetteJson:  normalize(agg.silhouette)  as object,
      categoryJson:    normalize(agg.category)    as object,
      priceTierJson:   normalize(agg.priceTier)   as object,
      moodJson:        normalize(moodAgg)         as object,
      modelJson:       normalize(modelAgg)        as object,
      chatSessions, combosProposed, cartConfirmed, signupsClaimed,
      tryOnSessions, fitSubmitted,
      comboCtr: +comboCtr.toFixed(4),
      signupRate: +signupRate.toFixed(4),
      fitToCartRate: +fitToCartRate.toFixed(4),
      sampleSize: sessions.length,
    },
  }).catch(() => undefined);
}

function normalize(m: Record<string, number>): Record<string, number> {
  const total = Object.values(m).reduce((a, b) => a + b, 0);
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) out[k] = +(v / total).toFixed(4);
  return out;
}

// ─── Network benchmark roll-up ──────────────────────────────────────────
// Collects today's snapshots from every shop, computes p25/p50/p75/p90 per
// metric across them, and writes one NetworkBenchmark row per dimension.

export async function recomputeNetworkBenchmarks(): Promise<{ dimensions: number }> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const snaps = await prisma.brandTasteSnapshot.findMany({
    where: { snapshotDate: today },
    select: {
      comboCtr: true, signupRate: true, fitToCartRate: true,
      chatSessions: true, tryOnSessions: true,
    },
  });
  if (snaps.length < NETWORK_MIN_BRANDS) return { dimensions: 0 };

  const dimensions: Record<string, number[]> = {
    combo_ctr:        snaps.map((s) => s.comboCtr),
    signup_rate:      snaps.map((s) => s.signupRate),
    fit_to_cart_rate: snaps.map((s) => s.fitToCartRate),
    chat_volume:      snaps.map((s) => s.chatSessions),
    tryon_volume:     snaps.map((s) => s.tryOnSessions),
  };

  let written = 0;
  for (const [dim, values] of Object.entries(dimensions)) {
    const stats = percentiles(values);
    if (!stats) continue;
    await prisma.networkBenchmark.upsert({
      where: {
        dimension_segment_computedAt: { dimension: dim, segment: "all", computedAt: today },
      },
      create: {
        dimension: dim, segment: "all", computedAt: today,
        p25: stats.p25, p50: stats.p50, p75: stats.p75, p90: stats.p90,
        mean: stats.mean, sampleBrands: snaps.length,
      },
      update: {
        p25: stats.p25, p50: stats.p50, p75: stats.p75, p90: stats.p90,
        mean: stats.mean, sampleBrands: snaps.length,
      },
    }).catch(() => undefined);
    written++;
  }
  return { dimensions: written };
}

function percentiles(values: number[]): { p25: number; p50: number; p75: number; p90: number; mean: number } | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    p25: +at(0.25).toFixed(4), p50: +at(0.50).toFixed(4),
    p75: +at(0.75).toFixed(4), p90: +at(0.90).toFixed(4),
    mean: +mean.toFixed(4),
  };
}

// ─── Read side ──────────────────────────────────────────────────────────

export type BenchmarkReading = {
  dimension: string;
  brandValue: number;
  percentile: number;       // 0-100 — where this brand sits in the network
  network: { p25: number; p50: number; p75: number; p90: number; mean: number; sampleBrands: number };
};

// Returns "your brand's stylist conversion sits at percentile X" rows for
// every benchmarked dimension. Only meaningful when sampleBrands >= 3.
export async function readBenchmarksForShop(shopId: string): Promise<BenchmarkReading[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [snap, benches] = await Promise.all([
    prisma.brandTasteSnapshot.findUnique({ where: { shopId_snapshotDate: { shopId, snapshotDate: today } } }),
    prisma.networkBenchmark.findMany({ where: { computedAt: today, segment: "all" } }),
  ]);
  if (!snap) return [];

  const valueFor = (dim: string): number => {
    switch (dim) {
      case "combo_ctr":         return snap.comboCtr;
      case "signup_rate":       return snap.signupRate;
      case "fit_to_cart_rate":  return snap.fitToCartRate;
      case "chat_volume":       return snap.chatSessions;
      case "tryon_volume":      return snap.tryOnSessions;
      default:                  return 0;
    }
  };

  return benches.map((b) => {
    const v = valueFor(b.dimension);
    // Quick percentile estimate from the 4 anchor points + mean. Good enough
    // for a directional badge; finer estimates can come later.
    let pct = 0;
    if (v >= b.p90) pct = 90;
    else if (v >= b.p75) pct = 75 + 15 * ((v - b.p75) / Math.max(1e-9, b.p90 - b.p75));
    else if (v >= b.p50) pct = 50 + 25 * ((v - b.p50) / Math.max(1e-9, b.p75 - b.p50));
    else if (v >= b.p25) pct = 25 + 25 * ((v - b.p25) / Math.max(1e-9, b.p50 - b.p25));
    else                 pct =      25 * (v / Math.max(1e-9, b.p25));
    return {
      dimension: b.dimension,
      brandValue: v,
      percentile: Math.max(0, Math.min(100, +pct.toFixed(1))),
      network: { p25: b.p25, p50: b.p50, p75: b.p75, p90: b.p90, mean: b.mean, sampleBrands: b.sampleBrands },
    };
  });
}

// Quick read of the latest snapshot for the dashboard.
export async function readLatestSnapshot(shopId: string) {
  return prisma.brandTasteSnapshot.findFirst({
    where: { shopId }, orderBy: { snapshotDate: "desc" },
  });
}
