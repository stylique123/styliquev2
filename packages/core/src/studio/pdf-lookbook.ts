// LOOKBOOK_PDF generation pipeline.
//
// Generates a multi-page PDF lookbook from product images + brand metadata.
// Implementation uses pdfkit (pure-JS, no browser dependency) so it works
// cleanly in the BullMQ worker without a headless browser.
//
// Page structure:
//   • Cover: full-bleed brand color, brand name centered, white text.
//   • Product spread (one per product): left half = large image,
//     right half = product title + description in brand palette.
//   • Back cover: brand name + "Powered by Stylique" small attribution.
//
// pdfkit must be available in packages/core or apps/worker. Check the
// worker package.json before calling this from the worker.

export type LookbookPage = {
  type: "cover" | "product_spread" | "back_cover";
  productTitle?: string;
  /** Fully resolved image URLs (https:// or data: URIs). */
  productImages?: string[];
  descriptionText?: string;
  pageNumber?: number;
};

export type LookbookBrandMeta = {
  brandName: string;
  paletteHex: string[];  // [0] = primary (cover bg), [1] = accent
  logoUrl?: string;
};

// ───────────────────────────────────────────────────────────────────────
// Hex → RGB helper.
// ───────────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [
    isNaN(r) ? 0 : r,
    isNaN(g) ? 0 : g,
    isNaN(b) ? 0 : b,
  ];
}

/** Choose readable foreground (black/white) given a background hex. */
function contrastColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  // Luminance per WCAG formula
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? "#000000" : "#ffffff";
}

// ───────────────────────────────────────────────────────────────────────
// Fetch a URL or data: URI → Buffer helper.
// ───────────────────────────────────────────────────────────────────────

async function fetchImageBuffer(url: string): Promise<{ buf: Buffer; mimeType: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const m = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return null;
      return { buf: Buffer.from(m[2]!, "base64"), mimeType: m[1]! };
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    return { buf: Buffer.from(arr), mimeType };
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────
// Main export — generateLookbookPDF.
//
// Returns a Buffer containing the PDF bytes. The caller (worker) decides
// where to persist it (S3 / disk / inline data: URI) via persistImage.
// ───────────────────────────────────────────────────────────────────────

export async function generateLookbookPDF(
  pages: LookbookPage[],
  brandMeta: LookbookBrandMeta,
): Promise<Buffer> {
  // Dynamic require so this module can be imported without pdfkit being present
  // in packages/core itself — the worker (apps/worker) must have pdfkit
  // installed. We type the constructor loosely to avoid a hard pdfkit dev dep.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type PDFDocCtor = new (opts: Record<string, unknown>) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PDFDocument: PDFDocCtor | undefined;
  try {
    // pdfkit is CommonJS; require works in both ESM (Node 22 require()) and CJS.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    PDFDocument = require("pdfkit") as any;
  } catch {
    throw new Error(
      "pdfkit is not installed. Add 'pdfkit' to apps/worker/package.json dependencies.",
    );
  }
  if (!PDFDocument) throw new Error("pdfkit_load_failed");

  const primaryHex = brandMeta.paletteHex[0] ?? "#1a1a1a";
  const accentHex = brandMeta.paletteHex[1] ?? "#e8d5b7";
  const primaryRgb = hexToRgb(primaryHex);
  const accentRgb = hexToRgb(accentHex);
  const primaryFg = contrastColor(primaryHex);

  // A4 landscape for spreads.
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const W = doc.page.width;   // 841.89 pt
  const H = doc.page.height;  // 595.28 pt
  const HALF = W / 2;
  const MARGIN = 40;

  // ── Cover page ──────────────────────────────────────────────────────
  doc
    .rect(0, 0, W, H)
    .fill(`rgb(${primaryRgb.join(",")})`)
    .fillColor(primaryFg)
    .font("Helvetica-Bold")
    .fontSize(48)
    .text(brandMeta.brandName, MARGIN, H / 2 - 60, { width: W - MARGIN * 2, align: "center" });

  const season = new Date().getFullYear();
  doc
    .fontSize(16)
    .font("Helvetica")
    .text(`Lookbook ${season}`, MARGIN, H / 2 + 20, { width: W - MARGIN * 2, align: "center" });

  // ── Product spread pages ─────────────────────────────────────────────
  for (const page of pages.filter((p) => p.type === "product_spread")) {
    doc.addPage();

    // Left half: image
    const imageUrl = page.productImages?.[0];
    if (imageUrl) {
      const imageData = await fetchImageBuffer(imageUrl);
      if (imageData) {
        try {
          doc.image(imageData.buf, 0, 0, { width: HALF, height: H, fit: [HALF, H], align: "center", valign: "center" });
        } catch {
          // Image might be an unsupported format — draw placeholder rect
          doc.rect(0, 0, HALF, H).fill(`rgb(${accentRgb.join(",")})`);
        }
      } else {
        doc.rect(0, 0, HALF, H).fill(`rgb(${accentRgb.join(",")})`);
      }
    } else {
      doc.rect(0, 0, HALF, H).fill(`rgb(${accentRgb.join(",")})`);
    }

    // Right half: text content
    doc.rect(HALF, 0, HALF, H).fill("#ffffff");

    // Product title
    doc
      .fillColor(primaryHex)
      .font("Helvetica-Bold")
      .fontSize(28)
      .text(page.productTitle ?? "Product", HALF + MARGIN, MARGIN + 40, {
        width: HALF - MARGIN * 2,
        align: "left",
      });

    // Description
    if (page.descriptionText) {
      doc
        .fillColor("#333333")
        .font("Helvetica")
        .fontSize(12)
        .text(page.descriptionText, HALF + MARGIN, MARGIN + 120, {
          width: HALF - MARGIN * 2,
          align: "left",
          lineGap: 4,
        });
    }

    // Page number
    if (page.pageNumber !== undefined) {
      doc
        .fillColor("#999999")
        .fontSize(10)
        .text(`${page.pageNumber}`, HALF + MARGIN, H - MARGIN - 12, {
          width: HALF - MARGIN * 2,
          align: "right",
        });
    }

    // Thin separator line
    doc
      .moveTo(HALF, MARGIN)
      .lineTo(HALF, H - MARGIN)
      .strokeColor(primaryHex)
      .lineWidth(1)
      .stroke();
  }

  // ── Back cover ────────────────────────────────────────────────────────
  doc.addPage();
  doc
    .rect(0, 0, W, H)
    .fill(`rgb(${primaryRgb.join(",")})`)
    .fillColor(primaryFg)
    .font("Helvetica-Bold")
    .fontSize(32)
    .text(brandMeta.brandName, MARGIN, H / 2 - 40, { width: W - MARGIN * 2, align: "center" });

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(primaryFg)
    .opacity(0.5)
    .text("Powered by Stylique", MARGIN, H - MARGIN - 14, {
      width: W - MARGIN * 2,
      align: "center",
    });

  // ── Finalise ──────────────────────────────────────────────────────────
  await new Promise<void>((resolve) => {
    doc.on("end", resolve);
    doc.end();
  });

  return Buffer.concat(chunks as unknown as Uint8Array[]);
}
