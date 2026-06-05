// Extractor: parse a size chart from the product's body_html description.
// Reuses the existing parseHtmlSizeChart function from the metafield parser.

import { parseHtmlSizeChart } from "../metafield.js";
import type { SizeChartCandidate } from "../types.js";

export function extractFromDescriptionHtml(bodyHtml: string): SizeChartCandidate {
  if (!bodyHtml) return { source: "description_html", confidence: 0, chart: null };
  // Strip script/style tags before parsing
  const clean = bodyHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  try {
    const chart = parseHtmlSizeChart(clean);
    if (chart && chart.sizes.length >= 2) {
      return {
        source: "description_html",
        confidence: 0.7,
        chart: { ...chart, source: "description_html" },
      };
    }
  } catch { /* silent */ }
  return { source: "description_html", confidence: 0, chart: null };
}
