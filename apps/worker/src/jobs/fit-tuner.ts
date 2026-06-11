// Stylique Fashion — nightly fit + look auto-tuner. Tunes per-shop fit and
// look-building from real conversion signal. Lives in apps/worker because it
// runs unattended every night.
//
// What it does per shop:
//   1. Reads the last 30 days of CHAT_COMBO_PROPOSED, COMBO_ADD_ALL,
//      CHAT_CART_REQUESTED, CART_CONFIRMED, CART_CANCELLED.
//   2. Computes three real metrics:
//        addAllRate30d        = COMBO_ADD_ALL / CHAT_COMBO_PROPOSED
//        cartConvertRate30d   = CART_CONFIRMED / CHAT_CART_REQUESTED
//        keepBiasBySize       = per-size keep-rate from confirmed vs cancelled
//   3. Gently nudges the per-shop combo scoring weights (LR 0.15, clamped).
//   4. Writes back to Plan.planFeaturesJson.fashion.{lookWeights,addAllRate30d,
//      cartConvertRate30d,keepBiasBySize,tunedAt,samples}.
//
// HONESTY GUARDS:
//   • Any metric with fewer than MIN_SAMPLES rows is OMITTED from the write —
//     never fabricates a number.
//   • If NO metric has signal, no write happens — the shop keeps default behaviour.
//   • Read-modify-write preserves every other key under planFeaturesJson.
//
// Closes the learning loop the reality panel called out: signals are captured
// AND now read back to adjust future ranking, autonomously, every night.

import { prisma } from "@stylique/db";
import { Prisma } from "@prisma/client";

const LOOKBACK_DAYS = 30;
const MIN_SAMPLES = 10;
const TUNE_LR = 0.15;

export type LookWeights = {
  coverage: number;
  colorHarmony: number;
  silhouetteBalance: number;
  occasionFit: number;
  stockOK: number;
  conversion: number;
};

export const DEFAULT_LOOK_WEIGHTS: LookWeights = {
  coverage: 0.28,
  colorHarmony: 0.26,
  silhouetteBalance: 0.10,
  occasionFit: 0.18,
  stockOK: 0.08,
  conversion: 0.10,
};

type PlanJson = {
  fashion?: {
    lookWeights?: Partial<LookWeights> & { tunedAt?: string; samples?: number };
    keepBiasBySize?: Record<string, number>;
    addAllRate30d?: number;
    cartConvertRate30d?: number;
    tunedAt?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

export type TuneResult = {
  ok: boolean;
  reason?: string;
  shopId: string;
  weights?: LookWeights;
  addAllRate?: number;
  cartConvertRate?: number;
  keepBiasBySize?: Record<string, number>;
  combosProposed?: number;
  combosAddAll?: number;
  cartsConfirmed?: number;
};

export async function tuneFitAndLook(shopId: string): Promise<TuneResult> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const events = await prisma.analyticsEvent.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      name: {
        in: [
          "CHAT_COMBO_PROPOSED",
          "COMBO_ADD_ALL",
          "CHAT_CART_REQUESTED",
          "CART_CONFIRMED",
          "CART_CANCELLED",
        ],
      },
    },
    select: { name: true, payload: true, createdAt: true },
    take: 20_000,
  });

  const proposed = events.filter((e) => e.name === "CHAT_COMBO_PROPOSED").length;
  const addAll   = events.filter((e) => e.name === "COMBO_ADD_ALL").length;
  const addAllRate = proposed >= MIN_SAMPLES ? +(addAll / proposed).toFixed(4) : undefined;

  const cartRequested = events.filter((e) => e.name === "CHAT_CART_REQUESTED").length;
  const cartConfirmed = events.filter((e) => e.name === "CART_CONFIRMED").length;
  const cartConvertRate = cartRequested >= MIN_SAMPLES ? +(cartConfirmed / cartRequested).toFixed(4) : undefined;

  const sizeStats = new Map<string, { kept: number; cancelled: number }>();
  for (const e of events) {
    if (e.name !== "CART_CONFIRMED" && e.name !== "CART_CANCELLED") continue;
    const size = (e.payload as { size?: string } | null)?.size?.toUpperCase();
    if (!size) continue;
    const cur = sizeStats.get(size) ?? { kept: 0, cancelled: 0 };
    if (e.name === "CART_CONFIRMED") cur.kept++; else cur.cancelled++;
    sizeStats.set(size, cur);
  }
  let keepBiasBySize: Record<string, number> | undefined;
  for (const [size, s] of sizeStats) {
    const total = s.kept + s.cancelled;
    if (total < MIN_SAMPLES) continue;
    keepBiasBySize = keepBiasBySize ?? {};
    keepBiasBySize[size] = +(s.kept / total).toFixed(4);
  }

  // Current weights (or defaults) + nudge
  const plan = await prisma.plan.findUnique({ where: { shopId }, select: { planFeaturesJson: true } });
  const j = (plan?.planFeaturesJson ?? {}) as PlanJson;
  const current = ((j.fashion?.lookWeights as LookWeights | undefined) ?? DEFAULT_LOOK_WEIGHTS);
  let nextWeights: LookWeights | undefined;
  if (addAllRate != null) {
    const baseline = 0.10;
    const lift = Math.max(-1, Math.min(1, (addAllRate - baseline) / baseline));
    const dColor = TUNE_LR * 0.04 * lift;
    const dConv  = -TUNE_LR * 0.04 * lift;
    const clamp = (v: number, mn = 0.05, mx = 0.45) => Math.max(mn, Math.min(mx, v));
    const raw: LookWeights = {
      coverage:          current.coverage,
      colorHarmony:      clamp(current.colorHarmony + dColor),
      silhouetteBalance: current.silhouetteBalance,
      occasionFit:       current.occasionFit,
      stockOK:           current.stockOK,
      conversion:        clamp(current.conversion + dConv),
    };
    const sum = Object.values(raw).reduce((a, b) => a + b, 0);
    nextWeights = {
      coverage:          +(raw.coverage          / sum).toFixed(4),
      colorHarmony:      +(raw.colorHarmony      / sum).toFixed(4),
      silhouetteBalance: +(raw.silhouetteBalance / sum).toFixed(4),
      occasionFit:       +(raw.occasionFit       / sum).toFixed(4),
      stockOK:           +(raw.stockOK           / sum).toFixed(4),
      conversion:        +(raw.conversion        / sum).toFixed(4),
    };
  }

  if (!addAllRate && !cartConvertRate && !keepBiasBySize) {
    return {
      ok: false,
      reason: "insufficient_signal",
      shopId,
      combosProposed: proposed,
      combosAddAll: addAll,
      cartsConfirmed: cartConfirmed,
    };
  }

  const fashion = { ...(j.fashion ?? {}) } as NonNullable<PlanJson["fashion"]>;
  if (addAllRate != null)       fashion.addAllRate30d    = addAllRate;
  if (cartConvertRate != null)  fashion.cartConvertRate30d = cartConvertRate;
  if (keepBiasBySize)           fashion.keepBiasBySize    = keepBiasBySize;
  if (nextWeights)              fashion.lookWeights = { ...nextWeights, tunedAt: new Date().toISOString(), samples: proposed };
  fashion.tunedAt = new Date().toISOString();

  await prisma.plan.update({
    where: { shopId },
    data: { planFeaturesJson: { ...j, fashion } as Prisma.InputJsonValue },
  });

  return {
    ok: true,
    shopId,
    weights: nextWeights,
    addAllRate,
    cartConvertRate,
    keepBiasBySize,
    combosProposed: proposed,
    combosAddAll: addAll,
    cartsConfirmed: cartConfirmed,
  };
}

export type FitTunerJobData = { shopId: string };

export async function processFitTuner(data: FitTunerJobData): Promise<TuneResult> {
  const r = await tuneFitAndLook(data.shopId);
  if (r.ok) {
    console.log(`[fit-tuner] shop=${data.shopId} addAllRate=${r.addAllRate ?? "—"} cartConvert=${r.cartConvertRate ?? "—"} keepBiasSizes=${r.keepBiasBySize ? Object.keys(r.keepBiasBySize).length : 0}`);
  } else {
    console.log(`[fit-tuner] shop=${data.shopId} skipped (${r.reason ?? "no_data"})`);
  }
  return r;
}
