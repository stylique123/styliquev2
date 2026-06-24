import { describe, expect, it } from "vitest";
import { monthlyReportCatalogGapWhere, orderTotalsFromCartRows, synthesizeMonthlyReport } from "../reports/monthly.js";

type EventRow = {
  id?: string;
  shopId: string;
  name: string;
  createdAt: Date;
  payload?: unknown;
  productId?: string | null;
  shopperId?: string | null;
};
type CatalogGapRow = {
  shopId: string;
  category: string | null;
  rawQuery: string;
  source?: string;
  createdAt: Date;
};

function matchesWhere(row: EventRow, where: any) {
  if (where.shopId && row.shopId !== where.shopId) return false;
  if (typeof where.name === "string" && row.name !== where.name) return false;
  if (where.name?.in && !where.name.in.includes(row.name)) return false;
  if (where.productId?.not === null && row.productId == null) return false;
  if (typeof where.productId === "string" && row.productId !== where.productId) return false;
  if (where.createdAt?.gte && row.createdAt < where.createdAt.gte) return false;
  if (where.createdAt?.lt && row.createdAt >= where.createdAt.lt) return false;
  if (typeof where.shopperId === "string" && row.shopperId !== where.shopperId) return false;
  return true;
}

function project(row: EventRow, select?: Record<string, boolean>) {
  if (!select) return row;
  return Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]]));
}

function matchesCatalogGapWhere(row: CatalogGapRow, where: any) {
  if (where.shopId && row.shopId !== where.shopId) return false;
  if (where.source?.not && (row.source ?? "shopper") === where.source.not) return false;
  if (where.NOT?.rawQuery?.startsWith && row.rawQuery.startsWith(where.NOT.rawQuery.startsWith)) return false;
  if (where.createdAt?.gte && row.createdAt < where.createdAt.gte) return false;
  if (where.createdAt?.lt && row.createdAt >= where.createdAt.lt) return false;
  return true;
}

function prismaForReport(events: EventRow[], catalogGaps: CatalogGapRow[] = []) {
  return {
    shop: {
      findUnique: async () => ({
        id: "shop-1",
        shopifyDomain: "brand.test",
        currencyCode: "USD",
      }),
    },
    analyticsEvent: {
      count: async ({ where }: any) => events.filter((row) => matchesWhere(row, where)).length,
      findMany: async ({ where, select, take }: any) => {
        const rows = events.filter((row) => matchesWhere(row, where)).map((row) => project(row, select));
        return typeof take === "number" ? rows.slice(0, take) : rows;
      },
      findFirst: async ({ where, select }: any) => {
        const row = events.find((item) => matchesWhere(item, where));
        return row ? project(row, select) : null;
      },
    },
    catalogGap: {
      findMany: async ({ where, select }: any) =>
        catalogGaps.filter((row) => matchesCatalogGapWhere(row, where)).map((row) => project(row as any, select)),
    },
    product: { findMany: async () => [] },
    shopperSession: { findMany: async () => [] },
  } as any;
}

describe("synthesizeMonthlyReport", () => {
  it("groups CART_CONFIRMED line rows into full order totals", () => {
    expect(orderTotalsFromCartRows([
      { id: "row-1", payload: { orderId: "order-1", lineValue: 8000 } },
      { id: "row-2", payload: { orderId: "order-1", lineValue: 12000 } },
      { id: "row-3", payload: { orderId: "order-2", lineValue: 5000 } },
    ])).toEqual(new Map([
      ["o:order-1", 20000],
      ["o:order-2", 5000],
    ]));
  });

  it("uses the real shopper-demand catalog gap filter", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-02-01T00:00:00.000Z");

    expect(monthlyReportCatalogGapWhere("shop-1", { gte: start, lt: end })).toEqual({
      shopId: "shop-1",
      createdAt: { gte: start, lt: end },
      source: { not: "size_chart_extract" },
      NOT: { rawQuery: { startsWith: "no_size_chart" } },
    });
  });

  it("counts only successful Mira cart events as add-to-bag funnel activity", async () => {
    const periodEnd = new Date("2026-02-01T00:00:00.000Z");
    const inWindow = new Date("2026-01-20T12:00:00.000Z");
    const events: EventRow[] = [
      { shopId: "shop-1", name: "CHAT_OPENED", createdAt: inWindow },
      { shopId: "shop-1", name: "CHAT_CART_REQUESTED", productId: "p1", createdAt: inWindow },
      { shopId: "shop-1", name: "MIRA_ADD_TO_CART_ASSIST", productId: "p1", createdAt: inWindow },
      { shopId: "shop-1", name: "COMBO_ADD_ALL", productId: "p2", createdAt: inWindow },
      { shopId: "shop-1", name: "CART_FROM_MIRA", productId: "p1", createdAt: inWindow },
      { shopId: "shop-1", name: "CART_FROM_TRYON", productId: "p1", createdAt: inWindow },
      { shopId: "shop-1", name: "CART_FROM_WIDGET_STYLE", productId: "p2", createdAt: inWindow },
      { shopId: "shop-1", name: "CART_CONFIRMED", productId: "p1", payload: { lineValue: 12000 }, createdAt: inWindow },
    ];

    const report = await synthesizeMonthlyReport(prismaForReport(events), { shopId: "shop-1", periodEnd });

    expect(report.funnel.atcEvents).toBe(3);
    expect(report.funnel.confirmedOrders).toBe(1);
  });

  it("excludes internal size-chart rows from catalog-gap revenue-at-risk", async () => {
    const periodEnd = new Date("2026-02-01T00:00:00.000Z");
    const inWindow = new Date("2026-01-20T12:00:00.000Z");
    const events: EventRow[] = [
      { shopId: "shop-1", name: "CART_CONFIRMED", productId: "p1", payload: { lineValue: 10000 }, createdAt: inWindow },
    ];
    const catalogGaps: CatalogGapRow[] = [
      { shopId: "shop-1", category: "maintenance", rawQuery: "no_size_chart:p1", source: "size_chart_extract", createdAt: inWindow },
      { shopId: "shop-1", category: "maintenance", rawQuery: "no_size_chart:p2", source: "size_chart_extract", createdAt: inWindow },
      { shopId: "shop-1", category: "outerwear", rawQuery: "cropped linen blazer", source: "shopper", createdAt: inWindow },
      { shopId: "shop-1", category: "outerwear", rawQuery: "linen jacket", source: "shopper", createdAt: inWindow },
    ];

    const report = await synthesizeMonthlyReport(prismaForReport(events, catalogGaps), { shopId: "shop-1", periodEnd });

    expect(report.catalogGaps.topGaps).toHaveLength(1);
    expect(report.catalogGaps.topGaps[0]).toMatchObject({
      category: "outerwear",
      count: 2,
      revenueAtRiskCents: 6000,
    });
    expect(report.methodology.sampleSizes.gapEvents).toBe(2);
  });

  it("uses full order totals for confirmed orders, baseline AOV, and gap revenue-at-risk", async () => {
    const periodEnd = new Date("2026-02-01T00:00:00.000Z");
    const inWindow = new Date("2026-01-20T12:00:00.000Z");
    const events: EventRow[] = [
      { id: "cart-1", shopId: "shop-1", name: "CART_CONFIRMED", productId: "p1", payload: { orderId: "order-1", lineValue: 8000 }, createdAt: inWindow },
      { id: "cart-2", shopId: "shop-1", name: "CART_CONFIRMED", productId: "p2", payload: { orderId: "order-1", lineValue: 12000 }, createdAt: inWindow },
      { id: "cart-3", shopId: "shop-1", name: "CART_CONFIRMED", productId: "p3", payload: { orderId: "order-2", lineValue: 10000 }, createdAt: inWindow },
      { id: "assist-1", shopId: "shop-1", name: "MIRA_ASSISTED_ORDER", payload: { orderId: "order-2", assistedRevenueCents: 10000 }, createdAt: inWindow },
    ];
    const catalogGaps: CatalogGapRow[] = [
      { shopId: "shop-1", category: "outerwear", rawQuery: "linen trench", source: "shopper", createdAt: inWindow },
    ];

    const report = await synthesizeMonthlyReport(prismaForReport(events, catalogGaps), { shopId: "shop-1", periodEnd });

    expect(report.funnel.confirmedOrders).toBe(2);
    expect(report.funnel.aovAssistedCents).toBe(10000);
    expect(report.funnel.aovBaselineCents).toBe(20000);
    expect(report.funnel.aovN).toEqual({ assisted: 1, baseline: 1 });
    expect(report.catalogGaps.topGaps[0]!.revenueAtRiskCents).toBe(4500);
  });
});
