// Outcome resolver worker — the nightly MEASURE→LEARN step of the loop.
//
// When a brand acts on a BrandRecommendation, recommendations.server.ts records
// an Outcome row (PENDING) with a beforeMetrics snapshot and a resolutionDue
// deadline (now + resolutionWindowDays, default 7). This worker runs nightly,
// finds every Outcome whose window has elapsed, re-snapshots the metrics
// (afterMetrics), classifies the result (IMPROVED / NO_CHANGE / WORSENED /
// INCONCLUSIVE), and writes a human-readable learnedSignal. The resolved
// outcomes feed OutcomeService.getOutcomeWeights(), which the recommendations
// engine reads to learn which recommendation kinds actually work per shop.
//
// Wiring mirrors the other worker jobs (catalog-sync,
// recommendations): a processor function consumed by a BullMQ Worker, plus a
// scheduler that registers a repeating cron job (idempotent on jobId).

import { prisma } from "@stylique/db";
import { Worker, Queue } from "bullmq";
import type { Redis as IORedisClient } from "ioredis";
import { createOutcomeService } from "@stylique/core";

const QUEUE_NAME = "outcome-resolver";

const outcomes = createOutcomeService(prisma);

export type OutcomeResolverJobData = Record<string, never>;

export interface OutcomeResolverResult {
  due: number;
  resolved: number;
  inconclusive: number;
}

// Core processor — resolve every due Outcome. Safe to run repeatedly; rows that
// are already resolved are no longer PENDING so getDueOutcomes() excludes them.
export async function processOutcomeResolver(): Promise<OutcomeResolverResult> {
  const due = await outcomes.getDueOutcomes();
  let resolved = 0;
  let inconclusive = 0;

  for (const row of due) {
    try {
      const cls = await outcomes.resolveOutcome(row.id);
      if (!cls) continue;
      if (cls.status === "RESOLVED") resolved += 1;
      else if (cls.status === "INCONCLUSIVE") inconclusive += 1;

      // Fire an OUTCOME_RESOLVED analytics event so the dashboard + network
      // benchmarks can surface "what actually worked". Non-fatal on failure.
      try {
        await prisma.analyticsEvent.create({
          data: {
            shopId: row.shopId,
            name: "OUTCOME_RESOLVED",
            payload: {
              outcomeId: row.id,
              recommendationType: row.recommendationType,
              resultClass: cls.resultClass ?? "INCONCLUSIVE",
              confidenceScore: cls.confidenceScore,
              delta: cls.delta,
            },
          },
        });
      } catch (err) {
        console.error("[outcome-resolver] analytics event failed (non-fatal)", err);
      }

      console.log(
        `[outcome-resolver] shop=${row.shopId} outcome=${row.id} ` +
          `type=${row.recommendationType} → ${cls.status}` +
          (cls.resultClass ? `/${cls.resultClass}` : "") +
          ` conf=${cls.confidenceScore}`,
      );
    } catch (err) {
      console.error(`[outcome-resolver] failed outcome=${row.id}`, err);
    }
  }

  console.log(
    `[outcome-resolver] done — due=${due.length} resolved=${resolved} inconclusive=${inconclusive}`,
  );
  return { due: due.length, resolved, inconclusive };
}

// Creates the BullMQ Worker. Mirrors the registration style in
// apps/worker/src/index.ts (shared connection, concurrency 1 — this is a light
// nightly sweep, no need for parallelism).
export function createOutcomeResolverWorker(connection: IORedisClient): Worker<OutcomeResolverJobData> {
  return new Worker<OutcomeResolverJobData>(
    QUEUE_NAME,
    async () => {
      console.log("[outcome-resolver] nightly run starting");
      return processOutcomeResolver();
    },
    { connection, concurrency: 1 },
  );
}

// Registers the repeating nightly job at 03:00 UTC. Idempotent — BullMQ
// deduplicates on jobId, so calling this on every worker boot is safe.
// 03:00 UTC sits 15 min after sentiment (02:45) and 30 min after recommendations
// (02:30) so the three nightly Gemini/DB-heavy jobs don't burst simultaneously.
export async function scheduleOutcomeResolver(connection: IORedisClient): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.add(
    "resolve",
    {},
    {
      jobId: "outcome-resolver-nightly",
      repeat: { pattern: "0 3 * * *" },
      removeOnComplete: 20,
      removeOnFail: 100,
    },
  );
  console.log("✓ Scheduled nightly outcome resolver (03:00 UTC)");
}
