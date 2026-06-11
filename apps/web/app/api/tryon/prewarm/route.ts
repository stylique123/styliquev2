// ─────────────────────────────────────────────────────────────────────────────
// Try-on cache pre-warm (P1a) — store-implementation step.
//
// Founder spec: "we can prewarm ~100 try-ons when we're implementing on a store
// on different articles … it automatically pretrains itself on those most best
// combination. And for the ones which are left … one time, let them render. We
// let them wait next time."
//
// This route renders the highest-traffic MUSE-mode combinations ahead of time so
// the disk cache (public/tryon/<key>.png) is already warm — those shoppers get an
// instant static URL, $0, no wait. Everything NOT pre-warmed lazy-caches on first
// real request (renderTryOn writes the disk file), so the store "self-trains" on
// whatever shoppers actually try.
//
// CACHE-KEY FIDELITY is the whole point: the warm requests are built with the
// EXACT same catalog helpers (recommendSizeForProduct / fitBreakdown / renderEaseOf)
// and the same default panel body (168cm / 62kg) that the client TryOnPanel uses,
// so every warmed key byte-matches the key a live `runRender` will look up. If
// these drift, the warm renders sit unused. Keep them in lock-step with
// TryOnPanel.runRender + computeFit.
//
// PRIVACY: muse-mode only. Photo renders are never pre-warmed (they're per-shopper
// and in-memory only — D23 / PB17 / §3.5). No shopper data touches this path.
//
// Processed in SLICES (offset + limit) so a single HTTP request never has to run
// ~100 × ~20s renders (which would time out). The companion script
// (scripts/prewarm-tryon.mjs) walks the offsets until done.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import {
  products,
  recommendSizeForProduct,
  fitBreakdown,
  renderEaseOf,
  type Product,
} from "../../../lib/catalog";
import { renderTryOn } from "../../../lib/tryon-render.server";
import { isAdminAuthorized } from "../../../lib/mira-knowledge.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The default body the client panel opens with (TryOnPanel: height 168, weight 62).
// SIZE-1: the muse is display-only; size + ease are a function of this body × the
// product's own cut, so they're IDENTICAL across muses — only museId varies in the
// cache key. We mirror that here exactly.
const BODY = { heightCm: 168, weightKg: 62 } as const;

// The curated muse cast — must match TryOnPanel.MUSES ids + image paths.
const MUSES = [
  { id: "petite", img: "/muses/petite.png" },
  { id: "slim", img: "/muses/slim.png" },
  { id: "athletic", img: "/muses/athletic.png" },
  { id: "curve", img: "/muses/curve.png" },
  { id: "tall", img: "/muses/tall.png" },
] as const;

// The high-traffic products we also warm at ±1 size (not just the recommended).
// These are the hero pieces a shopper is most likely to size-toggle on.
const TOP_HANDLES = [
  "onyx-silk-slip",
  "linen-relaxed-shirt",
  "atelier-wide-leg-trouser",
  "tailored-blazer-double",
  "wide-leg-denim",
];

// Mirror TryOnPanel.runRender's category → fit-axis mapping.
function garmentKindOf(p: Product): string {
  return p.category === "bottom"
    ? "bottom"
    : p.category === "dress"
      ? "dress"
      : p.category === "outerwear"
        ? "outerwear"
        : "top";
}

// The sizes a product actually offers, in ascending order (intersection with its
// size chart, matching recommendSizeForProduct's availability rule).
function availableSizes(p: Product): string[] {
  const chart = p.sizeChart;
  return p.sizes.filter((s) => !chart || chart.rows[s]);
}

type Job = {
  museId: string;
  museImage: string;
  handle: string;
  size: string;
  recommendedSize: string;
  garmentKind: string;
  garmentImages: string[];
  easeCm: number;
  tightness: number;
  bindLabel: string | null;
};

// Build the FULL deterministic job list (same order every call so offset/limit
// are stable). Deduped by cache-equivalent signature so we never render the same
// key twice.
function buildJobs(): Job[] {
  const jobs: Job[] = [];
  const seen = new Set<string>();

  const push = (p: Product, museId: string, museImage: string, size: string, recommendedSize: string) => {
    const sig = `${museId}|${p.handle}|${size.toLowerCase()}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    const fit = fitBreakdown(p, size, BODY.heightCm, BODY.weightKg);
    const { easeCm, tightness, bindLabel } = renderEaseOf(fit);
    jobs.push({
      museId,
      museImage,
      handle: p.handle,
      size,
      recommendedSize,
      garmentKind: garmentKindOf(p),
      garmentImages: [p.images[0]].filter(Boolean),
      easeCm,
      tightness,
      bindLabel,
    });
  };

  // Pass 1 — every product × every muse at the recommended size (the common case).
  for (const p of products) {
    const rec = recommendSizeForProduct(p, { ...BODY, fitPref: "true" }).size;
    for (const m of MUSES) push(p, m.id, m.img, rec, rec);
  }

  // Pass 2 — top products × every muse at ±1 size around the recommendation.
  for (const handle of TOP_HANDLES) {
    const p = products.find((x) => x.handle === handle);
    if (!p) continue;
    const sizes = availableSizes(p);
    const rec = recommendSizeForProduct(p, { ...BODY, fitPref: "true" }).size;
    const ri = sizes.indexOf(rec);
    if (ri < 0) continue;
    const neighbours = [sizes[ri - 1], sizes[ri + 1]].filter(Boolean) as string[];
    for (const size of neighbours) {
      for (const m of MUSES) push(p, m.id, m.img, size, rec);
    }
  }

  return jobs;
}

async function processSlice(jobs: Job[], shopSlug?: string): Promise<{ warmed: number; cached: number; errors: number }> {
  let warmed = 0;
  let cached = 0;
  let errors = 0;
  // Modest concurrency — Gemini renders are heavy; 3 in flight keeps it moving
  // without hammering the provider.
  const CONCURRENCY = 3;
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      try {
        const r = await renderTryOn({
          mode: "muse",
          // Brand partition: without this, warm keys land in the "_" partition
          // (shopKey(undefined)) while live storefront renders use the brand
          // slug — so the warm renders sit unused and every shopper pays a fresh
          // render. Passing shopSlug makes warm keys byte-match the brand's live
          // keys. Demo prewarm (no shopSlug) stays in "_", matching demo renders.
          shopSlug,
          museId: job.museId,
          museImage: job.museImage,
          garmentImages: job.garmentImages,
          size: job.size,
          recommendedSize: job.recommendedSize,
          garmentKind: job.garmentKind,
          handle: job.handle,
          easeCm: job.easeCm,
          tightness: job.tightness,
          bindLabel: job.bindLabel ?? undefined,
        });
        if (r.cached) cached++;
        else warmed++;
      } catch (err) {
        errors++;
        console.error("[prewarm] render error", job.handle, job.museId, job.size, err instanceof Error ? err.message : err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return { warmed, cached, errors };
}

export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { offset?: number; limit?: number; shopSlug?: string } = {};
  try {
    body = (await req.json()) as { offset?: number; limit?: number; shopSlug?: string };
  } catch {
    /* empty body = defaults */
  }
  const offset = Math.max(0, Math.floor(body.offset ?? 0));
  const limit = Math.min(20, Math.max(1, Math.floor(body.limit ?? 6)));
  // Brand to partition the warm cache under — must match the shopSlug the live
  // storefront render passes, or the warmed keys never get hit. Absent = demo.
  const shopSlug = typeof body.shopSlug === "string" && body.shopSlug.trim() ? body.shopSlug.trim() : undefined;

  const allJobs = buildJobs();
  const slice = allJobs.slice(offset, offset + limit);
  const t0 = Date.now();
  const { warmed, cached, errors } = await processSlice(slice, shopSlug);
  const nextOffset = offset + slice.length;
  const done = nextOffset >= allJobs.length;

  return NextResponse.json({
    total: allJobs.length,
    offset,
    processed: slice.length,
    warmed,
    cached,
    errors,
    nextOffset: done ? null : nextOffset,
    done,
    ms: Date.now() - t0,
  });
}

// GET → report the plan size without rendering (so the script knows how many
// slices to walk, and an admin can sanity-check the job count).
export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const jobs = buildJobs();
  return NextResponse.json({
    total: jobs.length,
    muses: MUSES.length,
    products: products.length,
    topProducts: TOP_HANDLES.length,
    body: BODY,
  });
}
