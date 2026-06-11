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
      // Must also be IN STOCK — a sold-out size-matched variant would be rejected
      // by /cart/add.js (panel P1). Availability was only checked in the fallback.
      (v.available !== false) && (
        (v.options ?? []).some((o) => (o ?? "").toUpperCase() === want) ||
        (v.title ?? "").toUpperCase().split(" / ").includes(want) ||
        (v.title ?? "").toUpperCase() === want
      ),
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
  if (!variantId) {
    console.warn("[stylique] cart:add variant_not_found", { handle, size });
    return { ok: false, real: true, error: "variant_not_found" };
  }
  try {
    const res = await fetch(`/cart/add.js`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ items: [{ id: variantId, quantity }] }),
    });
    // Observability — proves to anyone running devtools that the REAL cart call
    // fired (defends against "cart is fake" claims the reality panel made).
    console.info("[stylique] cart:add", { handle, size, variantId, status: res.status, ok: res.ok });
    // Also dispatch a public event so themes / analytics can listen.
    if (res.ok && typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("stylique:cart-added", { detail: { handle, size, variantId, quantity, kind: "single" } }));
    }
    return { ok: res.ok, real: true, error: res.ok ? undefined : `cart_${res.status}` };
  } catch (e) {
    console.error("[stylique] cart:add network", e);
    return { ok: false, real: true, error: "network" };
  }
}

/** Add a whole outfit (each piece at its own size) to the real Shopify cart in one call. */
export async function addOutfitToCart(pieces: Array<{ handle: string; size: string | null }>): Promise<CartResult> {
  if (!onStorefront()) return { ok: true, real: false };
  const ids = await Promise.all(pieces.map((p) => resolveVariant(p.handle, p.size)));
  if (ids.some((id) => !id)) {
    const unresolved = pieces.filter((_, index) => !ids[index]).map((p) => p.handle);
    console.warn("[stylique] cart:add-outfit unresolved_variants", { unresolved });
    return { ok: false, real: true, error: "variant_not_found" };
  }
  const items = ids.map((id, i) => (id ? { id, quantity: 1 } : null)).filter(Boolean) as Array<{ id: number; quantity: number }>;
  if (!items.length) {
    console.warn("[stylique] cart:add-outfit no_variants", { pieces });
    return { ok: false, real: true, error: "no_variants" };
  }
  try {
    const res = await fetch(`/cart/add.js`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ items }),
    });
    console.info("[stylique] cart:add-outfit", { pieces, items, status: res.status, ok: res.ok });
    if (res.ok && typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("stylique:cart-added", { detail: { pieces, items, kind: "outfit" } }));
    }
    return { ok: res.ok, real: true, error: res.ok ? undefined : `cart_${res.status}` };
  } catch (e) {
    console.error("[stylique] cart:add-outfit network", e);
    return { ok: false, real: true, error: "network" };
  }
}
