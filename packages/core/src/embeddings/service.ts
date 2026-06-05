// Embeddings service — provider-agnostic, mirroring the Brain pattern.
//
// Today: Gemini text-embedding-004 (768 dims). Free up to a generous quota
// per the same key we already use.
// Future: OpenAI text-embedding-3-small (1536 dims), Voyage, local.
//
// Stylique uses embeddings for:
//   1. Catalog vector search — fallback when ILIKE returns <3 matches
//   2. Semantic response cache — group similar shopper queries
//   3. (later) FashionCLIP image embeddings — visual product matching
//
// The service exposes `embed(text)` + `cosineSim(a, b)` + `topK(query, candidates, k)`.
// At Stylique brand scale (50-2000 products/shop) we cosine-rank in-process.
// Switch to pgvector or Chroma when a brand crosses ~5000 products.

export interface EmbedProvider {
  readonly key: string;          // "gemini" | "openai" | ...
  readonly model: string;
  readonly dims: number;         // 768 for Gemini, 1536 for OpenAI 3-small
  readonly modelKey: string;     // "<provider>:<model>:<dims>" for ProductEmbedding.modelKey
  embed(text: string): Promise<number[]>;
}

export interface EmbeddingsService {
  readonly provider: EmbedProvider;
  embed(text: string): Promise<number[]>;
  cosineSim(a: number[], b: number[]): number;
  topK<T>(queryVec: number[], candidates: Array<{ id: T; vector: number[] }>, k: number): Array<{ id: T; score: number }>;
  productEmbeddingText(p: {
    title: string;
    productType?: string | null;
    primaryColor?: string | null;
    colorFamily?: string | null;
    category?: string | null;
    tags?: string[];
  }): string;
}

// ─── Gemini provider ──────────────────────────────────────────────────
// Uses the same Generative Language API our Brain hits. One env var
// (GEMINI_API_KEY) for both.

export function createGeminiEmbedProvider(opts: {
  apiKey: string;
  model?: string;          // default: text-embedding-004
  fetchImpl?: typeof fetch;
}): EmbedProvider {
  const model = opts.model ?? "text-embedding-004";
  const dims = 768;
  const f = opts.fetchImpl ?? fetch;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(opts.apiKey)}`;
  return {
    key: "gemini",
    model,
    dims,
    modelKey: `gemini:${model}:${dims}`,
    async embed(text) {
      const res = await f(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text: text.slice(0, 8000) }] },
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`embed_http_${res.status}: ${t.slice(0, 200)}`);
      }
      const data = (await res.json()) as { embedding?: { values?: number[] } };
      const vec = data.embedding?.values;
      if (!Array.isArray(vec) || vec.length !== dims) {
        throw new Error(`embed_bad_response_dims_${vec?.length ?? 0}`);
      }
      return vec;
    },
  };
}

// ─── OpenAI provider (stub — installed when OPENAI_API_KEY lands) ──────
export function createOpenAIEmbedProvider(opts: {
  apiKey?: string;
  model?: string;          // default: text-embedding-3-small
}): EmbedProvider {
  const model = opts.model ?? "text-embedding-3-small";
  const dims = 1536;
  return {
    key: "openai",
    model,
    dims,
    modelKey: `openai:${model}:${dims}`,
    async embed(_text) {
      if (!opts.apiKey) throw new Error("openai_not_configured");
      throw new Error("openai_embed_unimplemented");
    },
  };
}

// ─── Service ───────────────────────────────────────────────────────────

export function createEmbeddingsService(provider: EmbedProvider): EmbeddingsService {
  return {
    provider,
    embed: (text) => provider.embed(text),

    cosineSim(a, b) {
      if (a.length !== b.length) return 0;
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) {
        const x = a[i]!, y = b[i]!;
        dot += x * y;
        na  += x * x;
        nb  += y * y;
      }
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      return denom === 0 ? 0 : dot / denom;
    },

    topK<T>(queryVec: number[], candidates: Array<{ id: T; vector: number[] }>, k: number) {
      const out: Array<{ id: T; score: number }> = [];
      for (const c of candidates) {
        if (c.vector.length !== queryVec.length) continue;
        // inline cosineSim — avoid call overhead on hot path
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < queryVec.length; i++) {
          const x = queryVec[i]!, y = c.vector[i]!;
          dot += x * y; na += x * x; nb += y * y;
        }
        const denom = Math.sqrt(na) * Math.sqrt(nb);
        out.push({ id: c.id, score: denom === 0 ? 0 : dot / denom });
      }
      out.sort((a, b) => b.score - a.score);
      return out.slice(0, k);
    },

    // The string we embed for a product. Compact + fashion-vocabulary-rich.
    // Tags are deduplicated; the order matters for embedding (we put title
    // first because it's the most distinctive).
    productEmbeddingText(p) {
      const parts: string[] = [p.title];
      if (p.category)     parts.push(p.category);
      if (p.productType && p.productType !== p.category) parts.push(p.productType);
      if (p.colorFamily)  parts.push(`${p.colorFamily} tone`);
      if (p.primaryColor) parts.push(p.primaryColor);
      if (p.tags && p.tags.length) parts.push(p.tags.slice(0, 8).join(", "));
      return parts.join(" · ");
    },
  };
}
