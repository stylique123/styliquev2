// GET /api/admin/observability — extended operational metrics for the brand dashboard.
//
// Protected by Shopify admin authentication (embedded app session).
// All queries are scoped to the authenticated shop.
//
// Response shape:
// {
//   ok: true,
//   shopId: string,
//   ts: string,
//   queues: { [name]: { waiting, active, failed, recentFailed } },
//   analyticsLast24h: { [EventName]: number },
//   vto: { total: number, completed: number, cacheHitRate: number },
//   providerUsage: { [providerKey]: number },
// }

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { env } from "../env.server";

const QUEUE_NAMES = [
  "catalog-sync",
  "brand-install",
  "recommendations",
  "tryon-render",
  "sentiment-extract",
  "image-quality",
  "size-chart-extract",
] as const;

type QueueName = (typeof QUEUE_NAMES)[number];
type QueueStats = { waiting: number; active: number; failed: number; recentFailed: number };

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
    const since = Date.now() - 6 * 60 * 60 * 1000;
    const recentFailed = await connection
      .zcount(`bull:${name}:failed`, since, "+inf")
      .catch(() => 0);
    await q.close();
    return { waiting, active, failed, recentFailed };
  } catch {
    return { waiting: -1, active: -1, failed: -1, recentFailed: -1 };
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json({ ok: false, error: "shop_not_installed" }, { status: 404 });
  }

  const shopId = shop.id;
  const ts = new Date().toISOString();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);

  // ── Queue depths ────────────────────────────────────────────────────────
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
    QUEUE_NAMES.forEach((name) => {
      queues[name] = { waiting: -1, active: -1, failed: -1, recentFailed: -1 };
    });
  }

  // ── Analytics event counts (last 24 h) scoped to this shop ─────────────
  const eventRows = await prisma.analyticsEvent.groupBy({
    by: ["name"],
    where: { shopId, createdAt: { gte: since24h } },
    _count: { _all: true },
  });
  const analyticsLast24h: Record<string, number> = {};
  for (const row of eventRows) {
    analyticsLast24h[row.name] = row._count._all;
  }

  // ── VTO cache hit rate (last 7 days) ────────────────────────────────────
  // "Cache hit" = outputImageUrl IS NOT NULL (render completed successfully).
  // We use BODY_MODEL sessions only because PERSONAL_PHOTO has no cache key.
  const [vtoTotal, vtoCompleted] = await Promise.all([
    prisma.tryOnSession.count({
      where: { shopId, createdAt: { gte: since7d } },
    }),
    prisma.tryOnSession.count({
      where: {
        shopId,
        createdAt: { gte: since7d },
        outputImageUrl: { not: null },
      },
    }),
  ]);
  const cacheHitRate =
    vtoTotal > 0 ? Math.round((vtoCompleted / vtoTotal) * 10_000) / 100 : 0;

  // ── Provider usage breakdown (last 7 days) ──────────────────────────────
  const providerRows = await prisma.tryOnSession.groupBy({
    by: ["providerKey"],
    where: {
      shopId,
      createdAt: { gte: since7d },
      providerKey: { not: null },
    },
    _count: { _all: true },
  });
  const providerUsage: Record<string, number> = {};
  for (const row of providerRows) {
    if (row.providerKey) {
      providerUsage[row.providerKey] = row._count._all;
    }
  }

  // ── Mira-assisted revenue (last 30 days) ───────────────────────────────
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  const assistedRows = await prisma.analyticsEvent.findMany({
    where: {
      shopId,
      name: "MIRA_ASSISTED_ORDER",
      createdAt: { gte: since30d },
    },
    select: { payload: true },
  });
  const assistedRevenueCents = assistedRows.reduce((sum, row) => {
    const p = row.payload as { assistedRevenueCents?: number } | null;
    return sum + (p?.assistedRevenueCents ?? 0);
  }, 0);
  const assistedOrderCount = assistedRows.length;

  return json({
    ok: true,
    shopId,
    ts,
    queues,
    analyticsLast24h,
    vto: {
      total: vtoTotal,
      completed: vtoCompleted,
      cacheHitRate,
    },
    providerUsage,
    assistedRevenue: {
      last30dCents: assistedRevenueCents,
      orderCount: assistedOrderCount,
    },
  });
}
