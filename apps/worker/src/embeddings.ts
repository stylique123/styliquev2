// Worker-side embeddings — same shape as apps/shopify-app/app/lib/embeddings.server.ts
// but bound to @stylique/db's prisma. Lives here so the catalog-sync worker
// can lazy-backfill embeddings as products land, without a round-trip through
// the Remix app.
//
// SECURITY: every read/write is shopId-scoped. The service has no notion of
// cross-shop products — by construction it can't leak.

import { prisma } from "@stylique/db";
import {
  createEmbeddingsService,
  createGeminiEmbedProvider,
  type EmbeddingsService,
} from "@stylique/core";

let _svc: EmbeddingsService | null = null;

function tryGetService(): EmbeddingsService | null {
  if (_svc) return _svc;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  _svc = createEmbeddingsService(
    createGeminiEmbedProvider({ apiKey: key, model: process.env.GEMINI_EMBED_MODEL }),
  );
  return _svc;
}

// Embed every product in a shop that isn't already at the current modelKey.
// Throttled (40ms default) to stay friendly to the Gemini quota.
export async function embedAllForShop(
  shopId: string,
  opts?: { limit?: number; delayMs?: number },
): Promise<{
  embedded: number;
  skipped: number;
  failed: number;
  total: number;
  providerConfigured: boolean;
}> {
  const svc = tryGetService();
  if (!svc) return { embedded: 0, skipped: 0, failed: 0, total: 0, providerConfigured: false };
  const limit = opts?.limit ?? 5000;
  const delay = opts?.delayMs ?? 40;

  const products = await prisma.product.findMany({
    where: { shopId },
    select: {
      id: true, title: true, productType: true,
      primaryColor: true, colorFamily: true, category: true, tags: true,
      embedding: { select: { modelKey: true } },
    },
    take: limit,
  });

  let embedded = 0, skipped = 0, failed = 0;
  for (const p of products) {
    if (p.embedding?.modelKey === svc.provider.modelKey) { skipped++; continue; }
    const text = svc.productEmbeddingText(p);
    try {
      const vector = await svc.embed(text);
      await prisma.productEmbedding.upsert({
        where: { productId: p.id },
        create: { shopId, productId: p.id, vector, modelKey: svc.provider.modelKey },
        update: { vector, modelKey: svc.provider.modelKey, computedAt: new Date() },
      });
      embedded++;
    } catch {
      failed++;
    }
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
  return { embedded, skipped, failed, total: products.length, providerConfigured: true };
}

// Embed a single product if missing or stale. Used after single-product sync.
export async function embedProductIfMissing(productId: string): Promise<void> {
  const svc = tryGetService();
  if (!svc) return;
  const p = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true, shopId: true, title: true, productType: true,
      primaryColor: true, colorFamily: true, category: true, tags: true,
      embedding: { select: { modelKey: true } },
    },
  });
  if (!p) return;
  if (p.embedding?.modelKey === svc.provider.modelKey) return;
  const text = svc.productEmbeddingText(p);
  let vector: number[];
  try { vector = await svc.embed(text); } catch { return; }
  await prisma.productEmbedding.upsert({
    where: { productId: p.id },
    create: { shopId: p.shopId, productId: p.id, vector, modelKey: svc.provider.modelKey },
    update: { vector, modelKey: svc.provider.modelKey, computedAt: new Date() },
  }).catch(() => undefined);
}
