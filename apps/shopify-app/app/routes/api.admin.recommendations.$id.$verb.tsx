// POST /api/admin/recommendations/:id/dismiss
// POST /api/admin/recommendations/:id/taken
//
// Pre-audit, these lived inside the parent route's action() and tried to parse
// the URL by splitting segments. Remix didn't actually route to that file —
// the dashboard's clicks were silent 404s. This is the correct dynamic-route
// file. The parent route now only owns GET list + POST run.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { dismissRecommendation, markRecommendationTaken } from "../lib/recommendations.server";

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop }, select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const id = params.id;
  const verb = params.verb;
  if (!id) return json({ ok: false, error: "missing_id" }, { status: 400 });

  if (verb === "dismiss") {
    await dismissRecommendation(shop.id, id);
    return json({ ok: true });
  }
  if (verb === "taken") {
    await markRecommendationTaken(shop.id, id);
    return json({ ok: true });
  }
  return json({ ok: false, error: "not_found" }, { status: 404 });
}
