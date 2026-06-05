import { describe, it, expect } from "vitest";
import { scoreCombo, pickWinningCombo, type ComboInput, type ComboProduct } from "../style/score.js";

// Helper to build a minimal ComboProduct
function p(
  id: string,
  category: string | null,
  primaryColor: string | null,
  opts: Partial<ComboProduct> = {},
): ComboProduct {
  return { id, handle: id, title: id, category, primaryColor, ...opts };
}

describe("scoreCombo — output shape", () => {
  it("returns a score in [0, 1]", () => {
    const r = scoreCombo({
      pieces: [
        p("top", "shirt", "#1F3A8A"),
        p("bottom", "trouser", "#F8FAFC"),
        p("shoe", "shoes", "#6B3F1D"),
      ],
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it("returns a breakdown with all five keys", () => {
    const r = scoreCombo({ pieces: [p("a", "shirt", "#FF0000")] });
    expect(r.breakdown).toHaveProperty("coverage");
    expect(r.breakdown).toHaveProperty("colorHarmony");
    expect(r.breakdown).toHaveProperty("silhouetteBalance");
    expect(r.breakdown).toHaveProperty("occasionFit");
    expect(r.breakdown).toHaveProperty("stockOK");
  });

  it("returns a harmony result with harmonyType", () => {
    const r = scoreCombo({ pieces: [p("a", "shirt", "#1F3A8A")] });
    expect(r.harmony).toBeDefined();
    expect(typeof r.harmony.harmonyType).toBe("string");
  });
});

describe("scoreCombo — coverage component", () => {
  it("full set (top + bottom + accessory) = coverage 1.0", () => {
    const r = scoreCombo({
      pieces: [
        p("shirt", "shirt", null),
        p("trousers", "trouser", null),
        p("bag", "accessory", null),
      ],
    });
    expect(r.breakdown.coverage).toBe(1);
  });

  it("two of three = coverage 0.7", () => {
    const r = scoreCombo({
      pieces: [
        p("shirt", "shirt", null),
        p("trousers", "trouser", null),
      ],
    });
    expect(r.breakdown.coverage).toBe(0.7);
  });

  it("one slot = coverage 0.3", () => {
    const r = scoreCombo({ pieces: [p("shirt", "shirt", null)] });
    expect(r.breakdown.coverage).toBe(0.3);
  });

  it("empty pieces = coverage 0.1", () => {
    const r = scoreCombo({ pieces: [] });
    expect(r.breakdown.coverage).toBe(0.1);
  });

  it("dress counts as bottom", () => {
    const r = scoreCombo({
      pieces: [
        p("dress", "dress", null),
        p("shoe", "shoes", null),
      ],
    });
    // dress = bottom, shoes = accessory → 2 of 3 → 0.7
    expect(r.breakdown.coverage).toBe(0.7);
  });
});

describe("scoreCombo — stockOK component", () => {
  it("all in-stock = stockOK 1.0", () => {
    const r = scoreCombo({
      pieces: [
        p("a", "shirt", null, { inStock: true }),
        p("b", "trouser", null, { inStock: true }),
      ],
    });
    expect(r.breakdown.stockOK).toBe(1);
  });

  it("all out-of-stock = stockOK 0", () => {
    const r = scoreCombo({
      pieces: [
        p("a", "shirt", null, { inStock: false }),
        p("b", "trouser", null, { inStock: false }),
      ],
    });
    expect(r.breakdown.stockOK).toBe(0);
  });

  it("half out-of-stock = stockOK 0.5", () => {
    const r = scoreCombo({
      pieces: [
        p("a", "shirt", null, { inStock: true }),
        p("b", "trouser", null, { inStock: false }),
      ],
    });
    expect(r.breakdown.stockOK).toBe(0.5);
  });

  it("unknown stock (null) treated as in-stock", () => {
    const r = scoreCombo({
      pieces: [
        p("a", "shirt", null, { inStock: null }),
        p("b", "trouser", null, { inStock: null }),
      ],
    });
    expect(r.breakdown.stockOK).toBe(1);
  });
});

describe("scoreCombo — presentable flag", () => {
  it("full in-stock outfit is presentable", () => {
    const r = scoreCombo({
      pieces: [
        p("shirt", "shirt", null, { inStock: true }),
        p("trouser", "trouser", null, { inStock: true }),
        p("shoe", "shoes", null, { inStock: true }),
      ],
    });
    expect(r.presentable).toBe(true);
  });

  it("majority OOS fails presentability", () => {
    const r = scoreCombo({
      pieces: [
        p("a", "shirt", null, { inStock: false }),
        p("b", "trouser", null, { inStock: false }),
        p("c", "shoes", null, { inStock: false }),
      ],
    });
    // stockOK = 0 < 0.66 → not presentable
    expect(r.presentable).toBe(false);
  });
});

describe("scoreCombo — silhouette balance", () => {
  it("mixed silhouettes score higher than uniform", () => {
    const mixed = scoreCombo({
      pieces: [
        p("a", "shirt", null, { fitDescriptor: "fitted" }),
        p("b", "trouser", null, { fitDescriptor: "relaxed" }),
      ],
    });
    const same = scoreCombo({
      pieces: [
        p("a", "shirt", null, { fitDescriptor: "fitted" }),
        p("b", "trouser", null, { fitDescriptor: "fitted" }),
      ],
    });
    expect(mixed.breakdown.silhouetteBalance).toBeGreaterThan(same.breakdown.silhouetteBalance);
  });

  it("unknown fit descriptors = 0.7 neutral", () => {
    const r = scoreCombo({
      pieces: [p("a", "shirt", null), p("b", "trouser", null)],
    });
    expect(r.breakdown.silhouetteBalance).toBe(0.7);
  });
});

describe("scoreCombo — occasion fit", () => {
  it("no occasion set = neutral 0.7", () => {
    const r = scoreCombo({
      pieces: [p("a", "shirt", null, { occasionTags: ["evening"] })],
    });
    expect(r.breakdown.occasionFit).toBe(0.7);
  });

  it("matching occasion tags boost score above 0.7", () => {
    // All 3 tags match "work day" occasion → hits/total = 3/3 → 0.4 + 0.6 = 1.0
    const r = scoreCombo({
      pieces: [p("a", "shirt", null, { occasionTags: ["work", "day", "office"] })],
      shopperOccasion: "work day",
    });
    expect(r.breakdown.occasionFit).toBeGreaterThan(0.7);
  });

  it("no tags + occasion set = 0.6", () => {
    const r = scoreCombo({
      pieces: [p("a", "shirt", null)],
      shopperOccasion: "dinner",
    });
    expect(r.breakdown.occasionFit).toBe(0.6);
  });

  it("occasion fit is capped at 1.0", () => {
    const r = scoreCombo({
      pieces: [
        p("a", "shirt", null, { occasionTags: ["work", "work", "work", "work"] }),
      ],
      shopperOccasion: "work",
    });
    expect(r.breakdown.occasionFit).toBeLessThanOrEqual(1);
  });
});

describe("scoreCombo — colorHarmony component (GRADED for conversion)", () => {
  it("complementary pair scores high-impact 0.93", () => {
    const r = scoreCombo({
      pieces: [
        p("a", "shirt", "#1F3A8A"),    // blue
        p("b", "trouser", "#8A5A1F"),  // orange-brown
      ],
    });
    if (r.harmony.harmonyType === "complementary") {
      expect(r.breakdown.colorHarmony).toBe(0.93);
    } else {
      expect(r.breakdown.colorHarmony).toBeGreaterThan(0.6);
    }
  });

  it("uncategorized palette gives colorHarmony = 0.45", () => {
    const r = scoreCombo({
      pieces: [
        p("a", "shirt", "#FF0000"),    // red
        p("b", "trouser", "#00FF80"),  // mid-green
        p("c", "shoes", "#8000FF"),    // purple
      ],
    });
    if (r.harmony.harmonyType === "uncategorized") {
      expect(r.breakdown.colorHarmony).toBe(0.45);
    } else {
      expect(r.breakdown.colorHarmony).toBeGreaterThanOrEqual(0.45);
    }
  });

  it("no colors provided → uncategorized → colorHarmony = 0.45", () => {
    const r = scoreCombo({
      pieces: [p("a", "shirt", null), p("b", "trouser", null)],
    });
    expect(r.breakdown.colorHarmony).toBe(0.45);
  });

  it("the 'pop of colour on a neutral base' is the TOP-scoring harmony (beats uncategorized)", () => {
    // One saturated accent + neutrals → neutral_with_accent (the impulse combo).
    const pop = scoreCombo({
      pieces: [
        p("acc", "shirt", "#C81E3A"),     // cardinal red accent
        p("base", "trouser", "#EAE6DE"),  // bone neutral
        p("shoe", "shoes", "#1A1A1A"),    // near-black neutral
      ],
    });
    const uncat = scoreCombo({
      pieces: [
        p("a", "shirt", "#FF0000"),
        p("b", "trouser", "#00FF80"),
        p("c", "shoes", "#8000FF"),
      ],
    });
    expect(pop.breakdown.colorHarmony).toBeGreaterThan(uncat.breakdown.colorHarmony);
  });
});

describe("scoreCombo — conversion math (desirability + impulse-add)", () => {
  it("neutral 0.7 when no price or keepRate data", () => {
    const r = scoreCombo({ pieces: [p("a", "shirt", null), p("b", "trouser", null)] });
    expect(r.breakdown.conversion).toBeCloseTo(0.7, 5);
  });

  it("high keepRate + tight price spread converts better than low keepRate + wide spread", () => {
    const easy = scoreCombo({
      pieces: [
        p("a", "shirt", null, { keepRate: 0.92, priceCents: 12000 }),
        p("b", "trouser", null, { keepRate: 0.9, priceCents: 14000 }),
      ],
    });
    const hard = scoreCombo({
      pieces: [
        p("a", "shirt", null, { keepRate: 0.55, priceCents: 9000 }),
        p("b", "trouser", null, { keepRate: 0.5, priceCents: 240000 }),
      ],
    });
    expect(easy.breakdown.conversion).toBeGreaterThan(hard.breakdown.conversion);
  });

  it("a frictionless add (similar price, loved pieces) scores conversion near the top", () => {
    const r = scoreCombo({
      pieces: [
        p("a", "shirt", null, { keepRate: 0.95, priceCents: 20000 }),
        p("b", "trouser", null, { keepRate: 0.95, priceCents: 22000 }),
      ],
    });
    expect(r.breakdown.conversion).toBeGreaterThan(0.9);
  });
});

describe("pickWinningCombo", () => {
  it("returns null for empty array", () => {
    expect(pickWinningCombo([])).toBeNull();
  });

  it("returns the single combo when only one exists", () => {
    const c: ComboInput = {
      pieces: [
        p("shirt", "shirt", null, { inStock: true }),
        p("trouser", "trouser", null, { inStock: true }),
      ],
    };
    const result = pickWinningCombo([c]);
    expect(result).not.toBeNull();
    expect(result!.winner).toBe(c);
  });

  it("prefers presentable combos over non-presentable ones", () => {
    const good: ComboInput = {
      pieces: [
        p("shirt", "shirt", null, { inStock: true }),
        p("trouser", "trouser", null, { inStock: true }),
        p("shoe", "shoes", null, { inStock: true }),
      ],
    };
    const bad: ComboInput = {
      pieces: [
        p("shirt2", "shirt", null, { inStock: false }),
        p("trouser2", "trouser", null, { inStock: false }),
        p("shoe2", "shoes", null, { inStock: false }),
      ],
    };
    const result = pickWinningCombo([bad, good]);
    expect(result!.winner).toBe(good);
  });

  it("picks highest scorer among multiple combos", () => {
    // A complete outfit vs a single-piece outfit
    const complete: ComboInput = {
      pieces: [
        p("s", "shirt", "#1F3A8A", { inStock: true }),
        p("t", "trouser", "#F8FAFC", { inStock: true }),
        p("a", "accessory", "#6B3F1D", { inStock: true }),
      ],
    };
    const single: ComboInput = {
      pieces: [p("s2", "shirt", null, { inStock: true })],
    };
    const result = pickWinningCombo([single, complete]);
    expect(result!.winner).toBe(complete);
  });
});
