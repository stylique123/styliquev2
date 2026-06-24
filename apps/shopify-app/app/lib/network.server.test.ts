import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaRuntime } from "@stylique/db";
import { distinctOrderCountFromEvents } from "@stylique/core";

const db = vi.hoisted(() => ({
  shop: { findUnique: vi.fn() },
  shopperSession: { findMany: vi.fn() },
  analyticsEvent: { findMany: vi.fn(), groupBy: vi.fn() },
  tryOnSession: { count: vi.fn() },
  brandTasteSnapshot: { upsert: vi.fn(), findMany: vi.fn() },
  networkBenchmark: { upsert: vi.fn() },
}));

vi.mock("../db.server", () => ({ prisma: db }));

import { recomputeBrandSnapshot } from "./network.server";

describe("distinctOrderCountFromEvents", () => {
  it("groups line-item CART_CONFIRMED rows by order id", () => {
    expect(distinctOrderCountFromEvents([
      { id: "line-1", payload: { orderId: "order-1" } },
      { id: "line-2", payload: { orderId: "order-1" } },
      { id: "line-3", payload: { orderId: "order-2" } },
    ])).toBe(2);
  });

  it("falls back to event ids for older rows without order ids", () => {
    expect(distinctOrderCountFromEvents([
      { id: "event-1", payload: {} },
      { id: "event-2", payload: {} },
    ])).toBe(2);
  });
});

describe("recomputeBrandSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.shop.findUnique.mockResolvedValue({ shopifyDomain: "brand.myshopify.com" });
    db.shopperSession.findMany.mockResolvedValue([
      { tasteVectorJson: { colorFamily: { black: 1 }, silhouette: {}, category: {}, priceTier: {} } },
    ]);
    db.analyticsEvent.findMany.mockResolvedValue([]);
    db.analyticsEvent.groupBy.mockResolvedValue([
      { name: "CHAT_OPENED", _count: { _all: 2 } },
      { name: "CHAT_COMBO_PROPOSED", _count: { _all: 1 } },
      { name: "CART_CONFIRMED", _count: { _all: 2 } },
    ]);
    db.analyticsEvent.findMany.mockImplementation(({ where }: { where?: { name?: string } } = {}) => {
      if (where?.name === "CART_CONFIRMED") {
        return Promise.resolve([
          { id: "line-1", payload: { orderId: "order-1" } },
          { id: "line-2", payload: { orderId: "order-1" } },
        ]);
      }
      return Promise.resolve([]);
    });
    db.tryOnSession.count.mockResolvedValue(7);
    db.brandTasteSnapshot.upsert.mockResolvedValue({});
  });

  it("uses computed taste vectors only and snapshots real try-on sessions", async () => {
    await recomputeBrandSnapshot("shop-1");

    expect(db.shopperSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        shopifyDomain: "brand.myshopify.com",
        tasteVectorJson: { not: PrismaRuntime.AnyNull },
        signalCount: { gte: 3 },
      }),
    }));
    expect(db.tryOnSession.count).toHaveBeenCalledWith({
      where: { shopId: "shop-1", createdAt: expect.any(Object) },
    });
    expect(db.brandTasteSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        cartConfirmed: 1,
        comboCtr: 1,
        fitToCartRate: 0,
        tryOnSessions: 7,
        sampleSize: 1,
      }),
      update: expect.objectContaining({
        cartConfirmed: 1,
        comboCtr: 1,
        fitToCartRate: 0,
        tryOnSessions: 7,
        sampleSize: 1,
      }),
    }));
  });
});
