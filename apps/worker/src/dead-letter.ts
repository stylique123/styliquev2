// Stylique Fashion — dead-letter handler.
//
// Called on every worker `failed` event. Logs the failure in structured JSON,
// optionally ships to Sentry when SENTRY_DSN is configured, and writes a
// Redis dead-letter-queue (DLQ) key so ops can inspect failures without
// querying BullMQ's failed set directly.
//
// DLQ Redis key format:  dlq:{queueName}:{jobId}
// TTL:                   7 days (matches BullMQ's removeOnFail behaviour)
//
// Usage (in index.ts):
//   import { handleFailedJob } from "./dead-letter.js";
//   someWorker.on("failed", (job, err) => void handleFailedJob(someWorker.name, job, err));

import type { Job } from "bullmq";
import type { Redis as IORedis } from "ioredis";

const DLQ_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ─── Sentry (optional) ────────────────────────────────────────────────────────
// We import Sentry lazily so the worker starts even if the package is absent
// or SENTRY_DSN is not set. The types are narrow to avoid a hard devDependency.

let _sentry: { captureException: (err: unknown, ctx: object) => void } | null = null;

async function getSentry() {
  if (_sentry !== null) return _sentry;
  if (!process.env.SENTRY_DSN) {
    _sentry = { captureException: () => {} };
    return _sentry;
  }
  try {
    // Dynamic import — @sentry/node must be installed for this to resolve.
    const Sentry = await import("@sentry/node" as string) as {
      init: (opts: object) => void;
      captureException: (err: unknown, ctx: object) => void;
    };
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
    _sentry = Sentry;
  } catch {
    // Sentry package not installed — fail silently.
    _sentry = { captureException: () => {} };
  }
  return _sentry;
}

// ─── DLQ metadata written to Redis ───────────────────────────────────────────

type DlqEntry = {
  queue:     string;
  jobId:     string;
  jobName:   string;
  data:      unknown;
  error:     string;
  stack?:    string;
  attempts:  number;
  failedAt:  string;
};

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * handleFailedJob — call this inside every worker's `failed` event handler.
 *
 * @param queueName  The BullMQ queue name (worker.name).
 * @param job        The BullMQ Job instance (may be undefined on connection loss).
 * @param error      The error thrown by the processor.
 * @param redis      The shared IORedis connection used to write the DLQ key.
 */
export async function handleFailedJob(
  queueName: string,
  job: Job | undefined,
  error: Error,
  redis: IORedis,
): Promise<void> {
  const jobId   = job?.id   ?? "unknown";
  const jobName = job?.name ?? "unknown";
  const data    = job?.data ?? null;

  // ── 1. Structured log ────────────────────────────────────────────────────
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     "error",
      queue:     queueName,
      jobId,
      jobName,
      message:   error.message,
      stack:     error.stack,
      attempts:  job?.attemptsMade ?? 0,
    }),
  );

  // ── 2. Redis DLQ entry ───────────────────────────────────────────────────
  const dlqKey: string = `dlq:${queueName}:${jobId}`;
  const entry: DlqEntry = {
    queue:    queueName,
    jobId,
    jobName,
    data,
    error:    error.message,
    stack:    error.stack,
    attempts: job?.attemptsMade ?? 0,
    failedAt: new Date().toISOString(),
  };

  try {
    await redis.set(dlqKey, JSON.stringify(entry), "EX", DLQ_TTL_SECONDS);
  } catch (redisErr) {
    // DLQ write failure must not mask the original error — log and continue.
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level:     "warn",
        queue:     queueName,
        jobId,
        message:   "Failed to write DLQ entry to Redis",
        redisError: (redisErr as Error).message,
      }),
    );
  }

  // ── 3. Sentry capture (when SENTRY_DSN is set) ───────────────────────────
  try {
    const sentry = await getSentry();
    sentry.captureException(error, {
      extra: { queue: queueName, jobId, jobName, attempts: job?.attemptsMade ?? 0 },
      tags:  { queue: queueName },
    });
  } catch {
    // Sentry call must never crash the worker — swallow any error here.
  }
}
