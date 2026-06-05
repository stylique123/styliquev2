// Image-match server bindings — "find me something like this" reference-photo
// search. Bridges Gemini Vision (image → caption) + Gemini text-embedding-004
// (caption → 768d) + the ProductEmbedding rows the catalog backfill produced.
//
// SECURITY:
//   • Image bytes are passed straight to the model — never written to disk.
//   • Lookup is shopId-scoped. Cross-tenant impossible.
//   • Caller (chat route) already enforces the data-url MIME regex + size cap;
//     we accept base64 here, no extra validation needed.
//
// Cost discipline: 1 vision call + 1 embed call per reference photo (~free at
// Gemini quota). Heavy users (>1000 image searches/day/shop) we'll move to a
// cached caption keyed by image hash.

import { prisma } from "../db.server";
import {
  createEmbeddingsService,
  createGeminiEmbedProvider,
  createGeminiVisionMatchProvider,
  type EmbeddingsService,
  type ImageMatchProvider,
} from "@stylique/core";

let _embed: EmbeddingsService | null = null;
let _vision: ImageMatchProvider | null = null;

function tryGetEmbed(): EmbeddingsService | null {
  if (_embed) return _embed;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  _embed = createEmbeddingsService(
    createGeminiEmbedProvider({ apiKey: key, model: process.env.GEMINI_EMBED_MODEL }),
  );
  return _embed;
}
function tryGetVision(): ImageMatchProvider | null {
  if (_vision) return _vision;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  _vision = createGeminiVisionMatchProvider({
    apiKey: key,
    model: process.env.GEMINI_VISION_MODEL,
  });
  return _vision;
}

export interface MatchByReferenceImageResult {
  caption: string;
  matches: Array<{ productId: string; score: number }>;
}

// Match a shopper-uploaded reference photo against the shop's catalog. Returns
// an empty result (not an error) when providers aren't configured so the chat
// flow degrades gracefully.
export async function matchByReferenceImage(args: {
  shopId: string;
  imageBase64: string;     // raw base64 (data: prefix stripped is OK)
  mime: string;            // "image/jpeg" | "image/png" | ...
  limit?: number;
}): Promise<MatchByReferenceImageResult> {
  const embed  = tryGetEmbed();
  const vision = tryGetVision();
  if (!embed || !vision) return { caption: "", matches: [] };

  let caption: string;
  try {
    caption = await vision.describeForMatching({ base64: args.imageBase64, mime: args.mime });
  } catch {
    return { caption: "", matches: [] };
  }

  let qvec: number[];
  try {
    qvec = await embed.embed(caption);
  } catch {
    return { caption, matches: [] };
  }

  // SECURITY: shopId-scoped — cross-tenant impossible.
  const rows = await prisma.productEmbedding.findMany({
    where: { shopId: args.shopId, modelKey: embed.provider.modelKey },
    select: { productId: true, vector: true },
    take: 5000,
  });
  if (!rows.length) return { caption, matches: [] };

  const limit = Math.min(args.limit ?? 8, 20);
  const matches = embed.topK(
    qvec,
    rows.map((r) => ({ id: r.productId, vector: r.vector })),
    limit,
  ).map((r) => ({ productId: r.id, score: r.score }));

  return { caption, matches };
}
