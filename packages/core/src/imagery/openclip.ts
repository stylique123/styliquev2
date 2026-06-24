// Stage 2 — OpenCLIP / SigLIP zero-shot garment classifier (OSS, $0).
//
// Replaces the paid AWS Rekognition stub (which is OFF by default) with an
// open-weight CLIP/SigLIP model doing exactly the on-task job: "is this a clean
// wearable-garment hero shot, or a lifestyle/model / fabric-swatch / detail-crop
// / size-chart image?" — the same judgement Findings #145/#146 reach for.
//
// Provider-agnostic: it POSTs each image URL to a configurable zero-shot endpoint
// (HF Inference API, Fal, or our own worker sidecar) — no torch in this Node
// package. ACTIVATION is env-gated (CLIP_QUALITY_ENDPOINT). Dormant otherwise, so
// the pipeline behaviour is unchanged until the endpoint is set. Reuses the
// existing Stage-2 QualityReason codes so the orchestrator + tests are untouched.

import type { ImageInput, ImageQualityProvider, ImageScore } from "./types.js";

// Candidate labels the model scores each image against (zero-shot). Order does
// not matter; the endpoint returns a score per label.
export const CLIP_LABELS = [
  "a clean studio photo of a single clothing garment on a plain background",
  "a fashion model wearing an outfit in a lifestyle scene",
  "a close-up fabric swatch or texture detail",
  "a cropped detail of a garment (collar, button, sleeve)",
  "a size chart or measurement table",
] as const;

export type OpenClipConfig = {
  endpoint?: string;          // zero-shot inference URL
  apiKey?: string;            // bearer token (HF / Fal)
  fetchImpl?: typeof fetch;
  // Per-image timeout so one slow CDN/endpoint never stalls a sync batch.
  timeoutMs?: number;
};

type LabelScores = { garment: number; lifestyle: number; swatch: number; detail: number; sizechart: number };

// Map the endpoint response (tolerant of common shapes) → normalized label scores.
function parseScores(j: unknown): LabelScores | null {
  // HF zero-shot: [{label, score}, ...] OR {labels:[], scores:[]} OR {scores:[...]}
  let pairs: Array<{ label?: string; score: number }> = [];
  if (Array.isArray(j) && j.length && typeof (j[0] as { label?: string }).label === "string") {
    pairs = j as Array<{ label: string; score: number }>;
  } else if (j && Array.isArray((j as { labels?: string[] }).labels) && Array.isArray((j as { scores?: number[] }).scores)) {
    const o = j as { labels: string[]; scores: number[] };
    pairs = o.labels.map((label, i) => ({ label, score: o.scores[i] ?? 0 }));
  } else if (Array.isArray((j as { scores?: number[] }).scores)) {
    const s = (j as { scores: number[] }).scores;
    pairs = CLIP_LABELS.map((label, i) => ({ label, score: s[i] ?? 0 }));
  } else { return null; }
  const at = (kw: string) => pairs.find((p) => (p.label ?? "").toLowerCase().includes(kw))?.score ?? 0;
  return {
    garment: at("single clothing garment") || at("garment"),
    lifestyle: at("lifestyle") || at("model wearing"),
    swatch: at("swatch") || at("fabric"),
    detail: at("cropped detail") || at("close-up"),
    sizechart: at("size chart") || at("measurement"),
  };
}

function toScore(id: string, s: LabelScores | null): ImageScore {
  if (!s) return { id, score: 5.0, reasons: ["rk_low_confidence"] }; // neutral on parse failure — never abort
  const reasons: ImageScore["reasons"] = [];
  let role: ImageScore["garmentRole"] | undefined;
  // Clean garment hero = boost; lifestyle/swatch/detail/sizechart = penalize.
  let score = 5.0 + s.garment * 5.0 - s.lifestyle * 3.5 - s.swatch * 4.0 - s.detail * 3.0 - s.sizechart * 4.5;
  if (s.garment >= 0.45) reasons.push("rk_clothing_detected", "rk_background_clean");
  if (s.lifestyle >= 0.4) { reasons.push("rk_person_detected"); role = "LIFESTYLE"; }
  if (s.swatch >= 0.4) role = "SWATCH";
  if (s.detail >= 0.45 && !role) role = "DETAIL";
  const max = Math.max(s.garment, s.lifestyle, s.swatch, s.detail, s.sizechart);
  if (max < 0.35) reasons.push("rk_low_confidence");
  score = Math.max(0, Math.min(10, score));
  return { id, score, reasons, garmentRole: role };
}

export function createOpenClipQualityProvider(cfg: OpenClipConfig = {}): ImageQualityProvider {
  const f = cfg.fetchImpl ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 12_000;
  const enabled = !!cfg.endpoint;
  return {
    key: enabled ? "openclip" : "stub",
    async score(images: ImageInput[]): Promise<ImageScore[]> {
      // Dormant without an endpoint: passthrough neutral so Stage-1 stands.
      if (!enabled) return images.map((im) => ({ id: im.id, score: 5.5, reasons: [] as ImageScore["reasons"] }));
      return Promise.all(
        images.map(async (im): Promise<ImageScore> => {
          try {
            const res = await f(cfg.endpoint!, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
              body: JSON.stringify({ inputs: im.url, parameters: { candidate_labels: CLIP_LABELS } }),
              signal: AbortSignal.timeout(timeoutMs),
            });
            if (!res.ok) return { id: im.id, score: 5.0, reasons: ["rk_low_confidence"] };
            return toScore(im.id, parseScores(await res.json()));
          } catch {
            // Never abort the batch — a failed image scores neutral-low.
            return { id: im.id, score: 5.0, reasons: ["rk_low_confidence"] };
          }
        }),
      );
    },
  };
}

// Env selector: OpenCLIP when an endpoint is configured, else the Rekognition
// stub (today's default no-op). One line at the binding site; dormant until set.
export function selectStage2Provider(
  env: Record<string, string | undefined>,
  fallback: ImageQualityProvider,
  fetchImpl?: typeof fetch,
): ImageQualityProvider {
  if (env.CLIP_QUALITY_ENDPOINT) {
    return createOpenClipQualityProvider({ endpoint: env.CLIP_QUALITY_ENDPOINT, apiKey: env.CLIP_QUALITY_TOKEN, fetchImpl });
  }
  return fallback;
}
