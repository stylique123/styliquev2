// Recommendations worker job — runs the brand-side rec engine for a shop.
//
// Triggered by:
//   • Nightly repeating job (one per active shop) enqueued at app boot
//   • Manual "Refresh now" button on the dashboard (calls
//     POST /api/admin/recommendations/run which enqueues here)

import { prisma } from "@stylique/db";
import { createRecommendationsService } from "@stylique/core";

const service = createRecommendationsService(prisma);

export type RecommendationsJobData = { shopId: string };

export async function processRecommendations(data: RecommendationsJobData) {
  const shop = await prisma.shop.findUnique({
    where: { id: data.shopId },
    select: { id: true, uninstalledAt: true },
  });
  if (!shop || shop.uninstalledAt) {
    return { skipped: true, reason: "shop_inactive" };
  }
  const result = await service.runAll(data.shopId);
  if (result.failed > 0) {
    throw new Error(
      `recommendations_partial_failure:${JSON.stringify({
        written: result.written,
        attempted: result.attempted,
        failed: result.failed,
        generatorFailures: result.generatorFailures,
        writeFailures: result.writeFailures,
        maintenanceFailures: result.maintenanceFailures,
      })}`,
    );
  }
  return result;
}
