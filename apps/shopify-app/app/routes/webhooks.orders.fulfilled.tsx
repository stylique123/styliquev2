// OI-3 — orders/fulfilled webhook → CART_CONFIRMED taste signal.
//
// Shopify fires this when a fulfilment is created for an order (i.e. the
// brand shipped it, or the order was auto-fulfilled). We treat fulfilment
// as the strongest positive purchase signal we have.
//
// Security rules:
//   - Auth is done via authenticate.webhook() (HMAC validation).
//   - All DB reads are scoped to the shopId derived from the authenticated
//     shop domain — never trust the webhook body for shop-scoping.
//   - We always return 200 OK (even on errors) so Shopify doesn't retry
//     unnecessarily. Errors are logged server-side.
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { recomputeTasteVector } from "../lib/taste.server";

interface LineItem {
  product_id: number | string | null;
  variant_id?: number | string | null;
  quantity?: number;
}

interface FulfilledOrderPayload {
  id?: number | string;
  customer?: {
    id?: number | string;
    email?: string;
  };
  line_items?: LineItem[];
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, payload } = await authenticate.webhook(request);

    // 1. Resolve shop — must exist in our DB for any further action.
    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true },
    });
    if (!shopRecord) return new Response(null, { status: 200 });

    const p = payload as FulfilledOrderPayload;
    const orderId = p.id != null ? String(p.id) : null;
    const customerId = p.customer?.id != null ? String(p.customer.id) : null;

    if (!customerId || !orderId) return new Response(null, { status: 200 });

    // 2. Find shopper by shopifyCustomerId, scoped to this shop's domain.
    const shopper = await prisma.shopperSession.findFirst({
      where: {
        shopifyDomain: shop,
        shopifyCustomerId: customerId,
      },
      select: { id: true },
    });
    if (!shopper) {
      // Guest checkout or shopper not yet linked — skip silently.
      return new Response(null, { status: 200 });
    }

    const lineItems = p.line_items ?? [];

    // 3. For each line item, emit a CART_CONFIRMED analytics event.
    // Collect resolved products so we can do attribution afterwards.
    const resolvedLineItems: { productId: string }[] = [];

    for (const item of lineItems) {
      if (item.product_id == null) continue;

      const shopifyGid = `gid://shopify/Product/${item.product_id}`;

      // Product must exist in our catalog AND be scoped to this shop.
      const product = await prisma.product.findFirst({
        where: {
          shopId: shopRecord.id,
          shopifyId: shopifyGid,
        },
        select: { id: true },
      });

      // Also try numeric shopifyId (some syncs store without gid prefix).
      const productByNumericId = product
        ? null
        : await prisma.product.findFirst({
            where: {
              shopId: shopRecord.id,
              shopifyId: String(item.product_id),
            },
            select: { id: true },
          });

      const resolvedProduct = product ?? productByNumericId;
      if (!resolvedProduct) continue;

      resolvedLineItems.push({ productId: resolvedProduct.id });

      await prisma.analyticsEvent.create({
        data: {
          shopId: shopRecord.id,
          shopperId: shopper.id,
          name: "CART_CONFIRMED",
          productId: resolvedProduct.id,
          payload: {
            source: "webhook_order",
            orderId,
            quantity: item.quantity ?? 1,
          },
        },
      });
    }

    // ── Mira-assisted revenue attribution ──────────────────────────────────
    // For any product in this order, check if the shopper had a
    // CHAT_CART_REQUESTED or COMBO_ADD_ALL event within the last 48 hours.
    // If yes, that line item was Mira-assisted.
    const orderProductIds = resolvedLineItems.map(r => r.productId);
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    if (orderProductIds.length > 0) {
      const assistEvents = await prisma.analyticsEvent.findMany({
        where: {
          shopId: shopRecord.id,
          shopperId: shopper.id,
          name: { in: ["CHAT_CART_REQUESTED", "COMBO_ADD_ALL"] },
          createdAt: { gte: cutoff },
          productId: { in: orderProductIds },
        },
        select: { productId: true },
      });

      if (assistEvents.length > 0) {
        const assistedProductIds = [
          ...new Set(assistEvents.map(e => e.productId).filter(Boolean) as string[]),
        ];

        // Calculate revenue for assisted items using the variant price.
        // Average price per product × 1 unit as a conservative estimate.
        const assistedVariants = await prisma.productVariant.findMany({
          where: { productId: { in: assistedProductIds } },
          select: { productId: true, priceCents: true },
        });

        const priceByProduct = new Map<string, number>();
        for (const v of assistedVariants) {
          if (v.priceCents) priceByProduct.set(v.productId, v.priceCents);
        }
        const assistedRevenueCents = assistedProductIds.reduce(
          (sum, pid) => sum + (priceByProduct.get(pid) ?? 0), 0
        );

        await prisma.analyticsEvent.create({
          data: {
            shopId: shopRecord.id,
            shopperId: shopper.id,
            name: "MIRA_ASSISTED_ORDER",
            payload: {
              orderId,
              assistedProductIds,
              assistedRevenueCents,
              totalLineItems: lineItems.length,
            },
          },
        });
      }
    }

    // 4. Trigger taste recompute async (fire-and-forget).
    recomputeTasteVector(shopper.id).catch((err: unknown) => {
      console.error(
        `[webhooks/orders/fulfilled] taste recompute failed for shopper ${shopper.id}:`,
        (err as Error).message,
      );
    });
  } catch (err) {
    // Always 200 — Shopify retries on non-200.
    console.error("[webhooks/orders/fulfilled] unhandled error:", (err as Error).message);
  }

  return new Response(null, { status: 200 });
}
