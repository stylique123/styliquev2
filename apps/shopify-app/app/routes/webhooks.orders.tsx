// Lightweight: hash the order id and emit a PURCHASE analytics event.
// No PII. Real attribution + checkout-start join happens later in the analytics rollup job.
import type { ActionFunctionArgs } from "@remix-run/node";
import { createHash } from "node:crypto";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { createAnalyticsService } from "@stylique/core";

const analytics = createAnalyticsService(prisma as any);

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload } = await authenticate.webhook(request);
  const shopRecord = await prisma.shop.findUnique({ where: { shopifyDomain: shop }, select: { id: true } });
  if (!shopRecord) return new Response();

  const p = payload as { id?: number | string; total_price?: string };
  if (p.id == null) return new Response();

  const totalCents = p.total_price ? Math.round(Number.parseFloat(p.total_price) * 100) : 0;
  await analytics.track({
    shopId: shopRecord.id,
    name: "PURCHASE",
    payload: { orderIdHash: hash(String(p.id)), totalCents },
  });

  return new Response();
}
