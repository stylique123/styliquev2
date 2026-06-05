// Replenishment notification — shopify-app side.
//
// This module is the admin-facing surface for the replenishment email system:
//   POST /api/admin/replenishment/notify  → enqueues the BullMQ job below
//
// The full send logic (DB queries, email builder, transport) lives in the
// worker job at apps/worker/src/jobs/replenishment-notify.ts — that keeps the
// worker within its @stylique/db dependency boundary without importing any
// Remix/shopify-app modules.
//
// This file also exports the thin helpers used by the shopify-app's own
// server-side preview (e.g. the dashboard tile showing "last notified" date).
//
// Klaviyo webhook stub is included at the bottom for when brands want to route
// through their own marketing automation instead of Stylique-sent mail.

import { prisma } from "../db.server";
import { enqueueReplenishmentNotify } from "../queue.server";

// ─── Admin trigger ────────────────────────────────────────────────────────────

export async function adminTriggerReplenishmentNotify(args: {
  shopId: string;
  daysAhead?: number;
}): Promise<{ ok: true; queued: true } | { ok: false; error: string }> {
  const shop = await prisma.shop.findUnique({
    where: { id: args.shopId },
    select: { id: true, uninstalledAt: true },
  });
  if (!shop || shop.uninstalledAt) {
    return { ok: false, error: "shop_not_installed" };
  }

  await enqueueReplenishmentNotify(
    { shopId: args.shopId, daysAhead: args.daysAhead },
    { jobId: `replenishment-manual:${args.shopId}:${Date.now()}` },
  );

  return { ok: true, queued: true };
}

// ─── Dashboard helpers ────────────────────────────────────────────────────────
// Returns the timestamp of the last replenishment notify run for this shop
// (i.e. the most recent BEAUTY_REPLENISHMENT_TRIGGERED event), plus a count of
// shoppers emailed in the last 30 days.

export async function getReplenishmentNotifyStats(shopId: string): Promise<{
  lastRunAt: Date | null;
  last30Days: number;
}> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [lastEvent, count] = await Promise.all([
    prisma.analyticsEvent.findFirst({
      where: { shopId, name: "BEAUTY_REPLENISHMENT_TRIGGERED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.analyticsEvent.count({
      where: {
        shopId,
        name: "BEAUTY_REPLENISHMENT_TRIGGERED",
        createdAt: { gte: since },
      },
    }),
  ]);

  return {
    lastRunAt: lastEvent?.createdAt ?? null,
    last30Days: count,
  };
}

// ─── Klaviyo webhook stub ─────────────────────────────────────────────────────
// For brands that route their transactional email through their own Klaviyo
// account instead of Stylique-sent mail. Set brandKlaviyoApiKey in
// Plan.planFeaturesJson.klaviyo to activate (not yet wired — see TODO below).
//
// TODO: implement the full Klaviyo Track API call.
//   Endpoint: POST https://a.klaviyo.com/api/track
//   Body: { token, event: "Replenishment Due",
//           customer_properties: { $email },
//           properties: { items, shopDomain } }
//   Reference: https://developers.klaviyo.com/en/docs/apis_overview

export interface KlaviyoReplenishmentWebhookConfig {
  /** Klaviyo private API key (brand-owned — stored in planFeaturesJson.klaviyo.apiKey) */
  apiKey: string;
  /** Klaviyo list ID to track the event against */
  listId?: string;
}

export type KlaviyoReplenishmentItem = {
  title: string;
  handle: string;
  cartUrl: string;
  daysUntilDue: number;
  urgency: "now" | "soon";
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function sendReplenishmentViaKlaviyo(
  _config: KlaviyoReplenishmentWebhookConfig,
  _to: string,
  _items: KlaviyoReplenishmentItem[],
  _shopDomain: string,
): Promise<void> {
  // TODO: implement Klaviyo Track API call.
  throw new Error(
    "Klaviyo replenishment webhook not yet implemented. " +
      "Set RESEND_API_KEY or SMTP_HOST to use Stylique-sent email instead.",
  );
}
