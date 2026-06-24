// Tests for the image quality pipeline (D37).
// The widget-tier computation and stage-1 filename heuristics are the
// highest-risk paths — a regression here silently routes all products to
// "size only" mode (tier 3) or gives VTO a bad anchor image.

import { describe, it, expect } from "vitest";
import { resolveTryonImage, scoreProductImages } from "../imagery/service.js";
import { computeWidgetTier, USABLE_THRESHOLD } from "../imagery/types.js";

// ─── computeWidgetTier ────────────────────────────────────────────────────────

describe("computeWidgetTier", () => {
  it("5+ usable images → Tier 1 (full try-on)", () => {
    expect(computeWidgetTier(5)).toBe(1);
    expect(computeWidgetTier(10)).toBe(1);
    expect(computeWidgetTier(100)).toBe(1);
  });

  it("2-4 usable images → Tier 2 (carousel, limited quality note)", () => {
    expect(computeWidgetTier(2)).toBe(2);
    expect(computeWidgetTier(3)).toBe(2);
    expect(computeWidgetTier(4)).toBe(2);
  });

  it("0-1 usable images → Tier 3 (size + styling only)", () => {
    expect(computeWidgetTier(0)).toBe(3);
    expect(computeWidgetTier(1)).toBe(3);
  });

  it("boundary at exactly 5 is Tier 1, exactly 2 is Tier 2", () => {
    // Off-by-one is the most common regression vector here.
    expect(computeWidgetTier(5)).toBe(1);
    expect(computeWidgetTier(4)).toBe(2);
    expect(computeWidgetTier(2)).toBe(2);
    expect(computeWidgetTier(1)).toBe(3);
  });

  it("USABLE_THRESHOLD is 5.5 (Phase 1 §2.5 invariant)", () => {
    // Hard-coded in the spec. If this changes, VTO anchor selection changes.
    expect(USABLE_THRESHOLD).toBe(5.5);
  });
});

describe("resolveTryonImage", () => {
  it("uses the scored primary try-on image when present", () => {
    const image = resolveTryonImage([
      { id: "img-front", url: "front.jpg", position: 1, garmentRole: "FRONT", qualityScore: 9 },
      { id: "img-primary", url: "back.jpg", preppedUrl: "studio-back.png", position: 2, garmentRole: "BACK", qualityScore: 7 },
    ], "img-primary");

    expect(image?.id).toBe("img-primary");
    expect(image?.preppedUrl).toBe("studio-back.png");
  });

  it("does not fall back to a first-position size guide when a front product image exists", () => {
    const image = resolveTryonImage([
      { id: "img-size", url: "size-guide.jpg", position: 1, garmentRole: "DETAIL", qualityScore: 8, altText: "size guide measurements" },
      { id: "img-front", url: "front.jpg", position: 2, garmentRole: "FRONT", qualityScore: 6, altText: "front product photo" },
      { id: "img-swatch", url: "swatch.jpg", position: 3, garmentRole: "SWATCH", qualityScore: 9, altText: "fabric swatch" },
    ], null);

    expect(image?.id).toBe("img-front");
  });
});

// ─── Filename heuristics (logic re-tested inline, not importing stage1
//     because it uses fetch which needs a real HTTP server) ─────────────────

describe("filename heuristics — expected garmentRole assignments", () => {
  // These patterns are baked into stage1.ts RX map. Tested here without
  // running fetch so the suite stays fast in CI.
  const RX = {
    back:      /(_back|-back|back\.|_rear)/i,
    detail:    /(_detail|-detail|_close|_zoom|_macro|_swatch|_fabric)/i,
    lifestyle: /(_lifestyle|-lifestyle|_model|model[ -]?(wearing|shot)|on[ -]?model|worn[ -]?(by|with)?|styled[ -]?(with|look)?|paired[ -]?with|outfit|full[ -]?look|_editorial|_campaign|_lookbook)/i,
    swatch:    /(_swatch|-swatch|_color|_chip)/i,
  };

  it("_back and -back suffix both match the back pattern", () => {
    expect(RX.back.test("shirt_back.jpg")).toBe(true);
    expect(RX.back.test("product-back.jpg")).toBe(true); // -back is also in the regex
  });

  it("_rear suffix → back pattern", () => {
    expect(RX.back.test("coat_rear.png")).toBe(true);
  });

  it("_swatch → both detail AND swatch pattern", () => {
    expect(RX.detail.test("fabric_swatch.jpg")).toBe(true);
    expect(RX.swatch.test("fabric_swatch.jpg")).toBe(true);
  });

  it("_lifestyle → lifestyle pattern", () => {
    expect(RX.lifestyle.test("dress_lifestyle.jpg")).toBe(true);
    expect(RX.lifestyle.test("editorial_campaign.jpg")).toBe(true);
  });

  it("outfit/model/styled-with wording is lifestyle, not a clean garment reference", () => {
    expect(RX.lifestyle.test("model wearing ivory shirt with trousers")).toBe(true);
    expect(RX.lifestyle.test("front view styled with pants")).toBe(true);
    expect(RX.lifestyle.test("full look paired with blazer")).toBe(true);
  });

  it("plain front-shot filename matches no pattern (treated as FRONT)", () => {
    const name = "white-shirt-01.jpg";
    expect(RX.back.test(name)).toBe(false);
    expect(RX.detail.test(name)).toBe(false);
    expect(RX.lifestyle.test(name)).toBe(false);
    expect(RX.swatch.test(name)).toBe(false);
  });
});

describe("scoreProductImages primary selection", () => {
  it("picks a usable FRONT image over the first Shopify image when position 1 is lifestyle/detail", async () => {
    const result = await scoreProductImages({
      productId: "prod-shirt",
      images: [
        { id: "img-lifestyle", url: "https://cdn.example/shirt_lifestyle.jpg", position: 1, shopifyFilename: "shirt_lifestyle.jpg" },
        { id: "img-front", url: "https://cdn.example/shirt_front.jpg", position: 2, shopifyFilename: "shirt_front.jpg" },
        { id: "img-detail", url: "https://cdn.example/shirt_detail.jpg", position: 3, shopifyFilename: "shirt_detail.jpg" },
      ],
      stage1: {
        key: "test-stage1",
        async score() {
          return [
            { id: "img-lifestyle", score: 7.4, reasons: ["filename_lifestyle_hint"], garmentRole: "LIFESTYLE" },
            { id: "img-front", score: 6.1, reasons: ["filename_front_hint"], garmentRole: "FRONT" },
            { id: "img-detail", score: 6.8, reasons: ["suspected_detail_crop"], garmentRole: "DETAIL" },
          ];
        },
      },
      stage2: { key: "aws_rekognition_disabled", async score() { return []; } },
    });

    expect(result.primaryTryonImageId).toBe("img-front");
    expect(result.tryonReady).toBe(true);
  });

  it("uses Shopify alt text to reject size-guide/detail images before picking the front product image", async () => {
    const result = await scoreProductImages({
      productId: "prod-alt-shirt",
      images: [
        { id: "img-size-guide", url: "https://cdn.example/asset-one.jpg", position: 1, altText: "Oxford shirt size guide and measurements" },
        { id: "img-front", url: "https://cdn.example/asset-two.jpg", position: 2, altText: "Oxford shirt front product photo" },
      ],
      stage2: { key: "aws_rekognition_disabled", async score() { return []; } },
    });

    expect(result.primaryTryonImageId).toBe("img-front");
    expect(result.perImage.find((img) => img.imageId === "img-size-guide")?.garmentRole).toBe("DETAIL");
    expect(result.perImage.find((img) => img.imageId === "img-front")?.garmentRole).toBe("FRONT");
  });

  it("does not use a styled full-outfit image as the try-on garment anchor when a clean front shot exists", async () => {
    const result = await scoreProductImages({
      productId: "prod-shirt-outfit",
      images: [
        {
          id: "img-outfit",
          url: "https://cdn.example/shirt-front-styled.jpg",
          position: 1,
          altText: "front view styled with black pants as a full outfit",
        },
        {
          id: "img-clean-front",
          url: "https://cdn.example/shirt-packshot.jpg",
          position: 2,
          altText: "shirt front product-only packshot on white background",
        },
      ],
      stage2: { key: "aws_rekognition_disabled", async score() { return []; } },
    });

    expect(result.primaryTryonImageId).toBe("img-clean-front");
    expect(result.perImage.find((img) => img.imageId === "img-outfit")?.garmentRole).toBe("LIFESTYLE");
    expect(result.perImage.find((img) => img.imageId === "img-clean-front")?.garmentRole).toBe("FRONT");
  });
});
