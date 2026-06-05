import { describe, it, expect, vi } from "vitest";
import {
  renderComboChain,
  computeComboCacheKey,
  type ComboChainInput,
  type ComboGarment,
} from "../tryon/combo.js";
import type { TryOnProvider, TryOnRenderInput, TryOnRenderOutput } from "../tryon/service.js";

// ─── Mock provider factory ─────────────────────────────────────────────────
function makeMockProvider(imageUrl = "data:image/png;base64,FAKE"): TryOnProvider & {
  calls: TryOnRenderInput[];
} {
  const calls: TryOnRenderInput[] = [];
  return {
    key: "mock",
    model: "mock-v1",
    modelKey: "mock:mock-v1:v1",
    calls,
    async render(input: TryOnRenderInput): Promise<TryOnRenderOutput> {
      calls.push(input);
      return { imageUrl, mime: "image/png" };
    },
  };
}

const BASE_GARMENT: Omit<ComboGarment, "layerOrder"> = {
  productId: "prod-1",
  imageUrl: "https://example.com/garment.jpg",
};

describe("computeComboCacheKey", () => {
  it("returns a 32-char hex string", () => {
    const key = computeComboCacheKey({
      shopId: "shop-1",
      museId: "ava",
      garments: [{ productId: "p1", layerOrder: 1 }],
    });
    expect(key).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(key)).toBe(true);
  });

  it("is deterministic for the same inputs", () => {
    const opts = {
      shopId: "shop-1",
      museId: "lina",
      garments: [
        { productId: "p1", layerOrder: 1, sizeHint: "M" },
        { productId: "p2", layerOrder: 2, sizeHint: "S" },
      ],
    };
    expect(computeComboCacheKey(opts)).toBe(computeComboCacheKey(opts));
  });

  it("differs when shopId changes", () => {
    const base = { shopId: "shop-1", museId: "ava", garments: [{ productId: "p1", layerOrder: 1 }] };
    const other = { ...base, shopId: "shop-2" };
    expect(computeComboCacheKey(base)).not.toBe(computeComboCacheKey(other));
  });

  it("differs when museId changes", () => {
    const base = { shopId: "shop-1", museId: "ava", garments: [{ productId: "p1", layerOrder: 1 }] };
    const other = { ...base, museId: "noor" };
    expect(computeComboCacheKey(base)).not.toBe(computeComboCacheKey(other));
  });

  it("differs when product order changes", () => {
    const a = {
      shopId: "shop-1", museId: "ava",
      garments: [
        { productId: "p1", layerOrder: 1 },
        { productId: "p2", layerOrder: 2 },
      ],
    };
    const b = {
      shopId: "shop-1", museId: "ava",
      garments: [
        { productId: "p2", layerOrder: 1 },
        { productId: "p1", layerOrder: 2 },
      ],
    };
    expect(computeComboCacheKey(a)).not.toBe(computeComboCacheKey(b));
  });

  it("is stable regardless of input array order (sorts by layerOrder)", () => {
    const sorted = {
      shopId: "shop-1", museId: "ava",
      garments: [
        { productId: "p1", layerOrder: 1 },
        { productId: "p2", layerOrder: 2 },
      ],
    };
    const unsorted = {
      shopId: "shop-1", museId: "ava",
      garments: [
        { productId: "p2", layerOrder: 2 },
        { productId: "p1", layerOrder: 1 },
      ],
    };
    expect(computeComboCacheKey(sorted)).toBe(computeComboCacheKey(unsorted));
  });

  it("differs when sizeHint changes", () => {
    const base = { shopId: "s", museId: "ava", garments: [{ productId: "p1", layerOrder: 1, sizeHint: "M" }] };
    const other = { ...base, garments: [{ productId: "p1", layerOrder: 1, sizeHint: "L" }] };
    expect(computeComboCacheKey(base)).not.toBe(computeComboCacheKey(other));
  });
});

describe("renderComboChain — empty garments", () => {
  it("throws combo_chain_empty error", async () => {
    const provider = makeMockProvider();
    const input: ComboChainInput = {
      shopId: "shop-1",
      museId: "ava",
      museImageUrl: "https://example.com/muse.jpg",
      garments: [],
    };
    await expect(renderComboChain(provider, input)).rejects.toThrow("combo_chain_empty");
  });
});

describe("renderComboChain — single garment", () => {
  it("calls provider once and returns finalImage + intermediates[0]", async () => {
    const provider = makeMockProvider("data:image/png;base64,RESULT1");
    const input: ComboChainInput = {
      shopId: "shop-1",
      museId: "lina",
      museImageUrl: "https://example.com/muse.jpg",
      garments: [{ ...BASE_GARMENT, productId: "p1", layerOrder: 1 }],
    };
    const out = await renderComboChain(provider, input);
    expect(out.steps).toBe(1);
    expect(out.intermediates).toHaveLength(1);
    expect(out.finalImage.imageUrl).toBe("data:image/png;base64,RESULT1");
    expect(out.finalImage).toBe(out.intermediates[0]);
    expect(provider.calls).toHaveLength(1);
  });

  it("first step uses BODY_MODEL mode with museId as modelHint", async () => {
    const provider = makeMockProvider();
    const input: ComboChainInput = {
      shopId: "shop-1",
      museId: "noor",
      museImageUrl: "https://example.com/muse.jpg",
      garments: [{ ...BASE_GARMENT, productId: "p1", layerOrder: 1 }],
    };
    await renderComboChain(provider, input);
    expect(provider.calls[0]!.mode).toBe("BODY_MODEL");
    expect(provider.calls[0]!.modelHint).toBe("noor");
    expect(provider.calls[0]!.personImageBase64).toBeUndefined();
  });

  it("includes comboCacheKey in output", async () => {
    const provider = makeMockProvider();
    const input: ComboChainInput = {
      shopId: "shop-1",
      museId: "ava",
      museImageUrl: "https://example.com/muse.jpg",
      garments: [{ ...BASE_GARMENT, productId: "p1", layerOrder: 1 }],
    };
    const out = await renderComboChain(provider, input);
    expect(out.comboCacheKey).toHaveLength(32);
  });
});

describe("renderComboChain — multi-garment chain", () => {
  it("calls provider N times for N garments", async () => {
    const provider = makeMockProvider();
    const input: ComboChainInput = {
      shopId: "shop-1",
      museId: "ava",
      museImageUrl: "https://example.com/muse.jpg",
      garments: [
        { productId: "p1", imageUrl: "https://cdn.example/g1.jpg", layerOrder: 1 },
        { productId: "p2", imageUrl: "https://cdn.example/g2.jpg", layerOrder: 2 },
        { productId: "p3", imageUrl: "https://cdn.example/g3.jpg", layerOrder: 3 },
      ],
    };
    const out = await renderComboChain(provider, input);
    expect(out.steps).toBe(3);
    expect(out.intermediates).toHaveLength(3);
    expect(provider.calls).toHaveLength(3);
  });

  it("subsequent steps use PERSONAL_PHOTO mode with prior step's output", async () => {
    let callCount = 0;
    const outputs = [
      "data:image/png;base64,STEP1",
      "data:image/png;base64,STEP2",
    ];
    const provider: TryOnProvider = {
      key: "mock",
      model: "mock-v1",
      modelKey: "mock:mock-v1",
      async render(_input) {
        const url = outputs[callCount++]!;
        return { imageUrl: url, mime: "image/png" };
      },
    };

    const input: ComboChainInput = {
      shopId: "shop-1",
      museId: "ava",
      museImageUrl: "https://example.com/muse.jpg",
      garments: [
        { productId: "p1", imageUrl: "https://cdn.example/g1.jpg", layerOrder: 1 },
        { productId: "p2", imageUrl: "https://cdn.example/g2.jpg", layerOrder: 2 },
      ],
    };
    const out = await renderComboChain(provider, input);
    expect(out.finalImage.imageUrl).toBe("data:image/png;base64,STEP2");
    expect(out.intermediates[0]!.imageUrl).toBe("data:image/png;base64,STEP1");
  });

  it("second step uses previous step output as personImageBase64", async () => {
    const calls: TryOnRenderInput[] = [];
    const provider: TryOnProvider = {
      key: "mock",
      model: "mock-v1",
      modelKey: "mock:mock-v1",
      async render(input) {
        calls.push(input);
        return { imageUrl: "data:image/png;base64,OUT", mime: "image/png" };
      },
    };

    const input: ComboChainInput = {
      shopId: "shop-1",
      museId: "ava",
      museImageUrl: "https://example.com/muse.jpg",
      garments: [
        { productId: "p1", imageUrl: "https://cdn.example/g1.jpg", layerOrder: 1 },
        { productId: "p2", imageUrl: "https://cdn.example/g2.jpg", layerOrder: 2 },
      ],
    };
    await renderComboChain(provider, input);

    expect(calls[1]!.mode).toBe("PERSONAL_PHOTO");
    // The second step's personImageBase64 is the output from the first step
    expect(calls[1]!.personImageBase64).toBe("data:image/png;base64,OUT");
    expect(calls[1]!.modelHint).toBeUndefined();
  });

  it("sorts garments by layerOrder before rendering", async () => {
    const calls: TryOnRenderInput[] = [];
    const provider: TryOnProvider = {
      key: "mock",
      model: "mock-v1",
      modelKey: "mock:mock-v1",
      async render(input) {
        calls.push(input);
        return { imageUrl: "data:image/png;base64,OUT", mime: "image/png" };
      },
    };

    // Pass in reversed order
    const input: ComboChainInput = {
      shopId: "shop-1",
      museId: "ava",
      museImageUrl: "https://example.com/muse.jpg",
      garments: [
        { productId: "p3", imageUrl: "https://cdn.example/g3.jpg", layerOrder: 3 },
        { productId: "p1", imageUrl: "https://cdn.example/g1.jpg", layerOrder: 1 },
        { productId: "p2", imageUrl: "https://cdn.example/g2.jpg", layerOrder: 2 },
      ],
    };
    await renderComboChain(provider, input);

    // First garment rendered should be layerOrder 1
    expect(calls[0]!.garmentImageUrl).toBe("https://cdn.example/g1.jpg");
    expect(calls[1]!.garmentImageUrl).toBe("https://cdn.example/g2.jpg");
    expect(calls[2]!.garmentImageUrl).toBe("https://cdn.example/g3.jpg");
  });
});

describe("renderComboChain — progress callback", () => {
  it("calls onProgress for each step", async () => {
    const provider = makeMockProvider();
    const progressCalls: Array<[number, number]> = [];

    const input: ComboChainInput = {
      shopId: "shop-1",
      museId: "ava",
      museImageUrl: "https://example.com/muse.jpg",
      garments: [
        { productId: "p1", imageUrl: "https://cdn.example/g1.jpg", layerOrder: 1 },
        { productId: "p2", imageUrl: "https://cdn.example/g2.jpg", layerOrder: 2 },
      ],
      onProgress(step, total) {
        progressCalls.push([step, total]);
      },
    };
    await renderComboChain(provider, input);

    expect(progressCalls).toEqual([[1, 2], [2, 2]]);
  });
});

describe("renderComboChain — cacheKey consistency", () => {
  it("cacheKey matches computeComboCacheKey for the same inputs", async () => {
    const provider = makeMockProvider();
    const garments: ComboGarment[] = [
      { productId: "p1", imageUrl: "https://cdn.example/g1.jpg", layerOrder: 1, sizeHint: "M" },
      { productId: "p2", imageUrl: "https://cdn.example/g2.jpg", layerOrder: 2 },
    ];
    const input: ComboChainInput = {
      shopId: "shop-x",
      museId: "maya",
      museImageUrl: "https://example.com/muse.jpg",
      garments,
    };
    const out = await renderComboChain(provider, input);
    const expected = computeComboCacheKey({ shopId: "shop-x", museId: "maya", garments });
    expect(out.comboCacheKey).toBe(expected);
  });
});
