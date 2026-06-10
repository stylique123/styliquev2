import { prisma } from "@stylique/db";
import { createCatalogSyncService, decryptField } from "@stylique/core";
import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { createShopifyCatalogClient } from "../shopifyClient.js";
import { embedAllForShop, embedProductIfMissing } from "../embeddings.js";
import { createLogger } from "../logger.js";

// Lazy image-quality queue producer (D37). Catalog-sync enqueues into the
// image-quality queue after every full sync so newly-synced products get
// scored and have `primaryTryonImageId` / `widgetTier` set before any
// shopper hits the widget.
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
let _iqConnection: IORedis | null = null;
let _iqQueue: Queue | null = null;
function imageQualityQueue(): Queue {
  if (!_iqQueue) {
    _iqConnection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    _iqQueue = new Queue("image-quality", { connection: _iqConnection });
  }
  return _iqQueue;
}

// Lazy tryon-render queue producer (OI-34). Catalog-sync enqueues a pre-warm
// job after each product upsert so the VTO cache is warm before the first
// shopper taps "Try On". Idempotent via jobId deduplication in BullMQ.
let _tryonConnection: IORedis | null = null;
let _tryonQueue: Queue | null = null;
function tryonRenderQueue(): Queue {
  if (!_tryonQueue) {
    _tryonConnection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    _tryonQueue = new Queue("tryon-render", { connection: _tryonConnection });
  }
  return _tryonQueue;
}

// Lazy size-chart extraction queue producer (D39). Catalog-sync enqueues
// after each product upsert so newly-synced products get size-chart
// extraction run before any shopper requests a fit recommendation.
// Idempotent via jobId deduplication in BullMQ.
let _sizeChartConnection: IORedis | null = null;
let _sizeChartQueue: Queue | null = null;
function sizeChartQueue(): Queue {
  if (!_sizeChartQueue) {
    _sizeChartConnection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    _sizeChartQueue = new Queue("size-chart-extract", { connection: _sizeChartConnection });
  }
  return _sizeChartQueue;
}

const sync = createCatalogSyncService(prisma);

export type CatalogSyncJobData =
  | { kind: "full"; shopId: string }
  | { kind: "product"; shopId: string; shopifyProductId: string | number }
  | { kind: "delete"; shopId: string; shopifyProductId: string | number };

export async function processCatalogSync(data: CatalogSyncJobData) {
  const log = createLogger({ queue: "catalog-sync", shopId: data.shopId });
  const startedAt = Date.now();
  log.info({ kind: data.kind }, "catalog-sync job started");

  const shop = await prisma.shop.findUnique({ where: { id: data.shopId } });
  if (!shop || shop.uninstalledAt) {
    // No-op if the shop is gone/uninstalled — leaves data intact.
    log.warn("shop not found or uninstalled — skipping");
    return { skipped: true };
  }

  if (data.kind === "delete") {
    await sync.deleteByShopifyId(data.shopId, data.shopifyProductId);
    log.info({ durationMs: Date.now() - startedAt }, "catalog-sync delete complete");
    return { deleted: true };
  }

  // OI-25: encrypted at-app when APP_ENCRYPTION_KEY env is set. See lib/crypto.server.ts
  const client = createShopifyCatalogClient({
    shopDomain: shop.shopifyDomain,
    accessToken: decryptField(shop.accessToken),
  });

  if (data.kind === "full") {
    // Refresh the store's currency on every full sync — afterAuth is unreliable
    // with token-exchange auth, so the sync is the dependable place to keep
    // Shop.currencyCode fresh (Mira formats every price in it).
    try {
      const token = decryptField(shop.accessToken);
      if (token) {
        const cr = await fetch(`https://${shop.shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ query: "query { shop { currencyCode } }" }),
          signal: AbortSignal.timeout(10000),
        });
        const cj = (await cr.json()) as { data?: { shop?: { currencyCode?: string } } };
        const cc = cj.data?.shop?.currencyCode;
        if (cc) await prisma.shop.update({ where: { id: shop.id }, data: { currencyCode: cc } }).catch(() => undefined);
      }
    } catch { /* best-effort — currency defaults to USD */ }

    const res = await sync.syncAll(data.shopId, client);
    // Embed every product whose modelKey is stale or missing. Cheap at Gemini
    // quota; idempotent. Vector search becomes useful as soon as this finishes.
    const embed = await embedAllForShop(data.shopId).catch(() => ({ embedded: 0, skipped: 0 }));
    // D37 — enqueue image-quality scoring so newly synced products get
    // primaryTryonImageId + tryonReady + widgetTier set before any shopper
    // hits the widget. Job is idempotent (re-runs harmlessly). Dedupe on
    // jobId so back-to-back full syncs don't pile up.
    await imageQualityQueue().add(
      "score-all",
      { shopId: data.shopId, onlyStale: true },
      {
        jobId: `iq-after-sync:${data.shopId}`,
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 20, removeOnFail: 100,
      },
    ).catch(() => undefined);
    // D39 — enqueue size-chart extraction for EVERY active product after a full
    // sync. Previously only the single-product path did this, so a fresh install
    // never ran the unstructured-source extraction (description/linked/image) and
    // never built the per-variant `measurementsJson` bridge that `recommendFit`
    // reads — leaving the whole catalog on BMI/category defaults. Idempotent via
    // jobId; concurrency on the size-chart worker bounds the fan-out.
    const activeProducts = await prisma.product.findMany({
      where: { shopId: data.shopId },
      select: { id: true },
    });
    for (const { id: pid } of activeProducts) {
      await sizeChartQueue()
        .add(
          "extract",
          { shopId: data.shopId, productId: pid },
          {
            jobId: `size-chart:${data.shopId}:${pid}`,
            attempts: 2,
            backoff: { type: "exponential", delay: 10_000 },
            removeOnComplete: 5,
            removeOnFail: 50,
          },
        )
        .catch(() => undefined);
    }
    await prisma.notification.create({
      data: { shopId: data.shopId, kind: "CATALOG_SYNC_COMPLETED", payload: { ...res, embed, sizeChartsQueued: activeProducts.length } },
    });
    log.info({ durationMs: Date.now() - startedAt, ...res, embed, sizeChartsQueued: activeProducts.length }, "catalog-sync full sync complete");
    return { ...res, embed };
  }

  // single product
  const product = await client.fetchProduct(data.shopifyProductId);
  if (!product) {
    await sync.deleteByShopifyId(data.shopId, data.shopifyProductId);
    return { deleted: true };
  }
  const synced = await sync.syncOne(data.shopId, product);
  // Lazy-embed the row we just upserted. syncOne returns the local row.
  const pid = (synced as { productId?: string } | null)?.productId;
  if (pid) {
    await embedProductIfMissing(pid).catch(() => undefined);
    // D37 — single-product image-quality re-score. Cheap (Stage 1 is just
    // shape heuristics on the new image list).
    await imageQualityQueue().add(
      "score-one",
      { shopId: data.shopId, productId: pid },
      {
        attempts: 1,
        removeOnComplete: 50, removeOnFail: 100,
      },
    ).catch(() => undefined);

    // D39 — enqueue size-chart extraction for this product. Idempotent via
    // jobId so back-to-back syncs don't pile up duplicate jobs.
    await sizeChartQueue()
      .add(
        "extract",
        { shopId: shop.id, productId: pid },
        {
          jobId: `size-chart:${shop.id}:${pid}`,
          attempts: 2,
          backoff: { type: "exponential", delay: 10_000 },
          removeOnComplete: 5,
          removeOnFail: 50,
        },
      )
      .catch(() => undefined);

    // OI-34 — pre-warm the VTO cache for this product so the first shopper
    // doesn't wait for a cold render. Only enqueue when a garment image
    // exists and the product is marked tryon-ready (or tryonReady may be
    // null right after sync — the image-quality job above sets it; we
    // enqueue unconditionally and let the render worker skip gracefully).
    const localProduct = await prisma.product.findUnique({
      where: { id: pid },
      select: {
        id: true,
        title: true,
        category: true,
        primaryColor: true,
        colorFamily: true,
        tryonReady: true,
        images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
      },
    });
    const garmentUrl = localProduct?.images[0]?.url;
    if (garmentUrl) {
      await tryonRenderQueue().add(
        "render",
        {
          renderId: `prewarm-${pid}-${Date.now()}`,
          shopId: shop.id,
          productId: pid,
          mode: "BODY_MODEL",
          providerKey: "gemini-image",
          modelHint: "slim",
          garmentUrl,
          personImageBase64: undefined,
          personImageMime: undefined,
          hints: {
            title: localProduct?.title ?? null,
            category: localProduct?.category ?? null,
            primaryColor: localProduct?.primaryColor ?? null,
            colorFamily: localProduct?.colorFamily ?? null,
          },
        },
        {
          jobId: `prewarm:${shop.id}:${pid}`,
          removeOnComplete: 10,
          removeOnFail: 5,
        },
      ).catch(() => undefined);
    }
  }
  log.info({ durationMs: Date.now() - startedAt }, "catalog-sync single-product complete");
  return synced;
}
