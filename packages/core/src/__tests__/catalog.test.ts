import { describe, it, expect } from "vitest";
import { createFakePrisma } from "./fakePrisma.js";
import {
  extractColor,
  normalizeProduct,
  baselineAudit,
  createCatalogSyncService,
  type ShopifyProductInput,
  type ShopifyCatalogClient,
} from "../catalog/index.js";

describe("extractColor", () => {
  it("prefers tags over title", () => {
    const r = extractColor({ title: "Cool Top", tags: ["navy", "summer"] });
    expect(r.source).toBe("tag");
    expect(r.colorFamily).toBe("navy");
    expect(r.primaryColor).toBe("#1E2A52");
  });

  it("longest-match wins (navy beats blue)", () => {
    const r = extractColor({ title: "Navy Blue Linen Shirt" });
    expect(r.colorFamily).toBe("navy");
  });

  it("returns none when nothing matches", () => {
    const r = extractColor({ title: "Pocket Square", tags: ["accessory"] });
    expect(r).toEqual({ primaryColor: null, colorFamily: null, source: "none" });
  });

  it("falls back to variant option named Color", () => {
    const r = extractColor({
      title: "Tee",
      variantOptions: [{ name: "Size", value: "M" }, { name: "Color", value: "Olive" }],
    });
    expect(r.source).toBe("variant");
    expect(r.colorFamily).toBe("olive");
  });

  it("canonicalizes synonyms (gray → grey, charcoal → grey)", () => {
    expect(extractColor({ title: "Charcoal Trouser" }).colorFamily).toBe("grey");
    expect(extractColor({ title: "Gray Tee" }).colorFamily).toBe("grey");
  });
});

describe("normalizeProduct", () => {
  it("normalizes a GraphQL-shape product", () => {
    const input: ShopifyProductInput = {
      id: "gid://shopify/Product/123",
      handle: "blue-oxford",
      title: "Blue Oxford Shirt",
      productType: "Shirt",
      vendor: "Acme",
      tags: ["blue", "shirt"],
      status: "active",
      variants: [
        { id: 1, sku: "BOX-S", price: "49.00", selectedOptions: [{ name: "Size", value: "S" }, { name: "Color", value: "Blue" }] },
        { id: 2, sku: "BOX-M", price: "49.00", selectedOptions: [{ name: "Size", value: "M" }, { name: "Color", value: "Blue" }] },
      ],
      images: [{ id: 10, url: "https://cdn.example/box1.jpg", position: 0 }],
    };
    const n = normalizeProduct(input);
    expect(n.shopifyId).toBe("gid://shopify/Product/123");
    expect(n.category).toBe("shirt");
    expect(n.colorFamily).toBe("blue");
    expect(n.primaryColor).toBe("#1F3A8A");
    expect(n.variants).toHaveLength(2);
    expect(n.variants[0]).toMatchObject({ size: "S", color: "Blue", priceCents: 4900 });
    expect(n.images[0].shopifyId).toBe("gid://shopify/ProductImage/10");
    expect(n.isActive).toBe(true);
  });

  it("normalizes a REST-shape product (comma tags, option1/option2)", () => {
    const input: ShopifyProductInput = {
      id: 999,
      handle: "white-trousers",
      title: "White Trousers",
      tags: "white, trousers",
      variants: [{ id: 4001, sku: "WT-32", price: "65.00", option1: "32", option2: "White" }],
      images: [{ src: "https://cdn.example/wt.jpg" }],
    };
    const n = normalizeProduct(input);
    expect(n.shopifyId).toBe("gid://shopify/Product/999");
    expect(n.tags).toEqual(["white", "trousers"]);
    expect(n.category).toBe("trouser");
    expect(n.colorFamily).toBe("white");
    expect(n.variants[0].size).toBe("32");
    expect(n.variants[0].color).toBe("White");
    expect(n.images[0].url).toBe("https://cdn.example/wt.jpg");
    expect(n.images[0].shopifyId).toBeNull();
  });

  it("marks draft/archived products as inactive", () => {
    const n = normalizeProduct({ id: 1, handle: "x", title: "x", status: "draft" });
    expect(n.isActive).toBe(false);
  });
});

describe("baselineAudit", () => {
  it("flags missing image and size chart", () => {
    const n = normalizeProduct({ id: 1, handle: "x", title: "Mystery Item" });
    const a = baselineAudit(n);
    expect(a.missingTryOnReady).toBe(true);
    expect(a.missingSizeChart).toBe(true);
    expect(a.missingColorCombos).toBe(true);
    expect(a.missingStyling).toBe(true);
    expect(a.priorityScore).toBeGreaterThan(0.5);
    expect(a.recommendations.map((r) => r.code)).toEqual(
      expect.arrayContaining(["TRYON_NO_IMAGE", "FIT_NO_SIZE_CHART", "STYLE_NO_COLOR"]),
    );
  });

  it("clears flags when product has image + sized variants + color", () => {
    const n = normalizeProduct({
      id: 2, handle: "blue-shirt", title: "Blue Oxford Shirt",
      tags: ["blue"],
      variants: [{ id: 1, sku: "S", selectedOptions: [{ name: "Size", value: "M" }] }],
      images: [{ url: "https://cdn.example/x.jpg" }],
    });
    const a = baselineAudit(n);
    expect(a.missingTryOnReady).toBe(false);
    expect(a.missingSizeChart).toBe(false);
    expect(a.missingColorCombos).toBe(false);
    expect(a.missingStyling).toBe(true);     // always true until a StyleSession exists
    expect(a.priorityScore).toBeLessThan(0.5);
  });
});

describe("CatalogSyncService", () => {
  function fakeClient(items: ShopifyProductInput[]): ShopifyCatalogClient {
    return {
      async fetchAllProducts() { return items; },
      async fetchProduct(id) { return items.find((i) => String(i.id) === String(id)) ?? null; },
    };
  }

  it("syncs products and creates audits", async () => {
    const prisma = createFakePrisma();
    const svc = createCatalogSyncService(prisma as any);

    const result = await svc.syncAll("shop-1", fakeClient([
      { id: 1, handle: "blue-shirt", title: "Blue Shirt", status: "active",
        variants: [{ id: 11, sku: "BS-M", selectedOptions: [{ name: "Size", value: "M" }] }],
        images: [{ url: "https://cdn/x.jpg" }] },
      { id: 2, handle: "white-tee", title: "White Tee", status: "active",
        variants: [{ id: 21, sku: "WT-M", selectedOptions: [{ name: "Size", value: "M" }] }],
        images: [{ url: "https://cdn/y.jpg" }] },
    ]));

    expect(result.upserted).toBe(2);
    expect(prisma._state.products.size).toBe(2);
    expect(prisma._state.audits.size).toBe(2);
    expect(prisma._state.variants.size).toBe(2);
    expect(prisma._state.images.size).toBe(2);
  });

  it("removes products that disappear from Shopify on next sync", async () => {
    const prisma = createFakePrisma();
    const svc = createCatalogSyncService(prisma as any);

    await svc.syncAll("shop-1", fakeClient([
      { id: 1, handle: "a", title: "A", status: "active", images: [{ url: "x" }] },
      { id: 2, handle: "b", title: "B", status: "active", images: [{ url: "y" }] },
    ]));
    expect(prisma._state.products.size).toBe(2);

    const result = await svc.syncAll("shop-1", fakeClient([
      { id: 1, handle: "a", title: "A", status: "active", images: [{ url: "x" }] },
    ]));
    expect(result.deactivated).toBe(1);
    expect(prisma._state.products.size).toBe(1);
  });

  it("deleteByShopifyId removes a single product", async () => {
    const prisma = createFakePrisma();
    const svc = createCatalogSyncService(prisma as any);
    await svc.syncOne("shop-1", { id: 1, handle: "a", title: "A", images: [{ url: "x" }] });
    expect(prisma._state.products.size).toBe(1);
    await svc.deleteByShopifyId("shop-1", 1);
    expect(prisma._state.products.size).toBe(0);
  });
});

describe("Uninstall behavior", () => {
  it("marks shop uninstalledAt without deleting data and writes APP_UNINSTALLED notification", async () => {
    const installedAt = new Date("2025-01-01");
    const prisma = createFakePrisma({
      shops: [{ id: "shop-1", shopifyDomain: "acme.myshopify.com", accessToken: "tok", scopes: "read_products", installedAt, uninstalledAt: null }],
    });
    const svc = createCatalogSyncService(prisma as any);

    // Seed a product so we can prove it's not deleted.
    await svc.syncOne("shop-1", { id: 1, handle: "a", title: "A", images: [{ url: "x" }] });
    expect(prisma._state.products.size).toBe(1);

    await svc.markShopUninstalled("shop-1");
    expect(prisma._state.shops.get("shop-1")?.uninstalledAt).toBeInstanceOf(Date);
    expect(prisma._state.products.size).toBe(1);
    expect(prisma._state.notifications.some((n) => n.kind === "APP_UNINSTALLED")).toBe(true);
  });
});
