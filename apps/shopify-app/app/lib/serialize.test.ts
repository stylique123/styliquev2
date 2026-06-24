import { describe, expect, it } from "vitest";
import { toShopperProduct } from "./serialize";

describe("toShopperProduct image resolution", () => {
  it("uses the role-aware product image instead of first-position size-guide imagery", () => {
    const product = toShopperProduct({
      id: "prod_1",
      handle: "linen-shirt",
      title: "Linen Shirt",
      category: "top",
      primaryColor: "white",
      colorFamily: "white",
      primaryTryonImageId: null,
      tryonReady: true,
      widgetTier: 1,
      images: [
        {
          id: "img-size",
          url: "https://cdn.example/size-guide.jpg",
          position: 1,
          garmentRole: "DETAIL",
          qualityScore: 8,
          altText: "size guide measurements",
        },
        {
          id: "img-front",
          url: "https://cdn.example/front.jpg",
          preppedUrl: "https://cdn.example/front-prepped.png",
          position: 2,
          garmentRole: "FRONT",
          qualityScore: 6,
          altText: "front product photo",
        },
      ],
      variants: [{ size: "S" }, { size: "M" }],
    });

    expect(product.imageUrl).toBe("https://cdn.example/front.jpg");
    expect(product.tryonImageUrl).toBe("https://cdn.example/front-prepped.png");
  });

  it("keeps try-on image null when the product is not try-on ready", () => {
    const product = toShopperProduct({
      id: "prod_2",
      handle: "wool-coat",
      title: "Wool Coat",
      category: "outerwear",
      primaryColor: "black",
      colorFamily: "black",
      primaryTryonImageId: "img-front",
      tryonReady: false,
      widgetTier: 3,
      images: [
        { id: "img-front", url: "https://cdn.example/front.jpg", position: 1, garmentRole: "FRONT" },
      ],
      variants: [{ size: "M" }],
    });

    expect(product.imageUrl).toBe("https://cdn.example/front.jpg");
    expect(product.tryonImageUrl).toBeNull();
  });
});
