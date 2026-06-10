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
import { seenRecently } from "../lib/ratelimit.server";

interface RefundLineItem {
  line_item?: {
    product_id?: number | string | null;
    variant_id?: number | string | null;
  };
  quantity?: number;
  // Shopify's per-line restock type — `return` / `cancel` / `legacy_restock` /
  // `no_restock`. A `no_restock` is the strongest "shopper hated it" signal
  // (item not coming back to inventory). CX panel finding: we were throwing
  // away return-reason signal because we only logged that A return happened,
  // never WHY.
  restock_type?: string | null;
  // Optional per-line reason (some apps populate this via the Returns API).
  reason?: string | null;
}

interface ReturnedOrderPayload {
  order_id?: number | string;
  // REFUNDS_CREATE carries refund_line_items; ORDERS_REFUNDED carries refund_line_items or line_items.
  refund_line_items?: RefundLineItem[];
  // Some topics expose line_items directly on the order.
  line_items?: Array<{ product_id?: number | string | null; variant_id?: number | string | null; quantity?: number }>;
  // Refund-level note from the Admin (often the actual reason — "size too
  // small", "color not as expected", "didn't fit"). CX panel finding: this
  // was being ignored entirely; capturing it lets brands tell size-driven vs
  // colour-driven vs change-of-mind returns apart.
  note?: string | null;
  customer?: {
    id?: number | string;
    email?: string;
  };
}

/**
 * Normalise a Shopify reason string to a stable bucket the dashboard can
 * pivot on without hundreds of free-text variants. Pattern-matches the
 * common phrasings; falls through to `other` so nothing is invented.
 */
function bucketReason(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (/\b(too small|sizing.{0,8}small|runs?.{0,3}small|too tight|small)\b/.test(s)) return "size_too_small";
  if (/\b(too (?:big|large)|runs?.{0,3}(?:big|large)|loose|baggy)\b/.test(s)) return "size_too_large";
  if (/\b(colou?r|shade|tone|not as (?:pictured|expected)|different colou?r)\b/.test(s)) return "color_mismatch";
  if (/\b(quality|defect|fabric|stitch|hole|tear|broken|damaged)\b/.test(s)) return "quality";
  if (/\b(style|don'?t (?:like|love)|not for me|not my style|changed my mind|change of mind)\b/.test(s)) return "style_or_mind_change";
  if (/\b(late|arrived too late|too late)\b/.test(s)) return "delivery_late";
  return "other";
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const webhookId = request.headers.get("x-shopify-webhook-id");
    const { shop, payload } = await authenticate.webhook(request);

    // Idempotency (panel P1 #5): applyReturnBias mutates the fit penalty (−1,
    // floored −5); a redelivered webhook would compound it. Dedupe on delivery id.
    if (webhookId && (await seenRecently(`wh:${webhookId}`, 600))) return new Response(null, { status: 200 });

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
    // CX panel finding: capture reason + restock_type per line so the
    // dashboard can split returns by cause (size_too_small vs colour vs
    // style vs quality) instead of treating all returns as identical.
    const refundLevelReason = bucketReason(p.note);
    const returnedItems: Array<{
      productId: string | number | null | undefined;
      variantId?: string | number | null | undefined;
      quantity: number;
      reasonBucket: string | null;
      restockType: string | null;
      rawReason: string | null;
    }> = [];

    if (p.refund_line_items?.length) {
      for (const rli of p.refund_line_items) {
        const lineReason = bucketReason(rli.reason) ?? refundLevelReason;
        returnedItems.push({
          productId: rli.line_item?.product_id,
          variantId: rli.line_item?.variant_id,
          quantity: rli.quantity ?? 1,
          reasonBucket: lineReason,
          restockType: rli.restock_type ?? null,
          rawReason: (rli.reason ?? p.note ?? null)?.toString().slice(0, 200) ?? null,
        });
      }
    } else if (p.line_items?.length) {
      for (const li of p.line_items) {
        returnedItems.push({
          productId: li.product_id,
          variantId: li.variant_id,
          quantity: li.quantity ?? 1,
          reasonBucket: refundLevelReason,
          restockType: null,
          rawReason: p.note?.toString().slice(0, 200) ?? null,
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
            // CX panel finding (cycle 4): capture WHY, not just THAT.
            reasonBucket: item.reasonBucket,
            restockType: item.restockType,
            rawReason: item.rawReason,
            quantity: item.quantity,
          },
        },
      });

      // Apply fit-bias correction ONLY when the return reason actually
      // points at sizing — otherwise a `color_mismatch` or `style` return
      // was mis-training the size model. Unknown reason still nudges (
      // conservative: most returns are size-driven in fashion DTC).
      const shouldNudgeSize =
        item.reasonBucket === null ||
        item.reasonBucket === "size_too_small" ||
        item.reasonBucket === "size_too_large" ||
        item.reasonBucket === "other";
      if (item.variantId != null && shouldNudgeSize) {
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
