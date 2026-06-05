// GET /api/admin/credits — return creative usage and plan limits for this shop.
//
// Returns the sum of CREATIVE_GENERATED and CREATIVE_SET_GENERATED counters
// for the current calendar month, plus the plan limits from the Plan model.
// The Creative Studio uses this to render the credits bar on the dashboard.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

// ── Loader: GET ───────────────────────────────────────────────────────────
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      id: true,
      plan: {
        select: {
          monthlyCreatives: true,
          monthlyCreativeSets: true,
          creativeSets: true,
          tier: true,
        },
      },
    },
  });
  if (!shop) {
    return json({ ok: false, error: "shop_not_installed" }, { status: 404 });
  }

  // Start of the current calendar month in UTC.
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const counters = await prisma.usageCounter.findMany({
    where: {
      shopId: shop.id,
      metric: { in: ["CREATIVE_GENERATED", "CREATIVE_SET_GENERATED"] },
      periodStart: { gte: startOfMonth },
    },
    select: { metric: true, count: true },
  });

  const usedImages = counters
    .filter((c) => c.metric === "CREATIVE_GENERATED")
    .reduce((sum, c) => sum + c.count, 0);

  const usedSets = counters
    .filter((c) => c.metric === "CREATIVE_SET_GENERATED")
    .reduce((sum, c) => sum + c.count, 0);

  return json({
    ok: true,
    used: { images: usedImages, sets: usedSets },
    limits: {
      // monthlyCreatives is per-image limit; creativeSets is lifetime/monthly set limit.
      images: shop.plan?.monthlyCreatives ?? null,
      sets: shop.plan?.monthlyCreativeSets ?? shop.plan?.creativeSets ?? null,
    },
    plan: shop.plan
      ? {
          tier: shop.plan.tier,
        }
      : null,
  });
}

// ── Action: reject non-GET ────────────────────────────────────────────────
export async function action() {
  return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
