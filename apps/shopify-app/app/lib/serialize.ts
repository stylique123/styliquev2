// Pure shopper-safe serializer. No Prisma, no env. Tested in isolation so we can
// guarantee that no token or internal id is ever returned by the public API.

export type ShopperProduct = {
  id: string;
  handle: string;
  title: string;
  category: string | null;
  primaryColor: string | null;
  colorFamily: string | null;
  imageUrl: string | null;
  sizes: string[];
  // D37 — image-quality pipeline outputs surfaced to the widget so it can
  // branch UX by tier. Per Phase 1 §2.5: 1=full try-on, 2=carousel,
  // 3=skip visual try-on entirely (size + styling only, graceful degrade).
  // `tryonImageUrl` is the chosen primary garment photo (NULL when
  // tryonReady=false). Defaults preserve pre-D37 behavior.
  tryonReady: boolean;
  widgetTier: 1 | 2 | 3;
  tryonImageUrl: string | null;
};

export function toShopperProduct(p: {
  id: string; handle: string; title: string; category: string | null;
  primaryColor: string | null; colorFamily: string | null;
  images: Array<{ id?: string; url: string }>;
  variants: Array<{ size: string | null }>;
  primaryTryonImageId?: string | null;
  tryonReady?: boolean;
  widgetTier?: number | null;
}): ShopperProduct {
  const sizes = Array.from(
    new Set(p.variants.map((v) => v.size).filter((s): s is string => Boolean(s))),
  );
  const tryonImageUrl =
    (p.primaryTryonImageId && p.images.find((img) => img.id === p.primaryTryonImageId)?.url) ||
    null;
  const tier: 1 | 2 | 3 =
    p.widgetTier === 2 ? 2 :
    p.widgetTier === 3 ? 3 :
    1;
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    category: p.category,
    primaryColor: p.primaryColor,
    colorFamily: p.colorFamily,
    imageUrl: p.images[0]?.url ?? null,
    sizes,
    tryonReady: Boolean(p.tryonReady),
    widgetTier: tier,
    tryonImageUrl,
  };
}
