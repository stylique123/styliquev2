// ─────────────────────────────────────────────────────────────────────────────
// Try-on render abuse limiter (P4).
//
// Try-on renders cost real money (~$0.04 each, ~10–30s on the provider). Without
// a cap, a single client could loop the endpoint and drain the render budget or
// pin the provider. This is a per-client fixed-window limiter.
//
// Demo-weight: in-memory only (single instance, no DB). Production uses the
// Redis-backed `ratelimit.server.ts` in the Shopify app. Keyed by client IP +
// the lightweight session id if one is present.
//
// Two windows so we catch BOTH a fast burst (toggling sizes in a loop) and a
// slow grind (steady abuse over an hour):
//   - burst:  RENDER_BURST_MAX renders per RENDER_BURST_WINDOW_MS
//   - hourly: RENDER_HOURLY_MAX renders per hour
// ─────────────────────────────────────────────────────────────────────────────

const RENDER_BURST_MAX = 10; // per burst window
const RENDER_BURST_WINDOW_MS = 60_000; // 1 min
const RENDER_HOURLY_MAX = 60; // per hour
const RENDER_HOURLY_WINDOW_MS = 60 * 60_000;

type Window = { count: number; resetAt: number };
type Entry = { burst: Window; hourly: Window };

const buckets = new Map<string, Entry>();
let lastSweep = Date.now();

function freshWindow(now: number, span: number): Window {
  return { count: 0, resetAt: now + span };
}

function tick(w: Window, now: number, span: number, max: number): boolean {
  if (now >= w.resetAt) {
    w.count = 0;
    w.resetAt = now + span;
  }
  if (w.count >= max) return false;
  w.count += 1;
  return true;
}

// Periodic sweep so the Map can't grow unbounded from one-off clients.
function sweep(now: number) {
  if (now - lastSweep < RENDER_HOURLY_WINDOW_MS) return;
  lastSweep = now;
  for (const [k, e] of buckets) {
    if (now >= e.hourly.resetAt && now >= e.burst.resetAt) buckets.delete(k);
  }
}

export type RenderRateResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number; scope: "burst" | "hourly" };

/**
 * Consume one render token for `key`. Returns { ok:false, retryAfterSec } when
 * either window is exhausted. Call this ONCE per render request, before doing
 * any provider work. (Cache hits still count — they're cheap, and a client
 * spamming cached renders is still abusing the endpoint; the limits are
 * generous enough that normal size-toggling never trips them.)
 */
export function takeRenderToken(key: string): RenderRateResult {
  const now = Date.now();
  sweep(now);

  let e = buckets.get(key);
  if (!e) {
    e = {
      burst: freshWindow(now, RENDER_BURST_WINDOW_MS),
      hourly: freshWindow(now, RENDER_HOURLY_WINDOW_MS),
    };
    buckets.set(key, e);
  }

  if (!tick(e.hourly, now, RENDER_HOURLY_WINDOW_MS, RENDER_HOURLY_MAX)) {
    return { ok: false, scope: "hourly", retryAfterSec: Math.max(1, Math.ceil((e.hourly.resetAt - now) / 1000)) };
  }
  if (!tick(e.burst, now, RENDER_BURST_WINDOW_MS, RENDER_BURST_MAX)) {
    // refund the hourly token we just took — the request didn't go through
    e.hourly.count = Math.max(0, e.hourly.count - 1);
    return { ok: false, scope: "burst", retryAfterSec: Math.max(1, Math.ceil((e.burst.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

/** Derive a stable client key from request headers (IP + optional session id). */
export function clientKeyFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = (xff ? xff.split(",")[0] : "").trim() || req.headers.get("x-real-ip") || "local";
  // A lightweight per-tab id if the client sent one — narrows shared-IP collisions.
  const sid = req.headers.get("x-sq-session") || "";
  return sid ? `${ip}:${sid}` : ip;
}
