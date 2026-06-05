// GET /api/admin/overview — full dashboard payload. Authenticated as the
// embedded admin app (Shopify session), not via App Proxy.
//
// Response shape: see lib/dashboard.server.ts → buildOverview return type.
// Tier is enforced inside the loader; the UI is a thin renderer.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { buildOverview } from "../lib/dashboard.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const url = new URL(request.url);
  const windowDays = Math.max(1, Math.min(365, Number(url.searchParams.get("window") ?? "30")));

  try {
    const data = await buildOverview({ shopId: shop.id, windowDays });
    return json({ ok: true, data });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message ?? "overview_failed" }, { status: 500 });
  }
}
