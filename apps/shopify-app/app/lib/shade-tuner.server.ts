// Stylique Beauty — shade-weight tuner. Closes the learning loop the reality
// panel called out: signals (BEAUTY_SHADE_MATCHED + cart-confirmed/cancelled)
// were captured, but `matchShades()` always used hardcoded weights
// {undertone:0.40, depth:0.35, hex:0.25}. Now the matcher READS per-shop
// weights from `Plan.planFeaturesJson.beauty.shadeWeights`, and this module
// WRITES them based on which factors correlated with kept-vs-returned shades.
//
// Reader path (called inline on every match):
//   readShadeWeights(shopId) → ShadeWeights | undefined
//
// Writer path (called from a scheduled tuner job or admin endpoint):
//   tuneShadeWeights(shopId) → reads the last 90 days of beauty events, computes
//   per-factor contribution to keep-rate, nudges weights toward winners, writes
//   back to Plan.planFeaturesJson.beauty.shadeWeights.
//
// Stays honest: with too little data (<5 matched-then-resolved shades) the
// tuner is a no-op so the brand keeps the safe default — better an honest
// "not enough signal yet" than a misleading auto-tuned number.

import { prisma } from "../db.server";
import { Prisma } from "@prisma/client";
import { DEFAULT_SHADE_WEIGHTS, type ShadeWeights } from "@stylique/core";

const PLAN_KEY = "beauty.shadeWeights" as const;
const MIN_SAMPLES = 5;
const LOOKBACK_DAYS = 90;
const TUNE_LR = 0.15;  // learning rate — gentle nudge per tune, not a full overwrite

type PlanFeaturesJson = {
  beauty?: {
    shadeWeights?: { undertone?: number; depth?: number; hex?: number; tunedAt?: string; samples?: number };
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

/** Read the per-shop shade weights. Returns undefined → matcher falls back to DEFAULT_SHADE_WEIGHTS. */
export async function readShadeWeights(shopId: string | null | undefined): Promise<ShadeWeights | undefined> {
  if (!shopId) return undefined;
  try {
    const plan = await prisma.plan.findUnique({ where: { shopId }, select: { planFeaturesJson: true } });
    const j = plan?.planFeaturesJson as PlanFeaturesJson | null | undefined;
    const w = j?.beauty?.shadeWeights;
    if (!w) return undefined;
    const u = typeof w.undertone === "number" ? w.undertone : undefined;
    const d = typeof w.depth     === "number" ? w.depth     : undefined;
    const h = typeof w.hex       === "number" ? w.hex       : undefined;
    if (u == null && d == null && h == null) return undefined;
    return {
      undertone: u ?? DEFAULT_SHADE_WEIGHTS.undertone,
      depth:     d ?? DEFAULT_SHADE_WEIGHTS.depth,
      hex:       h ?? DEFAULT_SHADE_WEIGHTS.hex,
    };
  } catch {
    return undefined; // never block a match on a DB hiccup — fall through to defaults
  }
}

type MatchedShadeRow = {
  // payload fields we care about (see packages/types BEAUTY_SHADE_MATCHED schema)
  shadeUndertone?: string | null;
  shadeDepth?: string | null;
  shopperUndertone?: string | null;
  shopperDepth?: string | null;
  shadeHexMatched?: boolean | null;
  productShopifyId?: string | null;
  createdAt: Date;
  shopperId: string | null;
};

/**
 * Tune the per-shop shade weights based on which factors correlated with kept
 * vs returned shades. Lightweight Bayesian-style nudge — NOT a full retrain —
 * so the weights drift toward what works without ever overweighting one factor.
 */
export async function tuneShadeWeights(shopId: string): Promise<{ ok: boolean; reason?: string; weights?: ShadeWeights; samples: number }> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  // Pull recent BEAUTY_SHADE_MATCHED + downstream cart outcomes for this shop.
  const matched = await prisma.analyticsEvent.findMany({
    where: { shopId, name: "BEAUTY_SHADE_MATCHED", createdAt: { gte: since } },
    select: { payload: true, createdAt: true, shopperId: true },
    take: 2000,
  });

  if (matched.length < MIN_SAMPLES) {
    return { ok: false, reason: "insufficient_signal", samples: matched.length };
  }

  // For each match, find a CART_CONFIRMED or CART_CANCELLED in the same shopper
  // window that references the same productShopifyId — that's the keep/return verdict.
  const shopperIds = Array.from(new Set(matched.map((m) => m.shopperId).filter((x): x is string => !!x)));
  if (!shopperIds.length) return { ok: false, reason: "no_attributed_outcomes", samples: matched.length };

  const outcomes = await prisma.analyticsEvent.findMany({
    where: {
      shopId,
      name: { in: ["CART_CONFIRMED", "CART_CANCELLED"] },
      shopperId: { in: shopperIds },
      createdAt: { gte: since },
    },
    select: { name: true, payload: true, createdAt: true, shopperId: true },
    take: 5000,
  });

  // Index outcomes by shopperId+productShopifyId → final verdict.
  const verdict = new Map<string, "kept" | "returned">();
  for (const o of outcomes) {
    const pid = (o.payload as { productShopifyId?: string } | null)?.productShopifyId;
    if (!pid || !o.shopperId) continue;
    const k = `${o.shopperId}|${pid}`;
    const v = o.name === "CART_CONFIRMED" ? "kept" : "returned";
    // CART_CANCELLED (return) always wins as the LAST word on the SKU.
    if (verdict.get(k) === "returned") continue;
    verdict.set(k, v);
  }

  // Score: for each resolved match, did the factor agree with the verdict?
  // A "factor agreed" = the shopper-shade values matched on that factor AND the
  // shade was kept. Or: the factor disagreed AND the shade was returned.
  let uHits = 0, dHits = 0, hHits = 0;
  let resolved = 0;
  for (const m of matched) {
    const p = m.payload as Partial<MatchedShadeRow> | null;
    const pid = p?.productShopifyId;
    if (!pid || !m.shopperId) continue;
    const v = verdict.get(`${m.shopperId}|${pid}`);
    if (!v) continue;
    resolved++;
    const undertoneAgreed = p?.shopperUndertone && p.shadeUndertone && p.shopperUndertone === p.shadeUndertone;
    const depthAgreed     = p?.shopperDepth     && p.shadeDepth     && p.shopperDepth     === p.shadeDepth;
    const hexAgreed       = !!p?.shadeHexMatched;
    if (v === "kept") {
      if (undertoneAgreed) uHits++;
      if (depthAgreed) dHits++;
      if (hexAgreed) hHits++;
    } else {
      // Returned: an agreed factor that ended in a return is a NEGATIVE signal,
      // so subtract — gentle, not a full demote.
      if (undertoneAgreed) uHits -= 0.5;
      if (depthAgreed) dHits -= 0.5;
      if (hexAgreed) hHits -= 0.5;
    }
  }

  if (resolved < MIN_SAMPLES) {
    return { ok: false, reason: "insufficient_resolved_matches", samples: resolved };
  }

  // Compute the "lift" of each factor → 0..1 share of total hits.
  const total = Math.max(0.01, uHits + dHits + hHits);
  const lift = {
    undertone: Math.max(0, uHits) / total,
    depth:     Math.max(0, dHits) / total,
    hex:       Math.max(0, hHits) / total,
  };
  // Nudge: new = (1-LR)*old + LR*lift — capped & re-normalized.
  const current = (await readShadeWeights(shopId)) ?? DEFAULT_SHADE_WEIGHTS;
  const raw = {
    undertone: (1 - TUNE_LR) * current.undertone + TUNE_LR * lift.undertone,
    depth:     (1 - TUNE_LR) * current.depth     + TUNE_LR * lift.depth,
    hex:       (1 - TUNE_LR) * current.hex       + TUNE_LR * lift.hex,
  };
  // Clamp each factor to [0.10, 0.65] so no single signal dominates entirely.
  const clamp = (v: number) => Math.max(0.10, Math.min(0.65, v));
  const cu = clamp(raw.undertone), cd = clamp(raw.depth), ch = clamp(raw.hex);
  const sum = cu + cd + ch;
  const next: ShadeWeights = { undertone: cu / sum, depth: cd / sum, hex: ch / sum };

  // Read-modify-write planFeaturesJson, preserving everything else under it.
  const plan = await prisma.plan.findUnique({ where: { shopId }, select: { planFeaturesJson: true } });
  const j = (plan?.planFeaturesJson ?? {}) as PlanFeaturesJson;
  const beauty = { ...(j.beauty ?? {}) } as NonNullable<PlanFeaturesJson["beauty"]>;
  beauty.shadeWeights = {
    undertone: round3(next.undertone),
    depth:     round3(next.depth),
    hex:       round3(next.hex),
    tunedAt:   new Date().toISOString(),
    samples:   resolved,
  };
  await prisma.plan.update({
    where: { shopId },
    data: { planFeaturesJson: { ...j, beauty } as Prisma.InputJsonValue },
  });
  void PLAN_KEY;
  return { ok: true, weights: next, samples: resolved };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
