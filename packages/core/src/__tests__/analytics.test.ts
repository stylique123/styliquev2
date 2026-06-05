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
});
