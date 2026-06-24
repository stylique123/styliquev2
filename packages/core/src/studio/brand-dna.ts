// Brand DNA extraction utility — packages/core/src/studio/brand-dna.ts
//
// Extracts aesthetic signals from a brand's catalog products and Instagram
// archive. Provider-agnostic design: Gemini Vision is the default; swapping
// to another vision provider = one new function registered here.
//
// All image bytes are transient — passed to the model and dropped. Nothing
// is persisted by this module (callers decide what to persist).

export type BrandDNASignal = {
  source: "shopify_catalog" | "instagram_post" | "reference_upload" | "manual";
  paletteHex: string[];       // dominant colors as hex strings
  moodAdjectives: string[];   // e.g. ["editorial", "minimal", "clean"]
  lightingStyle: string;      // e.g. "rim_lighting", "natural_soft", "studio_flat"
  compositionStyle: string;   // e.g. "centered_model", "negative_space", "flat_lay"
  modelArchetype: string;     // e.g. "editorial", "commercial", "lifestyle"
  engagementScore: number;    // 0-1; higher = brand leans into this style more
};

export type BrandDNA = {
  paletteJson: { hex: string[] };
  toneJson: {
    moodAdjectives: string[];
    lighting: string;
    modelArchetype: string;
    composition: string;
    dominantFabrics: string[];
    seasonality: string;
    pricePositioning: "luxury" | "premium" | "contemporary" | "accessible";
  };
};

// ─── Gemini Vision helper ─────────────────────────────────────────────────────

async function geminiVisionJson<T>(
  apiKey: string,
  prompt: string,
  imageUrls: string[],
): Promise<T | null> {
  // Build parts: text prompt + inline image URLs (Gemini supports URI parts)
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } } | { fileData: { mimeType: string; fileUri: string } }> = [];
  parts.push({ text: prompt });
  for (const url of imageUrls) {
    // Use fileData for public URLs (Gemini can fetch them directly)
    parts.push({ fileData: { mimeType: "image/jpeg", fileUri: url } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      console.error("[brand-dna] Gemini Vision API error", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    // Strip markdown fences if present
    const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(clean) as T;
  } catch (err) {
    console.error("[brand-dna] Gemini Vision parse error", err);
    return null;
  }
}

// ─── Gemini Vision helper for base64 images (Instagram ZIP extracts) ─────────

async function geminiVisionJsonBase64<T>(
  apiKey: string,
  prompt: string,
  imageBase64s: Array<{ data: string; mimeType: string }>,
): Promise<T | null> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  parts.push({ text: prompt });
  for (const img of imageBase64s) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      console.error("[brand-dna] Gemini Vision API error", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(clean) as T;
  } catch (err) {
    console.error("[brand-dna] Gemini Vision base64 parse error", err);
    return null;
  }
}

// ─── extractDNAFromCatalogProducts ───────────────────────────────────────────

type CatalogProduct = {
  title: string;
  category: string | null;
  productType?: string | null;
  primaryColor: string | null;
  tags?: string[];
  descriptionText?: string | null;
  imageUrls: Array<string | { url: string; altText?: string | null }>;
};

export type BrandDnaImageCandidate = {
  id: string;
  position?: number | null;
  qualityScore?: number | null;
  garmentRole?: "FRONT" | "BACK" | "DETAIL" | "LIFESTYLE" | "SWATCH" | string | null;
  altText?: string | null;
};

export function orderBrandDnaImages<T extends BrandDnaImageCandidate>(
  images: T[],
  primaryTryonImageId: string | null,
): T[] {
  const roleRank = (role: BrandDnaImageCandidate["garmentRole"]) => {
    switch (role) {
      case "FRONT": return 0;
      case "BACK": return 1;
      case "LIFESTYLE": return 3;
      case "DETAIL": return 4;
      case "SWATCH": return 5;
      default: return 2;
    }
  };
  const altPenalty = (altText: string | null | undefined) =>
    /\b(size\s*(chart|guide)|measurement|measurements|sizing|swatch|fabric|detail|zoom|close)\b/i.test(altText ?? "") ? 1 : 0;

  return [...images].sort((a, b) => {
    if (primaryTryonImageId) {
      if (a.id === primaryTryonImageId) return -1;
      if (b.id === primaryTryonImageId) return 1;
    }
    const roleDelta = roleRank(a.garmentRole) - roleRank(b.garmentRole);
    if (roleDelta !== 0) return roleDelta;
    const altDelta = altPenalty(a.altText) - altPenalty(b.altText);
    if (altDelta !== 0) return altDelta;
    const scoreDelta = (b.qualityScore ?? -1) - (a.qualityScore ?? -1);
    if (scoreDelta !== 0) return scoreDelta;
    return (a.position ?? 9999) - (b.position ?? 9999);
  });
}

type GeminiCatalogAnalysis = {
  moodAdjectives?: string[];
  lightingStyle?: string;
  compositionStyle?: string;
  colorPalette?: string[];
  modelArchetype?: string;
  dominantFabrics?: string[];
  seasonality?: string;
  pricePositioning?: string;
};

const CATALOG_PROMPT = `You are analyzing a fashion brand's product catalog images to extract aesthetic DNA.

Look at these product images and their metadata. Return a JSON object with:
{
  "moodAdjectives": ["up to 5 words describing the overall mood, e.g. editorial, minimal, clean, romantic, edgy"],
  "lightingStyle": "one of: studio_flat, natural_soft, rim_lighting, dramatic_contrast, overexposed_editorial",
  "compositionStyle": "one of: centered_model, negative_space, flat_lay, action_lifestyle, detail_focus",
  "colorPalette": ["up to 6 dominant hex colors across the catalog, e.g. #F5F0E8"],
  "modelArchetype": "one of: editorial, commercial, lifestyle, street, fine_art",
  "dominantFabrics": ["up to 3 fabric types visible, e.g. linen, silk, denim"],
  "seasonality": "one of: all_season, spring_summer, fall_winter, resort",
  "pricePositioning": "one of: luxury, premium, contemporary, accessible"
}

Product metadata context:
`;

export async function extractDNAFromCatalogProducts(
  products: CatalogProduct[],
  geminiApiKey: string,
): Promise<BrandDNA> {
  if (products.length === 0) return defaultBrandDNA();

  // Batch into groups of 10 (Gemini file limit guidance)
  const batches: CatalogProduct[][] = [];
  for (let i = 0; i < products.length; i += 10) {
    batches.push(products.slice(i, i + 10));
  }

  const signals: BrandDNASignal[] = [];
  const fabricFreq: Record<string, number> = {};
  const seasonalityFreq: Record<string, number> = {};
  const pricePositioningFreq: Record<string, number> = {};

  for (const batch of batches) {
    const imageUrls: string[] = [];
    const metadataLines: string[] = [];

    for (const p of batch) {
      // Take up to 2 images per product to stay within limits
      const imgs = p.imageUrls
        .map((img) => typeof img === "string" ? { url: img, altText: null } : img)
        .filter((img) => Boolean(img.url))
        .slice(0, 2);
      imageUrls.push(...imgs.map((img) => img.url));
      const tags = (p.tags ?? []).filter(Boolean).slice(0, 8).join(", ");
      const imageAlt = imgs.map((img) => img.altText).filter(Boolean).slice(0, 3).join(" | ");
      const description = sanitizeText(p.descriptionText).slice(0, 240);
      metadataLines.push(
        [
          `- "${p.title}"`,
          `category=${p.category ?? "unknown"}`,
          `productType=${p.productType ?? "unknown"}`,
          `primaryColor=${p.primaryColor ?? "unknown"}`,
          tags ? `tags=${tags}` : null,
          imageAlt ? `imageAlt=${imageAlt}` : null,
          description ? `description=${description}` : null,
        ].filter(Boolean).join("; "),
      );
    }

    if (imageUrls.length === 0) continue;

    const prompt = CATALOG_PROMPT + metadataLines.join("\n");
    const result = await geminiVisionJson<GeminiCatalogAnalysis>(
      geminiApiKey,
      prompt,
      imageUrls.slice(0, 16), // hard cap to avoid token overrun
    );

    if (!result) continue;

    for (const fabric of result.dominantFabrics ?? []) {
      const key = fabric.trim().toLowerCase();
      if (key) fabricFreq[key] = (fabricFreq[key] ?? 0) + 1;
    }
    if (result.seasonality) {
      seasonalityFreq[result.seasonality] = (seasonalityFreq[result.seasonality] ?? 0) + 1;
    }
    if (result.pricePositioning) {
      pricePositioningFreq[result.pricePositioning] = (pricePositioningFreq[result.pricePositioning] ?? 0) + 1;
    }

    signals.push({
      source: "shopify_catalog",
      paletteHex: (result.colorPalette ?? []).filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c)),
      moodAdjectives: result.moodAdjectives ?? [],
      lightingStyle: result.lightingStyle ?? "studio_flat",
      compositionStyle: result.compositionStyle ?? "centered_model",
      modelArchetype: result.modelArchetype ?? "commercial",
      engagementScore: 0.8, // catalog = high confidence signal
    });
  }

  if (signals.length === 0) return defaultBrandDNA();

  const merged = mergeBrandDNA(signals);
  const pricePositioning = topKey(pricePositioningFreq);
  const validPricePositioning = (
    pricePositioning === "luxury"
    || pricePositioning === "premium"
    || pricePositioning === "contemporary"
    || pricePositioning === "accessible"
  ) ? pricePositioning : merged.toneJson.pricePositioning;

  return {
    paletteJson: merged.paletteJson,
    toneJson: {
      ...merged.toneJson,
      dominantFabrics: Object.entries(fabricFreq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([fabric]) => fabric),
      seasonality: topKey(seasonalityFreq) ?? merged.toneJson.seasonality,
      pricePositioning: validPricePositioning,
    },
  };
}

function sanitizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── extractDNAFromInstagramPosts ─────────────────────────────────────────────

type InstagramBatchAnalysis = {
  moodAdjectives?: string[];
  lightingStyle?: string;
  compositionStyle?: string;
  colorPalette?: string[];
  modelArchetype?: string;
};

const INSTAGRAM_PROMPT = `You are analyzing a fashion brand's Instagram post images to extract their visual aesthetic DNA.

These are actual posts from the brand — how they CHOOSE to present their products publicly.

Return JSON:
{
  "moodAdjectives": ["up to 5 adjectives describing the visual mood, e.g. editorial, moody, clean, vibrant, minimalist"],
  "lightingStyle": "one of: studio_flat, natural_soft, rim_lighting, dramatic_contrast, overexposed_editorial, golden_hour",
  "compositionStyle": "one of: centered_model, negative_space, flat_lay, action_lifestyle, detail_focus, candid_street",
  "colorPalette": ["up to 6 dominant hex colors from these images"],
  "modelArchetype": "one of: editorial, commercial, lifestyle, street, fine_art, influencer"
}`;

export async function extractDNAFromInstagramPosts(
  imagePaths: string[],
  geminiApiKey: string,
): Promise<BrandDNASignal[]> {
  if (imagePaths.length === 0) return [];

  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  const signals: BrandDNASignal[] = [];

  // Process in batches of 5
  for (let i = 0; i < imagePaths.length; i += 5) {
    const batch = imagePaths.slice(i, i + 5);
    const imageBase64s: Array<{ data: string; mimeType: string }> = [];

    for (const imgPath of batch) {
      try {
        const bytes = await readFile(imgPath);
        const ext = path.extname(imgPath).toLowerCase().replace(".", "");
        const mimeType =
          ext === "png" ? "image/png"
          : ext === "webp" ? "image/webp"
          : "image/jpeg";
        imageBase64s.push({ data: bytes.toString("base64"), mimeType });
      } catch {
        // skip unreadable files
      }
    }

    if (imageBase64s.length === 0) continue;

    const result = await geminiVisionJsonBase64<InstagramBatchAnalysis>(
      geminiApiKey,
      INSTAGRAM_PROMPT,
      imageBase64s,
    );

    if (!result) continue;

    signals.push({
      source: "instagram_post",
      paletteHex: (result.colorPalette ?? []).filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c)),
      moodAdjectives: result.moodAdjectives ?? [],
      lightingStyle: result.lightingStyle ?? "natural_soft",
      compositionStyle: result.compositionStyle ?? "centered_model",
      modelArchetype: result.modelArchetype ?? "lifestyle",
      engagementScore: 0.9, // Instagram = intentional brand choice, high confidence
    });
  }

  return signals;
}

// ─── mergeBrandDNA ─────────────────────────────────────────────────────────────

export function mergeBrandDNA(signals: BrandDNASignal[]): BrandDNA {
  if (signals.length === 0) return defaultBrandDNA();

  // Weighted frequency count for mood adjectives
  const adjFreq: Record<string, number> = {};
  const lightingFreq: Record<string, number> = {};
  const compositionFreq: Record<string, number> = {};
  const archetypeFreq: Record<string, number> = {};
  const allPaletteHex: string[] = [];

  for (const sig of signals) {
    const w = sig.engagementScore;
    for (const adj of sig.moodAdjectives) {
      adjFreq[adj] = (adjFreq[adj] ?? 0) + w;
    }
    lightingFreq[sig.lightingStyle] = (lightingFreq[sig.lightingStyle] ?? 0) + w;
    compositionFreq[sig.compositionStyle] = (compositionFreq[sig.compositionStyle] ?? 0) + w;
    archetypeFreq[sig.modelArchetype] = (archetypeFreq[sig.modelArchetype] ?? 0) + w;
    allPaletteHex.push(...sig.paletteHex);
  }

  // Top 5 mood adjectives by weighted frequency
  const topAdjectives = Object.entries(adjFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([adj]) => adj);

  const topLighting = topKey(lightingFreq) ?? "studio_flat";
  const topComposition = topKey(compositionFreq) ?? "centered_model";
  const topArchetype = topKey(archetypeFreq) ?? "commercial";

  // Cluster palette hex colors into 6 dominant ones using HSL bucketing
  const palette = clusterPalette(allPaletteHex, 6);

  return {
    paletteJson: { hex: palette },
    toneJson: {
      moodAdjectives: topAdjectives,
      lighting: topLighting,
      modelArchetype: topArchetype,
      composition: topComposition,
      dominantFabrics: [],    // populated by catalog extraction
      seasonality: "all_season",
      pricePositioning: "contemporary",
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function topKey(freq: Record<string, number>): string | null {
  const entries = Object.entries(freq);
  if (entries.length === 0) return null;
  return entries.sort(([, a], [, b]) => b - a)[0][0];
}

/** Simple HSL-based palette clustering: bucket hues into N groups, pick centroid. */
function clusterPalette(hexColors: string[], targetCount: number): string[] {
  const valid = hexColors.filter((h) => /^#[0-9A-Fa-f]{6}$/.test(h));
  if (valid.length === 0) return [];
  if (valid.length <= targetCount) return [...new Set(valid)];

  // Convert hex → HSL hue
  const withHue = valid.map((hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = max === min ? 0 : l < 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min);
    let h = 0;
    if (max !== min) {
      if (max === r) h = ((g - b) / (max - min) + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / (max - min) + 2) / 6;
      else h = ((r - g) / (max - min) + 4) / 6;
    }
    return { hex, h: h * 360, s, l };
  });

  // Sort by hue and take evenly-spaced samples
  withHue.sort((a, b) => a.h - b.h);
  const step = Math.floor(withHue.length / targetCount);
  const result: string[] = [];
  for (let i = 0; i < targetCount; i++) {
    const idx = Math.min(i * step, withHue.length - 1);
    result.push(withHue[idx].hex);
  }
  return result;
}

function defaultBrandDNA(): BrandDNA {
  return {
    paletteJson: { hex: [] },
    toneJson: {
      moodAdjectives: [],
      lighting: "studio_flat",
      modelArchetype: "commercial",
      composition: "centered_model",
      dominantFabrics: [],
      seasonality: "all_season",
      pricePositioning: "contemporary",
    },
  };
}
