import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { EventNameSchema } from "@stylique/types";
import { prisma } from "../db.server";
import { analytics, rateOk } from "../lib/shopper-helpers.server";
import { getOrCreateShopperSession } from "../lib/session.server";
import { logCatalogGap } from "../lib/taste.server";
import { validateShopProductEvidence } from "../lib/product-evidence.server";

export async function loader(_args: LoaderFunctionArgs) {
  return json({ ok: true, route: "api.mira.event" });
}

const MiraBridgeSchema = z.object({
  event: EventNameSchema,
  productHandle: z.string().optional(),
  shopifyDomain: z.string().optional(),
  shopperSessionId: z.string().optional(),
  source: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});

const BRIDGE_ACCEPTED_EVENTS: ReadonlySet<string> = new Set([
  "MIRA_INTENT_CAPTURED",
  "MIRA_PRODUCT_RECOMMENDED",
  "MIRA_OUTFIT_RECOMMENDED",
  "MIRA_SIZE_HELP_STARTED",
  "MIRA_TRYON_OFFERED",
  "MIRA_HESITATION_DETECTED",
  "MIRA_ADD_TO_CART_ASSIST",
  "MIRA_UNMET_DEMAND",
  "MIRA_NEAR_MISS",
  "CHAT_NEAR_MISS",
  "PDP_TRYON_CLICKED",
  "TRYON_RENDER_REQUESTED",
  "TRYON_RENDER_COMPLETED",
  "TRYON_RENDER_FAILED",
  "TRYON_ABANDONED",
  "CART_FROM_TRYON",
  "MIRA_PROACTIVE_TRIGGERED",
  "MIRA_BEHAVIORAL_TRIGGER_FIRED",
  "MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED",
]);

const BRIDGE_CART_SUCCESS_EVENTS: ReadonlySet<string> = new Set([
  "CART_FROM_TRYON",
]);

function normalizeShopDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value)) return value;
  return null;
}

function normalizeBridgePayload(event: string, data: Record<string, unknown>) {
  if (event === "CHAT_NEAR_MISS") {
    return {
      query: typeof data.query === "string" ? data.query : typeof data.input === "string" ? data.input : undefined,
      nearMissProductId: typeof data.nearMissProductId === "string" ? data.nearMissProductId : undefined,
      nearMissAttribute: typeof data.nearMissAttribute === "string" ? data.nearMissAttribute : undefined,
      category: typeof data.category === "string" ? data.category : typeof data.nearMissCategory === "string" ? data.nearMissCategory : undefined,
      resultCount: typeof data.resultCount === "number" ? data.resultCount : undefined,
      missingItem: data.missingItem === true || data.createsCatalogGap === true,
    };
  }
  if (event === "MIRA_UNMET_DEMAND") {
    return {
      query: typeof data.query === "string" ? data.query : typeof data.input === "string" ? data.input : undefined,
      canonicalCategory: typeof data.canonicalCategory === "string" ? data.canonicalCategory : typeof data.category === "string" ? data.category : undefined,
      resultCount: typeof data.resultCount === "number" ? data.resultCount : undefined,
    };
  }
  if (event === "MIRA_NEAR_MISS") {
    return {
      query: typeof data.query === "string" ? data.query : typeof data.input === "string" ? data.input : undefined,
      nearMissProductId: typeof data.nearMissProductId === "string" ? data.nearMissProductId : undefined,
      nearMissAttribute: typeof data.nearMissAttribute === "string" ? data.nearMissAttribute : undefined,
      canonicalCategory: typeof data.canonicalCategory === "string" ? data.canonicalCategory : typeof data.category === "string" ? data.category : undefined,
      missingItem: data.missingItem === true || data.createsCatalogGap === true,
    };
  }
  return data;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const bridgeSecret = process.env.MIRA_EVENT_BRIDGE_SECRET;
  if (!bridgeSecret && process.env.NODE_ENV === "production") {
    return json({ ok: false, error: "bridge_secret_required" }, { status: 503 });
  }
  if (bridgeSecret && request.headers.get("x-stylique-bridge-secret") !== bridgeSecret) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = MiraBridgeSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_input" }, { status: 400 });
  }
  if (!BRIDGE_ACCEPTED_EVENTS.has(parsed.data.event)) {
    return json({ ok: false, error: "unauthorized_event" }, { status: 403 });
  }

  const shopifyDomain = normalizeShopDomain(parsed.data.shopifyDomain)
    ?? normalizeShopDomain(process.env.DEMO_SHOPIFY_DOMAIN)
    ?? normalizeShopDomain(process.env.SHOPIFY_DEV_STORE_DOMAIN);
  if (!shopifyDomain) {
    return json({ ok: false, error: "shop_required" }, { status: 400 });
  }
  if (!await rateOk(`mira:${shopifyDomain}`, parsed.data.shopperSessionId ?? null)) {
    return json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain },
    select: { id: true, uninstalledAt: true },
  });
  if (!shop || shop.uninstalledAt) {
    return json({ ok: false, error: "shop_not_installed" }, { status: 404 });
  }

  const product = parsed.data.productHandle
    ? await prisma.product.findFirst({
        where: { shopId: shop.id, handle: parsed.data.productHandle },
        select: { id: true },
      })
    : null;
  const session = parsed.data.shopperSessionId
    ? await getOrCreateShopperSession({
        shopifyDomain,
        cookieId: parsed.data.shopperSessionId,
      })
    : null;
  const payload = normalizeBridgePayload(parsed.data.event, parsed.data.data ?? {});
  const productEvidence = await validateShopProductEvidence({
    shopId: shop.id,
    eventName: parsed.data.event,
    productId: product?.id,
    payload,
    cartSuccessEvents: BRIDGE_CART_SUCCESS_EVENTS,
  });
  if (!productEvidence.ok) return json({ ok: false, error: "invalid_payload" }, { status: 422 });

  try {
    await analytics.track({
      shopId: shop.id,
      shopperId: session?.row.id,
      productId: productEvidence.productId,
      name: parsed.data.event,
      payload: productEvidence.payload,
    });
  } catch {
    return json({ ok: false, error: "invalid_payload" }, { status: 422 });
  }

  const shouldLogGap = parsed.data.event === "MIRA_UNMET_DEMAND"
    || ((parsed.data.event === "CHAT_NEAR_MISS" || parsed.data.event === "MIRA_NEAR_MISS")
      && (payload as { missingItem?: boolean }).missingItem === true);
  if (shouldLogGap) {
    const p = payload as { query?: string; resultCount?: number; category?: string; canonicalCategory?: string };
    if (p.query) {
      void logCatalogGap({
        shopId: shop.id,
        shopperRowId: session?.row.id ?? null,
        rawQuery: p.query,
        resultCount: Math.max(0, Math.floor(p.resultCount ?? 0)),
        category: p.category ?? p.canonicalCategory,
        source: parsed.data.event.toLowerCase(),
      }).catch(() => undefined);
    }
  }

  return json({ ok: true, accepted: true });
}
