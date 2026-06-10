// External dashboard auth — generates a short-lived signed token for a shop.
// Called from apps/web when a merchant logs in via their Shopify store domain.
//
// Flow:
//   1. Brand goes to dashboard.stylique.ai/login
//   2. Enters their .myshopify.com domain
//   3. We redirect them to their Shopify OAuth install URL
//   4. After OAuth, Shopify redirects to /auth/callback which runs afterAuth
//   5. Then we redirect to /api/external-auth?shop=<domain>&dashboard_url=<url>
//   6. This route signs a JWT and redirects to the dashboard with ?token=<jwt>

import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { createExternalToken } from "../lib/external-auth.server";

function allowedDashboardUrl(requested: string | null): string | null {
  const configured = [
    process.env.DASHBOARD_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_PLATFORM_URL,
  ].filter((value): value is string => Boolean(value));

  if (process.env.NODE_ENV !== "production") {
    configured.push("http://localhost:3001", "http://localhost:3000");
  }

  const candidate = requested ?? configured[0];
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const allowedOrigins = new Set(configured.map((value) => new URL(value).origin));
    return allowedOrigins.has(url.origin) ? url.origin : null;
  } catch {
    return null;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, shopifyDomain: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const token = createExternalToken(shop.id, shop.shopifyDomain);

  // Redirect to external dashboard with token
  const url = new URL(request.url);
  const requested = url.searchParams.get("dashboard_url");
  const dashboardUrl = allowedDashboardUrl(requested);
  if (!dashboardUrl) {
    // Explicit, debuggable error in BOTH dev and prod — the silent 400 was
    // landing merchants on a generic page with no clue about the cause. The
    // log line lets ops grep for misconfiguration immediately.
    const hasConfigured = !!(process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_PLATFORM_URL);
    const detail = hasConfigured
      ? `Provided dashboard_url=${requested ?? "(none)"} does not match any configured origin.`
      : `No dashboard URL configured. Set one of DASHBOARD_URL / NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_PLATFORM_URL on the Shopify app deployment.`;
    console.error(`[api.external-auth] ${detail}`);
    throw new Response(detail, { status: 400 });
  }

  return redirect(
    `${dashboardUrl}/auth/callback?token=${encodeURIComponent(token)}&shop=${encodeURIComponent(shop.shopifyDomain)}`,
  );
}
