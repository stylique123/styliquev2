// Stylique Beauty — shopper-facing API handlers.
//
// These are called directly from the widget (not via the Brain LLM turn),
// making them fast and deterministic. They wrap the same core logic as the
// beauty brain tool handlers but expose a REST surface for the widget.
//
// Routes (all App Proxy — HMAC-verified shopDomain):
//   GET  api/beauty/profile           — read current skin profile
//   POST api/beauty/profile           — save skin type/concerns/undertone/hex
//   POST api/beauty/shade-match       — find foundation/concealer shade matches
//   POST api/beauty/routine           — build personalised AM/PM routine

import { z } from "zod";
import {
  matchShades, buildRoutineScaffold, scoreProductForSlot, buildRoutineName,
  parseShadeUndertone, parseShadeDepth,
  type ProductShadeInfo, type SkinConcern, type SkinType,
  type SkinDepth, type SkinUndertone,
} from "@stylique/core";
import { prisma } from "../db.server";
import { shopIdFromDomain, rateOk, analytics } from "./shopper-helpers.server";
import { getOrCreateShopperSession } from "./session.server";
import type { ApiResponse } from "./shopper-types.server";

// ─── Schema ──────────────────────────────────────────────────────────────────

const SkinProfileUpdateSchema = z.object({
  skinType:         z.enum(["oily", "dry", "combination", "normal", "sensitive"]).optional(),
  concerns:         z.array(z.string()).max(5).optional(),
  skinDepth:        z.enum(["light", "light-medium", "medium", "medium-deep", "deep"]).optional(),
  undertone:        z.enum(["warm", "cool", "neutral", "olive"]).optional(),
  skinHex:          z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  budgetMax:        z.number().positive().optional(),
  routinePreference: z.enum(["minimal", "standard", "full"]).optional(),
});

const ShadeMatchInputSchema = z.object({
  category:    z.string().default("foundation"),
  inStockOnly: z.boolean().default(true),
  limit:       z.number().int().min(1).max(10).default(3),
});

const RoutineInputSchema = z.object({
  timeOfDay:     z.enum(["AM", "PM", "both"]).default("both"),
  includesMakeup: z.boolean().default(false),
  maxProducts:   z.number().int().min(1).max(12).default(6),
  focusConcern:  z.string().optional(),
});

// ─── Shared routine response type ───────────────────────────────────────────

export type BeautyRoutineResponse = {
  name: string;
  timeOfDay: string;
  steps: Array<{
    step: string;
    productId: string;
    handle: string;
    title: string;
    imageUrl: string | null;
    priceUsd: number | null;
    variantShopifyId: string | null;
    whyForYou: string;
    inStock: boolean;
  }>;
  totalPriceUsd: number;
  shopifyVariantIds: string[];
  savedAt?: Date | null;
};

// ─── GET api/beauty/profile ──────────────────────────────────────────────────

export async function getBeautyProfile(args: {
  shopDomain: string;
  shopperCookieId: string | null;
}): Promise<ApiResponse<{
  skinType: string | null;
  concerns: SkinConcern[];
  skinDepth: string | null;
  undertone: string | null;
  skinHex: string | null;
  routinePreference: string | null;
  analyzedAt: Date | null;
  hasProfile: boolean;
}>> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) {
    return { ok: false, error: "rate_limited" };
  }
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const { row } = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  // §3 invariant #1 — findFirst with shopifyDomain guard for defence-in-depth.
  const session = await prisma.shopperSession.findFirst({
    where: { id: row.id, shopifyDomain: args.shopDomain },
    select: {
      skinTypeBeauty: true,
      skinConcernsJson: true,
      skinDepth: true,
      skinUndertone: true,
      skinHex: true,
      routinePreference: true,
      skinAnalyzedAt: true,
    },
  });

  const concerns = (session?.skinConcernsJson as SkinConcern[] | null) ?? [];

  return {
    ok: true,
    data: {
      skinType: session?.skinTypeBeauty ?? null,
      concerns,
      skinDepth: session?.skinDepth ?? null,
      undertone: session?.skinUndertone ?? null,
      skinHex: session?.skinHex ?? null,
      routinePreference: session?.routinePreference ?? null,
      analyzedAt: session?.skinAnalyzedAt ?? null,
      hasProfile: !!(session?.skinTypeBeauty || concerns.length),
    },
  };
}

// ─── GET api/beauty/routine ───────────────────────────────────────────────────
// Returns the last routine saved for this shopper, or null when none exists yet.
// The widget calls this on Step 3 mount to instantly restore a cached routine
// before deciding whether to re-build. Mira's Brain context builder also reads
// it so she can discuss the routine in conversation without calling build_routine.

export async function getBeautyRoutine(args: {
  shopDomain: string;
  shopperCookieId: string | null;
}): Promise<ApiResponse<BeautyRoutineResponse | null>> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) {
    return { ok: false, error: "rate_limited" };
  }
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const { row } = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  // §3 invariant #1 — findFirst with shopifyDomain guard.
  const session = await prisma.shopperSession.findFirst({
    where: { id: row.id, shopifyDomain: args.shopDomain },
    select: { savedBeautyRoutineJson: true, skinRoutineSavedAt: true },
  });

  if (!session?.savedBeautyRoutineJson) {
    return { ok: true, data: null };
  }

  const routine = session.savedBeautyRoutineJson as BeautyRoutineResponse;
  return {
    ok: true,
    data: { ...routine, savedAt: session.skinRoutineSavedAt },
  };
}

// ─── POST api/beauty/profile ─────────────────────────────────────────────────

export async function postBeautyProfile(args: {
  shopDomain: string;
  shopperCookieId: string | null;
  body: unknown;
}): Promise<ApiResponse<{ saved: Record<string, unknown> }>> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) {
    return { ok: false, error: "rate_limited" };
  }
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const parsed = SkinProfileUpdateSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const { row } = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  const update: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.skinType)          update.skinTypeBeauty = d.skinType;
  if (d.concerns?.length)  update.skinConcernsJson = d.concerns;
  if (d.skinDepth)         update.skinDepth = d.skinDepth;
  if (d.undertone)         update.skinUndertone = d.undertone;
  if (d.skinHex)           update.skinHex = d.skinHex;
  if (d.budgetMax != null) update.budgetMax = d.budgetMax;
  if (d.routinePreference) update.routinePreference = d.routinePreference;

  if (!Object.keys(update).length) return { ok: true, data: { saved: {} } };

  // §3 invariant #1 — updateMany with shopifyDomain guard prevents cross-tenant write.
  await prisma.shopperSession.updateMany({
    where: { id: row.id, shopifyDomain: args.shopDomain },
    data: update,
  });

  // Fire-and-forget analytics. BEAUTY_SKIN_PROFILE_CAPTURED requires a complete
  // profile (skinType/concerns/depth/undertone) which may not all be present in a
  // single partial update — we read back the merged state and fire only when the
  // profile has at least skinType set (the minimum signal worth recording).
  void (async () => {
    if (!shopId) return;
    const merged = await prisma.shopperSession.findFirst({
      where: { id: row.id, shopifyDomain: args.shopDomain },
      select: { skinTypeBeauty: true, skinConcernsJson: true, skinDepth: true, skinUndertone: true },
    }).catch(() => null);
    if (!merged?.skinTypeBeauty) return;
    await analytics.track({
      shopId: shopId!,
      shopperId: row.id,
      name: "BEAUTY_SKIN_PROFILE_CAPTURED",
      payload: {
        skinType: merged.skinTypeBeauty,
        concerns: (merged.skinConcernsJson as string[] | null) ?? [],
        depth: merged.skinDepth ?? "unknown",
        undertone: merged.skinUndertone ?? "unknown",
        source: "widget",
      },
    }).catch(() => undefined);
  })();

  return { ok: true, data: { saved: update } };
}

// ─── POST api/beauty/shade-match ─────────────────────────────────────────────

export async function postBeautyShadeMatch(args: {
  shopDomain: string;
  shopperCookieId: string | null;
  body: unknown;
}): Promise<ApiResponse<{
  matches: ReturnType<typeof matchShades>;
  profile: { skinHex: string | null; undertone: string | null; depth: string | null };
}>> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) {
    return { ok: false, error: "rate_limited" };
  }
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const parsed = ShadeMatchInputSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { category, inStockOnly, limit } = parsed.data;

  const { row } = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  // Read skin profile (§3 invariant #1 — findFirst with shopifyDomain guard)
  const session = await prisma.shopperSession.findFirst({
    where: { id: row.id, shopifyDomain: args.shopDomain },
    select: { skinHex: true, skinUndertone: true, skinDepth: true },
  });

  // Fetch matching products (shopId-scoped — §3.5 invariant #1)
  const products = await prisma.product.findMany({
    where: { shopId, category: { contains: category, mode: "insensitive" } },
    include: {
      variants: { where: { availableForSale: true } },
      images: { orderBy: { position: "asc" }, take: 1 },
    },
    take: 60,
  });

  const shadeProducts: ProductShadeInfo[] = products.map(p => ({
    productId: p.id,
    productHandle: p.handle,
    productTitle: p.title,
    imageUrl: p.images[0]?.url ?? null,
    shades: p.variants.map(v => ({
      variantId: v.shopifyId ?? v.id,
      shadeName: v.color ?? v.size ?? p.title,
      undertoneHint: parseShadeUndertone(v.color ?? v.size ?? ""),
      depthHint: parseShadeDepth(v.color ?? v.size ?? ""),
      inStock: v.availableForSale ?? true,
    })),
  }));

  const matches = matchShades(
    shadeProducts,
    {
      skinHex: session?.skinHex ?? undefined,
      undertone: (session?.skinUndertone as SkinUndertone) ?? undefined,
      depth: (session?.skinDepth as SkinDepth) ?? undefined,
    },
    { limit, inStockOnly },
  );

  // Fire analytics for the top match (fire-and-forget).
  // BEAUTY_SHADE_MATCHED schema is matched to the ShadeMatch return shape.
  if (matches.length > 0) {
    const top = matches[0];
    // ShadeMatch returns matchScore (0–1); we map to the event schema fields.
    void analytics.track({
      shopId,
      shopperId: row.id,
      name: "BEAUTY_SHADE_MATCHED",
      payload: {
        productId: top.productId,
        shadeVariantId: top.productHandle,      // best available ID at this layer
        confidence: top.matchScore,
        undertoneMatch: top.matchScore >= 0.7,
        depthMatch: true,                        // depth scored inside matchShades
      },
    }).catch(() => undefined);
  }

  return {
    ok: true,
    data: {
      matches,
      profile: {
        skinHex: session?.skinHex ?? null,
        undertone: session?.skinUndertone ?? null,
        depth: session?.skinDepth ?? null,
      },
    },
  };
}

// ─── POST api/beauty/routine ─────────────────────────────────────────────────

export async function postBeautyRoutine(args: {
  shopDomain: string;
  shopperCookieId: string | null;
  body: unknown;
}): Promise<ApiResponse<{
  name: string;
  timeOfDay: string;
  steps: Array<{
    step: string;
    productId: string;
    handle: string;
    title: string;
    imageUrl: string | null;
    priceUsd: number | null;
    variantShopifyId: string | null;
    whyForYou: string;
    inStock: boolean;
  }>;
  totalPriceUsd: number;
  shopifyVariantIds: string[];
}>> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) {
    return { ok: false, error: "rate_limited" };
  }
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const parsed = RoutineInputSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { timeOfDay, includesMakeup, maxProducts, focusConcern } = parsed.data;

  const { row } = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  // Read skin profile (§3 invariant #1 — findFirst with shopifyDomain guard)
  const session = await prisma.shopperSession.findFirst({
    where: { id: row.id, shopifyDomain: args.shopDomain },
    select: { skinTypeBeauty: true, skinConcernsJson: true, budgetMax: true },
  });

  const rawConcerns = (session?.skinConcernsJson as string[] | null) ?? [];
  const concerns: SkinConcern[] = (focusConcern
    ? [focusConcern, ...rawConcerns.filter(c => c !== focusConcern)]
    : rawConcerns) as SkinConcern[];

  if (!concerns.length) {
    return { ok: false, error: "invalid_input" };
  }

  const skinType = session?.skinTypeBeauty as SkinType | undefined;
  const budgetMax = session?.budgetMax ?? undefined;

  const slots = buildRoutineScaffold(concerns, timeOfDay, includesMakeup);

  // Fetch all products (shopId-scoped)
  const allProducts = await prisma.product.findMany({
    where: { shopId },
    include: {
      variants: { where: { availableForSale: true }, take: 1 },
      images: { orderBy: { position: "asc" }, take: 1 },
    },
    take: 200,
  });

  const steps: Array<{
    step: string;
    productId: string;
    handle: string;
    title: string;
    imageUrl: string | null;
    priceUsd: number | null;
    variantShopifyId: string | null;
    whyForYou: string;
    inStock: boolean;
  }> = [];
  const usedIds = new Set<string>();

  for (const slot of slots.slice(0, maxProducts)) {
    let bestScore = -1;
    let bestProduct: typeof allProducts[0] | null = null;

    for (const product of allProducts) {
      if (usedIds.has(product.id)) continue;
      const priceCents = product.variants[0]?.priceCents ?? 0;
      if (budgetMax && priceCents > budgetMax * 100) continue;

      const score = scoreProductForSlot(
        { title: product.title, tags: product.tags ?? [], category: product.category ?? undefined },
        slot, concerns, skinType,
      );
      if (score > bestScore) { bestScore = score; bestProduct = product; }
    }

    if (bestProduct && bestScore > 0) {
      usedIds.add(bestProduct.id);
      const v = bestProduct.variants[0];
      steps.push({
        step: slot.step,
        productId: bestProduct.id,
        handle: bestProduct.handle,
        title: bestProduct.title,
        imageUrl: bestProduct.images[0]?.url ?? null,
        priceUsd: v ? (v.priceCents ?? 0) / 100 : null,
        variantShopifyId: v?.shopifyId ?? null,
        whyForYou: slot.whyForConcern,
        inStock: v?.availableForSale ?? true,
      });
    }
  }

  const totalPriceUsd = steps.reduce((s, p) => s + (p.priceUsd ?? 0), 0);

  const routinePayload = {
    name: buildRoutineName(concerns, timeOfDay),
    timeOfDay,
    steps,
    totalPriceUsd: Math.round(totalPriceUsd * 100) / 100,
    shopifyVariantIds: steps.map(s => s.variantShopifyId).filter(Boolean) as string[],
  };

  // Persist the routine so that:
  //   (1) GET api/beauty/routine can return the cached result on widget Step 3 re-open
  //       without re-running the scorer (potentially hitting 200 products).
  //   (2) buildBeautyBrainContext() can surface the saved routine to Mira so she can
  //       discuss it in conversation without calling build_routine every turn.
  // §3 invariant #1 — updateMany with shopifyDomain guard prevents cross-tenant write.
  await prisma.shopperSession.updateMany({
    where: { id: row.id, shopifyDomain: args.shopDomain },
    data: {
      savedBeautyRoutineJson: routinePayload,
      skinRoutineSavedAt: new Date(),
    },
  });

  // Fire analytics event (fire-and-forget).
  void analytics.track({
    shopId,
    shopperId: row.id,
    name: "BEAUTY_ROUTINE_BUILT",
    payload: {
      productIds: steps.map(s => s.productId),
      totalAmPm: timeOfDay as "am" | "pm" | "both",
      estimatedAovCents: Math.round(routinePayload.totalPriceUsd * 100),
    },
  }).catch(() => undefined);

  return {
    ok: true,
    data: routinePayload,
  };
}
