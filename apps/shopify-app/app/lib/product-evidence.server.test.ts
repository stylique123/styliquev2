import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  product: { findMany: vi.fn() },
}));

vi.mock("../db.server", () => ({ prisma: db }));

import { validateShopProductEvidence } from "./product-evidence.server";

describe("validateShopProductEvidence", () => {
  const cartSuccessEvents = new Set(["CART_FROM_TRYON", "CART_FROM_WIDGET_STYLE"]);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through non-cart events without product lookup", async () => {
    const result = await validateShopProductEvidence({
      shopId: "shop-1",
      eventName: "MIRA_BEHAVIORAL_TRIGGER_FIRED",
      payload: { triggerType: "product_media_focus" },
      cartSuccessEvents,
    });

    expect(result).toEqual({
      ok: true,
      productId: undefined,
      payload: { triggerType: "product_media_focus" },
    });
    expect(db.product.findMany).not.toHaveBeenCalled();
  });

  it("canonicalizes non-cart product evidence when a client supplies product ids", async () => {
    db.product.findMany.mockResolvedValue([{ id: "prod-1" }]);

    const result = await validateShopProductEvidence({
      shopId: "shop-1",
      eventName: "PRODUCT_VIEWED",
      productId: "foreign-prod",
      payload: { productId: "prod-1", productIds: ["prod-1", "foreign-prod"], dwellMs: 1200 },
      cartSuccessEvents,
    });

    expect(db.product.findMany).toHaveBeenCalledWith({
      where: { shopId: "shop-1", id: { in: ["foreign-prod", "prod-1"] } },
      select: { id: true },
    });
    expect(result).toEqual({
      ok: true,
      productId: "prod-1",
      payload: {
        productId: "prod-1",
        productIds: ["prod-1"],
        dwellMs: 1200,
      },
    });
  });

  it("rejects non-cart events that carry only foreign product evidence", async () => {
    db.product.findMany.mockResolvedValue([]);

    const result = await validateShopProductEvidence({
      shopId: "shop-1",
      eventName: "PRODUCT_DWELL_LONG",
      productId: "foreign-prod",
      payload: { productId: "foreign-prod", dwellMs: 5000 },
      cartSuccessEvents,
    });

    expect(result).toEqual({ ok: false });
  });

  it("keeps only current-shop product ids on cart-success events", async () => {
    db.product.findMany.mockResolvedValue([{ id: "prod-anchor" }, { id: "prod-shoe" }]);

    const result = await validateShopProductEvidence({
      shopId: "shop-1",
      eventName: "CART_FROM_TRYON",
      productId: "prod-anchor",
      payload: {
        productId: "prod-anchor",
        productIds: ["prod-anchor", "prod-shoe", "foreign-prod"],
        size: "M",
      },
      cartSuccessEvents,
    });

    expect(db.product.findMany).toHaveBeenCalledWith({
      where: { shopId: "shop-1", id: { in: ["prod-anchor", "prod-shoe", "foreign-prod"] } },
      select: { id: true },
    });
    expect(result).toEqual({
      ok: true,
      productId: "prod-anchor",
      payload: {
        productId: "prod-anchor",
        productIds: ["prod-anchor", "prod-shoe"],
        size: "M",
      },
    });
  });

  it("rejects cart-success events with no current-shop product evidence", async () => {
    db.product.findMany.mockResolvedValue([]);

    const result = await validateShopProductEvidence({
      shopId: "shop-1",
      eventName: "CART_FROM_WIDGET_STYLE",
      payload: { productIds: ["foreign-prod"] },
      cartSuccessEvents,
    });

    expect(result).toEqual({ ok: false });
  });
});
