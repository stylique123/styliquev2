import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env.server";

// One shared connection. BullMQ requires `maxRetriesPerRequest: null` on the
// connection used by Workers; safe to use here too.
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const catalogSyncQueue = new Queue("catalog-sync", { connection });

export type CatalogSyncJob =
  | { kind: "full"; shopId: string }
  | { kind: "product"; shopId: string; shopifyProductId: string | number }
  | { kind: "delete"; shopId: string; shopifyProductId: string | number };

export async function enqueueCatalogSync(job: CatalogSyncJob) {
  return catalogSyncQueue.add(job.kind, job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

// ─── Creative Studio generation queue ──────────────────────────────────
// Stylist (and brand dashboard) enqueues here when a creative set should be
// produced. Worker (apps/worker) actually calls the image/video providers.
export const creativeSetQueue = new Queue("creative-set", { connection });

export type CreativeSetJob = {
  shopId: string;
  setId: string;                    // CreativeSet row already created (PENDING)
  productId: string;
  triggeredBy: string;              // "stylist_combo:<name>" / "recommendation:<id>" / "manual"
  brief?: string;
  /** Output kind — forwarded to the worker so it picks the right provider. */
  kind?: string;
};

export async function enqueueCreativeSet(job: CreativeSetJob) {
  return creativeSetQueue.add("generate", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 50,
    removeOnFail: 200,
  });
}

// ─── Brand-install queue (D38a-r1) ─────────────────────────────────────
// Enqueued once from afterAuth on first OAuth (and reinstall). Worker
// generates the 12-muse library + pre-warms top-50 product VTO renders.
// Capped at ~$2.63/brand setup cost. Idempotent via jobId.
export const brandInstallQueue = new Queue("brand-install", { connection });

export type BrandInstallJob = { shopId: string; force?: boolean };

export async function enqueueBrandInstall(job: BrandInstallJob) {
  // NO sticky jobId here. `afterAuth` fires once per OAuth grant — repeat
  // installs (uninstall → reinstall) MUST get a fresh brand-install run so
  // the new install gets its muse library + pre-warm. A jobId of
  // `brand-install:<shopId>` would cause BullMQ to silently dedupe against
  // the completed record from the previous install (kept for 50 turns by
  // removeOnComplete), skipping the re-run entirely. The processor itself
  // is idempotent (skips muses + renders that already exist), so re-runs
  // are safe even mid-flight.
  return brandInstallQueue.add("install", job, {
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: 50,
    removeOnFail: 200,
  });
}

// ─── Recommendations roll-up queue (scheduled) ─────────────────────────
// One repeating job per active shop kicks runAllRecommendations() nightly.
export const recommendationsQueue = new Queue("recommendations", { connection });

export type RecommendationsJob = { shopId: string };

export async function enqueueRecommendations(job: RecommendationsJob) {
  return recommendationsQueue.add("run", job, {
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: 20,
    removeOnFail: 100,
  });
}

// ─── Brand DNA catalog extraction queue ────────────────────────────────
// Enqueued on install and after manual brand/catalog refreshes. Worker reads
// the synced catalog and writes BrandProfile palette/tone/style vectors.
export const brandDnaCatalogQueue = new Queue("brand-dna-catalog", { connection });

export type BrandDnaCatalogJob = { shopId: string };

export async function enqueueBrandDnaCatalog(job: BrandDnaCatalogJob, opts?: { jobId?: string }) {
  return brandDnaCatalogQueue.add("extract", job, {
    jobId: opts?.jobId,
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: 20,
    removeOnFail: 100,
  });
}

/**
 * Ensure a nightly recurring job exists for every active shop. Idempotent —
 * BullMQ deduplicates on jobId. Call this on app boot or when a new shop
 * installs (webhook → enqueue here too).
 */
export async function ensureNightlyRecommendations(shopIds: string[]) {
  // Run at 02:30 UTC daily.
  const repeat = { pattern: "30 2 * * *" } as const;
  for (const shopId of shopIds) {
    await recommendationsQueue.add(
      "run",
      { shopId },
      { jobId: `rec-nightly:${shopId}`, repeat, removeOnComplete: 20, removeOnFail: 100 },
    );
  }
}

// ─── VTO render queue ──────────────────────────────────────────────────
// Async render path (OI-33). Jobs are enqueued from tryon.server.ts when
// Redis is available; the worker in apps/worker picks them up.
export const tryonRenderQueue = new Queue("tryon-render", { connection });

export type TryonRenderJob = {
  renderId: string;
  shopId: string;
  productId: string;
  mode: "BODY_MODEL" | "PERSONAL_PHOTO";
  providerKey: string;
  modelHint?: string | null;
  garmentUrl: string;
  personImageBase64?: string;
  personImageMime?: string;
  // BODY_MODEL: the muse archetype image (base64) the app loaded, so the worker
  // composites the garment onto a real body instead of a text-generated model.
  museImageBase64?: string;
  museImageMime?: string;
  hints: {
    title: string | null;
    category: string | null;
    primaryColor: string | null;
    colorFamily: string | null;
  };
};

export async function enqueueTryonRender(job: TryonRenderJob) {
  return tryonRenderQueue.add("render", job, {
    removeOnComplete: 50,
    removeOnFail: 100,
  });
}

// ─── Sentiment-extract queue ────────────────────────────────────────────
// Admin "Analyze now" button + nightly cron in apps/worker both push here.
export const sentimentExtractQueue = new Queue("sentiment-extract", { connection });

export type SentimentExtractJob = { shopId: string };

export async function enqueueSentimentExtract(job: SentimentExtractJob, opts?: { jobId?: string }) {
  return sentimentExtractQueue.add("extract", job, {
    jobId: opts?.jobId,
    attempts: 2,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 50,
    removeOnFail: 200,
  });
}

// ─── Replenishment-notify queue ─────────────────────────────────────────
// Admin "Notify now" button + nightly cron in apps/worker both push here.
// Sends restock reminder emails to opted-in shoppers with items due soon.
export const replenishmentNotifyQueue = new Queue("replenishment-notify", { connection });

export type ReplenishmentNotifyJob = {
  shopId: string;
  /** How many days ahead to look for due items. Defaults to 7. */
  daysAhead?: number;
};

export async function enqueueReplenishmentNotify(
  job: ReplenishmentNotifyJob,
  opts?: { jobId?: string },
) {
  return replenishmentNotifyQueue.add("notify", job, {
    jobId: opts?.jobId,
    attempts: 2,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 50,
    removeOnFail: 200,
  });
}
