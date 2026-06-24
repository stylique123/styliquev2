// Google Vertex AI Virtual Try-On (VTO-001) provider — purpose-built
// garment-swap model. Best quality of any hosted VTO API we evaluated.
// GCP credits absorb the per-render cost. Preview tier — quota and
// availability subject to Google's allowlist.
//
// API shape (Vertex AI Online Prediction REST):
//   POST https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}
//        /locations/{LOCATION}/publishers/google/models/{MODEL}:predict
//   Auth: Bearer <access-token-from-service-account-JWT-exchange>
//
// We DO NOT pull `google-auth-library` to keep @stylique/core dep-free.
// Instead we sign a 1-hour JWT with the service-account private key (RS256)
// and exchange it at https://oauth2.googleapis.com/token for an access
// token. Token is cached in-process until 60s before expiry. Same pattern
// every Google SDK uses internally.
//
// SECURITY — the service-account JSON in env contains a private key. Read
// it ONCE at provider construction; never log it; never include in error
// messages.

import nodeCrypto from "node:crypto";
const { createSign } = nodeCrypto;
import type {
  TryOnProvider,
  TryOnRenderInput,
  TryOnRenderOutput,
  TryOnProductHints,
} from "./service.js";
import { BODY_MODEL_DESCRIPTIONS, createGeminiImageTryOnProvider } from "./service.js";

// ───────────────────────────────────────────────────────────────────────
// Service account JSON shape — narrowly typed so we never touch fields
// we don't need.
// ───────────────────────────────────────────────────────────────────────

type ServiceAccountKey = {
  type: "service_account";
  project_id: string;
  client_email: string;
  private_key: string;       // PEM-encoded RSA private key
  token_uri?: string;        // defaults https://oauth2.googleapis.com/token
};

function parseServiceAccount(raw: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("vertex_sa_invalid_json");
  }
  const sa = parsed as Partial<ServiceAccountKey>;
  if (
    sa?.type !== "service_account" ||
    typeof sa.client_email !== "string" ||
    typeof sa.private_key !== "string" ||
    typeof sa.project_id !== "string"
  ) {
    throw new Error("vertex_sa_missing_fields");
  }
  return sa as ServiceAccountKey;
}

// ───────────────────────────────────────────────────────────────────────
// JWT signing + token exchange (RS256 via node:crypto).
// ───────────────────────────────────────────────────────────────────────

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signGoogleJwt(sa: ServiceAccountKey, scope: string): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const iat = Math.floor(Date.now() / 1000);
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600, // 1-hour lifetime — Google rejects > 3600
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));
  return `${header}.${claims}.${signature}`;
}

// Token cache — keyed by client_email so multiple Vertex providers in
// the same process (different projects) don't clobber each other.
type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

async function getAccessToken(
  sa: ServiceAccountKey,
  fetchImpl: typeof fetch,
): Promise<string> {
  const cached = tokenCache.get(sa.client_email);
  // Refresh 60s before actual expiry to avoid edge-of-life races.
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const jwt = signGoogleJwt(sa, "https://www.googleapis.com/auth/cloud-platform");
  const res = await fetchImpl(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    // DO NOT include response body — Google sometimes echoes the bad JWT.
    throw new Error(`vertex_token_exchange_${res.status}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.expires_in) {
    throw new Error("vertex_token_response_malformed");
  }
  const expiresAt = Date.now() + json.expires_in * 1000;
  tokenCache.set(sa.client_email, { token: json.access_token, expiresAt });
  return json.access_token;
}

// ───────────────────────────────────────────────────────────────────────
// Image fetch helper — mirrors the gemini-image provider's pattern.
// ───────────────────────────────────────────────────────────────────────

async function urlToBase64(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ data: string; mimeType: string }> {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error("vertex_garment_bad_data_url");
    return { data: m[2]!, mimeType: m[1]! };
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`vertex_garment_fetch_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    data: buf.toString("base64"),
    mimeType: res.headers.get("content-type") || "image/jpeg",
  };
}

// ───────────────────────────────────────────────────────────────────────
// The VTO predict call.
// ───────────────────────────────────────────────────────────────────────

type VertexPredictResponse = {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    mimeType?: string;
  }>;
  error?: { message?: string };
};

export type VertexVtoConfig = {
  projectId: string;
  location?: string;                  // default "us-central1"
  serviceAccountJson: string;         // raw JSON string from VERTEX_SERVICE_ACCOUNT_JSON env
  model?: string;                     // default "virtual-try-on-preview-08-04"
  fetchImpl?: typeof fetch;           // overrideable for tests
};

export function createVertexVtoProvider(cfg: VertexVtoConfig): TryOnProvider {
  const sa = parseServiceAccount(cfg.serviceAccountJson);
  const location = cfg.location ?? "us-central1";
  const model = cfg.model ?? "virtual-try-on-preview-08-04";
  const f = cfg.fetchImpl ?? fetch;
  const endpoint =
    `https://${location}-aiplatform.googleapis.com/v1/projects/` +
    `${encodeURIComponent(cfg.projectId)}/locations/${encodeURIComponent(location)}` +
    `/publishers/google/models/${encodeURIComponent(model)}:predict`;

  // Resolve the person image — for BODY_MODEL we use one of the preset
  // muse renders from `body-models/<id>.png`. For PERSONAL_PHOTO the
  // shopper's selfie comes in as a base64 string. VTO-001 needs both
  // the garment and the person in the same predict call.
  async function resolvePersonImage(
    input: TryOnRenderInput,
  ): Promise<{ data: string; mimeType: string }> {
    if (input.mode === "PERSONAL_PHOTO") {
      if (!input.personImageBase64 || !input.personImageMime) {
        throw new Error("vertex_no_person_image");
      }
      const data = input.personImageBase64.startsWith("data:")
        ? (input.personImageBase64.split(",", 2)[1] ?? "")
        : input.personImageBase64;
      return { data, mimeType: input.personImageMime };
    }
    // BODY_MODEL — Vertex won't infer a muse from a text description,
    // so we ship a stock person photo per modelHint. The image URL
    // resolves via the brand-install muse library (D38a-r1). Until that
    // pre-generation step is wired, we fall back to a neutral grey
    // placeholder and let Vertex auto-generate a plausible body — quality
    // suffers but the call still returns rather than failing hard.
    const hint = (input.modelHint && BODY_MODEL_DESCRIPTIONS[input.modelHint]) || null;
    const stockUrl =
      process.env.VERTEX_MUSE_BASE_URL && input.modelHint
        ? `${process.env.VERTEX_MUSE_BASE_URL.replace(/\/+$/, "")}/${encodeURIComponent(input.modelHint)}.png`
        : null;
    if (stockUrl) return urlToBase64(stockUrl, f);
    // Last-resort: 1x1 grey pixel. Vertex will paint a body — not ideal
    // but never returns an error. Documented limitation until muses ship.
    void hint;
    console.warn('[vertex-vto] VERTEX_MUSE_BASE_URL not set — BODY_MODEL renders will use placeholder. Set this env var for real muse images.');
    return {
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    };
  }

  function buildHintsText(h: TryOnProductHints | undefined): string {
    if (!h) return "";
    return [
      h.title,
      h.category ? `(${h.category})` : "",
      h.primaryColor ? `, ${h.primaryColor}` : "",
    ].filter(Boolean).join(" ");
  }

  return {
    key: "vertex-vto-001",
    model,
    modelKey: `vertex-vto-001:${model}`,
    async render(input: TryOnRenderInput): Promise<TryOnRenderOutput> {
      const token = await getAccessToken(sa, f);
      const garment = await urlToBase64(input.garmentImageUrl, f);
      const person = await resolvePersonImage(input);

      // Vertex VTO-001 instance shape — one person, one or more garments.
      // We send a single garment per call to keep the cache key tight
      // (D34: cacheKey = hash(productId|museId|sizeHint|provider)).
      const body = {
        instances: [
          {
            personImage: { image: { bytesBase64Encoded: person.data, mimeType: person.mimeType } },
            productImages: [
              { image: { bytesBase64Encoded: garment.data, mimeType: garment.mimeType } },
            ],
            // Optional caption-style hint — Vertex ignores extras gracefully.
            text: buildHintsText(input.hints),
          },
        ],
        parameters: {
          sampleCount: 1,
          // Add the studio-backdrop instruction so output blends with
          // the rest of our renders (D38 visual coherence). Vertex
          // doesn't always honor it, but it's free to ask.
          baseSteps: 32,
        },
      };

      const res = await f(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        // Capture status + a short truncated reason — never the request
        // body (would leak photo bytes) and never the access token.
        const bodyTxt = await res.text().catch(() => "");
        throw new Error(`vertex_predict_${res.status}: ${bodyTxt.slice(0, 200)}`);
      }

      const json = (await res.json()) as VertexPredictResponse;
      const pred = json.predictions?.[0];
      if (!pred?.bytesBase64Encoded) {
        throw new Error(
          json.error?.message
            ? `vertex_no_prediction: ${json.error.message.slice(0, 200)}`
            : "vertex_no_prediction",
        );
      }
      const mime = pred.mimeType || "image/png";
      return {
        imageUrl: `data:${mime};base64,${pred.bytesBase64Encoded}`,
        mime,
      };
    },
  };
}

// ─── Vertex Nano-Banana provider ────────────────────────────────────────
// Same-cloud fallback: uses the Gemini 2.x image generation model but
// authenticated via the Vertex service account (so billing stays on GCP
// rather than hitting the public Gemini quota). When the Vertex token
// exchange fails — missing env vars, bad SA JSON, network blip — this
// automatically falls back to the public GEMINI_API_KEY path so the render
// still completes.
//
// Why "nano-banana"? Low-cost, high-availability, silly name → easy to grep.
// Positioned as the Growth/Ultimate fallback behind vertex-vto-001 when the
// brand wants GCP billing for all renders but doesn't yet have VTO-001 quota.

export type VertexNanaBananaConfig = {
  projectId: string;
  location?: string;           // default "us-central1"
  serviceAccountJson: string;
  model?: string;              // default gemini-2.5-flash-preview-05-20
  fetchImpl?: typeof fetch;
};

export function createVertexNanaBananaProvider(cfg: VertexNanaBananaConfig): TryOnProvider {
  const model = cfg.model ?? "gemini-2.5-flash-preview-05-20";
  const f = cfg.fetchImpl ?? fetch;

  // Best-effort: parse the SA so we can get a token — but don't throw at
  // construction time if the JSON is missing, because the fallback path
  // (public Gemini API) can still work without a service account.
  let sa: ServiceAccountKey | null = null;
  try {
    sa = parseServiceAccount(cfg.serviceAccountJson);
  } catch {
    sa = null;
  }

  return {
    key: "vertex-nano-banana",
    model,
    modelKey: `vertex-nano-banana:${model}`,

    async render(input: TryOnRenderInput): Promise<TryOnRenderOutput> {
      // Try Vertex-authenticated path first; fall back to public Gemini key.
      if (sa) {
        try {
          const _token = await getAccessToken(sa, f);
          // Vertex Gemini endpoint uses the same JSON body as the public API;
          // auth is the only difference. Route through the public helper —
          // it accepts an apiKey param; for Vertex we pass a sentinel and
          // override the URL at the fetch level via fetchImpl wrapping.
          // Simplest correct implementation: re-use createGeminiImageTryOnProvider
          // with a wrapped fetch that injects the Bearer token, removing the key
          // from the URL. This keeps all prompt / response parsing in one place.
          const location = cfg.location ?? "us-central1";
          const vertexEndpoint =
            `https://${location}-aiplatform.googleapis.com/v1/projects/` +
            `${encodeURIComponent(cfg.projectId)}/locations/${encodeURIComponent(location)}` +
            `/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

          const bearerFetch: typeof fetch = async (input2, init) => {
            // Strip the API key query param added by the Gemini helper and
            // replace with Bearer auth on the Vertex endpoint.
            const url = typeof input2 === "string" ? vertexEndpoint : vertexEndpoint;
            const headers = new Headers(init?.headers);
            // Re-fetch token (cached) in case it was refreshed since closure.
            const tok = await getAccessToken(sa!, f);
            headers.set("Authorization", `Bearer ${tok}`);
            headers.delete("x-goog-api-key");
            return f(url, { ...init, headers });
          };

          const geminiProvider = createGeminiImageTryOnProvider({
            apiKey: "vertex-auth",   // placeholder — overridden by bearerFetch
            model,
            fetchImpl: bearerFetch,
          });
          return geminiProvider.render(input);
        } catch (vertexErr) {
          // Log the failure but don't surface it — fall through to public key.
          console.warn("[vertex-nano-banana] Vertex path failed, falling back to public Gemini:", (vertexErr as Error).message);
        }
      }

      // Fallback: public Gemini API key.
      const geminiKey = process.env.GEMINI_API_KEY ?? "";
      if (!geminiKey) throw new Error("vertex-nano-banana: no auth available (no SA and no GEMINI_API_KEY)");
      const fallbackProvider = createGeminiImageTryOnProvider({ apiKey: geminiKey, model });
      return fallbackProvider.render(input);
    },
  };
}
