import { describe, expect, it, vi } from "vitest";
import { createOutcomeService, outcomeCatalogGapWhere } from "../outcomes/service.js";

describe("outcome catalog-gap snapshots", () => {
  it("uses the real shopper-demand catalog gap filter", () => {
    const since = new Date("2026-01-01T00:00:00.000Z");

    expect(outcomeCatalogGapWhere("shop-1", since)).toEqual({
      shopId: "shop-1",
      createdAt: { gte: since },
      source: { not: "size_chart_extract" },
      NOT: { rawQuery: { startsWith: "no_size_chart" } },
    });
  });

  it("does not count size-chart maintenance rows as catalog-gap outcome evidence", async () => {
    const count = vi.fn().mockResolvedValue(3);
    const outcomes = createOutcomeService({ catalogGap: { count } });

    await outcomes.snapshotMetrics("shop-1", "CATALOG_GAP");

    expect(count).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0]?.[0]?.where).toMatchObject({
      shopId: "shop-1",
      source: { not: "size_chart_extract" },
      NOT: { rawQuery: { startsWith: "no_size_chart" } },
    });
  });
});

describe("outcome cart snapshots", () => {
  it("uses distinct confirmed orders for default cart outcome metrics", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "line-1", payload: { orderId: "order-1" } },
      { id: "line-2", payload: { orderId: "order-1" } },
      { id: "line-3", payload: { orderId: "order-2" } },
    ]);
    const count = vi.fn();
    const outcomes = createOutcomeService({ analyticsEvent: { findMany, count } });

    const snapshot = await outcomes.snapshotMetrics("shop-1", "UNKNOWN_RECOMMENDATION");

    expect(snapshot.cartConfirmed).toBe(2);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ shopId: "shop-1", name: "CART_CONFIRMED" }),
      select: { id: true, payload: true },
      take: 5000,
    }));
    expect(count).not.toHaveBeenCalled();
  });

  it("uses distinct confirmed orders for weak-PDP creative conversion evidence", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "line-1", payload: { orderId: "order-1" } },
      { id: "line-2", payload: { orderId: "order-1" } },
    ]);
    const count = vi.fn().mockResolvedValue(4);
    const outcomes = createOutcomeService({ analyticsEvent: { findMany, count } });

    const snapshot = await outcomes.snapshotMetrics("shop-1", "WEAK_PDP_CREATIVE", "product-1");

    expect(snapshot.tryonRequested).toBe(4);
    expect(snapshot.cartConfirmed).toBe(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        shopId: "shop-1",
        productId: "product-1",
        name: "CART_CONFIRMED",
      }),
      select: { id: true, payload: true },
      take: 5000,
    }));
  });
});
