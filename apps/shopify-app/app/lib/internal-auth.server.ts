// Internal ops dashboard authentication.
//
// Required env var: STYLIQUE_INTERNAL_SECRET
// Set a long random string (e.g. `openssl rand -hex 32`) and share it with
// ops team members only. Never commit the actual value.
//
// Auth is checked on every /internal/* route via requireInternalAuth(request).
// Two paths:
//   1. Header `X-Stylique-Internal: <secret>` — for API/script access
//   2. Cookie `sq_internal_token` — set after password login, lasts 8 hours
//
// Cookie format: base64(JSON({ hmac, nonce, ts }))
//   hmac = HMAC-SHA256(secret, nonce + ":" + ts)
//   nonce = 32 random hex chars
//   ts = unix seconds at issuance
//   Valid only when age < COOKIE_MAX_AGE seconds

import { redirect } from "@remix-run/node";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "sq_internal_token";
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours in seconds

/** Throws a redirect to /internal/login when not authenticated. */
export function requireInternalAuth(request: Request): void {
  const secret = process.env.STYLIQUE_INTERNAL_SECRET;
  if (!secret) {
    // If the env var is not configured, the internal dashboard is effectively
    // disabled. Redirect to a safe page rather than exposing data.
    throw redirect("/internal/login");
  }

  // Check header (for API access) — compare against the raw secret
  const headerToken = request.headers.get("X-Stylique-Internal");
  if (secretMatches(headerToken, secret)) return;

  // Check cookie (for browser sessions)
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const raw = parseCookie(cookieHeader, COOKIE_NAME);
  if (raw && verifyCookieToken(raw, secret)) return;

  throw redirect("/internal/login");
}

/** Build a Set-Cookie header string for the internal session cookie. */
export function buildInternalAuthCookie(secret: string): string {
  const token = buildCookieToken(secret);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/internal; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}${secure}`;
}

/** Clear the internal session cookie (for logout). */
export function clearInternalAuthCookie(): string {
  return `${COOKIE_NAME}=; Path=/internal; HttpOnly; SameSite=Strict; Max-Age=0`;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Build a signed cookie value: base64(JSON({ hmac, nonce, ts }))
 * hmac = HMAC-SHA256(secret, nonce + ":" + ts)
 */
function buildCookieToken(secret: string): string {
  const nonce = randomBytes(16).toString("hex"); // 32 hex chars
  const ts = Math.floor(Date.now() / 1000).toString();
  const hmac = createHmac("sha256", secret)
    .update(`${nonce}:${ts}`)
    .digest("hex");
  return Buffer.from(JSON.stringify({ hmac, nonce, ts })).toString("base64");
}

/**
 * Verify a cookie token produced by buildCookieToken.
 * Returns false on any parse error, bad HMAC, or expired token.
 */
function verifyCookieToken(raw: string, secret: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("hmac" in payload) ||
      !("nonce" in payload) ||
      !("ts" in payload)
    ) {
      return false;
    }
    const { hmac, nonce, ts } = payload as { hmac: unknown; nonce: unknown; ts: unknown };
    if (typeof hmac !== "string" || typeof nonce !== "string" || typeof ts !== "string") {
      return false;
    }

    // Verify expiry
    const issued = parseInt(ts, 10);
    if (isNaN(issued) || Math.floor(Date.now() / 1000) - issued > COOKIE_MAX_AGE) {
      return false;
    }

    // Recompute expected HMAC and compare in constant time
    const expected = createHmac("sha256", secret)
      .update(`${nonce}:${ts}`)
      .digest("hex");
    return secretMatches(hmac, expected);
  } catch {
    return false;
  }
}

function parseCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k.trim() === name) return rest.join("=").trim();
  }
  return null;
}

function secretMatches(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}
