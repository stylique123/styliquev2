// Barrel for the size-chart metafield pipeline (D37) + multi-source extractor (D39).
export {
  parseJsonSizeChart,
  parseHtmlSizeChart,
  parseVariantMeasurements,
  pickProductSizeChart,
  type Measurement,
  type SizeRow,
  type ParsedSizeChart,
  type VariantMeasurements,
} from "./metafield.js";

export type { SizeChartSourceKind, NormalizedSizeChart, SizeChartCandidate } from "./types.js";

import { parseJsonSizeChart, parseHtmlSizeChart, parseVariantMeasurements } from "./metafield.js";
import type { NormalizedSizeChart, SizeChartCandidate } from "./types.js";

/**
 * D39 — Multi-source size chart extraction pipeline.
 *
 * Tries up to 6 sources in confidence order, returns the winner (highest
 * confidence with ≥2 sizes and at least one real measurement) plus all
 * candidates for audit storage.
 */
export async function extractSizeChartMultiSource(input: {
  variantMetafields?: Array<{ namespace?: string | null; key: string; value: unknown }> | null;
  jsonMetafield?: string | null;
  htmlMetafield?: string | null;
  bodyHtml?: string | null;
  shopDomain?: string;
  images?: Array<{ url: string; garmentRole?: string | null; alt?: string | null }>;
  geminiApiKey?: string;
}): Promise<{
  winner: NormalizedSizeChart | null;
  candidates: SizeChartCandidate[];
  extractedAt: Date;
}> {
  const { extractFromDescriptionHtml } = await import("./extractors/description-html.js");
  const { extractFromLinkedPage } = await import("./extractors/linked-page.js");
  const { extractFromImageOcr } = await import("./extractors/image-ocr.js");

  const candidates: SizeChartCandidate[] = [];

  // Source 1: per-variant metafields (confidence 0.95)
  if (input.variantMetafields) {
    try {
      const r = parseVariantMeasurements(input.variantMetafields);
      if (r) {
        candidates.push({
          source: "variant_metafield",
          confidence: 0.95,
          chart: { sizes: [{ name: "variant", ...r }], unit: "cm", source: "variant_metafield" },
        });
      }
    } catch { /* silent */ }
  }

  // Source 2: JSON metafield (confidence 0.85)
  if (input.jsonMetafield) {
    try {
      const r = parseJsonSizeChart(input.jsonMetafield);
      if (r) {
        candidates.push({
          source: "json_metafield",
          confidence: 0.85,
          chart: { ...r, source: "json_metafield" },
        });
      }
    } catch { /* silent */ }
  }

  // Source 3: HTML metafield (confidence 0.75)
  if (input.htmlMetafield) {
    try {
      const r = parseHtmlSizeChart(input.htmlMetafield);
      if (r) {
        candidates.push({
          source: "html_metafield",
          confidence: 0.75,
          chart: { ...r, source: "html_metafield" },
        });
      }
    } catch { /* silent */ }
  }

  // Source 4: description HTML (confidence 0.7)
  if (input.bodyHtml) {
    candidates.push(extractFromDescriptionHtml(input.bodyHtml));
  }

  // Source 5: linked page with a 3s timeout
  if (input.bodyHtml && input.shopDomain) {
    candidates.push(
      await Promise.race([
        extractFromLinkedPage(input.bodyHtml, input.shopDomain),
        new Promise<SizeChartCandidate>((resolve) =>
          setTimeout(
            () => resolve({ source: "linked_page", confidence: 0, chart: null }),
            3000,
          ),
        ),
      ]),
    );
  }

  // Source 6: image OCR. A size chart is most often uploaded as a DETAIL shot or
  // a separate "size guide" image whose filename gives nothing away. We OCR an
  // image when ANY of these say "this could be a chart": DETAIL role, alt text
  // mentioning sizing, or a keyword in the URL. For the first two we FORCE the
  // OCR (bypass the extractor's URL heuristic, which used to wrongly skip them).
  // Cap at 3 candidate images so a big gallery can't fan out 20 Vision calls.
  if (input.geminiApiKey && input.images) {
    const sizeAlt = /(size|chart|guide|measure|fit|dimension)/i;
    const sizeUrl = /(size|chart|guide|measure|fit|spec|dimension)/i;
    let ocrTried = 0;
    const ocrImages = [...input.images]
      .map((img, index) => {
        const byRole = img.garmentRole === "DETAIL";
        const byAlt = !!img.alt && sizeAlt.test(img.alt);
        const byUrl = sizeUrl.test(img.url);
        const score = (byAlt ? 100 : 0) + (byUrl ? 80 : 0) + (byRole ? 10 : 0);
        return { img, index, byRole, byAlt, byUrl, score };
      })
      .filter(({ byRole, byAlt, byUrl }) => byRole || byAlt || byUrl)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    for (const { img, byRole, byAlt, byUrl } of ocrImages) {
      if (ocrTried >= 3) break;
      ocrTried++;
      // Caller already judged it chart-worthy (role/alt) → force past the URL gate.
      const force = byRole || byAlt;
      candidates.push(
        await extractFromImageOcr(img.url, input.geminiApiKey, undefined, force).catch(() => ({
          source: "image_ocr" as const,
          confidence: 0,
          chart: null,
        })),
      );
    }
  }

  // Pick winner: highest confidence with ≥2 sizes and at least 1 real measurement
  const valid = candidates
    .filter(
      (c) =>
        c.chart !== null &&
        c.chart.sizes.length >= 2 &&
        c.chart.sizes.some((s) => s["chest"] || s["waist"] || s["hip"]),
    )
    .sort((a, b) => b.confidence - a.confidence);

  return { winner: valid[0]?.chart ?? null, candidates, extractedAt: new Date() };
}
