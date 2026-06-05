// A/B testing infrastructure — cohort assignment + variant resolution.
//
// Sticky: hash(sessionId, experimentKey) → bucket. Same shopper always lands
// in the same variant across sessions. Deterministic — no DB lookup per call.
//
// Two surfaces use this:
//   • Brain (turn-time): assigns variants → BrainInput.config { promptVariant, providerKey }
//   • Analytics writer (event-time): stamps every AnalyticsEvent.variantTag
//     so the dashboard can compare cohorts later.
//
// We deliberately do NOT build an experiment-creation UI yet. Add experiments
// in `BUILTIN_EXPERIMENTS` below (or seed Experiment rows in DB); the engine
// reads from both sources and merges.

import { prisma } from "../db.server";
import { createHash } from "node:crypto";

// ─── Built-in experiments (config-as-code) ───────────────────────────────
// Add new experiments here. To turn one off, set active: false. To launch a
// shop-specific experiment, set shopId: "<shop-cuid>". Global experiments
// have shopId: null and apply to all shops on Stylique.

export type VariantConfig = {
  promptVariant?: string;        // matches a key in Brain.config.promptVariants
  providerKey?: string;          // matches a key in Brain.config.providers
  temperature?: number;
  // Future levers: combo size, signup-card timing, recommendation kinds, etc.
};

export type ExperimentDef = {
  shopId: string | null;
  key: string;
  active: boolean;
  allocation: Record<string, number>;      // sum to 1.0
  variantConfig: Record<string, VariantConfig>;
};

export const BUILTIN_EXPERIMENTS: ExperimentDef[] = [
  // ─── Experiment 1: Mira reply style (global, Q2 2026) ─────────────────
  // Hypothesis: a concise Mira (≤22 words per reply, no warm-up phrases)
  // drives higher add-to-cart rates than the default warm-friend tone.
  // Measure: CART_INTENT_ADDED events + STYLE_VOTED positive votes per session.
  // 50/50 global split. Sticky per sessionId — same shopper always gets
  // the same variant. Turn off by setting active: false.
  {
    shopId: null,                          // global — applies to all shops
    key: "mira_reply_style_q2_2026",
    active: true,
    allocation: { default: 0.5, terse: 0.5 },
    variantConfig: {
      default: {},                         // standard warm-friend Mira
      terse: { promptVariant: "terse" },   // concise ≤22-word replies
    },
  },
];

// ─── Cohort assignment ──────────────────────────────────────────────────

export type CohortAssignment = {
  experimentKey: string;
  variantKey: string;
  config: VariantConfig;
  variantTag: string;            // "<experimentKey>:<variantKey>" for AnalyticsEvent
};

/**
 * Deterministically place a shopper into a variant for one experiment.
 * Hash(sessionId + experimentKey) → uniform [0,1) → falls into bucket per
 * cumulative allocation order. Same shopper always gets the same bucket
 * regardless of when they visit.
 */
export function pickVariant(sessionId: string, exp: ExperimentDef): CohortAssignment | null {
  if (!exp.active) return null;
  const buckets = Object.entries(exp.allocation);
  if (buckets.length === 0) return null;

  const h = createHash("sha256").update(`${sessionId}:${exp.key}`).digest();
  // First 4 bytes → uint32 → [0, 2^32) → divide → [0,1)
  const u = h.readUInt32BE(0) / 0xffffffff;

  let acc = 0;
  for (const [key, weight] of buckets) {
    acc += weight;
    if (u < acc) {
      return {
        experimentKey: exp.key,
        variantKey: key,
        config: exp.variantConfig[key] ?? {},
        variantTag: `${exp.key}:${key}`,
      };
    }
  }
  // Float drift — assign last bucket.
  const last = buckets[buckets.length - 1];
  return {
    experimentKey: exp.key,
    variantKey: last[0],
    config: exp.variantConfig[last[0]] ?? {},
    variantTag: `${exp.key}:${last[0]}`,
  };
}

// ─── Engine: active experiments → cohort assignments ────────────────────
// Returns one assignment per active experiment that applies to this
// shop/shopper. Brain merges variant configs in declaration order.

let _builtinByKey: Map<string, ExperimentDef> | null = null;
function builtinIndex(): Map<string, ExperimentDef> {
  if (!_builtinByKey) {
    _builtinByKey = new Map(BUILTIN_EXPERIMENTS.map((e) => [e.key, e]));
  }
  return _builtinByKey;
}

// In-memory cache of DB-driven experiments. Refreshed every 60s — we don't
// need to hit Postgres for every chat turn.
let _dbCache: { fetchedAt: number; rows: ExperimentDef[] } = { fetchedAt: 0, rows: [] };
const CACHE_TTL_MS = 60_000;

async function loadDbExperiments(): Promise<ExperimentDef[]> {
  if (Date.now() - _dbCache.fetchedAt < CACHE_TTL_MS) return _dbCache.rows;
  const rows = await prisma.experiment.findMany({
    where: { active: true },
    select: { shopId: true, key: true, active: true, allocation: true, variantConfig: true },
  }).catch(() => [] as Array<{
    shopId: string | null; key: string; active: boolean;
    allocation: unknown; variantConfig: unknown;
  }>);
  _dbCache = {
    fetchedAt: Date.now(),
    rows: rows.map((r) => ({
      shopId: r.shopId,
      key: r.key,
      active: r.active,
      allocation: (r.allocation as Record<string, number>) ?? {},
      variantConfig: (r.variantConfig as Record<string, VariantConfig>) ?? {},
    })),
  };
  return _dbCache.rows;
}

/**
 * Returns every active experiment's variant assignment for this shopper.
 * Order: built-in first, then DB. If two experiments target the same lever
 * (e.g. promptVariant), the LAST one wins — the Brain merges left-to-right.
 */
export async function resolveCohorts(args: {
  shopId: string;
  sessionId: string;
}): Promise<CohortAssignment[]> {
  const out: CohortAssignment[] = [];

  for (const exp of builtinIndex().values()) {
    if (exp.shopId && exp.shopId !== args.shopId) continue;
    const a = pickVariant(args.sessionId, exp);
    if (a) out.push(a);
  }

  const dbExps = await loadDbExperiments();
  for (const exp of dbExps) {
    if (exp.shopId && exp.shopId !== args.shopId) continue;
    if (builtinIndex().has(exp.key)) continue;   // built-in overrides DB
    const a = pickVariant(args.sessionId, exp);
    if (a) out.push(a);
  }

  return out;
}

/**
 * Merges every cohort's variant config left-to-right. Later assignments
 * override earlier on conflicting keys. Returns the resolved BrainInput.config.
 */
export function mergeVariantConfigs(cohorts: CohortAssignment[]): VariantConfig {
  const out: VariantConfig = {};
  for (const c of cohorts) Object.assign(out, c.config);
  return out;
}

/**
 * The combined variantTag string for AnalyticsEvent.variantTag. Joined with
 * "|" so multiple cohorts can co-exist on one event. Sorted for stability.
 */
export function combinedVariantTag(cohorts: CohortAssignment[]): string | null {
  if (!cohorts.length) return null;
  return cohorts.map((c) => c.variantTag).sort().join("|");
}
