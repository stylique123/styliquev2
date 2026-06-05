// OI-3 — orders/returned webhook → CART_CANCELLED taste signal + fit-bias correction.
//
// Shopify fires this as REFUNDS_CREATE (mapped via ORDERS_REFUNDED topic). We
// treat a refunded line item as a negative purchase signal and additionally
// apply a per-(category, size) fit-bias penalty so future size recommendations
// for similar garments gain a calibration nudge (see applyReturnBias in
// lib/taste.server.ts).
//
// Security rules:
//   - Auth is done via authenticate.webhook() (HMAC validation).
//   - All DB reads are scoped to the shopId derived from the authenticated shop.
//   - We always return 200 OK so Shopify doesn't retry on transient errors.
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { recomputeTasteVector, applyReturnBias } from "../lib/taste.server";

interface RefundLineItem {
  line_item?: {
    product_id?: number | string | null;
    variant_id?: number | string | null;
  };
  quantity?: number;
}

interface ReturnedOrderPayload {
  order_id?: number | string;
  // REFUNDS_CREATE carries refund_line_items; ORDERS_REFUNDED carries refund_line_items or line_items.
  refund_line_items?: RefundLineItem[];
  // Some topics expose line_items directly on the order.
  line_items?: Array<{ product_id?: number | string | null; variant_id?: number | string | null; quantity?: number }>;
  customer?: {
    id?: number | string;
    email?: string;
  };
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, payload } = await authenticate.webhook(request);

    // 1. Resolve shop.
    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true },
    });
    if (!shopRecord) return new Response(null, { status: 200 });

    const p = payload as ReturnedOrderPayload;
    const orderId = p.order_id != null ? String(p.order_id) : null;
    const customerId = p.customer?.id != null ? String(p.customer.id) : null;

    if (!customerId || !orderId) return new Response(null, { status: 200 });

    // 2. Find shopper by shopifyCustomerId, scoped to this shop.
    const shopper = await prisma.shopperSession.findFirst({
      where: {
        shopifyDomain: shop,
        shopifyCustomerId: customerId,
      },
      select: { id: true },
    });
    if (!shopper) return new Response(null, { status: 200 });

    // 3. Collect returned line items — normalise both payload shapes.
    const returnedItems: Array<{ productId: string | number | null | undefined; variantId?: string | number | null | undefined; quantity: number }> = [];

    if (p.refund_line_items?.length) {
      for (const rli of p.refund_line_items) {
        returnedItems.push({
          productId: rli.line_item?.product_id,
          variantId: rli.line_item?.variant_id,
          quantity: rli.quantity ?? 1,
        });
      }
    } else if (p.line_items?.length) {
      for (const li of p.line_items) {
        returnedItems.push({
          productId: li.product_id,
          variantId: li.variant_id,
          quantity: li.quantity ?? 1,
        });
      }
    }

    // 4. Emit CART_CANCELLED for each returned product + apply fit-bias correction.
    for (const item of returnedItems) {
      if (item.productId == null) continue;

      const shopifyGid = `gid://shopify/Product/${item.productId}`;

      const product = await prisma.product.findFirst({
        where: { shopId: shopRecord.id, shopifyId: shopifyGid },
        select: { id: true, category: true },
      });
      const productByNumericId =
        product === null
          ? await prisma.product.findFirst({
              where: { shopId: shopRecord.id, shopifyId: String(item.productId) },
              select: { id: true, category: true },
            })
          : null;

      const resolvedProduct = product ?? productByNumericId;
      if (!resolvedProduct) continue;

      await prisma.analyticsEvent.create({
        data: {
          shopId: shopRecord.id,
          shopperId: shopper.id,
          name: "CART_CANCELLED",
          productId: resolvedProduct.id,
          payload: {
            source: "webhook_return",
            orderId,
          },
        },
      });

      // Apply fit-bias correction if a size variant is available.
      if (item.variantId != null) {
        await applyReturnBias({
          shopId: shopRecord.id,
          productId: resolvedProduct.id,
          sessionId: shopper.id,
          variantShopifyId: String(item.variantId),
          category: resolvedProduct.category,
        }).catch((err: unknown) => {
          console.error(
            `[webhooks/orders/returned] applyReturnBias failed for product ${resolvedProduct.id}:`,
            (err as Error).message,
          );
        });
      }
    }

    // 5. Trigger taste recompute async (fire-and-forget).
    recomputeTasteVector(shopper.id).catch((err: unknown) => {
      console.error(
        `[webhooks/orders/returned] taste recompute failed for shopper ${shopper.id}:`,
        (err as Error).message,
      );
    });
  } catch (err) {
    console.error("[webhooks/orders/returned] unhandled error:", (err as Error).message);
  }

  return new Response(null, { status: 200 });
}
