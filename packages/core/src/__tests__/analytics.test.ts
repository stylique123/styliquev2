import { describe, it, expect } from "vitest";
import { createFakePrisma } from "./fakePrisma.js";
import {
  LEGACY_EVENT_ALIASES,
  MIRA_CART_ASSIST_EVENT_NAMES,
  MIRA_CART_INTENT_EVENT_NAMES,
  MIRA_CART_SUCCESS_EVENT_NAMES,
} from "../analytics/cart-events.js";
import { distinctOrderCountFromEvents, orderKeyFromEvent } from "../analytics/order-events.js";
import { createAnalyticsService } from "../analytics/service.js";

describe("AnalyticsService", () => {
  it("keeps dashboard/report/order cart-assist aliases centralized", () => {
    expect(MIRA_CART_INTENT_EVENT_NAMES).toEqual([
      "CHAT_CART_REQUESTED",
      "MIRA_ADD_TO_CART_ASSIST",
      "COMBO_ADD_ALL",
    ]);
    expect(MIRA_CART_SUCCESS_EVENT_NAMES).toEqual([
      "CART_FROM_MIRA",
      "CART_FROM_TRYON",
      "CART_FROM_WIDGET_STYLE",
    ]);
    expect(MIRA_CART_ASSIST_EVENT_NAMES).toEqual([
      "CHAT_CART_REQUESTED",
      "MIRA_ADD_TO_CART_ASSIST",
      "COMBO_ADD_ALL",
      "CART_FROM_MIRA",
      "CART_FROM_TRYON",
      "CART_FROM_WIDGET_STYLE",
    ]);
    expect(LEGACY_EVENT_ALIASES.CHAT_CART_REQUESTED).toEqual([
      "MIRA_ADD_TO_CART_ASSIST",
      "COMBO_ADD_ALL",
      "CART_FROM_MIRA",
      "CART_FROM_TRYON",
      "CART_FROM_WIDGET_STYLE",
    ]);
  });

  it("groups line-item order events by payload orderId for order-level metrics", () => {
    expect(orderKeyFromEvent({ id: "line-1", payload: { orderId: "order-1" } })).toBe("o:order-1");
    expect(distinctOrderCountFromEvents([
      { id: "line-1", payload: { orderId: "order-1" } },
      { id: "line-2", payload: { orderId: "order-1" } },
      { id: "line-3", payload: { orderId: "order-2" } },
    ])).toBe(2);
  });

  it("falls back to event ids for legacy order events without payload orderId", () => {
    expect(orderKeyFromEvent({ id: "legacy-1", payload: {} })).toBe("e:legacy-1");
    expect(distinctOrderCountFromEvents([
      { id: "legacy-1", payload: {} },
      { id: "legacy-2", payload: {} },
    ])).toBe(2);
  });

  it("validates payloads via zod and persists valid events", async () => {
    const fake = createFakePrisma();
    const svc = createAnalyticsService(fake as any);

    await svc.track({
      shopId: "shop-1",
      name: "SIZE_SELECTED",
      payload: { chosenSize: "M", recommendedSize: "M", sizeDelta: 0 },
    });

    expect(fake._state.events.length).toBe(1);
    expect(fake._state.events[0].name).toBe("SIZE_SELECTED");
  });

  it("accepts multi-product try-on cart success evidence", async () => {
    const fake = createFakePrisma();
    const svc = createAnalyticsService(fake as any);

    await svc.track({
      shopId: "shop-1",
      name: "CART_FROM_TRYON",
      productId: "product-anchor",
      payload: {
        productId: "product-anchor",
        productIds: ["product-anchor", "product-shoe", "product-bag"],
        comboName: "3-piece look",
        size: "M",
      },
    });

    expect(fake._state.events).toHaveLength(1);
    expect(fake._state.events[0].payload).toMatchObject({
      productIds: ["product-anchor", "product-shoe", "product-bag"],
    });
  });

  it("rejects invalid payloads", async () => {
    const fake = createFakePrisma();
    const svc = createAnalyticsService(fake as any);
    await expect(
      svc.track({
        shopId: "shop-1",
        name: "SIZE_SELECTED",
        payload: { chosenSize: "M" }, // missing sizeDelta
      }),
    ).rejects.toThrow();
    expect(fake._state.events.length).toBe(0);
  });

  it("trackBatch partitions valid vs rejected", async () => {
    const fake = createFakePrisma();
    const svc = createAnalyticsService(fake as any);

    const result = await svc.trackBatch([
      { shopId: "shop-1", name: "WIDGET_VIEWED", payload: {} },
      { shopId: "shop-1", name: "TRYON_STARTED", payload: { mode: "BODY_MODEL" } },
      { shopId: "shop-1", name: "TRYON_STARTED", payload: { mode: "WRONG" } as any },
    ]);

    expect(result).toEqual({ accepted: 2, rejected: 1 });
    expect(fake._state.events.length).toBe(2);
  });

  it("accepts the production Mira lifecycle payload contracts", async () => {
    const fake = createFakePrisma();
    const svc = createAnalyticsService(fake as any);

    await svc.trackBatch([
      { shopId: "shop-1", name: "CHAT_OPENED", payload: { surface: "mira_proxy" } },
      { shopId: "shop-1", name: "CHAT_MESSAGE_SENT", payload: { length: 24 } },
      {
        shopId: "shop-1",
        name: "CHAT_REPLY_RECEIVED",
        payload: { latencyMs: 820, combos: 1, actions: 1 },
      },
      {
        shopId: "shop-1",
        name: "CHAT_PRODUCT_CLICKED",
        productId: "product-1",
        payload: { productHandle: "silk-dress" },
      },
      {
        shopId: "shop-1",
        name: "CHAT_CART_REQUESTED",
        productId: "product-1",
        payload: { productId: "product-1", suggestedSize: "M" },
      },
    ]);

    expect(fake._state.events).toHaveLength(5);
  });

  it("rejects the obsolete Mira payload shapes that previously failed silently", async () => {
    const fake = createFakePrisma();
    const svc = createAnalyticsService(fake as any);

    const result = await svc.trackBatch([
      { shopId: "shop-1", name: "CHAT_OPENED", payload: { source: "mira_proxy" } },
      { shopId: "shop-1", name: "CHAT_MESSAGE_SENT", payload: { route: "look" } },
      { shopId: "shop-1", name: "CHAT_PRODUCT_CLICKED", payload: { handle: "silk-dress", route: "look" } },
      { shopId: "shop-1", name: "CHAT_CART_REQUESTED", payload: { handle: null } },
    ]);

    expect(result).toEqual({ accepted: 0, rejected: 4 });
    expect(fake._state.events).toHaveLength(0);
  });

  it("accepts order-webhook revenue payloads used by dashboard and reports", async () => {
    const fake = createFakePrisma();
    const svc = createAnalyticsService(fake as any);

    await svc.trackBatch([
      {
        shopId: "shop-1",
        shopperId: "shopper-1",
        name: "CART_CONFIRMED",
        productId: "product-1",
        payload: {
          source: "webhook_order",
          orderId: "order-1",
          quantity: 2,
          lineValue: 15_000,
          linkMethod: "email",
          linkConfidence: "medium",
        },
      },
      {
        shopId: "shop-1",
        shopperId: "shopper-1",
        name: "MIRA_ASSISTED_ORDER",
        payload: {
          orderId: "order-1",
          assistedProductIds: ["product-1"],
          assistedRevenueCents: 15_000,
          assistedUnits: 2,
          totalLineItems: 1,
          linkMethod: "email",
          linkConfidence: "medium",
        },
      },
    ]);

    expect(fake._state.events).toHaveLength(2);
    expect(fake._state.events[0].payload).toMatchObject({ lineValue: 15_000 });
    expect(fake._state.events[1].payload).toMatchObject({ assistedRevenueCents: 15_000 });
  });
});
