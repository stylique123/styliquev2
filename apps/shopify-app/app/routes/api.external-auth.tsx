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
  const dashboardUrl =
    url.searchParams.get("dashboard_url") ?? "http://localhost:3001";

  return redirect(
    `${dashboardUrl}/auth/callback?token=${token}&shop=${shop.shopifyDomain}`,
  );
}
