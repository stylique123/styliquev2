// PRODUCTS_CREATE / PRODUCTS_UPDATE / PRODUCTS_DELETE share this handler.
// Topic dispatch happens inside.
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { enqueueCatalogSync } from "../queue.server";
import { seenRecently } from "../lib/ratelimit.server";

export async function action({ request }: ActionFunctionArgs) {
  // Idempotency (panel rec #12): Shopify retries webhooks and can re-deliver the
  // same X-Shopify-Webhook-Id. Dedupe so one product edit enqueues one sync job,
  // not N. Done BEFORE auth-parse consumes the body? No — header is independent of
  // body, so read it directly off the request.
  const webhookId = request.headers.get("x-shopify-webhook-id");

  const { topic, shop, payload } = await authenticate.webhook(request);

  if (webhookId && (await seenRecently(`wh:${webhookId}`, 300))) {
    // Duplicate delivery — already handled within the last 5 minutes.
    return new Response();
  }

  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
    select: { id: true },
  });
  if (!shopRecord) return new Response();

  // Shopify product webhook payloads carry numeric `id` at the top level.
  const productId = (payload as { id?: number | string }).id;
  if (productId == null) return new Response();

  if (topic === "PRODUCTS_DELETE") {
    await enqueueCatalogSync({ kind: "delete", shopId: shopRecord.id, shopifyProductId: productId });
  } else {
    // CREATE + UPDATE → single-product sync. The worker upserts and rebuilds the audit.
    await enqueueCatalogSync({ kind: "product", shopId: shopRecord.id, shopifyProductId: productId });
  }

  return new Response();
}
