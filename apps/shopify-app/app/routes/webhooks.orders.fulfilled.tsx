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
import { seenRecently } from "../lib/ratelimit.server";

interface LineItem {
  product_id: number | string | null;
  variant_id?: number | string | null;
  quantity?: number;
  price?: string | number; // per-unit price (Shopify sends a string like "8500.00")
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
    const webhookId = request.headers.get("x-shopify-webhook-id");
    const { shop, payload } = await authenticate.webhook(request);

    // Idempotency (panel P1 #5): this webhook writes CART_CONFIRMED + lineValue
    // (feeds AOV/attribution). Shopify delivers at-least-once, so without dedupe a
    // retry double-counts revenue. Skip a delivery we've already processed.
    if (webhookId && (await seenRecently(`wh:${webhookId}`, 600))) return new Response(null, { status: 200 });

    // 1. Resolve shop — must exist in our DB for any further action.
    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true },
    });
    if (!shopRecord) return new Response(null, { status: 200 });

    const p = payload as FulfilledOrderPayload;
    const orderId = p.id != null ? String(p.id) : null;
    const customerId = p.customer?.id != null ? String(p.customer.id) : null;
    const customerEmail = p.customer?.email ? String(p.customer.email).toLowerCase() : null;

    // Need an order id + SOME way to identify the shopper (customer id OR email).
    if (!orderId || (!customerId && !customerEmail)) return new Response(null, { status: 200 });

    // 2. Find the shopper — by shopifyCustomerId first, then by EMAIL. Almost no
    //    live session carries a shopifyCustomerId yet (the theme-block linkage is
    //    not populating), so email is the practical attribution key; without this
    //    fallback every order short-circuits and CART_CONFIRMED never fires.
    // P4-T03 — record HOW the order linked to a shopper + how strong the link is,
    // so downstream/dashboard never overclaims attribution. No cart/checkout token
    // is matched yet (that needs a schema migration — deferred), so the strongest
    // available key is the Shopify customer id, then email.
    //   customer_id → "high"   · email → "medium"   · neither → unlinked (return)
    let shopper = customerId
      ? await prisma.shopperSession.findFirst({
          where: { shopifyDomain: shop, shopifyCustomerId: customerId },
          select: { id: true },
        })
      : null;
    let linkMethod: "customer_id" | "email" = "customer_id";
    let linkConfidence: "high" | "medium" = "high";
    if (!shopper && customerEmail) {
      shopper = await prisma.shopperSession.findFirst({
        where: { shopifyDomain: shop, email: customerEmail },
        select: { id: true },
      });
      linkMethod = "email";
      linkConfidence = "medium";
    }
    if (!shopper) {
      // Guest checkout or shopper not yet linked (no matching customer id/email).
      // Honest stance (P4-T04): an UNLINKED order produces NO assisted-revenue /
      // outcome signal — we never guess attribution for an order we can't tie to
      // a shopper session.
      return new Response(null, { status: 200 });
    }

    const lineItems = p.line_items ?? [];

    // 3. For each line item, emit a CART_CONFIRMED analytics event.
    // Collect resolved products so we can do attribution afterwards.
    const resolvedLineItems: { productId: string; lineValueCents: number; quantity: number }[] = [];

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

      // lineValue in CENTS (Shopify price is in currency units / dollars;
      // multiply by 100). Founder panel finding: was being written in DOLLARS
      // but every downstream consumer (insights AOV, pilot-measure) divides by
      // 100 expecting cents → 100× revenue understatement. Capture the real
      // line-item totals here once, in cents, so every reader is correct.
      const qty = item.quantity ?? 1;
      const unitDollars = typeof item.price === "string" ? parseFloat(item.price) : (item.price ?? 0);
      const lineValueCents = Number.isFinite(unitDollars) ? Math.round(unitDollars * 100 * qty) : 0;

      resolvedLineItems.push({ productId: resolvedProduct.id, lineValueCents, quantity: qty });

      await prisma.analyticsEvent.create({
        data: {
          shopId: shopRecord.id,
          shopperId: shopper.id,
          name: "CART_CONFIRMED",
          productId: resolvedProduct.id,
          payload: {
            source: "webhook_order",
            orderId,
            quantity: qty,
            // lineValue = unit price × quantity, in CENTS.
            lineValue: lineValueCents,
            // P4-T03 — how this order was tied to the shopper + confidence.
            linkMethod,
            linkConfidence,
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

    // ── Resolve CartIntents → confirmed ─────────────────────────────────────
    // postComboAddAll writes a CartIntent (status "pending") when the shopper
    // adds a Mira combo; nothing advanced it, so combo-to-purchase conversion was
    // never measured. Mark this shopper's pending intents that overlap the order
    // as confirmed. Best-effort — never blocks the webhook.
    if (orderProductIds.length > 0) {
      await prisma.cartIntent
        .updateMany({
          where: {
            shopId: shopRecord.id,
            shopperId: shopper.id,
            status: "pending",
            productIds: { hasSome: orderProductIds },
          },
          data: { status: "confirmed" },
        })
        .catch(() => undefined);
    }

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

        // Founder panel finding: assistedRevenue was computed as
        // (avg variant price × 1 unit) per assisted product — ignored the
        // shopper's actual purchased variant, the quantity, and the real line
        // value. Now we sum the REAL lineValueCents of every order line that
        // matches an assisted product (multiple lines/qty per product count
        // correctly). This is the same source-of-truth as CART_CONFIRMED.
        const assistedSet = new Set(assistedProductIds);
        const assistedRevenueCents = resolvedLineItems
          .filter((li) => assistedSet.has(li.productId))
          .reduce((sum, li) => sum + li.lineValueCents, 0);
        const assistedUnits = resolvedLineItems
          .filter((li) => assistedSet.has(li.productId))
          .reduce((sum, li) => sum + li.quantity, 0);

        await prisma.analyticsEvent.create({
          data: {
            shopId: shopRecord.id,
            shopperId: shopper.id,
            name: "MIRA_ASSISTED_ORDER",
            payload: {
              orderId,
              assistedProductIds,
              assistedRevenueCents,
              assistedUnits,
              totalLineItems: lineItems.length,
              // P4-T03 — attribution is order-linked but the link itself is
              // customer_id (high) or email (medium), NOT a holdout/causal proof.
              linkMethod,
              linkConfidence,
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
