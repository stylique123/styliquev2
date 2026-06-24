import { describe, expect, it } from "vitest";
import {
  fashionIntelligenceCatalogGapWhere,
  fitAudienceCopy,
  fitEvidenceNote,
  fitReturnDriverCopy,
} from "./fashion-intelligence.server";

describe("fashion intelligence catalog-gap filters", () => {
  it("excludes size-chart maintenance rows from live demand thresholds", () => {
    const since = new Date("2026-01-01T00:00:00.000Z");

    expect(fashionIntelligenceCatalogGapWhere("shop-1", since)).toEqual({
      shopId: "shop-1",
      createdAt: { gte: since },
      source: { not: "size_chart_extract" },
      NOT: { rawQuery: { startsWith: "no_size_chart" } },
    });
  });
});

describe("fashion intelligence evidence-aware copy", () => {
  it("does not describe modelled fit watchlists as observed shopper behavior", () => {
    expect(fitEvidenceNote({ category: "dress" }, false)).toBe(
      "Dress — catalog fit watchlist while size-toggle evidence builds.",
    );
    expect(fitReturnDriverCopy(false)).toBe(
      "Collecting return and cancellation evidence; current risk is directional.",
    );
    expect(fitAudienceCopy(false)).toBe(
      "Audience confidence unlocks after enough shoppers submit fit data and reach cart outcomes.",
    );
  });

  it("uses observed-behavior language only for measured fit evidence", () => {
    expect(fitEvidenceNote({ productType: "trouser" }, true)).toBe(
      "Trouser — high click-to-cart hesitation on this product.",
    );
    expect(fitReturnDriverCopy(true)).toBe(
      "Fit uncertainty from observed cart confirmations versus cancellations.",
    );
    expect(fitAudienceCopy(true)).toBe(
      "Shoppers who shared measurements and accepted the size recommendation are the highest-trust segment.",
    );
  });
});
