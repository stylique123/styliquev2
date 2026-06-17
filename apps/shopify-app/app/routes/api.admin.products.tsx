// GET /api/admin/products — return up to 200 products for the authenticated shop.
//
// Admin product list endpoint (read-only product picker).
// Only safe read-only fields are returned; pricing and inventory are excluded
// because this endpoint does not pass Shopify storefront-level auth.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

// ── Loader: GET ───────────────────────────────────────────────────────────
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json({ ok: false, error: "shop_not_installed", products: [] }, { status: 404 });
  }

  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
    select: {
      id: true,
      title: true,
      handle: true,
      productType: true,
      vendor: true,
      primaryColor: true,
    },
    orderBy: { title: "asc" },
    take: 200,
  });

  return json({ ok: true, products });
}

// ── Action: reject non-GET ────────────────────────────────────────────────
export async function action() {
  return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
