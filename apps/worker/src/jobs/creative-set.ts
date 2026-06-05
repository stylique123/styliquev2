// Creative-set worker — provider-agnostic image + video + PDF generation.
//
// Primary image path: Vertex AI Imagen 3 (GCP credits, brand-reference-conditioned
// via Imagen Customization when BrandProfile reference assets exist).
// Video path: Vertex Veo 2/3 for VIDEO_KINDS (STORY_VIDEO, INSTAGRAM_STORY,
// WHATSAPP_STATUS, REELS_COVER).
// Fallback image path: Replicate FLUX 1.1-pro (cash) when Vertex auth absent.
// Dev fallback: stub provider (transparent PNG).
// PDF path: LOOKBOOK_PDF uses generateLookbookPDF() — no image provider call.
//
// Storage tiering (mirrors tryon-render.ts OI-31):
//   1. S3 (S3_TRYON_BUCKET set) → creative/<setId>/<idx>.<ext>
//   2. Local disk (STORAGE_PATH set) → ${STORAGE_PATH}/creative/<setId>/<idx>.<ext>
//   3. Inline data: URL in DB (dev fallback)
//
// Brand-DNA conditioning is read from BrandProfile when present:
//   • paletteJson  → style.paletteHex
//   • toneJson     → style.{moodAdjectives, lighting, modelArchetype, composition}
//   • referenceAssets → top 4 most recent passed to Vertex as REFERENCE_TYPE_STYLE
//
// On success → creates a Creative row per generated image (role STILL, or MOTION
// for video) + sets CreativeSet.status = READY.
// On failure → CreativeSet.status = FAILED.

import { prisma } from "@stylique/db";
import {
  resolveCreativeProvider,
  generateLookbookPDF,
  DEFAULT_ASPECT,
  DEFAULT_COUNT,
  VIDEO_KINDS,
  type CreativeOutputKind,
  type CreativeRenderInput,
  type CreativeRenderOutput,
  type BrandReferenceAsset,
  type BrandStyleHints,
  type LookbookPage,
  type LookbookBrandMeta,
} from "@stylique/core";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ─── S3 client (lazy singleton) ────────────────────────────────────────────
const s3 = process.env.S3_TRYON_BUCKET
  ? new S3Client({
      region: process.env.AWS_REGION ?? "us-east-1",
      credentials: process.env.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
          }
        : undefined,
    })
  : null;

export type CreativeSetJobData = {
  shopId: string;
  setId: string;
  productId: string;
  triggeredBy: string;
  brief?: string;
  /** Optional explicit output kind; defaults to PDP_PRODUCT. */
  kind?: CreativeOutputKind;
};

/** Build the per-job render input from CreativeSet + BrandProfile + product. */
async function buildRenderInput(data: CreativeSetJobData): Promise<CreativeRenderInput> {
  const kind = data.kind ?? "PDP_PRODUCT";

  const [product, brand] = await Promise.all([
    data.productId
      ? prisma.product.findFirst({
          where: { id: data.productId, shopId: data.shopId },
          select: {
            title: true,
            category: true,
            primaryColor: true,
            primaryTryonImageId: true,
          },
        })
      : Promise.resolve(null),
    prisma.brandProfile.findUnique({
      where: { shopId: data.shopId },
      select: {
        paletteJson: true,
        toneJson: true,
        referenceAssets: {
          select: { id: true, url: true, kind: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 4,
        },
      },
    }),
  ]);

  // Resolve garment image URL when possible (prepped for VTO is best, falls
  // back to the first product image).
  let garmentImageUrl: string | null = null;
  if (product?.primaryTryonImageId) {
    const img = await prisma.productImage.findUnique({
      where: { id: product.primaryTryonImageId },
      select: { url: true, preppedUrl: true },
    });
    garmentImageUrl = img?.preppedUrl ?? img?.url ?? null;
  }

  // Style hints from BrandProfile JSON columns — be defensive about shape.
  const tone = (brand?.toneJson ?? {}) as Record<string, unknown>;
  const palette = brand?.paletteJson as { hex?: string[] } | string[] | null | undefined;
  const paletteHex = Array.isArray(palette)
    ? (palette as string[])
    : (palette?.hex ?? []);

  const style: BrandStyleHints = {
    paletteHex: paletteHex.slice(0, 6),
    moodAdjectives: Array.isArray(tone.moodAdjectives) ? (tone.moodAdjectives as string[]).slice(0, 5) : undefined,
    lighting: typeof tone.lighting === "string" ? tone.lighting : undefined,
    modelArchetype: typeof tone.modelArchetype === "string" ? tone.modelArchetype : undefined,
    composition: typeof tone.composition === "string" ? tone.composition : undefined,
  };

  const referenceAssets: BrandReferenceAsset[] = (brand?.referenceAssets ?? [])
    .filter((a) => typeof a.url === "string" && a.url.length > 0)
    .map((a) => ({ url: a.url, kind: "campaign" as const }));

  const promptBase =
    data.brief && data.brief.trim().length > 0
      ? data.brief.trim()
      : `High-end fashion editorial photograph, ${product?.title ?? "fashion item"}, clean studio backdrop`;

  return {
    prompt: promptBase,
    product: product
      ? {
          title: product.title,
          category: product.category,
          primaryColor: product.primaryColor,
          garmentImageUrl,
        }
      : undefined,
    brand:
      referenceAssets.length || Object.values(style).some(Boolean)
        ? { referenceAssets, style }
        : undefined,
    output: {
      kind,
      aspectRatio: DEFAULT_ASPECT[kind],
      count: DEFAULT_COUNT[kind],
    },
  };
}

/** Upload bytes to S3 and return the public URL. */
async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<string> {
  const bucket = process.env.S3_TRYON_BUCKET!;
  await s3!.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=2592000",
    }),
  );
  const region = process.env.AWS_REGION ?? "us-east-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/** Persist one generated image/video/PDF through the storage tier chain. */
async function persistImage(
  setId: string,
  index: number,
  img: CreativeRenderOutput["images"][number],
  overrideExt?: string,
): Promise<string> {
  // If it's already a hosted URL (e.g. Replicate CDN), download then re-host.
  // If it's a data: URI, decode and host.
  let bytes: Buffer | null = null;
  let ext = overrideExt ?? "webp";
  let contentTypePrefix = "image";

  if (img.image.startsWith("data:")) {
    const m = img.image.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return img.image; // can't decode, keep raw
    bytes = Buffer.from(m[2]!, "base64");
    const mimeType = m[1] ?? "image/png";
    const parts = mimeType.split("/");
    contentTypePrefix = parts[0] ?? "image";
    ext = overrideExt ?? (parts[1] ?? "png");
  } else if (img.image.startsWith("http")) {
    try {
      const res = await fetch(img.image);
      if (res.ok) {
        bytes = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") || "image/webp";
        const parts = ct.split("/");
        contentTypePrefix = parts[0] ?? "image";
        ext = overrideExt ?? (parts[1] ?? "webp");
      }
    } catch {
      // Network blip — keep the original URL.
      return img.image;
    }
  }

  if (!bytes) return img.image;

  const contentType = `${contentTypePrefix}/${ext}`;

  try {
    if (s3) {
      const key = `creative/${setId}/${index}.${ext}`;
      return await uploadToS3(key, bytes, contentType);
    }
    const storagePath = process.env.STORAGE_PATH;
    if (storagePath) {
      const dir = join(storagePath, "creative", setId);
      await mkdir(dir, { recursive: true });
      const filename = `${index}.${ext}`;
      await writeFile(join(dir, filename), new Uint8Array(bytes));
      return `/api/creative/image/${setId}/${index}`;
    }
  } catch (err) {
    console.error("[creative-set] storage error (falling back to inline)", err);
  }

  // Dev fallback: inline data URI in DB.
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

/** Persist a PDF Buffer through the storage tier chain. */
async function persistPdf(setId: string, buf: Buffer): Promise<string> {
  try {
    if (s3) {
      const key = `creative/${setId}/lookbook.pdf`;
      return await uploadToS3(key, buf, "application/pdf");
    }
    const storagePath = process.env.STORAGE_PATH;
    if (storagePath) {
      const dir = join(storagePath, "creative", setId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "lookbook.pdf"), new Uint8Array(buf));
      return `/api/creative/image/${setId}/lookbook.pdf`;
    }
  } catch (err) {
    console.error("[creative-set] pdf storage error (falling back to inline)", err);
  }
  return `data:application/pdf;base64,${buf.toString("base64")}`;
}

// ───────────────────────────────────────────────────────────────────────
// LOOKBOOK_PDF pipeline — queries previously-generated Creative images for
// the product, then calls generateLookbookPDF().
// ───────────────────────────────────────────────────────────────────────

async function processLookbookPdf(data: CreativeSetJobData): Promise<string[]> {
  // Gather product info.
  const product = data.productId
    ? await prisma.product.findFirst({
        where: { id: data.productId, shopId: data.shopId },
        select: { title: true, category: true },
      })
    : null;

  // Fetch up to 6 previously-succeeded STILL Creative images for this product.
  const priorCreatives = await prisma.creative.findMany({
    where: {
      shopId: data.shopId,
      productId: data.productId || undefined,
      role: "STILL",
      status: "SUCCEEDED",
      imageUrl: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { imageUrl: true, prompt: true },
  });

  // Fetch brand palette for cover/back cover color.
  const brand = await prisma.brandProfile.findUnique({
    where: { shopId: data.shopId },
    select: { paletteJson: true },
  });
  const rawPalette = brand?.paletteJson as { hex?: string[] } | string[] | null | undefined;
  const paletteHex = Array.isArray(rawPalette)
    ? (rawPalette as string[]).slice(0, 6)
    : (rawPalette?.hex?.slice(0, 6) ?? ["#1a1a1a", "#e8d5b7"]);

  // Fetch shop name for brand meta.
  const shop = await prisma.shop.findUnique({
    where: { id: data.shopId },
    select: { shopifyDomain: true },
  });
  const brandName = shop?.shopifyDomain?.replace(".myshopify.com", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ?? "Brand";

  const brandMeta: LookbookBrandMeta = {
    brandName,
    paletteHex: paletteHex.length ? paletteHex : ["#1a1a1a", "#e8d5b7"],
  };

  // Build pages array.
  const pages: LookbookPage[] = [
    { type: "cover" },
    // Product spread — one page per prior creative image (up to 6), or a
    // single spread with all images when we have <2.
    ...priorCreatives.map((c, idx): LookbookPage => ({
      type: "product_spread",
      productTitle: product?.title ?? "Product",
      productImages: c.imageUrl ? [c.imageUrl] : [],
      descriptionText: data.brief?.trim() || `${product?.category ?? "Fashion"} — ${product?.title ?? ""}`.trim(),
      pageNumber: idx + 1,
    })),
    // Ensure at least one product spread even without prior images.
    ...(priorCreatives.length === 0
      ? [{
          type: "product_spread" as const,
          productTitle: product?.title ?? "Product",
          productImages: [],
          descriptionText: data.brief?.trim() ?? "",
          pageNumber: 1,
        }]
      : []),
    { type: "back_cover" },
  ];

  const pdfBuf = await generateLookbookPDF(pages, brandMeta);
  const url = await persistPdf(data.setId, pdfBuf);
  return [url];
}

// ───────────────────────────────────────────────────────────────────────
// Main export.
// ───────────────────────────────────────────────────────────────────────

export async function processCreativeSet(data: CreativeSetJobData) {
  const kind = data.kind ?? "PDP_PRODUCT";

  // ── 0. Verify the row exists and is in PENDING state ──────────────────
  const set = await prisma.creativeSet.findUnique({
    where: { id: data.setId },
    select: { id: true, shopId: true, status: true },
  });
  if (!set) return { skipped: true, reason: "set_not_found" };
  if (set.shopId !== data.shopId) return { skipped: true, reason: "shop_mismatch" };
  if (set.status !== "PENDING") return { skipped: true, reason: `status_${set.status.toLowerCase()}` };

  // ── 1. Mark GENERATING ─────────────────────────────────────────────────
  await prisma.creativeSet.update({
    where: { id: data.setId },
    data: { status: "GENERATING" },
  });

  // ── 2. LOOKBOOK_PDF: special pipeline (no image provider) ─────────────
  if (kind === "LOOKBOOK_PDF") {
    let pdfUrls: string[];
    try {
      pdfUrls = await processLookbookPdf(data);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      console.error(`[creative-set] LOOKBOOK_PDF failed: ${reason}`);
      await prisma.creativeSet.update({
        where: { id: data.setId },
        data: { status: "FAILED", error: `lookbook_pdf_failed: ${reason.slice(0, 200)}` },
      });
      throw err;
    }

    // Write one Creative row per PDF page (there will be 1 URL for the whole PDF).
    await prisma.$transaction([
      ...pdfUrls.map((url) =>
        prisma.creative.create({
          data: {
            shopId: data.shopId,
            productId: data.productId || null,
            setId: data.setId,
            role: "STILL",
            assetKind: "GENERATED",
            prompt: data.brief ?? "Lookbook PDF",
            imageUrl: url,
            status: "SUCCEEDED",
            providerJob: "pdf-lookbook",
            sourceComboName: extractComboName(data.triggeredBy),
          },
        }),
      ),
      prisma.creativeSet.update({
        where: { id: data.setId },
        data: {
          status: "READY",
          providerMeta: {
            provider: "pdf-lookbook",
            kind: "LOOKBOOK_PDF",
            imageCount: pdfUrls.length,
            triggeredBy: data.triggeredBy,
            generatedAt: new Date().toISOString(),
          } as object,
          error: null,
        },
      }),
    ]);

    await prisma.analyticsEvent
      .create({
        data: {
          shopId: data.shopId,
          name: "CREATIVE_SET_GENERATED",
          productId: data.productId || null,
          payload: {
            setId: data.setId,
            provider: "pdf-lookbook",
            kind: "LOOKBOOK_PDF",
            assetCount: pdfUrls.length,
            triggeredBy: data.triggeredBy,
          },
        },
      })
      .catch((err) => {
        console.error("[creative-set] analytics event failed (non-fatal)", err);
      });

    return { ok: true, setId: data.setId, imageCount: pdfUrls.length, providerKey: "pdf-lookbook" };
  }

  // ── 3. Resolve image/video provider ───────────────────────────────────
  let primary;
  let fallback;
  try {
    ({ primary, fallback } = resolveCreativeProvider({ kind }));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "creative_provider_not_configured";
    await prisma.creativeSet.update({
      where: { id: data.setId },
      data: { status: "FAILED", error: reason.slice(0, 240) },
    });
    console.error(`[creative-set] provider resolution failed: ${reason}`);
    throw err;
  }
  if (primary.key === "stub") {
    console.warn("[creative-set] no real provider configured — using stub");
  } else {
    console.log(`[creative-set] kind=${kind} provider=${primary.key} fallback=${fallback?.key ?? "none"}`);
  }

  // ── 4. Build render input from CreativeSet + BrandProfile + product ───
  const input = await buildRenderInput(data);

  // ── 5. Call primary, fall back to secondary on error ───────────────────
  let output: CreativeRenderOutput;
  let providerKeyUsed: string;
  try {
    output = await primary.render(input);
    providerKeyUsed = primary.key;
  } catch (primaryErr) {
    const reason = primaryErr instanceof Error ? primaryErr.message : "unknown";
    console.error(`[creative-set] primary ${primary.key} failed: ${reason}`);

    // For video kinds there's no image fallback — fail immediately.
    if (VIDEO_KINDS.has(kind) || !fallback) {
      await prisma.creativeSet.update({
        where: { id: data.setId },
        data: {
          status: "FAILED",
          error: `${primary.key}_failed: ${reason.slice(0, 200)}`,
        },
      });
      throw primaryErr;
    }

    try {
      output = await fallback.render(input);
      providerKeyUsed = `${fallback.key}:fallback`;
    } catch (fallbackErr) {
      const fbReason = fallbackErr instanceof Error ? fallbackErr.message : "unknown";
      await prisma.creativeSet.update({
        where: { id: data.setId },
        data: {
          status: "FAILED",
          error: `both_providers_failed: ${primary.key}=${reason.slice(0, 80)} / ${fallback.key}=${fbReason.slice(0, 80)}`,
        },
      });
      throw fallbackErr;
    }
  }

  console.log(`[creative-set] generated ${output.images.length} asset(s) via ${providerKeyUsed} in ${output.latencyMs}ms`);

  // ── 6. Persist each image/video through the storage tier chain ─────────
  const persistedUrls = await Promise.all(
    output.images.map((img, idx) => persistImage(data.setId, idx, img)),
  );

  // ── 7. Write Creative rows + update CreativeSet (one transaction) ──────
  const isVideo = VIDEO_KINDS.has(kind);
  await prisma.$transaction([
    ...persistedUrls.map((url, idx) =>
      prisma.creative.create({
        data: {
          shopId: data.shopId,
          productId: data.productId || null,
          setId: data.setId,
          role: isVideo ? "MOTION" : "STILL",
          assetKind: "GENERATED",
          prompt: input.prompt,
          imageUrl: isVideo ? null : url,
          videoUrl: isVideo ? url : null,
          status: "SUCCEEDED",
          providerJob: providerKeyUsed,
          sourceComboName: extractComboName(data.triggeredBy),
        },
      }),
    ),
    prisma.creativeSet.update({
      where: { id: data.setId },
      data: {
        status: "READY",
        providerMeta: {
          provider: providerKeyUsed,
          kind: input.output.kind,
          aspectRatio: input.output.aspectRatio,
          imageCount: persistedUrls.length,
          latencyMs: output.latencyMs,
          triggeredBy: data.triggeredBy,
          generatedAt: new Date().toISOString(),
          brandConditioned: Boolean(input.brand?.referenceAssets?.length),
        } as object,
        error: null,
      },
    }),
  ]);

  // ── 8. Log CREATIVE_SET_GENERATED (best-effort) ────────────────────────
  await prisma.analyticsEvent
    .create({
      data: {
        shopId: data.shopId,
        name: "CREATIVE_SET_GENERATED",
        productId: data.productId || null,
        payload: {
          setId: data.setId,
          provider: providerKeyUsed,
          kind: input.output.kind,
          assetCount: persistedUrls.length,
          brandConditioned: Boolean(input.brand?.referenceAssets?.length),
          triggeredBy: data.triggeredBy,
        },
      },
    })
    .catch((err) => {
      console.error("[creative-set] analytics event failed (non-fatal)", err);
    });

  return { ok: true, setId: data.setId, imageCount: persistedUrls.length, providerKey: providerKeyUsed };
}

/** Pull combo name from triggeredBy like "stylist_combo:Soft Linen Sunday". */
function extractComboName(triggeredBy: string): string | null {
  const m = triggeredBy.match(/^(?:stylist_combo|admin_manual:combo):(.+)$/);
  return m ? m[1]! : null;
}
