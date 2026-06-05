// Image quality orchestrator — Stage 1 + Stage 2 → Product.widgetTier (D37).
//
// Called from the worker's image-quality job. Pure function over inputs;
// the caller is responsible for persisting the returned updates.

import { createStage1Provider } from "./stage1.js";
import { createAwsRekognitionProvider, type AwsRekognitionConfig } from "./aws-rekognition.js";
import {
  USABLE_THRESHOLD,
  computeWidgetTier,
  type ImageInput,
  type ImageScore,
  type ImageQualityProvider,
} from "./types.js";

export type ScoreProductImagesInput = {
  productId: string;
  images: ImageInput[];
  // Optional provider injection — defaults to Stage 1 + (AWS if env present).
  stage1?: ImageQualityProvider;
  stage2?: ImageQualityProvider;
  awsConfig?: AwsRekognitionConfig;
};

export type PerImageUpdate = {
  imageId: string;
  qualityScore: number;
  qualityReasons: string[];
  qualityProvider: string;
  garmentRole?: "FRONT" | "BACK" | "DETAIL" | "LIFESTYLE" | "SWATCH";
  widthPx?: number;
  heightPx?: number;
  bytes?: number;
};

export type ProductUpdate = {
  productId: string;
  primaryTryonImageId: string | null;
  tryonReady: boolean;
  widgetTier: 1 | 2 | 3;
  perImage: PerImageUpdate[];
};

const STAGE2_SURVIVOR_CAP = 4;   // never send more than 4 to Stage 2
const STAGE2_MIN_SCORE    = 4.5; // only send Stage 1 survivors at or above this

export async function scoreProductImages(input: ScoreProductImagesInput): Promise<ProductUpdate> {
  const stage1 = input.stage1 ?? createStage1Provider();
  const stage2 =
    input.stage2 ??
    createAwsRekognitionProvider(input.awsConfig ?? readAwsConfigFromEnv());

  // No images? Tier 3 immediately. The widget will skip the visual try-on
  // entirely — degrades gracefully per Phase 1 §2.5.
  if (input.images.length === 0) {
    return {
      productId: input.productId,
      primaryTryonImageId: null,
      tryonReady: false,
      widgetTier: 3,
      perImage: [],
    };
  }

  const s1 = await stage1.score(input.images);
  const s1ById = new Map(s1.map((r) => [r.id, r]));

  // Pick survivors for Stage 2 — top by Stage 1 score, capped, above floor.
  const survivors = [...s1]
    .sort((a, b) => b.score - a.score)
    .filter((r) => r.score >= STAGE2_MIN_SCORE)
    .slice(0, STAGE2_SURVIVOR_CAP);

  let s2: ImageScore[] = [];
  if (survivors.length > 0 && stage2.key !== "aws_rekognition_disabled") {
    try {
      s2 = await stage2.score(
        survivors.map((s) => {
          const orig = input.images.find((i) => i.id === s.id);
          return orig ?? { id: s.id, url: "", position: 0 };
        }),
      );
    } catch (err) {
      // Soft-fail Stage 2 — fall back to Stage 1 scores. The admin tile
      // will show "AI scoring failed" via qualityReasons.
      console.error("[image-quality] stage2 failed:", (err as Error).message);
      s2 = [];
    }
  }
  const s2ById = new Map(s2.map((r) => [r.id, r]));

  // Merge — Stage 2 score wins when present and non-zero; reasons concatenate.
  const merged: ImageScore[] = s1.map((r) => {
    const lift = s2ById.get(r.id);
    if (!lift || lift.score === 0) return r;
    return {
      ...r,
      score: Math.max(r.score, lift.score),
      reasons: [...r.reasons, ...lift.reasons],
      garmentRole: r.garmentRole ?? lift.garmentRole,
    };
  });

  // Pick primary — highest-scoring FRONT first, then highest overall.
  const sortedByScore = [...merged].sort((a, b) => b.score - a.score);
  const fronts = sortedByScore.filter((r) => r.garmentRole === "FRONT" && r.score >= USABLE_THRESHOLD);
  const primary = fronts[0] ?? sortedByScore.find((r) => r.score >= USABLE_THRESHOLD) ?? null;

  const usableCount = merged.filter((r) => r.score >= USABLE_THRESHOLD).length;

  const perImage: PerImageUpdate[] = merged.map((r) => ({
    imageId: r.id,
    qualityScore: r.score,
    qualityReasons: r.reasons,
    qualityProvider: s2ById.has(r.id) ? "aws_rekognition" : "stage1",
    garmentRole: r.garmentRole,
    widthPx: r.widthPx,
    heightPx: r.heightPx,
    bytes: r.bytes,
  }));

  return {
    productId: input.productId,
    primaryTryonImageId: primary?.id ?? null,
    tryonReady: primary !== null,
    widgetTier: computeWidgetTier(usableCount),
    perImage,
  };
}

function readAwsConfigFromEnv(): AwsRekognitionConfig {
  return {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    disabled: process.env.AWS_REKOGNITION_DISABLED === "1",
  };
}

// Convenience for the worker: hydrate an ImageInput[] from a Prisma read.
export function toImageInput(p: {
  id: string;
  url: string;
  position: number;
  shopifyId?: string | null;
}): ImageInput {
  return {
    id: p.id,
    url: p.url,
    position: p.position,
    shopifyFilename: p.shopifyId ? null : extractFilename(p.url),
  };
}

function extractFilename(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}
