#!/usr/bin/env node
/**
 * Signed Shopify App-Proxy request helper.
 *
 * Audits the FULL signed shopper journey end-to-end (Storefront →
 * /apps/stylique/api/mira → Stylique App → mira-adapter → brain → cart),
 * not just the brain endpoint. Founder panel finding: prior audits hit
 * the brain origin directly, skipping the signed App-Proxy code path —
 * so a broken proxy case (like the 404 on /api/mira/conversion this
 * session) wouldn't show up in the score.
 *
 * Shopify App Proxy signs every request with:
 *
 *   signature = hex(HMAC_SHA256(
 *     sharedSecret,
 *     sortedQuery.map(([k,v]) => `${k}=${v}`).join("") +
 *     `shop=${shop}path_prefix=${path_prefix}timestamp=${ts}`,
 *   ))
 *
 * We replay that contract here.
 *
 * Usage:
 *   SHOPIFY_API_SECRET=<shared-secret> \
 *   SHOPIFY_SHOP=stylique-fashion-dev.myshopify.com \
 *   STYLIQUE_APP_ORIGIN=https://stylique-app.up.railway.app \
 *     node apps/web/scripts/signed-proxy.mjs api/mira \
 *       '{"message":"can I see this on me before I buy?"}'
 *
 * Returns the response body to stdout; non-zero exit on non-2xx.
 */
import crypto from "node:crypto";

const SECRET = process.env.SHOPIFY_API_SECRET;
const SHOP = process.env.SHOPIFY_SHOP;
const ORIGIN = process.env.STYLIQUE_APP_ORIGIN;
const APP_PROXY_PREFIX = process.env.SHOPIFY_APP_PROXY_PREFIX ?? "/apps/stylique";

if (!SECRET || !SHOP || !ORIGIN) {
  console.error(
    "Missing env: SHOPIFY_API_SECRET, SHOPIFY_SHOP, STYLIQUE_APP_ORIGIN.\n" +
      "Get SHOPIFY_API_SECRET from the Shopify Partners dashboard → your app → API credentials.\n" +
      "Without these the proxy can't be exercised end-to-end (HMAC signing requires the shared secret).",
  );
  process.exit(1);
}

/**
 * Compute the App-Proxy HMAC signature for a request.
 * Matches the Shopify spec: sortedParams (sans signature), concatenated as
 * "k=v" pairs without separators, HMAC-SHA256, hex-encoded.
 */
function signAppProxy(params, secret) {
  const pairs = Object.entries(params)
    .filter(([k]) => k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`)
    .join("");
  return crypto.createHmac("sha256", secret).update(pairs).digest("hex");
}

/**
 * Build a signed App-Proxy URL for the given path under the proxy prefix.
 * Shopify includes shop / path_prefix / timestamp / logged_in_customer_id
 * (if any) in the signed params — we replay the minimum required set.
 */
export function signedProxyUrl(action, opts = {}) {
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const params = {
    shop: SHOP,
    path_prefix: APP_PROXY_PREFIX,
    timestamp: ts,
    ...(opts.loggedInCustomerId ? { logged_in_customer_id: String(opts.loggedInCustomerId) } : {}),
  };
  const signature = signAppProxy(params, SECRET);
  const qs = new URLSearchParams({ ...params, signature }).toString();
  return `${ORIGIN}${APP_PROXY_PREFIX}/${action.replace(/^\//, "")}?${qs}`;
}

/**
 * One-shot signed request. Returns {status, body, latencyMs}.
 */
export async function signedRequest(action, body, opts = {}) {
  const url = signedProxyUrl(action, opts);
  const method = body ? "POST" : "GET";
  const t = Date.now();
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, latencyMs: Date.now() - t };
}

// CLI mode: `node signed-proxy.mjs <action> [json-body]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2];
  const bodyJson = process.argv[3];
  if (!action) {
    console.error("Usage: node signed-proxy.mjs <action> [json-body]\n  example: node signed-proxy.mjs api/mira '{\"message\":\"hi\"}'");
    process.exit(1);
  }
  const body = bodyJson ? JSON.parse(bodyJson) : null;
  const { status, body: respBody, latencyMs } = await signedRequest(action, body);
  console.log(JSON.stringify({ status, latencyMs, body: respBody }, null, 2));
  process.exit(status >= 200 && status < 300 ? 0 : 1);
}
