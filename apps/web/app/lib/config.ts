// External URL configuration for apps/web.
// These are the two service URLs that web needs to know about:
//   - SHOPIFY_APP_URL: where apps/shopify-app is hosted (for OAuth redirects)
//   - DASHBOARD_URL:   where apps/web itself is hosted (returned to Shopify after auth)

export const SHOPIFY_APP_URL =
  process.env.NEXT_PUBLIC_SHOPIFY_APP_URL ?? "http://localhost:3000";

export const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3001";
