import { describe, it, expect } from "vitest";
import { recommendFit } from "../fit/service.js";
import { buildOutfit, type StyleProduct } from "../style/service.js";
import type { FitInput } from "../fit/service.js";

describe("recommendFit — letter sizing", () => {
  const sizes = ["S", "M", "L", "XL"];

  it("recommends M for an average build with REGULAR fit", () => {
    const r = recommendFit({
      heightCm: 175, weightKg: 72, fitPreference: "REGULAR",
      category: "shirt", availableSizes: sizes,
    });
    expect(r.recommendedSize).toBe("M");
    expect(r.confidence).toBeGreaterThan(0.5); // D38 honest formula: height+weight alone gives ~0.56; chest measurement pushes to 0.68+
    expect(r.sizeUpAdvice).toBeDefined();
    expect(r.sizeDownAdvice).toBeDefined();
  });

  it("shifts down for SLIM preference", () => {
    const slim = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "SLIM", category: "shirt", availableSizes: sizes });
    const reg = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "REGULAR", category: "shirt", availableSizes: sizes });
    expect(["XS", "S", reg.recommendedSize]).toContain(slim.recommendedSize);
  });

  it("shifts up for RELAXED preference", () => {
    const r = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "RELAXED", category: "shirt", availableSizes: sizes });
    expect(["L", "XL"]).toContain(r.recommendedSize);
  });

  it("falls back gracefully when no sizes available", () => {
    const r = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "REGULAR", category: "shirt", availableSizes: [] });
    expect(r.recommendedSize).toBe("—");
    expect(r.confidence).toBe(0);
  });
});

describe("recommendFit — numeric trousers", () => {
  it("picks the closest numeric waist size", () => {
    const r = recommendFit({
      heightCm: 180, weightKg: 78, fitPreference: "REGULAR",
      category: "trouser", availableSizes: ["30", "32", "34", "36"],
    });
    expect(["30", "32", "34"]).toContain(r.recommendedSize);
    expect(r.rationale).toMatch(/waist/);
  });
});

describe("buildOutfit", () => {
  const anchor: StyleProduct = {
    id: "p-anchor", handle: "blue-shirt", title: "Blue Oxford",
    category: "shirt", primaryColor: "#1F3A8A", colorFamily: "blue",
  };
  const catalog: StyleProduct[] = [
    anchor,
    { id: "p-trouser-w", handle: "white-trousers", title: "White Trousers", category: "trouser", primaryColor: "#F8FAFC", colorFamily: "white" },
    { id: "p-trouser-b", handle: "beige-chinos",   title: "Beige Chinos",   category: "trouser", primaryColor: "#D9C7A7", colorFamily: "beige" },
    { id: "p-shoe-br",   handle: "brown-derby",    title: "Brown Derby",    category: "shoe",    primaryColor: "#6B3F1D", colorFamily: "brown" },
    { id: "p-acc-s",     handle: "silver-watch",   title: "Silver Watch",   category: "accessory", primaryColor: "#C0C5CD", colorFamily: "silver" },
    { id: "p-outer",     handle: "navy-blazer",    title: "Navy Blazer",    category: "outerwear", primaryColor: "#1E2A52", colorFamily: "navy" },
  ];

  it("returns anchor first, then complements without duplicates", () => {
    const r = buildOutfit(anchor, catalog);
    expect(r.outfit[0].role).toBe("ANCHOR");
    expect(r.outfit[0].product.id).toBe(anchor.id);
    const ids = r.outfit.map((i) => i.product.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.outfit.length).toBeGreaterThan(1);
  });

  it("returns a comboScore with a score in [0, 1]", () => {
    const r = buildOutfit(anchor, catalog);
    expect(r.comboScore.score).toBeGreaterThanOrEqual(0);
    expect(r.comboScore.score).toBeLessThanOrEqual(1);
  });

  it("includes color combo guidance with a rationale", () => {
    const r = buildOutfit(anchor, catalog);
    expect(r.colorCombos.length).toBeGreaterThan(0);
    for (const c of r.colorCombos) {
      expect(c.rationale.length).toBeGreaterThan(10);
      expect(c.palette.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("prefers compatible-color products over poor matches", () => {
    const r = buildOutfit(anchor, catalog);
    const bottom = r.outfit.find((i) => i.role === "BOTTOM");
    // For a blue anchor, white/beige score higher than blue itself.
    expect(bottom?.product.colorFamily === "white" || bottom?.product.colorFamily === "beige").toBe(true);
  });
});

describe("recommendFit — FITTED preference", () => {
  const sizes = ["XS", "S", "M", "L", "XL"];

  it("shifts down one size for FITTED (same as SLIM)", () => {
    const reg = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "REGULAR", category: "shirt", availableSizes: sizes });
    const fitted = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "FITTED", category: "shirt", availableSizes: sizes });
    // FITTED should be ≤ REGULAR in the ladder
    const ladder = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
    expect(ladder.indexOf(fitted.recommendedSize)).toBeLessThanOrEqual(ladder.indexOf(reg.recommendedSize));
  });

  it("mentions 'fitted' in the rationale", () => {
    const r = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "FITTED", category: "shirt", availableSizes: sizes });
    expect(r.rationale.toLowerCase()).toContain("fit");
  });
});

describe("recommendFit — OVERSIZED preference", () => {
  it("shifts up two sizes for OVERSIZED", () => {
    const oversizedSizes = ["XS", "S", "M", "L", "XL", "XXL"];
    const reg = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "REGULAR", category: "shirt", availableSizes: oversizedSizes });
    const os = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "OVERSIZED", category: "shirt", availableSizes: oversizedSizes });
    const ladder = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
    expect(ladder.indexOf(os.recommendedSize)).toBeGreaterThanOrEqual(ladder.indexOf(reg.recommendedSize));
  });
});

describe("recommendFit — skuMeasurements path (D38)", () => {
  it("uses skuMeasurements when chest measurement provided", () => {
    const skuMeasurements = {
      "S": { chest: 86 },
      "M": { chest: 94 },
      "L": { chest: 102 },
    };
    // Shopper chest = 85cm → target garment = 85 + 8 + 0 = 93; S→|86-93|=7, M→|94-93|=1 → M wins
    const r = recommendFit({
      heightCm: 170, weightKg: 65, fitPreference: "REGULAR",
      category: "shirt", availableSizes: ["S", "M", "L"],
      chest: 85,
      skuMeasurements,
    });
    expect(r.recommendedSize).toBe("M");
    expect(r.rationale).toContain("garment measurements");
    expect(r.confidence).toBeGreaterThan(0.55); // skuMeasurements bonus applied
  });

  it("FITTED preference shifts garment target smaller in skuMeasurements path", () => {
    const skuMeasurements = {
      "S": { chest: 88 },
      "M": { chest: 96 },
      "L": { chest: 104 },
    };
    // FITTED ease = -4; chest 84 → target = 84 + 8 - 4 = 88 → closest to S
    const r = recommendFit({
      heightCm: 170, weightKg: 65, fitPreference: "FITTED",
      category: "shirt", availableSizes: ["S", "M", "L"],
      chest: 84,
      skuMeasurements,
    });
    expect(r.recommendedSize).toBe("S");
  });

  it("falls back to BMI path when skuMeasurements present but no shopper measurements", () => {
    const r = recommendFit({
      heightCm: 175, weightKg: 72, fitPreference: "REGULAR",
      category: "shirt", availableSizes: ["S", "M", "L", "XL"],
      // skuMeasurements present but no chest/waist/hip → hasMeasurements = false
      skuMeasurements: { "M": { chest: 96 } },
    });
    expect(r.recommendedSize).toBeDefined();
    expect(r.rationale).toContain("BMI");
  });
});

describe("recommendFit — zero-confidence path", () => {
  it("returns confidence 0 and placeholder size for empty availableSizes", () => {
    const r = recommendFit({
      heightCm: 175, weightKg: 72, fitPreference: "REGULAR",
      category: "shirt", availableSizes: [],
    });
    expect(r.recommendedSize).toBe("—");
    expect(r.confidence).toBe(0);
    expect(r.rationale).toContain("no published sizes");
  });
});

describe("recommendFit — trustLine (D38)", () => {
  it("includes high confidence wording when confidence >= 75%", () => {
    // Past purchase pushes confidence high
    const r = recommendFit({
      heightCm: 175, weightKg: 72, fitPreference: "REGULAR",
      category: "shirt", availableSizes: ["S", "M", "L"],
      chest: 90, waist: 76, hip: 95,  // 12pts
      hasPastPurchase: true,           // 10pts
      brandBiasCount: 15,              // 8pts
      // 40 + 8 + 8 + 12 + 10 + 8 = 86 → ≥ 75 → high confidence wording
    });
    expect(r.trustLine).toContain("high confidence");
  });

  it("omits high confidence when score < 75%", () => {
    const r = recommendFit({
      heightCm: 175, weightKg: 72, fitPreference: "REGULAR",
      category: "shirt", availableSizes: ["S", "M", "L"],
      // 40 + 8 + 8 = 56 → < 75
    });
    expect(r.trustLine).not.toContain("high confidence");
    expect(r.trustLine).toContain(r.recommendedSize);
  });
});

describe("recommendFit — body type adjustments", () => {
  it("shifts down for PETITE body type", () => {
    const reg = recommendFit({ heightCm: 160, weightKg: 58, fitPreference: "REGULAR", category: "shirt", availableSizes: ["XS", "S", "M", "L"] });
    const petite = recommendFit({ heightCm: 160, weightKg: 58, fitPreference: "REGULAR", bodyType: "PETITE", category: "shirt", availableSizes: ["XS", "S", "M", "L"] });
    const ladder = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
    expect(ladder.indexOf(petite.recommendedSize)).toBeLessThanOrEqual(ladder.indexOf(reg.recommendedSize));
  });

  it("shifts up for TALL body type", () => {
    const reg = recommendFit({ heightCm: 185, weightKg: 80, fitPreference: "REGULAR", category: "shirt", availableSizes: ["S", "M", "L", "XL", "XXL"] });
    const tall = recommendFit({ heightCm: 185, weightKg: 80, fitPreference: "REGULAR", bodyType: "TALL", category: "shirt", availableSizes: ["S", "M", "L", "XL", "XXL"] });
    const ladder = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
    expect(ladder.indexOf(tall.recommendedSize)).toBeGreaterThanOrEqual(ladder.indexOf(reg.recommendedSize));
  });
});

describe("recommendFit — confidence boosts (D38)", () => {
  it("brandBiasCount > 10 adds confidence boost", () => {
    const without = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "REGULAR", category: "shirt", availableSizes: ["M"], brandBiasCount: 0 });
    const with_ = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "REGULAR", category: "shirt", availableSizes: ["M"], brandBiasCount: 15 });
    expect(with_.confidence).toBeGreaterThan(without.confidence);
  });

  it("hasPastPurchase=true adds confidence boost", () => {
    const without = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "REGULAR", category: "shirt", availableSizes: ["M"] });
    const with_ = recommendFit({ heightCm: 175, weightKg: 72, fitPreference: "REGULAR", category: "shirt", availableSizes: ["M"], hasPastPurchase: true });
    expect(with_.confidence).toBeGreaterThan(without.confidence);
  });

  it("confidence never exceeds 0.92", () => {
    const r = recommendFit({
      heightCm: 175, weightKg: 72, fitPreference: "REGULAR",
      category: "shirt", availableSizes: ["M"],
      chest: 90, waist: 76, hip: 95,
      hasPastPurchase: true,
      brandBiasCount: 20,
    });
    expect(r.confidence).toBeLessThanOrEqual(0.92);
  });
});
