// Stylique — garment-image quality pipeline (D37).
//
// Provider-agnostic shape: Stage 1 is a free heuristic filter that runs
// always; Stage 2 (AWS Rekognition / Google Vision / etc.) refines the
// survivors with AI scoring. Both implement `ImageQualityProvider`. The
// orchestrator in service.ts composes them.

export type ImageInput = {
  id: string;             // ProductImage.id — opaque to scorers
  url: string;            // public image URL (Shopify CDN typically)
  position: number;       // Shopify display order
  shopifyFilename?: string | null; // when known — used by filename heuristics
};

export type QualityReason =
  // Stage 1 rejection codes (heuristic, free)
  | "aspect_ratio_out_of_band"   // not portrait-ish / square
  | "too_small"                  // < 600px on long edge
  | "too_large_filesize"         // > 8MB — costs to re-score
  | "suspected_swatch"           // tiny dimensions + tiny bytes
  | "suspected_detail_crop"      // extreme aspect ratio
  | "filename_lifestyle_hint"    // _lifestyle, _editorial, _model patterns
  | "filename_swatch_hint"       // _swatch, _fabric, _detail patterns
  | "filename_back_hint"         // _back — captured as garmentRole=BACK
  | "filename_front_hint"        // _front / no suffix — garmentRole=FRONT
  // Stage 2 (AWS Rekognition) reasons
  | "rk_person_detected"
  | "rk_clothing_detected"
  | "rk_background_clean"
  | "rk_low_confidence"
  | "rk_moderation_flag";

export type ImageScore = {
  id: string;
  score: number;          // 0..10
  reasons: QualityReason[];
  // Inferred orientation, when we can tell — used to set ProductImage.garmentRole.
  garmentRole?: "FRONT" | "BACK" | "DETAIL" | "LIFESTYLE" | "SWATCH";
  // Diagnostics captured so we don't re-download bytes later.
  widthPx?: number;
  heightPx?: number;
  bytes?: number;
};

export type ImageQualityProvider = {
  readonly key: string;   // "stage1" | "aws_rekognition" | "google_vision" | "stub"
  // Score a batch. Implementations decide whether to fan out per-image or
  // batch into a single API call. Errors on individual images should be
  // returned as a low-score result with a `rk_low_confidence` reason — never
  // throw and abort the whole batch.
  score(images: ImageInput[]): Promise<ImageScore[]>;
};

// Tier rule from Phase 1 §2.5 — encoded once, used by both the worker
// (writes Product.widgetTier) and the entitlement read path.
//   5+ usable images   → Tier 1 (full try-on, angle picker)
//   2-4 usable images  → Tier 2 (carousel)
//   0-1 usable images  → Tier 3 (size + styling only, no visual try-on)
//
// "Usable" = qualityScore >= USABLE_THRESHOLD. Default 5.5 matches the
// Phase 1 intent of "rejected obvious junk + survived a basic AI sanity
// pass". Tune via env at deploy time.
export const USABLE_THRESHOLD = 5.5;

export function computeWidgetTier(usableCount: number): 1 | 2 | 3 {
  if (usableCount >= 5) return 1;
  if (usableCount >= 2) return 2;
  return 3;
}
