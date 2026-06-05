// VTO render — provider-agnostic, mirroring the Brain + Embeddings pattern.
//
// Today (Sprint 6 / D34):
//   • Gemini 2.5 Flash Image — DEFAULT. Free at quota, no new env, 4-8s.
//     Garment fidelity is "reimagining" not pixel-perfect — labelled
//     "Style Preview" in the UI to keep the claim honest.
//   • Replicate IDM-VTON — STUB. Throws `replicate_not_configured` until
//     REPLICATE_API_TOKEN lands. Real impl is one provider file away;
//     brand-side opt-in via Plan.planFeaturesJson.tryon.providerKey.
//
// Provider returns either a data URL (Gemini inline base64) OR an https URL
// (Replicate signed CDN). Server-side caller persists whichever it gets to
// TryOnSession.outputImageUrl — the widget treats both the same.

export type TryOnMode = "BODY_MODEL" | "PERSONAL_PHOTO";

// Body-model preset → garment-on-this-archetype prompt fragment. These IDs
// match the widget's MODELS array (apps/widget/src/index.ts). Provider impls
// translate the description into whichever prompt shape they want; the
// service layer only cares about the ID coming in.
export const BODY_MODEL_DESCRIPTIONS: Record<string, string> = {
  ava:   "petite woman, ~5'4\", slim build, soft shoulders, warm fair tone",
  lina:  "average-height woman, ~5'7\", balanced slim-regular build, medium tone",
  noor:  "tall woman, ~5'10\", lean athletic build, deeper warm tone",
  maya:  "curvy woman, ~5'6\", hourglass build, golden tone",
  zara:  "athletic woman, ~5'8\", broad shoulders narrow waist, cool tone",
  elena: "plus woman, ~5'7\", full hourglass build, fair-cool tone",
};

export interface TryOnProductHints {
  title: string;
  category?: string | null;
  primaryColor?: string | null;
  colorFamily?: string | null;
}

export interface TryOnRenderInput {
  mode: TryOnMode;
  // Garment reference — always required. Either a hosted image URL (preferred,
  // we send the URL to the provider so we don't proxy bytes) OR a data URL.
  garmentImageUrl: string;
  garmentMime?: string;             // when garmentImageUrl is a data URL

  // BODY_MODEL mode: which preset. PERSONAL_PHOTO mode: the shopper photo.
  modelHint?: string;               // BODY_MODEL only
  personImageBase64?: string;       // PERSONAL_PHOTO only — never persisted
  personImageMime?: string;         // PERSONAL_PHOTO only

  // BODY_MODEL mode: the muse archetype image to composite the garment ONTO.
  // When present, BODY_MODEL does real img2img garment-swap onto this muse
  // (same path as PERSONAL_PHOTO). When absent, BODY_MODEL falls back to the
  // legacy text-described-model path (a generic generated model — "style
  // preview" only). The app loads the muse PNG for `modelHint` and passes it.
  museImageBase64?: string;         // BODY_MODEL only — the archetype body image
  museImageMime?: string;           // BODY_MODEL only

  hints?: TryOnProductHints;        // text hints for the model's text branch
}

export interface TryOnRenderOutput {
  imageUrl: string;                 // data:image/...;base64,...  OR https://...
  mime: string;
}

export interface TryOnProvider {
  readonly key: string;             // "gemini-image" | "replicate-idm-vton"
  readonly model: string;
  readonly modelKey: string;        // "<provider>:<model>:<rev>"
  render(input: TryOnRenderInput): Promise<TryOnRenderOutput>;
}

export interface TryOnService {
  readonly provider: TryOnProvider;
  render(input: TryOnRenderInput): Promise<TryOnRenderOutput>;
}

// ─── Gemini 2.5 Flash Image provider (default) ─────────────────────────
// Uses the same Generative Language API the chat Brain hits. Image generation
// endpoint accepts multimodal input + returns a base64 image in the response.
//
// Honest framing: this is "reimagine the garment on this body" not "preserve
// the SKU pixel-for-pixel." The Widget labels it "Style Preview." See D34.
export function createGeminiImageTryOnProvider(opts: {
  apiKey: string;
  model?: string;                   // default: gemini-2.5-flash-image-preview
  fetchImpl?: typeof fetch;
}): TryOnProvider {
  const model = opts.model ?? "gemini-2.5-flash-image-preview";
  const f = opts.fetchImpl ?? fetch;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  function buildPrompt(input: TryOnRenderInput): string {
    const garment = input.hints?.title
      ? `${input.hints.title}${input.hints.category ? ` (${input.hints.category})` : ""}${input.hints.primaryColor ? `, ${input.hints.primaryColor}` : ""}`
      : "the garment in the reference image";

    if (input.mode === "BODY_MODEL") {
      // Real composite path: a muse archetype image was supplied → dress THAT
      // body in the garment (true img2img garment-swap, identity preserved).
      if (input.museImageBase64) {
        return [
          `Generate a full-body editorial photograph of the person in the second image wearing ${garment} from the first image.`,
          "Preserve the person's face, body proportions, hair, skin tone, and pose exactly — do not change the model, only dress them in the garment.",
          "Preserve the garment's silhouette, color, and key details from the reference.",
          "Studio neutral grey backdrop, soft directional lighting, full body framed head to mid-calf.",
          "No text, no logos other than what is on the garment, no watermark.",
          "Photorealistic, editorial fashion aesthetic.",
        ].join(" ");
      }
      // Fallback: no muse image → legacy text-described generic model ("style preview").
      const desc = (input.modelHint && BODY_MODEL_DESCRIPTIONS[input.modelHint])
        || BODY_MODEL_DESCRIPTIONS.lina!;
      return [
        `Generate a single full-body fashion photograph: a ${desc} wearing ${garment}.`,
        "Studio neutral grey backdrop, soft directional editorial lighting, full body framed head to mid-calf, three-quarter pose, calm expression.",
        "Preserve the garment's silhouette, color, and key details from the reference image.",
        "No text, no logos other than what is on the garment, no watermark.",
        "Photorealistic, editorial fashion aesthetic.",
      ].join(" ");
    }
    // PERSONAL_PHOTO
    return [
      `Generate a full-body editorial photograph of the person in the second image wearing ${garment} from the first image.`,
      "Preserve the person's face, body proportions, hair, and skin tone exactly.",
      "Preserve the garment's silhouette, color, and key details from the reference.",
      "Studio neutral grey backdrop, soft directional lighting, three-quarter pose.",
      "No text, no logos other than what is on the garment, no watermark.",
      "Photorealistic, editorial fashion aesthetic.",
    ].join(" ");
  }

  async function urlToInlineData(url: string): Promise<{ mimeType: string; data: string }> {
    if (url.startsWith("data:")) {
      const m = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) throw new Error("tryon_bad_data_url");
      return { mimeType: m[1]!, data: m[2]! };
    }
    const res = await f(url);
    if (!res.ok) throw new Error(`tryon_garment_fetch_${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    return { mimeType, data: buf.toString("base64") };
  }

  return {
    key: "gemini-image",
    model,
    modelKey: `gemini-image:${model}:v1`,
    async render(input) {
      const prompt = buildPrompt(input);
      const garment = await urlToInlineData(input.garmentImageUrl);

      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        { text: prompt },
        { inlineData: garment },
      ];

      if (input.mode === "PERSONAL_PHOTO") {
        if (!input.personImageBase64 || !input.personImageMime) {
          throw new Error("tryon_no_person_image");
        }
        const personData = input.personImageBase64.startsWith("data:")
          ? (input.personImageBase64.split(",", 2)[1] ?? "")
          : input.personImageBase64;
        parts.push({ inlineData: { mimeType: input.personImageMime, data: personData } });
      } else if (input.mode === "BODY_MODEL" && input.museImageBase64) {
        // Real composite: send the muse archetype image as the "person" so the
        // model dresses that body in the garment (img2img), not a text-generated one.
        const museData = input.museImageBase64.startsWith("data:")
          ? (input.museImageBase64.split(",", 2)[1] ?? "")
          : input.museImageBase64;
        parts.push({ inlineData: { mimeType: input.museImageMime || "image/png", data: museData } });
      }

      const res = await f(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`tryon_http_${res.status}: ${t.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> } }>;
      };
      const image = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (!image?.data) throw new Error("tryon_no_image_in_response");
      return {
        imageUrl: `data:${image.mimeType};base64,${image.data}`,
        mime: image.mimeType,
      };
    },
  };
}

// ─── Replicate IDM-VTON provider ───────────────────────────────────────
// Uses the fofr/idm-vton model on Replicate with the same polling pattern as
// createReplicateCatVtonProvider. If apiToken is absent, throws
// replicate_not_configured at render time (construction succeeds so the
// provider can be registered regardless).
export function createReplicateIdmVtonProvider(opts: {
  apiToken?: string;
  model?: string;      // defaults to "fofr/idm-vton"
}): TryOnProvider {
  const modelId = opts.model ?? "fofr/idm-vton";

  return {
    key: "replicate-idm-vton",
    model: modelId,
    modelKey: `replicate-idm-vton:${modelId}`,

    async render(input) {
      if (!opts.apiToken) {
        throw new Error("replicate_not_configured: set REPLICATE_API_TOKEN to use the IDM-VTON provider");
      }
      const apiToken = opts.apiToken;

      // PERSONAL_PHOTO: use the shopper's photo as human_img.
      // BODY_MODEL: no person image available; use garment URL as placeholder
      // (IDM-VTON still needs a human_img — pass garment as a safe fallback so
      // the model doesn't 400; operators should prefer PERSONAL_PHOTO mode for IDM-VTON).
      const humanImgUrl = input.personImageBase64
        ? `data:${input.personImageMime ?? "image/jpeg"};base64,${input.personImageBase64}`
        : input.garmentImageUrl;

      // POST prediction to Replicate — same pattern as createReplicateCatVtonProvider.
      const predictionRes = await fetch(`https://api.replicate.com/v1/models/${modelId}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: {
            human_img:      humanImgUrl,
            garm_img:       input.garmentImageUrl,
            garment_des:    input.hints?.title ?? "garment",
            is_checked:     false,
            is_checked_crop: false,
            denoise_steps:  30,
            seed:           42,
          },
        }),
      });

      if (!predictionRes.ok) {
        const err = await predictionRes.text().catch(() => predictionRes.statusText);
        throw new Error(`replicate_idm_vton_http_${predictionRes.status}: ${err.slice(0, 200)}`);
      }

      const prediction = await predictionRes.json() as { id?: string };
      const predId = prediction.id;
      if (!predId) throw new Error("replicate_idm_vton_no_pred_id");

      // Poll for result — max 120 s, every 3 s (IDM-VTON is heavier than CatVTON).
      const start = Date.now();
      while (Date.now() - start < 120_000) {
        await new Promise<void>((r) => setTimeout(r, 3_000));
        const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predId}`, {
          headers: { Authorization: `Token ${apiToken}` },
        });
        if (!pollRes.ok) continue;
        const poll = await pollRes.json() as {
          status: string;
          output?: string | string[];
          error?: string;
        };

        if (poll.status === "succeeded") {
          // IDM-VTON returns an array; take first element.
          const outputUrl = Array.isArray(poll.output) ? poll.output[0] : poll.output;
          if (!outputUrl) throw new Error("replicate_idm_vton_no_output");
          // Fetch and return as base64 so callers get a data URL (same as Gemini path).
          const imgRes = await fetch(outputUrl);
          if (!imgRes.ok) throw new Error(`replicate_idm_vton_output_fetch_${imgRes.status}`);
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const mime = imgRes.headers.get("content-type") ?? "image/webp";
          return {
            imageUrl: `data:${mime};base64,${buf.toString("base64")}`,
            mime,
          };
        }

        if (poll.status === "failed" || poll.status === "canceled") {
          throw new Error(`replicate_idm_vton_${poll.status}: ${poll.error ?? "unknown"}`);
        }
        // status === "processing" | "starting" — keep polling
      }
      throw new Error("replicate_idm_vton_timeout: prediction did not complete within 120 s");
    },
  };
}

// ─── Replicate CatVTON provider (D38a — new default) ───────────────────
// Uses IDM-VTON (cuuupid/idm-vton) on Replicate for real garment try-on.
// ~$0.012/render, 10-15s latency, no preview allowlist.
//
// Why this is the new default (per D38a):
//   • 3.3× cheaper than Vertex VTO-001 ($0.012 vs $0.04)
//   • No preview allowlist — instant Replicate signup
//   • Mature endpoint, predictable latency (~10-15s, queue-dependent)
//   • Quality is "good real VTO" — preserves garment well, slightly
//     weaker than VTO-001 on intricate prints / tiny logos
//   • Vertex VTO-001 stays available as a Growth+/Ultimate opt-in via
//     Plan.planFeaturesJson.tryon.providerKey = "vertex-vto-001"
export function createReplicateCatVtonProvider(opts: {
  apiToken: string;
  model?: string;          // defaults to "cuuupid/idm-vton" — IDM-VTON on Replicate
}): TryOnProvider {
  const modelId = opts.model ?? "cuuupid/idm-vton";

  return {
    key: "replicate-catvton",
    model: modelId,
    modelKey: `replicate-catvton:${modelId}`,

    async render(input) {
      // For PERSONAL_PHOTO: convert base64 to data URL for the API.
      const personImageUrl = input.personImageBase64
        ? `data:${input.personImageMime ?? "image/jpeg"};base64,${input.personImageBase64}`
        : null;

      // IDM-VTON on Replicate expects human_img + garm_img.
      const predictionRes = await fetch(`https://api.replicate.com/v1/models/${modelId}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Token ${opts.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: {
            human_img: personImageUrl ?? input.garmentImageUrl,
            garm_img: input.garmentImageUrl,
            garment_des: input.hints?.title ?? "garment",
            is_checked: true,
            is_checked_crop: false,
            denoise_steps: 30,
            seed: 42,
          },
        }),
      });

      if (!predictionRes.ok) {
        const err = await predictionRes.text().catch(() => predictionRes.statusText);
        throw new Error(`Replicate prediction failed: ${predictionRes.status} ${err.slice(0, 200)}`);
      }

      const prediction = await predictionRes.json() as { id?: string };
      const predId = prediction.id;
      if (!predId) throw new Error("No prediction id from Replicate");

      // Poll for result (max 60s).
      const start = Date.now();
      while (Date.now() - start < 60000) {
        await new Promise<void>((r) => setTimeout(r, 2500));
        const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predId}`, {
          headers: { Authorization: `Token ${opts.apiToken}` },
        });
        if (!pollRes.ok) continue;
        const poll = await pollRes.json() as {
          status: string;
          output?: string | string[];
          error?: string;
        };
        if (poll.status === "succeeded") {
          const outputUrl = Array.isArray(poll.output) ? poll.output[0] : poll.output;
          if (!outputUrl) throw new Error("Replicate succeeded but no output URL");
          return { imageUrl: outputUrl, mime: "image/webp" };
        }
        if (poll.status === "failed" || poll.status === "canceled") {
          throw new Error(`Replicate prediction ${poll.status}: ${poll.error ?? "unknown"}`);
        }
        // status === "processing" | "starting" — keep polling
      }
      throw new Error("Replicate prediction timed out after 60s");
    },
  };
}

// ─── Vertex VTO-001 — premium engine (parked behind GCP credentials) ───
// The real implementation lives in vertex.ts to keep this file from
// growing past readable size and to make the JWT-signing helpers
// self-contained. Re-exported here so the provider router in
// apps/shopify-app/app/lib/tryon.server.ts can pick it up alongside
// the other providers.
export { createVertexVtoProvider, type VertexVtoConfig, createVertexNanaBananaProvider, type VertexNanaBananaConfig } from "./vertex.js";

// ─── Lite-local Python VTO provider ───────────────────────────────────
// Delegates to the stylique-lite-tryon FastAPI engine running locally
// (or at a configurable endpoint). Uses the /tryon/front/upload multipart
// route which accepts user_file + optional product_file.
//
// BODY_MODEL mode: only garment image is posted (no person image). The
// Python engine composites onto a generic body silhouette.
// PERSONAL_PHOTO mode: both person image and garment image are posted.
//
// Response shape: TryOnResponse → output_image_path (server-relative path).
// We follow up with a GET /tryon/output/<filename> to fetch the bytes and
// return them as base64. If the service is unreachable the throw propagates
// to the failover chain in the worker.
export function createLiteLocalProvider(opts?: { endpoint?: string }): TryOnProvider {
  const base = (opts?.endpoint ?? "http://localhost:8000").replace(/\/$/, "");

  async function fetchImageAsBase64(imageUrl: string): Promise<{ data: string; mimeType: string }> {
    if (imageUrl.startsWith("data:")) {
      const m = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) throw new Error("tryon_bad_data_url");
      return { mimeType: m[1]!, data: m[2]! };
    }
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`tryon_garment_fetch_${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    return { mimeType, data: buf.toString("base64") };
  }

  return {
    key: "lite-local",
    model: "lite-local-v0",
    modelKey: "lite-local:lite-local-v0:v0",

    async render(input) {
      const garment = await fetchImageAsBase64(input.garmentImageUrl);

      const form = new FormData();

      // Garment image — always required.
      const garmentBlob = new Blob(
        [new Uint8Array(Buffer.from(garment.data, "base64"))],
        { type: garment.mimeType },
      );
      // product_file is the garment in the upload endpoint's terminology
      form.append("product_file", garmentBlob, "garment.png");

      if (input.mode === "PERSONAL_PHOTO") {
        if (!input.personImageBase64) {
          throw new Error("tryon_no_person_image");
        }
        const personData = input.personImageBase64.startsWith("data:")
          ? (input.personImageBase64.split(",", 2)[1] ?? "")
          : input.personImageBase64;
        const personBlob = new Blob(
          [new Uint8Array(Buffer.from(personData, "base64"))],
          { type: input.personImageMime ?? "image/jpeg" },
        );
        form.append("user_file", personBlob, "person.jpg");
      } else {
        // BODY_MODEL — post a 1×1 transparent PNG as the user_file placeholder;
        // the Python engine only needs the product for body-model compositing.
        const placeholder = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        );
        form.append("user_file", new Blob([new Uint8Array(placeholder)], { type: "image/png" }), "placeholder.png");
      }

      let res: Response;
      try {
        res = await fetch(`${base}/tryon/front/upload`, {
          method: "POST",
          body: form,
        });
      } catch (err) {
        // Network error (service unreachable) — propagate so failover chain kicks in.
        throw new Error(`lite_local_unreachable: ${(err as Error).message}`);
      }

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`lite_local_http_${res.status}: ${t.slice(0, 200)}`);
      }

      const json = (await res.json()) as { output_image_path?: string };
      const outputPath = json.output_image_path;
      if (!outputPath) throw new Error("lite_local_no_output_path");

      // Extract just the filename from the server-relative path.
      const filename = outputPath.split(/[\\/]/).pop();
      if (!filename) throw new Error("lite_local_bad_output_path");

      // Fetch the rendered image bytes.
      const imgRes = await fetch(`${base}/tryon/output/${encodeURIComponent(filename)}`);
      if (!imgRes.ok) throw new Error(`lite_local_output_fetch_${imgRes.status}`);

      const imgBuf = Buffer.from(await imgRes.arrayBuffer());
      const imgMime = imgRes.headers.get("content-type") ?? "image/png";
      const imgBase64 = imgBuf.toString("base64");

      return {
        imageUrl: `data:${imgMime};base64,${imgBase64}`,
        mime: imgMime,
      };
    },
  };
}

// ─── Service factory ───────────────────────────────────────────────────
export function createTryOnService(provider: TryOnProvider): TryOnService {
  return {
    provider,
    render: (input) => provider.render(input),
  };
}
