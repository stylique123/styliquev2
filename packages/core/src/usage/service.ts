import type { PrismaClient } from "@stylique/db";
import type { UsageMetric } from "@stylique/types";
import { currentPeriodStart } from "../plans/index.js";

export interface UsageService {
  get(shopId: string, metric: UsageMetric, now?: Date): Promise<number>;
  increment(shopId: string, metric: UsageMetric, n?: number, now?: Date): Promise<number>;
}

export function createUsageService(prisma: PrismaClient): UsageService {
  return {
    async get(shopId, metric, now = new Date()) {
      const periodStart = currentPeriodStart(now);
      const row = await prisma.usageCounter.findUnique({
        where: { shopId_metric_periodStart: { shopId, metric, periodStart } },
      });
      return row?.count ?? 0;
    },

    async increment(shopId, metric, n = 1, now = new Date()) {
      const periodStart = currentPeriodStart(now);
      // Atomic upsert + increment.
      const row = await prisma.usageCounter.upsert({
        where: { shopId_metric_periodStart: { shopId, metric, periodStart } },
        update: { count: { increment: n } },
        create: { shopId, metric, periodStart, count: n },
      });
      return row.count;
    },
  };
}
