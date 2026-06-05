// Worker job — score every ProductImage for one shop (D37).
//
// Triggered from catalog-sync after products land, and from the admin
// backfill endpoint. Idempotent — re-running on a shop just re-scores
// rows whose `qualityCheckedAt` is older than the model version (or null).
//
// Per-product flow:
//   1. Load all ProductImage rows.
//   2. Hand them to scoreProductImages (Stage 1 + optional Stage 2).
//   3. Transaction: write back per-image qualityScore/reasons/role +
//      Product.primaryTryonImageId + tryonReady + widgetTier + computedAt.
//
// Concurrency: BullMQ queue concurrency capped at 2 in apps/worker/src/index.ts
// so we don't saturate the CDN with HEAD probes. Per-shop fan-out is bounded
// by BATCH_SIZE below.

import { prisma } from "@stylique/db";
import {
  scoreProductImages,
  toImageInput,
  selectBackgroundRemoverFromEnv,
  compositeOntoStudio,
  type BackgroundRemoverProvider,
  type ImageBytes,
} from "@stylique/core";

export type ImageQualityJobData = {
  shopId: string;
  // If provided, only score this one product (used by catalog-sync hooks
  // when a single product changes). If null, score every product in the
  // shop (used by the admin backfill route).
  productId?: string | null;
  // If true, skip products whose qualityComputedAt is non-null and within
  // the last 30 days. Used for nightly maintenance runs.
  onlyStale?: boolean;
};

const BATCH_SIZE = 25;
const STALE_DAYS = 30;

export async function processImageQuality(data: ImageQualityJobData): Promise<{
  shopId: string;
  productsScored: number;
  tryonReadyCount: number;
}> {
  const where: { shopId: string; id?: string; OR?: Array<Record<string, unknown>> } = {
    shopId: data.shopId,
  };
  if (data.productId) where.id = data.productId;
  if (data.onlyStale && !data.productId) {
    const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000);
    where.OR = [{ qualityComputedAt: null }, { qualityComputedAt: { lt: cutoff } }];
  }

  let productsScored = 0;
  let tryonReadyCount = 0;
  let cursor: string | undefined;

  // Paginate so a shop with 10k products doesn't OOM the worker.
  for (;;) {
    const batch = await prisma.product.findMany({
      where,
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        images: {
          select: { id: true, url: true, position: true, shopifyId: true },
          orderBy: { position: "asc" },
        },
      },
    });
    if (batch.length === 0) break;

    for (const product of batch) {
      try {
        const update = await scoreProductImages({
          productId: product.id,
          images: product.images.map(toImageInput),
        });
        await persistProductUpdate(update);
        productsScored++;
        if (update.tryonReady) tryonReadyCount++;

        // ─── D38 Stage 3 — Prep the chosen primary onto the studio backdrop.
        // Only runs when the scorer picked a primary (tryonReady=true) and
        // the row doesn't already have a prepped URL. Pure best-effort: any
        // failure is logged and the pipeline continues — the widget falls
        // back to the raw `url` so the surface never breaks.
        if (update.tryonReady && update.primaryTryonImageId) {
          await prepPrimaryImageOntoStudio(update.primaryTryonImageId).catch(
            (err: unknown) =>
              console.error(
                `[image-quality:prep] product=${product.id} primary=${update.primaryTryonImageId} failed:`,
                (err as Error).message,
              ),
          );
        }
      } catch (err) {
        console.error(`[image-quality] product=${product.id} failed:`, (err as Error).message);
      }
    }

    if (batch.length < BATCH_SIZE) break;
    cursor = batch[batch.length - 1].id;
  }

  return { shopId: data.shopId, productsScored, tryonReadyCount };
}

// ─── D38 Stage 3 — Background-strip + studio composite ────────────────
// Pulls the bytes for one ProductImage, runs them through the configured
// BackgroundRemoverProvider, composites onto the procedural studio
// backdrop, persists the result as `preppedUrl` on the row.
//
// Storage: v1 writes the prepped PNG as a data: URL in `preppedUrl`. When
// S3 lands per D34/OI-31, swap the persistence line for an S3 upload and
// a presigned URL. Widget read path (`getProduct.tryonImageUrl`) already
// prefers `preppedUrl` over `url`, so the upgrade is invisible to it.
//
// All providers (rembg / Replicate / stub) return the input unchanged on
// failure — never throws. So this whole helper is a safe best-effort.

let _bgProvider: BackgroundRemoverProvider | null = null;
function bgProvider(): BackgroundRemoverProvider {
  if (!_bgProvider) _bgProvider = selectBackgroundRemoverFromEnv();
  return _bgProvider;
}

async function prepPrimaryImageOntoStudio(imageId: string): Promise<void> {
  const row = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { id: true, url: true, preppedUrl: true },
  });
  if (!row) return;
  if (row.preppedUrl) return; // already prepped — re-prep only when admin clears

  // Fetch the bytes. Bound the response size to avoid memory blowouts on
  // unexpectedly-large images (Stage 1 already capped at 8MB but defense
  // in depth is cheap).
  const res = await fetch(row.url);
  if (!res.ok) throw new Error(`fetch_${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > 10 * 1024 * 1024) {
    throw new Error("image_too_large_for_prep");
  }
  const mimeType = inferMimeType(row.url, res.headers.get("content-type"));
  const input: ImageBytes = { data: buf, mimeType };

  // Strip background → composite onto studio backdrop. Both steps are
  // safe under failure: provider returns input unchanged, composite stub
  // returns subject unchanged. Either way we end up with a usable PNG.
  const stripped = await bgProvider().strip(input);
  const composited = await compositeOntoStudio({ subject: stripped });

  // Persist as data: URL for v1. Tiny footprint (~50-300KB encoded) per
  // primary image; replace with S3 presigned URL when S3 lands.
  const dataUrl = `data:${composited.png.mimeType};base64,${bufferToBase64(composited.png.data)}`;
  await prisma.productImage.update({
    where: { id: imageId },
    data: { preppedUrl: dataUrl, preppedAt: new Date() },
  });
}

function inferMimeType(
  url: string,
  contentType: string | null,
): "image/png" | "image/jpeg" | "image/webp" {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("png")) return "image/png";
  if (ct.includes("webp")) return "image/webp";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "image/jpeg";
  if (/\.png(\?|$)/i.test(url)) return "image/png";
  if (/\.webp(\?|$)/i.test(url)) return "image/webp";
  return "image/jpeg";
}

function bufferToBase64(buf: Uint8Array): string {
  // Node-side helper — apps/worker runs on Node, so Buffer is available.
  return Buffer.from(buf).toString("base64");
}

async function persistProductUpdate(update: {
  productId: string;
  primaryTryonImageId: string | null;
  tryonReady: boolean;
  widgetTier: 1 | 2 | 3;
  perImage: Array<{
    imageId: string;
    qualityScore: number;
    qualityReasons: string[];
    qualityProvider: string;
    garmentRole?: "FRONT" | "BACK" | "DETAIL" | "LIFESTYLE" | "SWATCH";
    widthPx?: number;
    heightPx?: number;
    bytes?: number;
  }>;
}) {
  const now = new Date();

  await prisma.$transaction([
    // Per-image scores.
    ...update.perImage.map((u) =>
      prisma.productImage.update({
        where: { id: u.imageId },
        data: {
          qualityScore: u.qualityScore,
          qualityReasons: u.qualityReasons,
          qualityProvider: u.qualityProvider,
          qualityCheckedAt: now,
          widthPx: u.widthPx ?? null,
          heightPx: u.heightPx ?? null,
          bytes: u.bytes ?? null,
          garmentRole: u.garmentRole ?? null,
        },
      }),
    ),
    // Product-level summary.
    prisma.product.update({
      where: { id: update.productId },
      data: {
        primaryTryonImageId: update.primaryTryonImageId,
        tryonReady: update.tryonReady,
        widgetTier: update.widgetTier,
        qualityComputedAt: now,
      },
    }),
  ]);
}
