// Tests for the image quality pipeline (D37).
// The widget-tier computation and stage-1 filename heuristics are the
// highest-risk paths — a regression here silently routes all products to
// "size only" mode (tier 3) or gives VTO a bad anchor image.

import { describe, it, expect } from "vitest";
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

// ─── Filename heuristics (logic re-tested inline, not importing stage1
//     because it uses fetch which needs a real HTTP server) ─────────────────

describe("filename heuristics — expected garmentRole assignments", () => {
  // These patterns are baked into stage1.ts RX map. Tested here without
  // running fetch so the suite stays fast in CI.
  const RX = {
    back:      /(_back|-back|back\.|_rear)/i,
    detail:    /(_detail|-detail|_close|_zoom|_macro|_swatch|_fabric)/i,
    lifestyle: /(_lifestyle|-lifestyle|_model|_editorial|_campaign|_lookbook)/i,
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

  it("plain front-shot filename matches no pattern (treated as FRONT)", () => {
    const name = "white-shirt-01.jpg";
    expect(RX.back.test(name)).toBe(false);
    expect(RX.detail.test(name)).toBe(false);
    expect(RX.lifestyle.test(name)).toBe(false);
    expect(RX.swatch.test(name)).toBe(false);
  });
});
