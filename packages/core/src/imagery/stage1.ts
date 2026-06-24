// Stage 1 — free heuristic image filter (D37).
//
// Runs on every product image at sync time, costs $0, no external API.
// Per the Phase 1 brief: handles ~70-80% of bad images automatically.
// What we reject here never reaches Stage 2 (AWS Rekognition), saving
// per-call cost AND avoiding the case where Rekognition gives a high
// confidence score to a great photo of the wrong garment (a swatch shot
// is technically clear and well-lit — it just isn't a product photo).
//
// We try a HEAD request first to read dimensions + bytes cheaply. If the
// CDN doesn't return Content-Length / image dimensions in headers, we
// degrade to a partial GET (first ~64KB is enough for most image formats
// to expose dimensions in the file header). We never download the full
// image — that's Stage 2's budget, and only for survivors.

import type {
  ImageInput,
  ImageQualityProvider,
  ImageScore,
  QualityReason,
} from "./types.js";

// Filename pattern heuristics — Shopify merchants name images in
// predictable ways. These are NOT decisive on their own; they nudge the
// score and the inferred garmentRole.
const RX = {
  back:      /(_back|-back|back\.|_rear)/i,
  detail:    /(_detail|-detail|_close|_zoom|_macro|_swatch|_fabric|size[ -]?(chart|guide)|measurement|measurements|sizing)/i,
  lifestyle: /(_lifestyle|-lifestyle|_model|_editorial|_campaign|_lookbook)/i,
  swatch:    /(_swatch|-swatch|_color|_chip)/i,
  front:     /(front[ -]?(view|shot)?|packshot|product[ -]?(only|image|photo)|flat[ -]?lay)/i,
};

const MIN_LONG_EDGE_PX = 600;
const MAX_BYTES        = 8 * 1024 * 1024; // 8 MB
const SWATCH_MAX_BYTES = 30 * 1024;       // < 30 KB and small dims = swatch
const SWATCH_MAX_PX    = 400;
const ASPECT_OK_MIN    = 0.55;            // taller-than-wide is fine
const ASPECT_OK_MAX    = 1.55;            // wider-than-tall is borderline
const ASPECT_HARD_MIN  = 0.35;            // extreme portrait → detail crop
const ASPECT_HARD_MAX  = 2.5;             // extreme landscape → banner

type DimsAndBytes = {
  widthPx?: number;
  heightPx?: number;
  bytes?: number;
};

async function probeImage(url: string): Promise<DimsAndBytes> {
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) return {};
    const len = head.headers.get("content-length");
    const bytes = len ? Number(len) : undefined;
    // Shopify CDN exposes width/height in query params on transformed URLs;
    // try parsing them from `url` first (free, no extra round-trip).
    const w = pickIntFromUrl(url, /(?:_|x)(\d{3,4})x\d{0,4}(?:\.|$)/);
    const h = pickIntFromUrl(url, /(?:_|x)\d{0,4}x(\d{3,4})(?:\.|$)/);
    return {
      widthPx: w,
      heightPx: h,
      bytes: Number.isFinite(bytes) ? bytes : undefined,
    };
  } catch {
    return {};
  }
}

function pickIntFromUrl(url: string, re: RegExp): number | undefined {
  const m = url.match(re);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function scoreOne(input: ImageInput, dims: DimsAndBytes): ImageScore {
  const reasons: QualityReason[] = [];
  let score = 7.0; // starting baseline — anything that survives all checks
                   // gets a 7. Stage 2 (AWS) can lift to 10. Failures
                   // subtract; severe failures floor at 0.

  const filename = (input.shopifyFilename ?? input.url).toLowerCase();
  const altText = (input.altText ?? "").toLowerCase();
  const hints = `${filename} ${altText}`;
  let role: ImageScore["garmentRole"] | undefined;

  // Filename hints — small score nudge + role inference.
  if (RX.back.test(hints)) {
    reasons.push("filename_back_hint");
    role = "BACK";
    score += 0.5; // back shots are valuable for VTO
  } else if (RX.swatch.test(hints)) {
    reasons.push("filename_swatch_hint");
    role = "SWATCH";
    score -= 4.0;
  } else if (RX.detail.test(hints)) {
    reasons.push("suspected_detail_crop");
    role = "DETAIL";
    score -= 3.0;
  } else if (RX.lifestyle.test(hints)) {
    reasons.push("filename_lifestyle_hint");
    role = "LIFESTYLE";
    score -= 2.5;
  } else if (RX.front.test(hints)) {
    reasons.push("filename_front_hint");
    role = "FRONT";
    score += 0.5;
  } else {
    // No suffix = likely the front/primary shot.
    reasons.push("filename_front_hint");
    role = "FRONT";
  }

  // Dimensions — only enforce when we actually know them. Unknown dims
  // are not punished (don't penalize CDNs that strip headers).
  const longEdge =
    dims.widthPx && dims.heightPx ? Math.max(dims.widthPx, dims.heightPx) : undefined;
  const shortEdge =
    dims.widthPx && dims.heightPx ? Math.min(dims.widthPx, dims.heightPx) : undefined;
  const aspect =
    dims.widthPx && dims.heightPx ? dims.widthPx / dims.heightPx : undefined;

  if (longEdge !== undefined && longEdge < MIN_LONG_EDGE_PX) {
    reasons.push("too_small");
    score -= 4.0;
  }

  if (aspect !== undefined) {
    if (aspect < ASPECT_HARD_MIN || aspect > ASPECT_HARD_MAX) {
      reasons.push("aspect_ratio_out_of_band");
      score -= 5.0;
    } else if (aspect < ASPECT_OK_MIN || aspect > ASPECT_OK_MAX) {
      reasons.push("aspect_ratio_out_of_band");
      score -= 1.5;
    }
  }

  if (dims.bytes !== undefined && dims.bytes > MAX_BYTES) {
    reasons.push("too_large_filesize");
    // Don't reject — Stage 2 just won't score it. Cap at 4 so it falls
    // below the usable threshold but is fixable by re-encoding.
    score = Math.min(score, 4.0);
  }

  // Swatch detection — tiny dimensions + tiny bytes is almost always a
  // color swatch, regardless of filename.
  if (
    dims.bytes !== undefined &&
    dims.bytes < SWATCH_MAX_BYTES &&
    longEdge !== undefined &&
    shortEdge !== undefined &&
    longEdge <= SWATCH_MAX_PX &&
    shortEdge <= SWATCH_MAX_PX
  ) {
    if (!reasons.includes("suspected_swatch")) reasons.push("suspected_swatch");
    role = role ?? "SWATCH";
    score = Math.min(score, 1.5);
  }

  return {
    id: input.id,
    score: Math.max(0, Math.min(10, score)),
    reasons,
    garmentRole: role,
    widthPx: dims.widthPx,
    heightPx: dims.heightPx,
    bytes: dims.bytes,
  };
}

export function createStage1Provider(): ImageQualityProvider {
  return {
    key: "stage1",
    async score(images) {
      // Probe in parallel (HEAD requests are cheap). Cap concurrency at 8
      // to avoid hammering the CDN if a shop has thousands of products.
      const results: ImageScore[] = [];
      const queue = [...images];
      const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          const dims = await probeImage(next.url);
          results.push(scoreOne(next, dims));
        }
      });
      await Promise.all(workers);
      return results;
    },
  };
}
