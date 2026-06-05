import { describe, it, expect } from "vitest";
import { createFakePrisma } from "./fakePrisma.js";
import { createPlansService } from "../plans/service.js";
import { createUsageService } from "../usage/service.js";

function setup(overrides: Partial<{ tier: "STARTER" | "GROWTH" | "ULTIMATE"; personalQuota: number | null; warnAt: number }> = {}) {
  const tier = overrides.tier ?? "STARTER";
  const personalQuota = overrides.personalQuota === undefined ? 10 : overrides.personalQuota;
  const fakePrisma = createFakePrisma({
    plans: [{
      id: "plan-1",
      shopId: "shop-1",
      tier,
      monthlyTryOnPersonal: personalQuota,
      monthlyTryOnBody: null,
      monthlyCreatives: 100,
      creativeSets: 5,
      fairUseWarnAt: overrides.warnAt ?? 0.8,
    }],
  });
  const usage = createUsageService(fakePrisma as any);
  const plans = createPlansService(fakePrisma as any, usage);
  return { fakePrisma, usage, plans };
}

describe("UsageService.increment", () => {
  it("increments atomically across calls", async () => {
    const { usage } = setup();
    expect(await usage.increment("shop-1", "TRYON_PERSONAL")).toBe(1);
    expect(await usage.increment("shop-1", "TRYON_PERSONAL")).toBe(2);
    expect(await usage.increment("shop-1", "TRYON_PERSONAL", 3)).toBe(5);
    expect(await usage.get("shop-1", "TRYON_PERSONAL")).toBe(5);
  });
});

describe("PlansService.canConsume", () => {
  it("allows when under quota and returns remaining", async () => {
    const { plans } = setup({ personalQuota: 10 });
    const r = await plans.canConsume("shop-1", "TRYON_PERSONAL");
    expect(r).toEqual({ allowed: true, remaining: 10 });
  });

  it("returns hideFromShopper=true for exhausted TRYON_PERSONAL", async () => {
    const { plans, usage } = setup({ personalQuota: 2 });
    await usage.increment("shop-1", "TRYON_PERSONAL", 2);
    const r = await plans.canConsume("shop-1", "TRYON_PERSONAL");
    expect(r).toEqual({ allowed: false, hideFromShopper: true, reason: "QUOTA_EXHAUSTED" });
  });

  it("returns hideFromShopper=false for exhausted non-shopper metrics (CREATIVE_GENERATED)", async () => {
    const { plans, usage } = setup({ personalQuota: 10 });
    await usage.increment("shop-1", "CREATIVE_GENERATED", 100);
    const r = await plans.canConsume("shop-1", "CREATIVE_GENERATED");
    expect(r).toEqual({ allowed: false, hideFromShopper: false, reason: "QUOTA_EXHAUSTED" });
  });

  it("treats null quota as unlimited (TRYON_BODY)", async () => {
    const { plans, usage } = setup();
    await usage.increment("shop-1", "TRYON_BODY", 999999);
    const r = await plans.canConsume("shop-1", "TRYON_BODY");
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.remaining).toBeNull();
  });
});

describe("Personal try-on exhaustion fallback", () => {
  it("body-model remains allowed when personal-photo is exhausted", async () => {
    const { plans, usage } = setup({ personalQuota: 1 });
    await usage.increment("shop-1", "TRYON_PERSONAL", 1);

    const personal = await plans.canConsume("shop-1", "TRYON_PERSONAL");
    const body = await plans.canConsume("shop-1", "TRYON_BODY");

    expect(personal).toEqual({ allowed: false, hideFromShopper: true, reason: "QUOTA_EXHAUSTED" });
    expect(body.allowed).toBe(true);
  });
});

describe("Fair-use warning + consume()", () => {
  it("fires shouldFireFairUseWarning exactly once on threshold crossing", async () => {
    const { plans } = setup({ personalQuota: 10, warnAt: 0.8 }); // threshold = 8

    // before=7, after=8 → crosses
    expect(await plans.shouldFireFairUseWarning("shop-1", "TRYON_PERSONAL", 7, 8)).toBe(true);
    // before=8, after=9 → already crossed
    expect(await plans.shouldFireFairUseWarning("shop-1", "TRYON_PERSONAL", 8, 9)).toBe(false);
    // before=0, after=7 → not yet
    expect(await plans.shouldFireFairUseWarning("shop-1", "TRYON_PERSONAL", 0, 7)).toBe(false);
    // before=0, after=10 → crosses in one go
    expect(await plans.shouldFireFairUseWarning("shop-1", "TRYON_PERSONAL", 0, 10)).toBe(true);
  });

  it("consume() creates a FAIR_USE_REACHED notification exactly once", async () => {
    const { fakePrisma, plans } = setup({ personalQuota: 10, warnAt: 0.8 }); // threshold ceil(10*0.8)=8

    for (let i = 0; i < 7; i++) await plans.consume("shop-1", "TRYON_PERSONAL");
    expect(fakePrisma._state.notifications.length).toBe(0);

    await plans.consume("shop-1", "TRYON_PERSONAL"); // 7 → 8 crosses
    expect(fakePrisma._state.notifications.length).toBe(1);
    expect(fakePrisma._state.notifications[0].kind).toBe("FAIR_USE_REACHED");

    await plans.consume("shop-1", "TRYON_PERSONAL"); // 8 → 9 already crossed
    expect(fakePrisma._state.notifications.length).toBe(1);
  });

  it("never warns when quota is unlimited", async () => {
    const { fakePrisma, plans } = setup({ personalQuota: null });
    for (let i = 0; i < 100; i++) await plans.consume("shop-1", "TRYON_PERSONAL");
    expect(fakePrisma._state.notifications.length).toBe(0);
  });
});

describe("Plan defaults exist for Growth, Pro, Scale", () => {
  it.each(["STARTER", "GROWTH", "ULTIMATE"] as const)("%s has quotas", async (tier) => {
    const { plans } = setup({ tier });
    const q = await plans.getQuotas("shop-1");
    expect(q.monthlyTryOnPersonal).toBeGreaterThan(0);
    expect(q.creativeSets).toBeGreaterThan(0);
  });
});
