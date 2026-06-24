// POST /api/admin/size-charts/backfill — enqueue size-chart extraction for all
// products in the authenticated shop. Idempotent via BullMQ jobId deduplication.
//
// GET returns coverage stats: total products / with size chart / without /
// coverage percentage. Used by the dashboard to show how many products have
// a size chart.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { PrismaRuntime } from "@stylique/db";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// One connection + queue per process — created lazily on first request.
let _connection: IORedis | null = null;
let _queue: Queue | null = null;
function getQueue(): Queue {
  if (!_queue) {
    _connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    _queue = new Queue("size-chart-extract", { connection: _connection });
  }
  return _queue;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
    select: { id: true },
  });

  const queue = getQueue();
  const backfillRunId = Date.now().toString(36);
  let queued = 0;
  const failures: Array<{ productId: string; error: string }> = [];
  for (const product of products) {
    try {
      await queue.add(
        "extract",
        { shopId: shop.id, productId: product.id },
        {
          // Manual backfills must be rerunnable after a fix or API retry. Scope
          // dedupe to this request, not forever, or the admin button silently
          // stops repairing stale/missing size-chart facts.
          jobId: `size-chart:${shop.id}:${product.id}:manual:${backfillRunId}`,
          attempts: 2,
          backoff: { type: "exponential", delay: 10_000 },
          removeOnComplete: 5,
          removeOnFail: 50,
        },
      );
      queued++;
    } catch (err) {
      failures.push({
        productId: product.id,
        error: (err as Error).message,
      });
    }
  }

  if (failures.length > 0) {
    return json(
      {
        ok: false,
        error: "size_chart_backfill_partial_enqueue_failure",
        queued,
        failed: failures.length,
        total: products.length,
        failures: failures.slice(0, 10),
      },
      { status: queued > 0 ? 207 : 503 },
    );
  }

  return json({ ok: true, queued, failed: 0, total: products.length });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const [total, withSizeChart] = await Promise.all([
    prisma.product.count({ where: { shopId: shop.id } }),
    prisma.product.count({
      where: { shopId: shop.id, sizeChartJson: { not: PrismaRuntime.AnyNull } },
    }),
  ]);
  const withoutSizeChart = total - withSizeChart;

  return json({
    ok: true,
    data: {
      total,
      withSizeChart,
      withoutSizeChart,
      coverage: total === 0 ? "0%" : `${Math.round((withSizeChart / total) * 100)}%`,
    },
  });
}
