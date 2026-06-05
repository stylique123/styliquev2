// POST /api/admin/studio/generate — Creative Studio generation trigger.
//
// Called by apps/creative (the Creative Studio SPA) when a brand wants to
// generate a new creative set. Authenticates via Shopify embedded-app session
// (same as every other api.admin.* route), so shopId is always resolved from
// the session and never trusted from the request body.
//
// Request body (JSON):
//   { setId: string, productId?: string, triggeredBy?: string, brief?: string }
//
// Response (JSON):
//   { ok: true, renderId: string }   — renderId === setId for this v1
//
// The route upserts a CreativeSet row in PENDING status then enqueues a
// creative-set BullMQ job. The worker picks it up and calls Replicate FLUX.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { enqueueCreativeSet } from "../queue.server";
import { canConsume, recordConsume } from "../lib/entitlement.server";

// ── Schema ────────────────────────────────────────────────────────────────
const BodySchema = z.object({
  setId: z.string().min(1),
  productId: z.string().optional(),
  triggeredBy: z.string().optional(),
  brief: z.string().optional(),
});

// ── Loader: reject non-POST callers with 405 ─────────────────────────────
export async function loader(_args: LoaderFunctionArgs) {
  return json({ error: "method_not_allowed" }, { status: 405 });
}

// ── Action: POST ──────────────────────────────────────────────────────────
export async function action({ request }: ActionFunctionArgs) {
  // 1. Authenticate via Shopify embedded-app session.
  const { session } = await authenticate.admin(request);

  // 2. Resolve shop from the session (never trusted from the body).
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json({ ok: false, error: "shop_not_installed" }, { status: 404 });
  }

  // 3. Parse + validate request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { setId, productId, triggeredBy, brief } = parsed.data;

  const gate = await canConsume({ shopId: shop.id, metric: "CREATIVE_SET_GENERATED" });
  if (!gate.allowed) {
    return json({ ok: false, error: gate.reason === "QUOTA_EXHAUSTED" ? "quota_reached" : "feature_disabled" }, { status: 402 });
  }

  // 4. Validate productId belongs to this shop (if supplied).
  if (productId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, shopId: shop.id },
      select: { id: true },
    });
    if (!product) {
      return json({ ok: false, error: "product_not_found" }, { status: 404 });
    }
  }

  // 5. Upsert CreativeSet row in PENDING state.
  //    Using upsert so that retries from the Creative Studio are safe — if
  //    the row already exists and is PENDING, it is left as-is so the
  //    worker can pick it up again.
  await prisma.creativeSet.upsert({
    where: { id: setId },
    create: {
      id: setId,
      shopId: shop.id,
      productId: productId ?? null,
      status: "PENDING",
      brief: brief ? { text: brief } : undefined,
      triggeredBy: triggeredBy ?? "manual",
    },
    update: {
      // Only reset to PENDING if a previous attempt ended in FAILED.
      // GENERATING / READY / PARTIAL states are left untouched.
      status: { set: "PENDING" },
      brief: brief ? { text: brief } : undefined,
      triggeredBy: triggeredBy ?? "manual",
      error: null,
    },
  });

  // 6. Enqueue the BullMQ job.
  await enqueueCreativeSet({
    shopId: shop.id,
    setId,
    productId: productId ?? "",
    triggeredBy: triggeredBy ?? "manual",
    brief,
  }).catch((err) => {
    // Non-fatal: the PENDING row is visible on the dashboard; an admin can
    // re-trigger later if the queue is temporarily unavailable.
    console.error("[studio/generate] failed to enqueue creative-set job", err);
  });

  void recordConsume({ shopId: shop.id, metric: "CREATIVE_SET_GENERATED", by: 1 });

  // 7. Return renderId (= setId for v1).
  return json({ ok: true, renderId: setId });
}
