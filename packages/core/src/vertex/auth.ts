// Shared Google Vertex AI authentication primitives.
//
// Extracted from packages/core/src/tryon/vertex.ts so the same JWT signing +
// OAuth token exchange + token cache can be reused by every Vertex-backed
// provider (VTO, Imagen, Veo, Vision, multimodal embeddings). Keeping this
// free of @stylique/core dependencies — only node:crypto + fetch.
//
// SECURITY — the service-account JSON in env contains a private key. Read
// it once at provider construction. Never log, never include in errors.

import { createSign } from "node:crypto";

export type ServiceAccountKey = {
  type: "service_account";
  project_id: string;
  client_email: string;
  private_key: string;       // PEM-encoded RSA private key
  token_uri?: string;        // defaults https://oauth2.googleapis.com/token
};

export function parseServiceAccount(raw: string): ServiceAccountKey {
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

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function signGoogleJwt(sa: ServiceAccountKey, scope: string): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const iat = Math.floor(Date.now() / 1000);
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
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

// Token cache — keyed by client_email so multiple providers in the same
// process (different projects) don't clobber each other.
type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

export async function getVertexAccessToken(
  sa: ServiceAccountKey,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const cached = tokenCache.get(sa.client_email);
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

/** Build the Vertex predict URL for a publisher model. */
export function vertexPredictUrl(projectId: string, location: string, model: string): string {
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}` +
    `/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:predict`;
}

/** Convert any URL or data: URI to base64. Used to send reference images to Vertex. */
export async function urlToBase64(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ data: string; mimeType: string }> {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error("vertex_image_bad_data_url");
    return { data: m[2]!, mimeType: m[1]! };
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`vertex_image_fetch_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    data: buf.toString("base64"),
    mimeType: res.headers.get("content-type") || "image/jpeg",
  };
}
