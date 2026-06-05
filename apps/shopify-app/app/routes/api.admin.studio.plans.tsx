// Shoot plan CRUD for the Creative Studio.
//
// Plans are stored as BrandSource rows (kind: MANUAL_INPUT,
// identifier: "shoot_plan:<id>") so no schema migration is needed.
// The plan payload is stored in the `payload` JSON field.
//
// GET    /api/admin/studio/plans         — list all shoot plans for this shop
// POST   /api/admin/studio/plans         — create / upsert a plan
// DELETE /api/admin/studio/plans         — delete a plan by id

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

// ── Schemas ───────────────────────────────────────────────────────────────
const PostSchema = z.object({
  title: z.string().min(1),
  planData: z.record(z.unknown()),
});

const DeleteSchema = z.object({
  id: z.string().min(1),
});

const PLAN_PREFIX = "shoot_plan:";

// ── Loader: GET ───────────────────────────────────────────────────────────
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json({ ok: false, error: "shop_not_installed", plans: [] }, { status: 404 });
  }

  const sources = await prisma.brandSource.findMany({
    where: {
      shopId: shop.id,
      kind: "MANUAL_INPUT",
      identifier: { startsWith: PLAN_PREFIX },
    },
    select: { id: true, identifier: true, payload: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });

  const plans = sources.map((s) => ({
    id: s.id,
    planId: s.identifier?.replace(PLAN_PREFIX, "") ?? s.id,
    payload: s.payload,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  return json({ ok: true, plans });
}

// ── Action: POST / DELETE ─────────────────────────────────────────────────
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json({ ok: false, error: "shop_not_installed" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (request.method === "DELETE") {
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        { ok: false, error: "validation_failed", issues: parsed.error.issues },
        { status: 422 },
      );
    }

    // Delete by BrandSource id (row id, not the planId slug).
    await prisma.brandSource.deleteMany({
      where: { id: parsed.data.id, shopId: shop.id },
    });

    return json({ ok: true });
  }

  // Default: POST — upsert by planId slug derived from title.
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { title, planData } = parsed.data;

  // Derive a stable identifier from the title slug so re-saving the same plan
  // is idempotent. Strip non-alphanumeric, lowercase, max 60 chars.
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  const identifier = `${PLAN_PREFIX}${slug}`;

  const existing = await prisma.brandSource.findFirst({
    where: { shopId: shop.id, identifier },
    select: { id: true },
  });

  const plan = existing
    ? await prisma.brandSource.update({
        where: { id: existing.id },
        data: { payload: { title, ...planData } },
      })
    : await prisma.brandSource.create({
        data: {
          shopId: shop.id,
          kind: "MANUAL_INPUT",
          identifier,
          payload: { title, ...planData },
          status: "READY",
        },
      });

  return json({ ok: true, plan });
}
