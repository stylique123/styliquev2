// Stylique Beauty — skin analysis via Gemini Vision bridge.
// Same pattern as D33 reference-photo matching — image bytes pass through to
// Gemini, results are structured JSON, image is never persisted (D23/PB17).
//
// This is the $0 path: Gemini Flash Vision at free quota.
// Production upgrade: swap the prompt + model for Haut.AI API
// (createHautAiProvider) — same output shape, one config flip.

import type { BeautySkinProfile, SkinConcern, SkinType, SkinUndertone, SkinDepth, ITARange } from "./types.js";

// ─── Provider interface (matches D11/D12 pattern) ────────────────────────

export interface SkinAnalysisProvider {
  readonly key: string;
  analyze(imageDataUrl: string): Promise<SkinAnalysisResult>;
}

export type SkinAnalysisResult = {
  skinType: SkinType;
  undertone: SkinUndertone;
  depth: SkinDepth;
  itaRange: ITARange;
  skinHex: string;
  concerns: Array<{ concern: SkinConcern; confidence: number }>;
  colorSeason?: "spring" | "summer" | "autumn" | "winter";
  analysisNotes: string;   // one-line Mira-readable summary
  confidence: number;      // 0-1 overall confidence
};

// ─── Gemini Vision bridge (default, free) ────────────────────────────────

const SKIN_ANALYSIS_PROMPT = `Analyze the skin in this photo with clinical precision.
Return ONLY a JSON object matching this exact schema (no markdown, no explanation):

{
  "skinType": "oily|dry|combination|normal|sensitive",
  "undertone": "warm|cool|neutral|olive",
  "depth": "light|light-medium|medium|medium-deep|deep",
  "itaRange": "very_light|light|intermediate|tan|brown|dark",
  "skinHex": "#RRGGBB (most representative skin hex from cheek/forehead area)",
  "concerns": [
    { "concern": "acne|hyperpigmentation|redness|dryness|oiliness|texture|fine_lines|dark_circles|pores|sensitivity|uneven_tone|dullness", "confidence": 0.0-1.0 }
  ],
  "colorSeason": "spring|summer|autumn|winter|null",
  "analysisNotes": "one sentence for a beauty advisor, describing the skin in human terms",
  "confidence": 0.0-1.0
}

Rules:
- Analyze ONLY skin — ignore hair, background, clothing.
- skinHex: sample from cheek or forehead, not lips or eyes.
- ITA (Individual Typology Angle): estimate from the L*a*b* colour of the skin hex.
  ITA > 55° = very_light, 41-55 = light, 28-41 = intermediate, 10-28 = tan, -30 to 10 = brown, < -30 = dark.
- Undertone from vein test heuristic: blue/purple tones = cool, green = warm, blue-green = neutral.
- Include only the top 3 concerns by confidence, sorted descending.
- If photo is too dark/blurry/no face visible: set confidence < 0.3 and still return valid JSON.`;

export function createGeminiVisionSkinProvider(apiKey: string): SkinAnalysisProvider {
  return {
    key: "gemini-vision-skin",
    async analyze(imageDataUrl: string): Promise<SkinAnalysisResult> {
      // Extract mime type and base64 data
      const match = imageDataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
      if (!match) throw new Error("invalid_image_format");
      const [, mimeType, base64Data] = match;

      const body = {
        contents: [{
          parts: [
            { text: SKIN_ANALYSIS_PROMPT },
            { inlineData: { mimeType, data: base64Data } },
          ],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,    // low temp — we want consistent structured output
          maxOutputTokens: 512,
        },
      };

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );

      if (!res.ok) throw new Error(`gemini_skin_analysis_failed: ${res.status}`);
      const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("gemini_skin_analysis_empty");

      return JSON.parse(text) as SkinAnalysisResult;
    },
  };
}

// ─── Stub provider (dev / env-absent) ────────────────────────────────────

export function createStubSkinProvider(): SkinAnalysisProvider {
  return {
    key: "stub",
    async analyze(_imageDataUrl: string): Promise<SkinAnalysisResult> {
      return {
        skinType: "combination",
        undertone: "neutral",
        depth: "medium",
        itaRange: "intermediate",
        skinHex: "#C68642",
        concerns: [
          { concern: "texture", confidence: 0.7 },
          { concern: "pores", confidence: 0.5 },
        ],
        colorSeason: "autumn",
        analysisNotes: "Combination skin with neutral undertones and medium depth — stub result.",
        confidence: 0.3,
      };
    },
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────

export function createSkinAnalysisProvider(env: {
  GEMINI_API_KEY?: string;
  HAUT_AI_API_KEY?: string;
}): SkinAnalysisProvider {
  if (env.GEMINI_API_KEY) return createGeminiVisionSkinProvider(env.GEMINI_API_KEY);
  return createStubSkinProvider();
}

// ─── ITA math (pure, no deps) ─────────────────────────────────────────────
// Convert a skin hex to ITA range. Used for shade matching when we have
// the hex from prior analysis but need to re-classify.

export function hexToITA(hex: string): ITARange {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  // sRGB → linear
  const lin = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const rl = lin(r), gl = lin(g), bl = lin(b);

  // Linear → XYZ (D65)
  const X = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
  const Y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const Z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;

  // XYZ → Lab
  const f = (t: number) => t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
  const Lstar = 116 * f(Y / 1.0) - 16;
  const bstar = 200 * (f(Y / 1.0) - f(Z / 1.089));

  // ITA
  const ita = Math.atan2(Lstar - 50, bstar) * (180 / Math.PI);

  if (ita > 55) return "very_light";
  if (ita > 41) return "light";
  if (ita > 28) return "intermediate";
  if (ita > 10) return "tan";
  if (ita > -30) return "brown";
  return "dark";
}

// ─── Map analysis result → BeautySkinProfile ─────────────────────────────

export function analysisToProfile(result: SkinAnalysisResult): Partial<BeautySkinProfile> {
  return {
    skinType: result.skinType,
    undertone: result.undertone,
    depth: result.depth,
    itaRange: result.itaRange,
    skinHex: result.skinHex,
    concerns: result.concerns.filter(c => c.confidence > 0.4).map(c => c.concern),
    colorSeason: result.colorSeason ?? undefined,
    selfieAnalyzedAt: new Date().toISOString(),
  };
}
