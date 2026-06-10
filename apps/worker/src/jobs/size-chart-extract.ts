// D39 — Size-chart extraction worker job.
// Tries up to 6 sources (variant metafield, JSON metafield, HTML metafield,
// description HTML, linked page, image OCR) and writes the best result back
// to Product.sizeChartJson + sizeChartCandidatesJson + sizeChartExtractedAt.
//
// CRITICAL (the linkage that makes sizing actually work): after extracting the
// chart, we MAP each size row's real garment measurements (chest/waist/hip/…)
// onto the matching ProductVariant.measurementsJson — because the fit
// recommender (`recommendFit`) scores sizes off PER-VARIANT measurements, not
// off Product.sizeChartJson. Without this bridge a perfectly-extracted chart
// never reaches the size recommendation.
//
// Sources passed: the product DESCRIPTION HTML (where most no-metafield brands
// paste their size table — text/HTML), the size-chart metafields (JSON/HTML),
// and any size-chart IMAGE (Gemini Vision OCR).
//
// Triggered by:
//   • catalog-sync after every product upsert (idempotent via jobId)
//   • POST /api/admin/size-charts/backfill (manual backfill for all products)

import { prisma } from "@stylique/db";
import { extractSizeChartMultiSource } from "@stylique/core";

export type SizeChartExtractJobData = { shopId: string; productId: string };

// Normalize a size label so chart rows and variant sizes match across the common
// spellings (S ↔ Small ↔ s, XL ↔ X-Large, numeric stays numeric).
function normSize(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.trim().toLowerCase().replace(/[\s_]+/g, "").replace(/-/g, "");
  const map: Record<string, string> = {
    xsmall: "xs", extrasmall: "xs", small: "s", medium: "m", large: "l",
    xlarge: "xl", extralarge: "xl", xxl: "xxl", xxlarge: "xxl", xxxl: "xxxl",
  };
  return map[t] ?? t;
}

const MEASURE_KEYS = ["chest", "bust", "waist", "hip", "length", "sleeve", "inseam", "shoulder"] as const;

export async function processSizeChartExtract(data: SizeChartExtractJobData): Promise<void> {
  const product = await prisma.product.findFirst({
    where: { id: data.productId, shopId: data.shopId },
    select: {
      id: true,
      shopId: true,
      descriptionHtml: true, // text/HTML size charts pasted into the description
      sizeChartJson: true,    // metafield-derived chart already set at sync time
      variants: { select: { id: true, size: true, measurementsJson: true } },
      images: {
        select: { url: true, garmentRole: true },
        take: 5,
      },
    },
  });
  if (!product) return;

  const shop = await prisma.shop.findUnique({
    where: { id: data.shopId },
    select: { shopifyDomain: true },
  });

  // The structured metafield charts (JSON/HTML) are already extracted at sync
  // time by normalizeProduct → pickProductSizeChart → Product.sizeChartJson. This
  // job adds the UNstructured sources most no-metafield brands actually use:
  //   • TEXT — a size table / measurements pasted into the product description
  //   • LINKED PAGE — a /pages/size-guide link in that description
  //   • IMAGE — a size-chart image (Gemini Vision OCR)
  const result = await extractSizeChartMultiSource({
    shopDomain: shop?.shopifyDomain,
    bodyHtml: product.descriptionHtml ?? undefined,
    images: product.images.map((i) => ({ url: i.url, garmentRole: i.garmentRole })),
    geminiApiKey: process.env.GEMINI_API_KEY,
  });

  await prisma.product.update({
    where: { id: data.productId },
    data: {
      sizeChartJson: result.winner
        ? (JSON.parse(JSON.stringify(result.winner)) as object)
        : undefined,
      sizeChartCandidatesJson: result.candidates as never,
      sizeChartExtractedAt: result.extractedAt,
      ...(result.winner ? { sizeChartSource: result.winner.source } : {}),
    },
  });

  // ── THE LINKAGE: map chart rows → per-variant measurementsJson ──────────────
  // recommendFit reads ProductVariant.measurementsJson; copy each size row's real
  // garment measurements onto the variant that wears that size so the shopper's
  // chest/waist/hip can be scored against the actual garment, not a category
  // default. Use the freshly-extracted chart if any, else the metafield chart
  // already on the product (so metafield-only products get the bridge too).
  const bridgeChart = (result.winner ??
    (product.sizeChartJson as { sizes?: Array<Record<string, unknown>>; unit?: string; source?: string } | null)) ?? null;
  if (bridgeChart?.sizes?.length) {
    const rowBySize = new Map<string, Record<string, unknown>>();
    for (const row of bridgeChart.sizes) {
      const name = normSize(typeof row.name === "string" ? row.name : undefined);
      if (name) rowBySize.set(name, row);
    }
    for (const v of product.variants) {
      if (v.measurementsJson) continue; // don't clobber explicit per-SKU data
      const row = rowBySize.get(normSize(v.size));
      if (!row) continue;
      const measurements: Record<string, number> = {};
      for (const k of MEASURE_KEYS) {
        const raw = row[k];
        const num = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
        if (Number.isFinite(num)) measurements[k === "bust" ? "chest" : k] = num;
      }
      if (Object.keys(measurements).length) {
        await prisma.productVariant
          .update({
            where: { id: v.id },
            data: {
              measurementsJson: { ...measurements, unit: bridgeChart.unit ?? "cm", source: bridgeChart.source ?? "size_chart" },
              measurementsSource: bridgeChart.source ?? "size_chart",
            },
          })
          .catch(() => undefined);
      }
    }
  }

  // Log catalog gap ONLY if no size chart exists anywhere — including a chart a
  // PRIOR sync already wrote. Gemini Vision OCR is intermittently empty (~1-in-3),
  // so a retry-exhausted re-sync must NOT log a false gap for a product that
  // already has a good chart (panel P1 — false-gap audit pollution).
  if (!result.winner && !product.sizeChartJson) {
    await prisma.catalogGap
      .create({
        data: {
          shopId: data.shopId,
          rawQuery: `no_size_chart:${data.productId}`,
          normalizedQuery: `no_size_chart:${data.productId}`,
          resultCount: 0,
          source: "size_chart_extract",
        },
      })
      .catch(() => undefined);
  }
}
