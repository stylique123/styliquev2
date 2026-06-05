// ─────────────────────────────────────────────────────────────────────────────
// Vertex AI try-on backend for the demo (server-only).
//
// Two render paths, both on Google Cloud (single-cloud billing on GCP credits):
//   • vertex-vto-001  → the purpose-built garment-swap model
//                       (`virtual-try-on-preview-08-04`). Highest garment
//                       fidelity. Takes person + garment images directly; it
//                       does NOT honor text fit-prompts, so it is best for
//                       single-garment realism, not size differentiation.
//   • vertex-gemini   → the SAME Gemini image model the public path uses, but
//                       authenticated through the Vertex service account so
//                       billing stays on GCP. Because it is generateContent,
//                       it reuses our full fit-prompt engine (the 9-band ease
//                       clauses) → size differentiation is preserved.
//
// Auth: we sign a 1-hour RS256 JWT with the service-account private key and
// exchange it at oauth2.googleapis.com/token for a Bearer access token
// (cached in-process, refreshed 60s before expiry). No google-auth-library
// dependency — same pattern every Google SDK uses internally.
//
// SECURITY — the service-account JSON contains a PRIVATE KEY. It is read once
// at module load. It is NEVER logged and NEVER included in any error message.
// Vertex error bodies can echo the bad JWT, so we only surface the HTTP status
// and a truncated reason, never the request body (which carries photo bytes)
// and never the token.
// ─────────────────────────────────────────────────────────────────────────────
import { createSign } from "node:crypto";

const VTO_MODEL = process.env.VERTEX_VTO_MODEL ?? "virtual-try-on-preview-08-04";
const GEMINI_VERTEX_MODEL =
  process.env.VERTEX_GEMINI_MODEL ?? "gemini-2.5-flash-image";
const LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";

type ServiceAccountKey = {
  type: "service_account";
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function parseServiceAccount(raw: string): ServiceAccountKey | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const sa = parsed as Partial<ServiceAccountKey>;
  if (
    sa?.type !== "service_account" ||
    typeof sa.client_email !== "string" ||
    typeof sa.private_key !== "string" ||
    typeof sa.project_id !== "string"
  ) {
    return null;
  }
  return sa as ServiceAccountKey;
}

// Read the SA + project ONCE at module load. Never re-read, never log.
const SA: ServiceAccountKey | null = process.env.VERTEX_SERVICE_ACCOUNT_JSON
  ? parseServiceAccount(process.env.VERTEX_SERVICE_ACCOUNT_JSON)
  : null;
const PROJECT_ID = process.env.VERTEX_PROJECT_ID ?? SA?.project_id ?? "";

/** True only when Vertex can actually authenticate. */
export function vertexConfigured(): boolean {
  return Boolean(SA && PROJECT_ID);
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signGoogleJwt(sa: ServiceAccountKey): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const iat = Math.floor(Date.now() / 1000);
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));
  return `${header}.${claims}.${signature}`;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (!SA) throw new Error("vertex_not_configured");
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.token;
  }
  const jwt = signGoogleJwt(SA);
  const res = await fetch(SA.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    // DO NOT include the response body — Google echoes the bad JWT.
    throw new Error(`vertex_token_exchange_${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || !json.expires_in) throw new Error("vertex_token_malformed");
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export interface VertexImageOut {
  b64: string;
  mime: string;
}

// ─── vertex-vto-001 — dedicated garment swap ────────────────────────────────
// One garment per predict call. For a combined look we compose sequentially:
// swap garment A onto the person → feed the result back as the person → swap
// garment B → … so all pieces end up on one body.
type VertexPredictResponse = {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  error?: { message?: string };
};

async function vtoSwapOne(
  token: string,
  personB64: string,
  personMime: string,
  garmentB64: string,
  hintText: string,
): Promise<VertexImageOut> {
  const endpoint =
    `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/` +
    `${encodeURIComponent(PROJECT_ID)}/locations/${encodeURIComponent(LOCATION)}` +
    `/publishers/google/models/${encodeURIComponent(VTO_MODEL)}:predict`;
  const body = {
    instances: [
      {
        personImage: { image: { bytesBase64Encoded: personB64, mimeType: personMime } },
        productImages: [{ image: { bytesBase64Encoded: garmentB64, mimeType: "image/png" } }],
        text: hintText,
      },
    ],
    parameters: { sampleCount: 1, baseSteps: 32 },
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    // Status + short reason only — never the request body (photo bytes), never the token.
    throw new Error(`vertex_predict_${res.status}:${txt.slice(0, 160)}`);
  }
  const json = (await res.json()) as VertexPredictResponse;
  const pred = json.predictions?.[0];
  if (!pred?.bytesBase64Encoded) {
    throw new Error(
      json.error?.message ? `vertex_no_prediction:${json.error.message.slice(0, 160)}` : "vertex_no_prediction",
    );
  }
  return { b64: pred.bytesBase64Encoded, mime: pred.mimeType || "image/png" };
}

/** VTO-001 garment swap. Sequential composition for multiple garments. */
export async function callVertexVto(
  personB64: string,
  personMime: string,
  garmentB64s: string[],
  hintText: string,
): Promise<VertexImageOut> {
  const token = await getAccessToken();
  let person = personB64;
  let mime = personMime;
  for (const g of garmentB64s) {
    const out = await vtoSwapOne(token, person, mime, g, hintText);
    person = out.b64;
    mime = out.mime;
  }
  return { b64: person, mime };
}

// ─── vertex-gemini — Vertex-authed Gemini image (reuses the fit-prompt) ──────
/** Vertex-authenticated Gemini generateContent. Mirrors the public-API body
 *  exactly so the caller's fit-engineered prompt is preserved verbatim. */
export async function callVertexGemini(
  prompt: string,
  personB64: string,
  personMime: string,
  garmentB64s: string[],
): Promise<VertexImageOut> {
  const token = await getAccessToken();
  const endpoint =
    `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/` +
    `${encodeURIComponent(PROJECT_ID)}/locations/${encodeURIComponent(LOCATION)}` +
    `/publishers/google/models/${encodeURIComponent(GEMINI_VERTEX_MODEL)}:generateContent`;
  const parts: Array<Record<string, unknown>> = [
    { text: prompt },
    { inlineData: { mimeType: personMime, data: personB64 } },
    ...garmentB64s.map((g) => ({ inlineData: { mimeType: "image/png", data: g } })),
  ];
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[tryon] vertex-gemini http", res.status, txt.slice(0, 200));
    throw new Error("render_failed");
  }
  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string } }> } }>;
  };
  const outParts = j.candidates?.[0]?.content?.parts ?? [];
  const img = outParts.find((p) => p.inlineData);
  if (!img?.inlineData) throw new Error("render_no_image");
  return { b64: img.inlineData.data, mime: img.inlineData.mimeType || "image/png" };
}
