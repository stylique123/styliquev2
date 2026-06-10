// POST /api/admin/beauty/tune-shades — run the shade-weight tuner against the
// authenticated shop's recent BEAUTY_SHADE_MATCHED + cart-outcome events.
// Reads back per-factor lift on kept-vs-returned shades, nudges
// Plan.planFeaturesJson.beauty.shadeWeights toward what's working.
//
// Closes the learning loop the reality panel called out. Synchronous because
// the tuner is just two Prisma reads + a write — runs in tens of milliseconds.
//
// GET — peek at the current per-shop weights (or null if untuned).

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { readShadeWeights, tuneShadeWeights } from "../lib/shade-tuner.server";
import { DEFAULT_SHADE_WEIGHTS } from "@stylique/core";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const current = await readShadeWeights(shop.id);
  return json({
    ok: true,
    current: current ?? null,
    defaults: DEFAULT_SHADE_WEIGHTS,
    tuned: !!current,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json({ ok: false, error: "shop_not_installed" }, { status: 404 });

  const result = await tuneShadeWeights(shop.id);
  return json(result);
}
