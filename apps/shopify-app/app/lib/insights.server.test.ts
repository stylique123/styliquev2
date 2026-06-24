import { describe, expect, it } from "vitest";
import { customerSegmentsFromEvidence, realDemandCatalogGapWhere } from "./insights.server";

describe("legacy insights catalog-gap filters", () => {
  it("excludes internal size-chart bookkeeping rows for shop-scoped demand", () => {
    const since = new Date("2026-06-01T00:00:00.000Z");

    expect(realDemandCatalogGapWhere("shop-1", { gte: since })).toEqual({
      shopId: "shop-1",
      createdAt: { gte: since },
      source: { not: "size_chart_extract" },
      NOT: { rawQuery: { startsWith: "no_size_chart" } },
    });
  });

  it("applies the same real-demand exclusion to network trend queries", () => {
    const since = new Date("2026-06-01T00:00:00.000Z");
    const before = new Date("2026-06-15T00:00:00.000Z");

    expect(realDemandCatalogGapWhere(null, { gte: since, lt: before })).toEqual({
      createdAt: { gte: since, lt: before },
      source: { not: "size_chart_extract" },
      NOT: { rawQuery: { startsWith: "no_size_chart" } },
    });
  });
});

describe("ultimate insight customer segments", () => {
  it("requires confirmed cart evidence for high-repeat and single-purchase segments", () => {
    const segments = customerSegmentsFromEvidence(
      [
        { id: "vip-with-cart", signalCount: 12 },
        { id: "engaged-no-cart", signalCount: 9 },
        { id: "low-signal-cart", signalCount: 2 },
      ],
      [
        { shopperId: "vip-with-cart" },
        { shopperId: "low-signal-cart" },
      ],
    );

    expect(segments.highRepeat).toBe(1);
    expect(segments.singlePurchase).toBe(2);
    expect(segments.highEngagementNoPurchase).toBe(1);
  });

  it("does not count signal depth alone as VIP purchase behavior", () => {
    const segments = customerSegmentsFromEvidence(
      Array.from({ length: 11 }, (_, index) => ({ id: `signal-only-${index}`, signalCount: 12 })),
      [],
    );

    expect(segments.highRepeat).toBe(0);
    expect(segments.singlePurchase).toBe(0);
    expect(segments.highEngagementNoPurchase).toBe(11);
    expect(segments.topSegmentInsight).toBe("Collecting shopper data — segments surface after first interactions.");
  });
});
