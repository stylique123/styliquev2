// Brain — intent classifier.
//
// Runs BEFORE the full Brain, as a single cheap/fast Gemini Flash call. The
// goal is to classify shopper intent cheaply so the router (router.ts) can
// decide whether the turn can be handled on the cheap path or must escalate to
// a strong reasoning model. This is the "rules decide facts, AI decides
// guidance" hybrid: we spend a few cents on a fast model to AVOID spending a
// lot on a strong model for 70-80% of turns that don't need it.
//
// Hard contract: classify() NEVER throws. Any error / timeout / malformed
// response collapses to the high-complexity fallback so the full Brain still
// runs — a misclassification costs money, a thrown error costs a chat turn.

// ─── Public types ──────────────────────────────────────────────────────────

export type PageType = "homepage" | "pdp" | "collection" | "cart";

export type PageContext = {
  pageType: PageType;
  productTitle?: string;
  // True when the shopper attached an image this turn (selfie / reference /
  // product photo). Forces needsVision regardless of what the model returns.
  hasImage?: boolean;
};

export type ClassificationIntent =
  | "discover" | "occasion" | "size" | "tryon" | "compare"
  | "outfit" | "stock" | "support" | "casual" | "complex";

export type ClassificationComplexity = "low" | "medium" | "high";

export type ClassificationResult = {
  intent: ClassificationIntent;
  complexity: ClassificationComplexity;
  confidence: number;            // 0–1
  needsVision: boolean;
  estimatedStage: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  keyEntities: string[];
};

// ─── Constants ───────────────────────────────────────────────────────────

const CLASSIFY_MODEL = "gemini-2.5-flash";
const CLASSIFY_TIMEOUT_MS = 3000;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const VALID_INTENTS: readonly ClassificationIntent[] = [
  "discover", "occasion", "size", "tryon", "compare",
  "outfit", "stock", "support", "casual", "complex",
] as const;

const VALID_COMPLEXITY: readonly ClassificationComplexity[] = ["low", "medium", "high"] as const;

// The safe fallback — used whenever the call fails, times out, or the response
// can't be parsed. High complexity means the router will give the turn the full
// (strong/standard) treatment: a misclassification toward "too capable" is
// always safer than dropping the turn into the cheap path by mistake.
const FALLBACK: ClassificationResult = {
  intent: "complex",
  complexity: "high",
  confidence: 0,
  needsVision: false,
  estimatedStage: 1,
  keyEntities: [],
};

// ─── Prompt (kept under 400 chars of instruction) ───────────────────────────

// We keep the instruction itself tiny — the cost saving only holds if the
// classifier prompt is cheap. The message + page context are appended after.
function buildClassifierContents(message: string, pageContext: PageContext): string {
  const page = pageContext.pageType;
  const prod = pageContext.productTitle ? ` product="${pageContext.productTitle}"` : "";
  // Instruction is intentionally terse. Enumerate the labels so the model
  // returns one of ours; ask for strict JSON matching ClassificationResult.
  const instruction =
    `Classify the shopper turn. Return JSON only: ` +
    `{intent,complexity,confidence,needsVision,estimatedStage,keyEntities}. ` +
    `intent=discover|occasion|size|tryon|compare|outfit|stock|support|casual|complex. ` +
    `complexity=low|medium|high. confidence 0-1. needsVision=true if visual/image. ` +
    `estimatedStage 1-9 (shopping funnel). keyEntities=array of garment/attribute strings.`;
  return `${instruction}\nPAGE: ${page}${prod}\nMESSAGE: ${message}`;
}

// ─── Public entry point ──────────────────────────────────────────────────

export async function classifyShopperIntent(
  message: string,
  pageContext: PageContext,
  apiKey: string,
): Promise<ClassificationResult> {
  // No key → no classification. Fall back so the Brain still runs (it has its
  // own provider config and doesn't depend on the classifier).
  if (!apiKey) {
    return withVisionOverride(FALLBACK, pageContext);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS);

  try {
    const body = {
      contents: [{ role: "user", parts: [{ text: buildClassifierContents(message, pageContext) }] }],
      generationConfig: {
        temperature: 0,
        topP: 0.95,
        responseMimeType: "application/json",
      },
    };

    const res = await fetch(`${GEMINI_BASE}/${CLASSIFY_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) return withVisionOverride(FALLBACK, pageContext);

    const json = (await res.json()) as unknown;
    const text = extractText(json);
    if (!text) return withVisionOverride(FALLBACK, pageContext);

    const parsed = safeParse(text);
    if (!parsed) return withVisionOverride(FALLBACK, pageContext);

    return withVisionOverride(normalize(parsed), pageContext);
  } catch {
    // Any error — abort/timeout, network, JSON — collapses to the safe fallback.
    // NEVER throw out of the classifier.
    return withVisionOverride(FALLBACK, pageContext);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// A shopper-attached image is a hard fact the model can't override — force
// needsVision true when the page context says an image came in this turn.
function withVisionOverride(r: ClassificationResult, pageContext: PageContext): ClassificationResult {
  if (pageContext.hasImage && !r.needsVision) {
    return { ...r, needsVision: true };
  }
  return r;
}

function extractText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = (candidates[0] as { content?: unknown }).content;
  if (!content || typeof content !== "object") return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const t = (p as { text?: unknown }).text;
    if (typeof t === "string" && t.trim()) return t;
  }
  return null;
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    // Strip code fences if the model wrapped the JSON despite responseMimeType.
    const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === "object") return obj as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function normalize(raw: Record<string, unknown>): ClassificationResult {
  const intent = coerceIntent(raw.intent);
  const complexity = coerceComplexity(raw.complexity);
  const confidence = coerceConfidence(raw.confidence);
  const needsVision = raw.needsVision === true || raw.needsVision === "true";
  const estimatedStage = coerceStage(raw.estimatedStage);
  const keyEntities = coerceEntities(raw.keyEntities);
  return { intent, complexity, confidence, needsVision, estimatedStage, keyEntities };
}

function coerceIntent(v: unknown): ClassificationIntent {
  if (typeof v === "string" && (VALID_INTENTS as readonly string[]).includes(v)) {
    return v as ClassificationIntent;
  }
  return "complex";
}

function coerceComplexity(v: unknown): ClassificationComplexity {
  if (typeof v === "string" && (VALID_COMPLEXITY as readonly string[]).includes(v)) {
    return v as ClassificationComplexity;
  }
  // Unknown complexity → treat as high (safe over-capable default).
  return "high";
}

function coerceConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function coerceStage(v: unknown): ClassificationResult["estimatedStage"] {
  const n = typeof v === "number" ? Math.round(v) : Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 9) return 9;
  return n as ClassificationResult["estimatedStage"];
}

function coerceEntities(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
    .slice(0, 12);
}
