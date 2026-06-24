import { describe, expect, it } from "vitest";
import { decisionToAdapter, type AdaptedProduct } from "./mira-adapter.server";

const CATALOG: AdaptedProduct[] = [
  {
    id: "prod-dress",
    handle: "silk-dress",
    name: "Silk Dress",
    category: "dress",
    priceUsd: 180,
    image: "https://cdn.example/dress.jpg",
    sizes: ["S", "M", "L"],
    colors: ["black"],
  },
  {
    id: "prod-coat",
    handle: "wool-coat",
    name: "Wool Coat",
    category: "outerwear",
    priceUsd: 240,
    image: "https://cdn.example/coat.jpg",
    sizes: ["M", "L"],
    colors: ["camel"],
  },
  {
    id: "prod-shoe",
    handle: "evening-heel",
    name: "Evening Heel",
    category: "footwear",
    priceUsd: 95,
    image: "https://cdn.example/heel.jpg",
    sizes: ["38", "39"],
    colors: ["black"],
  },
];

describe("decisionToAdapter tenant grounding", () => {
  it("hydrates product routes with the exact tenant product and price", () => {
    const result = decisionToAdapter(
      {
        voice: "This is the one.",
        route: "reco_handle",
        productHandle: "silk-dress",
        quickReplies: [],
        intent: "recommend",
      },
      "fallback",
      CATALOG,
    );

    expect(result.decision.productHandle).toBe("silk-dress");
    expect(result.products).toEqual([CATALOG[0]]);
    expect(result.products[0]?.priceUsd).toBe(180);
  });

  it("downgrades a hallucinated product handle instead of rendering a fake card", () => {
    const result = decisionToAdapter(
      {
        voice: "Try the imaginary dress.",
        route: "reco_handle",
        productHandle: "imaginary-dress",
        quickReplies: [],
        intent: "recommend",
      },
      "fallback",
      CATALOG,
    );

    expect(result.decision.route).toBe("talk_only");
    expect(result.decision.productHandle).toBeNull();
    expect(result.products).toEqual([]);
  });

  it("grounds a product-aware Try-On turn from current PDP context", () => {
    const result = decisionToAdapter(
      {
        voice: "Let's try it on.",
        route: "try_on",
        quickReplies: [],
        intent: "try_on",
      },
      "fallback",
      CATALOG,
      { currentProductHandle: "silk-dress" },
    );

    expect(result.decision.productHandle).toBe("silk-dress");
    expect(result.products[0]?.id).toBe("prod-dress");
  });

  it("builds looks only from the supplied tenant catalog", () => {
    const result = decisionToAdapter(
      {
        voice: "Here is the full look.",
        route: "look",
        productHandle: "silk-dress",
        quickReplies: [],
        intent: "outfit",
      },
      "fallback",
      CATALOG,
      { shopperQuery: "evening dinner" },
    );

    expect(result.look?.pieces.map((p) => p.handle)).toEqual([
      "silk-dress",
      "wool-coat",
      "evening-heel",
    ]);
    expect(result.products.every((p) => CATALOG.includes(p))).toBe(true);
  });

  it("builds styled looks from merchant product-type aliases without exact category strings", () => {
    const aliasCatalog: AdaptedProduct[] = [
      {
        id: "prod-blouse",
        handle: "embroidered-blouse",
        name: "Embroidered Blouse",
        category: "Blouses",
        priceUsd: 120,
        image: "https://cdn.example/blouse.jpg",
        sizes: ["S", "M"],
        colors: ["cream"],
      },
      {
        id: "prod-pants",
        handle: "wide-pants",
        name: "Wide Pants",
        category: "Pants",
        priceUsd: 130,
        image: "https://cdn.example/pants.jpg",
        sizes: ["S", "M"],
        colors: ["black"],
      },
      {
        id: "prod-heels",
        handle: "gold-heels",
        name: "Gold Heels",
        category: "Heels",
        priceUsd: 95,
        image: "https://cdn.example/heels.jpg",
        sizes: ["38", "39"],
        colors: ["gold"],
      },
      {
        id: "prod-bag",
        handle: "satin-clutch",
        name: "Satin Clutch Bag",
        category: "Bags",
        priceUsd: 80,
        image: "https://cdn.example/bag.jpg",
        sizes: [],
        colors: ["white"],
      },
    ];

    const result = decisionToAdapter(
      {
        voice: "Here is the full look.",
        route: "look",
        productHandle: "embroidered-blouse",
        quickReplies: [],
        intent: "outfit",
      },
      "fallback",
      aliasCatalog,
      { shopperQuery: "dinner look" },
    );

    expect(result.look?.pieces.map((p) => p.handle)).toEqual([
      "embroidered-blouse",
      "wide-pants",
      "gold-heels",
    ]);
  });
});
