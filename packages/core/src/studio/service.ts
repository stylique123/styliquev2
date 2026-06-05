// Creative Studio — provider-agnostic image generation service.
//
// Mirrors the pattern set by:
//   • packages/core/src/tryon/service.ts (VTO providers)
//   • packages/core/src/embeddings/service.ts
//   • packages/core/src/imagery/studio.ts (background remover providers)
//
// A `CreativeProvider` accepts a brief + brand reference assets and returns
// generated image bytes (or a hosted URL). Providers are interchangeable;
// the creative-set worker picks one via Plan.planFeaturesJson.studio.providerKey
// with env-driven default `STUDIO_PROVIDER` (defaults to `vertex-imagen`).
//
// Why provider-agnostic — see CLAUDE.md D11/D12/D34: every other surface in
// Stylique uses this pattern so we can swap GCP credits ↔ Replicate cash
// without touching call sites.

import type { ServiceAccountKey } from "../vertex/auth.js";

// ───────────────────────────────────────────────────────────────────────
// Output kind taxonomy — mirrors the CreativeKindRecipe plan in the
// strategy doc. Each kind maps to (aspect ratio × count × prompt template).
// ───────────────────────────────────────────────────────────────────────

export type CreativeOutputKind =
  // ── Existing ──────────────────────────────────────────────────────────
  | "PDP_PRODUCT"            // 4-5 on-brand product shots on neutral/brand backdrop, 1:1
  | "PDP_LIFESTYLE"          // 3 model-wearing-in-scene shots, 4:5
  | "CAMPAIGN_HERO"          // editorial set across 1:1, 4:5, 9:16, 16:9
  | "CAROUSEL_SET"           // 5-slide IG carousel layout, 1:1
  | "STORY_VIDEO"            // 6-15s vertical clip (Veo video provider), 9:16
  | "LOOKBOOK_SPREAD"        // 6-page editorial PDF (composed from images), 4:5
  // ── Social ────────────────────────────────────────────────────────────
  | "INSTAGRAM_POST"         // 1:1, 3 images — optimized for IG feed
  | "INSTAGRAM_CAROUSEL"     // 1:1, 8 images — cohesive swipe-through set
  | "INSTAGRAM_STORY"        // 9:16, 3 images — vertical story frames (Veo capable)
  | "WHATSAPP_STATUS"        // 9:16, 3 images — broadcast channel content (Veo capable)
  | "REELS_COVER"            // 9:16, 1 image — Reels thumbnail (Veo capable)
  // ── Email ─────────────────────────────────────────────────────────────
  | "EMAIL_HEADER"           // 3:1 aspect (600px wide editorial), 2 images
  // ── Product photography ────────────────────────────────────────────────
  | "FLAT_LAY"               // 1:1, 4 images — overhead product flat-lay style
  | "GHOST_MANNEQUIN"        // 4:5, 2 images — invisible mannequin product shots
  | "WHOLESALE_CATALOG_PAGE" // 4:3, 4 images — clean white bg, product centered
  // ── Lookbook (special: PDF pipeline, not direct image gen) ────────────
  | "LOOKBOOK_PDF";          // triggers PDF generation pipeline, not image generation

export type CreativeAspectRatio = "1:1" | "4:5" | "16:9" | "9:16" | "3:4" | "3:1" | "4:3";

// ───────────────────────────────────────────────────────────────────────
// Kind → default aspect + count tables.
// ───────────────────────────────────────────────────────────────────────

export const DEFAULT_ASPECT: Record<CreativeOutputKind, CreativeAspectRatio> = {
  // Existing
  PDP_PRODUCT:    "1:1",
  PDP_LIFESTYLE:  "4:5",
  CAMPAIGN_HERO:  "16:9",
  CAROUSEL_SET:   "1:1",
  STORY_VIDEO:    "9:16",
  LOOKBOOK_SPREAD: "4:5",
  // Social
  INSTAGRAM_POST:      "1:1",
  INSTAGRAM_CAROUSEL:  "1:1",
  INSTAGRAM_STORY:     "9:16",
  WHATSAPP_STATUS:     "9:16",
  REELS_COVER:         "9:16",
  // Email
  EMAIL_HEADER: "3:1",
  // Product photography
  FLAT_LAY:               "1:1",
  GHOST_MANNEQUIN:        "4:5",
  WHOLESALE_CATALOG_PAGE: "4:3",
  // Lookbook PDF (aspect not used by image provider, included for type completeness)
  LOOKBOOK_PDF: "4:5",
};

export const DEFAULT_COUNT: Record<CreativeOutputKind, number> = {
  // Existing
  PDP_PRODUCT:    4,
  PDP_LIFESTYLE:  3,
  CAMPAIGN_HERO:  1,
  CAROUSEL_SET:   5,
  STORY_VIDEO:    1,
  LOOKBOOK_SPREAD: 6,
  // Social
  INSTAGRAM_POST:      3,
  INSTAGRAM_CAROUSEL:  8,
  INSTAGRAM_STORY:     3,
  WHATSAPP_STATUS:     3,
  REELS_COVER:         1,
  // Email
  EMAIL_HEADER: 2,
  // Product photography
  FLAT_LAY:               4,
  GHOST_MANNEQUIN:        2,
  WHOLESALE_CATALOG_PAGE: 4,
  // Lookbook PDF — no images generated directly; 0 here signals PDF pipeline
  LOOKBOOK_PDF: 0,
};

// ───────────────────────────────────────────────────────────────────────
// Per-kind prompt engineering.
// Returns a suffix that is appended to the main brand+product prompt before
// sending to the image provider. These are directive, not decorative.
// ───────────────────────────────────────────────────────────────────────

export function buildKindPromptSuffix(kind: CreativeOutputKind): string {
  switch (kind) {
    case "INSTAGRAM_POST":
      return "shot for Instagram feed, vibrant but editorial, optimized for mobile scroll-stop, strong focal point, high contrast";
    case "INSTAGRAM_CAROUSEL":
      return "cohesive visual series for Instagram carousel, consistent color treatment and composition across all frames, first frame most attention-grabbing";
    case "INSTAGRAM_STORY":
      return "vertical 9:16 format optimized for Instagram Stories, bold and immediate visual, text safe zone left clear at top and bottom 15%";
    case "WHATSAPP_STATUS":
      return "vertical 9:16 format for WhatsApp Status/Channel broadcast, simple clear visual with single focus, high contrast legibility on small screens";
    case "REELS_COVER":
      return "vertical 9:16 Reels thumbnail, bold and eye-catching, stops scroll, minimal or no text, strong expression or product close-up";
    case "EMAIL_HEADER":
      return "wide editorial banner format 3:1 aspect, minimal text space on left third, strong visual on right two-thirds, suitable for email newsletter header, elegant and clean";
    case "FLAT_LAY":
      return "overhead flat-lay photography, garments arranged artfully on clean surface, natural soft shadows, styled accessories if appropriate, editorial composition from directly above";
    case "GHOST_MANNEQUIN":
      return "invisible mannequin product shot, clean white or very light grey background, garment fully visible with natural structure preserved, professional technical product photography, no mannequin visible";
    case "WHOLESALE_CATALOG_PAGE":
      return "clean studio white background, product centered and well-lit, technical product photography, clear representation of fabric texture and construction, multiple complementary angles if multi-image";
    case "PDP_PRODUCT":
      return "on-brand product shot, neutral or brand-appropriate backdrop, clear product detail, professional lighting";
    case "PDP_LIFESTYLE":
      return "lifestyle editorial photograph, model wearing product in a relevant scene, natural authentic feel";
    case "CAMPAIGN_HERO":
      return "hero campaign image, bold editorial statement, brand-defining visual";
    case "CAROUSEL_SET":
      return "cohesive carousel set, consistent visual language across slides, designed to be swiped through";
    case "STORY_VIDEO":
      return "vertical video storyboard frame, dynamic and cinematic, optimized for mobile vertical viewing";
    case "LOOKBOOK_SPREAD":
      return "editorial lookbook page spread, high fashion photography style, strong art direction";
    case "LOOKBOOK_PDF":
      return ""; // PDF pipeline, no image suffix needed
    default: {
      // exhaustive check — TypeScript will error if a new kind is added without a case
      const _exhaustive: never = kind;
      return "";
    }
  }
}

// ───────────────────────────────────────────────────────────────────────
// Kinds that use the Veo video provider (when available) instead of Imagen.
// ───────────────────────────────────────────────────────────────────────

export const VIDEO_KINDS: ReadonlySet<CreativeOutputKind> = new Set([
  "STORY_VIDEO",
  "INSTAGRAM_STORY",
  "WHATSAPP_STATUS",
  "REELS_COVER",
]);

// ───────────────────────────────────────────────────────────────────────
// Brand DNA reference inputs the provider sees per call.
// ───────────────────────────────────────────────────────────────────────

export type BrandReferenceAsset = {
  url: string;           // any URL or data: URI
  kind?: "campaign" | "pdp" | "instagram" | "uploaded" | "logo";
  weight?: number;       // 0..1, optional emphasis hint
};

export type BrandStyleHints = {
  paletteHex?: string[];        // ["#1a1a1a", "#e8d5b7", ...]
  moodAdjectives?: string[];    // ["editorial", "warm", "minimal"]
  lighting?: string;            // "soft natural" / "golden hour" / "clinical studio"
  modelArchetype?: string;      // "editorial" / "lifestyle" / "streetwear" / "luxe"
  composition?: string;         // free-text composition hint
};

// ───────────────────────────────────────────────────────────────────────
// Provider IO contract.
// ───────────────────────────────────────────────────────────────────────

export type CreativeRenderInput = {
  /** Free-text brief from the brand admin or auto-derived from product. */
  prompt: string;
  /** Optional product context — the SKU this creative is for. */
  product?: {
    title: string;
    category?: string | null;
    primaryColor?: string | null;
    garmentImageUrl?: string | null;  // for product-preserving prompts
  };
  /** Brand DNA — references + structured style hints from BrandProfile. */
  brand?: {
    referenceAssets?: BrandReferenceAsset[];
    style?: BrandStyleHints;
  };
  /** Output spec. */
  output: {
    kind: CreativeOutputKind;
    aspectRatio: CreativeAspectRatio;
    count: number;                  // how many variations to generate
  };
  /** Optional safety + brand-fit overrides. */
  config?: {
    seed?: number;
    negativePrompt?: string;
  };
};

export type CreativeRenderOutput = {
  /** One entry per generated image or video frame. */
  images: Array<{
    /** Inline base64 (data: URI) OR a hosted URL — caller decides where to persist. */
    image: string;
    mimeType: string;
    seed?: number;
    /** Width in pixels (populated by video provider). */
    width?: number;
    /** Height in pixels (populated by video provider). */
    height?: number;
  }>;
  providerKey: string;        // "vertex-imagen" / "vertex-veo" / "replicate-flux" / "stub"
  latencyMs: number;
};

export type CreativeProvider = {
  key: string;
  render(input: CreativeRenderInput): Promise<CreativeRenderOutput>;
};

// ───────────────────────────────────────────────────────────────────────
// Stub provider — used when no real provider is configured (dev path).
// Returns a 1x1 transparent PNG so the worker pipeline still completes.
// ───────────────────────────────────────────────────────────────────────

const TRANSPARENT_PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export function createStubCreativeProvider(): CreativeProvider {
  return {
    key: "stub",
    async render(input) {
      const start = Date.now();
      const count = Math.max(1, Math.min(5, input.output.count));
      return {
        images: Array.from({ length: count }, () => ({
          image: `data:image/png;base64,${TRANSPARENT_PNG_1x1}`,
          mimeType: "image/png",
        })),
        providerKey: "stub",
        latencyMs: Date.now() - start,
      };
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Vertex AI Imagen 3 provider — primary, GCP-credits-funded.
//
// Two paths inside one provider:
//   1. NO reference assets → imagegeneration@006 text-to-image
//   2. WITH reference assets → Imagen Customization (subject + style refs
//      at inference time, no LoRA training needed).
//
// Model picks:
//   • imagegeneration@006 — current production text-to-image (Imagen 3)
//   • imagen-3.0-capability-001 — customization endpoint
//
// Reference: https://cloud.google.com/vertex-ai/generative-ai/docs/image/customize-image
// ───────────────────────────────────────────────────────────────────────

export type VertexImagenConfig = {
  serviceAccountJson: string;     // raw JSON string from VERTEX_SERVICE_ACCOUNT_JSON env
  projectId?: string;             // defaults to service-account project_id
  location?: string;              // defaults "us-central1"
  generateModel?: string;         // defaults "imagegeneration@006"
  customizeModel?: string;        // defaults "imagen-3.0-capability-001"
  fetchImpl?: typeof fetch;
};

/** Map our aspect ratios to Imagen's supported set. */
function imagenAspect(ratio: CreativeAspectRatio): string {
  // Imagen 3 supports: "1:1", "9:16", "16:9", "3:4", "4:3"
  if (ratio === "4:5") return "3:4"; // closest match
  if (ratio === "3:1") return "16:9"; // closest match (wide banner)
  return ratio;
}

/** Compose the final prompt with brand style hints and kind suffix. */
function composeBrandPrompt(input: CreativeRenderInput): string {
  const parts: string[] = [];
  const style = input.brand?.style;

  if (style?.modelArchetype) parts.push(`${style.modelArchetype} fashion`);
  if (style?.lighting) parts.push(`${style.lighting} lighting`);
  if (style?.moodAdjectives?.length) parts.push(style.moodAdjectives.slice(0, 4).join(", "));
  if (style?.composition) parts.push(style.composition);
  if (style?.paletteHex?.length) {
    parts.push(`palette: ${style.paletteHex.slice(0, 4).join(" ")}`);
  }

  const stylePrefix = parts.length ? `${parts.join(", ")}. ` : "";
  const kindSuffix = buildKindPromptSuffix(input.output.kind);
  const base = stylePrefix + input.prompt;
  return kindSuffix ? `${base}. ${kindSuffix}` : base;
}

export function createVertexImagenProvider(config: VertexImagenConfig): CreativeProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const location = config.location ?? "us-central1";
  const generateModel = config.generateModel ?? "imagegeneration@006";
  const customizeModel = config.customizeModel ?? "imagen-3.0-capability-001";

  // Parse SA once at construction — fail fast if env is malformed.
  // Imports kept lazy so the bundle still tree-shakes when only the stub is used.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseServiceAccount, getVertexAccessToken, vertexPredictUrl, urlToBase64 } =
    require("../vertex/auth.js") as typeof import("../vertex/auth.js");
  const sa = parseServiceAccount(config.serviceAccountJson);
  const projectId = config.projectId ?? sa.project_id;

  return {
    key: "vertex-imagen",
    async render(input) {
      const start = Date.now();
      const count = Math.max(1, Math.min(4, input.output.count));
      const prompt = composeBrandPrompt(input);
      const aspect = imagenAspect(input.output.aspectRatio);
      const refs = input.brand?.referenceAssets ?? [];

      const token = await getVertexAccessToken(sa, fetchImpl);
      const useCustomize = refs.length > 0;
      const model = useCustomize ? customizeModel : generateModel;
      const url = vertexPredictUrl(projectId, location, model);

      // Build instances + parameters per Vertex Imagen spec.
      let instances: unknown;

      if (useCustomize) {
        const refImages = await Promise.all(
          refs.slice(0, 4).map(async (r, idx) => {
            const { data } = await urlToBase64(r.url, fetchImpl);
            const isSubject = r.kind === "pdp" || r.kind === "logo";
            return {
              referenceType: isSubject ? "REFERENCE_TYPE_SUBJECT" : "REFERENCE_TYPE_STYLE",
              referenceId: idx + 1,
              referenceImage: { bytesBase64Encoded: data },
            };
          }),
        );
        instances = [{ prompt, referenceImages: refImages }];
      } else {
        instances = [{ prompt }];
      }

      const parameters: Record<string, unknown> = {
        sampleCount: count,
        aspectRatio: aspect,
        // Safe defaults — block obvious violations, allow editorial fashion.
        safetySetting: "block_only_high",
        personGeneration: "allow_adult",
      };
      if (input.config?.seed !== undefined) parameters.seed = input.config.seed;
      if (input.config?.negativePrompt) parameters.negativePrompt = input.config.negativePrompt;

      const body = { instances, parameters };

      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const bodyTxt = await res.text().catch(() => "");
        throw new Error(`vertex_imagen_${res.status}: ${bodyTxt.slice(0, 200)}`);
      }

      const json = (await res.json()) as {
        predictions?: Array<{
          bytesBase64Encoded?: string;
          mimeType?: string;
          raiFilteredReason?: string;
        }>;
      };

      const predictions = json.predictions ?? [];
      const images = predictions
        .filter((p) => p.bytesBase64Encoded)
        .map((p) => ({
          image: `data:${p.mimeType ?? "image/png"};base64,${p.bytesBase64Encoded}`,
          mimeType: p.mimeType ?? "image/png",
        }));

      if (images.length === 0) {
        const filterReason = predictions.find((p) => p.raiFilteredReason)?.raiFilteredReason;
        throw new Error(
          filterReason
            ? `vertex_imagen_filtered: ${filterReason.slice(0, 100)}`
            : "vertex_imagen_no_predictions",
        );
      }

      return {
        images,
        providerKey: "vertex-imagen",
        latencyMs: Date.now() - start,
      };
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Vertex Veo 2/3 video provider — for STORY_VIDEO, INSTAGRAM_STORY,
// WHATSAPP_STATUS, REELS_COVER kinds.
//
// Endpoint: POST /{location}-aiplatform.googleapis.com/v1/projects/{project}/
//           locations/{location}/publishers/google/models/{model}:predictLongRunning
//
// Returns a long-running operation (LRO). Poll GET /{operationName} every
// 5s up to 120s until `done: true`. Extract video from
// response.videos[0].bytesBase64Encoded.
//
// Output is returned as `data:video/mp4;base64,...` so the worker's
// persistImage can handle it the same way as images.
//
// Reference: https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos
// ───────────────────────────────────────────────────────────────────────

export type VertexVeoConfig = {
  serviceAccountJson: string;
  projectId?: string;
  location?: string;       // defaults "us-central1"
  modelVersion?: "veo-2" | "veo-3"; // defaults "veo-2"
  durationSeconds?: number; // defaults 5
  fetchImpl?: typeof fetch;
};

/** Build the Veo long-running predict URL. */
function veoLroUrl(projectId: string, location: string, model: string): string {
  return (
    `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}` +
    `/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:predictLongRunning`
  );
}

/** Build the Vertex operations poll URL. */
function vertexOperationUrl(location: string, operationName: string): string {
  // operationName is the full resource path from the response, e.g.
  // "projects/.../locations/.../operations/<id>"
  // The poll endpoint mirrors it under the regional host.
  return `https://${location}-aiplatform.googleapis.com/v1/${operationName}`;
}

/** Convert our aspect ratio to Veo-supported string. */
function veoAspect(ratio: CreativeAspectRatio): string {
  // Veo 2 supports "9:16", "16:9", "1:1", "4:3", "3:4"
  if (ratio === "3:1") return "16:9";
  if (ratio === "4:5") return "3:4";
  return ratio;
}

export function createVertexVeoProvider(config: VertexVeoConfig): CreativeProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const location = config.location ?? "us-central1";
  const modelVersion = config.modelVersion ?? "veo-2";
  const durationSeconds = config.durationSeconds ?? 5;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseServiceAccount, getVertexAccessToken } =
    require("../vertex/auth.js") as typeof import("../vertex/auth.js");
  const sa = parseServiceAccount(config.serviceAccountJson);
  const projectId = config.projectId ?? sa.project_id;

  return {
    key: "vertex-veo",
    async render(input) {
      const start = Date.now();
      const prompt = composeBrandPrompt(input);
      const aspectRatio = veoAspect(input.output.aspectRatio);

      const token = await getVertexAccessToken(sa, fetchImpl);
      const lroUrl = veoLroUrl(projectId, location, modelVersion);

      // Build Veo request body.
      const veoInstances: Array<{ prompt: string; image?: { bytesBase64Encoded: string } }> = [
        { prompt },
      ];

      // If there's a garment image reference, pass it as the first frame hint.
      if (input.product?.garmentImageUrl) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { urlToBase64 } =
            require("../vertex/auth.js") as typeof import("../vertex/auth.js");
          const { data } = await urlToBase64(input.product.garmentImageUrl, fetchImpl);
          veoInstances[0]!.image = { bytesBase64Encoded: data };
        } catch {
          // Non-fatal — generate without reference frame
        }
      }

      const veoBody = {
        instances: veoInstances,
        parameters: {
          aspectRatio,
          sampleCount: 1,
          durationSeconds,
          enhancePrompt: true,
        },
      };

      // 1. Submit LRO.
      const submitRes = await fetchImpl(lroUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(veoBody),
      });

      if (!submitRes.ok) {
        const bodyTxt = await submitRes.text().catch(() => "");
        throw new Error(`vertex_veo_submit_${submitRes.status}: ${bodyTxt.slice(0, 200)}`);
      }

      const submitJson = (await submitRes.json()) as { name?: string };
      const operationName = submitJson.name;
      if (!operationName) {
        throw new Error("vertex_veo_no_operation_name");
      }

      // 2. Poll until done (up to 120s).
      const pollUrl = vertexOperationUrl(location, operationName);
      const pollIntervalMs = 5_000;
      const pollTimeoutMs = 120_000;
      const t0 = Date.now();

      type VeoOperationResponse = {
        done?: boolean;
        error?: { code: number; message: string };
        response?: {
          videos?: Array<{
            bytesBase64Encoded?: string;
            mimeType?: string;
            width?: number;
            height?: number;
          }>;
        };
      };

      let videoBytes: string | null = null;
      let videoMime = "video/mp4";
      let videoWidth = 720;
      let videoHeight = 1280;

      while (Date.now() - t0 < pollTimeoutMs) {
        await new Promise<void>((r) => setTimeout(r, pollIntervalMs));

        const pollRes = await fetchImpl(pollUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!pollRes.ok) continue; // transient poll error — retry

        const poll: VeoOperationResponse = (await pollRes.json()) as VeoOperationResponse;

        if (poll.error) {
          throw new Error(`vertex_veo_operation_failed: ${poll.error.message.slice(0, 100)}`);
        }

        if (poll.done) {
          const video = poll.response?.videos?.[0];
          if (!video?.bytesBase64Encoded) {
            throw new Error("vertex_veo_no_video_bytes");
          }
          videoBytes = video.bytesBase64Encoded;
          videoMime = video.mimeType ?? "video/mp4";
          videoWidth = video.width ?? 720;
          videoHeight = video.height ?? 1280;
          break;
        }
      }

      if (!videoBytes) {
        throw new Error("vertex_veo_timeout");
      }

      return {
        images: [
          {
            image: `data:${videoMime};base64,${videoBytes}`,
            mimeType: videoMime,
            width: videoWidth,
            height: videoHeight,
          },
        ],
        providerKey: "vertex-veo",
        latencyMs: Date.now() - start,
      };
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Replicate FLUX 1.1-pro provider — kept as cash-fallback when Vertex
// credits are exhausted OR for brands that opt-in to FLUX quality.
// Mirrors the existing call in apps/worker/src/jobs/creative-set.ts so
// the worker can swap implementations without rewriting the polling loop.
// ───────────────────────────────────────────────────────────────────────

export type ReplicateFluxConfig = {
  apiToken: string;
  model?: string;                 // defaults "black-forest-labs/flux-1.1-pro"
  pollIntervalMs?: number;        // defaults 3000
  pollTimeoutMs?: number;         // defaults 120_000
  fetchImpl?: typeof fetch;
};

function fluxAspectDimensions(ratio: CreativeAspectRatio): { width: number; height: number } {
  switch (ratio) {
    case "1:1": return { width: 1024, height: 1024 };
    case "4:5": return { width: 896, height: 1120 };
    case "3:4": return { width: 896, height: 1184 };
    case "16:9": return { width: 1344, height: 768 };
    case "9:16": return { width: 768, height: 1344 };
    case "3:1": return { width: 1344, height: 448 };   // wide banner
    case "4:3": return { width: 1024, height: 768 };
    default: return { width: 1024, height: 1024 };
  }
}

export function createReplicateFluxProvider(config: ReplicateFluxConfig): CreativeProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const model = config.model ?? "black-forest-labs/flux-1.1-pro";
  const pollIntervalMs = config.pollIntervalMs ?? 3000;
  const pollTimeoutMs = config.pollTimeoutMs ?? 120_000;

  return {
    key: "replicate-flux",
    async render(input) {
      const start = Date.now();
      const count = Math.max(1, Math.min(4, input.output.count));
      const prompt = composeBrandPrompt(input);
      const { width, height } = fluxAspectDimensions(input.output.aspectRatio);

      const images: CreativeRenderOutput["images"] = [];

      // FLUX 1.1-pro doesn't accept a batch size > 1 — fire `count` predictions
      // sequentially. For higher batch use flux-schnell.
      for (let i = 0; i < count; i++) {
        const predRes = await fetchImpl(
          `https://api.replicate.com/v1/models/${model}/predictions`,
          {
            method: "POST",
            headers: {
              Authorization: `Token ${config.apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              input: {
                prompt,
                width,
                height,
                output_format: "webp",
                ...(input.config?.seed !== undefined ? { seed: input.config.seed + i } : {}),
              },
            }),
          },
        );

        if (!predRes.ok) {
          const text = await predRes.text().catch(() => predRes.statusText);
          throw new Error(`replicate_flux_${predRes.status}: ${text.slice(0, 200)}`);
        }

        const prediction = (await predRes.json()) as {
          id?: string;
          urls?: { get?: string };
        };
        const predId = prediction.id;
        const pollUrl = prediction.urls?.get ?? `https://api.replicate.com/v1/predictions/${predId}`;
        if (!predId) throw new Error("replicate_flux_no_prediction_id");

        // Poll.
        const t0 = Date.now();
        let outputUrl: string | null = null;
        while (Date.now() - t0 < pollTimeoutMs) {
          await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
          const pollRes = await fetchImpl(pollUrl, {
            headers: { Authorization: `Token ${config.apiToken}` },
          });
          if (!pollRes.ok) continue;
          const poll = (await pollRes.json()) as {
            status: string;
            output?: string | string[];
            error?: string;
          };
          if (poll.status === "succeeded") {
            outputUrl = Array.isArray(poll.output) ? poll.output[0]! : (poll.output ?? null);
            break;
          }
          if (poll.status === "failed" || poll.status === "canceled") {
            throw new Error(`replicate_flux_${poll.status}: ${(poll.error ?? "").slice(0, 100)}`);
          }
        }

        if (!outputUrl) throw new Error("replicate_flux_timeout");
        images.push({ image: outputUrl, mimeType: "image/webp" });
      }

      return {
        images,
        providerKey: "replicate-flux",
        latencyMs: Date.now() - start,
      };
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Provider factory — env + plan-driven resolution. Worker calls this once
// per job and gets back the right provider with sensible fallback chain:
//
//   Plan.tryon.providerKey override > STUDIO_PROVIDER env > vertex-imagen
//   if Vertex auth missing > replicate-flux if token set > stub.
//
// Video kinds (STORY_VIDEO, INSTAGRAM_STORY, WHATSAPP_STATUS, REELS_COVER):
//   When Vertex auth is present, prefer vertex-veo over vertex-imagen.
//   Falls back to stub if Veo is unavailable (no real image fallback for video).
// ───────────────────────────────────────────────────────────────────────

export type CreativeProviderResolution = {
  primary: CreativeProvider;
  fallback?: CreativeProvider;
};

export type ResolveCreativeProviderOptions = {
  /** Per-brand override from Plan.planFeaturesJson.studio.providerKey. */
  preferredKey?: string;
  /** Output kind — influences which provider is returned (video vs image). */
  kind?: CreativeOutputKind;
  /** Env (or test-injected). */
  env?: {
    STUDIO_PROVIDER?: string;
    VERTEX_SERVICE_ACCOUNT_JSON?: string;
    VERTEX_PROJECT_ID?: string;
    VERTEX_LOCATION?: string;
    REPLICATE_API_TOKEN?: string;
  };
};

export function resolveCreativeProvider(
  opts: ResolveCreativeProviderOptions = {},
): CreativeProviderResolution {
  const env = opts.env ?? (process.env as ResolveCreativeProviderOptions["env"]) ?? {};
  const requested = opts.preferredKey || env.STUDIO_PROVIDER || "vertex-imagen";
  const isVideoKind = opts.kind ? VIDEO_KINDS.has(opts.kind) : false;
  const allowStub =
    process.env.NODE_ENV !== "production" ||
    process.env.STYLIQUE_ALLOW_STUB_CREATIVE === "1" ||
    process.env.STYLIQUE_ALLOW_STUB_CREATIVE === "true";

  const buildVertex = (): CreativeProvider | null => {
    if (!env.VERTEX_SERVICE_ACCOUNT_JSON) return null;
    return createVertexImagenProvider({
      serviceAccountJson: env.VERTEX_SERVICE_ACCOUNT_JSON,
      projectId: env.VERTEX_PROJECT_ID,
      location: env.VERTEX_LOCATION,
    });
  };

  const buildVeo = (): CreativeProvider | null => {
    if (!env.VERTEX_SERVICE_ACCOUNT_JSON) return null;
    return createVertexVeoProvider({
      serviceAccountJson: env.VERTEX_SERVICE_ACCOUNT_JSON,
      projectId: env.VERTEX_PROJECT_ID,
      location: env.VERTEX_LOCATION,
    });
  };

  const buildReplicate = (): CreativeProvider | null => {
    if (!env.REPLICATE_API_TOKEN) return null;
    return createReplicateFluxProvider({ apiToken: env.REPLICATE_API_TOKEN });
  };

  // Video kinds: use Veo when possible — no Replicate fallback for video.
  if (isVideoKind) {
    const veo = buildVeo();
    if (veo) return { primary: veo };
    if (!allowStub) throw new Error("creative_provider_not_configured: VERTEX_SERVICE_ACCOUNT_JSON required for video creative");
    // No Veo → stub only in explicit local/demo mode.
    return { primary: createStubCreativeProvider() };
  }

  // Pick primary by requested key, fall back through the chain.
  let primary: CreativeProvider | null = null;
  if (requested === "vertex-imagen") primary = buildVertex();
  else if (requested === "vertex-veo") primary = buildVeo() ?? buildVertex(); // Veo → Imagen fallback for image jobs
  else if (requested === "replicate-flux") primary = buildReplicate();
  else if (requested === "stub" && allowStub) primary = createStubCreativeProvider();
  else if (requested === "stub") throw new Error("creative_stub_disabled_in_production");
  else primary = buildVertex() ?? buildReplicate();

  if (!primary) primary = buildVertex() ?? buildReplicate();
  if (!primary) {
    if (!allowStub) throw new Error("creative_provider_not_configured: set Vertex or Replicate envs");
    primary = createStubCreativeProvider();
  }

  // Fallback is whichever real image provider isn't primary, then stub.
  let fallback: CreativeProvider | undefined;
  if (primary.key === "vertex-imagen") fallback = buildReplicate() ?? undefined;
  else if (primary.key === "replicate-flux") fallback = buildVertex() ?? undefined;

  return { primary, fallback };
}
