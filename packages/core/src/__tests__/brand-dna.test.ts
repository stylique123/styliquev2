import { afterEach, describe, expect, it, vi } from "vitest";
import { extractDNAFromCatalogProducts, orderBrandDnaImages } from "../studio/brand-dna.js";

describe("extractDNAFromCatalogProducts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves catalog-derived fabrics, seasonality, and price positioning", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                moodAdjectives: ["minimal", "polished"],
                lightingStyle: "natural_soft",
                compositionStyle: "centered_model",
                colorPalette: ["#F5F0E8", "#111111"],
                modelArchetype: "editorial",
                dominantFabrics: ["Silk", "Linen", "Silk"],
                seasonality: "spring_summer",
                pricePositioning: "premium",
              }),
            }],
          },
        }],
      }),
    })));

    const dna = await extractDNAFromCatalogProducts([
      {
        title: "Ivory Silk Shirt",
        category: "shirt",
        primaryColor: "#F5F0E8",
        imageUrls: ["https://cdn.example/silk-shirt.jpg"],
      },
    ], "test-key");

    expect(dna.toneJson.dominantFabrics).toEqual(["silk", "linen"]);
    expect(dna.toneJson.seasonality).toBe("spring_summer");
    expect(dna.toneJson.pricePositioning).toBe("premium");
  });

  it("includes product type, tags, description, and image alt text in the vision prompt", async () => {
    let prompt = "";
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as { body?: string }).body ?? "{}")) as {
        contents?: Array<{ parts?: Array<{ text?: string }> }>;
      };
      prompt = body.contents?.[0]?.parts?.[0]?.text ?? "";
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  moodAdjectives: ["romantic"],
                  lightingStyle: "natural_soft",
                  compositionStyle: "centered_model",
                  colorPalette: ["#F5F0E8"],
                  modelArchetype: "editorial",
                }),
              }],
            },
          }],
        }),
      };
    }));

    await extractDNAFromCatalogProducts([
      {
        title: "Ivory Silk Shirt",
        category: "top",
        productType: "Blouse",
        primaryColor: "#F5F0E8",
        tags: ["bridal", "silk", "occasionwear"],
        descriptionText: "<p>Lightweight silk blouse for resort weddings.</p>",
        imageUrls: [{ url: "https://cdn.example/front.jpg", altText: "front view ivory silk blouse" }],
      },
    ], "test-key");

    expect(prompt).toContain("productType=Blouse");
    expect(prompt).toContain("tags=bridal, silk, occasionwear");
    expect(prompt).toContain("imageAlt=front view ivory silk blouse");
    expect(prompt).toContain("description=Lightweight silk blouse for resort weddings.");
  });
});

describe("orderBrandDnaImages", () => {
  it("does not let a first-position size guide or detail image lead Brand DNA extraction", () => {
    const ordered = orderBrandDnaImages([
      {
        id: "img-size-guide",
        position: 1,
        qualityScore: 8,
        garmentRole: "DETAIL",
        altText: "size guide measurements",
      },
      {
        id: "img-front",
        position: 2,
        qualityScore: 7,
        garmentRole: "FRONT",
        altText: "front view ivory silk blouse",
      },
      {
        id: "img-swatch",
        position: 3,
        qualityScore: 9,
        garmentRole: "SWATCH",
        altText: "fabric swatch",
      },
    ], null);

    expect(ordered.map((img) => img.id)).toEqual(["img-front", "img-size-guide", "img-swatch"]);
  });

  it("keeps the scored primary try-on image first when present", () => {
    const ordered = orderBrandDnaImages([
      { id: "img-front", position: 1, qualityScore: 9, garmentRole: "FRONT" },
      { id: "img-primary", position: 3, qualityScore: 7, garmentRole: "BACK" },
    ], "img-primary");

    expect(ordered[0]?.id).toBe("img-primary");
  });
});
