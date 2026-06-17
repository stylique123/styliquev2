/**
 * Stylique Pilot Feature Flags
 * All flags read from process.env at request time.
 * Set any flag to "false" in the hosting platform secrets to disable instantly without redeploy.
 * Per-shop overrides are stored in Shop.planFeaturesJson.pilotFlags.
 */

export interface FeatureFlags {
  mira: boolean;
  vto: boolean;
  sizeRecommendation: boolean;
  outfitRecommendation: boolean;
  bundleCart: boolean;
}

export function getFeatureFlags(): FeatureFlags {
  return {
    mira: envFlag('ENABLE_MIRA', true),
    vto: envFlag('ENABLE_VTO', true),
    sizeRecommendation: envFlag('ENABLE_SIZE_REC', true),
    outfitRecommendation: envFlag('ENABLE_OUTFIT_REC', true),
    bundleCart: envFlag('ENABLE_BUNDLE_CART', true),
  };
}

export async function getShopFeatureFlags(
  shopId: string,
  prisma: { shop: { findUnique: (args: any) => Promise<any> } }
): Promise<FeatureFlags> {
  const global = getFeatureFlags();
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { planFeaturesJson: true },
  });
  const overrides = (shop?.planFeaturesJson as any)?.pilotFlags ?? {};
  return {
    mira: overrides.mira ?? global.mira,
    vto: overrides.vto ?? global.vto,
    sizeRecommendation: overrides.sizeRecommendation ?? global.sizeRecommendation,
    outfitRecommendation: overrides.outfitRecommendation ?? global.outfitRecommendation,
    bundleCart: overrides.bundleCart ?? global.bundleCart,
  };
}

export function getDisabledMessage(feature: keyof FeatureFlags): string {
  const messages: Record<keyof FeatureFlags, string> = {
    mira: 'AI styling assistant is temporarily unavailable. Please browse our full collection.',
    vto: 'Virtual try-on is temporarily unavailable. Please consult our size guide.',
    sizeRecommendation: 'Size recommendations are temporarily unavailable. Please see our size guide.',
    outfitRecommendation: 'Outfit suggestions are temporarily unavailable.',
    bundleCart: 'Bundle checkout is temporarily unavailable. Please add items individually.',
  };
  return messages[feature];
}

function envFlag(key: string, defaultVal: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultVal;
  return val === 'true' || val === '1';
}
