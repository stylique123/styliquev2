// Extractor: follow a size-guide or size-chart page linked from product description HTML.
// Fetches the page and parses the HTML table from it.

import type { SizeChartCandidate } from "../types.js";
import { parseHtmlSizeChart } from "../metafield.js";

export async function extractFromLinkedPage(
  bodyHtml: string,
  shopDomain: string,
): Promise<SizeChartCandidate> {
  const empty: SizeChartCandidate = { source: "linked_page", confidence: 0, chart: null };
  if (!bodyHtml) return empty;
  // Find /pages/size-guide or /pages/size-chart or /policies/size-chart patterns
  const match = bodyHtml.match(
    /href="(\/pages\/size[-_]?(?:guide|chart)|\/policies\/size[-_]?chart)[^"]*"/i,
  );
  if (!match) return empty;
  const path = match[1];
  const url = `https://${shopDomain}${path}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return empty;
    const html = await res.text();
    const chart = parseHtmlSizeChart(html);
    if (chart && chart.sizes.length >= 2) {
      return { source: "linked_page", confidence: 0.75, chart: { ...chart, source: "linked_page" } };
    }
  } catch { /* timeout or network error */ }
  return empty;
}
