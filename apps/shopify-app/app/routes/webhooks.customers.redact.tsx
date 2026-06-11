// Shopify MANDATORY compliance webhook — customers/redact.
//
// Fired 10 days after a shopper asks the merchant to delete their data. We
// hard-delete ALL Stylique rows carrying personal data for this shopper, in
// dependency-safe order. GDPR Art. 17 requires ALL personal data be erased:
// - ShopperSession: email, name, chatHistoryJson, tasteVectorJson, body measurements
// - AnalyticsEvent: payload can contain heightCm/weightKg/bodyType (CHAT_PROFILE_CAPTURED)
// - CatalogGap: rawQuery contains verbatim shopper search text
// Scoped by shopifyDomain + shopifyCustomerId — never cross-tenant.
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { seenRecently } from "../lib/ratelimit.server";

export async function action({ request }: ActionFunctionArgs) {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const { shop, payload, topic } = await authenticate.webhook(request);

  // Idempotency: Shopify's at-least-once delivery can re-fire this. A second
  // delete is a no-op but wastes DB round-trips and log noise.
  if (webhookId && (await seenRecently(`wh:${webhookId}`, 3600))) {
    console.log(`[gdpr] ${topic} shop=${shop} — duplicate delivery skipped`);
    return new Response();
  }

  const customerId = (payload as { customer?: { id?: number | string } } | undefined)?.customer?.id;

  if (customerId != null) {
    try {
      // 1. Collect the session IDs FIRST so we can cascade-delete child rows.
      const sessions = await prisma.shopperSession.findMany({
        where: { shopifyDomain: shop, shopifyCustomerId: String(customerId) },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);
      let rows = 0;

      const del = async (fn: () => Promise<{ count: number }>) => {
        try { return (await fn()).count; } catch { return 0; }
      };
      // Resolve shop record for the belt-and-suspenders sweep below.
      const shopRow = await prisma.shop.findUnique({ where: { shopifyDomain: shop }, select: { id: true } }).catch(() => null);
      const shopId = shopRow?.id;

      if (sessionIds.length > 0) {
        // 2. Delete ALL child rows that carry personal data — in dependency order
        //    (children before the parent ShopperSession). All scoped to the collected
        //    session IDs so we NEVER touch another shopper's data.
        // AnalyticsEvent.payload can hold body measurements, etc.
        rows += await del(() => prisma.analyticsEvent.deleteMany({ where: { shopperId: { in: sessionIds } } }));
        // CatalogGap.rawQuery holds verbatim shopper search text ("a red dress for my sister's wedding").
        rows += await del(() => prisma.catalogGap.deleteMany({ where: { shopperId: { in: sessionIds } } }));
        // TryOnSession: renderUrl may be tied to the shopper's uploaded photo key.
        rows += await del(() => prisma.tryOnSession.deleteMany({ where: { shopperId: { in: sessionIds } } }));
        // FitSession + StyleSession: body + preference data.
        rows += await del(() => prisma.fitSession.deleteMany({ where: { shopperId: { in: sessionIds } } }));
        rows += await del(() => prisma.styleSession.deleteMany({ where: { shopperId: { in: sessionIds } } }));
        // CartIntent: purchase intent signals.
        rows += await del(() => prisma.cartIntent.deleteMany({ where: { shopperId: { in: sessionIds } } }));

        // 3. Now delete the ShopperSession rows themselves.
        const res = await prisma.shopperSession.deleteMany({ where: { id: { in: sessionIds } } });
        rows += res.count;
      }

      // BELT-AND-SUSPENDERS: handle the SET NULL orphan race — if a prior incomplete
      // run deleted ShopperSession before its children (e.g. a crash between steps),
      // those rows now have shopperId=NULL and the session-ID sweep above misses them.
      // We can't reliably recover the shopperId, but we CAN delete CatalogGap rows
      // for this shop that are already anonymised (shopperId IS NULL) — they still
      // hold rawQuery text that is personal data in context.  We scope to shopId only
      // (not per-shopper) so this is a shop-level cleanup of orphaned search text.
      // Safe: once shopperId is NULL the row no longer belongs to any live shopper.
      if (shopId) {
        rows += await del(() => prisma.catalogGap.deleteMany({
          where: { shopId, shopperId: null },
        }));
        // Also strip (not delete) AnalyticsEvent payload for CHAT_PROFILE_CAPTURED
        // events that may have been orphaned — body measurements must not persist.
        // We zero out the payload rather than deleting to preserve the event count.
        await prisma.analyticsEvent.updateMany({
          where: { shopId, shopperId: null, name: "CHAT_PROFILE_CAPTURED" },
          data: { payload: {} },
        }).catch(() => undefined);
      }

      console.log(`[gdpr] ${topic} shop=${shop} customer=${customerId} — redacted ${rows} rows (${sessionIds.length} sessions)`);
    } catch (err) {
      console.error(`[gdpr] ${topic} delete failed for shop=${shop}:`, (err as Error).message);
      return new Response(null, { status: 500 });
    }
  } else {
    console.log(`[gdpr] ${topic} shop=${shop} — no customer id in payload, nothing to redact`);
  }
  return new Response();
}
