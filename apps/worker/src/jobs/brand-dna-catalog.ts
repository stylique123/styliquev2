// Brand DNA catalog extraction job.
//
// Triggered automatically after first catalog sync (see catalog-sync.ts).
// Can also be triggered manually via POST /api/admin/brand-profile → intent=refresh_catalog.
//
// Pulls the top 30 products with images, sends them to Gemini Vision in batches
// of 10, merges the signals, and writes the result into BrandProfile.

import { prisma } from "@stylique/db";
import { extractDNAFromCatalogProducts, orderBrandDnaImages } from "@stylique/core";

export type BrandDnaCatalogJobData = {
  shopId: string;
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const MAX_PRODUCTS = 30;

export async function processBrandDnaCatalog(data: BrandDnaCatalogJobData): Promise<void> {
  const { shopId } = data;

  if (!GEMINI_API_KEY) {
    console.warn(`[brand-dna-catalog] GEMINI_API_KEY not set — skipping DNA extraction for shop=${shopId}`);
    return;
  }

  // Fetch top products with images for analysis
  const products = await prisma.product.findMany({
    where: { shopId, tryonReady: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_PRODUCTS,
    select: {
      title: true,
      category: true,
      productType: true,
      tags: true,
      descriptionHtml: true,
      primaryColor: true,
      primaryTryonImageId: true,
      images: {
        orderBy: { position: "asc" },
        take: 3,
        select: { id: true, url: true, preppedUrl: true, altText: true, position: true, qualityScore: true, garmentRole: true },
      },
    },
  });

  if (products.length === 0) {
    // Fall back to all products if none are tryonReady yet
    const fallback = await prisma.product.findMany({
      where: { shopId },
      orderBy: { updatedAt: "desc" },
      take: MAX_PRODUCTS,
      select: {
        title: true,
        category: true,
        productType: true,
        tags: true,
        descriptionHtml: true,
        primaryColor: true,
        primaryTryonImageId: true,
        images: {
          orderBy: { position: "asc" },
          take: 2,
          select: { id: true, url: true, preppedUrl: true, altText: true, position: true, qualityScore: true, garmentRole: true },
        },
      },
    });

    if (fallback.length === 0) {
      console.warn(`[brand-dna-catalog] No products found for shop=${shopId}`);
      return;
    }
    products.push(...fallback);
  }

  const input = products.map((p: {
    title: string;
    category: string | null;
    productType: string | null;
    tags: string[];
    descriptionHtml: string | null;
    primaryColor: string | null;
    primaryTryonImageId: string | null;
    images: {
      id: string;
      url: string;
      preppedUrl: string | null;
      altText: string | null;
      position: number;
      qualityScore: number | null;
      garmentRole: "FRONT" | "BACK" | "DETAIL" | "LIFESTYLE" | "SWATCH" | null;
    }[];
  }) => ({
    title: p.title,
    category: p.category,
    productType: p.productType,
    tags: p.tags,
    descriptionText: p.descriptionHtml,
    primaryColor: p.primaryColor,
    imageUrls: orderBrandDnaImages(p.images, p.primaryTryonImageId).map((i) => ({
      url: i.preppedUrl ?? i.url,
      altText: i.altText,
    })),
  }));

  console.log(`[brand-dna-catalog] Extracting DNA from ${input.length} products — shop=${shopId}`);

  let dna;
  try {
    dna = await extractDNAFromCatalogProducts(input, GEMINI_API_KEY);
  } catch (err) {
    console.error(`[brand-dna-catalog] DNA extraction failed — shop=${shopId}`, err);
    return;
  }

  // Upsert BrandProfile — create if it doesn't exist (should always exist
  // from install, but be defensive)
  const existing = await prisma.brandProfile.findUnique({
    where: { shopId },
    select: { id: true, toneJson: true, paletteJson: true },
  });

  if (!existing) {
    // Create new profile
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) return;
    await prisma.brandProfile.create({
      data: {
        shopId,
        paletteJson: dna.paletteJson as object,
        toneJson: dna.toneJson as object,
        trainedAt: new Date(),
      },
    });
  } else {
    // Merge: preserve any existing campaign overrides + Instagram-derived fields
    const existingTone = (existing.toneJson as Record<string, unknown> | null) ?? {};
    const campaignOverrides = existingTone.campaignOverrides;

    const mergedTone = {
      ...dna.toneJson,
      // Preserve any campaign overrides already stored
      ...(campaignOverrides ? { campaignOverrides } : {}),
    };

    // Only update palette if we extracted meaningful colors
    const palette = dna.paletteJson.hex.length > 0
      ? dna.paletteJson
      : ((existing.paletteJson as object | null) ?? dna.paletteJson);

    await prisma.brandProfile.update({
      where: { id: existing.id },
      data: {
        paletteJson: palette as object,
        toneJson: mergedTone as object,
        trainedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  // Record that we've synced the Shopify source
  try {
    const existingSource = await prisma.brandSource.findFirst({ where: { shopId, kind: "SHOPIFY" }, select: { id: true } });
    if (existingSource) {
      await prisma.brandSource.update({
        where: { id: existingSource.id },
        data: { status: "READY", lastSyncedAt: new Date(), error: null },
      });
    } else {
      await prisma.brandSource.create({
        data: { shopId, kind: "SHOPIFY", status: "READY", lastSyncedAt: new Date() },
      });
    }
  } catch {
    // Non-fatal — source status is informational
  }

  console.log(`[brand-dna-catalog] DNA saved — shop=${shopId} adjectives=${dna.toneJson.moodAdjectives.join(",")}`);
}
