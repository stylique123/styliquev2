// Server-side embeddings — wires the @stylique/core service to our prisma
// instance + GEMINI_API_KEY, and exposes the operations the Brain needs:
//
//   • embedProductIfMissing(productId)    — lazy backfill on first search
//   • embedAllForShop(shopId)             — batch backfill (admin / cron)
//   • vectorSearchProducts(shopId, query) — Brain's fallback when ILIKE thins
//
// Cost discipline: 1 embedding call ≈ free at Gemini quota. We dedupe by
// modelKey so a product isn't re-embedded unless the provider changes.

import { prisma } from "../db.server";
import {
  createEmbeddingsService,
  createGeminiEmbedProvider,
  type EmbeddingsService,
} from "@stylique/core";

let _service: EmbeddingsService | null = null;

function getService(): EmbeddingsService {
  if (_service) return _service;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("embed_no_provider");
  _service = createEmbeddingsService(
    createGeminiEmbedProvider({ apiKey: key, model: process.env.GEMINI_EMBED_MODEL })
  );
  return _service;
}

// Tier-A guard: skip silently if the provider isn't configured so the chat
// flow still works (just without vector fallback).
function tryGetService(): EmbeddingsService | null {
  try { return getService(); } catch { return null; }
}

// ─── embedProductIfMissing ──────────────────────────────────────────────
// Called lazily during search. If the embedding is missing or stale (model
// changed), compute and store. Idempotent — safe to call concurrently.
export async function embedProductIfMissing(productId: string): Promise<void> {
  const svc = tryGetService();
  if (!svc) return;
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true, shopId: true, title: true, productType: true,
      primaryColor: true, colorFamily: true, category: true, tags: true,
      embedding: { select: { modelKey: true } },
    },
  });
  if (!product) return;
  if (product.embedding?.modelKey === svc.provider.modelKey) return; // up to date

  const text = svc.productEmbeddingText(product);
  let vector: number[];
  try { vector = await svc.embed(text); }
  catch { return; }  // fail-open — search still works via ILIKE

  await prisma.productEmbedding.upsert({
    where: { productId: product.id },
    create: {
      shopId: product.shopId,
      productId: product.id,
      vector,
      modelKey: svc.provider.modelKey,
    },
    update: { vector, modelKey: svc.provider.modelKey, computedAt: new Date() },
  }).catch(() => undefined);
}

// ─── embedAllForShop ────────────────────────────────────────────────────
// Batch backfill — used on first install or after switching providers.
// Throttled with a soft delay between embed calls to stay friendly to the
// embed-API rate limit (Gemini ~1500 req/min on default key).
export async function embedAllForShop(shopId: string, opts?: { limit?: number; delayMs?: number }): Promise<{
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

// ─── vectorSearchProducts ──────────────────────────────────────────────
// Brain's fallback: cosine-rank all of the shop's embeddings against the
// shopper's query embedding. At <5000 products this is fast enough
// (~10-50ms). When we cross 5k per shop, switch to pgvector or Chroma.
export async function vectorSearchProducts(args: {
  shopId: string;
  query: string;
  limit?: number;
}): Promise<Array<{ productId: string; score: number }>> {
  const svc = tryGetService();
  if (!svc) return [];
  const limit = Math.min(args.limit ?? 8, 20);
  let qvec: number[];
  try { qvec = await svc.embed(args.query); } catch { return []; }

  // SECURITY: shopId-scoped. Cross-tenant impossible.
  const rows = await prisma.productEmbedding.findMany({
    where: { shopId: args.shopId, modelKey: svc.provider.modelKey },
    select: { productId: true, vector: true },
    take: 5000,
  });
  if (!rows.length) return [];

  return svc.topK(
    qvec,
    rows.map((r) => ({ id: r.productId, vector: r.vector })),
    limit,
  ).map((r) => ({ productId: r.id, score: r.score }));
}
