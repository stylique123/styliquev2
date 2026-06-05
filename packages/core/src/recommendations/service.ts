// Recommendations engine — turns raw shopper signal into actionable
// BrandRecommendation rows the dashboard renders per tier.
//
// Lives in @stylique/core so both apps consume it the same way:
//   • apps/shopify-app calls runAll() on dashboard refresh or via webhook
//   • apps/worker calls runAll() from the nightly scheduled job
//
// Factory pattern matches catalog/style/fit services: takes a PrismaClient
// at construction, returns a small service object. No app-side imports.

import type { PrismaClient } from "@stylique/db";
import type { PlanTier } from "@stylique/types";
import { createOutcomeService, type OutcomeWeights } from "../outcomes/service.js";

type RecKind =
  | "CATALOG_GAP" | "WEAK_PDP_CREATIVE" | "FIT_ACCURACY_DRIFT"
  | "TOP_COMBO_TO_PROMOTE" | "UNDERUSED_MOOD" | "TASTE_SEGMENT_EMERGING"
  | "CART_ABANDON_PATTERN" | "STUDIO_PRODUCT_OPPORTUNITY"
  | "STYLIST_DEMAND_SIGNAL" | "CROSS_OFFERING";

type RecSurface = "STUDIO" | "WIDGET" | "STYLIST" | "CATALOG" | "CROSS";
type RecSeverity = "INFO" | "ATTENTION" | "URGENT";

type Candidate = {
  kind: RecKind;
  surface: RecSurface;
  severity: RecSeverity;
  minTier: PlanTier;
  title: string;
  body: string;
  evidence: Record<string, unknown>;
  dedupeKey: string;
  productId?: string;
  source: string;
  actionUrl?: string;
  ctaLabel?: string;
  // Outcome-weighted priority (filled in runAll). Higher = surface sooner.
  priority?: number;
};

// Base priority by severity before outcome weighting is applied.
const SEVERITY_PRIORITY: Record<RecSeverity, number> = {
  URGENT: 3,
  ATTENTION: 2,
  INFO: 1,
};

export interface RecommendationsService {
  runAll(shopId: string): Promise<{ written: number }>;
}

export function createRecommendationsService(prisma: PrismaClient): RecommendationsService {
  async function upsert(shopId: string, c: Candidate): Promise<void> {
    // BrandRecommendation has no dedicated priority column, so the
    // outcome-weighted priority rides along inside `evidence.priorityScore`.
    // The dashboard read layer can sort/boost on it without a schema change.
    const evidence: Record<string, unknown> = {
      ...c.evidence,
      ...(c.priority != null ? { priorityScore: Math.round(c.priority * 1000) / 1000 } : {}),
    };
    await prisma.brandRecommendation.upsert({
      where: { shopId_kind_dedupeKey: { shopId, kind: c.kind, dedupeKey: c.dedupeKey } },
      create: {
        shopId, productId: c.productId,
        kind: c.kind, severity: c.severity, surface: c.surface, minTierToView: c.minTier,
        title: c.title, body: c.body, evidence: evidence as object,
        source: c.source, actionUrl: c.actionUrl, ctaLabel: c.ctaLabel,
        dedupeKey: c.dedupeKey,
      },
      update: {
        severity: c.severity, title: c.title, body: c.body,
        evidence: evidence as object, generatedAt: new Date(),
        actionUrl: c.actionUrl, ctaLabel: c.ctaLabel,
      },
    }).catch(() => undefined);
  }

  // ─── Generator 1: catalog gaps ─────────────────────────────────────────
  async function genCatalogGaps(shopId: string): Promise<Candidate[]> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const gaps = await prisma.catalogGap.groupBy({
      by: ["normalizedQuery"],
      where: { shopId, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { normalizedQuery: "desc" } },
      take: 20,
    });
    const out: Candidate[] = [];
    for (const g of gaps) {
      if (g._count._all < 3) continue;
      out.push({
        kind: "CATALOG_GAP", surface: "CATALOG", severity: g._count._all > 10 ? "URGENT" : "ATTENTION",
        minTier: "GROWTH",
        title: `Shoppers asked for "${g.normalizedQuery}" ${g._count._all}× this month`,
        body: `Your catalog doesn't return strong matches. Consider stocking, restocking, or improving titles/tags.`,
        evidence: { query: g.normalizedQuery, requestCount: g._count._all, windowDays: 30 },
        dedupeKey: `gap:${g.normalizedQuery}`,
        source: "catalog_gap",
        ctaLabel: "Add to buying list",
      });
    }
    return out;
  }

  // ─── Generator 2: weak PDP creative ────────────────────────────────────
  async function genWeakPdp(shopId: string): Promise<Candidate[]> {
    const audits = await prisma.productAudit.findMany({
      where: { shopId, OR: [{ weakImageQuality: true }, { missingTryOnReady: true }] },
      orderBy: { priorityScore: "desc" },
      take: 10,
      select: {
        productId: true, weakImageQuality: true, missingTryOnReady: true,
        missingStyling: true, priorityScore: true,
        product: { select: { title: true, handle: true } },
      },
    });
    return audits.map((a) => ({
      kind: "WEAK_PDP_CREATIVE" as const, surface: "STUDIO" as const,
      severity: (a.priorityScore > 0.7 ? "URGENT" : a.priorityScore > 0.4 ? "ATTENTION" : "INFO") as RecSeverity,
      minTier: "STARTER" as PlanTier,
      title: `Studio could lift "${a.product?.title ?? "this product"}"`,
      body: a.weakImageQuality
        ? `Imagery is below brand bar — generate a 4-still + 1-video set to refresh the PDP.`
        : `PDP is missing try-on-ready angles — Studio can generate them in one click.`,
      evidence: {
        weakImageQuality: a.weakImageQuality, missingTryOnReady: a.missingTryOnReady,
        missingStyling: a.missingStyling, priorityScore: a.priorityScore,
      },
      productId: a.productId,
      dedupeKey: `pdp:${a.productId}`,
      source: "pdp_audit",
      actionUrl: a.product?.handle ? `/admin/studio/new?handle=${a.product.handle}` : undefined,
      ctaLabel: "Generate creative set",
    }));
  }

  // ─── Generator 3: fit accuracy drift ───────────────────────────────────
  async function genFitDrift(shopId: string): Promise<Candidate[]> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const fits = await prisma.analyticsEvent.findMany({
      where: { shopId, name: "SIZE_SELECTED", createdAt: { gte: since } },
      select: { payload: true, productId: true },
      take: 1000,
    });
    if (fits.length < 30) return [];
    const byProduct = new Map<string, { drift: number; total: number }>();
    for (const f of fits) {
      const p = (f.payload as { chosenSize?: string; recommendedSize?: string; sizeDelta?: number } | null) ?? {};
      if (!f.productId) continue;
      const cur = byProduct.get(f.productId) ?? { drift: 0, total: 0 };
      cur.total++;
      if ((p.sizeDelta ?? 0) !== 0 || (p.chosenSize && p.recommendedSize && p.chosenSize !== p.recommendedSize)) cur.drift++;
      byProduct.set(f.productId, cur);
    }
    const out: Candidate[] = [];
    for (const [productId, s] of byProduct) {
      if (s.total < 20) continue;
      const driftRate = s.drift / s.total;
      if (driftRate < 0.3) continue;
      const p = await prisma.product.findUnique({ where: { id: productId }, select: { title: true } });
      out.push({
        kind: "FIT_ACCURACY_DRIFT", surface: "WIDGET",
        severity: driftRate > 0.5 ? "URGENT" : "ATTENTION",
        minTier: "GROWTH",
        title: `Size chart on "${p?.title ?? "product"}" is drifting`,
        body: `${Math.round(driftRate * 100)}% of shoppers (${s.drift}/${s.total}) chose a different size than recommended. Review the chart.`,
        evidence: { driftRate, drift: s.drift, total: s.total, productId },
        productId,
        dedupeKey: `fit:${productId}`,
        source: "fit_accuracy",
        ctaLabel: "Edit size chart",
      });
    }
    return out;
  }

  // ─── Generator 4: top stylist combo ────────────────────────────────────
  async function genTopCombos(shopId: string): Promise<Candidate[]> {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const proposed = await prisma.analyticsEvent.findMany({
      where: { shopId, name: "CHAT_COMBO_PROPOSED", createdAt: { gte: since } },
      select: { payload: true },
      take: 500,
    });
    if (proposed.length < 5) return [];
    const counts = new Map<string, { proposed: number; clicked: number; productIds: string[] }>();
    for (const e of proposed) {
      const p = e.payload as { comboName?: string; productIds?: string[] } | null;
      if (!p?.comboName) continue;
      const cur = counts.get(p.comboName) ?? { proposed: 0, clicked: 0, productIds: p.productIds ?? [] };
      cur.proposed++;
      counts.set(p.comboName, cur);
    }
    const clicks = await prisma.analyticsEvent.findMany({
      where: { shopId, name: "CHAT_PRODUCT_CLICKED", createdAt: { gte: since } },
      select: { payload: true },
      take: 1000,
    });
    for (const e of clicks) {
      const handle = (e.payload as { productHandle?: string } | null)?.productHandle ?? "";
      if (!handle) continue;
      for (const c of counts.values()) {
        if (c.productIds.length) c.clicked++;
      }
    }
    const ranked = [...counts.entries()]
      .map(([name, s]) => ({ name, ...s, ctr: s.proposed > 0 ? s.clicked / s.proposed : 0 }))
      .filter((r) => r.proposed >= 5)
      .sort((a, b) => b.ctr - a.ctr)
      .slice(0, 3);
    return ranked.map((r) => ({
      kind: "TOP_COMBO_TO_PROMOTE" as const, surface: "STYLIST" as const,
      severity: "INFO" as const,
      minTier: "STARTER" as PlanTier,
      title: `"${r.name}" is your top-performing AI combo`,
      body: `Proposed ${r.proposed}× with strong engagement. Pin it to a collection or generate Studio creatives from it.`,
      evidence: { comboName: r.name, proposed: r.proposed, clicked: r.clicked, productIds: r.productIds, ctr: r.ctr },
      dedupeKey: `combo:${r.name}`,
      source: "stylist_combo",
      ctaLabel: "Generate creatives",
    }));
  }

  // ─── Generator 5: mood signal ──────────────────────────────────────────
  async function genMoodSignal(shopId: string): Promise<Candidate[]> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const events = await prisma.analyticsEvent.findMany({
      where: { shopId, name: "WIDGET_MOOD_SELECTED", createdAt: { gte: since } },
      select: { payload: true },
      take: 1000,
    });
    if (events.length < 20) return [];
    const counts = new Map<string, number>();
    for (const e of events) {
      const m = (e.payload as { moodId?: string } | null)?.moodId;
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const out: Candidate[] = [];
    for (const [mood, n] of counts) {
      const share = n / total;
      if (share > 0.4) {
        out.push({
          kind: "UNDERUSED_MOOD", surface: "STYLIST", severity: "INFO",
          minTier: "STARTER",
          title: `Mood "${mood}" is dominating shopper choices`,
          body: `${Math.round(share * 100)}% of mood selections this month. Lean into it in your hero/landing creative.`,
          evidence: { mood, share, count: n, total },
          dedupeKey: `mood-up:${mood}`,
          source: "mood",
        });
      }
    }
    return out;
  }

  return {
    async runAll(shopId: string): Promise<{ written: number }> {
      // Pull the outcome-weight map up front — which recommendation KINDS have
      // actually moved the needle for this shop. Graceful fallback to {} when
      // the OutcomeService / table isn't available (pre-migration, or no
      // resolved outcomes yet) so ranking simply stays neutral.
      let weights: OutcomeWeights = {};
      try {
        weights = await createOutcomeService(prisma).getOutcomeWeights(shopId);
      } catch {
        weights = {};
      }

      const candidates: Candidate[] = [];
      for (const gen of [genCatalogGaps, genWeakPdp, genFitDrift, genTopCombos, genMoodSignal]) {
        try { candidates.push(...(await gen(shopId))); } catch { /* swallow */ }
      }

      // Apply outcome-weighted priority: base priority (by severity) × the
      // learned weight for this kind. A kind that historically IMPROVED gets
      // boosted (×1.5); one that historically WORSENED gets damped (×0.6).
      for (const c of candidates) {
        const base = SEVERITY_PRIORITY[c.severity] ?? 1;
        const w = weights[c.kind]?.weight ?? 1.0;
        c.priority = base * w;
      }

      // Write highest-priority first so the dashboard's ordered read surfaces
      // the highest-leverage move even when it caps the result set.
      const ordered = [...candidates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      for (const c of ordered) {
        await upsert(shopId, c);
      }

      // GC dismissed/old recs.
      await prisma.brandRecommendation.deleteMany({
        where: {
          shopId,
          OR: [
            { dismissedAt: { lt: new Date(Date.now() - 60 * 86_400_000) } },
            { generatedAt: { lt: new Date(Date.now() - 90 * 86_400_000) }, takenAt: null },
          ],
        },
      }).catch(() => undefined);
      return { written: candidates.length };
    },
  };
}
