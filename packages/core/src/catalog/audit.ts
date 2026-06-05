// Baseline ProductAudit generator. Cheap, deterministic checks the catalog sync runs on every product.
// Vision-quality and styling-coverage checks come later from dedicated jobs.

import type { NormalizedProduct } from "./normalize.js";

export type AuditRecommendation = {
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
};

export type ProductAuditBaseline = {
  missingSizeChart: boolean;
  weakImageQuality: boolean;        // unknown by default → false; vision job sets later
  missingStyling: boolean;          // true by default; flips to false when StyleSession exists
  missingTryOnReady: boolean;       // true when there is no usable product image
  missingColorCombos: boolean;      // true when colorFamily could not be extracted
  recommendations: AuditRecommendation[];
  priorityScore: number;            // 0..1
};

const SIZE_OPTION_RX = /size/i;

export function baselineAudit(
  product: NormalizedProduct,
  ctx: { hasSizeChartMetafield?: boolean } = {},
): ProductAuditBaseline {
  const hasImages = product.images.length > 0;
  const hasSizes = product.variants.some((v) => v.size && v.size.trim() !== "");
  const hasSizeChart = ctx.hasSizeChartMetafield === true || hasSizes;

  const missingSizeChart = !hasSizeChart;
  const missingTryOnReady = !hasImages;
  const missingColorCombos = !product.colorFamily;
  const missingStyling = true;           // sync time → no StyleSession yet
  const weakImageQuality = false;        // unknown until vision job runs

  const recs: AuditRecommendation[] = [];
  if (missingTryOnReady) {
    recs.push({ code: "TRYON_NO_IMAGE", severity: "high",
      message: "Product has no image — try-on cannot render." });
  }
  if (missingSizeChart) {
    recs.push({ code: "FIT_NO_SIZE_CHART", severity: "high",
      message: "No size variants or size chart metafield — Fit recommendations will be guesses." });
  }
  if (missingColorCombos) {
    recs.push({ code: "STYLE_NO_COLOR", severity: "medium",
      message: "Color could not be inferred from title, tags, or variants — color combos disabled." });
  }
  if (missingStyling) {
    recs.push({ code: "STYLE_NO_OUTFIT_DATA", severity: "low",
      message: "No styling sessions yet — outfit suggestions will use defaults." });
  }

  // Weighted score. High-severity items dominate. Tuned so a brand-new product
  // missing everything lands ~0.7; one missing-color flag is ~0.25.
  const score = clamp01(
    (missingTryOnReady ? 0.35 : 0) +
    (missingSizeChart  ? 0.25 : 0) +
    (missingColorCombos ? 0.20 : 0) +
    (missingStyling    ? 0.10 : 0) +
    (weakImageQuality  ? 0.10 : 0),
  );

  return {
    missingSizeChart,
    weakImageQuality,
    missingStyling,
    missingTryOnReady,
    missingColorCombos,
    recommendations: recs,
    priorityScore: score,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
