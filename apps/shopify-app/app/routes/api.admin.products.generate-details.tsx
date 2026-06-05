// POST /api/admin/products/generate-details — Gemini Vision product detail
// generator (generate-only, does NOT create a Shopify product).
//
// Called by the "Generate Details" button on app.products.new.tsx. Receives
// one product image as base64, calls generateProductDetailsFromImage, and
// returns the structured fields for the brand to review + edit before
// publishing.
//
// Request body:
//   { image: { data: string; mimeType: string; filename: string } }
//
// Response:
//   { ok: true, details: GeneratedProductDetails }

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { generateProductDetailsFromImage } from "@stylique/core";

const BodySchema = z.object({
  image: z.object({
    data: z.string().min(1).max(10_000_000),
    mimeType: z
      .string()
      .regex(/^image\/(jpeg|png|webp|heic|heif)$/, "Unsupported image format"),
    filename: z.string().max(256),
  }),
});

export async function loader(_args: LoaderFunctionArgs) {
  return json({ error: "method_not_allowed" }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  // 1. Authenticate via Shopify embedded-app session.
  const { session } = await authenticate.admin(request);

  // 2. Resolve shop for brand context enrichment.
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      id: true,
      brandProfile: {
        select: { toneJson: true, styleVectors: true },
      },
    },
  });
  if (!shop) {
    return json({ ok: false, error: "shop_not_installed" }, { status: 404 });
  }

  // 3. Parse + validate body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { image } = parsed.data;

  // 4. Build brand context from BrandProfile if available.
  const brandContext: { brandName?: string; priceRange?: string; style?: string } = {
    brandName: session.shop.replace(".myshopify.com", ""),
  };
  const bp = shop.brandProfile;
  if (bp) {
    const tone = bp.toneJson as { description?: string } | null;
    const style = bp.styleVectors as { summary?: string } | null;
    if (tone?.description) brandContext.priceRange = tone.description;
    if (style?.summary) brandContext.style = style.summary;
  }

  // 5. Call Gemini Vision generator.
  const details = await generateProductDetailsFromImage(
    image.data,
    image.mimeType,
    brandContext,
  );

  return json({ ok: true, details });
}
