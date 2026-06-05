// Internal helpers shared across shopper API modules.
// Not exported from the public barrel — consumers should use shopper.server.ts.

import { prisma } from "../db.server";
import { rateOk as rateOkAsync } from "./ratelimit.server";
import { createAnalyticsService } from "@stylique/core";

export async function shopIdFromDomain(shopifyDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain },
    select: { id: true, uninstalledAt: true },
  });
  if (!shop || shop.uninstalledAt) return null;
  return shop.id;
}

export async function rateOk(shopKey: string, shopperKey?: string | null): Promise<boolean> {
  return rateOkAsync(shopKey, shopperKey ?? null);
}

export const analytics = createAnalyticsService(prisma);
