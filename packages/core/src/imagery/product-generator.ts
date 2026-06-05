// Stylique — Gemini Vision product details generator.
//
// Given a product image (base64), calls Gemini 2.0 Flash with structured-JSON
// output to extract editorial product details a brand can publish to Shopify
// with one click. Provider-agnostic pattern: GEMINI_API_KEY absent → returns a
// stub with confidenceScore: 0 so the UI shows empty fields the brand fills
// manually.
//
// Used by: apps/shopify-app/app/routes/api.admin.products.create.tsx

export type GeneratedProductDetails = {
  title: string;
  description: string;          // 2-3 sentences, editorial tone
  category: string;             // e.g. "Tops", "Bottoms", "Outerwear"
  tags: string[];               // 5-8 tags
  suggestedPriceRange: {
    min: number;
    max: number;
    currency: "USD" | "GBP" | "PKR";
  };
  primaryColor: string;         // hex e.g. "#C8B89A"
  fabricHint: string;           // e.g. "linen", "cotton", "silk"
  seasonHint: string;           // e.g. "spring/summer", "all-season"
  confidenceScore: number;      // 0–1
};

// Returned when GEMINI_API_KEY is absent — shows empty fields the brand fills.
const STUB_RESULT: GeneratedProductDetails = {
  title: "",
  description: "",
  category: "Other",
  tags: [],
  suggestedPriceRange: { min: 0, max: 0, currency: "USD" },
  primaryColor: "#888888",
  fabricHint: "",
  seasonHint: "",
  confidenceScore: 0,
};

const SYSTEM_PROMPT = `You are a fashion brand assistant that generates structured product details for a Shopify store.
Analyse the product image carefully and extract accurate, editorial-quality information.
Return ONLY valid JSON matching the schema provided. Be specific and concise.
For the description: 2-3 sentences in an editorial, aspirational tone suitable for a fashion product page.
For tags: 5-8 relevant, SEO-friendly tags without the # symbol.
For primaryColor: return the dominant garment color as a hex value.
For fabricHint: infer from visual texture and drape (e.g. "linen", "cotton", "silk", "denim", "wool", "polyester", "leather").
For seasonHint: one of "spring/summer", "autumn/winter", or "all-season".
For suggestedPriceRange: realistic retail price range in USD for this garment category and quality level.`;

const JSON_SCHEMA_PROMPT = `Return your analysis as valid JSON with this exact structure:
{
  "title": "string — short product title (3-6 words)",
  "description": "string — 2-3 sentence editorial description",
  "category": "string — one of: Tops, Bottoms, Dresses, Outerwear, Footwear, Accessories, Other",
  "tags": ["string", "..."],
  "suggestedPriceRange": { "min": number, "max": number, "currency": "USD" },
  "primaryColor": "string — hex color e.g. #C8B89A",
  "fabricHint": "string — fabric material",
  "seasonHint": "string — one of: spring/summer, autumn/winter, all-season",
  "confidenceScore": number between 0 and 1
}`;

export async function generateProductDetailsFromImage(
  imageBase64: string,
  mimeType: string,
  brandContext?: {
    brandName?: string;
    priceRange?: string;
    style?: string;
  },
): Promise<GeneratedProductDetails> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn(
      "[product-generator] GEMINI_API_KEY not set — returning stub result",
    );
    return STUB_RESULT;
  }

  // Brand context enriches the prompt when available.
  let contextNote = "";
  if (brandContext) {
    const parts: string[] = [];
    if (brandContext.brandName)
      parts.push(`Brand: ${brandContext.brandName}`);
    if (brandContext.priceRange)
      parts.push(`Price positioning: ${brandContext.priceRange}`);
    if (brandContext.style)
      parts.push(`Style identity: ${brandContext.style}`);
    if (parts.length)
      contextNote = `\n\nBrand context:\n${parts.join("\n")}`;
  }

  const userText = `Analyse this fashion product image and generate structured product details for a Shopify store.${contextNote}

${JSON_SCHEMA_PROMPT}`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: {
      role: "user",
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: userText },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  };

  let raw: string;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "(no body)");
      console.error(
        `[product-generator] Gemini API error ${res.status}:`,
        errText,
      );
      return STUB_RESULT;
    }
    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    raw =
      json.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "";
  } catch (err) {
    console.error("[product-generator] fetch failed:", err);
    return STUB_RESULT;
  }

  if (!raw) {
    console.warn("[product-generator] Gemini returned empty content");
    return STUB_RESULT;
  }

  // Parse the JSON response. Gemini with responseMimeType:application/json
  // should return valid JSON, but guard against edge cases.
  try {
    // Strip markdown code fences if present (Gemini sometimes adds them even
    // with responseMimeType set).
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    // Use a permissive intermediate type so we can safely read all fields.
    type RawParsed = {
      title?: unknown;
      description?: unknown;
      category?: unknown;
      tags?: unknown;
      suggestedPriceRange?: { min?: unknown; max?: unknown; currency?: unknown };
      primaryColor?: unknown;
      fabricHint?: unknown;
      seasonHint?: unknown;
      confidenceScore?: unknown;
    };
    const parsed = JSON.parse(cleaned) as RawParsed;

    // Normalise and validate each field with safe fallbacks.
    const priceRange = parsed.suggestedPriceRange ?? {};
    const rawCurrency =
      typeof priceRange.currency === "string" ? priceRange.currency : "USD";
    const currency: "USD" | "GBP" | "PKR" =
      rawCurrency === "GBP" ? "GBP" : rawCurrency === "PKR" ? "PKR" : "USD";

    const result: GeneratedProductDetails = {
      title:
        typeof parsed.title === "string" ? parsed.title.slice(0, 120) : "",
      description:
        typeof parsed.description === "string"
          ? parsed.description.slice(0, 1000)
          : "",
      category:
        typeof parsed.category === "string" ? parsed.category : "Other",
      tags: Array.isArray(parsed.tags)
        ? (parsed.tags as unknown[])
            .filter((t): t is string => typeof t === "string")
            .slice(0, 12)
            .map((t) => t.replace(/^#/, ""))
        : [],
      suggestedPriceRange: {
        min: typeof priceRange.min === "number" ? (priceRange.min as number) : 0,
        max: typeof priceRange.max === "number" ? (priceRange.max as number) : 0,
        currency,
      },
      primaryColor:
        typeof parsed.primaryColor === "string"
          ? parsed.primaryColor
          : "#888888",
      fabricHint:
        typeof parsed.fabricHint === "string" ? parsed.fabricHint : "",
      seasonHint:
        typeof parsed.seasonHint === "string" ? parsed.seasonHint : "",
      confidenceScore:
        typeof parsed.confidenceScore === "number"
          ? Math.min(1, Math.max(0, parsed.confidenceScore))
          : 0.5,
    };

    return result;
  } catch (err) {
    console.error("[product-generator] failed to parse Gemini JSON:", err);
    return STUB_RESULT;
  }
}
