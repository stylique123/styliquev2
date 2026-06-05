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
//   recommendations   — nightly-recommendations global sweep (01:00 UTC)
//   catalog-sync      — catalog-refresh every 6 hours
//
// NOTE: Per-shop nightly recommendations are scheduled separately in index.ts
// (scheduleNightlyRecommendations) and keyed by shopId. These global entries
// complement that by ensuring at least one global sweep fires even if the
// per-shop list is stale.

import { Queue, type RepeatOptions } from "bullmq";
import type { Redis as IORedis } from "ioredis";

// ─── Schedule definitions ─────────────────────────────────────────────────────

type ScheduledJob = {
  queueName: string;
  jobName:   string;
  jobId:     string;
  data:      Record<string, unknown>;
  repeat:    RepeatOptions;
};

const SCHEDULED_JOBS: ScheduledJob[] = [
  {
    queueName: "recommendations",
    jobName:   "nightly-recommendations",
    jobId:     "global:nightly-recommendations",
    data:      { scope: "global" },
    repeat:    { pattern: "0 1 * * *" },   // 01:00 UTC daily
  },
  {
    queueName: "catalog-sync",
    jobName:   "catalog-refresh",
    jobId:     "global:catalog-refresh",
    data:      { scope: "global", trigger: "scheduled" },
    repeat:    { pattern: "0 */6 * * *" }, // every 6 hours
  },
  // Billing reconciliation — verify Shopify subscriptions are still active.
  // Runs after recommendations (02:30) and outcome resolver (03:00) so all
  // nightly Gemini/DB-heavy jobs clear before this Shopify-API sweep.
  {
    queueName: "billing-reconcile",
    jobName:   "billing-reconcile",
    jobId:     "global:billing-reconcile",
    data:      { scope: "global" },
    repeat:    { pattern: "0 4 * * *" },  // 04:00 UTC daily
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
