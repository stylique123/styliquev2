// GET /api/admin/recommendations — list, tier-filtered.
// The action handlers (run, dismiss, taken) live in their own route files
// because Remix doesn't dynamic-route URL segments inside a single file's
// action(). Pre-audit, those were broken silently. Now split:
//   api.admin.recommendations.run.tsx
//   api.admin.recommendations.$id.$verb.tsx

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { getEffectivePlan } from "../lib/entitlement.server";
import { listRecommendations } from "../lib/recommendations.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop }, select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const plan = await getEffectivePlan(shop.id);
  if (!plan) return json({ ok: false, error: "plan_missing" }, { status: 400 });

  const rows = await listRecommendations({
    shopId: shop.id,
    visibleKinds: plan.features.recommendations.visibleKinds as Parameters<typeof listRecommendations>[0]["visibleKinds"],
    includeDismissed: new URL(request.url).searchParams.get("includeDismissed") === "1",
  });
  return json({ ok: true, data: rows });
}
