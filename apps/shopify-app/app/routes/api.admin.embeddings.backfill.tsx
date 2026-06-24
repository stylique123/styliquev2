// POST /api/admin/embeddings/backfill — embed all products for the shop.
//
// Triggered manually from the dashboard after first install or after switching
// providers. Idempotent: products already at the current modelKey are skipped.
// Costs ~free at Gemini quota (1500 req/min, free tier) — for a 2000-product
// shop this is ~90s wall-clock with the 40ms throttle.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { embedAllForShop } from "../lib/embeddings.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop }, select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const result = await embedAllForShop(shop.id);
  if (!result.providerConfigured) {
    return json({ ok: false, error: "embedding_provider_not_configured", data: result }, { status: 503 });
  }
  if (result.failed > 0) {
    return json({ ok: false, error: "embedding_backfill_partial_failure", data: result }, { status: 207 });
  }
  return json({ ok: true, data: result });
}

// GET reports current backfill state — % of products with an up-to-date
// embedding. Used by the dashboard tile.
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop }, select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const [total, embedded] = await Promise.all([
    prisma.product.count({ where: { shopId: shop.id } }),
    prisma.productEmbedding.count({ where: { shopId: shop.id } }),
  ]);
  return json({
    ok: true,
    data: {
      total,
      embedded,
      coverage: total === 0 ? 0 : Math.round((embedded / total) * 100),
    },
  });
}
