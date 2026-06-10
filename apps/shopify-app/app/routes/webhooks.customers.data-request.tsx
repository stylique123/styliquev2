// Shopify MANDATORY compliance webhook — customers/data_request.
//
// GDPR Art. 20 data portability: when a shopper (via the merchant) requests their
// data, we build a portable JSON export of their profile fields and store it as a
// Notification for the merchant dashboard, per Shopify App Store requirements.
//
// Privacy posture (CLAUDE.md §3/§10):
//   - chatHistoryJson (§3 invariant #4) and tasteVectorJson (§10) are NEVER exported.
//   - Only the portable identity + body + beauty profile fields are included.
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { seenRecently } from "../lib/ratelimit.server";

export async function action({ request }: ActionFunctionArgs) {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const { shop, payload, topic } = await authenticate.webhook(request);
  if (webhookId && (await seenRecently(`wh:${webhookId}`, 3600))) return new Response();

  const customerId =
    (payload as { customer?: { id?: number | string } } | undefined)?.customer?.id ?? "unknown";

  try {
    // 1. Look up all ShopperSession rows for this customer on this shop.
    const sessions = await prisma.shopperSession.findMany({
      where: {
        shopifyDomain: shop,
        shopifyCustomerId: String(customerId),
      },
      select: {
        email: true,
        displayName: true,
        accountClaimedAt: true,
        marketingOptIn: true,
        heightCm: true,
        weightKg: true,
        fitPreference: true,
        bodyType: true,
        skinTone: true,
        savedBeautyRoutineJson: true,
        // chatHistoryJson and tasteVectorJson are intentionally omitted (§3/#4 + §10)
      },
    });

    // 2. Build the portable export (GDPR Art. 20 — portable fields only).
    const exportData = {
      shopifyDomain: shop,
      customerId: String(customerId),
      exportedAt: new Date().toISOString(),
      sessions: sessions.map((s) => ({
        email: s.email,
        displayName: s.displayName,
        accountClaimedAt: s.accountClaimedAt,
        marketingOptIn: s.marketingOptIn,
        measurements: {
          heightCm: s.heightCm,
          weightKg: s.weightKg,
          fitPreference: s.fitPreference,
          bodyType: s.bodyType,
        },
        beautyProfile: {
          skinTone: s.skinTone,
          savedBeautyRoutineJson: s.savedBeautyRoutineJson,
        },
      })),
    };

    // 3. Store as a Notification for the merchant dashboard.
    //    NotificationKind has no DATA_EXPORT_READY value, so we use PRODUCT_AUDIT_READY
    //    and store the export type + customer context in the payload.
    const shopRecord = await prisma.shop.findUnique({ where: { shopifyDomain: shop }, select: { id: true } });
    if (shopRecord) {
      await prisma.notification.create({
        data: {
          shopId: shopRecord.id,
          kind: "PRODUCT_AUDIT_READY", // closest available kind; payload identifies this as a data export
          payload: {
            type: "data_export_ready",
            customerId: String(customerId),
            sessionCount: sessions.length,
            export: exportData,
          },
        },
      });
    }

    // 4. Audit log — no PII echoed in the log line (§3.5 #6).
    console.log(
      `[gdpr] ${topic} shop=${shop} customer=${customerId} — export created, ${sessions.length} session(s)`
    );
  } catch (err) {
    console.error(`[gdpr] ${topic} shop=${shop} customer=${customerId} — export failed`, err);
    return new Response(null, { status: 500 });
  }

  return new Response();
}
