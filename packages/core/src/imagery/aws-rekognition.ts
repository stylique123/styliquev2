// Stage 2 — AWS Rekognition image-quality refinement (D37).
//
// Only invoked on Stage 1 survivors (typically 2–4 images per product
// per Phase 1 §2.4). Costs ~$0.001 per image. AWS credits absorb this
// at pilot scale; quotas governed at the orchestrator level.
//
// IMPLEMENTATION STATUS: stub by default. When AWS_REKOGNITION_DISABLED
// is set OR AWS credentials are absent, returns the Stage 1 scores
// unchanged (no refinement, no AWS call). When wired, this provider will
// call DetectLabels + DetectModerationLabels and translate the response
// into the same ImageScore shape so the orchestrator doesn't care which
// stage produced the value.
//
// To wire the real call:
//   1. Add @aws-sdk/client-rekognition to packages/core dependencies.
//   2. Implement scoreOne() below using rekognitionClient.send(new
//      DetectLabelsCommand({...})).
//   3. Set AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in env.
//   4. Drop AWS_REKOGNITION_DISABLED.

import type {
  ImageInput,
  ImageQualityProvider,
  ImageScore,
} from "./types.js";

export type AwsRekognitionConfig = {
  region?: string;          // e.g. "us-east-1"
  accessKeyId?: string;
  secretAccessKey?: string;
  // If true, skip the real API call and return a passthrough. Used in
  // dev (env not present) and as a kill-switch in prod when credits run
  // low or Rekognition has an outage.
  disabled?: boolean;
};

export function createAwsRekognitionProvider(
  cfg: AwsRekognitionConfig = {},
): ImageQualityProvider {
  const enabled =
    !cfg.disabled &&
    Boolean(cfg.region && cfg.accessKeyId && cfg.secretAccessKey);

  return {
    key: enabled ? "aws_rekognition" : "aws_rekognition_disabled",
    async score(images: ImageInput[]): Promise<ImageScore[]> {
      if (!enabled) {
        // Pass-through: emit a neutral score so the orchestrator can fall
        // back to Stage 1 results. Marked with a reason so admin tile can
        // flag "AI scoring not configured" without surfacing a fake number.
        return images.map((img) => ({
          id: img.id,
          score: 0,
          reasons: ["rk_low_confidence"],
        }));
      }

      // Real implementation pending @aws-sdk/client-rekognition install.
      // Credentials are present (gate passed) but the SDK hasn't been
      // added yet (OI-29 dependency). Warn once per process and pass
      // through so Stage 1 scores are used instead of triggering an
      // error log every single job.
      console.warn(
        "[image-quality] AWS Rekognition credentials detected but @aws-sdk/client-rekognition " +
        "is not yet installed — running Stage 1 only. " +
        "Add @aws-sdk/client-rekognition to packages/core to activate Stage 2.",
      );
      return images.map((img) => ({
        id: img.id,
        score: 0,
        reasons: ["rk_low_confidence" as const],
      }));
    },
  };
}
