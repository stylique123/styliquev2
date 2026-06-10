import type { PrismaClient } from "@stylique/db";
import type { UsageMetric } from "@stylique/types";
import {
  PLAN_DEFAULTS,
  quotaForMetric,
  hidesFromShopperOnExhaust,
  type EntitlementCheck,
  type PlanQuotas,
} from "./index.js";
import { createUsageService, type UsageService } from "../usage/service.js";

export interface PlansService {
  getQuotas(shopId: string): Promise<PlanQuotas>;
  canConsume(shopId: string, metric: UsageMetric, now?: Date): Promise<EntitlementCheck>;
  /** Increments usage and returns post-increment count. Also fires fair-use notification on threshold crossing. */
  consume(shopId: string, metric: UsageMetric, n?: number, now?: Date): Promise<number>;
  /** Pure check — true iff this consume() call is the one that crosses fairUseWarnAt. */
  shouldFireFairUseWarning(shopId: string, metric: UsageMetric, before: number, after: number): Promise<boolean>;
}

export function createPlansService(prisma: PrismaClient, usage: UsageService = createUsageService(prisma)): PlansService {
  async function loadPlan(shopId: string) {
    const plan = await prisma.plan.findUnique({ where: { shopId } });
    if (!plan) throw new Error(`No plan for shop ${shopId}`);
    return plan;
  }

  function quotasFromPlan(plan: Awaited<ReturnType<typeof loadPlan>>): PlanQuotas {
    const defaults = PLAN_DEFAULTS[plan.tier];
    return {
      monthlyTryOnPersonal: plan.monthlyTryOnPersonal ?? defaults.monthlyTryOnPersonal,
      monthlyTryOnBody:     plan.monthlyTryOnBody     ?? defaults.monthlyTryOnBody,
      monthlyCreatives:     plan.monthlyCreatives     ?? defaults.monthlyCreatives,
      monthlyCreativeSets:  plan.monthlyCreativeSets  ?? defaults.monthlyCreativeSets,
      monthlyStyleRecs:     plan.monthlyStyleRecs     ?? defaults.monthlyStyleRecs,
      monthlyFitRecs:       plan.monthlyFitRecs       ?? defaults.monthlyFitRecs,
      monthlyVisionTurns:   defaults.monthlyVisionTurns,
      monthlyTurns:         plan.monthlyStylistTurns  ?? defaults.monthlyTurns,
      creativeSets:         plan.creativeSets         ?? defaults.creativeSets,
    };
  }

  const service: PlansService = {
    async getQuotas(shopId) {
      return quotasFromPlan(await loadPlan(shopId));
    },

    async canConsume(shopId, metric, now) {
      const plan = await loadPlan(shopId);
      const quotas = quotasFromPlan(plan);
      const quota = quotaForMetric(quotas, metric);
      if (quota === null) return { allowed: true, remaining: null };

      const current = await usage.get(shopId, metric, now);
      if (current >= quota) {
        return {
          allowed: false,
          hideFromShopper: hidesFromShopperOnExhaust(metric),
          reason: "QUOTA_EXHAUSTED",
        };
      }
      return { allowed: true, remaining: quota - current };
    },

    async consume(shopId, metric, n = 1, now) {
      const plan = await loadPlan(shopId);
      const quotas = quotasFromPlan(plan);
      const quota = quotaForMetric(quotas, metric);

      const before = await usage.get(shopId, metric, now);
      const after = await usage.increment(shopId, metric, n, now);

      if (quota !== null) {
        const warn = await service.shouldFireFairUseWarning(shopId, metric, before, after);
        if (warn) {
          await prisma.notification.create({
            data: {
              shopId,
              kind: "FAIR_USE_REACHED",
              payload: { metric, used: after, quota, warnAt: plan.fairUseWarnAt },
            },
          });
        }
      }
      return after;
    },

    async shouldFireFairUseWarning(shopId, metric, before, after) {
      const plan = await loadPlan(shopId);
      const quotas = quotasFromPlan(plan);
      const quota = quotaForMetric(quotas, metric);
      if (quota === null) return false;

      const threshold = Math.ceil(quota * plan.fairUseWarnAt);
      // Fire exactly once: when this increment is the one that crossed the threshold.
      return before < threshold && after >= threshold;
    },
  };
  return service;
}
