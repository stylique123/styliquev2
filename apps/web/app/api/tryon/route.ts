// ─────────────────────────────────────────────────────────────────────────────
// Virtual try-on API — real garment-on-body compositing. MUSE-ONLY.
//
// POST { mode, museId?, museImage?, garmentImages[], size,
//        recommendedSize?, handle? }
//   → { imageUrl, cached, ms }
//
// muse mode → deterministic, disk+memory cached, returns the dynamic render URL.
// (The upload-your-own-photo path was removed — try-on is muse-only.)
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { z } from "zod";
import { renderTryOn } from "../../lib/tryon-render.server";
import { takeRenderToken, clientKeyFromRequest } from "../../lib/tryon-ratelimit.server";
import { recordRender, type TryonErrorCode } from "../../lib/tryon-log.server";
import { products as catalog } from "../../lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  mode: z.literal("muse"),
  museId: z.string().max(64).optional(),
  museImage: z.string().max(256).optional(),
  garmentImages: z.array(z.string().max(256)).min(1).max(4),
  size: z.string().max(8),
  recommendedSize: z.string().max(8).optional(),
  garmentKind: z.enum(["top", "bottom", "dress", "outerwear"]).optional(),
  handle: z.string().max(120).optional(),
  // Honest fit signal from the brand-exact size map (per shopper body).
  easeCm: z.number().min(-40).max(60).optional(),
  tightness: z.number().min(-1).max(1).optional(),
  // The region that binds (e.g. "Waist") so the render names where it pulls.
  bindLabel: z.string().max(24).optional(),
  // Per-garment fit for a COMBINED look — each piece carries its own size + ease
  // so the render shows the pant at the pant's size and the top at the top's
  // (founder D: "it did not change the pant size as well").
  garmentFits: z
    .array(
      z.object({
        name: z.string().max(120),
        kind: z.enum(["top", "bottom", "dress", "outerwear"]),
        size: z.string().max(8),
        easeCm: z.number().min(-40).max(60).optional(),
        bindLabel: z.string().max(24).optional(),
      }),
    )
    .max(4)
    .optional(),
  // Per-brand cache partition. Optional — clients on the demo origin send no
  // value (cache key gets a sentinel "_" so the demo behaves identically to
  // before); the storefront widget passes its merchant shop domain so renders
  // are partitioned + reused across that brand's shoppers.
  shopSlug: z.string().max(128).optional(),
});

export async function POST(req: Request) {
  // P4 — abuse cap: every render consumes one token (burst + hourly windows).
  // Generous enough that normal size-toggling never trips it; stops loops/grind.
  const gate = takeRenderToken(clientKeyFromRequest(req));
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited", scope: gate.scope, retryAfterSec: gate.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const b = parsed.data;

  // Non-identifying render metadata shared by every log entry for this attempt.
  // PRIVACY (D23/PB17/§3.5): NEVER log museImage bytes — only this.
  const meta = {
    mode: b.mode,
    handle: b.handle ?? null,
    size: b.size ?? null,
    easeCm: b.easeCm ?? null,
    bindLabel: b.bindLabel ?? null,
    garmentCount: b.garmentFits?.length || b.garmentImages.length || 1,
  };
  const logErr = (errorCode: TryonErrorCode, ms?: number | null) =>
    void recordRender({ ...meta, status: "error", errorCode, ms }).catch(() => {});

  if (!b.museImage || !b.museId) {
    logErr("muse_args");
    return NextResponse.json({ error: "muse_args" }, { status: 400 });
  }

  // Validate handle + size against the real catalog BEFORE rendering. Without
  // this, a bogus handle/size (a) renders with no size differentiation (the size
  // never matches a real sizeChart) and (b) mints unlimited distinct cache keys
  // that pollute the persistent volume — each still costing a provider call.
  if (b.handle) {
    const product = catalog.find((p) => p.handle === b.handle);
    if (!product) {
      logErr("invalid_input");
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
    if (b.size && product.sizes.length && !product.sizes.includes(b.size)) {
      logErr("invalid_input");
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
  }

  const startedAt = Date.now();
  try {
    const result = await renderTryOn({
      mode: b.mode,
      museImage: b.museImage,
      garmentImages: b.garmentImages,
      size: b.size,
      recommendedSize: b.recommendedSize,
      garmentKind: b.garmentKind,
      museId: b.museId,
      handle: b.handle,
      easeCm: b.easeCm,
      tightness: b.tightness,
      bindLabel: b.bindLabel,
      garmentFits: b.garmentFits,
      shopSlug: b.shopSlug,
    });
    // Success — record for cache-hit-rate + latency tracking (fire-and-forget).
    void recordRender({
      ...meta,
      status: "ok",
      cached: Boolean((result as { cached?: boolean }).cached),
      ms:
        typeof (result as { ms?: number }).ms === "number"
          ? (result as { ms?: number }).ms
          : Date.now() - startedAt,
    }).catch(() => {});
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "render_failed";
    // Map known internal errors to a stable client vocabulary; log details server-side.
    console.error("[tryon] render error", msg);
    const known = ["no_api_key", "render_failed", "render_no_image", "no_garment"];
    // invalid_asset is thrown as "invalid_asset:<path>" — keep its class for the log,
    // but the client vocabulary stays render_failed (don't leak the path).
    const isInvalidAsset = msg.startsWith("invalid_asset");
    const logCode = (isInvalidAsset
      ? "invalid_asset"
      : known.includes(msg)
        ? msg
        : "render_failed") as TryonErrorCode;
    // A bad client-supplied asset path is a 4xx (client error), not a 502
    // (upstream failure) — return 400 so it doesn't pollute the server error-rate.
    if (isInvalidAsset) {
      logErr(logCode, Date.now() - startedAt);
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
    const clientCode = known.includes(msg) ? msg : "render_failed";
    logErr(logCode, Date.now() - startedAt);
    return NextResponse.json({ error: clientCode }, { status: 502 });
  }
}
