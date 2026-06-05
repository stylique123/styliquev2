// Recommendations engine — turns raw signal (catalog gaps, fit accuracy,
// stylist combo performance, mood signal, PDP audits) into actionable rows
// in BrandRecommendation that the dashboard renders per tier.
//
// Each generator:
//   • reads from its source table (with a lookback window)
//   • aggregates into candidate insights
//   • upserts a row keyed by (shopId, kind, dedupeKey) — same evidence within
//     the dedupe window updates the existing row instead of duplicating
//   • tags minTierToView so the dashboard query layer filters correctly
//
// Triggering: call runAllRecommendations(shopId) from a worker job (BullMQ
// already in place) — nightly or on-demand from the dashboard.

import { prisma } from "../db.server";
import type { PlanTier } from "@stylique/types";
import { createRecommendationsService, createOutcomeService } from "@stylique/core";
import { enqueueCreativeSet } from "../queue.server";

// The orchestrator now lives in @stylique/core so both apps/shopify-app and
// apps/worker share the same generator logic. This file keeps only the
// read-side helpers (list / dismiss / markTaken) — the runAll() function
// re-exports the core service bound to our prisma instance.
const _service = createRecommendationsService(prisma);
export const runAllRecommendations: (shopId: string) => Promise<{ written: number }> =
  (shopId) => _service.runAll(shopId);

// Outcome service — measure→learn loop. Bound to the same prisma instance.
const _outcomes = createOutcomeService(prisma);

// Local type aliases used by the read-side functions below. The
// authoritative definitions for these enums live in the Prisma schema.
type RecKind =
  | "CATALOG_GAP" | "WEAK_PDP_CREATIVE" | "FIT_ACCURACY_DRIFT"
  | "TOP_COMBO_TO_PROMOTE" | "UNDERUSED_MOOD" | "TASTE_SEGMENT_EMERGING"
  | "CART_ABANDON_PATTERN" | "STUDIO_PRODUCT_OPPORTUNITY"
  | "STYLIST_DEMAND_SIGNAL" | "CROSS_OFFERING";
type RecSurface = "STUDIO" | "WIDGET" | "STYLIST" | "CATALOG" | "CROSS";
type RecSeverity = "INFO" | "ATTENTION" | "URGENT";

const SEVERITY_WEIGHT: Record<RecSeverity, number> = { URGENT: 3, ATTENTION: 2, INFO: 1 };

function priorityScore(evidence: unknown): number {
  if (!evidence || typeof evidence !== "object") return 0;
  const value = (evidence as { priorityScore?: unknown }).priorityScore;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Read-side for the dashboard. Tier-gated.
export async function listRecommendations(args: {
  shopId: string;
  visibleKinds: RecKind[];
  includeDismissed?: boolean;
}): Promise<Array<{
  id: string; kind: RecKind; severity: RecSeverity; surface: RecSurface;
  title: string; body: string; evidence: unknown;
  actionUrl: string | null; ctaLabel: string | null;
  productId: string | null; generatedAt: Date; dismissedAt: Date | null; takenAt: Date | null;
}>> {
  const rows = await prisma.brandRecommendation.findMany({
    where: {
      shopId: args.shopId,
      kind: { in: args.visibleKinds as RecKind[] },
      ...(args.includeDismissed ? {} : { dismissedAt: null }),
    },
    orderBy: [{ severity: "desc" }, { generatedAt: "desc" }],
    take: 50,
  });
  return rows
  .sort((a, b) => {
    const byPriority = priorityScore(b.evidence) - priorityScore(a.evidence);
    if (Math.abs(byPriority) > 0.0001) return byPriority;
    const bySeverity = SEVERITY_WEIGHT[b.severity as RecSeverity] - SEVERITY_WEIGHT[a.severity as RecSeverity];
    if (bySeverity !== 0) return bySeverity;
    return b.generatedAt.getTime() - a.generatedAt.getTime();
  })
  .map((r) => ({
    id: r.id, kind: r.kind as RecKind, severity: r.severity as RecSeverity,
    surface: r.surface as RecSurface,
    title: r.title, body: r.body, evidence: r.evidence,
    actionUrl: r.actionUrl, ctaLabel: r.ctaLabel,
    productId: r.productId, generatedAt: r.generatedAt,
    dismissedAt: r.dismissedAt, takenAt: r.takenAt,
  }));
}

export async function dismissRecommendation(shopId: string, id: string): Promise<void> {
  await prisma.brandRecommendation.updateMany({
    where: { id, shopId }, data: { dismissedAt: new Date() },
  });
}

export async function markRecommendationTaken(shopId: string, id: string): Promise<void> {
  await prisma.brandRecommendation.updateMany({
    where: { id, shopId }, data: { takenAt: new Date() },
  });

  // Close the loop: record an Outcome with a beforeMetrics snapshot so the
  // nightly resolver can measure whether acting on this recommendation moved
  // the metric it was about. Fire-and-forget — never blocks the CTA, never
  // throws (the OutcomeService swallows all errors internally).
  void (async () => {
    try {
      const rec = await prisma.brandRecommendation.findFirst({
        where: { id, shopId },
        select: { id: true, kind: true, productId: true },
      });
      if (!rec) return;
      const before = await _outcomes.snapshotMetrics(shopId, rec.kind, rec.productId);
      await _outcomes.createOutcome({
        shopId,
        recommendationId: rec.id,
        recommendationType: rec.kind,
        entityId: rec.productId,
        entityType: rec.productId ? "product" : null,
        beforeMetrics: before,
      });
    } catch {
      /* fire-and-forget */
    }
  })();
}

// ─── Execute a recommendation — the EXECUTE step of the loop ────────────────
// Dispatches the concrete action for a recommendation kind, then marks it taken
// (which records the Outcome via markRecommendationTaken). Returns a small
// result describing what was dispatched so the caller can surface a toast.
//
//   • WEAK_PDP_CREATIVE     → create a PENDING CreativeSet + enqueue the
//                             creative-set BullMQ job for the product.
//   • TOP_COMBO_TO_PROMOTE  → create a PENDING CreativeSet seeded with the
//                             combo context + enqueue with combo triggeredBy.
//   • CATALOG_GAP           → append the gap query to
//                             Plan.planFeaturesJson.activeCatalogGaps (capped
//                             at 10) so Mira can read it as live demand.
//   • anything else         → taken-only (no side effect to dispatch).
export type ExecuteResult =
  | { ok: true; dispatched: "creative_set"; setId: string }
  | { ok: true; dispatched: "catalog_gap"; query: string }
  | { ok: true; dispatched: "taken_only" }
  | { ok: false; error: "not_found" | "execute_failed" };

export async function executeRecommendation(
  shopId: string,
  recommendationId: string,
): Promise<ExecuteResult> {
  try {
    const rec = await prisma.brandRecommendation.findFirst({
      where: { id: recommendationId, shopId },
      select: { id: true, kind: true, productId: true, title: true, evidence: true },
    });
    if (!rec) return { ok: false, error: "not_found" };

    const kind = rec.kind as RecKind;

    if (kind === "WEAK_PDP_CREATIVE" && rec.productId) {
      const set = await prisma.creativeSet.create({
        data: {
          shopId,
          productId: rec.productId,
          status: "PENDING",
          brief: { brief: rec.title, source: "recommendation", recommendationId: rec.id },
          triggeredBy: `recommendation:${rec.id}`,
        },
        select: { id: true },
      });
      void enqueueCreativeSet({
        shopId,
        setId: set.id,
        productId: rec.productId,
        triggeredBy: `recommendation:${rec.id}`,
        brief: rec.title,
      }).catch(() => undefined);
      await markRecommendationTaken(shopId, rec.id);
      return { ok: true, dispatched: "creative_set", setId: set.id };
    }

    if (kind === "TOP_COMBO_TO_PROMOTE") {
      const ev = (rec.evidence as { comboName?: string; productIds?: string[] } | null) ?? {};
      const comboName = ev.comboName ?? rec.title;
      // Seed the creative set from the first product in the combo (the anchor)
      // so the worker has a product to render against.
      const anchorProductId = ev.productIds?.[0] ?? rec.productId ?? null;
      if (!anchorProductId) {
        // No product to anchor — record as taken-only.
        await markRecommendationTaken(shopId, rec.id);
        return { ok: true, dispatched: "taken_only" };
      }
      const set = await prisma.creativeSet.create({
        data: {
          shopId,
          productId: anchorProductId,
          status: "PENDING",
          brief: { brief: comboName, sourceComboName: comboName, source: "recommendation", recommendationId: rec.id },
          triggeredBy: `recommendation_combo:${comboName}`,
        },
        select: { id: true },
      });
      void enqueueCreativeSet({
        shopId,
        setId: set.id,
        productId: anchorProductId,
        triggeredBy: `stylist_combo:${comboName}`,
        brief: comboName,
      }).catch(() => undefined);
      await markRecommendationTaken(shopId, rec.id);
      return { ok: true, dispatched: "creative_set", setId: set.id };
    }

    if (kind === "CATALOG_GAP") {
      const ev = (rec.evidence as { query?: string } | null) ?? {};
      const query = (ev.query ?? rec.title).slice(0, 120);
      try {
        const plan = await prisma.plan.findUnique({
          where: { shopId },
          select: { planFeaturesJson: true },
        });
        const features = (plan?.planFeaturesJson as Record<string, unknown> | null) ?? {};
        const existing = Array.isArray(features.activeCatalogGaps)
          ? (features.activeCatalogGaps as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        // De-dupe + cap at 10, newest-first.
        const next = [query, ...existing.filter((q) => q !== query)].slice(0, 10);
        await prisma.plan.update({
          where: { shopId },
          data: { planFeaturesJson: { ...features, activeCatalogGaps: next } as object },
        }).catch(() => undefined);
      } catch {
        /* best-effort — still mark taken below */
      }
      await markRecommendationTaken(shopId, rec.id);
      return { ok: true, dispatched: "catalog_gap", query };
    }

    // Everything else: no concrete action to dispatch, just mark it taken.
    await markRecommendationTaken(shopId, rec.id);
    return { ok: true, dispatched: "taken_only" };
  } catch {
    return { ok: false, error: "execute_failed" };
  }
}
