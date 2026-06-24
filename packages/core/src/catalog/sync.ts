// CatalogSyncService — orchestrates fetch → normalize → upsert → audit.
// Stateless service; tests pass a fake Prisma and a fake Shopify client.
// The Shopify client is an interface so apps/worker can inject a real GraphQL client.

import type { PrismaClient } from "@stylique/db";
import { normalizeProduct, type NormalizedProduct, type ShopifyProductInput } from "./normalize.js";
import { baselineAudit } from "./audit.js";

export interface ShopifyCatalogClient {
  fetchAllProducts(): Promise<ShopifyProductInput[]>;
  fetchProduct(shopifyId: string | number): Promise<ShopifyProductInput | null>;
}

export interface CatalogSyncService {
  syncAll(shopId: string, client: ShopifyCatalogClient): Promise<{ upserted: number; deactivated: number }>;
  syncOne(shopId: string, input: ShopifyProductInput): Promise<{ productId?: string; deleted?: true }>;
  deleteByShopifyId(shopId: string, shopifyProductId: string | number): Promise<void>;
  markShopUninstalled(shopId: string): Promise<void>;
}

export function createCatalogSyncService(prisma: PrismaClient): CatalogSyncService {
  async function upsertNormalized(shopId: string, n: NormalizedProduct): Promise<string> {
    const product = await prisma.product.upsert({
      where: { shopId_shopifyId: { shopId, shopifyId: n.shopifyId } },
      update: {
        handle: n.handle, title: n.title, productType: n.productType, vendor: n.vendor,
        descriptionHtml: n.descriptionHtml,
        tags: n.tags,
        // Preserve a previously-good category if a later sync can't infer one
        // (e.g. tags/productType stripped during a theme edit) — same protective
        // asymmetry as sizeChartJson below; don't null out good data.
        ...(n.category != null ? { category: n.category } : {}),
        primaryColor: n.primaryColor, colorFamily: n.colorFamily,
        // D37 — persist size chart when the metafield was found; preserve
        // existing value when the new sync didn't find one (brand may have
        // removed the metafield temporarily during a theme update).
        ...(n.sizeChartJson != null
          ? { sizeChartJson: n.sizeChartJson, sizeChartSource: n.sizeChartSource }
          : {}),
      },
      create: {
        shopId, shopifyId: n.shopifyId, handle: n.handle, title: n.title,
        productType: n.productType, vendor: n.vendor, descriptionHtml: n.descriptionHtml,
        tags: n.tags, category: n.category,
        primaryColor: n.primaryColor, colorFamily: n.colorFamily,
        sizeChartJson: n.sizeChartJson ?? undefined,
        sizeChartSource: n.sizeChartSource ?? undefined,
      },
    });

    for (const v of n.variants) {
      // Inventory mirror (Request B): only stamp inventorySyncedAt when the
      // source actually carried a quantity, so a REST payload (no inventory)
      // doesn't wipe a previously-synced GraphQL value to null.
      const inventoryPatch =
        v.inventoryQuantity != null || v.availableForSale != null
          ? {
              inventoryQuantity: v.inventoryQuantity,
              availableForSale: v.availableForSale,
              inventorySyncedAt: new Date(),
            }
          : {};
      await prisma.productVariant.upsert({
        where: { productId_shopifyId: { productId: product.id, shopifyId: v.shopifyId } },
        update: { sku: v.sku, size: v.size, color: v.color, priceCents: v.priceCents, ...inventoryPatch },
        create: { productId: product.id, shopifyId: v.shopifyId, sku: v.sku, size: v.size, color: v.color, priceCents: v.priceCents, ...inventoryPatch },
      });
    }
    await prisma.productVariant.deleteMany({
      where: {
        productId: product.id,
        NOT: { shopifyId: { in: n.variants.map((v) => v.shopifyId) } },
      },
    });

    const existingImages = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { position: "asc" },
      select: { shopifyId: true, url: true, altText: true, position: true },
    });
    const imagesChanged = !sameImageSet(existingImages, n.images);
    if (imagesChanged) {
      // Replace images when Shopify image truth actually changed. Reset
      // product-level image quality in the same window: image rows get new DB
      // ids, so any previous primaryTryonImageId points at a row that is about
      // to disappear until the async scorer catches up.
      await prisma.product.update({
        where: { id: product.id },
        data: {
          primaryTryonImageId: null,
          tryonReady: false,
          widgetTier: 3,
          qualityComputedAt: null,
        },
      });
      await prisma.productImage.deleteMany({ where: { productId: product.id } });
      if (n.images.length) {
        await prisma.productImage.createMany({
          data: n.images.map((img) => ({
            productId: product.id,
            shopifyId: img.shopifyId,
            url: img.url,
            altText: img.altText,
            position: img.position,
            role: "CATALOG" as const,
          })),
        });
      }
    }

    const audit = baselineAudit(n);
    await prisma.productAudit.upsert({
      where: { shopId_productId: { shopId, productId: product.id } },
      update: {
        missingSizeChart: audit.missingSizeChart,
        weakImageQuality: audit.weakImageQuality,
        missingStyling: audit.missingStyling,
        missingTryOnReady: audit.missingTryOnReady,
        missingColorCombos: audit.missingColorCombos,
        recommendations: audit.recommendations,
        priorityScore: audit.priorityScore,
      },
      create: {
        shopId, productId: product.id,
        missingSizeChart: audit.missingSizeChart,
        weakImageQuality: audit.weakImageQuality,
        missingStyling: audit.missingStyling,
        missingTryOnReady: audit.missingTryOnReady,
        missingColorCombos: audit.missingColorCombos,
        recommendations: audit.recommendations,
        priorityScore: audit.priorityScore,
      },
    });

    return product.id;
  }

  return {
    async syncAll(shopId, client) {
      const shopifyProducts = await client.fetchAllProducts();
      const seen = new Set<string>();
      let upserted = 0;
      for (const sp of shopifyProducts) {
        const n = normalizeProduct(sp);
        if (!n.isActive) {
          await prisma.product.deleteMany({ where: { shopId, shopifyId: n.shopifyId } });
          continue;
        }
        await upsertNormalized(shopId, n);
        seen.add(n.shopifyId);
        upserted++;
      }
      // Products in DB but not in Shopify response → deactivate (delete; we re-upsert if they reappear).
      const stale = await prisma.product.findMany({
        where: { shopId, NOT: { shopifyId: { in: Array.from(seen) } } },
        select: { id: true },
      });
      if (stale.length) {
        await prisma.product.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
      }
      return { upserted, deactivated: stale.length };
    },

    async syncOne(shopId, input) {
      const n = normalizeProduct(input);
      if (!n.isActive) {
        await prisma.product.deleteMany({ where: { shopId, shopifyId: n.shopifyId } });
        return { deleted: true };
      }
      const productId = await upsertNormalized(shopId, n);
      return { productId };
    },

    async deleteByShopifyId(shopId, shopifyProductId) {
      const s = String(shopifyProductId);
      const gid = s.startsWith("gid://") ? s : `gid://shopify/Product/${s}`;
      await prisma.product.deleteMany({ where: { shopId, shopifyId: gid } });
    },

    async markShopUninstalled(shopId) {
      await prisma.shop.update({
        where: { id: shopId },
        data: { uninstalledAt: new Date() },
      });
      await prisma.notification.create({
        data: {
          shopId,
          kind: "APP_UNINSTALLED",
          payload: { at: new Date().toISOString() },
        },
      }).catch(() => { /* best-effort during uninstall */ });
    },
  };
}

function sameImageSet(
  existing: Array<{ shopifyId: string | null; url: string; altText?: string | null; position: number }>,
  next: Array<{ shopifyId: string | null; url: string; altText: string | null; position: number }>,
): boolean {
  if (existing.length !== next.length) return false;
  return existing.every((img, idx) => {
    const n = next[idx];
    return img.shopifyId === n.shopifyId
      && img.url === n.url
      && (img.altText ?? null) === (n.altText ?? null)
      && img.position === n.position;
  });
}
