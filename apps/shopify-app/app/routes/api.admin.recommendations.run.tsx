// POST /api/admin/recommendations/run — manual trigger for the rec engine.
// Same problem as :id/:verb: it lived inside the parent file's action with
// URL-segment parsing that never matched. Split into its own route file.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { runAllRecommendations } from "../lib/recommendations.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop }, select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  try {
    const result = await runAllRecommendations(shop.id);
    if (result.failed > 0) {
      return json(
        { ok: false, error: "recommendations_run_partial_failure", data: result },
        { status: 207 },
      );
    }
    return json({ ok: true, data: result });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "recommendations_run_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
