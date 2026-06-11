// Handlers for the public shopper API. Mounted under the Shopify App Proxy:
//   /apps/stylique/api/product?handle=…
//   /apps/stylique/api/entitlement?productId=…
//   /apps/stylique/api/fit          POST
//   /apps/stylique/api/style        POST
//   /apps/stylique/api/events       POST
//
// SECURITY INVARIANTS (do not break any of these):
//   • Never include `accessToken`, `scopes`, `shopId`, internal cuids, or anything not
//     present in `ShopperProduct` / `ShopperOutfitItem` below.
//   • Resolve `shop` ONLY from the verified `session.shop` provided by
//     authenticate.public.appProxy. Never trust a query/body field claiming to be a shop.
//   • Tenant isolation: every query is filtered by the resolved `shopId`. Cross-shop reads
//     are impossible by construction.
//   • Validate every input through zod before touching the DB.
//
// This file is now a barrel + the few handlers that didn't move to sub-modules.
// Sub-modules:
//   account.server.ts        — getMe/getShopperMe, postShopperAccount, postShopperAccountVerify, postShopperSignal
//   shopper-events.server.ts — postEvent, getSocialProof/getShopperSocialProof, postComboFeedback

import { z } from "zod";
import { prisma } from "../db.server";
import {
  recommendFit,
  calculateZoneFit,
  buildOutfit,
  buildColorCombos,
  type StyleProduct,
  type SizeChartEntry,
  type ZoneFitResult,
} from "@stylique/core";
import { toShopperProduct, type ShopperProduct } from "./serialize";
import { renderTryOn, renderComboTryOn } from "./tryon.server";
import { getOrCreateShopperSession } from "./session.server";
import { canConsume, recordConsume, isFeatureEnabled as hasFeature } from "./entitlement.server";
import { shopIdFromDomain, rateOk, analytics } from "./shopper-helpers.server";
import { readTasteVector } from "./taste.server";
import type { ShopperOutfitItem } from "./shopper-types.server";

// ─── Barrel re-exports ─────────────────────────────────────────────────────────
// Consumers that import from "./shopper.server" continue to work unchanged.
export type { ApiResponse, ShopperOutfitItem, ShopperEntitlement, ShopperFit } from "./shopper-types.server";
export type { ShopperProduct } from "./serialize";
export * from "./account.server";
export * from "./shopper-events.server";

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Parse Product.sizeChartJson into Record<size, SkuMeasurements> for recommendFit.
 * Accepts NormalizedSizeChart ({sizes: [{name, chest, waist, hip, length}]}) shape.
 * Returns undefined when unparseable so recommendFit falls back to category defaults.
 */
function parseSkuMeasurements(
  json: unknown,
): Record<string, { chest?: number; waist?: number; hip?: number; length?: number; sleeve?: number }> | undefined {
  if (!json) return undefined;
  try {
    const chart = json as { sizes?: Array<{ name?: string; chest?: number; waist?: number; hip?: number; length?: number; sleeve?: number }> };
    if (!Array.isArray(chart.sizes)) return undefined;
    const out: Record<string, { chest?: number; waist?: number; hip?: number; length?: number; sleeve?: number }> = {};
    for (const s of chart.sizes) {
      if (!s.name) continue;
      out[s.name] = {
        chest: s.chest,
        waist: s.waist,
        hip:   s.hip,
        length: s.length,
        sleeve: s.sleeve,
      };
    }
    return Object.keys(out).length ? out : undefined;
  } catch { return undefined; }
}

function toStyleProduct(p: ShopperProduct): StyleProduct {
  return {
    id: p.id, handle: p.handle, title: p.title,
    category: p.category, primaryColor: p.primaryColor, colorFamily: p.colorFamily,
    imageUrl: p.imageUrl ?? undefined,
  };
}

function dominantKeys(map: Record<string, number> | undefined, limit = 3): Set<string> {
  return new Set(
    Object.entries(map ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k]) => k.toLowerCase()),
  );
}

function rankCatalogByTaste(catalog: ShopperProduct[], taste: Awaited<ReturnType<typeof readTasteVector>>): ShopperProduct[] {
  if (!taste) return catalog;
  const colors = dominantKeys(taste.colorFamily);
  const categories = dominantKeys(taste.category);
  const topProducts = new Set(taste.topProducts ?? []);
  return [...catalog].sort((a, b) => {
    const score = (p: ShopperProduct) => {
      let s = 0;
      if (p.colorFamily && colors.has(p.colorFamily.toLowerCase())) s += 2;
      if (p.category && categories.has(p.category.toLowerCase())) s += 2;
      if (topProducts.has(p.id)) s += 3;
      return s;
    };
    return score(b) - score(a);
  });
}

// ─── GET /api/product?handle= ──────────────────────────────────────────────────

export async function getProduct(args: { shopDomain: string; handle: string; shopperCookieId?: string | null }) {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false as const, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false as const, error: "shop_not_installed" };

  // D37 — pull primaryTryonImageId / tryonReady / widgetTier alongside
  // the full image list (with ids) so toShopperProduct can resolve the
  // tryon URL without a second query. The widget reads widgetTier from
  // the response and branches: 1=full / 2=carousel / 3=size-only.
  const p = await prisma.product.findFirst({
    where: { shopId, handle: args.handle },
    select: {
      id: true, handle: true, title: true, category: true,
      primaryColor: true, colorFamily: true,
      primaryTryonImageId: true, tryonReady: true, widgetTier: true,
      images: { select: { id: true, url: true }, orderBy: { position: "asc" } },
      variants: { select: { size: true } },
    },
  });
  if (!p) return { ok: false as const, error: "product_not_found" };
  return { ok: true as const, data: toShopperProduct(p) };
}

// ─── GET /api/entitlement?productId= ──────────────────────────────────────────
// Personal-photo try-on is gated by Plan.monthlyTryOnPersonal usage. Today we
// don't have a real VTO provider yet — entitlement is hardcoded to false so the
// widget hides the upload control. Body-model preview is always on.

export async function getEntitlement(args: { shopDomain: string; shopperCookieId?: string | null }) {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false as const, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false as const, error: "shop_not_installed" };
  // Real entitlement (Sprint 6 / D34). Personal photo requires BOTH the feature
  // flag AND remaining monthly quota. Body-model preview is universally on.
  const [featureOn, proactiveTriggers] = await Promise.all([
    hasFeature(shopId, "widget.personalPhotoTryOn"),
    hasFeature(shopId, "stylist.proactiveTriggers"),
  ]);
  let quotaOk = false;
  if (featureOn) {
    const gate = await canConsume({ shopId, metric: "TRYON_PERSONAL" });
    quotaOk = gate.allowed;
  }
  return {
    ok: true as const,
    data: {
      personalPhotoAllowed: featureOn && quotaOk,
      bodyModelAllowed: true as const,
      proactiveTriggers,        // Growth+: intent-triggered proactive opens
    },
  };
}

// ─── POST /api/fit ────────────────────────────────────────────────────────────

const FitSchema = z.object({
  productId: z.string().min(1),
  heightCm: z.number().int().min(80).max(230),
  weightKg: z.number().int().min(25).max(250),
  fitPreference: z.enum(["FITTED", "REGULAR", "RELAXED", "SLIM", "OVERSIZED"]),
  bodyType: z.enum(["PETITE", "SLIM", "REGULAR", "CURVY", "PLUS", "TALL"]).optional(),
  chestCm: z.number().min(50).max(180).optional(),
  waistCm: z.number().min(40).max(160).optional(),
  hipCm:   z.number().min(50).max(200).optional(),
});

export async function postFit(args: { shopDomain: string; body: unknown; shopperCookieId?: string | null }) {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false as const, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false as const, error: "shop_not_installed" };

  const parsed = FitSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" };
  const fitGate = await canConsume({ shopId, metric: "FIT_RECOMMENDATION" });
  if (!fitGate.allowed) return { ok: false as const, error: fitGate.reason === "QUOTA_EXHAUSTED" ? "quota_reached" : "feature_disabled" };

  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, shopId },     // shop-scoped lookup
    select: { category: true, sizeChartJson: true, variants: { select: { size: true } } },
  });
  if (!product) return { ok: false as const, error: "product_not_found" };

  const session = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId ?? null,
  });
  const updateData: {
    heightCm: number; weightKg: number; fitPreference: (typeof parsed.data)["fitPreference"];
    bodyType?: string; chestCm?: number; waistCm?: number; hipCm?: number;
    lastSeenAt: Date;
  } = {
    heightCm: parsed.data.heightCm,
    weightKg: parsed.data.weightKg,
    fitPreference: parsed.data.fitPreference,
    lastSeenAt: new Date(),
  };
  if (parsed.data.bodyType != null) updateData.bodyType = parsed.data.bodyType;
  if (parsed.data.chestCm != null) updateData.chestCm = parsed.data.chestCm;
  if (parsed.data.waistCm != null) updateData.waistCm = parsed.data.waistCm;
  if (parsed.data.hipCm   != null) updateData.hipCm   = parsed.data.hipCm;
  void prisma.shopperSession.update({
    where: { id: session.row.id },
    data: updateData,
  }).catch(() => undefined);

  const sizes = Array.from(new Set(product.variants.map((v) => v.size).filter((s): s is string => Boolean(s))));

  // Product carries no sized variants — recommendFit would return a placeholder
  // "—" / confidence 0 that the widget renders as a real recommendation (panel
  // P2). Return an honest error instead so the UI can degrade cleanly.
  if (sizes.length === 0) return { ok: false as const, error: "invalid_input" };

  // Parse sizeChartJson into skuMeasurements for per-SKU fit accuracy (Fix 4).
  const skuMeasurements = parseSkuMeasurements(product.sizeChartJson);

  // Past-purchase + brand-bias signals from analytics events (Fix 5/6).
  let purchaseCount = 0;
  try {
    purchaseCount = await prisma.analyticsEvent.count({
      where: { shopId, shopperId: session.row.id, name: "CART_CONFIRMED" },
    });
  } catch { /* non-blocking */ }

  const result = recommendFit({
    heightCm: parsed.data.heightCm,
    weightKg: parsed.data.weightKg,
    fitPreference: parsed.data.fitPreference,
    bodyType: parsed.data.bodyType,
    category: product.category,
    availableSizes: sizes,
    chest: parsed.data.chestCm,
    waist: parsed.data.waistCm,
    hip:   parsed.data.hipCm,
    skuMeasurements,
    hasPastPurchase: purchaseCount > 0,
    brandBiasCount: purchaseCount,
  });

  // ─── Zone-specific fit from sizeChartJson ─────────────────────────────────
  // Parse the product's size chart and find the entry matching the recommended
  // size. Then compute per-zone fit notes (chest/waist/hip) using the shopper's
  // actual body measurements vs. garment measurements.
  let fitZones: ZoneFitResult = {};
  try {
    if (
      product.sizeChartJson &&
      (parsed.data.chestCm || parsed.data.waistCm || parsed.data.hipCm)
    ) {
      const rawChart = product.sizeChartJson as unknown;
      let entries: SizeChartEntry[] | null = null;

      // sizeChartJson may be stored as NormalizedSizeChart ({sizes: [...]}) or
      // directly as SizeChartEntry[]. Handle both shapes.
      if (Array.isArray(rawChart)) {
        entries = rawChart as SizeChartEntry[];
      } else if (rawChart && typeof rawChart === "object" && "sizes" in rawChart) {
        const normalized = rawChart as { sizes: Array<{ name: string; chest?: number; waist?: number; hip?: number; length?: number }> };
        entries = normalized.sizes.map((s) => ({
          size: s.name,
          chestCm: s.chest,
          waistCm: s.waist,
          hipCm: s.hip,
          lengthCm: s.length,
        }));
      }

      if (entries) {
        const matched = entries.find(
          (e) => e.size?.toUpperCase() === result.recommendedSize?.toUpperCase()
        );
        if (matched) {
          fitZones = calculateZoneFit(
            {
              chestCm: parsed.data.chestCm,
              waistCm: parsed.data.waistCm,
              hipCm:   parsed.data.hipCm,
            },
            matched,
            parsed.data.fitPreference,
          );
        }
      }
    }
  } catch {
    // Non-fatal: zone data is best-effort
    fitZones = {};
  }

  void prisma.fitSession.create({
    data: {
      shopId,
      shopperId: session.row.id,
      productId: parsed.data.productId,
      recommendedSize: result.recommendedSize,
      confidence: result.confidence,
      reasoning: {
        rationale: result.rationale,
        fitPreference: parsed.data.fitPreference,
        bodyType: parsed.data.bodyType,
        fitZones,
      } as object,
    },
  }).catch(() => undefined);
  void analytics.track({
    shopId,
    shopperId: session.row.id,
    name: "FIT_RECOMMENDED",
    productId: parsed.data.productId,
    payload: { size: result.recommendedSize, confidence: result.confidence },
  }).catch(() => undefined);
  void analytics.track({
    shopId,
    shopperId: session.row.id,
    name: "WIDGET_FIT_SUBMITTED",
    productId: parsed.data.productId,
    payload: {
      heightCm: parsed.data.heightCm,
      weightKg: parsed.data.weightKg,
      fitPreference: parsed.data.fitPreference,
      bodyType: parsed.data.bodyType,
      chestCm: parsed.data.chestCm,
      waistCm: parsed.data.waistCm,
      hipCm: parsed.data.hipCm,
      recommendedSize: result.recommendedSize,
      confidence: result.confidence,
    },
  }).catch(() => undefined);
  void recordConsume({ shopId, metric: "FIT_RECOMMENDATION", by: 1 });
  return { ok: true as const, data: { ...result, fitZones } };
}

// ─── POST /api/style ──────────────────────────────────────────────────────────

const StyleSchema = z.object({
  productId: z.string().min(1),
  colorOnly: z.boolean().optional(),
});

export async function postStyle(args: { shopDomain: string; body: unknown; shopperCookieId?: string | null }) {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false as const, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false as const, error: "shop_not_installed" };

  const parsed = StyleSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" };
  const styleGate = await canConsume({ shopId, metric: "STYLE_RECOMMENDATION" });
  if (!styleGate.allowed) return { ok: false as const, error: styleGate.reason === "QUOTA_EXHAUSTED" ? "quota_reached" : "feature_disabled" };

  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, shopId },
    include: { images: { orderBy: { position: "asc" }, take: 1 }, variants: { select: { size: true } } },
  });
  if (!product) return { ok: false as const, error: "product_not_found" };

  const anchor = toShopperProduct(product);
  const session = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId ?? null,
  });

  if (parsed.data.colorOnly) {
    const combos = anchor.colorFamily
      ? buildColorCombos(anchor.colorFamily, anchor.primaryColor ?? undefined)
      : buildColorCombos("white");
    void analytics.track({
      shopId,
      shopperId: session.row.id,
      name: "COLOR_COMBO_VIEWED",
      productId: anchor.id,
      payload: { comboName: combos[0]?.name ?? "Color combos" },
    }).catch(() => undefined);
    void recordConsume({ shopId, metric: "STYLE_RECOMMENDATION", by: 1 });
    return { ok: true as const, data: { outfit: [] as ShopperOutfitItem[], colorCombos: combos } };
  }

  const catalogRows = await prisma.product.findMany({
    where: { shopId, id: { not: product.id } },
    take: 60,
    include: { images: { orderBy: { position: "asc" }, take: 1 }, variants: { select: { size: true } } },
  });
  const catalog = catalogRows.map(toShopperProduct);
  const taste = await readTasteVector(session.row.id).catch(() => null);
  const tasteRankedCatalog = rankCatalogByTaste(catalog, taste);

  const result = buildOutfit(toStyleProduct(anchor), [toStyleProduct(anchor), ...tasteRankedCatalog.map(toStyleProduct)]);

  // Re-hydrate StyleProduct → ShopperProduct using the catalog map. Anchor first.
  const byId = new Map<string, ShopperProduct>([[anchor.id, anchor], ...catalog.map((c) => [c.id, c] as const)]);
  const outfit: ShopperOutfitItem[] = result.outfit.flatMap((i) => {
    const sp = byId.get(i.product.id);
    if (!sp) return [];
    return [{ product: sp, role: i.role as string, colorNote: i.colorNote }];
  });

  void prisma.styleSession.create({
    data: {
      shopId,
      shopperId: session.row.id,
      productId: product.id,
      outfitJson: outfit.map((i) => ({ productId: i.product.id, role: i.role, colorNote: i.colorNote })) as object,
      colorCombosJson: result.colorCombos as unknown as object,
    },
  }).catch(() => undefined);
  void analytics.track({
    shopId,
    shopperId: session.row.id,
    name: "STYLE_VIEWED",
    productId: product.id,
    payload: { anchorProductId: product.id },
  }).catch(() => undefined);
  void analytics.track({
    shopId,
    shopperId: session.row.id,
    name: "WIDGET_STYLE_VIEWED",
    productId: product.id,
    payload: { anchorProductId: product.id, itemCount: outfit.length },
  }).catch(() => undefined);
  void recordConsume({ shopId, metric: "STYLE_RECOMMENDATION", by: 1 });
  return { ok: true as const, data: { outfit, colorCombos: result.colorCombos } };
}

// ─── POST /api/tryon/render ────────────────────────────────────────────────────
// VTO render — body-model or personal-photo. Synchronous (one provider call,
// ~4-8s at Gemini-Image, queued at Replicate). Returns the result image URL
// inline so the widget can swap it straight into the canvas.
//
// SECURITY: the shopper photo (PERSONAL_PHOTO mode) is a data URL passed
// through to the provider and dropped — TryOnSession.inputPhotoUrl stays NULL.
// All product reads are shopId-scoped. Output URL is owned by the renderer
// (data: for Gemini, signed CDN for Replicate) and persisted on the session
// row keyed to this shopper.

const TryOnRenderSchema = z.object({
  productId: z.string().min(1).optional(),
  productIds: z.array(z.string().min(1)).max(3).optional(),  // Fix 9 — combo sequential render
  mode:      z.enum(["BODY_MODEL", "PERSONAL_PHOTO"]),
  modelHint: z.string().max(40).optional(),
  // Person image is required for PERSONAL_PHOTO. Validated again server-side
  // in renderTryOn (MIME regex + size cap) — the zod check here is a fast
  // first pass.
  personImageDataUrl: z.string().max(8_500_000).optional(),
}).refine((d) => Boolean(d.productId) || (Array.isArray(d.productIds) && d.productIds.length > 0), {
  message: "Either productId or productIds[] is required",
});

export async function postTryOnRender(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
}): Promise<{ ok: true; data: { renderId: string; imageUrl: string; providerKey: string; latencyMs: number; status?: "PENDING" | "SUCCEEDED" }; setCookie?: string | null } | { ok: false; error: string; setCookie?: string | null }> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const parsed = TryOnRenderSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  // Mint or resolve the shopper session — same primitive as chat / signal.
  const session = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  // Fire-and-forget event tracker — same shape as postChat.
  const track = (name: import("@stylique/types").EventName, productId: string | undefined, payload: unknown) => {
    void analytics.track({
      shopId, shopperId: session.row.id, name, productId, payload,
    }).catch(() => undefined);
  };

  // Fix 9 — combo (multi-garment) try-on when productIds[] supplied.
  // Single-garment path stays unchanged when only productId is provided.
  const ids = parsed.data.productIds ?? (parsed.data.productId ? [parsed.data.productId] : []);
  if (ids.length > 1) {
    const comboResult = await renderComboTryOn({
      shopId,
      shopperRowId: session.row.id,
      productIds: ids,
      modelHint: parsed.data.modelHint ?? null,
      mode: "BODY_MODEL",
    });
    if (!comboResult.ok) {
      return {
        ok: false,
        error: comboResult.error,
        ...(session.setCookie ? { setCookie: session.setCookie } : {}),
      };
    }
    return {
      ok: true,
      data: { renderId: "", imageUrl: comboResult.imageUrl, providerKey: "combo", latencyMs: 0, status: "SUCCEEDED" as const },
      ...(session.setCookie ? { setCookie: session.setCookie } : {}),
    };
  }

  const result = await renderTryOn({
    shopId,
    shopperRowId: session.row.id,
    productId: ids[0]!,
    mode: parsed.data.mode,
    modelHint: parsed.data.modelHint,
    personImageDataUrl: parsed.data.personImageDataUrl,
    trackEvent: track,
  });

  if (!result.ok) {
    // TryOnError codes are already client-safe (invariant #6). Pass through.
    return {
      ok: false,
      error: result.error,
      ...(session.setCookie ? { setCookie: session.setCookie } : {}),
    };
  }

  return {
    ok: true,
    data: result.data,
    ...(session.setCookie ? { setCookie: session.setCookie } : {}),
  };
}

// ─── GET /api/shopper/opener ───────────────────────────────────────────────────
// Returns a personalized opening line for Mira when the dock opens. Three
// flavours, picked by what we know about the shopper:
//   • Account claimed       → "Hey [Name] — the linen shirt is back in M"
//   • Known shopper         → "Welcome back. Last time we did brunch — want me to pull this week's drop?"
//   • New shopper           → null (let the dock render its default greeting)

export async function getShopperOpener(args: {
  shopDomain: string;
  shopperCookieId: string | null;
  productHandle?: string | null;  // optional PDP context
}): Promise<{ ok: true; data: { opener: string | null; surface: "named" | "returning" | "new" }; setCookie?: string | null } | { ok: false; error: string }> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const session = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain, cookieId: args.shopperCookieId,
  });
  const row = await prisma.shopperSession.findUnique({
    where: { id: session.row.id },
    select: {
      displayName: true, accountClaimedAt: true,
      bodyType: true, fitPreference: true,
      styles: { take: 1, orderBy: { createdAt: "desc" }, select: { createdAt: true, product: { select: { title: true, category: true } } } },
      fits:   { take: 1, orderBy: { createdAt: "desc" }, select: { createdAt: true, product: { select: { title: true } } } },
    },
  });

  // New shopper — no history. Return null so client renders default greeting.
  const hasHistory = !!(row?.styles.length || row?.fits.length || row?.bodyType);
  if (!hasHistory) {
    return { ok: true, data: { opener: null, surface: "new" }, setCookie: session.setCookie };
  }

  // Named account holder → premium opener.
  if (row?.accountClaimedAt && row.displayName) {
    const last = row.styles[0]?.product?.title ?? row.fits[0]?.product?.title;
    const opener = last
      ? `Welcome back, ${row.displayName}. Pulling something to go with the ${last}.`
      : `Welcome back, ${row.displayName}. I have ideas.`;
    return { ok: true, data: { opener, surface: "named" }, setCookie: session.setCookie };
  }

  // Anonymous returning — recall the category they last styled around.
  const lastCat = row?.styles[0]?.product?.category ?? row?.fits[0]?.product?.title;
  const opener = lastCat
    ? `You're back. Last time was ${lastCat.toLowerCase()} — want me to pull this week's drop?`
    : `You're back. Same vibe as last time, or trying something new?`;
  return { ok: true, data: { opener, surface: "returning" }, setCookie: session.setCookie };
}

// (toShopperProduct is in serialize.ts so it can be tested without pulling in Prisma.)
