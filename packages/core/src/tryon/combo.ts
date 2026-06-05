// Multi-garment VTO chain (D40) — render a full outfit by feeding each
// step's output back in as the next step's "person" image.
//
// Why sequential and not parallel:
//   • VTO-001 + IDM-VTON + CatVTON all accept ONE garment per call.
//   • Compositing N garments digitally first (then one VTO call) loses
//     per-garment fidelity — logos and prints get blurred.
//   • Sequential preserves each garment's pixels and ends with one
//     coherent render.
//
// Cost: N renders per combo. Lazy-cached forever via the same
// TryOnSession.cacheKey machinery — see D34. First shopper pays N ×
// $0.012 (CatVTON) or N × $0.04 (Vertex). Every shopper after = $0.
//
// Progress: callers can pass an onProgress callback to stream "1 of 3 done"
// to the widget for the combo-tryon progress bar.

import { createHash } from "node:crypto";
import type {
  TryOnProvider,
  TryOnRenderOutput,
  TryOnProductHints,
} from "./service.js";

export type ComboGarment = {
  productId: string;
  imageUrl: string;       // garment image (URL or data: URL)
  imageMime?: string;
  // Order matters — lowest-layer to highest-layer:
  //   1. base layer (slip / underlayer)
  //   2. mid layer (shirt / dress)
  //   3. outer layer (jacket / coat)
  //   4. accessory (bag / shoes — last)
  // Caller is responsible for ordering before passing in. Out-of-order
  // renders produce a visually wrong stack (jacket under shirt etc.).
  layerOrder: number;
  sizeHint?: string;      // "S" | "M" | "L" — currently informational
  hints?: TryOnProductHints;
};

export type ComboChainInput = {
  shopId: string;
  museId: string;                       // BODY_MODEL only — required for cache key
  museImageUrl: string;                 // starting "person" image
  museImageMime?: string;
  garments: ComboGarment[];             // pre-sorted by layerOrder
  onProgress?: (step: number, total: number) => void;
};

export type ComboChainOutput = {
  finalImage: TryOnRenderOutput;        // the last step's result
  intermediates: TryOnRenderOutput[];   // one entry per garment (for debugging / per-step caching)
  steps: number;                         // garments rendered
  // Stable hash of the chain — used as the cache key for the WHOLE
  // combo (vs the per-step keys the TryOnSession layer uses for each
  // intermediate render).
  comboCacheKey: string;
};

// ─── Cache key — hash of the full product chain ───────────────────────
// Format: sha256(shopId + museId + sortedLayerOrder + productIds.join("|") + sizeHints.join("|"))
// Stable: deterministic for the same inputs across processes.
export function computeComboCacheKey(input: {
  shopId: string;
  museId: string;
  garments: Array<{ productId: string; layerOrder: number; sizeHint?: string }>;
}): string {
  const ordered = [...input.garments].sort((a, b) => a.layerOrder - b.layerOrder);
  const productChain = ordered.map((g) => g.productId).join("|");
  const sizeChain = ordered.map((g) => g.sizeHint ?? "").join("|");
  const layerChain = ordered.map((g) => g.layerOrder.toString()).join("|");
  const seed = `${input.shopId}::${input.museId}::${layerChain}::${productChain}::${sizeChain}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

// ─── The chain runner ─────────────────────────────────────────────────

export async function renderComboChain(
  provider: TryOnProvider,
  input: ComboChainInput,
): Promise<ComboChainOutput> {
  if (input.garments.length === 0) {
    throw new Error("combo_chain_empty");
  }

  // Defensive sort — caller SHOULD have sorted but a wrong-order chain
  // produces a visually broken render (e.g. jacket under shirt), so we
  // enforce here too. Sort is stable on layerOrder.
  const garments = [...input.garments].sort((a, b) => a.layerOrder - b.layerOrder);

  const intermediates: TryOnRenderOutput[] = [];
  let currentPersonUrl = input.museImageUrl;
  let currentPersonMime = input.museImageMime ?? "image/png";

  for (let i = 0; i < garments.length; i++) {
    const g = garments[i]!;
    input.onProgress?.(i + 1, garments.length);

    // Each step: render the current garment onto the running person image.
    // PERSONAL_PHOTO mode is the right mode for every step beyond the first —
    // we ARE feeding a real person image (the prior step's output) and need
    // the provider to preserve face/body across the chain.
    const isFirst = i === 0;
    const out = await provider.render({
      mode: isFirst ? "BODY_MODEL" : "PERSONAL_PHOTO",
      garmentImageUrl: g.imageUrl,
      garmentMime: g.imageMime,
      modelHint: isFirst ? input.museId : undefined,
      personImageBase64: isFirst ? undefined : currentPersonUrl,
      personImageMime: isFirst ? undefined : currentPersonMime,
      hints: g.hints,
    });
    intermediates.push(out);
    currentPersonUrl = out.imageUrl;
    currentPersonMime = out.mime;
  }

  return {
    finalImage: intermediates[intermediates.length - 1]!,
    intermediates,
    steps: garments.length,
    comboCacheKey: computeComboCacheKey({
      shopId: input.shopId,
      museId: input.museId,
      garments,
    }),
  };
}
