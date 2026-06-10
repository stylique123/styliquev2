import "@shopify/shopify-app-remix/adapters/node";
import { ApiVersion, AppDistribution, DeliveryMethod, shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "./db.server";
import { env } from "./env.server";
import { ensureShopRecord } from "./services/shop.server";

const shopify = shopifyApp({
  apiKey: env.SHOPIFY_API_KEY,
  apiSecretKey: env.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.January25,
  scopes: env.SHOPIFY_SCOPES.split(",").map((s) => s.trim()).filter(Boolean),
  appUrl: env.SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  distribution: AppDistribution.AppStore,
  sessionStorage: new PrismaSessionStorage(prisma as any),
  isEmbeddedApp: true,
  hooks: {
    afterAuth: async ({ session }) => {
      // Fetch the store's own currency so Mira formats prices in it (panel P0).
      // Best-effort — defaults to USD in ensureShopRecord if this fails.
      let currencyCode: string | undefined;
      try {
        if (session.accessToken) {
          const res = await fetch(`https://${session.shop}/admin/api/2025-01/graphql.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": session.accessToken },
            body: JSON.stringify({ query: "query { shop { currencyCode } }" }),
            signal: AbortSignal.timeout(10000),
          });
          const j = (await res.json()) as { data?: { shop?: { currencyCode?: string } } };
          currencyCode = j.data?.shop?.currencyCode;
        }
      } catch (err) {
        console.error(`[afterAuth] currency fetch failed for ${session.shop}:`, (err as Error).message);
      }
      const shop = await ensureShopRecord({
        shopifyDomain: session.shop,
        accessToken: session.accessToken ?? "",
        scopes: session.scope ?? env.SHOPIFY_SCOPES,
        currencyCode,
      });
      await shopify.registerWebhooks({ session });
      // D38a-r1 — kick off the per-brand muse library + top-50 pre-warm
      // exactly once. jobId is shop-scoped so reinstalls dedupe. Best-
      // effort enqueue — install never fails because of queue trouble.
      try {
        const { enqueueBrandInstall } = await import("./queue.server");
        await enqueueBrandInstall({ shopId: shop.id });
      } catch (err) {
        console.error(`[afterAuth] brand-install enqueue failed for ${session.shop}:`, (err as Error).message);
      }
      // OI-18: schedule first nightly recommendations run for this shop
      // so we don't have to wait for a worker restart
      try {
        const { recommendationsQueue, enqueueCatalogSync, enqueueBrandDnaCatalog } = await import("./queue.server");
        await enqueueCatalogSync({ kind: "full", shopId: shop.id });
        await enqueueBrandDnaCatalog({ shopId: shop.id }, { jobId: `brand-dna-install:${shop.id}` });
        await recommendationsQueue.add("recommendations", { shopId: shop.id }, {
          jobId: `rec-first:${shop.id}`,
          delay: 5 * 60 * 1000, // 5 min after install, catalog has time to sync
        });
      } catch (err) {
        console.error(`[afterAuth] initial provisioning jobs failed for ${session.shop}:`, (err as Error).message);
      }
      // Auto-inject widget + stylist onto the merchant's storefront.
      // Creates ScriptTags so both scripts load on every store page immediately —
      // merchants don't need to manually add a theme block.
      try {
        const { ensureScriptTags } = await import("./services/scriptTag.server");
        if (session.accessToken) {
          await ensureScriptTags(
            { shop: session.shop, accessToken: session.accessToken },
            env.SHOPIFY_APP_URL,
          );
        }
      } catch (err) {
        console.error(`[afterAuth] scriptTag creation failed for ${session.shop}:`, (err as Error).message);
      }
    },
  },
  webhooks: {
    PRODUCTS_CREATE:    { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/products" },
    PRODUCTS_UPDATE:    { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/products" },
    PRODUCTS_DELETE:    { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/products" },
    APP_UNINSTALLED:    { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/app-uninstalled" },
    ORDERS_CREATE:      { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/orders" },
    // OI-3 — taste-vector signals from fulfilment + returns.
    // Auto-registered on every afterAuth (install + reinstall). The handlers
    // emit CART_CONFIRMED / CART_CANCELLED events and trigger a taste recompute.
    ORDERS_FULFILLED:   { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/orders/fulfilled" },
    REFUNDS_CREATE:     { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/orders/returned" },
    // Mandatory Shopify privacy/GDPR compliance webhooks (App Store requirement).
    CUSTOMERS_DATA_REQUEST: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/customers/data-request" },
    CUSTOMERS_REDACT:       { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/customers/redact" },
    SHOP_REDACT:            { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks/shop/redact" },
  },
  future: { unstable_newEmbeddedAuthStrategy: true },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const sessionStorage = shopify.sessionStorage;
