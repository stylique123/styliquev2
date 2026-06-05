// Cross-package test for the shopper-safe serializer. Lives in @stylique/core
// because that's where vitest is wired up — the function under test is in
// apps/shopify-app/app/lib/serialize.ts (pure, no Prisma).

import { describe, it, expect } from "vitest";
import { toShopperProduct } from "../../../../apps/shopify-app/app/lib/serialize.js";

describe("toShopperProduct — security serializer", () => {
  const raw = {
    id: "cuid-product-1",
    handle: "blue-oxford",
    title: "Blue Oxford Shirt",
    category: "shirt",
    primaryColor: "#1F3A8A",
    colorFamily: "blue",
    images: [{ url: "https://cdn.example/img.jpg" }],
    variants: [{ size: "M" }, { size: "L" }, { size: null }],
    // these MUST NOT appear in serialized output
    accessToken: "shpat_SECRET",
    shopId: "secret-shop-id",
    shopifyId: "gid://shopify/Product/1",
  } as never;

  const out = toShopperProduct(raw);

  it("returns only the documented shopper-safe keys", () => {
    expect(new Set(Object.keys(out))).toEqual(new Set([
      "id", "handle", "title", "category", "primaryColor", "colorFamily", "imageUrl", "sizes",
      // D37 additions — VTO tier routing. All shopper-safe (no internal IDs).
      "tryonReady", "widgetTier", "tryonImageUrl",
    ]));
  });

  it("does not include accessToken, shopId, or any internal id", () => {
    const json = JSON.stringify(out);
    expect(json).not.toContain("shpat_");
    expect(json).not.toContain("accessToken");
    expect(json).not.toContain("shopId");
    expect(json).not.toContain("shopifyId");
  });

  it("dedupes and filters null sizes", () => {
    expect(out.sizes).toEqual(["M", "L"]);
  });

  it("returns null imageUrl when no images", () => {
    const out2 = toShopperProduct({
      id: "x", handle: "x", title: "x",
      category: null, primaryColor: null, colorFamily: null,
      images: [], variants: [],
    });
    expect(out2.imageUrl).toBeNull();
    expect(out2.sizes).toEqual([]);
  });
});
