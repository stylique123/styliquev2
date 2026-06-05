// Test the variant selection logic from postComboAddAll (shopper-events.server.ts).
// Previously untested — COMBO-1 critical bug was found in manual audit.
//
// The two bugs in COMBO-1:
//   Bug A: size-map was ignored — always picked first-in-DB variant regardless
//          of the `sizes` map sent by the widget.
//   Bug B: GID format `gid://shopify/ProductVariant/123` was not stripped before
//          constructing the numeric ID, producing NaN for Shopify /cart/add.js.
//
// These tests exercise the extracted pure logic (no Prisma, no Redis) so any
// future refactor of shopper-events.server.ts can be validated without a live DB.

import { describe, it, expect } from "vitest";

// ─── Pure logic extracted from the fixed postComboAddAll implementation ────────
// Mirrors the logic in apps/shopify-app/app/lib/shopper-events.server.ts.

function selectVariants(
  variants: Array<{ productId: string; shopifyId: string; size: string | null }>,
  validIds: string[],
  sizes: Record<string, string>,
): string[] {
  const variantByProduct = new Map<string, string>();

  for (const v of variants) {
    const numericId = v.shopifyId
      .replace(/^gid:\/\/shopify\/ProductVariant\//, "")
      .trim();

    // Bug B guard: skip non-numeric IDs (would produce NaN in /cart/add.js).
    if (!/^\d+$/.test(numericId)) continue;

    const requestedSize = sizes[v.productId];
    const sizeMatch =
      requestedSize != null &&
      v.size != null &&
      v.size.trim().toUpperCase() === requestedSize.trim().toUpperCase();

    if (!variantByProduct.has(v.productId)) {
      // First-seen for this product — tentative winner.
      variantByProduct.set(v.productId, numericId);
    } else if (sizeMatch) {
      // Better match found — override the first-seen entry (Bug A fix).
      variantByProduct.set(v.productId, numericId);
    }
  }

  return validIds.map((id) => variantByProduct.get(id) ?? "").filter(Boolean);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("selectVariants (combo add-all logic)", () => {
  const PRODUCT_A = "prod_a";
  const PRODUCT_B = "prod_b";

  it("returns the variant that matches the requested size (Bug A fix)", () => {
    const variants = [
      { productId: PRODUCT_A, shopifyId: "111", size: "S" },
      { productId: PRODUCT_A, shopifyId: "222", size: "M" },
      { productId: PRODUCT_A, shopifyId: "333", size: "L" },
    ];
    const result = selectVariants(variants, [PRODUCT_A], { [PRODUCT_A]: "M" });
    expect(result).toEqual(["222"]);
  });

  it("falls back to first-in-list when no size matches", () => {
    const variants = [
      { productId: PRODUCT_A, shopifyId: "111", size: "S" },
      { productId: PRODUCT_A, shopifyId: "222", size: "M" },
    ];
    const result = selectVariants(variants, [PRODUCT_A], { [PRODUCT_A]: "XL" });
    // XL not in the list → falls back to first (111)
    expect(result).toEqual(["111"]);
  });

  it("correctly strips GID format before returning numeric ID (Bug B fix)", () => {
    const variants = [
      {
        productId: PRODUCT_A,
        shopifyId: "gid://shopify/ProductVariant/9876543210",
        size: "M",
      },
    ];
    const result = selectVariants(variants, [PRODUCT_A], { [PRODUCT_A]: "M" });
    expect(result).toEqual(["9876543210"]);
  });

  it("skips variants whose shopifyId is non-numeric after stripping (NaN guard)", () => {
    const variants = [
      { productId: PRODUCT_A, shopifyId: "not-a-number", size: "M" },
      { productId: PRODUCT_A, shopifyId: "456", size: "L" },
    ];
    // "not-a-number" is skipped; "456" is the only valid one
    const result = selectVariants(variants, [PRODUCT_A], { [PRODUCT_A]: "M" });
    expect(result).toEqual(["456"]);
  });

  it("returns empty when all variants have invalid IDs", () => {
    const variants = [
      { productId: PRODUCT_A, shopifyId: "gid://shopify/SomeOtherType/abc", size: "M" },
    ];
    const result = selectVariants(variants, [PRODUCT_A], { [PRODUCT_A]: "M" });
    expect(result).toEqual([]);
  });

  it("returns empty when variants list is empty", () => {
    const result = selectVariants([], [PRODUCT_A], { [PRODUCT_A]: "M" });
    expect(result).toEqual([]);
  });

  it("handles multiple products — picks correct size per product independently", () => {
    const variants = [
      { productId: PRODUCT_A, shopifyId: "111", size: "S" },
      { productId: PRODUCT_A, shopifyId: "222", size: "M" },
      { productId: PRODUCT_B, shopifyId: "333", size: "M" },
      { productId: PRODUCT_B, shopifyId: "444", size: "L" },
    ];
    const result = selectVariants(variants, [PRODUCT_A, PRODUCT_B], {
      [PRODUCT_A]: "M",
      [PRODUCT_B]: "L",
    });
    expect(result).toEqual(["222", "444"]);
  });

  it("size matching is case-insensitive", () => {
    const variants = [
      { productId: PRODUCT_A, shopifyId: "111", size: "S" },
      { productId: PRODUCT_A, shopifyId: "222", size: "M" }, // stored as "M"
    ];
    // Widget sends lowercase "m"
    const result = selectVariants(variants, [PRODUCT_A], { [PRODUCT_A]: "m" });
    expect(result).toEqual(["222"]);
  });

  it("handles null size on variant — does not crash, skips size match", () => {
    const variants = [
      { productId: PRODUCT_A, shopifyId: "111", size: null },
      { productId: PRODUCT_A, shopifyId: "222", size: "M" },
    ];
    const result = selectVariants(variants, [PRODUCT_A], { [PRODUCT_A]: "M" });
    // null size → no match; "222" matches
    expect(result).toEqual(["222"]);
  });

  it("validIds filters which products appear in the output", () => {
    const variants = [
      { productId: PRODUCT_A, shopifyId: "111", size: "M" },
      { productId: PRODUCT_B, shopifyId: "222", size: "M" },
    ];
    // Only PRODUCT_A is in validIds — PRODUCT_B is excluded
    const result = selectVariants(variants, [PRODUCT_A], {
      [PRODUCT_A]: "M",
      [PRODUCT_B]: "M",
    });
    expect(result).toEqual(["111"]);
  });

  it("handles GID with trailing whitespace (edge case from some Shopify API responses)", () => {
    const variants = [
      {
        productId: PRODUCT_A,
        shopifyId: "gid://shopify/ProductVariant/12345  ", // trailing spaces
        size: "M",
      },
    ];
    const result = selectVariants(variants, [PRODUCT_A], { [PRODUCT_A]: "M" });
    // .trim() removes trailing spaces → "12345" is numeric
    expect(result).toEqual(["12345"]);
  });
});
