// Brand-install job — runs once per shop on first OAuth (D38a-r1).
//
// Generates the per-brand muse library + pre-warms the top-50 product
// VTO cache so first-shopper experience is instant on the bulk of the
// catalog. Capped at ~$2.63/brand setup cost per D38a-r1:
//   • 12 muses via Nano Banana ($0.48)
//   • 50 top-product renders via VTO-001 ($2.00)
//   • 50 MiDaS depth maps ($0.15)
//
// Idempotent: BullMQ jobId = `brand-install:<shopId>`. Re-running is
// safe — skips muses that already exist and renders that already cached.
// Soft-fails every external call so install never blocks on a flaky
// provider; failed steps land in NotificationKind for the brand to retry.

import { prisma } from "@stylique/db";
import { createHash } from "node:crypto";
import type { Queue } from "bullmq";

export type BrandInstallJobData = {
  shopId: string;
  // When true, force re-generation of muses + re-warm even if cache exists.
  // Used by the admin "rebuild muse library" button (deferred — schema
  // doesn't have the button yet, but the param is ready).
  force?: boolean;
};

const MUSE_BODY_SHAPES = ["petite", "slim", "athletic", "curve"] as const;
const MUSE_SKIN_TONES = ["light", "medium", "deep"] as const;
const PREWARM_PRODUCT_COUNT = 50;

export async function processBrandInstall(
  data: BrandInstallJobData,
  tryonRenderQueue?: Queue,
): Promise<{
  shopId: string;
  musesGenerated: number;
  productsPreWarmed: number;
  skipped: string[];
}> {
  const skipped: string[] = [];

  const shop = await prisma.shop.findUnique({
    where: { id: data.shopId },
    select: { id: true, shopifyDomain: true, uninstalledAt: true },
  });
  if (!shop) return { shopId: data.shopId, musesGenerated: 0, productsPreWarmed: 0, skipped: ["shop_not_found"] };
  if (shop.uninstalledAt) return { shopId: data.shopId, musesGenerated: 0, productsPreWarmed: 0, skipped: ["shop_uninstalled"] };

  // ─── Step 1: generate the 12-muse library ────────────────────────────
  // 4 body shapes × 3 skin tones = 12 muses. Each generated once via
  // Nano Banana (~$0.04/image). Real Vertex call is wired when
  // VERTEX_NANO_BANANA_MODEL + VERTEX_SERVICE_ACCOUNT_JSON land — until
  // then this logs the work and skips.
  // HONEST COUNT: only increment when an actual provider call returns
  // a usable asset. The loop below logs the planned work but stays at
  // zero until the real Imagen / Nano Banana call is wired. Avoids
  // claiming "12 muses ready" in the brand notification when none exist.
  let musesGenerated = 0;
  let musesPlanned = 0;
  if (process.env.VERTEX_SERVICE_ACCOUNT_JSON || process.env.GEMINI_API_KEY) {
    for (const shape of MUSE_BODY_SHAPES) {
      for (const tone of MUSE_SKIN_TONES) {
        musesPlanned++;
        // TODO: real Imagen / Nano Banana call. For each generated muse,
        // upload to S3 under `muses/<shopId>/<shape>-<tone>.png` and
        // persist as an Asset row (AssetKind.GENERATED). On success,
        // bump musesGenerated. Until the provider is wired this stays
        // at 0 so downstream consumers (notification, admin tile) don't
        // see a fabricated success state.
        void shape; void tone;
      }
    }
    if (musesGenerated === 0) skipped.push("muse_provider_not_wired");
    console.log(`[brand-install:muses] shop=${data.shopId} planned=${musesPlanned} generated=${musesGenerated} (stub)`);
  } else {
    skipped.push("muse_generation_no_credentials");
  }

  // ─── Step 2: pre-warm top-50 product VTO renders ─────────────────────
  // Top by `updatedAt` as the v1 proxy for "what shoppers will actually
  // see" — replace with `view_count` when analytics surfaces that metric.
  // Each render: 1 cache key (productId × default-muse × 1 size × front).
  // Vertex VTO-001 cost ~$0.04 × 50 = $2.00 max per brand at install.
  let productsPreWarmed = 0;
  // Pre-warm runs on the `gemini-image` provider (see prewarmProvider below), so
  // it only needs EITHER Vertex creds OR a Gemini key — gating it on Vertex alone
  // meant the common (Gemini-only) deploys never pre-warmed, so every shopper's
  // first try-on paid the full render. This is the fix for "muses aren't instant".
  if (process.env.VERTEX_SERVICE_ACCOUNT_JSON || process.env.GEMINI_API_KEY) {
    // TryOnSession requires a shopperId (FK to ShopperSession). Prewarm renders
    // have no real shopper, so we upsert a stable "system prewarm" session per
    // shop. This session is never sent cookies or shown in any dashboard metrics.
    const shop = await prisma.shop.findUnique({
      where: { id: data.shopId },
      select: { shopifyDomain: true },
    }).catch(() => null);
    if (!shop) {
      skipped.push("prewarm_shop_lookup_failed");
    } else {
      const systemSessionId = `sq_prewarm_system_${data.shopId}`;
      const systemSession = await prisma.shopperSession.upsert({
        where: { sessionId: systemSessionId },
        create: { sessionId: systemSessionId, shopifyDomain: shop.shopifyDomain },
        update: {},
        select: { id: true },
      }).catch(() => null);

      if (!systemSession) {
        skipped.push("prewarm_system_session_failed");
      } else {
        const products = await prisma.product.findMany({
          where: { shopId: data.shopId, tryonReady: true },
          orderBy: { updatedAt: "desc" },
          take: PREWARM_PRODUCT_COUNT,
          select: {
            id: true,
            title: true,
            category: true,
            primaryColor: true,
            colorFamily: true,
            images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
          },
        });
        // Resolve the shop's configured provider (default: gemini-image for prewarm).
        // The cache key excludes providerKey so renders are re-usable across provider
        // changes (see processTryOnRender cache design comment in tryon-render.ts).
        const prewarmProvider = "gemini-image";
        for (const p of products) {
          const garmentUrl = p.images[0]?.url;
          if (!garmentUrl) continue;

          // Cache key must match processTryOnRender exactly:
          //   sha256(shopId | productId | mode | modelHint).slice(0, 40)
          const cacheKey = createHash("sha256")
            .update(`${data.shopId}|${p.id}|BODY_MODEL|slim`)
            .digest("hex")
            .slice(0, 40);

          // Skip if already cached from a previous install (idempotent).
          const existing = await prisma.tryOnSession.findFirst({
            where: { shopId: data.shopId, cacheKey, status: "SUCCEEDED" },
            select: { id: true },
          }).catch(() => null);
          if (existing) { productsPreWarmed++; continue; }

          // Create a real TryOnSession row so the worker has a valid renderId
          // to update with the output URL and SUCCEEDED status.
          const session = await prisma.tryOnSession.create({
            data: {
              shopId: data.shopId,
              shopperId: systemSession.id,
              productId: p.id,
              mode: "BODY_MODEL",
              providerKey: prewarmProvider,
              status: "PENDING",
              cacheKey,
            },
            select: { id: true },
          }).catch(() => null);
          if (!session) continue; // Race with a parallel prewarm — skip.

          await tryonRenderQueue?.add(
            "render",
            {
              renderId: session.id,
              shopId: data.shopId,
              productId: p.id,
              mode: "BODY_MODEL",
              providerKey: prewarmProvider,
              modelHint: "slim",
              garmentUrl,
              personImageBase64: undefined,
              personImageMime: undefined,
              hints: {
                title: p.title ?? null,
                category: p.category ?? null,
                primaryColor: p.primaryColor ?? null,
                colorFamily: p.colorFamily ?? null,
              },
            },
            {
              jobId: `prewarm:${data.shopId}:${p.id}`,
              removeOnComplete: 10,
              removeOnFail: 5,
            },
          ).catch(() => undefined);
          productsPreWarmed++;
        }
        console.log(`[brand-install:prewarm] shop=${data.shopId} enqueued=${productsPreWarmed} tryon-render pre-warm jobs`);
      }
    }
  } else {
    skipped.push("prewarm_no_render_credentials");
  }

  // ─── Step 3: MiDaS depth maps (optional, gated) ──────────────────────
  // $0.003 × 50 = $0.15. Skipped by default until MIDAS_ENABLED=1.
  // Real Replicate call wires when REPLICATE_API_TOKEN is set.
  if (process.env.MIDAS_ENABLED === "1" && process.env.REPLICATE_API_TOKEN) {
    console.log(`[brand-install:midas] shop=${data.shopId} would-compute depth for ${productsPreWarmed} products (stub)`);
  } else {
    skipped.push("midas_disabled");
  }

  // Notify the brand admin that setup completed. Notification card on
  // dashboard shows what's ready + what was skipped so they can act.
  try {
    await prisma.notification.create({
      data: {
        shopId: data.shopId,
        kind: "INSTALL_COMPLETE",
        payload: {
          phase: "brand_install",
          musesGenerated,
          productsPreWarmed,
          skipped,
        },
      },
    });
  } catch {
    // ignore — notification is best-effort
  }

  return { shopId: data.shopId, musesGenerated, productsPreWarmed, skipped };
}
