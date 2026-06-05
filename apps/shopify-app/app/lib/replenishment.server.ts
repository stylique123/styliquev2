// Stylique Beauty — replenishment engine.
//
// Answers two questions per shopper per product:
//   1. "Is this shopper due to restock?"
//   2. "Which product variants match what they previously bought?"
//
// REST surface:
//   GET  api/beauty/replenishment   — list of due items for the current shopper
//   POST api/beauty/replenishment   — log a replenishment purchase (same as CART_CONFIRMED)
//
// Brain tool surface:
//   `suggest_replenishment` — called when Mira detects re-purchase intent
//
// Security: all queries are shopId-scoped + rate-limited. No shopper can fish
// for another shopper's purchase history.

import { z } from "zod";
import { prisma } from "../db.server";
import { shopIdFromDomain, rateOk } from "./shopper-helpers.server";
import { getOrCreateShopperSession } from "./session.server";
import { estimateReplenishmentWindow } from "@stylique/core";
import type { ApiResponse } from "./shopper-types.server";

// ─── Schema ──────────────────────────────────────────────────────────────────

const ReplenishmentLogSchema = z.object({
  productId: z.string().min(1),
  variantId:  z.string().optional(),
  category:   z.string().default("serum"),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReplenishmentItem = {
  productId: string;
  handle: string;
  title: string;
  imageUrl: string | null;
  category: string | null;
  variantShopifyId: string | null;
  priceCents: number | null;
  urgency: "now" | "soon" | "later";
  daysUntilDue: number;
  purchasedDaysAgo: number;
};

// ─── GET api/beauty/replenishment ─────────────────────────────────────────────

export async function getBeautyReplenishment(args: {
  shopDomain: string;
  shopperCookieId: string | null;
}): Promise<ApiResponse<{ items: ReplenishmentItem[]; dueCount: number }>> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) {
    return { ok: false, error: "rate_limited" };
  }
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const { row } = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  // Pull CART_CONFIRMED events for this shopper in the last 180 days.
  // Events carry { productId, variantId, category } in the payload.
  const purchaseEvents = await prisma.analyticsEvent.findMany({
    where: {
      shopId,
      shopperId: row.id,
      name: "CART_CONFIRMED",
      createdAt: { gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) },
    },
    select: { payload: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  if (!purchaseEvents.length) {
    return { ok: true, data: { items: [], dueCount: 0 } };
  }

  // Dedupe by productId — keep the first purchase date per product.
  const firstByProduct = new Map<string, { date: Date; category: string }>();
  for (const e of purchaseEvents) {
    const p = e.payload as { productId?: string; category?: string } | null;
    const pid = p?.productId;
    if (!pid) continue;
    if (!firstByProduct.has(pid)) {
      firstByProduct.set(pid, {
        date: e.createdAt,
        category: p?.category ?? "serum",
      });
    }
  }

  // Fetch product details for these IDs (shopId-scoped)
  const productIds = [...firstByProduct.keys()];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, shopId },
    include: {
      variants: { where: { availableForSale: true }, orderBy: { priceCents: "asc" }, take: 1 },
      images: { orderBy: { position: "asc" }, take: 1 },
    },
  });

  const now = Date.now();
  const items: ReplenishmentItem[] = [];

  for (const product of products) {
    const purchase = firstByProduct.get(product.id);
    if (!purchase) continue;

    const purchasedDaysAgo = Math.floor((now - purchase.date.getTime()) / (1000 * 60 * 60 * 24));
    const category = product.category ?? purchase.category;
    const window = estimateReplenishmentWindow(category, purchasedDaysAgo);

    if (window.urgency === "later") continue; // not due yet

    const variant = product.variants[0];
    items.push({
      productId: product.id,
      handle: product.handle,
      title: product.title,
      imageUrl: product.images[0]?.url ?? null,
      category,
      variantShopifyId: variant?.shopifyId ?? null,
      priceCents: variant?.priceCents ?? null,
      urgency: window.urgency,
      daysUntilDue: window.daysUntilDue,
      purchasedDaysAgo,
    });
  }

  // Sort: overdue first, then by urgency.
  items.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  return {
    ok: true,
    data: {
      items,
      dueCount: items.filter(i => i.urgency === "now").length,
    },
  };
}

// ─── POST api/beauty/replenishment ────────────────────────────────────────────
// Explicit replenishment log (supplement to the webhook flow — lets the widget
// surface a "buy again" CTA that self-reports without waiting for order webhook).

export async function postBeautyReplenishmentLog(args: {
  shopDomain: string;
  shopperCookieId: string | null;
  body: unknown;
}): Promise<ApiResponse<{ logged: boolean }>> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) {
    return { ok: false, error: "rate_limited" };
  }
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const parsed = ReplenishmentLogSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const { row } = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  // Verify the product belongs to this shop before logging
  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, shopId },
    select: { id: true, category: true },
  });
  if (!product) return { ok: false, error: "product_not_found" };

  await prisma.analyticsEvent.create({
    data: {
      shopId,
      shopperId: row.id,
      name: "CART_CONFIRMED",
      payload: {
        productId: product.id,
        variantId: parsed.data.variantId ?? null,
        category: product.category ?? parsed.data.category,
        source: "replenishment_widget",
      },
    },
  });

  return { ok: true, data: { logged: true } };
}

// ─── Brain tool handler ───────────────────────────────────────────────────────
// Called by `suggest_replenishment` tool in beauty-brain.server.ts.
// Returns the top 3 due items for the current shopper on the current shop.
//
// SECURITY: must look up replenishment using the session's cookie ID derived
// from the shopper session row — NOT with null (which would create a new
// anonymous session and return empty data for the wrong shopper).

export async function handleSuggestReplenishment(args: {
  shopId: string;
  shopperSessionId: string;
  shopDomain: string;
}): Promise<{
  items: ReplenishmentItem[];
  hasItems: boolean;
  message: string;
}> {
  // Resolve the sessionId (= cookie value) for this session row so
  // getBeautyReplenishment looks up the correct shopper — NOT null, which
  // would create a new anonymous session and return empty data for the
  // wrong shopper (IDOR fix).
  const sessionRow = await prisma.shopperSession.findFirst({
    where: { id: args.shopperSessionId, shopifyDomain: args.shopDomain },
    select: { sessionId: true },
  });
  if (!sessionRow) {
    return { items: [], hasItems: false, message: "No replenishment items due." };
  }

  const result = await getBeautyReplenishment({
    shopDomain: args.shopDomain,
    shopperCookieId: sessionRow.sessionId,
  });

  if (!result.ok || !result.data.items.length) {
    return { items: [], hasItems: false, message: "No replenishment items due." };
  }

  const top = result.data.items.slice(0, 3);
  const now = top.filter(i => i.urgency === "now");
  const soon = top.filter(i => i.urgency === "soon");

  let message: string;
  if (now.length) {
    message = `${now.map(i => i.title).join(", ")} ${now.length === 1 ? "is" : "are"} overdue for a refill based on your last purchase.`;
  } else {
    message = `${soon.map(i => i.title).join(", ")} ${soon.length === 1 ? "is" : "are"} coming up for replenishment in the next 14 days.`;
  }

  return { items: top, hasItems: true, message };
}
