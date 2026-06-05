// Brain — rules layer.
//
// "Rules decide facts, AI decides guidance." This engine validates the Brain's
// outputs against the deterministic, hydrated catalog facts in BrainContext
// BEFORE they reach the shopper. The AI may compose a beautiful combo or a
// confident size recommendation — but it must NEVER invent a product that isn't
// in the catalog, a navigate target that doesn't exist, or a size a product
// doesn't carry. The rules layer is the guardrail.
//
// Hard contract for every method:
//   • Pure + synchronous. NO DB calls, NO async — reads only the already-
//     hydrated BrainContext.
//   • Safe fallback: when the catalog facts aren't available (no products
//     hydrated this turn), the engine returns valid:true. We NEVER produce a
//     false negative — an unknown fact must not block a sale or a navigation.
//     The cart / storefront is the final source of truth.
//
// Product source: BrainContext doesn't carry a top-level `products` map (the
// Brain hydrates products lazily into ctx.cache as tools fetch them). The
// engine reads whatever catalog facts the turn has hydrated via getProducts(),
// which is tolerant of several shapes and always degrades to "no facts → don't
// block".

import type { BrainContext, BrainCombo, BrainProduct } from "./types.js";

// A normalized product fact the rules engine can validate against. We accept
// both BrainProduct (combo shape) and the richer BrainCurrentProduct (PDP
// shape) and read only the fields we need.
type ProductFact = {
  id: string;
  handle: string;
  sizes: string[];
  // Per-size remaining quantity. undefined/empty = unknown (never block).
  stockBySize?: Record<string, number>;
};

const CACHE_PRODUCTS_KEY = "rules:products";

export class RulesEngine {
  /**
   * Validate a proposed combo against catalog facts.
   *  - every productId must exist in the hydrated catalog
   *  - every product must be in stock (or stock unknown — never block on unknown)
   *  - no duplicate products
   * Empty catalog → valid:true (no false negatives).
   */
  validateCombo(combo: BrainCombo, ctx: BrainContext): { valid: boolean; violations: string[] } {
    const violations: string[] = [];
    const products = this.getProducts(ctx);

    const items = combo?.products ?? [];

    // Duplicate detection works regardless of whether we have catalog facts.
    const seen = new Set<string>();
    for (const p of items) {
      const id = p?.id;
      if (!id) continue;
      if (seen.has(id)) {
        violations.push(`duplicate_product:${id}`);
      }
      seen.add(id);
    }

    // Without hydrated catalog facts we can't verify existence/stock. Don't
    // invent a violation — only report the duplicates we found above. If there
    // are no facts AND no duplicates, the combo is valid.
    if (products.size === 0) {
      return { valid: violations.length === 0, violations };
    }

    for (const p of items) {
      const id = p?.id;
      if (!id) continue;
      const fact = products.get(id);
      if (!fact) {
        violations.push(`unknown_product:${id}`);
        continue;
      }
      // Stock: block only when we KNOW it's out everywhere. Unknown → allow.
      const stockState = comboStockState(fact);
      if (stockState === "out") {
        violations.push(`out_of_stock:${id}`);
      }
    }

    return { valid: violations.length === 0, violations };
  }

  /**
   * Validate a navigate handle.
   *  - exact match → valid
   *  - no exact match → try lowercase + slug normalization against catalog
   *  - still not found → valid:false
   * Empty catalog → valid:true (don't block navigation we can't verify).
   */
  validateNavigate(handle: string, ctx: BrainContext): { valid: boolean; correctedHandle?: string } {
    const products = this.getProducts(ctx);
    const raw = (handle ?? "").trim();
    if (!raw) return { valid: false };

    if (products.size === 0) {
      // Can't verify — allow it through. The storefront 404s if it's wrong;
      // we never produce a false negative here.
      return { valid: true };
    }

    // Build a handle index once.
    const byHandle = new Map<string, string>();      // exact handle → handle
    const byNormalized = new Map<string, string>();   // normalized → real handle
    for (const fact of products.values()) {
      if (!fact.handle) continue;
      byHandle.set(fact.handle, fact.handle);
      byNormalized.set(normalizeSlug(fact.handle), fact.handle);
    }

    // Exact match.
    if (byHandle.has(raw)) return { valid: true };

    // Lowercase + slug normalization.
    const norm = normalizeSlug(raw);
    const corrected = byNormalized.get(norm);
    if (corrected) {
      return { valid: true, correctedHandle: corrected };
    }

    return { valid: false };
  }

  /**
   * Validate a size recommendation for a product.
   *  - size must exist in the product's variants
   *  - returns the real available sizes from catalog data
   * Unknown product / empty catalog → valid:true with whatever sizes we have
   * (no false negatives — don't tell the shopper a real size is invalid just
   * because we didn't hydrate the product this turn).
   */
  validateSizeRecommendation(
    size: string,
    productId: string,
    ctx: BrainContext,
  ): { valid: boolean; availableSizes: string[] } {
    const products = this.getProducts(ctx);
    const fact = products.get(productId);

    if (!fact) {
      // Product not hydrated — can't verify. Don't block.
      return { valid: true, availableSizes: [] };
    }

    const availableSizes = fact.sizes ?? [];
    if (availableSizes.length === 0) {
      // Product carries no size data — can't verify. Don't block.
      return { valid: true, availableSizes: [] };
    }

    const wanted = (size ?? "").trim();
    const valid = availableSizes.some((s) => sizesEqual(s, wanted));
    return { valid, availableSizes };
  }

  /**
   * Sanitize an add-to-cart request before it fires.
   *  - product must exist
   *  - variant must exist (proxied via size presence — Brain context carries
   *    sizes, not raw variant ids; an empty variantId is treated as unverifiable)
   *  - size must exist on the product
   *  - the item must not already be in the cart at that variant
   * Empty catalog → safe:true (never block a sale we can't verify).
   */
  sanitizeCartRequest(
    productId: string,
    variantId: string,
    size: string,
    ctx: BrainContext,
  ): { safe: boolean; reason?: string } {
    const products = this.getProducts(ctx);

    // Already in cart at this variant? Block the duplicate add. We read the
    // cart facts from context (intentContext.cartHasItems is a coarse signal;
    // a precise cart-line map, if hydrated, lives in cache).
    if (variantId && cartContains(ctx, productId, variantId)) {
      return { safe: false, reason: "already_in_cart" };
    }

    if (products.size === 0) {
      // No catalog facts — can't verify existence/size. Allow; cart confirms truth.
      return { safe: true };
    }

    const fact = products.get(productId);
    if (!fact) {
      return { safe: false, reason: "product_not_found" };
    }

    // Size validation only when the product carries size data AND a size was
    // requested. A sizeless product (e.g. one-size accessory) passes.
    const wanted = (size ?? "").trim();
    if (wanted && (fact.sizes?.length ?? 0) > 0) {
      const sizeOk = fact.sizes.some((s) => sizesEqual(s, wanted));
      if (!sizeOk) return { safe: false, reason: "size_not_available" };
    }

    return { safe: true };
  }

  /**
   * Read live inventory for a product+size.
   *  - reads ctx product fact's stockBySize
   *  - null = unknown → NEVER block sale, treat as available
   * Returns inStock (boolean|null) + quantity (number|null).
   */
  checkInventory(
    productId: string,
    size: string,
    ctx: BrainContext,
  ): { inStock: boolean | null; quantity: number | null } {
    const products = this.getProducts(ctx);
    const fact = products.get(productId);

    if (!fact || !fact.stockBySize) {
      // Unknown — treat as available, quantity unknown.
      return { inStock: null, quantity: null };
    }

    const wanted = (size ?? "").trim();
    // Resolve the stock entry case-insensitively against the size labels.
    const entryKey = Object.keys(fact.stockBySize).find((k) => sizesEqual(k, wanted));
    if (entryKey === undefined) {
      // Size not present in the stock map = unknown for that size → available.
      return { inStock: null, quantity: null };
    }

    const qty = fact.stockBySize[entryKey];
    if (typeof qty !== "number") return { inStock: null, quantity: null };
    return { inStock: qty > 0, quantity: qty };
  }

  // ─── Catalog-fact accessor ───────────────────────────────────────────────
  //
  // Pulls whatever product facts the turn has hydrated. Tolerant of multiple
  // shapes so it works whether the Brain stashed an array, a map, or the
  // current PDP product. Always returns a Map<id, ProductFact>; empty when no
  // facts are available (→ every method degrades to "don't block").
  private getProducts(ctx: BrainContext): Map<string, ProductFact> {
    const out = new Map<string, ProductFact>();
    if (!ctx) return out;

    // 1) Explicitly stashed product list/map in the per-turn cache.
    const cached = ctx.cache?.get?.(CACHE_PRODUCTS_KEY);
    if (cached) {
      if (cached instanceof Map) {
        for (const [, v] of cached) addFact(out, v);
      } else if (Array.isArray(cached)) {
        for (const v of cached) addFact(out, v);
      }
    }

    // 2) The current PDP product, if hydrated. Always a valid fact.
    if (ctx.currentProduct) {
      const cp = ctx.currentProduct;
      out.set(cp.id, {
        id: cp.id,
        handle: cp.handle,
        sizes: cp.sizes ?? [],
        stockBySize: cp.stockBySize,
      });
    }

    return out;
  }
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

function addFact(out: Map<string, ProductFact>, v: unknown): void {
  if (!v || typeof v !== "object") return;
  const p = v as Partial<BrainProduct> & { stockBySize?: Record<string, number> };
  if (typeof p.id !== "string" || !p.id) return;
  out.set(p.id, {
    id: p.id,
    handle: typeof p.handle === "string" ? p.handle : "",
    sizes: Array.isArray(p.sizes) ? p.sizes.filter((s): s is string => typeof s === "string") : [],
    stockBySize: p.stockBySize && typeof p.stockBySize === "object" ? p.stockBySize : undefined,
  });
}

// Combo-level stock state for a product fact:
//   "out"     — every size is known 0 (block)
//   "in"      — at least one size known > 0 (allow)
//   "unknown" — no stock data (allow; never block on unknown)
function comboStockState(fact: ProductFact): "out" | "in" | "unknown" {
  const map = fact.stockBySize;
  if (!map) return "unknown";
  const values = Object.values(map);
  if (values.length === 0) return "unknown";
  const anyNumeric = values.some((q) => typeof q === "number");
  if (!anyNumeric) return "unknown";
  const anyInStock = values.some((q) => typeof q === "number" && q > 0);
  return anyInStock ? "in" : "out";
}

// Normalize a handle/slug: lowercase, trim, collapse non-alphanumerics to single
// hyphens, strip leading/trailing hyphens. "Linen Relaxed Shirt" → "linen-relaxed-shirt".
function normalizeSlug(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Case/space-insensitive size comparison ("m" === "M", " L " === "L").
function sizesEqual(a: string, b: string): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

// Cart-line lookup. The Brain may stash a precise cart-line set in cache under
// "rules:cartLines" as a Set of `${productId}:${variantId}` strings. Absent →
// we can't prove a duplicate, so we don't block.
function cartContains(ctx: BrainContext, productId: string, variantId: string): boolean {
  const lines = ctx.cache?.get?.("rules:cartLines");
  if (lines instanceof Set) {
    return lines.has(`${productId}:${variantId}`);
  }
  return false;
}
