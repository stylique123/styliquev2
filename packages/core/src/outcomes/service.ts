// Outcome tracking — the measure→learn half of the Stylique intelligence loop.
//
// The loop (CLAUDE.md §1): observe → recommend → EXECUTE → MEASURE → LEARN.
// The audit found steps 5–7 broken — recommendations were generated but nothing
// closed the loop by checking whether acting on them actually moved the metric
// they were about. This service is that closing.
//
// Flow:
//   1. Brand marks a BrandRecommendation taken / executes it →
//      `createOutcome()` snapshots the relevant metrics (beforeMetrics) and sets
//      a resolution deadline (resolutionDue = now + resolutionWindowDays).
//   2. A nightly worker (apps/worker/src/jobs/outcome-resolver.ts) finds rows
//      whose window has elapsed (`getDueOutcomes()`) and calls `resolveOutcome()`
//      — re-snapshots (afterMetrics), computes the delta, classifies the result.
//   3. `getOutcomeWeights()` aggregates resolved outcomes per recommendation kind
//      into a priority multiplier the recommendations engine reads, so the
//      ranking learns which kinds actually work for THIS shop.
//
// Factory/service pattern matches recommendations/service.ts + usage/service.ts.
// Prisma is typed as `any` deliberately — this module ships before its own
// `prisma generate` runs in some build orders, and the Outcome delegate may not
// exist on the generated client type yet. Every call is wrapped in try/catch so
// a missing table / delegate degrades to a safe fallback rather than throwing.

import { distinctOrderCountFromEvents } from "../analytics/order-events.js";

// ─── Public types ───────────────────────────────────────────────────────────

export type OutcomeStatus = "PENDING" | "RESOLVED" | "INCONCLUSIVE" | "ABANDONED";
export type OutcomeResult = "IMPROVED" | "NO_CHANGE" | "WORSENED";

export type MetricSnapshot = Record<string, number>;

export interface CreateOutcomeInput {
  shopId: string;
  recommendationId?: string | null;
  recommendationType: string;
  workflowId?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  /** Pre-computed snapshot. When omitted, snapshotMetrics() is called. */
  beforeMetrics?: MetricSnapshot;
  resolutionWindowDays?: number;
}

export interface OutcomeRow {
  id: string;
  shopId: string;
  recommendationId: string | null;
  recommendationType: string;
  workflowId: string | null;
  entityId: string | null;
  entityType: string | null;
  beforeMetrics: MetricSnapshot;
  afterMetrics: MetricSnapshot;
  delta: MetricSnapshot;
  status: OutcomeStatus;
  resultClass: OutcomeResult | null;
  confidenceScore: number;
  resolutionWindowDays: number;
  resolutionDue: Date;
  resolvedAt: Date | null;
  learnedSignal: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutcomeClassification {
  status: OutcomeStatus;
  resultClass: OutcomeResult | null;
  delta: MetricSnapshot;
  confidenceScore: number;
  learnedSignal: string;
}

export interface OutcomeWeight {
  recommendationType: string;
  sampleSize: number;
  successRate: number; // fraction of resolved outcomes that IMPROVED
  avgImpact: number; // mean primary-metric delta (fraction)
  weight: number; // priority multiplier: 1.5 / 1.0 / 0.6
}

export type OutcomeWeights = Record<string, OutcomeWeight>;

export function outcomeCatalogGapWhere(shopId: string, since: Date) {
  return {
    shopId,
    createdAt: { gte: since },
    source: { not: "size_chart_extract" },
    NOT: { rawQuery: { startsWith: "no_size_chart" } },
  };
}

// ─── Tunables ─────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_DAYS = 7;
const SNAPSHOT_WINDOW_DAYS = 7; // metric lookback for before/after snapshots
const MIN_SAMPLE_FOR_CONFIDENCE = 20; // confidence saturates here
const MIN_SAMPLE_FOR_CONCLUSIVE = 5; // below this → INCONCLUSIVE
const IMPROVE_THRESHOLD = 0.1; // +10% primary delta → IMPROVED
const WORSEN_THRESHOLD = -0.1; // −10% primary delta → WORSENED
const WEIGHT_MIN_SAMPLE = 3; // need at least this many resolved to weight

export interface OutcomeService {
  createOutcome(input: CreateOutcomeInput): Promise<OutcomeRow | null>;
  snapshotMetrics(
    shopId: string,
    recommendationType: string,
    entityId?: string | null,
  ): Promise<MetricSnapshot>;
  resolveOutcome(outcomeId: string): Promise<OutcomeClassification | null>;
  getOutcomeWeights(shopId: string): Promise<OutcomeWeights>;
  getDueOutcomes(): Promise<OutcomeRow[]>;
}

export function createOutcomeService(prisma: any): OutcomeService {
  // Map a recommendation type → its primary metric key. The primary key drives
  // the IMPROVED/WORSENED classification; secondary keys are recorded too.
  function primaryMetricKey(recommendationType: string): string {
    switch (recommendationType) {
      case "CATALOG_GAP":
        return "gapQueries"; // fewer unmet queries = improvement → see signed delta below
      case "WEAK_PDP_CREATIVE":
        return "cartConfirmed";
      case "TOP_COMBO_TO_PROMOTE":
        return "comboProposed";
      default:
        return "cartConfirmed";
    }
  }

  // Some metrics are "lower is better" (a catalog gap shrinking = good). We flip
  // the sign for those so a positive delta always means "improved".
  function isLowerBetter(recommendationType: string): boolean {
    return recommendationType === "CATALOG_GAP";
  }

  async function snapshotMetrics(
    shopId: string,
    recommendationType: string,
    entityId?: string | null,
  ): Promise<MetricSnapshot> {
    const since = new Date(Date.now() - SNAPSHOT_WINDOW_DAYS * 86_400_000);
    const snap: MetricSnapshot = {};

    try {
      switch (recommendationType) {
        case "CATALOG_GAP": {
          // The gap shrinking = the brand stocked/relabelled and queries now
          // return matches. Count only real shopper-demand gaps in the window;
          // maintenance rows from size-chart extraction must not teach outcomes.
          const gapQueries = await prisma.catalogGap
            .count({ where: outcomeCatalogGapWhere(shopId, since) })
            .catch(() => 0);
          snap.gapQueries = gapQueries ?? 0;
          break;
        }
        case "WEAK_PDP_CREATIVE": {
          // Did the PDP for this product start converting / get tried on more?
          const where: Record<string, unknown> = {
            shopId,
            createdAt: { gte: since },
          };
          if (entityId) where.productId = entityId;
          const [tryon, cartRows] = await Promise.all([
            prisma.analyticsEvent
              .count({ where: { ...where, name: "TRYON_RENDER_REQUESTED" } })
              .catch(() => 0),
            prisma.analyticsEvent
              .findMany({
                where: { ...where, name: "CART_CONFIRMED" },
                select: { id: true, payload: true },
                take: 5000,
              })
              .catch(() => []),
          ]);
          snap.tryonRequested = tryon ?? 0;
          snap.cartConfirmed = distinctOrderCountFromEvents(cartRows ?? []);
          break;
        }
        case "TOP_COMBO_TO_PROMOTE": {
          const [proposed, voted, addAll] = await Promise.all([
            prisma.analyticsEvent
              .count({ where: { shopId, name: "CHAT_COMBO_PROPOSED", createdAt: { gte: since } } })
              .catch(() => 0),
            prisma.analyticsEvent
              .count({ where: { shopId, name: "CHAT_COMBO_VOTED", createdAt: { gte: since } } })
              .catch(() => 0),
            prisma.analyticsEvent
              .count({ where: { shopId, name: "COMBO_ADD_ALL", createdAt: { gte: since } } })
              .catch(() => 0),
          ]);
          snap.comboProposed = proposed ?? 0;
          snap.comboVoted = voted ?? 0;
          snap.comboAddAll = addAll ?? 0;
          break;
        }
        default: {
          const cartRows = await prisma.analyticsEvent
            .findMany({
              where: { shopId, name: "CART_CONFIRMED", createdAt: { gte: since } },
              select: { id: true, payload: true },
              take: 5000,
            })
            .catch(() => []);
          snap.cartConfirmed = distinctOrderCountFromEvents(cartRows ?? []);
          break;
        }
      }
    } catch {
      // Any unexpected failure → empty snapshot (the resolver treats this as
      // INCONCLUSIVE via the sample-size floor below).
      return {};
    }

    return snap;
  }

  async function createOutcome(input: CreateOutcomeInput): Promise<OutcomeRow | null> {
    try {
      const windowDays = input.resolutionWindowDays ?? DEFAULT_WINDOW_DAYS;
      const before =
        input.beforeMetrics ??
        (await snapshotMetrics(input.shopId, input.recommendationType, input.entityId));
      const resolutionDue = new Date(Date.now() + windowDays * 86_400_000);

      const row = await prisma.outcome.create({
        data: {
          shopId: input.shopId,
          recommendationId: input.recommendationId ?? null,
          recommendationType: input.recommendationType,
          workflowId: input.workflowId ?? null,
          entityId: input.entityId ?? null,
          entityType: input.entityType ?? null,
          beforeMetrics: before as object,
          afterMetrics: {} as object,
          delta: {} as object,
          status: "PENDING",
          confidenceScore: 0,
          resolutionWindowDays: windowDays,
          resolutionDue,
          learnedSignal: "",
        },
      });
      return row as OutcomeRow;
    } catch {
      // recommendationId is @unique — a duplicate (already-recorded) create
      // throws; that's fine, we treat it as a no-op. Missing table also lands
      // here in pre-migration builds.
      return null;
    }
  }

  function classify(
    recommendationType: string,
    before: MetricSnapshot,
    after: MetricSnapshot,
  ): OutcomeClassification {
    const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
    const delta: MetricSnapshot = {};
    const human: string[] = [];

    for (const key of keys) {
      const b = before[key] ?? 0;
      const a = after[key] ?? 0;
      const pct = (a - b) / Math.max(b, 1); // fraction change, guarded denom
      delta[key] = Math.round(pct * 1000) / 1000;
      const rawChange = a - b;
      if (rawChange !== 0) {
        human.push(`${key}: ${b}→${a} (${pct >= 0 ? "+" : ""}${Math.round(pct * 100)}%)`);
      }
    }

    const pk = primaryMetricKey(recommendationType);
    let primaryDelta = delta[pk] ?? 0;
    if (isLowerBetter(recommendationType)) primaryDelta = -primaryDelta;

    // Sample size = the larger of the before/after primary observation counts.
    const sampleSize = Math.max(before[pk] ?? 0, after[pk] ?? 0);
    const confidenceScore =
      Math.round(Math.min(sampleSize / MIN_SAMPLE_FOR_CONFIDENCE, 1) * 100) / 100;

    let status: OutcomeStatus;
    let resultClass: OutcomeResult | null;

    if (sampleSize < MIN_SAMPLE_FOR_CONCLUSIVE) {
      status = "INCONCLUSIVE";
      resultClass = null;
    } else {
      status = "RESOLVED";
      if (primaryDelta > IMPROVE_THRESHOLD) resultClass = "IMPROVED";
      else if (primaryDelta < WORSEN_THRESHOLD) resultClass = "WORSENED";
      else resultClass = "NO_CHANGE";
    }

    const verdict =
      status === "INCONCLUSIVE"
        ? `Inconclusive — only ${sampleSize} ${pk} observations (need ${MIN_SAMPLE_FOR_CONCLUSIVE}+).`
        : resultClass === "IMPROVED"
          ? `Improved — ${pk} moved +${Math.round(primaryDelta * 100)}% after acting.`
          : resultClass === "WORSENED"
            ? `Worsened — ${pk} moved ${Math.round(primaryDelta * 100)}% after acting.`
            : `No meaningful change in ${pk} (${Math.round(primaryDelta * 100)}%).`;

    const learnedSignal = human.length
      ? `${verdict} [${human.join(", ")}]`
      : verdict;

    return { status, resultClass, delta, confidenceScore, learnedSignal };
  }

  async function resolveOutcome(outcomeId: string): Promise<OutcomeClassification | null> {
    try {
      const existing = await prisma.outcome
        .findUnique({ where: { id: outcomeId } })
        .catch(() => null);
      if (!existing) return null;

      const before: MetricSnapshot =
        (existing.beforeMetrics as MetricSnapshot | null) ?? {};
      const after = await snapshotMetrics(
        existing.shopId,
        existing.recommendationType,
        existing.entityId,
      );

      const cls = classify(existing.recommendationType, before, after);

      await prisma.outcome
        .update({
          where: { id: outcomeId },
          data: {
            afterMetrics: after as object,
            delta: cls.delta as object,
            status: cls.status,
            resultClass: cls.resultClass,
            confidenceScore: cls.confidenceScore,
            learnedSignal: cls.learnedSignal,
            resolvedAt: new Date(),
          },
        })
        .catch(() => undefined);

      return cls;
    } catch {
      return null;
    }
  }

  async function getOutcomeWeights(shopId: string): Promise<OutcomeWeights> {
    try {
      const resolved: any[] = await prisma.outcome
        .findMany({
          where: { shopId, status: "RESOLVED" },
          select: {
            recommendationType: true,
            resultClass: true,
            delta: true,
          },
          take: 1000,
        })
        .catch(() => []);

      const byType = new Map<
        string,
        { total: number; improved: number; impactSum: number; impactN: number }
      >();

      for (const r of resolved) {
        const t = r.recommendationType as string;
        const g = byType.get(t) ?? { total: 0, improved: 0, impactSum: 0, impactN: 0 };
        g.total += 1;
        if (r.resultClass === "IMPROVED") g.improved += 1;
        const delta = (r.delta as MetricSnapshot | null) ?? {};
        const pk = primaryMetricKey(t);
        if (pk in delta) {
          let d = delta[pk] ?? 0;
          if (isLowerBetter(t)) d = -d;
          g.impactSum += d;
          g.impactN += 1;
        }
        byType.set(t, g);
      }

      const out: OutcomeWeights = {};
      for (const [recommendationType, g] of byType) {
        const successRate = g.total > 0 ? g.improved / g.total : 0;
        const avgImpact = g.impactN > 0 ? g.impactSum / g.impactN : 0;
        // Below the minimum sample we don't trust the signal → neutral weight.
        let weight = 1.0;
        if (g.total >= WEIGHT_MIN_SAMPLE) {
          if (successRate > 0.7) weight = 1.5;
          else if (successRate < 0.4) weight = 0.6;
          else weight = 1.0;
        }
        out[recommendationType] = {
          recommendationType,
          sampleSize: g.total,
          successRate: Math.round(successRate * 100) / 100,
          avgImpact: Math.round(avgImpact * 1000) / 1000,
          weight,
        };
      }
      return out;
    } catch {
      return {};
    }
  }

  async function getDueOutcomes(): Promise<OutcomeRow[]> {
    try {
      const rows: any[] = await prisma.outcome
        .findMany({
          where: { status: "PENDING", resolutionDue: { lte: new Date() } },
          orderBy: { resolutionDue: "asc" },
          take: 500,
        })
        .catch(() => []);
      return rows as OutcomeRow[];
    } catch {
      return [];
    }
  }

  return {
    createOutcome,
    snapshotMetrics,
    resolveOutcome,
    getOutcomeWeights,
    getDueOutcomes,
  };
}
