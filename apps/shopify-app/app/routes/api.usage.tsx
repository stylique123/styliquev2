// GET /api/usage
//
// Returns a current-period usage summary for the internal Stylique ops dashboard.
// Lists per-shop usage counters — useful for monitoring quota burn, detecting
// shops approaching limits, and spotting billing anomalies.
//
// Auth: requireInternalAuth (X-Stylique-Internal header or sq_internal_token cookie).

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireInternalAuth } from "../lib/internal-auth.server";
import { prisma } from "../db.server";
import { currentPeriodStart } from "@stylique/core";
import type { UsageMetric } from "@stylique/types";

type UsageRow = {
  shopId: string;
  shopifyDomain: string;
  planTier: string;
  periodStart: Date;
  metrics: Record<string, number>;
};

export async function loader({ request }: LoaderFunctionArgs) {
  requireInternalAuth(request);

  const url = new URL(request.url);
  const shopId = url.searchParams.get("shopId") ?? undefined;
  const periodStart = currentPeriodStart();

  try {
    // Fetch all active shops (or one specific shop).
    const shops = await prisma.shop.findMany({
      where: {
        uninstalledAt: null,
        ...(shopId ? { id: shopId } : {}),
      },
      select: {
        id: true,
        shopifyDomain: true,
        plan: { select: { tier: true } },
      },
      orderBy: { installedAt: "desc" },
      take: 200,
    });

    // Fetch all usage counters for the current period.
    const counters = await prisma.usageCounter.findMany({
      where: {
        periodStart,
        ...(shopId ? { shopId } : { shopId: { in: shops.map((s) => s.id) } }),
      },
      select: { shopId: true, metric: true, count: true },
    });

    // Group counters by shopId.
    const countersByShop = new Map<string, Record<string, number>>();
    for (const c of counters) {
      if (!countersByShop.has(c.shopId)) {
        countersByShop.set(c.shopId, {});
      }
      countersByShop.get(c.shopId)![c.metric] = c.count;
    }

    const rows: UsageRow[] = shops.map((shop) => ({
      shopId: shop.id,
      shopifyDomain: shop.shopifyDomain,
      planTier: shop.plan?.tier ?? "NONE",
      periodStart,
      metrics: countersByShop.get(shop.id) ?? {},
    }));

    // Summary totals across all shops.
    const allMetrics = [
      "TRYON_PERSONAL",
      "TRYON_BODY",
      "STYLE_RECOMMENDATION",
      "FIT_RECOMMENDATION",
      "VISION_TURN",
      "STYLIST_TURN",
    ] as UsageMetric[];

    const totals: Record<string, number> = {};
    for (const metric of allMetrics) {
      totals[metric] = rows.reduce((sum, r) => sum + (r.metrics[metric] ?? 0), 0);
    }

    return json({
      ok: true,
      data: {
        periodStart,
        shopCount: rows.length,
        totals,
        shops: rows,
      },
    });
  } catch (err) {
    console.error("[api.usage] failed:", (err as Error).message);
    return json({ ok: false, error: "usage_unavailable" }, { status: 500 });
  }
}
