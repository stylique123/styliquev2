// REAL Shopify cart integration (P0 — replaces the fake "Add to bag" that only
// closed the panel). On a live Shopify storefront we resolve the variant ID for
// the chosen size from the theme's own product JSON (/products/<handle>.js) and
// POST it to /cart/add.js — the standard, theme-agnostic cart endpoint every
// Shopify store exposes. On the marketing demo (no Shopify runtime) we no-op as a
// simulated success so the demo keeps working. This makes conversion real without
// depending on the catalog migration: as soon as a handle exists on the store, it
// adds for real.

type CartResult = { ok: boolean; real: boolean; error?: string };
type VariantResolution =
  | { ok: true; variantId: number }
  | { ok: false; error: "variant_not_found" | "requested_size_unavailable" };

function onStorefront(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  // Real Shopify themes expose window.Shopify; our widget also sets __sqAssetBase
  // to the absolute origin only on the storefront build.
  return !!w.Shopify || !!w.__sqAssetBase;
}

function normalizeSizeToken(value: string): string {
  const token = value.trim().toUpperCase().replace(/\s+/g, " ");
  const compact = token.replace(/[^A-Z0-9]/g, "");
  const aliases: Record<string, string> = {
    EXTRASMALL: "XS",
    XSMALL: "XS",
    SMALL: "S",
    MEDIUM: "M",
    LARGE: "L",
    EXTRALARGE: "XL",
    XLARGE: "XL",
    EXTRAEXTRALARGE: "XXL",
    XXLARGE: "XXL",
    TWENTYFOUR: "24",
    TWENTYFIVE: "25",
    TWENTYSIX: "26",
    TWENTYSEVEN: "27",
    TWENTYEIGHT: "28",
    TWENTYNINE: "29",
    THIRTY: "30",
    ONESIZE: "OS",
    OSFA: "OS",
    OS: "OS",
    DEFAULTTITLE: "DEFAULT",
  };
  return aliases[compact] ?? compact;
}

function variantSizeTokens(v: { title?: string; options?: string[] }): string[] {
  const raw = [
    ...(v.options ?? []),
    ...(v.title ?? "").split(" / "),
    v.title ?? "",
  ];
  return raw
    .map((part) => normalizeSizeToken(part ?? ""))
    .filter(Boolean);
}

function isDefaultSingleVariant(v: { title?: string; options?: string[] }): boolean {
  const tokens = variantSizeTokens(v);
  return tokens.length === 0 || tokens.every((token) => token === "DEFAULT");
}

function sizeMatches(v: { title?: string; options?: string[] }, size: string): boolean {
  const want = normalizeSizeToken(size);
  return variantSizeTokens(v).includes(want);
}

// Pick the variant whose options/title match the requested size. If a shopper
// asked for a specific sold-out size, fail honestly instead of silently adding a
// different size. Only fall back to first available when no size was requested.
function pickVariant(product: { variants?: Array<{ id: number; title?: string; available?: boolean; options?: string[] }> }, size: string | null): VariantResolution {
  const variants = product.variants ?? [];
  if (!variants.length) return { ok: false, error: "variant_not_found" };
  if (size) {
    const matching = variants.filter((v) => sizeMatches(v, size));
    const availableMatch = matching.find((v) => v.available !== false);
    if (availableMatch) return { ok: true, variantId: availableMatch.id };
    if (matching.length > 0) return { ok: false, error: "requested_size_unavailable" };
    const onlyVariant = variants.length === 1 ? variants[0] : null;
    if (onlyVariant && onlyVariant.available !== false && isDefaultSingleVariant(onlyVariant)) {
      return { ok: true, variantId: onlyVariant.id };
    }
    return { ok: false, error: "variant_not_found" };
  }
  const firstAvail = variants.find((v) => v.available !== false);
  return firstAvail ? { ok: true, variantId: firstAvail.id } : { ok: false, error: "variant_not_found" };
}

async function resolveVariant(handle: string, size: string | null): Promise<VariantResolution> {
  try {
    const res = await fetch(`/products/${handle}.js`, { headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, error: "variant_not_found" };
    const product = await res.json();
    return pickVariant(product, size);
  } catch {
    return { ok: false, error: "variant_not_found" };
  }
}

/** Add ONE product (at a size) to the real Shopify cart. */
export async function addToCart(handle: string, size: string | null, quantity = 1): Promise<CartResult> {
  if (!onStorefront()) return { ok: true, real: false }; // demo — simulated success
  const variant = await resolveVariant(handle, size);
  if (!variant.ok) {
    console.warn("[stylique] cart:add variant_unavailable", { handle, size, error: variant.error });
    return { ok: false, real: true, error: variant.error };
  }
  try {
    const res = await fetch(`/cart/add.js`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ items: [{ id: variant.variantId, quantity }] }),
    });
    // Observability — proves to anyone running devtools that the REAL cart call
    // fired (defends against "cart is fake" claims the reality panel made).
    console.info("[stylique] cart:add", { handle, size, variantId: variant.variantId, status: res.status, ok: res.ok });
    // Also dispatch a public event so themes / analytics can listen.
    if (res.ok && typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("stylique:cart-added", { detail: { handle, size, variantId: variant.variantId, quantity, kind: "single" } }));
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
  const variants = await Promise.all(pieces.map((p) => resolveVariant(p.handle, p.size)));
  const firstFailure = variants.find((variant) => !variant.ok) as Extract<VariantResolution, { ok: false }> | undefined;
  if (firstFailure) {
    const unresolved = pieces.filter((_, index) => !variants[index].ok).map((p) => p.handle);
    console.warn("[stylique] cart:add-outfit unresolved_variants", { unresolved, error: firstFailure.error });
    return { ok: false, real: true, error: firstFailure.error };
  }
  const items = variants
    .filter((variant): variant is Extract<VariantResolution, { ok: true }> => variant.ok)
    .map((variant) => ({ id: variant.variantId, quantity: 1 }));
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
