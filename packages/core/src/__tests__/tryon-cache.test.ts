import { describe, expect, it } from "vitest";
import { computeTryOnCacheKey } from "../tryon/cache.js";

const BASE = {
  shopId: "shop-1",
  productId: "product-1",
  mode: "BODY_MODEL" as const,
  modelHint: "slim",
  renderContextKey: "size-m|body-average",
};

describe("computeTryOnCacheKey", () => {
  it("is deterministic and returns the persisted key length", () => {
    const key = computeTryOnCacheKey(BASE);
    expect(key).toBe(computeTryOnCacheKey(BASE));
    expect(key).toHaveLength(40);
  });

  it("does not reuse a render for a different selected size", () => {
    expect(computeTryOnCacheKey(BASE)).not.toBe(computeTryOnCacheKey({
      ...BASE,
      renderContextKey: "size-l|body-average",
    }));
  });

  it("does not reuse a render for a different body profile", () => {
    expect(computeTryOnCacheKey(BASE)).not.toBe(computeTryOnCacheKey({
      ...BASE,
      renderContextKey: "size-m|body-curvy",
    }));
  });

  it("does not cache personal-photo renders", () => {
    expect(computeTryOnCacheKey({
      ...BASE,
      mode: "PERSONAL_PHOTO",
    })).toBeNull();
  });
});
