import { describe, it, expect } from "vitest";
import { createRecommendationsService } from "../recommendations/service.js";

// ─── Extended fake Prisma for recommendations ─────────────────────────────
// The recommendations service calls:
//   prisma.catalogGap.groupBy
//   prisma.productAudit.findMany (with nested product select)
//   prisma.analyticsEvent.findMany
//   prisma.product.findUnique
//   prisma.brandRecommendation.upsert
//   prisma.brandRecommendation.deleteMany

type CatalogGapRow = { shopId: string; normalizedQuery: string; createdAt: Date };
type AuditRow = {
  id: string; shopId: string; productId: string;
  weakImageQuality: boolean; missingTryOnReady: boolean;
  missingStyling: boolean; priorityScore: number;
  product?: { title: string; handle: string } | null;
};
type AnalyticsRow = { shopId: string; name: string; payload: unknown; createdAt: Date; productId?: string | null };
type ProductRow = { id: string; title: string };
type BrandRec = {
  shopId: string; kind: string; dedupeKey: string;
  severity: string; title: string; body: string; evidence: unknown;
  source: string; actionUrl?: string; ctaLabel?: string;
  generatedAt: Date; dismissedAt?: Date | null; takenAt?: Date | null;
  productId?: string | null; surface: string; minTierToView: string;
};

let idSeq = 0;
const uid = () => `fake_${++idSeq}`;

function createFakeRecommendationPrisma(initial?: {
  catalogGaps?: CatalogGapRow[];
  productAudits?: AuditRow[];
  analyticsEvents?: AnalyticsRow[];
  products?: ProductRow[];
}) {
  const catalogGaps: CatalogGapRow[] = initial?.catalogGaps ?? [];
  const productAudits: AuditRow[] = initial?.productAudits ?? [];
  const analyticsEvents: AnalyticsRow[] = initial?.analyticsEvents ?? [];
  const products: Map<string, ProductRow> = new Map(
    (initial?.products ?? []).map((p) => [p.id, p]),
  );
  const brandRecs: Map<string, BrandRec> = new Map();

  return {
    _state: { catalogGaps, productAudits, analyticsEvents, products, brandRecs },

    catalogGap: {
      async groupBy({ by, where, _count, orderBy, take }: any) {
        const since: Date = where?.createdAt?.gte ?? new Date(0);
        const filtered = catalogGaps.filter(
          (g) => g.shopId === where?.shopId && g.createdAt >= since,
        );
        // Group by normalizedQuery
        const counts = new Map<string, number>();
        for (const g of filtered) {
          counts.set(g.normalizedQuery, (counts.get(g.normalizedQuery) ?? 0) + 1);
        }
        const rows = [...counts.entries()].map(([q, n]) => ({
          normalizedQuery: q,
          _count: { _all: n },
        }));
        rows.sort((a, b) => b._count._all - a._count._all);
        return rows.slice(0, take ?? rows.length);
      },
    },

    productAudit: {
      async findMany({ where, orderBy, take, select }: any) {
        let out = productAudits.filter((a) => {
          if (where?.shopId && a.shopId !== where.shopId) return false;
          if (where?.OR) {
            return where.OR.some((cond: any) => {
              if ("weakImageQuality" in cond) return a.weakImageQuality === cond.weakImageQuality;
              if ("missingTryOnReady" in cond) return a.missingTryOnReady === cond.missingTryOnReady;
              return false;
            });
          }
          return true;
        });
        out.sort((a, b) => b.priorityScore - a.priorityScore);
        if (take) out = out.slice(0, take);
        // Simulate the nested product select
        return out.map((a) => ({
          productId: a.productId,
          weakImageQuality: a.weakImageQuality,
          missingTryOnReady: a.missingTryOnReady,
          missingStyling: a.missingStyling,
          priorityScore: a.priorityScore,
          product: a.product ?? null,
        }));
      },
    },

    analyticsEvent: {
      async findMany({ where, select, take }: any) {
        let out = analyticsEvents.filter((e) => {
          if (where?.shopId && e.shopId !== where.shopId) return false;
          if (where?.name && e.name !== where.name) return false;
          if (where?.createdAt?.gte && e.createdAt < where.createdAt.gte) return false;
          return true;
        });
        if (take) out = out.slice(0, take);
        if (select) {
          return out.map((e) => {
            const result: Record<string, unknown> = {};
            if (select.payload) result.payload = e.payload;
            if (select.productId) result.productId = e.productId ?? null;
            return result;
          });
        }
        return out;
      },
    },

    product: {
      async findUnique({ where, select }: any) {
        const p = products.get(where.id);
        if (!p) return null;
        if (select) {
          const result: Record<string, unknown> = {};
          if (select.title) result.title = p.title;
          return result;
        }
        return p;
      },
    },

    brandRecommendation: {
      async upsert({ where, create, update }: any) {
        const { shopId, kind, dedupeKey } = where.shopId_kind_dedupeKey;
        const key = `${shopId}|${kind}|${dedupeKey}`;
        const existing = brandRecs.get(key);
        if (existing) {
          Object.assign(existing, update, { generatedAt: new Date() });
          return existing;
        }
        const rec: BrandRec = {
          ...create,
          id: uid(),
          generatedAt: new Date(),
          dismissedAt: null,
          takenAt: null,
        };
        brandRecs.set(key, rec);
        return rec;
      },
      async deleteMany(_args: any) {
        return { count: 0 };
      },
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("createRecommendationsService — runAll returns written count", () => {
  it("returns { written: 0 } when there is no data", async () => {
    const prisma = createFakeRecommendationPrisma();
    const svc = createRecommendationsService(prisma as any);
    const r = await svc.runAll("shop-1");
    expect(r).toEqual({ written: 0 });
  });

  it("written count equals the number of candidates generated", async () => {
    const prisma = createFakeRecommendationPrisma({
      productAudits: [
        {
          id: "audit-1",
          shopId: "shop-1",
          productId: "prod-1",
          weakImageQuality: true,
          missingTryOnReady: false,
          missingStyling: true,
          priorityScore: 0.8,
          product: { title: "Blue Shirt", handle: "blue-shirt" },
        },
      ],
    });
    const svc = createRecommendationsService(prisma as any);
    const r = await svc.runAll("shop-1");
    expect(r.written).toBe(1);
  });
});

describe("createRecommendationsService — CATALOG_GAP generator", () => {
  it("produces CATALOG_GAP recs for queries with 3+ hits", async () => {
    const shopId = "shop-1";
    const since = new Date(Date.now() - 5 * 86_400_000); // 5 days ago (within 30-day window)
    const prisma = createFakeRecommendationPrisma({
      catalogGaps: [
        { shopId, normalizedQuery: "linen blazer", createdAt: since },
        { shopId, normalizedQuery: "linen blazer", createdAt: since },
        { shopId, normalizedQuery: "linen blazer", createdAt: since },
        { shopId, normalizedQuery: "linen blazer", createdAt: since }, // 4 hits
        { shopId, normalizedQuery: "rare item", createdAt: since },    // only 1 hit
      ],
    });
    const svc = createRecommendationsService(prisma as any);
    const r = await svc.runAll(shopId);
    expect(r.written).toBe(1); // only "linen blazer" qualifies (≥3 hits)
    const recs = [...prisma._state.brandRecs.values()];
    expect(recs[0]!.kind).toBe("CATALOG_GAP");
    expect(recs[0]!.title).toContain("linen blazer");
  });

  it("ignores queries from other shops", async () => {
    const since = new Date(Date.now() - 1 * 86_400_000);
    const prisma = createFakeRecommendationPrisma({
      catalogGaps: [
        { shopId: "shop-2", normalizedQuery: "blazer", createdAt: since },
        { shopId: "shop-2", normalizedQuery: "blazer", createdAt: since },
        { shopId: "shop-2", normalizedQuery: "blazer", createdAt: since },
      ],
    });
    const svc = createRecommendationsService(prisma as any);
    const r = await svc.runAll("shop-1"); // different shop
    expect(r.written).toBe(0);
  });

  it("sets severity URGENT for queries with >10 hits", async () => {
    const since = new Date(Date.now() - 1 * 86_400_000);
    const shopId = "shop-1";
    const gaps: CatalogGapRow[] = Array.from({ length: 12 }, () => ({
      shopId, normalizedQuery: "velvet suit", createdAt: since,
    }));
    const prisma = createFakeRecommendationPrisma({ catalogGaps: gaps });
    const svc = createRecommendationsService(prisma as any);
    await svc.runAll(shopId);
    const recs = [...prisma._state.brandRecs.values()];
    expect(recs[0]!.severity).toBe("URGENT");
  });
});

describe("createRecommendationsService — WEAK_PDP_CREATIVE generator", () => {
  it("produces WEAK_PDP_CREATIVE recs for audits with weak images", async () => {
    const shopId = "shop-1";
    const prisma = createFakeRecommendationPrisma({
      productAudits: [
        {
          id: "a1", shopId, productId: "prod-1",
          weakImageQuality: true, missingTryOnReady: false,
          missingStyling: false, priorityScore: 0.75,
          product: { title: "Evening Gown", handle: "evening-gown" },
        },
      ],
    });
    const svc = createRecommendationsService(prisma as any);
    const r = await svc.runAll(shopId);
    expect(r.written).toBe(1);
    const recs = [...prisma._state.brandRecs.values()];
    expect(recs[0]!.kind).toBe("WEAK_PDP_CREATIVE");
    expect(recs[0]!.title).toContain("Evening Gown");
  });

  it("produces WEAK_PDP_CREATIVE for missingTryOnReady audits", async () => {
    const shopId = "shop-1";
    const prisma = createFakeRecommendationPrisma({
      productAudits: [
        {
          id: "a1", shopId, productId: "prod-2",
          weakImageQuality: false, missingTryOnReady: true,
          missingStyling: false, priorityScore: 0.5,
          product: { title: "Silk Blouse", handle: "silk-blouse" },
        },
      ],
    });
    const svc = createRecommendationsService(prisma as any);
    await svc.runAll(shopId);
    const recs = [...prisma._state.brandRecs.values()];
    expect(recs[0]!.kind).toBe("WEAK_PDP_CREATIVE");
    expect(recs[0]!.body).toContain("try-on-ready");
  });

  it("sets severity URGENT for priorityScore > 0.7", async () => {
    const shopId = "shop-1";
    const prisma = createFakeRecommendationPrisma({
      productAudits: [
        {
          id: "a1", shopId, productId: "prod-3",
          weakImageQuality: true, missingTryOnReady: false,
          missingStyling: false, priorityScore: 0.9,
          product: { title: "High Priority", handle: "high-priority" },
        },
      ],
    });
    const svc = createRecommendationsService(prisma as any);
    await svc.runAll(shopId);
    const recs = [...prisma._state.brandRecs.values()];
    expect(recs[0]!.severity).toBe("URGENT");
  });

  it("sets severity INFO for priorityScore <= 0.4", async () => {
    const shopId = "shop-1";
    const prisma = createFakeRecommendationPrisma({
      productAudits: [
        {
          id: "a1", shopId, productId: "prod-4",
          weakImageQuality: true, missingTryOnReady: false,
          missingStyling: false, priorityScore: 0.3,
          product: { title: "Low Priority", handle: "low-priority" },
        },
      ],
    });
    const svc = createRecommendationsService(prisma as any);
    await svc.runAll(shopId);
    const recs = [...prisma._state.brandRecs.values()];
    expect(recs[0]!.severity).toBe("INFO");
  });

  it("handles missing product gracefully (null product)", async () => {
    const shopId = "shop-1";
    const prisma = createFakeRecommendationPrisma({
      productAudits: [
        {
          id: "a1", shopId, productId: "prod-99",
          weakImageQuality: true, missingTryOnReady: false,
          missingStyling: false, priorityScore: 0.5,
          product: null,
        },
      ],
    });
    const svc = createRecommendationsService(prisma as any);
    const r = await svc.runAll(shopId);
    expect(r.written).toBe(1);
    const recs = [...prisma._state.brandRecs.values()];
    expect(recs[0]!.title).toContain("this product");
  });
});

describe("createRecommendationsService — FIT_ACCURACY_DRIFT generator", () => {
  it("skips when fewer than 30 SIZE_SELECTED events", async () => {
    const shopId = "shop-1";
    const prisma = createFakeRecommendationPrisma({
      analyticsEvents: Array.from({ length: 29 }, (_, i) => ({
        shopId,
        name: "SIZE_SELECTED",
        payload: { chosenSize: "L", recommendedSize: "M", sizeDelta: 1 },
        productId: "prod-1",
        createdAt: new Date(Date.now() - 1000 * i),
      })),
    });
    const svc = createRecommendationsService(prisma as any);
    const r = await svc.runAll(shopId);
    // Only FIT events, not enough — no recs
    expect(r.written).toBe(0);
  });

  it("produces FIT_ACCURACY_DRIFT when drift rate > 30%", async () => {
    const shopId = "shop-1";
    const productId = "prod-drift";
    // Create 30 events for one product, 20 with drift (>30%)
    const events: AnalyticsRow[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({
        shopId, name: "SIZE_SELECTED",
        payload: { chosenSize: "L", recommendedSize: "M", sizeDelta: 1 },
        productId, createdAt: new Date(Date.now() - 1000 * i),
      });
    }
    for (let i = 0; i < 10; i++) {
      events.push({
        shopId, name: "SIZE_SELECTED",
        payload: { chosenSize: "M", recommendedSize: "M", sizeDelta: 0 },
        productId, createdAt: new Date(Date.now() - 1000 * i),
      });
    }
    const prisma = createFakeRecommendationPrisma({
      analyticsEvents: events,
      products: [{ id: productId, title: "Drift Shirt" }],
    });
    const svc = createRecommendationsService(prisma as any);
    const r = await svc.runAll(shopId);
    expect(r.written).toBe(1);
    const recs = [...prisma._state.brandRecs.values()];
    expect(recs[0]!.kind).toBe("FIT_ACCURACY_DRIFT");
  });
});

describe("createRecommendationsService — deduplication via upsert", () => {
  it("upserting same rec twice results in only one stored rec", async () => {
    const shopId = "shop-1";
    const since = new Date(Date.now() - 1 * 86_400_000);
    const prisma = createFakeRecommendationPrisma({
      productAudits: [
        {
          id: "a1", shopId, productId: "prod-1",
          weakImageQuality: true, missingTryOnReady: false,
          missingStyling: false, priorityScore: 0.8,
          product: { title: "Test Shirt", handle: "test-shirt" },
        },
      ],
    });
    const svc = createRecommendationsService(prisma as any);

    await svc.runAll(shopId);
    await svc.runAll(shopId);

    // Should only have 1 rec (upserted, not duplicated)
    expect(prisma._state.brandRecs.size).toBe(1);
  });
});

describe("createRecommendationsService — runAll swallows generator errors", () => {
  it("still returns { written: 0 } when all generators fail", async () => {
    // Fake prisma that throws on every call
    const brokenPrisma = {
      catalogGap: { async groupBy() { throw new Error("db error"); } },
      productAudit: { async findMany() { throw new Error("db error"); } },
      analyticsEvent: { async findMany() { throw new Error("db error"); } },
      product: { async findUnique() { throw new Error("db error"); } },
      brandRecommendation: {
        async upsert() { throw new Error("db error"); },
        async deleteMany() { return { count: 0 }; },
      },
    };

    const svc = createRecommendationsService(brokenPrisma as any);
    // Should not throw
    const r = await svc.runAll("shop-1");
    expect(r.written).toBe(0);
  });
});
