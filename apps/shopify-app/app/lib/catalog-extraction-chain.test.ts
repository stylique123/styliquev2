import { describe, expect, it } from "vitest";
import {
  extractSizeChartMultiSource,
  normalizeProduct,
  orderBrandDnaImages,
  recommendFit,
  scoreProductImages,
  type ShopifyProductInput,
} from "@stylique/core";
import { toShopperProduct } from "./serialize";

function normalizeSize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

describe("catalog extraction chain fixture", () => {
  it("turns one Shopify product into card-ready imagery, variant fit evidence, and Brand DNA inputs", async () => {
    const shopifyProduct: ShopifyProductInput = {
      id: 101,
      handle: "linen-resort-shirt",
      title: "Ivory Linen Resort Shirt",
      productType: "Shirt",
      vendor: "Fixture Brand",
      tags: ["linen", "ivory", "resort", "shirt"],
      descriptionHtml: `
        <p>Relaxed linen shirt with a soft resort drape.</p>
        <table>
          <tr><th>Size</th><th>Chest</th><th>Length</th></tr>
          <tr><td>S</td><td>88</td><td>66</td></tr>
          <tr><td>M</td><td>96</td><td>68</td></tr>
          <tr><td>L</td><td>104</td><td>70</td></tr>
        </table>
      `,
      variants: [
        { id: 11, sku: "LRS-S", price: "88.00", selectedOptions: [{ name: "Size", value: "S" }, { name: "Color", value: "Ivory" }] },
        { id: 12, sku: "LRS-M", price: "88.00", selectedOptions: [{ name: "Size", value: "M" }, { name: "Color", value: "Ivory" }] },
        { id: 13, sku: "LRS-L", price: "88.00", selectedOptions: [{ name: "Size", value: "L" }, { name: "Color", value: "Ivory" }] },
      ],
      images: [
        { id: 201, url: "https://cdn.example/linen-size-guide.jpg", altText: "linen shirt size guide measurements", position: 1 },
        { id: 202, url: "https://cdn.example/linen-front.jpg", altText: "front product photo on white background", position: 2 },
        { id: 203, url: "https://cdn.example/linen-fabric-swatch.jpg", altText: "fabric swatch detail", position: 3 },
      ],
    };

    const normalized = normalizeProduct(shopifyProduct);
    expect(normalized.descriptionHtml).toContain("Relaxed linen shirt");
    expect(normalized.images[0]).toMatchObject({
      altText: "linen shirt size guide measurements",
      position: 1,
    });
    expect(normalized.category).toBe("shirt");
    expect(normalized.sizeChartJson).toBeNull();

    const imageRows = normalized.images.map((image, index) => ({
      id: `img-${index + 1}`,
      url: image.url,
      position: image.position,
      altText: image.altText,
      preppedUrl: index === 1 ? "https://cdn.example/linen-front-prepped.png" : null,
    }));

    const score = await scoreProductImages({
      productId: "prod-101",
      images: imageRows,
      stage1: {
        key: "fixture-stage1",
        async score() {
          return [
            { id: "img-1", score: 3.2, reasons: ["suspected_detail_crop"], garmentRole: "DETAIL" },
            { id: "img-2", score: 8.4, reasons: ["filename_front_hint"], garmentRole: "FRONT" },
            { id: "img-3", score: 2.8, reasons: ["filename_swatch_hint"], garmentRole: "SWATCH" },
          ];
        },
      },
      stage2: { key: "aws_rekognition_disabled", async score() { return []; } },
    });

    expect(score.primaryTryonImageId).toBe("img-2");
    expect(score.tryonReady).toBe(true);

    const scoredImages = imageRows.map((image) => {
      const update = score.perImage.find((candidate) => candidate.imageId === image.id);
      return {
        ...image,
        qualityScore: update?.qualityScore ?? null,
        garmentRole: update?.garmentRole ?? null,
      };
    });

    const sizeChart = await extractSizeChartMultiSource({
      bodyHtml: normalized.descriptionHtml,
      images: scoredImages.map((image) => ({
        url: image.url,
        alt: image.altText ?? undefined,
        garmentRole: image.garmentRole,
      })),
    });
    expect(sizeChart.winner?.source).toBe("description_html");

    const rowBySize = new Map(
      (sizeChart.winner?.sizes ?? []).map((row) => [
        normalizeSize(typeof row.name === "string" ? row.name : undefined),
        row,
      ]),
    );
    const skuMeasurements = Object.fromEntries(
      normalized.variants.map((variant) => {
        const row = rowBySize.get(normalizeSize(variant.size));
        return [
          variant.size!,
          {
            chest: Number(row?.chest),
            length: Number(row?.length),
            unit: sizeChart.winner?.unit ?? "cm",
            source: sizeChart.winner?.source ?? "size_chart",
          },
        ];
      }),
    );

    expect(skuMeasurements.M).toMatchObject({ chest: 96, source: "description_html" });

    const fit = recommendFit({
      heightCm: 170,
      weightKg: 65,
      chest: 85,
      fitPreference: "REGULAR",
      category: normalized.category,
      availableSizes: normalized.variants.map((variant) => variant.size!).filter(Boolean),
      skuMeasurements,
    });
    expect(fit.recommendedSize).toBe("M");
    expect(fit.rationale).toContain("garment measurements");

    const brandDnaImages = orderBrandDnaImages(
      scoredImages.map((image) => ({
        id: image.id,
        url: image.preppedUrl ?? image.url,
        altText: image.altText,
        position: image.position,
        qualityScore: image.qualityScore,
        garmentRole: image.garmentRole,
      })),
      score.primaryTryonImageId,
    );
    expect(brandDnaImages[0]).toMatchObject({
      id: "img-2",
      url: "https://cdn.example/linen-front-prepped.png",
      garmentRole: "FRONT",
    });

    const shopperProduct = toShopperProduct({
      id: "prod-101",
      handle: normalized.handle,
      title: normalized.title,
      category: normalized.category,
      primaryColor: normalized.primaryColor,
      colorFamily: normalized.colorFamily,
      primaryTryonImageId: score.primaryTryonImageId,
      tryonReady: score.tryonReady,
      widgetTier: score.widgetTier,
      images: scoredImages,
      variants: normalized.variants,
    });

    expect(shopperProduct.imageUrl).toBe("https://cdn.example/linen-front.jpg");
    expect(shopperProduct.tryonImageUrl).toBe("https://cdn.example/linen-front-prepped.png");
    expect(shopperProduct.sizes).toEqual(["S", "M", "L"]);
  });
});
