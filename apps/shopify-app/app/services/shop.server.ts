import { prisma } from "../db.server";
import { PLAN_DEFAULTS, encryptField } from "@stylique/core";
import { PLAN_FEATURES } from "@stylique/core/src/plans/features";

// Idempotent. Called from afterAuth on install/reinstall.
// Clears uninstalledAt on reinstall and ensures a Plan exists at default Growth tier.
export async function ensureShopRecord(args: {
  shopifyDomain: string;
  accessToken: string;
  scopes: string;
  currencyCode?: string;
}) {
  // OI-25: encrypted at-app when APP_ENCRYPTION_KEY env is set. See lib/crypto.server.ts
  const encryptedToken = encryptField(args.accessToken);
  const shop = await prisma.shop.upsert({
    where: { shopifyDomain: args.shopifyDomain },
    update: {
      accessToken: encryptedToken,
      scopes: args.scopes,
      uninstalledAt: null,
      ...(args.currencyCode ? { currencyCode: args.currencyCode } : {}),
    },
    create: {
      shopifyDomain: args.shopifyDomain,
      accessToken: encryptedToken,
      scopes: args.scopes,
      ...(args.currencyCode ? { currencyCode: args.currencyCode } : {}),
    },
  });

  const existingPlan = await prisma.plan.findUnique({ where: { shopId: shop.id } });
  if (!existingPlan) {
    const d = PLAN_DEFAULTS.STARTER;
    await prisma.plan.create({
      data: {
        shopId: shop.id,
        tier: "STARTER",
        monthlyTryOnPersonal: d.monthlyTryOnPersonal,
        monthlyTryOnBody: d.monthlyTryOnBody,
        monthlyStylistTurns: PLAN_FEATURES.STARTER.stylist.monthlyTurns,
        monthlyStyleRecs: PLAN_FEATURES.STARTER.widget.monthlyStyleRecs,
        monthlyFitRecs: PLAN_FEATURES.STARTER.widget.monthlyFitRecs,
        analyticsLevel: "BASIC",
        supportLevel: "STANDARD",
        planFeaturesJson: {
          billing: {
            status: "trial",
            tier: "STARTER",
            source: "install_default",
            initializedAt: new Date().toISOString(),
          },
        },
      },
    });
  }

  return shop;
}

export async function markShopUninstalled(shopifyDomain: string) {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain } });
  if (!shop) return;
  await prisma.shop.update({
    where: { id: shop.id },
    data: { uninstalledAt: new Date() },
  });
  await prisma.notification.create({
    data: {
      shopId: shop.id,
      kind: "APP_UNINSTALLED",
      payload: { at: new Date().toISOString() },
    },
  });
}
