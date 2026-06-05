// GET /api/external-overview
// Public overview endpoint for the external brand dashboard.
// Protected by a Bearer token issued via /api/external-auth.
//
// Response: same shape as buildOverview() + assistedRevenue

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { verifyExternalToken } from "../lib/external-auth.server";
import { buildOverview } from "../lib/dashboard.server";
import { prisma } from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization",
      },
    });
  }

  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;

  const verified = await verifyExternalToken(token);
  if (!verified) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const [data, assistedRevenueRows] = await Promise.all([
    buildOverview({ shopId: verified.shopId, windowDays: 30 }),
    prisma.analyticsEvent.findMany({
      where: {
        shopId: verified.shopId,
        name: "MIRA_ASSISTED_ORDER",
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: { payload: true },
    }),
  ]);

  const assistedRevenueCents = assistedRevenueRows.reduce((sum, row) => {
    const p = row.payload as { assistedRevenueCents?: number } | null;
    return sum + (p?.assistedRevenueCents ?? 0);
  }, 0);

  return json(
    {
      shopDomain: verified.shopDomain,
      ...data,
      assistedRevenue: {
        formatted: `$${(assistedRevenueCents / 100).toFixed(0)}`,
        orderCount: assistedRevenueRows.length,
      },
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
