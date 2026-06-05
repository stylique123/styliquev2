// Extractor: use Gemini Vision to OCR a size chart from a product image.
// Only attempted for images whose URL contains size/chart/guide/measure keywords.

import type { SizeChartCandidate } from "../types.js";

export async function extractFromImageOcr(
  imageUrl: string,
  geminiApiKey: string,
  model = "gemini-2.5-flash",
  // When the CALLER has already decided this image is worth OCR'ing (e.g. it's a
  // DETAIL-role image, or alt text mentions sizing), pass force=true to bypass
  // the URL-keyword heuristic. Previously this self-gate silently rejected every
  // DETAIL image whose URL lacked a keyword — so image size-chart extraction
  // never actually ran on the most common case (a chart uploaded as a detail
  // shot named "IMG_1234.jpg"). force closes that gap.
  force = false,
): Promise<SizeChartCandidate> {
  const empty: SizeChartCandidate = { source: "image_ocr", confidence: 0, chart: null };
  // Heuristic gate for un-forced calls — broadened beyond the original 4 words so
  // more genuine charts qualify on URL alone.
  if (!force && !/(size|chart|guide|measure|fit|spec|dimension|cm|inch)/i.test(imageUrl)) {
    return empty;
  }
  try {
    // Fetch image once.
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
    if (!imgRes.ok) return empty;
    const mime = imgRes.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const imageBase64 = buf.toString("base64");

    const prompt = `Extract the size chart from this image as JSON with no markdown.
Format: {"sizes":[{"name":"S","chest":86,"waist":68,"hip":94},{"name":"M","chest":90,"waist":72,"hip":98}],"unit":"cm"}
Return ONLY valid JSON. If no size chart is visible, return {"sizes":[],"unit":"cm"}.`;

    // Gemini Vision intermittently returns empty/non-JSON for a perfectly legible
    // chart — measured ~1-in-2-to-3 calls. Without a retry, that many image size
    // charts silently fail to extract on a real sync. Retry up to 3 times; a
    // successful parse returns immediately.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { inlineData: { mimeType: mime, data: imageBase64 } },
                    { text: prompt },
                  ],
                },
              ],
              generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!res.ok) { await sleep(300); continue; }
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        let text = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
        // Strip a markdown code fence if the model added one despite instructions.
        text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
        if (!text) { await sleep(300); continue; }
        const parsed = JSON.parse(text) as { sizes?: Array<Record<string, unknown>>; unit?: string };
        if (Array.isArray(parsed.sizes) && parsed.sizes.length >= 2) {
          const hasAnyMeasurement = parsed.sizes.some(
            (s) => s["chest"] || s["bust"] || s["waist"] || s["hip"] || s["length"],
          );
          if (hasAnyMeasurement) {
            return {
              source: "image_ocr",
              confidence: 0.8,
              chart: {
                sizes: parsed.sizes as Array<{ name: string; [key: string]: number | string | undefined }>,
                unit: (parsed.unit as "cm" | "in") ?? "cm",
                source: "image_ocr",
              },
            };
          }
          // Parsed but empty (no sizes/measurements) → the model genuinely saw no
          // chart; don't waste more attempts.
          return empty;
        }
        await sleep(300); // empty/short result — retry
      } catch {
        await sleep(300); // network / JSON parse error — retry
      }
    }
  } catch { /* silent */ }
  return empty;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
