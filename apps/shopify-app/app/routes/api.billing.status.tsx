// GET /api/billing/status
//
// Returns the billing status and usage meters for the authenticated shop.
// Used by the merchant dashboard to render plan tier, usage bars, and cap
// information without exposing raw DB rows.
//
// Auth: Shopify App admin session (same as all /app/* routes).

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { getBillingStatus } from "../lib/billing.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return json({ ok: false, error: "shop_not_installed" }, { status: 404 });
  }

  try {
    const status = await getBillingStatus(shop.id);
    return json({ ok: true, data: status });
  } catch (err) {
    console.error(`[api.billing.status] failed for shop ${session.shop}:`, (err as Error).message);
    return json({ ok: false, error: "billing_status_unavailable" }, { status: 500 });
  }
}
