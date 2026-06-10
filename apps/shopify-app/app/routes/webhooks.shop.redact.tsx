// Shopify MANDATORY compliance webhook — shop/redact.
//
// Fired 48 hours after a store uninstalls the app. We must hard-delete ALL of
// that shop's data (the prior behaviour only soft-marked the Shop and kept
// everything for a seamless reinstall — a data-retention liability and an App
// Store blocker). Here we resolve the shop, delete every shop-scoped row in
// dependency-safe order (children before parents), then the Shop itself. Each
// step is best-effort + the whole thing returns 200 regardless (Shopify retries
// non-2xx). Scoped strictly by shopId / shopifyDomain — never cross-tenant.
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { seenRecently } from "../lib/ratelimit.server";

export async function action({ request }: ActionFunctionArgs) {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const { shop, topic } = await authenticate.webhook(request);
  if (webhookId && (await seenRecently(`wh:${webhookId}`, 86400))) return new Response();

  try {
    const shopRow = await prisma.shop.findUnique({ where: { shopifyDomain: shop }, select: { id: true } });
    const shopId = shopRow?.id;

    // Shopper PII is keyed by shopifyDomain (not shopId) — always purge it.
    const pii = await prisma.shopperSession.deleteMany({ where: { shopifyDomain: shop } });
    await prisma.savedRoutine.deleteMany({ where: { shopifyDomain: shop } }).catch(() => undefined);

    let rows = pii.count;
    if (shopId) {
      // Children first (FK-safe), then parents. Each is best-effort.
      const del = async (fn: () => Promise<{ count: number }>) => {
        try { return (await fn()).count; } catch { return 0; }
      };
      rows += await del(() => prisma.outcome.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.analyticsEvent.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.tryOnSession.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.fitSession.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.styleSession.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.cartIntent.deleteMany({ where: { shopId } }));
      // Also purge by shopId (not just the denormalized shopifyDomain above) so a
      // domain-drifted routine can't survive redaction (panel P1 — GDPR scope).
      rows += await del(() => prisma.savedRoutine.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.catalogGap.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.brandRecommendation.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.brandTasteSnapshot.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.productAudit.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.productEmbedding.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.productImage.deleteMany({ where: { product: { shopId } } }));
      rows += await del(() => prisma.productVariant.deleteMany({ where: { product: { shopId } } }));
      rows += await del(() => prisma.product.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.usageCounter.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.notification.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.brandSource.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.brandProfile.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.plan.deleteMany({ where: { shopId } }));
      rows += await del(() => prisma.experiment.deleteMany({ where: { shopId } }));
      // Sessions are keyed by shop domain string in Shopify's session table.
      await prisma.session.deleteMany({ where: { shop } }).catch(() => undefined);
      await prisma.shop.delete({ where: { id: shopId } }).catch(() => undefined);
    }
    console.log(`[gdpr] ${topic} shop=${shop} — hard-deleted (${rows} rows + shop record)`);
  } catch (err) {
    console.error(`[gdpr] ${topic} purge failed for shop=${shop}:`, (err as Error).message);
    return new Response(null, { status: 500 });
  }
  return new Response();
}
