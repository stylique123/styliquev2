// Stylique Fashion — repeatable-job scheduler.
//
// Registers platform-level repeating jobs that are NOT per-shop (those live in
// scheduleNightlyRecommendations() in index.ts). The jobs here are global
// infrastructure sweeps.
//
// Called once at worker startup. Idempotent — BullMQ deduplicates by jobId so
// running this on every restart is safe and required (BullMQ loses repeatable
// jobs on Redis flush; re-registering restores them automatically).
//
// Queues registered:
//   recommendations    — nightly-recommendations global sweep (01:00 UTC)
//   catalog-sync       — catalog-refresh every 6 hours
//   retention-cleanup  — GDPR Art. 5(1)(e) weekly purge (Mon 03:00 UTC)
//
// NOTE: Per-shop nightly recommendations are scheduled separately in index.ts
// (scheduleNightlyRecommendations) and keyed by shopId. These global entries
// complement that by ensuring at least one global sweep fires even if the
// per-shop list is stale.

import { Queue, type RepeatOptions } from "bullmq";
import type { Redis as IORedis } from "ioredis";
import { prisma } from "@stylique/db";
import { runRetentionCleanup } from "./jobs/retention-cleanup.js";

// ─── Schedule definitions ─────────────────────────────────────────────────────

type ScheduledJob = {
  queueName: string;
  jobName:   string;
  jobId:     string;
  data:      Record<string, unknown>;
  repeat:    RepeatOptions;
};

const SCHEDULED_JOBS: ScheduledJob[] = [
  // Catalog-refresh — the ONLY scheduled catalog sweep. Enqueued as scope:"global";
  // the catalog-sync worker (apps/worker/src/index.ts) detects scope:"global" and
  // FANS OUT one per-shop {kind:"full", shopId} job per active shop. Without that
  // fan-out this ran with shopId:undefined and silently no-op'd (consolidation P1.1).
  //
  // NOTE: nightly recommendations and daily billing-reconcile are scheduled
  // PER-SHOP in index.ts (scheduleNightlyRecommendations / scheduleBillingReconcile)
  // — the previous global {scope:"global"} entries here were redundant duplicates
  // that hit per-shop processors with shopId:undefined, so they are removed.
  {
    queueName: "catalog-sync",
    jobName:   "catalog-refresh",
    jobId:     "global:catalog-refresh",
    data:      { scope: "global", trigger: "scheduled" },
    repeat:    { pattern: "0 */6 * * *" }, // every 6 hours
  },
  // GDPR Art. 5(1)(e) retention cleanup — weekly purge of stale ShopperSession
  // rows.  Monday 03:00 UTC: after the nightly Gemini sweeps (02:30/02:45) and
  // before billing reconcile (04:00).  The job runs at the worker level against
  // the prisma singleton — no per-shop fan-out needed (one DELETE per category).
  {
    queueName: "retention-cleanup",
    jobName:   "retention-cleanup",
    jobId:     "retention-cleanup",
    data:      { scope: "global" },
    repeat:    { pattern: "0 3 * * 1" },  // Monday 03:00 UTC
  },
  // Monthly merchant optimization report — Session 1 of the founder's
  // 4-session plan. Fires on the 1st of each month at 08:00 UTC, runs as
  // a global sweep; the monthly-report worker (apps/worker/src/index.ts)
  // detects scope:"global" and fans out one job per active shop, just like
  // catalog-refresh does.
  {
    queueName: "monthly-report",
    jobName:   "monthly-report",
    jobId:     "global:monthly-report",
    data:      { scope: "global", trigger: "scheduled" },
    repeat:    { pattern: "0 8 1 * *" },  // 1st of month, 08:00 UTC
  },
];

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * startScheduler — idempotently registers all repeatable jobs.
 *
 * For each job we check whether a repeatable job with the same `jobId`-derived
 * key already exists. If it does, we skip adding it (no-op). If not, we add it.
 * This prevents duplicate cron entries accumulating on repeated worker restarts.
 *
 * @param connection Shared IORedis connection used for all BullMQ Queue clients.
 */
export async function startScheduler(connection: IORedis): Promise<void> {
  console.log("[scheduler] registering repeatable jobs…");

  for (const job of SCHEDULED_JOBS) {
    const queue = new Queue(job.queueName, { connection });

    try {
      // BullMQ stores repeatable jobs keyed by (name + repeat key).
      // Check existing repeatables to avoid double-registration.
      const existing = await queue.getRepeatableJobs();
      const alreadyRegistered = existing.some(
        (r) => r.name === job.jobName && r.key.includes(job.jobId),
      );

      if (alreadyRegistered) {
        console.log(
          `[scheduler] ${job.queueName}/${job.jobName} already registered — skipping`,
        );
      } else {
        await queue.add(
          job.jobName,
          job.data,
          {
            jobId:           job.jobId,
            repeat:          job.repeat,
            removeOnComplete: 20,
            removeOnFail:     100,
          },
        );
        console.log(
          `[scheduler] registered ${job.queueName}/${job.jobName} (${
            (job.repeat as { pattern: string }).pattern
          })`,
        );
      }
    } catch (err) {
      // Scheduler failure must not crash the worker process — log and continue.
      console.error(
        `[scheduler] failed to register ${job.queueName}/${job.jobName}:`,
        (err as Error).message,
      );
    } finally {
      // Close the transient Queue handle — we don't need it beyond registration.
      await queue.close().catch(() => {});
    }
  }

  console.log("[scheduler] all repeatable jobs processed");
}
