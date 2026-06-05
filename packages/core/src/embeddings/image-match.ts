// Image match — "find me something like this" via reference photo.
//
// Architecture decision (2026-05): rather than ship FashionCLIP via Replicate
// (new env var, new table, $$$ per backfill), we use Gemini Vision as the
// image encoder: image → canonical garment description → text embedding.
//
// This reuses the ProductEmbedding rows already populated by the catalog
// embedding backfill — no new table, no new infra. Quality is strong for
// "something like this dress / jacket / sneaker" because Gemini's fashion
// description is genuinely good.
//
// Future swap path: implement createReplicateFashionClipProvider, swap in
// when we have signal that the Gemini-bridge isn't good enough. The matcher
// interface stays the same.

export interface ImageMatchProvider {
  readonly key: string;          // "gemini-vision-bridge" | "fashion-clip"
  readonly modelKey: string;     // for logging only
  // Returns a compact text caption suitable for embedding+matching.
  describeForMatching(input: { base64: string; mime: string }): Promise<string>;
}

// ─── Gemini Vision bridge ──────────────────────────────────────────────
// One vision call → a tightly-formatted garment description, designed so
// the resulting text embedding lands near our productEmbeddingText format
// (title · category · "{colorFamily} tone" · primaryColor · tags).

export function createGeminiVisionMatchProvider(opts: {
  apiKey: string;
  model?: string;          // default: gemini-2.5-flash
  fetchImpl?: typeof fetch;
}): ImageMatchProvider {
  const model = opts.model ?? "gemini-2.5-flash";
  const f = opts.fetchImpl ?? fetch;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  // The instruction is engineered to match the shape of productEmbeddingText
  // so the resulting embedding lands in the same neighborhood of vector space
  // as the catalog rows we want to match.
  const INSTRUCTION = [
    "Describe the single most prominent clothing item in this image.",
    "Output ONE short line in this exact format, no preamble:",
    "<garment-type> · <category> · <color-family> tone · <primary-color> · <pattern-or-detail>, <fabric-impression>, <formality>",
    "Examples:",
    "midi dress · dresses · warm tone · burgundy · floral print, silk-like flow, evening",
    "crewneck sweater · knitwear · cool tone · navy · cable knit, wool-blend, casual",
    "If the image has no clear garment, output exactly: NO_GARMENT",
  ].join("\n");

  return {
    key: "gemini-vision-bridge",
    modelKey: `gemini-vision-bridge:${model}`,
    async describeForMatching({ base64, mime }) {
      // Strip any data-url prefix the caller forgot to.
      const clean = base64.startsWith("data:") ? base64.split(",", 2)[1] ?? "" : base64;
      const res = await f(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: INSTRUCTION },
              { inlineData: { mimeType: mime, data: clean } },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 80 },
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`vision_http_${res.status}: ${t.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      if (!text || text === "NO_GARMENT") {
        throw new Error("vision_no_garment");
      }
      return text.slice(0, 240);
    },
  };
}
