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
  // Used by the policy helpers (budget facts + sales policy ranking). Optional to
  // match the demo Product (number | undefined); the adapter maps it when present.
  keepRate?: number;
  // Fit notes surfaced into the prompt for the current PDP product. Optional.
  fitNotes?: string;
  // Used by the complete-the-look engine (formality + season inference). The demo
  // Product always carries it; the production adapter projects "" — so it is
  // required (formalityOf/seasonOf call .toLowerCase() on it).
  fabricComposition: string;
  // Used only inside a template literal by silhouetteOf — optional.
  description?: string;
  // In-stock sizes (the adapter projects these from inventoryQuantity /
  // availableForSale). Absent = unknown → treat as fully in stock (the demo).
  // Drives sold-out honesty so Mira never sells a size that isn't there.
  inStockSizes?: string[];
  // Image URLs (the adapter projects them). Absent/empty = NO photo — Mira must
  // not hero it or offer "see it on you", because the card would render blank.
  images?: string[];
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
    .map((p) => {
      // Stock: unknown inStockSizes → treat as fully available (demo). Mark
      // sold-out sizes / fully-out pieces so Mira sells only what's deliverable.
      const inStock = p.inStockSizes ?? p.sizes;
      const soldOut = p.sizes.filter((s) => !inStock.includes(s));
      const stockNote =
        inStock.length === 0
          ? "OUT OF STOCK"
          : soldOut.length
            ? `in stock: ${inStock.join(",")} (sold out: ${soldOut.join(",")})`
            : "in stock";
      // Photo: no image → the card renders blank, so Mira must not hero it.
      const photoNote = p.images && p.images.length ? "photo:yes" : "photo:NO";
      return `- ${p.handle} | ${p.name} | ${p.category}/${p.collection} | ${pfx}${p.priceUsd} | ${p.colors.join("/")} | sizes ${p.sizes.join(",")} | ${stockNote} | ${photoNote}`;
    })
    .join("\n");
}
