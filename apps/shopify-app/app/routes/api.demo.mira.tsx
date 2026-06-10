// ═══ PUBLIC DEMO ENDPOINT — ONE TRUTH ═══
//
// This endpoint USED to call runMiraAdapter (a separate production brain in
// packages/ai/src/brain). That meant the demo had one Mira and a real shop had
// a different, weaker Mira — 48 sales rule blocks in the demo vs 1 in
// production, completely different prompts, different routes, different
// architecture. The founder's call: ONE system, ONE truth, demo brain wins.
//
// This endpoint NOW forwards to apps/web /api/mira (the demo brain). All
// merchants installing the Shopify app + everyone hitting the public demo
// endpoint + the marketing site all hit the SAME brain code now. The
// per-shop catalog injection moves to Stage 2 (when the storefront proxy
// also routes through this).
//
// Why HTTP-forward and not import the function?
//   - apps/web is a Next.js app; this is a Remix app on a different runtime.
//   - Direct import means physical relocation into a shared package — that
//     is Stage 3 of the consolidation. Stage 1 (this turn) eliminates the
//     duplicate brain logic with zero risk of behaviour drift.
//
// Safety: same rate limit as before, same demo shop, plain CORS for the
// marketing site.

import type { ActionFunctionArgs } from "@remix-run/node";
import { checkRateLimit } from "../lib/ratelimit.server";

const DEMO_BRAIN_URL = process.env.MIRA_DEMO_BRAIN_URL ?? "https://stylique-web-production.up.railway.app/api/mira";

function cors(res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

async function demoRateOk(request: Request): Promise<boolean> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const [ipOk, globalOk] = await Promise.all([
    checkRateLimit("shopper", `demo:${ip}`, 10),
    checkRateLimit("shop", "demo:global", 120),
  ]);
  return ipOk && globalOk;
}

export async function loader() {
  return cors(new Response(JSON.stringify({ ok: true, brain: DEMO_BRAIN_URL }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  if (request.method !== "POST") return cors(new Response("method_not_allowed", { status: 405 }));
  if (!await demoRateOk(request)) {
    return cors(new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429, headers: { "Content-Type": "application/json" },
    }));
  }

  // Pass the body through unchanged — the demo brain expects exactly
  // {message, currentProductHandle, history, shownHandles, ...} and we've
  // already standardised on this shape across every entry point.
  let body: unknown = null;
  try { body = await request.json(); } catch { /* empty body ok */ }

  try {
    const upstream = await fetch(DEMO_BRAIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(35_000),
    });
    const text = await upstream.text();
    // Pass status through. Demo brain returns 200 with {source, decision}
    // even on fallback so the client knows to use its regex.
    return cors(new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    }));
  } catch (err) {
    console.error("[api.demo.mira] forward failed", err instanceof Error ? err.message : err);
    // Honest fallback shape — the client (MiraWidget) recognises decision:null
    // and runs its local regex engine, so the demo never breaks.
    return cors(new Response(JSON.stringify({ source: "forward_error", decision: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }
}
