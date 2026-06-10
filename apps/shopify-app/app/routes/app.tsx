import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import shopify, { authenticate } from "../shopify.server";

// Polaris CSS is NOT loaded here — only app._index and app.catalog use Polaris
// components. All other /app/* routes (settings) are bespoke
// editorial dark (D6). Moving the link to each leaf route saves ~52KB gzip on
// the merchant dashboard and settings pages.
// Polaris AppProvider still works without the stylesheet — it only needs the JS.

// Self-heal webhook registration. With the new embedded/token-exchange auth
// strategy, afterAuth doesn't reliably fire on install, so a shop can end up
// with NO webhook subscriptions (→ no catalog/inventory/size-chart auto-sync).
// Re-registering on admin load converges any such shop. Guarded by an in-process
// set so it runs at most once per shop per boot.
const _webhooksHealed = new Set<string>();

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (session?.shop && !_webhooksHealed.has(session.shop)) {
    _webhooksHealed.add(session.shop);
    try {
      await shopify.registerWebhooks({ session });
    } catch (err) {
      // Don't block the admin UI on a registration hiccup; the declarative TOML
      // subscriptions are the primary path anyway.
      _webhooksHealed.delete(session.shop);
      console.error(`[app] webhook self-heal failed for ${session.shop}:`, (err as Error).message);
    }
  }
  return json({ apiKey: process.env.SHOPIFY_API_KEY ?? "" });
}

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey={apiKey} isEmbeddedApp>
      <ui-nav-menu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/catalog">Catalog</Link>
        <Link to="/app/billing">Billing</Link>
        <Link to="/app/settings/stylist">Stylist</Link>
        <Link to="/app/settings/tryon">Try-on</Link>
        <Link to="/app/settings/brand">Brand DNA</Link>
        <Link to="/app/settings/beauty">Beauty</Link>
      </ui-nav-menu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
