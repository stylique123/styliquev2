// App Proxy entry. Shopify forwards storefront requests to /apps/stylique/* here.
// `authenticate.public.appProxy` verifies the HMAC signature on the query string —
// if it fails, the call throws and we return 401.
//
// Path dispatch:
//   GET  api/product?handle=…
//   GET  api/entitlement
//   POST api/fit
//   POST api/style
//   POST api/events
//
// Anything else returns 404. We never proxy admin tokens or surface internal ids.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  getProduct, getEntitlement, postFit, postStyle, postEvent,
  // Stylist (separate surface from the 3-step widget) lives on its own dock
  // site-wide. Both surfaces share a ShopperSession identified by the
  // sq_shopper_id cookie — see lib/session.server.ts.
  postShopperSignal, postShopperAccount, postShopperAccountVerify, postShopperAuthSocial, getShopperMe, getShopperOpener, getShopperSocialProof,
  postTryOnRender, postComboFeedback, postComboAddAll,
  type ApiResponse,
} from "../lib/shopper.server";
import { readShopperCookie } from "../lib/session.server";
import { prisma } from "../db.server";

// CORS headers — even though Shopify proxies same-origin, browsers sometimes preflight
// when the script is on a different domain than the storefront. Strict allowlist.
function cors(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

function respond<T>(payload: ApiResponse<T>, status?: number): Response {
  // Map the fixed error vocabulary (§3.5 #6) to honest HTTP status codes so
  // clients can branch (e.g. 429 → exponential backoff) instead of treating every
  // failure as a generic 400 (panel P2).
  const code = status ?? (payload.ok ? 200 : payload.error === "shop_not_installed" ? 404
                                  : payload.error === "invalid_input" || payload.error === "invalid_payload" ? 400
                                  : payload.error === "product_not_found" || payload.error === "not_found" ? 404
                                  : payload.error === "rate_limited" || payload.error === "quota_reached" ? 429
                                  : payload.error === "feature_disabled" || payload.error === "unauthorized" ? 403
                                  : payload.error === "no_variants_found" ? 422
                                  : payload.error === "render_unavailable" ? 503
                                  : 400);
  return cors(json(payload, { status: code }));
}

// For handlers that may set a sq_shopper_id cookie on first contact.
function respondWithMaybeCookie<T>(payload: ApiResponse<T> & { setCookie?: string | null }): Response {
  const { setCookie, ...rest } = payload as { setCookie?: string | null } & ApiResponse<T>;
  const res = respond(rest as ApiResponse<T>);
  if (setCookie) res.headers.append("Set-Cookie", setCookie);
  return res;
}

async function resolveShopDomain(request: Request): Promise<string | null> {
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (session?.shop) return session.shop;
  } catch {
    return null;
  }
  // App Proxy queries Shopify-signed requests with a `shop` query parameter; rely on
  // that ONLY after verification — if the call above didn't throw, this is safe to read.
  const shop = new URL(request.url).searchParams.get("shop");
  return shop && /\.myshopify\.com$/.test(shop) ? shop : null;
}

function subPath(request: Request, splat: string | undefined): string {
  // splat may be "" when widget calls /apps/stylique itself. Normalize and strip query.
  return (splat ?? "").split("?")[0].replace(/^\/+|\/+$/g, "");
}

// ─── GET ─────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const shopDomain = await resolveShopDomain(request);
  if (!shopDomain) return cors(json({ ok: false, error: "unauthorized" }, { status: 401 }));

  const url = new URL(request.url);
  const path = subPath(request, params["*"]);

  const shopperCookieIdGet = readShopperCookie(request);

  // OI-31 — serve stored render images. Matched via prefix because the renderId
  // is a path segment: api/tryon/image/<renderId>. Must be checked before the
  // switch so the switch default doesn't swallow it.
  if (path.startsWith("api/tryon/image/")) {
    const storagePath = process.env.STORAGE_PATH;
    if (!storagePath) return cors(new Response("not_found", { status: 404 }));
    const renderId = path.slice("api/tryon/image/".length);
    if (!renderId) return cors(new Response("not_found", { status: 404 }));

    // SECURITY (audit Fix 6): verify the renderId belongs to the requesting shop
    // before serving any bytes. Without this check a shopper on shop A could fish
    // for renders from shop B by guessing or brute-forcing render UUIDs.
    // PERSONAL_PHOTO renders are also gated here — they contain PII.
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: { id: true, uninstalledAt: true },
    });
    if (!shop || shop.uninstalledAt) return cors(new Response("not_found", { status: 404 }));
    const renderRow = await prisma.tryOnSession.findFirst({
      where: { id: renderId, shopId: shop.id },
      select: { id: true },
    });
    if (!renderRow) return cors(new Response("not_found", { status: 404 }));

    const { readFile } = await import("node:fs/promises");
    for (const ext of ["png", "jpeg", "webp"]) {
      try {
        const buf = await readFile(`${storagePath}/tryon/${renderId}.${ext}`);
        const res = new Response(buf, {
          headers: {
            "Content-Type": `image/${ext}`,
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
          },
        });
        return cors(res);
      } catch { /* try next extension */ }
    }
    return cors(new Response("not_found", { status: 404 }));
  }

  switch (path) {
    case "api/product":
      return respond(await getProduct({ shopDomain, handle: url.searchParams.get("handle") ?? "", shopperCookieId: shopperCookieIdGet }));
    case "api/entitlement":
      return respond(await getEntitlement({ shopDomain, shopperCookieId: shopperCookieIdGet }));
    case "api/shopper/me":
      return respondWithMaybeCookie(await getShopperMe({
        shopDomain, shopperCookieId: shopperCookieIdGet,
        shopifyCustomerId: url.searchParams.get("customerId"),
        acceptLanguage: request.headers.get("accept-language"),
      }));
    case "api/shopper/opener":
      return respondWithMaybeCookie(await getShopperOpener({
        shopDomain,
        shopperCookieId: shopperCookieIdGet,
        productHandle: url.searchParams.get("handle"),
      }));
    case "api/shopper/social-proof":
      return respond(await getShopperSocialProof({ shopDomain, shopperCookieId: shopperCookieIdGet }));

    // OI-33 — poll render status after async enqueue.
    // SECURITY: looks up TryOnSession by (shopId, renderId) so a shopper cannot
    // fish for another tenant's render by guessing a renderId.
    case "api/tryon/render/status": {
      const renderId = url.searchParams.get("renderId") ?? "";
      if (!renderId) return cors(json({ ok: false, error: "invalid_input" }, { status: 400 }));
      const shop = await prisma.shop.findUnique({
        where: { shopifyDomain: shopDomain },
        select: { id: true, uninstalledAt: true },
      });
      if (!shop || shop.uninstalledAt) return cors(json({ ok: false, error: "shop_not_installed" }, { status: 404 }));
      const session = await prisma.tryOnSession.findFirst({
        where: { id: renderId, shopId: shop.id },
        select: { status: true, outputImageUrl: true, error: true, latencyMs: true },
      });
      if (!session) return cors(json({ ok: false, error: "not_found" }, { status: 404 }));
      return cors(json({
        ok: true,
        data: {
          status: session.status,
          imageUrl: session.status === "SUCCEEDED" ? session.outputImageUrl : null,
          latencyMs: session.latencyMs,
        },
      }));
    }

    case "":
      // Health probe — confirms the proxy is wired and Shopify signed the request.
      return cors(json({ ok: true, shop: shopDomain, version: "v1" }));
    default:
      return cors(json({ ok: false, error: "not_found" }, { status: 404 }));
  }
}

// ─── POST ────────────────────────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  const shopDomain = await resolveShopDomain(request);
  if (!shopDomain) return cors(json({ ok: false, error: "unauthorized" }, { status: 401 }));

  const path = subPath(request, params["*"]);
  let body: unknown = null;
  try { body = await request.json(); } catch { /* empty body */ }

  const shopperCookieId = readShopperCookie(request);

  switch (path) {
    case "api/fit":    return respond(await postFit({ shopDomain, body, shopperCookieId }));
    case "api/style":  return respond(await postStyle({ shopDomain, body, shopperCookieId }));
    case "api/events": return respond(await postEvent({ shopDomain, body, shopperCookieId }));
    // ONE-BRAIN consolidation: the legacy "api/chat" + "api/chat/stream" cases
    // (the old multi-tool packages/ai brain) were removed — the widget speaks
    // only "api/mira" below, the single unified brain.
    case "api/mira": {
      // SaaS migration Stage 1 — adapter: runs the REAL per-tenant brain and
      // returns the MiraDecision shape the storefront UI speaks, with real
      // per-shop products attached (never a hardcoded catalog).
      const { runMiraAdapter } = await import("../lib/mira-adapter.server");
      const { result, setCookie } = await runMiraAdapter({ shopDomain, body, shopperCookieId, acceptLanguage: request.headers.get("accept-language") });
      const res = cors(json(result));
      if (setCookie) res.headers.append("Set-Cookie", setCookie);
      return res;
    }
    case "api/mira/conversion": {
      // Cycle-9 audit P0 #3: previously this case FORWARDED to the apps/web
      // demo brain (MIRA_BRAIN_ORIGIN), where conversions were appended to a
      // SHARED flat-file (mira-signals.json). On any production storefront
      // that meant: (a) per-shop conversion metrics were absent from the
      // merchant's own Prisma AnalyticsEvent table; (b) the demo file
      // collected signal mixed across every Shopify tenant — a §3.5 #1
      // tenancy invariant break and a cross-shop signal poisoner.
      //
      // Now: write directly into the per-tenant AnalyticsEvent table as
      // CART_FROM_MIRA (already in EventName enum, previously had zero
      // emitters per the audit). Handle resolution is shop-scoped.
      // Fire-and-forget on errors so a Prisma blip never fails the
      // shopper's post-add UX.
      try {
        const b = (body ?? {}) as { productHandle?: string; size?: string };
        const { analytics, shopIdFromDomain } = await import("../lib/shopper-helpers.server");
        const shopId = await shopIdFromDomain(shopDomain);
        if (!shopId) return cors(json({ ok: false, error: "shop_not_installed" }));
        const shopper = shopperCookieId
          ? await prisma.shopperSession.findFirst({
              where: { shopifyDomain: shopDomain, sessionId: shopperCookieId },
              select: { id: true },
            })
          : null;
        const handle = typeof b.productHandle === "string" ? b.productHandle : null;
        const product = handle
          ? await prisma.product.findFirst({
              where: { shopId, handle },
              select: { id: true },
            })
          : null;
        if (!product) return cors(json({ ok: false, error: "product_not_found" }));
        await analytics.track({
          shopId,
          shopperId: shopper?.id,
          name: "CART_FROM_MIRA",
          productId: product.id,
          payload: {
            productId: product.id,
            source: "mira_proxy",
            size: typeof b.size === "string" ? b.size : undefined,
            itemCount: 1,
          },
        });
        return cors(json({ ok: true }));
      } catch (err) {
        console.error("[proxy] api/mira/conversion write failed", err);
        return cors(json({ ok: false, error: "write_failed" }));
      }
    }
    case "api/shopper/signal":
      return respondWithMaybeCookie(await postShopperSignal({ shopDomain, body, shopperCookieId }));
    case "api/shopper/account":
      return respondWithMaybeCookie(await postShopperAccount({ shopDomain, body, shopperCookieId }));
    case "api/shopper/account/verify":
      return respondWithMaybeCookie(await postShopperAccountVerify({ shopDomain, body, shopperCookieId }));
    case "api/tryon/render":
      return respondWithMaybeCookie(await postTryOnRender({ shopDomain, body, shopperCookieId }));
    case "api/tryon": {
      // Exact-demo TryOnPanel render — Gemini img2img (muse/photo). Returns a
      // data: URL the widget renders directly. (Storefront port of apps/web /api/tryon.)
      try {
        const { renderTryOn } = await import("../lib/tryon-render.server");
        const result = await renderTryOn(body as Parameters<typeof renderTryOn>[0]);
        return cors(json({ ok: true, imageUrl: result.imageUrl, cached: result.cached, ms: result.ms }));
      } catch (err) {
        console.error("[tryon] render error:", (err as Error)?.message);
        return cors(json({ ok: false, error: "render_failed" }, { status: 500 }));
      }
    }
    case "api/shopper/combo-feedback":
      return respond(await postComboFeedback({ shopDomain, body, shopperCookieId }));
    case "api/shopper/combo/add-all":
      return respond(await postComboAddAll({ shopDomain, body, shopperCookieId }));
    case "api/shopper/auth/social":
      return respondWithMaybeCookie(await postShopperAuthSocial({ shopDomain, body, shopperCookieId }));

    default:           return cors(json({ ok: false, error: "not_found" }, { status: 404 }));
  }
}
