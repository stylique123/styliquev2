// Try-on render health log — the second learning loop (mirrors mira-signals).
//
// Every render attempt — muse OR photo, success OR failure — produces ONE log
// entry: what was rendered, how long it took, whether it cache-hit, and on
// failure the stable error code + a remediation suggestion. Aggregated, this is
// the founder's "I should see it in the dashboard, and it should be a loop —
// when an error comes we should be able to fix it / automatically learn from
// this." The error-code histogram + recency-weighted intensity tells us which
// failure class to fix FIRST; the remediation map is the self-healing hint.
//
// Storage mirrors mira-signals.server.ts exactly: a JSON file under
// apps/web/data/ when the FS is writable (local demo), backed by an in-memory
// cache so it also works on a read-only serverless FS. No DB — flat file is the
// right weight for a demo.
//
// PRIVACY (D23 / PB17 / §3.5): muse-mode logs carry only non-identifying render
// metadata (museId, handle, size, ease). For PHOTO mode we NEVER log the photo
// bytes, any data URL, or anything shopper-identifying — only mode + the same
// render metadata. The photo itself is pass-through, never persisted.

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// Stable error vocabulary — must match tryon-render.server.ts throws + route.ts
// mapping. "ok" is the success sentinel.
export type TryonErrorCode =
  | "ok"
  | "no_api_key"
  | "render_failed"
  | "render_no_image"
  | "bad_photo"
  | "no_garment"
  | "invalid_asset"
  | "rate_limited"
  | "invalid_input"
  | "muse_args"
  | "photo_args";

export type TryonStatus = "ok" | "error";
export type TryonMode = "muse" | "photo";

export type TryonLogEntry = {
  id: string;
  ts: string; // ISO timestamp
  mode: TryonMode;
  status: TryonStatus;
  errorCode: TryonErrorCode; // "ok" on success
  // ── render metadata (non-identifying) ──────────────────────────────────────
  handle: string | null; // product handle, if known
  size: string | null;
  easeCm: number | null; // signed ease at the binding region
  bindLabel: string | null; // which region binds ("Waist"…)
  garmentCount: number; // 1 = single, >1 = combined look
  cached: boolean; // true = served from cache (no provider call)
  ms: number | null; // wall-clock for the attempt
  remediation: string | null; // self-healing hint on failure
};

const LOG_PATH =
  process.env.TRYON_LOG_PATH ??
  path.join(process.cwd(), "data", "tryon-log.json");

const CAP = 2000; // keep the last N attempts; bounds file size
const HALF_LIFE_DAYS = 7; // failure intensity halves every week

let cache: TryonLogEntry[] | null = null;

async function load(): Promise<TryonLogEntry[]> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(LOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? (parsed as TryonLogEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist(entries: TryonLogEntry[]): Promise<void> {
  cache = entries;
  try {
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.writeFile(LOG_PATH, JSON.stringify(entries, null, 2), "utf8");
  } catch (err) {
    // Read-only FS (serverless) — in-memory cache still serves this instance.
    console.warn(
      "[tryon-log] persist skipped:",
      err instanceof Error ? err.message : err,
    );
  }
}

// ─── Remediation map — the self-healing / learning-loop brain ────────────────
// Each failure class maps to ONE concrete fix the operator (or a future auto-
// healer) can act on. This is what turns a log into a loop.
const REMEDIATION: Record<TryonErrorCode, string | null> = {
  ok: null,
  no_api_key:
    "GEMINI_API_KEY is missing/invalid in apps/web/.env.local — renders are dead until it is set. Add the key and restart.",
  render_failed:
    "The image model rejected or errored on the request. Check the prompt size, the garment/muse asset URLs, and model quota. Often transient — retry; if persistent, inspect the last prompt.",
  render_no_image:
    "Model returned a response with no image part (often a safety refusal or an over-constrained prompt). Loosen the fidelity/ease clauses or swap the garment image for a cleaner studio shot.",
  bad_photo:
    "Uploaded photo failed the data-URL allowlist (jpeg/png/webp/heic/heif). Surface a clearer upload error to the shopper; do not retry server-side.",
  no_garment:
    "No garment image resolved for the product — its catalog images[] is empty or points at a blocked path. Fix the product's imagery.",
  invalid_asset:
    "A garment/muse path was outside /products/ or /muses/ (or traversal). Check the catalog image paths and muse ids.",
  rate_limited:
    "Render token bucket exhausted for this client. Expected under load; the burst/hourly caps are protecting cost. Raise caps only if legitimate traffic is being throttled.",
  invalid_input:
    "Request body failed Zod validation. A client is sending a malformed payload — check the TryOnPanel POST shape against the route schema.",
  muse_args:
    "Muse mode was requested without museImage/museId. Client bug — the muse picker should always set both.",
  photo_args:
    "Photo mode was requested without photoDataUrl. Client bug — the upload handler should always attach the data URL.",
};

export type RecordRenderInput = {
  mode: TryonMode;
  status: TryonStatus;
  errorCode?: TryonErrorCode;
  handle?: string | null;
  size?: string | null;
  easeCm?: number | null;
  bindLabel?: string | null;
  garmentCount?: number;
  cached?: boolean;
  ms?: number | null;
};

export async function recordRender(input: RecordRenderInput): Promise<void> {
  const entries = await load();
  const errorCode: TryonErrorCode =
    input.status === "ok" ? "ok" : (input.errorCode ?? "render_failed");
  const entry: TryonLogEntry = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    mode: input.mode,
    status: input.status,
    errorCode,
    handle: input.handle?.trim().slice(0, 120) ?? null,
    size: input.size?.trim().slice(0, 8) ?? null,
    easeCm:
      typeof input.easeCm === "number" && Number.isFinite(input.easeCm)
        ? Math.round(input.easeCm)
        : null,
    bindLabel: input.bindLabel?.trim().slice(0, 24) ?? null,
    garmentCount: Math.max(1, Math.min(8, input.garmentCount ?? 1)),
    cached: Boolean(input.cached),
    ms:
      typeof input.ms === "number" && Number.isFinite(input.ms)
        ? Math.round(input.ms)
        : null,
    remediation: input.status === "ok" ? null : REMEDIATION[errorCode],
  };
  // newest first; cap
  await persist([entry, ...entries].slice(0, CAP));
}

export async function readRenders(): Promise<TryonLogEntry[]> {
  return [...(await load())];
}

// Recency weight: 1.0 today, 0.5 at one half-life, → 0 as it ages.
function recencyWeight(ts: string, now: number): number {
  const ageDays = Math.max(0, (now - new Date(ts).getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function pct(n: number): number {
  return Math.round(n * 1000) / 10; // 1-decimal percent
}

// ─── Aggregation — turns raw render logs into an operator decision ───────────
// Each output names the decision it informs (CLAUDE.md §11 data→decision law).

export type ErrorClass = {
  errorCode: TryonErrorCode;
  count: number;
  intensity: number; // recency-weighted (the ranking signal)
  remediation: string | null; // the fix to apply
  lastSeen: string; // ISO
  examples: { handle: string | null; mode: TryonMode; ts: string }[];
};

export type RecentFailure = {
  ts: string;
  mode: TryonMode;
  errorCode: TryonErrorCode;
  handle: string | null;
  remediation: string | null;
};

export type TryonInsightSummary = {
  totalRenders: number; // attempts logged
  okCount: number;
  errorCount: number;
  errorRate: number; // errorCount / total, 0..1
  cacheHitRate: number; // cached / total (provider-call avoidance)
  liveRenders: number; // non-cached provider calls
  p50LatencyMs: number | null; // median over live renders
  p95LatencyMs: number | null;
  byMode: { mode: TryonMode; total: number; errors: number }[];
  errorClasses: ErrorClass[]; // ranked by recency-weighted intensity → fix first
  recentFailures: RecentFailure[]; // raw feed for the dashboard
  topRemediation: string | null; // the single highest-priority fix right now
  generatedAt: string;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function percentile(nums: number[], p: number): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

export async function aggregateTryonInsights(): Promise<TryonInsightSummary> {
  const all = await load();
  const now = Date.now();

  const total = all.length;
  const errors = all.filter((e) => e.status === "error");
  const oks = all.filter((e) => e.status === "ok");
  const cached = all.filter((e) => e.cached);
  const live = all.filter((e) => !e.cached);
  const liveLatencies = live
    .map((e) => e.ms)
    .filter((m): m is number => typeof m === "number");

  // Group errors by code, ranked by recency-weighted intensity (fix-first).
  const classMap = new Map<
    TryonErrorCode,
    {
      count: number;
      intensity: number;
      last: string;
      examples: { handle: string | null; mode: TryonMode; ts: string }[];
    }
  >();
  for (const e of errors) {
    const g = classMap.get(e.errorCode) ?? {
      count: 0,
      intensity: 0,
      last: e.ts,
      examples: [],
    };
    g.count += 1;
    g.intensity += recencyWeight(e.ts, now);
    if (e.ts > g.last) g.last = e.ts;
    if (g.examples.length < 3)
      g.examples.push({ handle: e.handle, mode: e.mode, ts: e.ts });
    classMap.set(e.errorCode, g);
  }
  const errorClasses: ErrorClass[] = [...classMap.entries()]
    .map(([errorCode, g]) => ({
      errorCode,
      count: g.count,
      intensity: Math.round(g.intensity * 100) / 100,
      remediation: REMEDIATION[errorCode],
      lastSeen: g.last,
      examples: g.examples,
    }))
    .sort((a, b) => b.intensity - a.intensity);

  const byModeMap = new Map<TryonMode, { total: number; errors: number }>();
  for (const e of all) {
    const g = byModeMap.get(e.mode) ?? { total: 0, errors: 0 };
    g.total += 1;
    if (e.status === "error") g.errors += 1;
    byModeMap.set(e.mode, g);
  }
  const byMode = [...byModeMap.entries()].map(([mode, g]) => ({
    mode,
    total: g.total,
    errors: g.errors,
  }));

  const recentFailures: RecentFailure[] = errors.slice(0, 12).map((e) => ({
    ts: e.ts,
    mode: e.mode,
    errorCode: e.errorCode,
    handle: e.handle,
    remediation: e.remediation,
  }));

  return {
    totalRenders: total,
    okCount: oks.length,
    errorCount: errors.length,
    errorRate: total === 0 ? 0 : errors.length / total,
    cacheHitRate: total === 0 ? 0 : cached.length / total,
    liveRenders: live.length,
    p50LatencyMs: median(liveLatencies),
    p95LatencyMs: percentile(liveLatencies, 95),
    byMode,
    errorClasses,
    recentFailures,
    topRemediation: errorClasses[0]?.remediation ?? null,
    generatedAt: new Date().toISOString(),
  };
}

// re-exported for the dashboard formatter
export { pct };
