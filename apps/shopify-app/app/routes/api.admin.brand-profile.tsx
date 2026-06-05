// GET  /api/admin/brand-profile — return BrandProfile for the authenticated shop.
// PATCH /api/admin/brand-profile — upsert BrandProfile fields.
//
// The Creative Studio calls these from apps/creative (VITE_SHOPIFY_APP_URL).
// Fields like name, handle, description, logoUrl, colorPalette are stored in
// toneJson as a freeform object so we don't need a schema migration.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

// ── Schema ────────────────────────────────────────────────────────────────
const PatchSchema = z.object({
  name: z.string().optional(),
  handle: z.string().optional(),
  description: z.string().optional(),
  logoUrl: z.string().url().optional(),
  colorPalette: z.array(z.string()).optional(),
});

// ── Loader: GET ───────────────────────────────────────────────────────────
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json({ ok: false, error: "shop_not_installed" }, { status: 404 });
  }

  const profile = await prisma.brandProfile.findUnique({
    where: { shopId: shop.id },
    select: {
      id: true,
      shopId: true,
      paletteJson: true,
      toneJson: true,
      styleVectors: true,
      trainedAt: true,
      updatedAt: true,
    },
  });

  return json({ ok: true, profile });
}

// ── Action: PATCH ─────────────────────────────────────────────────────────
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PATCH") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

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

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { name, handle, description, logoUrl, colorPalette } = parsed.data;

  // Load existing toneJson so we can merge rather than overwrite.
  const existing = await prisma.brandProfile.findUnique({
    where: { shopId: shop.id },
    select: { toneJson: true, paletteJson: true },
  });

  const existingTone =
    existing?.toneJson && typeof existing.toneJson === "object"
      ? (existing.toneJson as Record<string, unknown>)
      : {};

  const mergedTone: Record<string, unknown> = { ...existingTone };
  if (name !== undefined) mergedTone.name = name;
  if (handle !== undefined) mergedTone.handle = handle;
  if (description !== undefined) mergedTone.description = description;
  if (logoUrl !== undefined) mergedTone.logoUrl = logoUrl;

  const mergedPalette =
    colorPalette !== undefined
      ? colorPalette
      : (existing?.paletteJson ?? undefined);

  const profile = await prisma.brandProfile.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      // Prisma InputJsonValue requires a JSON-compatible cast; Record<string,unknown>
      // is structurally compatible at runtime but needs the explicit assertion.
      toneJson: mergedTone as Parameters<typeof prisma.brandProfile.upsert>[0]["create"]["toneJson"],
      paletteJson: (mergedPalette ?? undefined) as Parameters<typeof prisma.brandProfile.upsert>[0]["create"]["paletteJson"],
    },
    update: {
      toneJson: mergedTone as Parameters<typeof prisma.brandProfile.upsert>[0]["update"]["toneJson"],
      ...(colorPalette !== undefined ? { paletteJson: colorPalette as Parameters<typeof prisma.brandProfile.upsert>[0]["update"]["paletteJson"] } : {}),
    },
  });

  return json({ ok: true, profile });
}
