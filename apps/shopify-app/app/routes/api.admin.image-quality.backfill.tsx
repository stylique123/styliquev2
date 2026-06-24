// POST /api/admin/image-quality/backfill — enqueue an image-quality scoring
// pass over every product (or one product) for this shop (D37).
//
// Triggered from the dashboard image-quality tile, from the post-install
// hook, and (eventually) nightly via the worker scheduler. Idempotent —
// queue dedupe on jobId; re-running is safe and inexpensive.
//
// GET reports coverage: total products / scored / tryon-ready / per-tier
// counts. Used by the dashboard tile so the brand sees real catalog state.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// One connection per process — created lazily on first call.
let _connection: IORedis | null = null;
let _queue: Queue | null = null;
function getQueue(): Queue {
  if (!_queue) {
    _connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    _queue = new Queue("image-quality", { connection: _connection });
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

  // Optional single-product targeting via query (?productId=...).
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  const backfillRunId = Date.now().toString(36);
  const job = await getQueue().add(
    "score",
    { shopId: shop.id, productId: productId ?? null },
    {
      // Manual backfills must be rerunnable after image-selection fixes or
      // merchant gallery changes. Scope dedupe to this request, not forever,
      // or BullMQ can dedupe against a retained completed job and the UI will
      // claim a re-score that never actually runs.
      jobId: productId
        ? `img-q:${shop.id}:${productId}:manual:${backfillRunId}`
        : `img-q:${shop.id}:all:manual:${backfillRunId}`,
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );

  return json({
    ok: true,
    data: { enqueued: true, scope: productId ? "product" : "shop", jobId: job.id },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const [total, scored, tryonReady, tier1, tier2, tier3] = await Promise.all([
    prisma.product.count({ where: { shopId: shop.id } }),
    prisma.product.count({
      where: { shopId: shop.id, qualityComputedAt: { not: null } },
    }),
    prisma.product.count({ where: { shopId: shop.id, tryonReady: true } }),
    prisma.product.count({ where: { shopId: shop.id, widgetTier: 1 } }),
    prisma.product.count({ where: { shopId: shop.id, widgetTier: 2 } }),
    prisma.product.count({ where: { shopId: shop.id, widgetTier: 3 } }),
  ]);

  return json({
    ok: true,
    data: {
      total,
      scored,
      tryonReady,
      coveragePct: total === 0 ? 0 : Math.round((scored / total) * 100),
      tryonReadyPct: total === 0 ? 0 : Math.round((tryonReady / total) * 100),
      tiers: { tier1, tier2, tier3 },
    },
  });
}
