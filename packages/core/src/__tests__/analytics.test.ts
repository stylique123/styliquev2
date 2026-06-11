import { describe, it, expect } from "vitest";
import { createFakePrisma } from "./fakePrisma.js";
import { createAnalyticsService } from "../analytics/service.js";

describe("AnalyticsService", () => {
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
});
