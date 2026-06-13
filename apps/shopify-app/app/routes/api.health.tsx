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
  "outcome-resolver",
  "billing-reconcile",
] as const;

type QueueName = (typeof QUEUE_NAMES)[number];

type QueueStats = { waiting: number; active: number; failed: number; recentFailed?: number; error?: string };
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
    // Recent failures only (last 6h). BullMQ's failed set is a sorted set scored
    // by failure timestamp, so this is a cheap ZCOUNT — and it avoids flapping
    // health to 503 forever on a cumulative pile of stale old failures.
    const since = Date.now() - 6 * 60 * 60 * 1000;
    const recentFailed = await connection
      .zcount(`bull:${name}:failed`, since, "+inf")
      .catch(() => 0);
    await q.close();
    return { waiting, active, failed, recentFailed };
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

  // Fail loud when a CRITICAL queue is backed up with failures. A 200 while
  // catalog-sync has 41 failed jobs (panel finding) means external monitors never
  // alert on a silently-broken pipeline. failed === -1 is the redis-unreachable
  // sentinel (handled by the redis probe), so it never false-triggers here.
  const CRITICAL_QUEUES = ["catalog-sync", "tryon-render", "recommendations"] as const;
  const QUEUE_FAIL_THRESHOLD = 5;
  const queuesHealthy = CRITICAL_QUEUES.every((q) => {
    const f = queues[q]?.recentFailed ?? 0;
    if (f >= QUEUE_FAIL_THRESHOLD) {
      reasons.push(`queue ${q}: ${f} failed jobs in last 6h`);
      return false;
    }
    return true;
  });

  const payload: HealthPayload = {
    ok: dbProbe.status === "ok" && redisProbe.status === "ok" && queuesHealthy,
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
