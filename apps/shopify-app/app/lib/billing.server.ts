// Billing layer — Shopify subscription checks + usage recording.
//
// Responsibilities:
//   1. checkOrCreateSubscription() — verify an active Shopify AppSubscription
//      exists; bypass in dev/test so local installs never fail on billing.
//   2. getBillingStatus()         — return plan tier, usage counters, caps, next
//      reset date for the merchant dashboard usage meters.
//   3. recordUsage()              — increment the UsageCounter for a feature and
//      emit a USAGE_RECORDED analytics event.

import { prisma } from "../db.server";
import { recordConsume, getEffectivePlan, isBillingActive } from "./entitlement.server";
import { currentPeriodStart } from "@stylique/core";
import type { UsageMetric, PlanTier } from "@stylique/types";

// ─── Types ────────────────────────────────────────────────────────────────

export type BillingStatus = {
  shopId: string;
  planTier: PlanTier;
  billingActive: boolean;
  periodStart: Date;
  nextResetDate: Date;
  usage: UsageReport;
};

export type UsageReport = {
  [K in UsageMetric]?: {
    used: number;
    cap: number | null; // null = unlimited
    remaining: number | null;
  };
};

// ─── Subscription check ───────────────────────────────────────────────────

/**
 * Checks Shopify GraphQL for activeSubscriptions on this shop.
 * Returns { active: true } in development/test to bypass billing gates.
 * In production returns { active: false } when no subscription exists.
 */
export async function checkOrCreateSubscription(
  shopId: string,
  shop: { shopifyDomain: string; accessToken?: string },
): Promise<{ active: boolean; planId?: string }> {
  // Development / test bypass — never block on billing during local dev.
  if (process.env.NODE_ENV !== "production") {
    return { active: true };
  }

  const accessToken = shop.accessToken;
  if (!accessToken) {
    console.warn(`[billing] no accessToken for shop ${shopId} — treating as inactive`);
    return { active: false };
  }

  try {
    const endpoint = `https://${shop.shopifyDomain}/admin/api/2025-01/graphql.json`;
    const query = `{
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          currentPeriodEnd
          lineItems {
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  interval
                  price { amount currencyCode }
                }
              }
            }
          }
        }
      }
    }`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      console.error(`[billing] Shopify GraphQL error ${res.status} for shop ${shopId}`);
      return { active: false };
    }

    const json = (await res.json()) as {
      data?: {
        currentAppInstallation?: {
          activeSubscriptions?: Array<{ id: string; status: string }>;
        };
      };
    };

    const subs = json.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const activeSub = subs.find((s) => s.status === "ACTIVE");
    if (activeSub) {
      return { active: true, planId: activeSub.id };
    }
    return { active: false };
  } catch (err) {
    console.error(`[billing] subscription check failed for shop ${shopId}:`, (err as Error).message);
    // On error, fail open in dev, fail closed in production.
    return { active: false };
  }
}

// ─── Billing status (for merchant dashboard usage meters) ────────────────

export async function getBillingStatus(shopId: string): Promise<BillingStatus> {
  const effectivePlan = await getEffectivePlan(shopId);
  const tier = (effectivePlan?.tier ?? "STARTER") as PlanTier;
  const features = effectivePlan?.features;

  const periodStart = currentPeriodStart();
  // Next reset is one calendar month after period start.
  const nextReset = new Date(periodStart);
  nextReset.setMonth(nextReset.getMonth() + 1);

  // Load all UsageCounter rows for this shop in the current period.
  const counters = await prisma.usageCounter.findMany({
    where: { shopId, periodStart },
    select: { metric: true, count: true },
  });

  const counterMap = new Map(counters.map((c) => [c.metric as UsageMetric, c.count]));

  function capForMetric(metric: UsageMetric): number | null {
    if (!features) return 0;
    switch (metric) {
      case "TRYON_PERSONAL":         return features.widget.monthlyTryOnPersonal;
      case "TRYON_BODY":             return features.widget.monthlyTryOnBody;
      case "STYLE_RECOMMENDATION":   return features.widget.monthlyStyleRecs;
      case "FIT_RECOMMENDATION":     return features.widget.monthlyFitRecs;
      case "VISION_TURN":            return features.stylist.monthlyVisionTurns;
      case "STYLIST_TURN":           return features.stylist.monthlyTurns;
      // Creative metrics removed; residual/archival enum values are ungated.
      default:                       return null;
    }
  }

  const ALL_METRICS: UsageMetric[] = [
    "TRYON_PERSONAL",
    "TRYON_BODY",
    "STYLE_RECOMMENDATION",
    "FIT_RECOMMENDATION",
    "VISION_TURN",
    "STYLIST_TURN",
  ];

  const usage: UsageReport = {};
  for (const metric of ALL_METRICS) {
    const used = counterMap.get(metric) ?? 0;
    const cap = capForMetric(metric);
    const remaining = cap === null ? null : Math.max(0, cap - used);
    usage[metric] = { used, cap, remaining };
  }

  const planRow = await prisma.plan.findUnique({
    where: { shopId },
    select: { planFeaturesJson: true },
  });

  // Check if subscription is active (always true in dev). In production this
  // must read the same billing/comp contract that entitlement enforcement uses;
  // a bare Plan row only proves the shop was provisioned, not that it is paying.
  const billingActive = process.env.NODE_ENV !== "production"
    || isBillingActive(planRow?.planFeaturesJson);

  return {
    shopId,
    planTier: tier,
    billingActive,
    periodStart,
    nextResetDate: nextReset,
    usage,
  };
}

// ─── Usage recording ──────────────────────────────────────────────────────

/**
 * Records consumption of a feature metric for a shop.
 * Increments the UsageCounter and emits a USAGE_RECORDED analytics event.
 */
export async function recordUsage(
  shopId: string,
  feature: string,
  amount: number = 1,
): Promise<void> {
  const metric = feature as UsageMetric;

  // Write the counter (fire-and-forget if it errors — same pattern as recordConsume).
  await recordConsume({ shopId, metric, by: amount });

  // Emit USAGE_RECORDED analytics event (non-fatal on failure).
  try {
    await prisma.analyticsEvent.create({
      data: {
        shopId,
        name: "USAGE_RECORDED" as any,
        payload: { feature: metric, amount },
      },
    });
  } catch (err) {
    console.warn(`[billing] USAGE_RECORDED event failed (non-fatal):`, (err as Error).message);
  }
}
