// VTO render — server-side bindings (Sprint 6 / D34).
//
// One synchronous render path. The provider is picked per shop:
//   • If Plan.planFeaturesJson.tryon.providerKey === "replicate-idm-vton"
//     AND REPLICATE_API_TOKEN is set → Replicate IDM-VTON.
//   • Otherwise → Gemini 2.5 Flash Image (default).
//
// SECURITY invariants (mirrors D23 / PB17 / §3.5):
//   • Shopper photo (PERSONAL_PHOTO mode) is base64 in memory only — passed to
//     the provider then dropped. We never write the input photo to disk.
//     `TryOnSession.inputPhotoUrl` stays NULL for personal-photo renders.
//   • All reads filter by `shopId`. Cross-tenant impossible.
//   • Image MIME validated by regex (same allowlist as chat).
//   • Photo size capped at 6MB (same cap as chat).
//   • Rate-limited on shop + shopper buckets (callers enforce via rateOk).
//   • Errors returned to client use stable vocabulary; raw provider strings
//     go to console.error only (invariant #6).

import { prisma } from "../db.server";
import {
  createTryOnService,
  createGeminiImageTryOnProvider,
  createReplicateIdmVtonProvider,
  createReplicateCatVtonProvider,
  createVertexVtoProvider,
  createVertexNanaBananaProvider,
  createLiteLocalProvider,
  type TryOnService,
  type TryOnMode,
} from "@stylique/core";
import { canConsume, recordConsume } from "./entitlement.server";
import { reportError } from "./sentry.server";
import type { EventName } from "@stylique/types";
import { enqueueTryonRender, tryonRenderQueue } from "../queue.server";
import { loadMuseImage } from "./muse-assets.server";
import { createHash } from "node:crypto";

// OI-33: async render via the shared BullMQ singleton from queue.server.ts.
// When Redis is unavailable, tryonRenderQueue.client is not connected and
// tryonRenderQueue will be null — the code below falls through to the
// synchronous inline path so local dev without Redis stays functional.
// We detect Redis availability by checking REDIS_URL (same as queue.server.ts).
const asyncRenderAvailable = Boolean(process.env.REDIS_URL);

// Same MIME allowlist as the chat route (§3.5 invariant #3).
const IMAGE_DATA_URL_RE = /^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/;
const MAX_PERSON_IMAGE_BYTES = 6 * 1024 * 1024;     // 6MB before base64 → ~8MB JSON

// Stable client-facing error codes (invariant #6).
export type TryOnError =
  | "shop_not_installed"
  | "product_not_found"
  | "feature_disabled"            // entitlement: personal-photo not allowed
  | "quota_reached"               // usage: monthly cap hit
  | "invalid_image"               // MIME or size fail
  | "no_garment_image"            // product has no image to render against
  | "render_unavailable"          // provider not configured
  | "render_failed";              // provider call threw

export interface TryOnRenderResult {
  ok: true;
  data: {
    renderId: string;
    imageUrl: string;             // data:image/...;base64,...  OR https://...  OR "" when async
    providerKey: string;
    latencyMs: number;
    status?: "PENDING" | "SUCCEEDED";  // "PENDING" when enqueued async
  };
}
export interface TryOnRenderError {
  ok: false;
  error: TryOnError;
}
export type TryOnRenderResponse = TryOnRenderResult | TryOnRenderError;

// ─── Provider selection ────────────────────────────────────────────────
// Cached per provider-key so we don't re-instantiate per render.

const _svcCache: Map<string, TryOnService> = new Map();

// IMPORTANT: getServiceForKey() here MUST stay in sync with buildServiceForKey()
// in apps/worker/src/jobs/tryon-render.ts (and vice versa). Drift causes silent
// provider mismatches (worker uses fallback while app reports primary).
// TODO: move to packages/core/src/tryon/service.ts (requires env-accessor injection).
function getServiceForKey(providerKey: string): TryOnService | null {
  if (_svcCache.has(providerKey)) return _svcCache.get(providerKey)!;
  let svc: TryOnService | null = null;
  if (providerKey === "vertex-vto-001") {
    // Premium engine — purpose-built garment swap (D38a-r1 preferred path).
    // Requires GCP service account JSON + project + Vertex Model Garden
    // preview approval for `virtual-try-on-preview-08-04`. Falls back to
    // null when any of those are missing, which makes the caller route to
    // TRYON_FALLBACK_PROVIDER (gemini-image) instead of failing the render.
    const projectId = process.env.VERTEX_PROJECT_ID;
    const saJson = process.env.VERTEX_SERVICE_ACCOUNT_JSON;
    if (!projectId || !saJson) return null;
    try {
      svc = createTryOnService(createVertexVtoProvider({
        projectId,
        location: process.env.VERTEX_LOCATION ?? "us-central1",
        serviceAccountJson: saJson,
        model: process.env.VERTEX_VTO_MODEL_VERSION,
      }));
    } catch (err) {
      // Bad service-account JSON, missing fields, etc. Log + degrade.
      console.error("[tryon] vertex provider init failed:", (err as Error).message);
      return null;
    }
  } else if (providerKey === "vertex-nano-banana") {
    const projectId = process.env.VERTEX_PROJECT_ID;
    const saJson = process.env.VERTEX_SERVICE_ACCOUNT_JSON;
    if (!projectId || !saJson) return null;
    try {
      svc = createTryOnService(createVertexNanaBananaProvider({
        projectId,
        location: process.env.VERTEX_LOCATION ?? "us-central1",
        serviceAccountJson: saJson,
        model: process.env.VERTEX_NANO_BANANA_MODEL,
      }));
    } catch (err) {
      console.error("[tryon] vertex-nano-banana provider init failed:", (err as Error).message);
      return null;
    }
  } else if (providerKey === "replicate-idm-vton") {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return null;
    svc = createTryOnService(createReplicateIdmVtonProvider({ apiToken: token }));
  } else if (providerKey === "replicate-catvton") {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return null;
    svc = createTryOnService(createReplicateCatVtonProvider({ apiToken: token }));
  } else if (providerKey === "lite-local") {
    // CPU VTO dev/fallback — $0, no credentials required. See OI-36 for quality note.
    svc = createTryOnService(createLiteLocalProvider({
      endpoint: process.env.LITE_VTO_ENDPOINT ?? "http://localhost:8000",
    }));
  } else {
    // Default: gemini-image (works with the GEMINI_API_KEY already in .env,
    // ships "Style Preview" labelled output — see D34 honesty rule).
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    svc = createTryOnService(createGeminiImageTryOnProvider({
      apiKey: key,
      model: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-preview-05-20",
    }));
  }
  _svcCache.set(providerKey, svc);
  return svc;
}

// Read the per-shop override from Plan.planFeaturesJson.tryon.providerKey.
// Default is "gemini-image". Unknown values fall back to default.
async function resolveProviderKey(shopId: string): Promise<string> {
  const plan = await prisma.plan.findUnique({
    where: { shopId },
    select: { planFeaturesJson: true },
  });
  const raw = plan?.planFeaturesJson as { tryon?: { providerKey?: string } } | null;
  const k = raw?.tryon?.providerKey;
  if (
    k === "vertex-vto-001" ||
    k === "vertex-nano-banana" ||
    k === "replicate-catvton" ||
    k === "replicate-idm-vton" ||
    k === "lite-local" ||
    k === "gemini-image"
  ) {
    return k;
  }
  // Default to gemini-image today — works with the GEMINI_API_KEY that's
  // already configured. Brands flip to "vertex-vto-001" via the admin
  // settings page once GCP service-account JSON is in env AND Google has
  // approved Vertex Model Garden preview access for the project.
  return "gemini-image";
}

// ─── renderTryOn — the single entry point ──────────────────────────────

// Fix 9 — sequential combo VTO. Renders productIds[0] on the muse, then feeds
// each output as the person image for the next render. Caches each step
// independently via the single-product renderTryOn cache layer.
//
// Cost: N × single-render. First shopper pays N renders; cached forever after.
// Only BODY_MODEL is supported (no personal-photo combos — privacy + provider
// limits).
export async function renderComboTryOn(args: {
  shopId: string;
  shopperRowId: string;
  productIds: string[];          // [base, mid, outer/accessory], lowest → highest layer
  modelHint?: string | null;
  mode: "BODY_MODEL";
}): Promise<{ ok: true; imageUrl: string } | { ok: false; error: TryOnError }> {
  if (args.productIds.length === 0) return { ok: false, error: "product_not_found" };
  if (args.productIds.length === 1) {
    const single = await renderTryOn({
      shopId: args.shopId,
      shopperRowId: args.shopperRowId,
      productId: args.productIds[0]!,
      mode: "BODY_MODEL",
      modelHint: args.modelHint ?? undefined,
    });
    return single.ok
      ? { ok: true, imageUrl: single.data.imageUrl }
      : { ok: false, error: single.error };
  }

  let currentPersonImageDataUrl: string | undefined;
  let lastImageUrl = "";

  for (let i = 0; i < Math.min(args.productIds.length, 3); i++) {
    const productId = args.productIds[i]!;
    const result = await renderTryOn({
      shopId: args.shopId,
      shopperRowId: args.shopperRowId,
      productId,
      mode: "BODY_MODEL",
      modelHint: i === 0 ? (args.modelHint ?? undefined) : undefined,
      personImageDataUrl: currentPersonImageDataUrl,
    });
    if (!result.ok) return { ok: false, error: result.error };
    lastImageUrl = result.data.imageUrl;
    if (!lastImageUrl) break; // PENDING (async) — give up on the chain, return what we have
    if (i < args.productIds.length - 1) {
      if (lastImageUrl.startsWith("data:")) {
        currentPersonImageDataUrl = lastImageUrl;
      } else {
        // Fetch the URL and convert to data: for the next step.
        try {
          const resp = await fetch(lastImageUrl, { signal: AbortSignal.timeout(10_000) });
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            const b64 = Buffer.from(buf).toString("base64");
            const ct = resp.headers.get("content-type") ?? "image/jpeg";
            currentPersonImageDataUrl = `data:${ct};base64,${b64}`;
          } else {
            break;
          }
        } catch { break; }
      }
    }
  }

  return lastImageUrl
    ? { ok: true, imageUrl: lastImageUrl }
    : { ok: false, error: "render_failed" };
}

export async function renderTryOn(args: {
  shopId: string;
  shopperRowId: string;
  productId: string;
  mode: TryOnMode;
  modelHint?: string;                  // BODY_MODEL only
  personImageDataUrl?: string;         // PERSONAL_PHOTO only
  trackEvent?: (name: EventName, productId: string | undefined, payload: unknown) => void;
}): Promise<TryOnRenderResponse> {
  const t0 = Date.now();
  const track = args.trackEvent ?? (() => undefined);

  // 1. Entitlement gate — personal-photo only when the brand's tier (or override)
  //    allows it. Body-model is universally on.
  if (args.mode === "PERSONAL_PHOTO") {
    const gate = await canConsume({ shopId: args.shopId, metric: "TRYON_PERSONAL" });
    if (!gate.allowed) {
      track("TRYON_RENDER_FAILED", args.productId, {
        productId: args.productId, mode: args.mode, providerKey: "n/a", errorReason: "quota_reached",
      });
      return { ok: false, error: "quota_reached" };
    }
  }

  // 2. Resolve product + garment image. shopId-scoped — cross-tenant impossible.
  const product = await prisma.product.findFirst({
    where: { id: args.productId, shopId: args.shopId },
    select: {
      id: true, title: true, category: true, primaryColor: true, colorFamily: true,
      images: { orderBy: { position: "asc" }, take: 1, select: { url: true, preppedUrl: true } },
    },
  });
  if (!product) return { ok: false, error: "product_not_found" };
  // Prefer the studio-composited image (background-stripped, consistent backdrop).
  // Falls back to raw CDN image when prep hasn't run yet.
  const garmentUrl = product.images[0]?.preppedUrl ?? product.images[0]?.url;
  if (!garmentUrl) return { ok: false, error: "no_garment_image" };

  // 3. Validate person image (PERSONAL_PHOTO only). Same rules as chat (§3.5).
  let personBase64: string | undefined;
  let personMime: string | undefined;
  if (args.mode === "PERSONAL_PHOTO") {
    const dataUrl = args.personImageDataUrl ?? "";
    if (!IMAGE_DATA_URL_RE.test(dataUrl)) return { ok: false, error: "invalid_image" };
    // approx byte-size check (base64 is 4/3 of binary)
    const approxBytes = Math.floor((dataUrl.length * 3) / 4);
    if (approxBytes > MAX_PERSON_IMAGE_BYTES) return { ok: false, error: "invalid_image" };
    const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
    if (!m) return { ok: false, error: "invalid_image" };
    personMime = m[1]!;
    personBase64 = m[2]!;
  }

  // 3b. BODY_MODEL: load the muse archetype image so the provider composites the
  //     garment ONTO a real body (img2img), not a text-generated generic model.
  //     Best-effort — if the asset is missing, muse stays undefined and the
  //     provider falls back to the legacy text path. Never blocks a render.
  let museBase64: string | undefined;
  let museMime: string | undefined;
  if (args.mode === "BODY_MODEL") {
    const muse = loadMuseImage(args.modelHint);
    if (muse) {
      museBase64 = muse.base64;
      museMime = muse.mime;
    }
  }

  // 4. Provider selection.
  const providerKey = await resolveProviderKey(args.shopId);
  const svc = getServiceForKey(providerKey);
  if (!svc) {
    track("TRYON_RENDER_FAILED", args.productId, {
      productId: args.productId, mode: args.mode, providerKey, errorReason: "render_unavailable",
    });
    return { ok: false, error: "render_unavailable" };
  }

  // 5. Create the row in PENDING so we have an id + audit trail even if the
  //    provider call fails.
  const row = await prisma.tryOnSession.create({
    data: {
      shopId: args.shopId,
      shopperId: args.shopperRowId,
      productId: args.productId,
      mode: args.mode === "BODY_MODEL" ? "BODY_MODEL" : "PERSONAL_PHOTO",
      status: "PENDING",
      providerKey,
      modelKey: svc.provider.modelKey,
      modelHint: args.mode === "BODY_MODEL" ? (args.modelHint ?? null) : null,
      // SECURITY: inputPhotoUrl stays NULL for PERSONAL_PHOTO — we don't store
      // the shopper photo. (Garment URL is the shop's own CDN, fine to record
      // for body-model renders if we add that field later.)
    },
    select: { id: true },
  });

  track("TRYON_RENDER_REQUESTED", args.productId, {
    productId: args.productId, mode: args.mode, modelHint: args.modelHint, providerKey,
  });

  // 6. Async path (OI-33): if Redis is available, enqueue via the shared
  //    singleton queue (queue.server.ts) and return immediately with PENDING.
  //    The widget polls /api/tryon/render/status?renderId=… until done.
  //    SECURITY: personImageBase64 lives in Redis only for job duration;
  //    BullMQ removes it via removeOnComplete. Never written to DB.
  if (asyncRenderAvailable) {
    await enqueueTryonRender({
      renderId: row.id,
      shopId: args.shopId,
      productId: args.productId,
      mode: args.mode,
      providerKey,
      modelHint: args.modelHint ?? null,
      garmentUrl,
      personImageBase64: personBase64,
      personImageMime: personMime,
      museImageBase64: museBase64,
      museImageMime: museMime,
      hints: {
        title: product.title,
        category: product.category,
        primaryColor: product.primaryColor,
        colorFamily: product.colorFamily,
      },
    });

    return {
      ok: true,
      data: { renderId: row.id, imageUrl: "", providerKey, latencyMs: 0, status: "PENDING" },
    };
  }

  // 7. Synchronous fallback — runs when Redis is not configured (local dev
  //    without a Redis sidecar, or edge deploys where BullMQ is unavailable).
  const renderInput = {
    mode: args.mode,
    garmentImageUrl: garmentUrl,
    modelHint: args.modelHint,
    personImageBase64: personBase64,
    personImageMime: personMime,
    museImageBase64: museBase64,
    museImageMime: museMime,
    hints: {
      title: product.title,
      category: product.category,
      primaryColor: product.primaryColor,
      colorFamily: product.colorFamily,
    },
  };

  // Primary render attempt with failover to a secondary provider on error.
  let primaryErr: unknown = null;
  let usedProviderKey = providerKey;

  let out: Awaited<ReturnType<typeof svc.render>> | undefined;
  try {
    out = await svc.render(renderInput);
  } catch (err) {
    primaryErr = err;
    // eslint-disable-next-line no-console
    console.error("[tryon] primary provider failed", { renderId: row.id, providerKey, err });
    reportError(err, { renderId: row.id, providerKey });

    // Failover: try the configured fallback (default: "gemini-image") if it's
    // not already the primary provider.
    const fallbackKey = process.env.TRYON_FALLBACK_PROVIDER ?? "gemini-image";
    if (fallbackKey !== providerKey) {
      const fallbackSvc = getServiceForKey(fallbackKey);
      if (fallbackSvc) {
        try {
          out = await fallbackSvc.render(renderInput);
          usedProviderKey = fallbackKey + ":fallback";
          // Record the fallback so the audit trail is accurate.
          await prisma.tryOnSession.update({
            where: { id: row.id },
            data: { providerKey: usedProviderKey },
          }).catch(() => undefined);
        } catch (fallbackErr) {
          // eslint-disable-next-line no-console
          console.error("[tryon] fallback also failed", { renderId: row.id, fallbackKey, fallbackErr });
          reportError(fallbackErr, { renderId: row.id, providerKey: fallbackKey });
          throw fallbackErr;
        }
      } else {
        throw primaryErr;
      }
    } else {
      throw primaryErr;
    }
  }

  // If we get here, `out` is defined (either primary succeeded or fallback succeeded).
  // If both failed, the catch block above threw and we never reach this point —
  // fall through to the outer catch below.
  try {
    const latencyMs = Date.now() - t0;

    // OI-32: compute cache key for BODY_MODEL so the worker path and this
    // sync path both write the same key — future worker hits can reuse it.
    // providerKey intentionally excluded — same render should cache-hit across provider changes
    const cacheKey = args.mode === "BODY_MODEL"
      ? createHash("sha256")
          .update(`${args.shopId}|${args.productId}|${args.mode}|${args.modelHint ?? "default"}`)
          .digest("hex")
          .slice(0, 40)
      : null;

    await prisma.tryOnSession.update({
      where: { id: row.id },
      data: {
        status: "SUCCEEDED",
        outputImageUrl: out!.imageUrl,
        cacheKey,
        latencyMs,
        completedAt: new Date(),
      },
    });

    // Count successful renders against monthly caps. Body-model is usually
    // unlimited, but recordConsume still gives admins accurate usage totals.
    void recordConsume({
      shopId: args.shopId,
      metric: args.mode === "PERSONAL_PHOTO" ? "TRYON_PERSONAL" : "TRYON_BODY",
      by: 1,
    });

    track("TRYON_RENDER_COMPLETED", args.productId, {
      productId: args.productId, mode: args.mode,
      providerKey: usedProviderKey, modelKey: svc.provider.modelKey, latencyMs,
    });

    return {
      ok: true,
      data: { renderId: row.id, imageUrl: out!.imageUrl, providerKey: usedProviderKey, latencyMs, status: "SUCCEEDED" },
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    // Real details to server log only — never to client (invariant #6).
    // eslint-disable-next-line no-console
    console.error("[tryon] render failed", { renderId: row.id, providerKey: usedProviderKey, err });
    reportError(err, { renderId: row.id, providerKey: usedProviderKey });

    await prisma.tryOnSession.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        error: String((err as Error)?.message ?? "unknown").slice(0, 240),
        latencyMs,
        completedAt: new Date(),
      },
    }).catch(() => undefined);

    track("TRYON_RENDER_FAILED", args.productId, {
      productId: args.productId, mode: args.mode, providerKey: usedProviderKey,
      errorReason: "render_failed", latencyMs,
    });

    return { ok: false, error: "render_failed" };
  }
}
