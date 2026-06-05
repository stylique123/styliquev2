// POST /api/admin/sentiment/extract — enqueues sentiment extraction for the
// authenticated shop. Intended for the "Analyze now" button on the dashboard
// and for testing without waiting for the nightly cron.
//
// Uses the shared singleton queue from queue.server.ts — do NOT create a new
// Queue / IORedis connection here; that leaks a connection on every request.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { enqueueSentimentExtract } from "../queue.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json({ ok: false, error: "shop_not_installed" }, { status: 404 });
  }

  await enqueueSentimentExtract(
    { shopId: shop.id },
    { jobId: `sentiment-manual:${shop.id}:${Date.now()}` },
  );

  return json({ ok: true, queued: true });
}
