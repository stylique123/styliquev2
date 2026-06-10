// Monthly merchant report — BullMQ worker processor.
//
// Triggered by the scheduler on the 1st of each month at 08:00 UTC as a
// global sweep, then fanned out per-shop. Idempotent — writes through the
// `MonthlyReport.@@unique([shopId, periodStart])` constraint, so a re-run
// for the same period is a no-op (skip, don't error).
//
// Email + PDF are deferred to a follow-up tick; this generates the
// MonthlyReport row that the in-app surface at /app/reports/monthly reads.

import { prisma } from "@stylique/db";
import { synthesizeMonthlyReport, renderMonthlyReportMarkdown } from "@stylique/core";

export interface MonthlyReportJob {
  scope?: "global" | "shop";
  shopId?: string;
  /** Optional override for the period end — defaults to "first day of this month at 00:00 UTC". */
  periodEnd?: string; // ISO
  trigger?: string;
}

/** Compute the standard period end = first day of this month at 00:00 UTC. */
function defaultPeriodEnd(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Fan-out helper: when scope=global, enqueue one per-shop job per active shop. */
async function fanOutPerShop(periodEnd: Date): Promise<{ enqueued: number }> {
  const shops = await prisma.shop.findMany({
    where: { uninstalledAt: null },
    select: { id: true },
  });
  // Enqueue is done by the caller (index.ts has the Queue handle). Here we
  // just return the list; the processor calling us decides how to enqueue.
  // To keep this file independent of index.ts wiring, we lazily import the
  // queue. (See index.ts wiring at processor registration.)
  const { Queue } = await import("bullmq");
  const { default: IORedis } = await import("ioredis");
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("[monthly-report] REDIS_URL missing — fan-out skipped");
    return { enqueued: 0 };
  }
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  const q = new Queue("monthly-report", { connection });
  let enqueued = 0;
  for (const s of shops) {
    await q.add(
      "monthly-report",
      { scope: "shop", shopId: s.id, periodEnd: periodEnd.toISOString() },
      { jobId: `monthly-report:${s.id}:${periodEnd.toISOString().slice(0, 7)}`, removeOnComplete: 50 },
    );
    enqueued++;
  }
  await q.close().catch(() => {});
  await connection.quit().catch(() => {});
  return { enqueued };
}

/**
 * Process one monthly-report job.
 *
 * - scope:"global" → fan out one per-shop job per active shop, return.
 * - scope:"shop"   → synthesize + render + upsert the MonthlyReport row.
 *
 * Idempotency: the `(shopId, periodStart)` unique index makes a re-run for
 * the same period a no-op (we use updateMany guarded by no-existing-row).
 */
export async function processMonthlyReport(job: MonthlyReportJob): Promise<{ ok: true; mode: string; data?: unknown }> {
  const periodEnd = job.periodEnd ? new Date(job.periodEnd) : defaultPeriodEnd();

  if (job.scope === "global" || !job.shopId) {
    const result = await fanOutPerShop(periodEnd);
    console.log(`[monthly-report] global fan-out → ${result.enqueued} shop(s)`);
    return { ok: true, mode: "global", data: result };
  }

  const shopId = job.shopId;
  const periodStart = new Date(periodEnd.getTime() - 30 * 86_400_000);

  // Skip if we already have a report for this exact period (idempotent).
  const existing = await prisma.monthlyReport.findUnique({
    where: { shopId_periodStart: { shopId, periodStart } },
    select: { id: true },
  }).catch(() => null);
  if (existing) {
    console.log(`[monthly-report] ${shopId} period ${periodStart.toISOString().slice(0, 10)} already generated — skip`);
    return { ok: true, mode: "skip", data: { id: existing.id } };
  }

  const data = await synthesizeMonthlyReport(prisma, { shopId, periodEnd });
  const markdown = renderMonthlyReportMarkdown(data);

  const created = await prisma.monthlyReport.create({
    data: {
      shopId,
      periodStart,
      periodEnd,
      dataJson: data as unknown as object,
      markdown,
    },
    select: { id: true },
  });

  console.log(`[monthly-report] ${shopId} period ${periodStart.toISOString().slice(0, 10)} → ${created.id}`);
  return { ok: true, mode: "generated", data: { id: created.id, periodEnd: periodEnd.toISOString() } };
}
