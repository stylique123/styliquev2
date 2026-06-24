import { afterEach, describe, expect, it, vi } from "vitest";
import { internalDemandCatalogGapWhere, internalQuotaUsagePercent } from "./internal-dashboard.server";
import {
  REQUIRED_SHOPIFY_SCOPES_STRING,
  extraGrantedShopifyScopes,
  fetchLiveShopifyScopeCheck,
  missingRequiredShopifyScopes,
} from "./shopify-scopes.server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("internal dashboard catalog-gap filters", () => {
  it("excludes internal size-chart bookkeeping rows from ops demand views", () => {
    expect(internalDemandCatalogGapWhere("shop-1")).toEqual({
      shopId: "shop-1",
      source: { not: "size_chart_extract" },
      NOT: { rawQuery: { startsWith: "no_size_chart" } },
    });
  });
});

describe("internal dashboard quota usage truth", () => {
  it("calculates visible quota percent from all known finite meters, not only try-on caps", () => {
    expect(
      internalQuotaUsagePercent(
        {
          monthlyTryOnPersonal: 10,
          monthlyTryOnBody: 90,
          monthlyStylistTurns: 100,
          monthlyStyleRecs: 50,
          monthlyFitRecs: 50,
        },
        [
          { metric: "TRYON_PERSONAL", count: 10 },
          { metric: "TRYON_BODY", count: 20 },
          { metric: "STYLIST_TURN", count: 100 },
          { metric: "STYLE_RECOMMENDATION", count: 25 },
          { metric: "FIT_RECOMMENDATION", count: 25 },
          { metric: "CREATIVE_GENERATED", count: 10_000 },
        ],
      ),
    ).toBeCloseTo(180 / 300);
  });

  it("ignores unlimited meters instead of turning them into false over-quota signals", () => {
    expect(
      internalQuotaUsagePercent(
        {
          monthlyTryOnPersonal: null,
          monthlyTryOnBody: 200,
          monthlyStylistTurns: null,
          monthlyStyleRecs: null,
          monthlyFitRecs: 100,
        },
        [
          { metric: "TRYON_PERSONAL", count: 50_000 },
          { metric: "TRYON_BODY", count: 50 },
          { metric: "STYLIST_TURN", count: 50_000 },
          { metric: "FIT_RECOMMENDATION", count: 25 },
        ],
      ),
    ).toBeCloseTo(75 / 300);
  });
});

describe("internal dashboard Shopify scope checks", () => {
  it("normalizes stored comma-separated scopes and reports missing required permissions", () => {
    expect(
      missingRequiredShopifyScopes("read_products, read_orders,write_script_tags"),
    ).toEqual(["read_inventory"]);
  });

  it("flags a fully missing scope record as unsafe for production onboarding", () => {
    expect(missingRequiredShopifyScopes(null)).toEqual([
      "read_products",
      "read_inventory",
      "read_orders",
      "write_script_tags",
    ]);
  });

  it("reports stale extra token scopes so re-consent can return to least privilege", () => {
    expect(
      extraGrantedShopifyScopes(`${REQUIRED_SHOPIFY_SCOPES_STRING},write_products,read_product_listings`),
    ).toEqual(["read_product_listings", "write_products"]);
  });

  it("checks Shopify's live app installation scopes and reports drift", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          currentAppInstallation: {
            accessScopes: [
              { handle: "read_products" },
              { handle: "read_orders" },
              { handle: "write_script_tags" },
              { handle: "write_products" },
            ],
          },
        },
      }),
    } as Response);

    await expect(
      fetchLiveShopifyScopeCheck({
        shopifyDomain: "shop.myshopify.com",
        accessToken: "token",
      }),
    ).resolves.toMatchObject({
      status: "checked",
      missing: ["read_inventory"],
      extra: ["write_products"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://shop.myshopify.com/admin/api/2025-01/graphql.json",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("skips live scope checks for pending manual installs without a token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      fetchLiveShopifyScopeCheck({
        shopifyDomain: "pending.myshopify.com",
        accessToken: "manual-provisioning-pending",
      }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "no_shopify_access_token",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
