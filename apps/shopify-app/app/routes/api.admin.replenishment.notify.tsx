// POST /api/admin/replenishment/notify
// Manually triggers the replenishment email job for the authenticated shop.
// Intended for the "Notify now" button on the dashboard and for testing without
// waiting for the nightly cron.
//
// Uses the shared singleton queue from queue.server.ts — do NOT create a new
// Queue / IORedis connection here; that leaks a connection on every request.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { enqueueReplenishmentNotify } from "../queue.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json({ ok: false, error: "shop_not_installed" }, { status: 404 });
  }

  // Optional daysAhead override in the request body (defaults to 7 in the worker).
  let daysAhead: number | undefined;
  try {
    const body = await request.json() as { daysAhead?: unknown };
    const parsed = Number(body?.daysAhead);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 90) daysAhead = parsed;
  } catch { /* empty body — use default */ }

  await enqueueReplenishmentNotify(
    { shopId: shop.id, daysAhead },
    { jobId: `replenishment-manual:${shop.id}:${Date.now()}` },
  );

  return json({ ok: true, queued: true });
}
