// GET /api/health — rich liveness + readiness probe.
//
// Returns 200 when all deps are healthy, 503 when db or redis is down.
// Always returns JSON so external monitors (UptimeRobot, Checkly, etc.) can
// read individual component states even on 503.
//
// Shape:
//   { ok, ts, version, db, redis, queues: { [name]: { waiting, active, failed } }, uptimeSeconds }

import { json } from "@remix-run/node";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "../db.server";
import { env } from "../env.server";

const QUEUE_NAMES = [
  "catalog-sync",
  "creative-set",
  "brand-install",
  "recommendations",
  "tryon-render",
  "sentiment-extract",
  "image-quality",
  "size-chart-extract",
  "brand-dna-catalog",
  "brand-instagram",
  "replenishment-notify",
  "outcome-resolver",
  "billing-reconcile",
] as const;

type QueueName = (typeof QUEUE_NAMES)[number];

type QueueStats = { waiting: number; active: number; failed: number; error?: string };
type ComponentStatus = "ok" | "error";

interface HealthPayload {
  ok: boolean;
  ts: string;
  version: string;
  db: ComponentStatus;
  redis: ComponentStatus;
  reasons: string[];
  queues: Record<QueueName, QueueStats>;
  uptimeSeconds: number;
}

// Probe Redis with a short-lived connection so we don't hold an extra socket
// open in steady state. BullMQ's shared connection is also fine but this
// avoids any state from the job connection.
async function probeRedis(): Promise<{ status: ComponentStatus; reason?: string }> {
  const client = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    lazyConnect: true,
  });
  try {
    await client.connect();
    await client.ping();
    return { status: "ok" };
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : "redis_error" };
  } finally {
    client.disconnect();
  }
}

async function probeDb(): Promise<{ status: ComponentStatus; reason?: string }> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("db_timeout")), 2_000),
    );
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      timeoutPromise,
    ]);
    return { status: "ok" };
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : "db_error" };
  }
}

async function getQueueStats(
  name: QueueName,
  connection: IORedis,
): Promise<QueueStats> {
  try {
    const q = new Queue(name, { connection });
    const [waiting, active, failed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getFailedCount(),
    ]);
    await q.close();
    return { waiting, active, failed };
  } catch (err) {
    return {
      waiting: -1,
      active: -1,
      failed: -1,
      error: err instanceof Error ? err.message : "queue_error",
    };
  }
}

export async function loader() {
  const ts = new Date().toISOString();
  const version = process.env.npm_package_version ?? "dev";
  const uptimeSeconds = Math.floor(process.uptime());

  const [dbProbe, redisProbe] = await Promise.all([probeDb(), probeRedis()]);
  const reasons: string[] = [];
  if (dbProbe.status !== "ok") reasons.push(`db: ${dbProbe.reason ?? "unreachable"}`);
  if (redisProbe.status !== "ok") reasons.push(`redis: ${redisProbe.reason ?? "unreachable"}`);

  // Reuse a single ephemeral connection for all queue stat reads.
  let queues = {} as Record<QueueName, QueueStats>;
  try {
    const conn = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      lazyConnect: true,
    });
    await conn.connect();
    const results = await Promise.all(
      QUEUE_NAMES.map((name) => getQueueStats(name, conn)),
    );
    QUEUE_NAMES.forEach((name, i) => {
      queues[name] = results[i];
    });
    conn.disconnect();
  } catch {
    // If Redis is completely unreachable, fill with sentinel values.
    QUEUE_NAMES.forEach((name) => {
      queues[name] = { waiting: -1, active: -1, failed: -1, error: "redis_unavailable" };
    });
    reasons.push("queues: redis_unavailable");
  }

  const payload: HealthPayload = {
    ok: dbProbe.status === "ok" && redisProbe.status === "ok",
    ts,
    version,
    db: dbProbe.status,
    redis: redisProbe.status,
    reasons,
    queues,
    uptimeSeconds,
  };

  const status = payload.ok ? 200 : 503;
  return json(payload, { status });
}
