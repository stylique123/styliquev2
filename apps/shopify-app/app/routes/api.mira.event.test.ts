import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  shop: { findUnique: vi.fn() },
  product: { findFirst: vi.fn(), findMany: vi.fn() },
}));
const helpers = vi.hoisted(() => ({
  analytics: { track: vi.fn() },
  rateOk: vi.fn(),
}));
const session = vi.hoisted(() => ({
  getOrCreateShopperSession: vi.fn(),
}));
const taste = vi.hoisted(() => ({
  logCatalogGap: vi.fn(),
}));

vi.mock("../db.server", () => ({ prisma: db }));
vi.mock("../lib/shopper-helpers.server", () => helpers);
vi.mock("../lib/session.server", () => session);
vi.mock("../lib/taste.server", () => taste);

import { action } from "./api.mira.event";

const ORIGINAL_ENV = { ...process.env };

function bridgeRequest(body: unknown, secret?: string): Request {
  return new Request("https://app.example.com/api/mira/event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-stylique-bridge-secret": secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function callAction(request: Request): Promise<Response> {
  return action({ request, params: {}, context: {} } as never);
}

describe("api.mira.event bridge boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "production" };
    delete process.env.MIRA_EVENT_BRIDGE_SECRET;
    delete process.env.DEMO_SHOPIFY_DOMAIN;
    delete process.env.SHOPIFY_DEV_STORE_DOMAIN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("fails closed in production when the bridge secret is missing", async () => {
    const res = await callAction(bridgeRequest({
      event: "MIRA_INTENT_CAPTURED",
      shopifyDomain: "demo.myshopify.com",
      data: { query: "black dress" },
    }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "bridge_secret_required" });
    expect(db.shop.findUnique).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong bridge secret", async () => {
    process.env.MIRA_EVENT_BRIDGE_SECRET = "correct";

    const res = await callAction(bridgeRequest({
      event: "MIRA_INTENT_CAPTURED",
      shopifyDomain: "demo.myshopify.com",
      data: { query: "black dress" },
    }, "wrong"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "unauthorized" });
    expect(db.shop.findUnique).not.toHaveBeenCalled();
  });

  it("rejects full-enum events that the demo bridge is not allowed to emit", async () => {
    process.env.MIRA_EVENT_BRIDGE_SECRET = "correct";

    const res = await callAction(bridgeRequest({
      event: "CART_CONFIRMED",
      shopifyDomain: "demo.myshopify.com",
      data: { orderId: "fake-order", lineValue: 12000 },
    }, "correct"));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "unauthorized_event" });
    expect(db.shop.findUnique).not.toHaveBeenCalled();
    expect(helpers.analytics.track).not.toHaveBeenCalled();
  });

  it("accepts proactive behavioral telemetry from the demo bridge", async () => {
    process.env.MIRA_EVENT_BRIDGE_SECRET = "correct";
    helpers.rateOk.mockResolvedValue(true);
    db.shop.findUnique.mockResolvedValue({ id: "shop-1", uninstalledAt: null });
    db.product.findFirst.mockResolvedValue({ id: "product-1" });
    db.product.findMany.mockResolvedValue([{ id: "product-1" }]);
    session.getOrCreateShopperSession.mockResolvedValue({ row: { id: "shopper-1" } });
    helpers.analytics.track.mockResolvedValue(undefined);

    const res = await callAction(bridgeRequest({
      event: "MIRA_BEHAVIORAL_TRIGGER_FIRED",
      shopifyDomain: "demo.myshopify.com",
      shopperSessionId: "cookie-1",
      productHandle: "black-dress",
      data: {
        triggerType: "same_category_revisit",
        confidence: 0.86,
        reasons: ["viewed_multiple_same_category_products"],
      },
    }, "correct"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, accepted: true });
    expect(helpers.analytics.track).toHaveBeenCalledWith(expect.objectContaining({
      shopId: "shop-1",
      shopperId: "shopper-1",
      productId: "product-1",
      name: "MIRA_BEHAVIORAL_TRIGGER_FIRED",
      payload: expect.objectContaining({
        triggerType: "same_category_revisit",
        confidence: 0.86,
      }),
    }));
  });

  it("canonicalizes bridge cart-success productIds to current-shop products", async () => {
    process.env.MIRA_EVENT_BRIDGE_SECRET = "correct";
    helpers.rateOk.mockResolvedValue(true);
    db.shop.findUnique.mockResolvedValue({ id: "shop-1", uninstalledAt: null });
    db.product.findFirst.mockResolvedValue({ id: "prod-anchor" });
    db.product.findMany.mockResolvedValue([
      { id: "prod-anchor" },
      { id: "prod-shoe" },
    ]);
    session.getOrCreateShopperSession.mockResolvedValue({ row: { id: "shopper-1" } });
    helpers.analytics.track.mockResolvedValue(undefined);

    const res = await callAction(bridgeRequest({
      event: "CART_FROM_TRYON",
      shopifyDomain: "demo.myshopify.com",
      shopperSessionId: "cookie-1",
      productHandle: "black-dress",
      data: {
        productId: "prod-anchor",
        productIds: ["prod-anchor", "prod-shoe", "foreign-prod"],
        comboName: "3-piece look",
        size: "M",
      },
    }, "correct"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, accepted: true });
    expect(db.product.findMany).toHaveBeenCalledWith({
      where: { shopId: "shop-1", id: { in: ["prod-anchor", "prod-shoe", "foreign-prod"] } },
      select: { id: true },
    });
    expect(helpers.analytics.track).toHaveBeenCalledWith(expect.objectContaining({
      shopId: "shop-1",
      shopperId: "shopper-1",
      productId: "prod-anchor",
      name: "CART_FROM_TRYON",
      payload: expect.objectContaining({
        productId: "prod-anchor",
        productIds: ["prod-anchor", "prod-shoe"],
        comboName: "3-piece look",
        size: "M",
      }),
    }));
  });

  it("rejects bridge cart-success events with no shop-owned product evidence", async () => {
    process.env.MIRA_EVENT_BRIDGE_SECRET = "correct";
    helpers.rateOk.mockResolvedValue(true);
    db.shop.findUnique.mockResolvedValue({ id: "shop-1", uninstalledAt: null });
    db.product.findFirst.mockResolvedValue(null);
    db.product.findMany.mockResolvedValue([]);
    session.getOrCreateShopperSession.mockResolvedValue({ row: { id: "shopper-1" } });

    const res = await callAction(bridgeRequest({
      event: "CART_FROM_TRYON",
      shopifyDomain: "demo.myshopify.com",
      shopperSessionId: "cookie-1",
      data: {
        productIds: ["foreign-prod"],
        comboName: "Bad look",
      },
    }, "correct"));

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "invalid_payload" });
    expect(helpers.analytics.track).not.toHaveBeenCalled();
  });

  it("rejects bridge non-cart events when supplied product evidence is not shop-owned", async () => {
    process.env.MIRA_EVENT_BRIDGE_SECRET = "correct";
    helpers.rateOk.mockResolvedValue(true);
    db.shop.findUnique.mockResolvedValue({ id: "shop-1", uninstalledAt: null });
    db.product.findFirst.mockResolvedValue(null);
    db.product.findMany.mockResolvedValue([]);
    session.getOrCreateShopperSession.mockResolvedValue({ row: { id: "shopper-1" } });

    const res = await callAction(bridgeRequest({
      event: "MIRA_BEHAVIORAL_TRIGGER_FIRED",
      shopifyDomain: "demo.myshopify.com",
      shopperSessionId: "cookie-1",
      data: {
        productId: "foreign-prod",
        triggerType: "product_media_focus",
      },
    }, "correct"));

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "invalid_payload" });
    expect(helpers.analytics.track).not.toHaveBeenCalled();
  });
});
