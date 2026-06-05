import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { sessionStorage } from "../shopify.server";
import { markShopUninstalled } from "../services/shop.server";
import { prisma } from "../db.server";
import { env } from "../env.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, session } = await authenticate.webhook(request);

  // 1. Drop offline sessions so we stop trying to call Shopify with revoked tokens.
  if (session) await sessionStorage.deleteSessions([session.id]);

  // 2. Mark Shop disconnected. Data is preserved so reinstall is seamless.
  await markShopUninstalled(shop);

  // 3. Best-effort ScriptTag cleanup. The access token may already be revoked
  //    by the time this webhook fires — errors are swallowed so the response
  //    always returns 200 (Shopify retries non-2xx webhooks).
  try {
    const { deleteScriptTags } = await import("../services/scriptTag.server");
    // Prefer the session attached to this webhook delivery; fall back to any
    // stored offline session for the shop if Shopify didn't include one.
    const rawSess = session
      ? { shop: session.shop, accessToken: session.accessToken }
      : await prisma.session.findFirst({ where: { shop }, select: { shop: true, accessToken: true } });
    if (rawSess?.accessToken) {
      await deleteScriptTags({ shop: rawSess.shop, accessToken: rawSess.accessToken }, env.SHOPIFY_APP_URL);
    }
  } catch (err) {
    console.error(`[uninstall] scriptTag cleanup error for ${shop}:`, (err as Error).message);
  }

  return new Response();
}
