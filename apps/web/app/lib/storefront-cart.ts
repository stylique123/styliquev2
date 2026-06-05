// REAL Shopify cart integration (P0 — replaces the fake "Add to bag" that only
// closed the panel). On a live Shopify storefront we resolve the variant ID for
// the chosen size from the theme's own product JSON (/products/<handle>.js) and
// POST it to /cart/add.js — the standard, theme-agnostic cart endpoint every
// Shopify store exposes. On the marketing demo (no Shopify runtime) we no-op as a
// simulated success so the demo keeps working. This makes conversion real without
// depending on the catalog migration: as soon as a handle exists on the store, it
// adds for real.

type CartResult = { ok: boolean; real: boolean; error?: string };

function onStorefront(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  // Real Shopify themes expose window.Shopify; our widget also sets __sqAssetBase
  // to the absolute origin only on the storefront build.
  return !!w.Shopify || !!w.__sqAssetBase;
}

// Pick the variant whose options/title match the requested size (case-insensitive),
// falling back to the first available variant.
function pickVariantId(product: { variants?: Array<{ id: number; title?: string; available?: boolean; options?: string[] }> }, size: string | null): number | null {
  const variants = product.variants ?? [];
  if (!variants.length) return null;
  if (size) {
    const want = size.toUpperCase();
    const bySize = variants.find((v) =>
      (v.options ?? []).some((o) => (o ?? "").toUpperCase() === want) ||
      (v.title ?? "").toUpperCase().split(" / ").includes(want) ||
      (v.title ?? "").toUpperCase() === want,
    );
    if (bySize) return bySize.id;
  }
  const firstAvail = variants.find((v) => v.available !== false) ?? variants[0];
  return firstAvail?.id ?? null;
}

async function resolveVariant(handle: string, size: string | null): Promise<number | null> {
  try {
    const res = await fetch(`/products/${handle}.js`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const product = await res.json();
    return pickVariantId(product, size);
  } catch {
    return null;
  }
}

/** Add ONE product (at a size) to the real Shopify cart. */
export async function addToCart(handle: string, size: string | null, quantity = 1): Promise<CartResult> {
  if (!onStorefront()) return { ok: true, real: false }; // demo — simulated success
  const variantId = await resolveVariant(handle, size);
  if (!variantId) return { ok: false, real: true, error: "variant_not_found" };
  try {
    const res = await fetch(`/cart/add.js`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ items: [{ id: variantId, quantity }] }),
    });
    return { ok: res.ok, real: true, error: res.ok ? undefined : `cart_${res.status}` };
  } catch {
    return { ok: false, real: true, error: "network" };
  }
}

/** Add a whole outfit (each piece at its own size) to the real Shopify cart in one call. */
export async function addOutfitToCart(pieces: Array<{ handle: string; size: string | null }>): Promise<CartResult> {
  if (!onStorefront()) return { ok: true, real: false };
  const ids = await Promise.all(pieces.map((p) => resolveVariant(p.handle, p.size)));
  const items = ids.map((id, i) => (id ? { id, quantity: 1 } : null)).filter(Boolean) as Array<{ id: number; quantity: number }>;
  if (!items.length) return { ok: false, real: true, error: "no_variants" };
  try {
    const res = await fetch(`/cart/add.js`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ items }),
    });
    return { ok: res.ok, real: true, error: res.ok ? undefined : `cart_${res.status}` };
  } catch {
    return { ok: false, real: true, error: "network" };
  }
}
