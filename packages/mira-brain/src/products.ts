// ─── Mira brain — product grounding ─────────────────────────────────────────
// The brain reads only these fields off a catalog product. Both callers (the
// demo's richer catalog Product, and the Shopify app's Prisma→adapter shape) are
// structural supersets, so they pass directly as MiraProduct[]. Extracted
// verbatim from apps/web/app/api/mira/route.ts (validateHandle, catalogDigest).

import { currencyPrefix } from "./constants.js";

export interface MiraProduct {
  handle: string;
  name: string;
  category: string;
  collection: string;
  priceUsd: number;
  colors: string[];
  sizes: string[];
}

// Strip hallucinated handles before they reach the client: any productHandle the
// model returns is checked against the live catalog. If it doesn't exist we drop
// it so applyDecision falls back to a hero pick instead of routing to a dead
// page. This is the hard grounding guarantee.
export function validateHandle(handle: string | undefined, activeCatalog: MiraProduct[]): string | undefined {
  if (!handle) return undefined;
  return activeCatalog.some((p) => p.handle === handle) ? handle : undefined;
}

// Compact catalog digest the model grounds on. Prefixes the real currency symbol
// so a PKR/INR/JPY store presents correct amounts (no fictitious `$`).
export function catalogDigest(activeCatalog: MiraProduct[], currencyCode?: string): string {
  const pfx = currencyPrefix(currencyCode);
  return activeCatalog
    .map(
      (p) =>
        `- ${p.handle} | ${p.name} | ${p.category}/${p.collection} | ${pfx}${p.priceUsd} | ${p.colors.join("/")} | sizes ${p.sizes.join(",")}`,
    )
    .join("\n");
}
