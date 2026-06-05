// Studio — "Generate creative from combo" action route (OI-4).
//
// Accepts a POST from the dashboard combo list. Creates a CreativeSet row for
// the first product in the combo (CreativeSet is single-product; multi-product
// combos can be expanded into multiple sets later) and enqueues the generation
// job. Redirects back to the dashboard with a ?generated= param so the UI can
// surface a confirmation toast.
//
// SECURITY: authenticated via Shopify admin OAuth session. shopId is resolved
// from the session — never trusted from the form body.

import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { enqueueCreativeSet } from "../queue.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!shop) return redirect("/app/dashboard?error=shop_not_found");

  const form = await request.formData();
  const comboName = String(form.get("comboName") ?? "").trim().slice(0, 80);
  const productIdsRaw = String(form.get("productIds") ?? "");
  const productIds = productIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  if (!comboName || productIds.length === 0) {
    return redirect("/app/dashboard?error=invalid_combo");
  }

  // Use the first product in the combo. Validate it belongs to this shop.
  const productId = productIds[0]!;
  const product = await prisma.product.findFirst({
    where: { id: productId, shopId: shop.id },
    select: { id: true, title: true },
  });
  if (!product) return redirect("/app/dashboard?error=product_not_found");

  // Create the CreativeSet row (PENDING).
  const set = await prisma.creativeSet.create({
    data: {
      shopId: shop.id,
      productId: product.id,
      status: "PENDING",
      brief: { sourceComboName: comboName },
      triggeredBy: `admin_manual:combo:${comboName}`,
    },
    select: { id: true },
  });

  // Enqueue the generation job. Best-effort — the PENDING row stays visible
  // in the dashboard even if the queue is temporarily unavailable.
  await enqueueCreativeSet({
    shopId: shop.id,
    setId: set.id,
    productId: product.id,
    triggeredBy: `admin_manual:combo:${comboName}`,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[studio] failed to enqueue creative-set job", err);
  });

  return redirect(`/app/dashboard?generated=${encodeURIComponent(comboName)}`);
}

// No default export needed — this is an action-only route.
// Remix requires at least a loader or action; action is sufficient here.
