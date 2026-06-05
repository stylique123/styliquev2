// PRODUCTS_CREATE / PRODUCTS_UPDATE / PRODUCTS_DELETE share this handler.
// Topic dispatch happens inside.
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { enqueueCatalogSync } from "../queue.server";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload } = await authenticate.webhook(request);

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
