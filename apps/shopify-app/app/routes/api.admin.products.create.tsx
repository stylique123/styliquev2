// POST /api/admin/products/create — create a Shopify product from uploaded images,
// optionally using Gemini Vision to generate product details.
//
// Request body (JSON):
//   {
//     images: Array<{ data: string; mimeType: string; filename: string }>;  // base64 (no data: URI prefix)
//     generateDetails: boolean;
//     details?: {                // pre-filled if already generated in a prior step
//       title: string; description: string; category: string; tags: string[];
//       price: number; currency: string; compareAtPrice?: number;
//     };
//     createCreativeSet: boolean;
//   }
//
// Response (JSON):
//   { ok: true, productId: string, shopifyHandle: string, shopifyProductId: string, creativeSetId?: string }
//
// The route resolves shopId from the authenticated Shopify session — never from
// the request body.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { generateProductDetailsFromImage } from "@stylique/core";
import { enqueueCreativeSet } from "../queue.server";
import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
/** Simple cuid2-like unique id — avoid adding an extra dep. */
function createId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ── Lazy BullMQ queue for image-quality (same pattern as the backfill route) ─

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
let _connection: IORedis | null = null;
let _iqQueue: Queue | null = null;
function getImageQualityQueue(): Queue {
  if (!_iqQueue) {
    _connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    _iqQueue = new Queue("image-quality", { connection: _connection });
  }
  return _iqQueue;
}

// ── Zod schema ───────────────────────────────────────────────────────────────

const ImageInputSchema = z.object({
  data: z.string().min(1).max(10_000_000),  // base64, no data: URI prefix
  mimeType: z
    .string()
    .regex(/^image\/(jpeg|png|webp|heic|heif)$/, "Unsupported image format"),
  filename: z.string().max(256),
});

const DetailsSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(4000).optional().default(""),
  category: z.string().max(100).optional().default("Other"),
  tags: z.array(z.string().max(100)).max(20).optional().default([]),
  price: z.number().min(0),
  currency: z.enum(["USD", "GBP", "PKR"]).optional().default("USD"),
  compareAtPrice: z.number().min(0).optional(),
});

const BodySchema = z.object({
  images: z.array(ImageInputSchema).min(1).max(5),
  generateDetails: z.boolean(),
  details: DetailsSchema.optional(),
  createCreativeSet: z.boolean().optional().default(false),
});

// ── Loader: reject non-POST ──────────────────────────────────────────────────

export async function loader(_args: LoaderFunctionArgs) {
  return json({ error: "method_not_allowed" }, { status: 405 });
}

// ── Action: POST ─────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  // 1. Authenticate via Shopify embedded-app session.
  const { session, admin } = await authenticate.admin(request);

  // 2. Resolve shop from session.
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

  const { images, generateDetails, details, createCreativeSet } = parsed.data;

  // 4. Optionally generate product details from the first image via Gemini Vision.
  let finalDetails = details;
  let generatedConfidence: number | undefined;

  if (generateDetails && !finalDetails) {
    const brandContext: {
      brandName?: string;
      priceRange?: string;
      style?: string;
    } = {
      brandName: session.shop.replace(".myshopify.com", ""),
    };
    const bp = shop.brandProfile;
    if (bp) {
      const tone = bp.toneJson as { description?: string } | null;
      const style = bp.styleVectors as { summary?: string } | null;
      if (tone?.description) brandContext.priceRange = tone.description;
      if (style?.summary) brandContext.style = style.summary;
    }

    const generated = await generateProductDetailsFromImage(
      images[0].data,
      images[0].mimeType,
      brandContext,
    );

    generatedConfidence = generated.confidenceScore;

    finalDetails = {
      title: generated.title || images[0].filename.replace(/\.[^.]+$/, ""),
      description: generated.description,
      category: generated.category,
      tags: generated.tags,
      price: generated.suggestedPriceRange.min,
      currency: generated.suggestedPriceRange.currency,
    };
  }

  if (!finalDetails) {
    return json(
      { ok: false, error: "invalid_payload" },
      { status: 422 },
    );
  }

  // 5. Build Shopify productCreate variables.
  const priceCents = Math.round(finalDetails.price * 100);
  const priceString = (priceCents / 100).toFixed(2);
  const compareAtString = finalDetails.compareAtPrice
    ? (Math.round(finalDetails.compareAtPrice * 100) / 100).toFixed(2)
    : undefined;

  const descHtml = finalDetails.description
    ? `<p>${finalDetails.description.replace(/\n/g, "</p><p>")}</p>`
    : "";

  const tagsString = (finalDetails.tags ?? []).join(", ");

  // 6. Call Shopify Admin GraphQL — productCreate.
  //    We upload base64 image data as media using the simpler productImageCreate
  //    approach (staged uploads are complex and require an extra round-trip).
  //    First create the product shell, then attach images.

  const PRODUCT_CREATE = `#graphql
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
          handle
          legacyResourceId
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  let shopifyProductId: string;
  let shopifyHandle: string;
  let shopifyLegacyId: string;

  try {
    const createResp = await admin.graphql(PRODUCT_CREATE, {
      variables: {
        input: {
          title: finalDetails.title,
          descriptionHtml: descHtml,
          productType: finalDetails.category,
          tags: tagsString,
          variants: [
            {
              price: priceString,
              ...(compareAtString
                ? { compareAtPrice: compareAtString }
                : {}),
            },
          ],
          status: "DRAFT",
        },
      },
    });

    const createData = (await createResp.json()) as {
      data?: {
        productCreate?: {
          product?: {
            id: string;
            title: string;
            handle: string;
            legacyResourceId: string;
          };
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
      errors?: unknown;
    };

    const userErrors = createData.data?.productCreate?.userErrors ?? [];
    if (userErrors.length > 0) {
      console.error("[products/create] Shopify productCreate userErrors:", userErrors);
      return json(
        {
          ok: false,
          error: "shopify_create_failed",
          details: userErrors.map((e) => e.message).join("; "),
        },
        { status: 422 },
      );
    }

    const product = createData.data?.productCreate?.product;
    if (!product) {
      return json({ ok: false, error: "shopify_create_failed" }, { status: 502 });
    }

    shopifyProductId = product.id;        // "gid://shopify/Product/123"
    shopifyHandle = product.handle;
    shopifyLegacyId = product.legacyResourceId; // numeric string
  } catch (err) {
    console.error("[products/create] productCreate GraphQL error:", err);
    return json({ ok: false, error: "shopify_create_failed" }, { status: 502 });
  }

  // 7. Attach images via productImageCreate.
  //    We encode the first image as a data URI and attach it inline.
  //    Shopify accepts data URIs in productImageCreate for base64-encoded images.
  const IMAGE_CREATE = `#graphql
    mutation productImageCreate($productId: ID!, $image: ImageInput!) {
      productImageCreate(productId: $productId, image: $image) {
        image {
          id
          url
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  for (const img of images.slice(0, 3)) {
    try {
      const dataUri = `data:${img.mimeType};base64,${img.data}`;
      await admin.graphql(IMAGE_CREATE, {
        variables: {
          productId: shopifyProductId,
          image: { src: dataUri, altText: finalDetails.title },
        },
      });
    } catch (err) {
      // Non-fatal — product exists, images are bonus.
      console.warn("[products/create] productImageCreate failed (non-fatal):", err);
    }
  }

  // 8. Enqueue image-quality scoring for the new product once it lands in the
  //    next catalog sync. We use the numeric Shopify product ID to build the
  //    BullMQ job key.
  try {
    await getImageQualityQueue().add(
      "score",
      { shopId: shop.id, shopifyProductId: shopifyLegacyId },
      { jobId: `img-q:${shop.id}:new:${shopifyLegacyId}`, removeOnComplete: 50, removeOnFail: 100 },
    );
  } catch (err) {
    // Non-fatal.
    console.warn("[products/create] failed to enqueue image-quality job:", err);
  }

  // 9. Optionally create a CreativeSet + enqueue Studio job.
  let creativeSetId: string | undefined;
  if (createCreativeSet) {
    try {
      const setId = createId();
      const brief = [
        `Product: ${finalDetails.title}`,
        finalDetails.category ? `Category: ${finalDetails.category}` : "",
        finalDetails.description ? `Description: ${finalDetails.description}` : "",
        (finalDetails.tags ?? []).length
          ? `Tags: ${(finalDetails.tags ?? []).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      await prisma.creativeSet.create({
        data: {
          id: setId,
          shopId: shop.id,
          status: "PENDING",
          brief: { text: brief },
          triggeredBy: "product_image_upload",
        },
      });

      await enqueueCreativeSet({
        shopId: shop.id,
        setId,
        productId: "",  // product not yet in our DB; worker resolves on sync
        triggeredBy: "product_image_upload",
        brief,
      }).catch((err) => {
        console.warn("[products/create] failed to enqueue creative-set job:", err);
      });

      creativeSetId = setId;
    } catch (err) {
      console.warn("[products/create] creative set creation failed (non-fatal):", err);
    }
  }

  // 10. Fire analytics event — track AI-assisted product creation.
  if (generateDetails) {
    try {
      await prisma.analyticsEvent.create({
        data: {
          shopId: shop.id,
          name: "PRODUCT_CREATED_VIA_AI",
          payload: {
            shopifyProductId: shopifyLegacyId,
            shopifyHandle,
            category: finalDetails.category,
            confidenceScore: generatedConfidence,
            creativeSetId,
          },
        },
      });
    } catch (err) {
      console.warn("[products/create] analytics track failed (non-fatal):", err);
    }
  }

  return json({
    ok: true,
    shopifyProductId: shopifyLegacyId,
    shopifyHandle,
    creativeSetId,
  });
}
