import { createHash } from "node:crypto";

export type TryOnCacheKeyInput = {
  shopId: string;
  productId: string;
  mode: "BODY_MODEL" | "PERSONAL_PHOTO";
  modelHint?: string | null;
  renderContextKey?: string | null;
};

/**
 * BODY_MODEL renders are reusable only when the tenant, product, model, and
 * fit/body context all match. Personal-photo renders contain shopper-specific
 * input and must never be cached.
 */
export function computeTryOnCacheKey(input: TryOnCacheKeyInput): string | null {
  if (input.mode === "PERSONAL_PHOTO") return null;

  return createHash("sha256")
    .update([
      input.shopId,
      input.productId,
      input.mode,
      input.modelHint ?? "default",
      input.renderContextKey ?? "default",
    ].join("|"))
    .digest("hex")
    .slice(0, 40);
}
