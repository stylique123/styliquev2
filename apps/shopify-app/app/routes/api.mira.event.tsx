import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { EventNameSchema } from "@stylique/types";
import { prisma } from "../db.server";
import { analytics, rateOk } from "../lib/shopper-helpers.server";
import { getOrCreateShopperSession } from "../lib/session.server";
import { logCatalogGap } from "../lib/taste.server";

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
    };
  }
  return data;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const bridgeSecret = process.env.MIRA_EVENT_BRIDGE_SECRET;
  if (bridgeSecret && request.headers.get("x-stylique-bridge-secret") !== bridgeSecret) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = MiraBridgeSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_input" }, { status: 400 });
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

  try {
    await analytics.track({
      shopId: shop.id,
      shopperId: session?.row.id,
      productId: product?.id,
      name: parsed.data.event,
      payload,
    });
  } catch {
    return json({ ok: false, error: "invalid_payload" }, { status: 422 });
  }

  if (parsed.data.event === "MIRA_UNMET_DEMAND" || parsed.data.event === "CHAT_NEAR_MISS") {
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
