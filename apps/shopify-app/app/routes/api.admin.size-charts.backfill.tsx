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
  for (const product of products) {
    await queue
      .add(
        "extract",
        { shopId: shop.id, productId: product.id },
        {
          // Idempotent — a product already queued won't be duplicated.
          jobId: `size-chart:${shop.id}:${product.id}`,
          attempts: 2,
          backoff: { type: "exponential", delay: 10_000 },
          removeOnComplete: 5,
          removeOnFail: 50,
        },
      )
      .catch(() => undefined);
  }

  return json({ ok: true, queued: products.length });
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
      where: { shopId: shop.id, sizeChartJson: { not: undefined } },
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
