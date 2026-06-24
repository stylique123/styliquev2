import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  product: { findMany: vi.fn() },
}));
const helpers = vi.hoisted(() => ({
  analytics: { track: vi.fn() },
  rateOk: vi.fn(),
  shopIdFromDomain: vi.fn(),
}));
const session = vi.hoisted(() => ({
  getOrCreateShopperSession: vi.fn(),
}));

vi.mock("../db.server", () => ({ prisma: db }));
vi.mock("./shopper-helpers.server", () => helpers);
vi.mock("./session.server", () => session);

import { postEvent } from "./shopper-events.server";

describe("postEvent storefront analytics boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.rateOk.mockResolvedValue(true);
    helpers.shopIdFromDomain.mockResolvedValue("shop-1");
    helpers.analytics.track.mockResolvedValue(undefined);
    session.getOrCreateShopperSession.mockResolvedValue({ row: { id: "shopper-1" } });
  });

  it("preserves only shop-owned productIds for try-on bundle cart success", async () => {
    db.product.findMany.mockResolvedValue([
      { id: "prod-anchor" },
      { id: "prod-shoe" },
    ]);

    const result = await postEvent({
      shopDomain: "demo.myshopify.com",
      shopperCookieId: "cookie-1",
      body: {
        name: "CART_FROM_TRYON",
        productId: "prod-anchor",
        payload: {
          productId: "prod-anchor",
          productIds: ["prod-anchor", "prod-shoe", "foreign-prod"],
          comboName: "3-piece look",
          size: "M",
        },
      },
    });

    expect(result).toEqual({ ok: true, data: { accepted: true } });
    expect(db.product.findMany).toHaveBeenCalledWith({
      where: { shopId: "shop-1", id: { in: ["prod-anchor", "prod-shoe", "foreign-prod"] } },
      select: { id: true },
    });
    expect(helpers.analytics.track).toHaveBeenCalledWith(expect.objectContaining({
      shopId: "shop-1",
      shopperId: "shopper-1",
      name: "CART_FROM_TRYON",
      productId: "prod-anchor",
      payload: expect.objectContaining({
        productId: "prod-anchor",
        productIds: ["prod-anchor", "prod-shoe"],
        comboName: "3-piece look",
        size: "M",
      }),
    }));
  });

  it("rejects client cart-success events with no shop-owned product evidence", async () => {
    db.product.findMany.mockResolvedValue([]);

    const result = await postEvent({
      shopDomain: "demo.myshopify.com",
      shopperCookieId: "cookie-1",
      body: {
        name: "CART_FROM_WIDGET_STYLE",
        payload: {
          productIds: ["foreign-prod"],
          comboName: "Bad bundle",
        },
      },
    });

    expect(result).toEqual({ ok: false, error: "invalid_payload" });
    expect(helpers.analytics.track).not.toHaveBeenCalled();
  });

  it("still accepts non-cart telemetry without product id evidence", async () => {
    const result = await postEvent({
      shopDomain: "demo.myshopify.com",
      shopperCookieId: "cookie-1",
      body: {
        name: "MIRA_BEHAVIORAL_TRIGGER_FIRED",
        payload: {
          triggerType: "product_media_focus",
          confidence: 0.86,
        },
      },
    });

    expect(result).toEqual({ ok: true, data: { accepted: true } });
    expect(db.product.findMany).not.toHaveBeenCalled();
    expect(helpers.analytics.track).toHaveBeenCalledWith(expect.objectContaining({
      name: "MIRA_BEHAVIORAL_TRIGGER_FIRED",
      productId: undefined,
    }));
  });

  it("rejects non-cart telemetry when supplied product evidence is not shop-owned", async () => {
    db.product.findMany.mockResolvedValue([]);

    const result = await postEvent({
      shopDomain: "demo.myshopify.com",
      shopperCookieId: "cookie-1",
      body: {
        name: "PRODUCT_VIEWED",
        productId: "foreign-prod",
        payload: {
          productId: "foreign-prod",
          productHandle: "fake",
        },
      },
    });

    expect(result).toEqual({ ok: false, error: "invalid_payload" });
    expect(helpers.analytics.track).not.toHaveBeenCalled();
  });
});
