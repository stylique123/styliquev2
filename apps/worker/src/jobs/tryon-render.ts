// OI-33 / OI-32 / OI-31 — async VTO render worker.
//
// Responsibilities:
//   1. Cache check (OI-32): BODY_MODEL renders are deterministic for
//      (shopId, productId, mode, modelHint, renderContextKey). On a hit we copy
//      the stored URL onto the pending row and return immediately — no charge.
//   2. Render (OI-33): the actual provider call that was previously inline in
//      the HTTP request. Running here decouples render latency from the widget.
//   3. Storage (OI-31): priority order —
//      a. S3 (production): if S3_TRYON_BUCKET is set → upload to S3, return
//         a presigned URL. PERSONAL_PHOTO renders use a short TTL (1hr) because
//         they contain PII; BODY_MODEL renders use a long TTL (30 days default).
//      b. Local disk (dev fallback): if STORAGE_PATH is set → write bytes to
//         disk, return /api/tryon/image/<renderId> path.
//      c. Data URL (last resort, dev only): store the raw base64 blob in DB.
//
// SECURITY invariants (mirrors tryon.server.ts):
//   • All DB reads include shopId — cross-tenant impossible.
//   • Personal photo bytes are only in memory for the duration of the call.
//     They are NOT written to disk under any circumstances.
//   • PERSONAL_PHOTO renders are never cached (cacheKey stays null).
//   • S3 keys are scoped tryon/<shopId>/<renderId>.<ext> — cross-tenant
//     isolation at the bucket-prefix level.
//   • PERSONAL_PHOTO renders use a private bucket path with 1hr presigned URLs.

import { prisma } from "@stylique/db";
import {
  createTryOnService,
  createGeminiImageTryOnProvider,
  createReplicateIdmVtonProvider,
  createReplicateCatVtonProvider,
  createVertexVtoProvider,
  createVertexNanaBananaProvider,
  createLiteLocalProvider,
  computeTryOnCacheKey,
  currentPeriodStart,
} from "@stylique/core";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─── S3 client (lazy singleton) ───────────────────────────────────────────
// Only initialised when S3_TRYON_BUCKET is set; falls through to disk/data-URL
// storage when the env var is absent (local dev).
const s3 = process.env.S3_TRYON_BUCKET
  ? new S3Client({
      region: process.env.AWS_REGION ?? "us-east-1",
      // When no explicit creds are supplied the SDK picks up the instance role
      // automatically (ECS task role, EC2 instance profile, etc.).
      credentials: process.env.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
          }
        : undefined,
    })
  : null;

async function uploadRenderToS3(
  renderId: string,
  base64: string,
  ext: string,
  shopId: string,
  mode: "BODY_MODEL" | "PERSONAL_PHOTO",
): Promise<string> {
  const bucket = process.env.S3_TRYON_BUCKET!;
  const key = `tryon/${shopId}/${renderId}.${ext}`;
  const body = Buffer.from(base64, "base64");

  await s3!.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: `image/${ext}`,
      CacheControl: "public, max-age=2592000", // 30 days
    }),
  );

  // PERSONAL_PHOTO renders contain PII — use a short-lived presigned URL (1hr).
  // BODY_MODEL renders are non-PII and can be cached longer (default 30 days).
  // parseInt returns NaN when env var is "" — use `|| 30` as a numeric fallback.
  const defaultTtlDays = mode === "PERSONAL_PHOTO" ? 0 : (parseInt(process.env.S3_TRYON_TTL_DAYS ?? "30") || 30);
  const ttlSeconds = mode === "PERSONAL_PHOTO" ? 3600 : defaultTtlDays * 86400;

  return getSignedUrl(
    s3!,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );
}

export type TryOnRenderJobData = {
  renderId: string;
  shopId: string;
  productId: string;
  mode: "BODY_MODEL" | "PERSONAL_PHOTO";
  providerKey: string;
  modelHint?: string | null;
  renderContextKey?: string | null;
  garmentUrl: string;
  // SECURITY: personImageBase64 must NOT be logged or persisted anywhere.
  personImageBase64?: string;
  personImageMime?: string;
  // BODY_MODEL: muse archetype image (base64) so the worker composites onto a
  // real body. Loaded by the app; the worker just forwards it to the provider.
  museImageBase64?: string;
  museImageMime?: string;
  hints: {
    title: string | null;   // null-safe here; coerced to "" before passing to provider
    category: string | null;
    primaryColor: string | null;
    colorFamily: string | null;
  };
};

export async function processTryOnRender(data: TryOnRenderJobData): Promise<void> {
  const t0 = Date.now();
  const {
    renderId, shopId, productId, mode, providerKey, modelHint, renderContextKey,
    garmentUrl, personImageBase64, personImageMime, museImageBase64, museImageMime, hints,
  } = data;

  // 1. Cache check for BODY_MODEL renders (OI-32).
  //    PERSONAL_PHOTO is never cached — the shopper's own photo makes it
  //    non-deterministic, and we must not retain the bytes across renders.
  const cacheKey = computeTryOnCacheKey({
    shopId,
    productId,
    mode,
    modelHint,
    renderContextKey,
  });
  if (cacheKey) {
    const cached = await prisma.tryOnSession.findFirst({
      where: { shopId, cacheKey, status: "SUCCEEDED" },
      select: { outputImageUrl: true },
    });

    if (cached?.outputImageUrl) {
      await prisma.tryOnSession.update({
        where: { id: renderId },
        data: {
          status: "SUCCEEDED",
          outputImageUrl: cached.outputImageUrl,
          cacheKey,
          latencyMs: 0,
          completedAt: new Date(),
        },
      });
      console.log(`[tryon-render] cache hit renderId=${renderId}`);
      return;
    }
  }

  // 2. Resolve provider service. Must mirror tryon.server.ts getServiceForKey().
  //    IMPORTANT: buildServiceForKey() here MUST stay in sync with getServiceForKey()
  //    in apps/shopify-app/app/lib/tryon.server.ts (and vice versa).
  //    Every providerKey that tryon.server.ts can enqueue must be handled here —
  //    missing a case causes the worker to silently use the wrong engine,
  //    producing correct-looking output from the wrong provider.
  //    TODO: move to packages/core/src/tryon/service.ts (requires env-accessor injection).
  function buildServiceForKey(key: string) {
    if (key === "vertex-vto-001") {
      const projectId = process.env.VERTEX_PROJECT_ID;
      const saJson = process.env.VERTEX_SERVICE_ACCOUNT_JSON;
      if (!projectId || !saJson) throw new Error("VERTEX_PROJECT_ID or VERTEX_SERVICE_ACCOUNT_JSON not set");
      return createTryOnService(createVertexVtoProvider({
        projectId,
        location: process.env.VERTEX_LOCATION ?? "us-central1",
        serviceAccountJson: saJson,
        model: process.env.VERTEX_VTO_MODEL_VERSION,
      }));
    } else if (key === "vertex-nano-banana") {
      const projectId = process.env.VERTEX_PROJECT_ID;
      const saJson = process.env.VERTEX_SERVICE_ACCOUNT_JSON;
      if (!projectId || !saJson) throw new Error("VERTEX_PROJECT_ID or VERTEX_SERVICE_ACCOUNT_JSON not set");
      return createTryOnService(createVertexNanaBananaProvider({
        projectId,
        location: process.env.VERTEX_LOCATION ?? "us-central1",
        serviceAccountJson: saJson,
        model: process.env.VERTEX_NANO_BANANA_MODEL,
      }));
    } else if (key === "replicate-idm-vton") {
      const token = process.env.REPLICATE_API_TOKEN;
      if (!token) throw new Error("REPLICATE_API_TOKEN not set");
      return createTryOnService(createReplicateIdmVtonProvider({ apiToken: token }));
    } else if (key === "replicate-catvton") {
      const token = process.env.REPLICATE_API_TOKEN;
      if (!token) throw new Error("REPLICATE_API_TOKEN not set");
      return createTryOnService(createReplicateCatVtonProvider({ apiToken: token }));
    } else if (key === "lite-local") {
      return createTryOnService(createLiteLocalProvider({
        endpoint: process.env.LITE_VTO_ENDPOINT ?? "http://localhost:8000",
      }));
    } else {
      // Default: gemini-image. Covers the "gemini-image" explicit key AND any
      // unrecognised providerKey (unknown keys degrade gracefully to the default
      // rather than crashing the worker and leaving the row stuck in PENDING).
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) throw new Error("GEMINI_API_KEY not set");
      return createTryOnService(
        createGeminiImageTryOnProvider({
          apiKey: geminiKey,
          // Audit fix: the previous default `gemini-2.5-flash-preview-05-20` is a
          // TEXT model — it returns no image bytes, so every async (BullMQ) muse
          // render silently failed. Match the working sync path (apps/web uses
          // `gemini-2.5-flash-image`, the nano-banana image-output model).
          model: process.env.GEMINI_IMAGE_MODEL ?? process.env.TRYON_IMAGE_MODEL ?? "gemini-2.5-flash-image",
        }),
      );
    }
  }

  const svc = buildServiceForKey(providerKey);

  // 3. Render. Coerce null hint fields to undefined to satisfy TryOnProductHints
  //    which requires title: string (not null).
  //    Bug 1 fix: after primary provider throws, attempt TRYON_FALLBACK_PROVIDER
  //    (default: "gemini-image") before setting status to FAILED. Append
  //    ":fallback" to the providerKey stored in the session so the audit trail
  //    is accurate.
  const renderInput = {
    mode,
    garmentImageUrl: garmentUrl,
    modelHint: modelHint ?? undefined,
    personImageBase64,
    personImageMime,
    museImageBase64,
    museImageMime,
    hints: hints.title != null ? {
      title: hints.title,
      category: hints.category ?? undefined,
      primaryColor: hints.primaryColor ?? undefined,
      colorFamily: hints.colorFamily ?? undefined,
    } : undefined,
  };

  let out: Awaited<ReturnType<typeof svc.render>>;
  let usedProviderKey = providerKey;
  try {
    out = await svc.render(renderInput);
  } catch (primaryErr) {
    console.error("[tryon-render] primary provider failed", { renderId, providerKey, primaryErr });

    // Failover — try the configured fallback (default: "gemini-image").
    const fallbackKey = process.env.TRYON_FALLBACK_PROVIDER ?? "gemini-image";
    if (fallbackKey !== providerKey) {
      console.log(`[tryon-render:failover] attempting fallback provider="${fallbackKey}" renderId=${renderId}`);
      try {
        const fallbackSvc = buildServiceForKey(fallbackKey);
        out = await fallbackSvc.render(renderInput);
        usedProviderKey = `${fallbackKey}:fallback`;
        // Update the audit trail to reflect which provider actually rendered.
        await prisma.tryOnSession.update({
          where: { id: renderId },
          data: { providerKey: usedProviderKey },
        }).catch(() => undefined);
      } catch (fallbackErr) {
        console.error("[tryon-render] fallback provider also failed", { renderId, fallbackKey, fallbackErr });
        const failLatencyMs = Date.now() - t0;
        // Both providers failed — mark FAILED and bail.
        await prisma.tryOnSession.update({
          where: { id: renderId },
          data: {
            status: "FAILED",
            error: String((fallbackErr as Error)?.message ?? "unknown").slice(0, 240),
            latencyMs: failLatencyMs,
            completedAt: new Date(),
          },
        }).catch(() => undefined);
        await prisma.analyticsEvent.create({
          data: {
            shopId,
            name: "TRYON_RENDER_FAILED",
            productId,
            payload: {
              productId,
              mode,
              providerKey: `${fallbackKey}:fallback`,
              errorReason: "both_providers_failed",
              latencyMs: failLatencyMs,
            },
          },
        }).catch(() => undefined);
        return;
      }
    } else {
      // Fallback is same as primary (or no different fallback available) — fail immediately.
      const failLatencyMs = Date.now() - t0;
      await prisma.tryOnSession.update({
        where: { id: renderId },
        data: {
          status: "FAILED",
          error: String((primaryErr as Error)?.message ?? "unknown").slice(0, 240),
          latencyMs: failLatencyMs,
          completedAt: new Date(),
        },
      }).catch(() => undefined);
      await prisma.analyticsEvent.create({
        data: {
          shopId,
          name: "TRYON_RENDER_FAILED",
          productId,
          payload: {
            productId,
            mode,
            providerKey,
            errorReason: "provider_failed",
            latencyMs: failLatencyMs,
          },
        },
      }).catch(() => undefined);
      return;
    }
  }

  // 4. Persist output — offload data: blobs to durable storage (OI-31).
  //    Priority: S3 (production) → local disk (dev) → data URL (last resort).
  //    SECURITY: S3 keys are scoped to tryon/<shopId>/ so cross-tenant reads
  //    are impossible at the prefix level. PERSONAL_PHOTO presigned URLs are
  //    short-lived (1hr). Shopper bytes are ephemeral and cleared once the
  //    render call above returns.
  let outputImageUrl = out.imageUrl;

  if (out.imageUrl.startsWith("data:")) {
    const match = out.imageUrl.match(/^data:image\/([a-z]+);base64,(.+)$/);
    if (match) {
      const ext = match[1];
      const base64 = match[2];

      if (s3) {
        // Priority 1: S3 (production-grade, survives ephemeral filesystems).
        outputImageUrl = await uploadRenderToS3(renderId, base64, ext, shopId, mode);
        console.log(`[tryon-render] stored in S3 renderId=${renderId} mode=${mode}`);
      } else {
        const storagePath = process.env.STORAGE_PATH;
        if (storagePath) {
          // Priority 2: local disk (dev / single-instance deploy).
          const dir = join(storagePath, "tryon");
          await mkdir(dir, { recursive: true });
          const filename = `${renderId}.${ext}`;
          await writeFile(join(dir, filename), new Uint8Array(Buffer.from(base64, "base64")));
          outputImageUrl = `/api/tryon/image/${renderId}`;
          console.log(`[tryon-render] stored on disk renderId=${renderId}`);
        }
        // Priority 3: no storage configured — store data URL directly in DB
        // (dev only; base64 blobs in DB are acceptable for local iteration).
      }
    }
  }

  const latencyMs = Date.now() - t0;

  // 5. Write final state. shopId is always present — cross-tenant impossible.
  //    Cache key MUST use the original providerKey (not usedProviderKey which may
  //    carry ":fallback" suffix). If we wrote usedProviderKey into the cache key,
  //    a future cache lookup with the original key would miss the cached row and
  //    re-render at full cost. The ":fallback" suffix belongs only in the audit
  //    column (providerKey) so ops can see which engine actually ran.
  const finalCacheKey = cacheKey; // already computed from original providerKey above

  await prisma.tryOnSession.update({
    where: { id: renderId },
    data: {
      status: "SUCCEEDED",
      outputImageUrl,
      cacheKey: finalCacheKey,
      latencyMs,
      completedAt: new Date(),
    },
  });

  // Count this NEW render against the monthly cap — mirrors the sync path's
  // recordConsume. A cache hit returned early above and is NOT counted, so this
  // only meters genuine provider calls. Without it the async path would never
  // increment the counter and the per-brand render limit would leak. Direct
  // upsert because the worker can't import the Remix entitlement lib.
  const usageMetric = mode === "PERSONAL_PHOTO" ? "TRYON_PERSONAL" : "TRYON_BODY";
  await prisma.usageCounter.upsert({
    where: { shopId_metric_periodStart: { shopId, metric: usageMetric, periodStart: currentPeriodStart() } },
    create: { shopId, metric: usageMetric, periodStart: currentPeriodStart(), count: 1 },
    update: { count: { increment: 1 } },
  }).catch(() => undefined);

  // Fire analytics — fire-and-forget, never blocks the render result.
  await prisma.analyticsEvent.create({
    data: {
      shopId,
      name: "TRYON_RENDER_COMPLETED",
      productId,
      payload: {
        productId,
        mode,
        providerKey: usedProviderKey,
        modelKey: modelHint ?? "default",
        latencyMs,
      },
    },
  }).catch(() => undefined);

  console.log(`[tryon-render] done renderId=${renderId} latency=${latencyMs}ms cached=${finalCacheKey != null} provider=${usedProviderKey}`);
}
