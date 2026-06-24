import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  plan: {
    findUnique: vi.fn(),
  },
}));

vi.mock("../db.server", () => ({ prisma: db }));

import { getEffectivePlan, tierForFeature } from "./entitlement.server";

describe("getEffectivePlan billing enforcement", () => {
  const originalBillingEnforced = process.env.BILLING_ENFORCED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BILLING_ENFORCED = "1";
  });

  afterAll(() => {
    if (originalBillingEnforced == null) {
      delete process.env.BILLING_ENFORCED;
    } else {
      process.env.BILLING_ENFORCED = originalBillingEnforced;
    }
  });

  it("honors the nested active billing object written by checkout confirmation", async () => {
    db.plan.findUnique.mockResolvedValue({
      tier: "GROWTH",
      planFeaturesJson: {
        billing: {
          status: "ACTIVE",
          subscriptionId: "gid://shopify/AppSubscription/1",
          tier: "GROWTH",
        },
      },
    });

    const plan = await getEffectivePlan("shop-1");

    expect(plan?.tier).toBe("GROWTH");
    expect(plan?.features.widget.personalPhotoTryOn).toBe(true);
  });

  it("degrades unpaid paid tiers to Starter when enforcement is enabled", async () => {
    db.plan.findUnique.mockResolvedValue({
      tier: "ULTIMATE",
      planFeaturesJson: {
        billing: {
          status: "CANCELLED",
          subscriptionId: "gid://shopify/AppSubscription/1",
          tier: "ULTIMATE",
        },
      },
    });

    const plan = await getEffectivePlan("shop-1");

    expect(plan?.tier).toBe("STARTER");
    expect(plan?.features.analytics.crossBrandBenchmarks).toBe(false);
  });

  it("still honors explicit ops comp while enforcement is enabled", async () => {
    db.plan.findUnique.mockResolvedValue({
      tier: "ULTIMATE",
      planFeaturesJson: { comp: true },
    });

    const plan = await getEffectivePlan("shop-1");

    expect(plan?.tier).toBe("ULTIMATE");
    expect(plan?.features.analytics.crossBrandBenchmarks).toBe(true);
  });
});

describe("tierForFeature", () => {
  it("derives upgrade hints from PLAN_FEATURES instead of a manual tier switch", () => {
    expect(tierForFeature("stylist.proactiveTriggers")).toBe("GROWTH");
    expect(tierForFeature("analytics.crossBrandBenchmarks")).toBe("ULTIMATE");
    expect(tierForFeature("widget.enabled")).toBe("STARTER");
  });
});
