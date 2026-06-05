// GET /api/admin/creative-sets — list the 50 most recent creative sets for this shop.
//
// Each set includes its most recent STILL creative so the Creative Studio
// can render a thumbnail without a second round-trip.

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
    return json({ ok: false, error: "shop_not_installed", sets: [] }, { status: 404 });
  }

  const sets = await prisma.creativeSet.findMany({
    where: { shopId: shop.id },
    include: {
      creatives: {
        where: { role: "STILL" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return json({ ok: true, sets });
}

// ── Action: reject non-GET ────────────────────────────────────────────────
export async function action() {
  return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
