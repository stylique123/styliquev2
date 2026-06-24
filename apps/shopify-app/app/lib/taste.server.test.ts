import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("../db.server", () => ({
  prisma: {
    catalogGap: { findMany: mocks.findMany },
  },
}));

vi.mock("./shopper-helpers.server", () => ({
  analytics: { track: vi.fn() },
}));

import { gapIntensityCatalogGapWhere, getGapIntensity } from "./taste.server";

describe("catalog gap intensity filters", () => {
  it("excludes size-chart maintenance rows from hot-gap scoring", () => {
    const since = new Date("2026-01-01T00:00:00.000Z");

    expect(gapIntensityCatalogGapWhere("shop-1", "black dress", since)).toEqual({
      shopId: "shop-1",
      normalizedQuery: "black dress",
      createdAt: { gte: since },
      source: { not: "size_chart_extract" },
      NOT: { rawQuery: { startsWith: "no_size_chart" } },
    });
  });

  it("passes the real-demand filter into Prisma", async () => {
    mocks.findMany.mockResolvedValueOnce([]);

    await getGapIntensity("shop-1", "black dress", 7);

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.findMany.mock.calls[0]?.[0]?.where).toMatchObject({
      shopId: "shop-1",
      normalizedQuery: "black dress",
      source: { not: "size_chart_extract" },
      NOT: { rawQuery: { startsWith: "no_size_chart" } },
    });
  });
});
