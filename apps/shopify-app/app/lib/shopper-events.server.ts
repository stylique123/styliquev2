// Shopper event handlers — analytics events, social proof, combo feedback.
// Exported from this module and re-exported via shopper.server.ts barrel.
//
// Exports: postEvent, getSocialProof (getShopperSocialProof), postComboFeedback

import { z } from "zod";
import { prisma } from "../db.server";
import { EventNameSchema, safeParseEventPayload } from "@stylique/types";
import { type ApiResponse } from "./shopper-types.server";
import { shopIdFromDomain, rateOk, analytics } from "./shopper-helpers.server";
import { getOrCreateShopperSession } from "./session.server";

// ─── POST /api/events ─────────────────────────────────────────────────────────

const EventSchema = z.object({
  name: EventNameSchema,
  productId: z.string().optional(),
  payload: z.unknown(),
}).strict();

// Events a STOREFRONT CLIENT is allowed to POST via /api/events. Without this
// gate, EventNameSchema accepts the FULL enum, so a malicious shopper could POST
// server-authoritative events (CART_CONFIRMED from the orders webhook, etc.) and
// inflate the merchant's purchase / revenue / repeat-rate metrics. This is the
// EXHAUSTIVE set of names the client actually emits (TryOnPanel + mira-demo).
// New client events MUST be added here — server-emitted events never belong.
const CLIENT_POSTABLE_EVENTS: ReadonlySet<string> = new Set([
  "PDP_TRYON_CLICKED",
  "TRYON_ABANDONED",
  "CART_FROM_TRYON",
  "WIDGET_PLACEMENT_AUDIT",
]);

export async function postEvent(args: { shopDomain: string; body: unknown; shopperCookieId?: string | null }): Promise<ApiResponse<{ accepted: true }>> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const parsed = EventSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  // Reject server-authoritative event names a client must never be able to forge
  // (CART_CONFIRMED etc.) — only the storefront-emitted set is accepted here.
  if (!CLIENT_POSTABLE_EVENTS.has(parsed.data.name)) return { ok: false, error: "unauthorized" };
  const payload = safeParseEventPayload(parsed.data.name, parsed.data.payload);
  if (!payload.success) return { ok: false, error: "invalid_payload" };

  try {
    const session = args.shopperCookieId
      ? await getOrCreateShopperSession({
          shopifyDomain: args.shopDomain,
          cookieId: args.shopperCookieId,
        })
      : null;
    await analytics.track({
      shopId,
      shopperId: session?.row.id,
      name: parsed.data.name,
      productId: parsed.data.productId,
      payload: payload.data,
    });
  } catch {
    return { ok: false, error: "invalid_payload" };
  }
  return { ok: true, data: { accepted: true } };
}

// ─── GET /api/shopper/social-proof ────────────────────────────────────────────
// Honest social proof: we display the count of distinct shoppers who opened
// the Stylist this past week — across the whole Stylique network, not just
// this shop. No inflation; no fake numbers. We hide the chip entirely when
// the count is below 50 so it never looks pathetic.

export async function getSocialProof(args: {
  shopDomain: string;
  shopperCookieId?: string | null;
}): Promise<ApiResponse<{ count: number; label: string | null }>> {
  // §3.5 invariant #2 — rate-limit on BOTH shop AND shopper cookie. Drop-in
  // fix for the last B1 audit hit (Sprint 6 audit). The previous shop-only
  // gate let a single noisy shopper degrade SLA for the whole shop on this
  // endpoint.
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const since = new Date(Date.now() - 7 * 86_400_000);

  // Distinct shoppers who fired CHAT_OPENED in the last 7 days, network-wide.
  // groupBy on shopperId, then count.
  const rows = await prisma.analyticsEvent.findMany({
    where: { name: "CHAT_OPENED", createdAt: { gte: since }, shopperId: { not: null } },
    select: { shopperId: true },
    distinct: ["shopperId"],
    take: 5000,
  });
  const count = rows.length;

  if (count < 50) {
    // Don't display the chip until it would feel real.
    return { ok: true, data: { count, label: null } };
  }
  return {
    ok: true,
    data: {
      count,
      label: `${count.toLocaleString()} shoppers styled across Stylique this week`,
    },
  };
}

// ─── POST /api/shopper/combo-feedback ─────────────────────────────────────────
// OI-23: fire-and-forget combo vote (up / down) so the analytics pipeline can
// learn which outfits resonate. No quota or rate-limit beyond the shared bucket
// — this is a low-value endpoint and the per-shopper bucket handles abuse.

export async function postComboFeedback(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
}): Promise<ApiResponse<{ ok: true }>> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };
  const session = await getOrCreateShopperSession({ shopifyDomain: args.shopDomain, cookieId: args.shopperCookieId });
  const b = args.body as { comboName?: string; vote?: string };
  if (!b?.comboName || !["up", "down"].includes(b.vote ?? "")) return { ok: false, error: "invalid_input" };

  await analytics.track({
    shopId, shopperId: session.row.id,
    name: "CHAT_COMBO_VOTED",
    payload: { comboName: b.comboName.slice(0, 80), vote: b.vote },
  });
  return { ok: true, data: { ok: true } };
}

// Legacy alias — keeps existing `import { getShopperSocialProof }` sites working.
export { getSocialProof as getShopperSocialProof };

// ─── POST /api/shopper/combo/add-all ─────────────────────────────────────────
// D40 — single-click "Add all to bag" on a combo card.
// Creates a CartIntent row (pending) so the brand dashboard can track
// combo-to-cart conversion. Returns the intent id so the widget can poll or
// display a confirmation.

export async function postComboAddAll(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
}): Promise<ApiResponse<{ intentId: string; shopifyVariantIds: string[] }>> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const session = await getOrCreateShopperSession({ shopifyDomain: args.shopDomain, cookieId: args.shopperCookieId });

  const b = args.body as { productIds?: string[]; comboName?: string; sizes?: Record<string, string> } | null;
  const rawIds  = Array.isArray(b?.productIds) ? (b!.productIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  const comboName = typeof b?.comboName === "string" ? b.comboName.slice(0, 80) : "";
  const sizes     = (b?.sizes && typeof b.sizes === "object") ? b.sizes as Record<string, string> : {};

  if (!rawIds.length) return { ok: false, error: "invalid_input" };

  // Validate all product ids belong to this shop — never trust client-supplied ids.
  const products = await prisma.product.findMany({
    where: { shopId, id: { in: rawIds } },
    select: { id: true },
  });
  const validIds = products.map((p) => p.id);

  if (!validIds.length) return { ok: false, error: "invalid_input" };

  // Look up variants for each validated product.
  // The widget needs Shopify numeric variant IDs to call /cart/add.js.
  // We prefer the variant whose `size` matches the shopper's recommended size
  // (from the `sizes` map); if no match, fall back to the first variant by id.
  const variants = await prisma.productVariant.findMany({
    // Exclude variants Shopify has marked unavailable (panel P1) — adding a
    // sold-out variant to /cart/add.js fails the add. NULL = unknown → keep
    // (never block a sale on unknown stock, per D46/§3.5).
    where: { productId: { in: validIds }, availableForSale: { not: false } },
    select: { productId: true, shopifyId: true, size: true },
    orderBy: { id: "asc" },
  });

  // Build product → variant map, preferring size-matched variants.
  const variantByProduct = new Map<string, string>();
  for (const v of variants) {
    const numericId = v.shopifyId
      .replace(/^gid:\/\/shopify\/ProductVariant\//, "")
      .trim();
    // Guard: reject any ID that is not purely numeric after stripping.
    // A non-numeric result means the GID format was unexpected; skip this row
    // rather than passing NaN to Shopify's cart API.
    if (!/^\d+$/.test(numericId)) continue;

    const requestedSize = sizes[v.productId];
    const sizeMatch = requestedSize && v.size &&
      v.size.trim().toUpperCase() === requestedSize.trim().toUpperCase();

    if (!variantByProduct.has(v.productId)) {
      // First candidate — always store as a fallback.
      variantByProduct.set(v.productId, numericId);
    } else if (sizeMatch) {
      // Better candidate — size-matched variant wins over the first-by-id.
      variantByProduct.set(v.productId, numericId);
    }
  }
  const shopifyVariantIds = validIds.map((id) => variantByProduct.get(id) ?? "").filter(Boolean);

  // Validated products exist but NONE resolved to a real Shopify variant id (no
  // variants synced, or malformed shopifyId) — return an honest error instead of
  // ok:true with an empty array, which the widget would surface as a silent
  // failure after an apparent success (panel P1).
  if (validIds.length > 0 && shopifyVariantIds.length === 0) {
    return { ok: false, error: "no_variants_found" };
  }

  // CartIntent is an analytics/tracking row — it must NEVER block the actual
  // cart-add. If the insert fails (e.g. table missing on a fresh migrate-deploy
  // DB, or a transient DB error), we still return the resolved variant ids so
  // the shopper's "Add all to bag" succeeds. The tracking row is best-effort.
  let intentId = "";
  try {
    const intent = await prisma.cartIntent.create({
      data: {
        shopId,
        shopperId: session.row.id,
        productIds: validIds,
        comboName: comboName || null,
        status: "pending",
      },
      select: { id: true },
    });
    intentId = intent.id;
  } catch (err) {
    console.error("[cartIntent] tracking insert failed (cart-add still proceeds):", (err as Error).message);
  }

  // CART_FROM_WIDGET_STYLE — an "Add all to bag" from a complete-the-look combo
  // is a cart originating on the style/look surface. The dashboard reads this
  // tile; before this it was never emitted in production (permanent zero).
  // Fire-and-forget — never block the cart-add.
  void analytics.track({
    shopId, shopperId: session.row.id, name: "CART_FROM_WIDGET_STYLE",
    payload: { productIds: validIds, comboName: comboName || undefined },
  }).catch((err) => console.error("[cartFromWidgetStyle] emit failed:", (err as Error).message));

  return { ok: true, data: { intentId, shopifyVariantIds } };
}
