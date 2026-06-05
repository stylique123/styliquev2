// GET /api/ready — strict readiness probe for load-balancer use.
//
// Stricter than /api/health: the process is only "ready" when ALL of the
// following are true:
//   1. DB is reachable (SELECT 1 within 2 s)
//   2. Redis is reachable (PING within 2 s)
//   3. Required env vars are present (SHOPIFY_API_KEY, DATABASE_URL, REDIS_URL)
//
// Returns HTTP 200 + JSON when fully ready.
// Returns HTTP 503 + JSON (with detail) when not ready.
//
// Used by Docker HEALTHCHECK and load-balancer health probes before routing
// any traffic to a new instance.

import { json } from "@remix-run/node";
import IORedis from "ioredis";
import { prisma } from "../db.server";

const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SESSION_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
] as const;

interface ReadinessPayload {
  ready: boolean;
  reason?: string;
  checks: {
    db: "ok" | "error";
    redis: "ok" | "error";
    env: "ok" | "error";
    missingEnv?: string[];
  };
  timestamp: string;
}

async function checkDb(): Promise<{ status: "ok" | "error"; reason?: string }> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("db_timeout")), 2_000),
    );
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return { status: "ok" };
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : "db_error" };
  }
}

async function checkRedis(): Promise<{ status: "ok" | "error"; reason?: string }> {
  const url = process.env.REDIS_URL;
  if (!url) return { status: "error", reason: "REDIS_URL missing" };
  const client = new IORedis(url, {
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

export async function loader() {
  const timestamp = new Date().toISOString();

  // Check env vars synchronously — no I/O needed.
  const missingEnv = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  const envOk = missingEnv.length === 0;

  // Check DB + Redis in parallel.
  const [dbProbe, redisProbe] = await Promise.all([checkDb(), checkRedis()]);

  const ready = envOk && dbProbe.status === "ok" && redisProbe.status === "ok";

  const payload: ReadinessPayload = {
    ready,
    checks: {
      db: dbProbe.status,
      redis: redisProbe.status,
      env: envOk ? "ok" : "error",
      ...(missingEnv.length > 0 && { missingEnv }),
    },
    timestamp,
  };

  if (!ready) {
    const reasons: string[] = [];
    if (!envOk) reasons.push(`missing_env: ${missingEnv.join(", ")}`);
    if (dbProbe.status === "error") reasons.push(`db_unreachable: ${dbProbe.reason ?? "unknown"}`);
    if (redisProbe.status === "error") reasons.push(`redis_unreachable: ${redisProbe.reason ?? "unknown"}`);
    payload.reason = reasons.join("; ");
  }

  return json(payload, { status: ready ? 200 : 503 });
}
