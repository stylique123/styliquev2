import { describe, expect, it } from "vitest";
import { realCatalogGapWhere } from "./dashboard.server";

describe("dashboard catalog-gap filters", () => {
  it("excludes internal size-chart bookkeeping rows from merchant demand intelligence", () => {
    const since = new Date("2026-06-01T00:00:00.000Z");

    expect(realCatalogGapWhere("shop-1", since)).toEqual({
      shopId: "shop-1",
      createdAt: { gte: since },
      source: { not: "size_chart_extract" },
      NOT: { rawQuery: { startsWith: "no_size_chart" } },
    });
  });
});
