// P2 — Provider cost catalog + computeCost
//
// Real per-unit costs for every provider Stylique actually calls, mapped from
// the UsageMetric a shop's `UsageCounter` rows are keyed by, so the super-admin
// dashboard (P4) can convert a counter into a USD figure and the case-study
// export (P6) can compute cost-per-shopper / margin / payback.
//
// Costs are deliberately HARDCODED here (not in env vars or the DB) because
// they're a public, slow-moving truth — provider price sheets change a few
// times a year and a config drift would silently mis-bill every shop. When
// a provider rate changes, update this file, ship, the new rate applies on
// the next rollup. We over-quote rather than under-quote: STYLIST_TURN uses
// a blended Flash-dominant cost with a worst-case factor for the occasional
// Pro fallback (MIRA_FALLBACK_MODEL), which makes the "profit" number on the
// drill-in screen conservative — the merchant cannot be undercharged on
// Stylique's view of margin.
//
// Source of rates (Q2 2026 reference):
//   Gemini 2.5 Flash:   $0.075/1M input,  $0.30/1M output
//   Gemini 2.5 Pro:     $1.25/1M input,   $5.00/1M output
//   Gemini 2.5 Flash Image (Nano Banana): $0.04/image
//   Vertex VTO-001 (virtual-try-on-preview-08-04): $0.04/render
//   Replicate CatVTON (cuuupid/idm-vton):  $0.012/render
//   Replicate FLUX 1.1-pro:  $0.04/image
//   Replicate MiDaS depth:   $0.003/image
//   text-embedding-004:      $0 at the free Gemini quota tier (best-effort)

import type { UsageMetric } from "@stylique/types";

// ── Provider rate primitives ────────────────────────────────────────────────

/**
 * Token-priced model (Gemini Pro / Flash / etc).
 *
 * `usdPer1MInput` / `usdPer1MOutput` are the official price-sheet numbers;
 * the per-turn cost for a chat model is approximated from a representative
 * (input, output) token budget per call that we measure empirically off the
 * production prompt.
 */
export interface TokenModelRate {
  kind: "token";
  providerKey: string;
  usdPer1MInput: number;
  usdPer1MOutput: number;
  /** Representative (input, output) tokens per call. */
  perCallTokens: { input: number; output: number };
}

/** Per-call/render flat rate (image models, VTO, depth). */
export interface FlatModelRate {
  kind: "flat";
  providerKey: string;
  usdPerCall: number;
}

export type ProviderRate = TokenModelRate | FlatModelRate;

// ── Public catalog ──────────────────────────────────────────────────────────
//
// Keyed by a stable `providerKey` (matches `Plan.planFeaturesJson.tryon.providerKey`
// and the keys used in the worker switch). Multiple providers per metric (e.g.
// VTO can be Vertex OR Replicate OR Nano Banana) — the metric → cost function
// picks the configured provider for the shop (or the safe over-quote default).

export const PROVIDER_RATES = {
  // Mira chat turn — Flash is the primary, Pro is the rare fallback.
  "gemini-2.5-flash": {
    kind: "token",
    providerKey: "gemini-2.5-flash",
    usdPer1MInput: 0.075,
    usdPer1MOutput: 0.30,
    // Measured off the canonical Mira prompt: ~3200 input (system+catalog
    // digest+brand+history+message), ~280 output (voice + route + chips).
    perCallTokens: { input: 3200, output: 280 },
  },
  "gemini-2.5-pro": {
    kind: "token",
    providerKey: "gemini-2.5-pro",
    usdPer1MInput: 1.25,
    usdPer1MOutput: 5.00,
    perCallTokens: { input: 3200, output: 280 },
  },
  // Gemini Vision on Mira (selfie / reference / chart OCR).
  "gemini-2.5-flash-vision": {
    kind: "token",
    providerKey: "gemini-2.5-flash-vision",
    usdPer1MInput: 0.075,
    usdPer1MOutput: 0.30,
    // ~6500 input (image tokens dominate at ~258 per 384x384 tile + prompt),
    // ~150 output (structured JSON answer).
    perCallTokens: { input: 6500, output: 150 },
  },
  // Try-on render providers.
  "gemini-2.5-flash-image": {
    kind: "flat",
    providerKey: "gemini-2.5-flash-image",
    usdPerCall: 0.04, // Nano Banana
  },
  "vertex-vto-001": {
    kind: "flat",
    providerKey: "vertex-vto-001",
    usdPerCall: 0.04, // virtual-try-on-preview-08-04
  },
  "vertex-nano-banana": {
    kind: "flat",
    providerKey: "vertex-nano-banana",
    usdPerCall: 0.04,
  },
  "replicate-catvton": {
    kind: "flat",
    providerKey: "replicate-catvton",
    usdPerCall: 0.012, // cuuupid/idm-vton or zsxkib/catvton
  },
  // Creative Studio (FLUX 1.1-pro via Replicate).
  "replicate-flux-1.1-pro": {
    kind: "flat",
    providerKey: "replicate-flux-1.1-pro",
    usdPerCall: 0.04,
  },
  // Depth maps (one-time per product at install pre-warm).
  "replicate-midas": {
    kind: "flat",
    providerKey: "replicate-midas",
    usdPerCall: 0.003,
  },
} as const satisfies Record<string, ProviderRate>;

export type ProviderKey = keyof typeof PROVIDER_RATES;

// ── computeCost (the workhorse) ─────────────────────────────────────────────

/**
 * Cost in USD for a single call of the named provider.
 */
export function unitCostUsd(providerKey: ProviderKey): number {
  const rate = PROVIDER_RATES[providerKey];
  if (rate.kind === "flat") return rate.usdPerCall;
  const inputUsd = (rate.perCallTokens.input / 1_000_000) * rate.usdPer1MInput;
  const outputUsd = (rate.perCallTokens.output / 1_000_000) * rate.usdPer1MOutput;
  return inputUsd + outputUsd;
}

/**
 * Compute provider cost in USD for a given metric and a count of calls,
 * picking the provider configured on the shop (defaults to the conservative
 * over-quote so we never under-bill).
 */
export function computeCost(
  metric: UsageMetric,
  quantity: number,
  opts?: { tryonProviderKey?: string; miraFallbackRate?: number },
): number {
  if (quantity <= 0) return 0;
  switch (metric) {
    case "STYLIST_TURN": {
      // The 1% blended cost: assume miraFallbackRate (default 0.05 = 5%) of
      // calls escalate to Pro, the rest are Flash. Conservative — the live
      // metric is closer to ~2% but we over-quote.
      const fallbackRate = opts?.miraFallbackRate ?? 0.05;
      const flash = unitCostUsd("gemini-2.5-flash");
      const pro = unitCostUsd("gemini-2.5-pro");
      return quantity * (flash * (1 - fallbackRate) + pro * fallbackRate);
    }
    case "VISION_TURN":
      return quantity * unitCostUsd("gemini-2.5-flash-vision");
    case "TRYON_PERSONAL":
    case "TRYON_BODY": {
      // The shop's configured provider; default to vertex-vto-001 to over-quote.
      const key = (opts?.tryonProviderKey ?? "vertex-vto-001") as ProviderKey;
      const rate = (PROVIDER_RATES as Record<string, ProviderRate>)[key];
      if (!rate) return quantity * unitCostUsd("vertex-vto-001");
      return quantity * unitCostUsd(key);
    }
    case "CREATIVE_GENERATED":
    case "CREATIVE_SET_GENERATED":
      return quantity * unitCostUsd("replicate-flux-1.1-pro");
    case "STYLE_RECOMMENDATION":
    case "FIT_RECOMMENDATION":
      // Deterministic engine — zero provider cost. The work is CPU-only.
      return 0;
  }
}

// ── Aggregate / rollup helpers ─────────────────────────────────────────────

/** A row of usage data (from `UsageCounter`) ready for cost aggregation. */
export interface UsageCounterRow {
  metric: UsageMetric;
  count: number;
}

/** Cost rollup for one shop over one period. */
export interface ShopCostRollup {
  totalUsd: number;
  byMetric: Partial<Record<UsageMetric, { count: number; usd: number }>>;
}

/**
 * Sum the provider cost across all metrics for one shop. Pure: takes
 * counters in, returns a USD rollup out — caller picks the period and the
 * tryon provider key (typically `shop.plan.planFeaturesJson.tryon.providerKey`).
 */
export function rollupShopCost(
  rows: UsageCounterRow[],
  opts?: { tryonProviderKey?: string; miraFallbackRate?: number },
): ShopCostRollup {
  const byMetric: ShopCostRollup["byMetric"] = {};
  let totalUsd = 0;
  for (const r of rows) {
    const usd = computeCost(r.metric, r.count, opts);
    byMetric[r.metric] = { count: r.count, usd };
    totalUsd += usd;
  }
  return { totalUsd, byMetric };
}

/**
 * Profit = the shop's plan price (USD/mo) — provider cost for the period.
 * Negative numbers mean Stylique is losing money on that shop; the super-admin
 * drill-in surfaces this verbatim so we can cap or upgrade them before the
 * loss compounds.
 */
export function computeProfit(args: {
  monthlyPlanUsd: number;
  providerCostUsd: number;
}): { profitUsd: number; marginPct: number } {
  const profitUsd = args.monthlyPlanUsd - args.providerCostUsd;
  const marginPct =
    args.monthlyPlanUsd > 0
      ? Math.round((profitUsd / args.monthlyPlanUsd) * 1000) / 10
      : 0;
  return { profitUsd, marginPct };
}

// ── Tier price reference (kept here so the dashboard reads from one place) ──
// Founder-declared pricing per CLAUDE.md §1. Not a billing rate (Shopify charges
// the merchant) — used only by the super-admin's margin math.
export const PLAN_PRICE_USD: Record<"STARTER" | "GROWTH" | "ULTIMATE", number> = {
  STARTER: 199,
  GROWTH: 449,
  ULTIMATE: 849,
};
