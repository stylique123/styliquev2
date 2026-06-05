import "dotenv/config";
import * as http from "node:http";
import { initSentry, reportJobError } from "./sentry.js";

// Initialize Sentry (or the shim) and wire global error listeners before any
// async work begins. initSentry() registers the primary process listeners
// internally; the explicit guards below are defence-in-depth in case the shim
// is later replaced with a real SDK that doesn't register its own listeners.
initSentry();

process.on("unhandledRejection", (reason) => {
  reportJobError(reason, { queue: "unknown", jobId: "unknown", shopId: "unknown" });
});
process.on("uncaughtException", (err) => {
  reportJobError(err, { queue: "unknown", jobId: "unknown", shopId: "unknown" });
  process.exit(1);
});

import { Worker, Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { prisma } from "@stylique/db";
import { processCatalogSync, type CatalogSyncJobData } from "./jobs/catalog-sync.js";
import { processRecommendations, type RecommendationsJobData } from "./jobs/recommendations.js";
import { processCreativeSet, type CreativeSetJobData } from "./jobs/creative-set.js";
import { processImageQuality, type ImageQualityJobData } from "./jobs/image-quality.js";
import { processBrandInstall, type BrandInstallJobData } from "./jobs/brand-install.js";
import { processTryOnRender, type TryOnRenderJobData } from "./jobs/tryon-render.js";
import { processSentimentExtract, type SentimentJobData } from "./jobs/sentiment-extract.js";
import { processSizeChartExtract, type SizeChartExtractJobData } from "./jobs/size-chart-extract.js";
import { processBrandInstagram, type BrandInstagramJobData } from "./jobs/brand-instagram.js";
import { processBrandDnaCatalog, type BrandDnaCatalogJobData } from "./jobs/brand-dna-catalog.js";
import { processReplenishmentNotify, type ReplenishmentNotifyJobData } from "./jobs/replenishment-notify.js";
import { createOutcomeResolverWorker, scheduleOutcomeResolver } from "./jobs/outcome-resolver.js";
import { createBillingReconcileWorker, scheduleBillingReconcile } from "./workers/billing-reconcile.worker.js";
import { handleFailedJob } from "./dead-letter.js";
import { startScheduler } from "./scheduler.js";

const REQUIRED_ENV = ["DATABASE_URL", "REDIS_URL", "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET"] as const;
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`[worker] missing required env: ${missingEnv.join(", ")}`);
  console.error("[worker] start from the repo root with: pnpm dev:worker");
  process.exit(1);
}

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const catalogWorker = new Worker<CatalogSyncJobData>(
  "catalog-sync",
  async (job) => {
    console.log(`[catalog-sync] ${job.name} shop=${job.data.shopId}`);
    return processCatalogSync(job.data);
  },
  { connection, concurrency: 4 },
);

const recommendationsWorker = new Worker<RecommendationsJobData>(
  "recommendations",
  async (job) => {
    console.log(`[recommendations] shop=${job.data.shopId}`);
    return processRecommendations(job.data);
  },
  { connection, concurrency: 2 },
);

// Studio creative-set worker — stub until provider is chosen. Marks rows as
// FAILED("studio_provider_not_configured") so the brand sees a real state
// instead of "generating…" forever.
const creativeSetWorker = new Worker<CreativeSetJobData>(
  "creative-set",
  async (job) => {
    console.log(`[creative-set] shop=${job.data.shopId} set=${job.data.setId}`);
    return processCreativeSet(job.data);
  },
  { connection, concurrency: 2 },
);

// Shared Queue handle for enqueueing tryon-render jobs from within brand-install.
// Using a Queue (not a Worker) keeps the connection lightweight — one shared IORedis
// connection instead of a private connection created per job invocation (D-2 fix).
const tryonQueue = new Queue("tryon-render", { connection });

// Brand-install worker (D38a-r1) — runs once per shop on first OAuth.
// Generates the 12-muse library + pre-warms top-50 product renders.
// Concurrency 1 — heavy outbound API work, no need to parallelize across
// brands installing in the same minute.
const brandInstallWorker = new Worker<BrandInstallJobData>(
  "brand-install",
  async (job) => {
    console.log(`[brand-install] shop=${job.data.shopId}`);
    return processBrandInstall(job.data, tryonQueue);
  },
  { connection, concurrency: 1 },
);

// VTO render worker (OI-33 / OI-32 / OI-31) — decouples the provider call from
// the HTTP request. concurrency 3 so Gemini-Image renders run in parallel
// without starving other workers.
const tryonRenderWorker = new Worker<TryOnRenderJobData>(
  "tryon-render",
  async (job) => {
    console.log(`[tryon-render] ${job.data.renderId} shop=${job.data.shopId}`);
    return processTryOnRender(job.data);
  },
  { connection, concurrency: 3 },
);

// Sentiment extraction worker — analyzes shopper chat history with Gemini to
// produce per-session sentiment labels, themes, and summaries. Concurrency 1
// to respect Gemini rate limits; nightly schedule at 02:45 UTC (15 min after
// recommendations so both don't burst simultaneously).
const sentimentWorker = new Worker<SentimentJobData>(
  "sentiment-extract",
  async (job) => {
    console.log(`[sentiment] shop=${job.data.shopId}`);
    return processSentimentExtract(job.data);
  },
  { connection, concurrency: 1 }, // low concurrency — Gemini rate limits
);

// Size-chart extraction worker (D39) — runs multi-source extraction pipeline
// for a single product: variant metafield → JSON metafield → HTML metafield →
// description HTML → linked page → image OCR. Writes the best result to
// Product.sizeChartJson. Concurrency 2 to balance Gemini Vision rate limits.
const sizeChartWorker = new Worker<SizeChartExtractJobData>(
  "size-chart-extract",
  async (job) => {
    console.log(`[size-chart] shop=${job.data.shopId} product=${job.data.productId}`);
    return processSizeChartExtract(job.data);
  },
  { connection, concurrency: 2 },
);

// Image-quality worker (D37) — runs Stage 1 heuristic filter + optional
// Stage 2 (AWS Rekognition) over a shop's ProductImage rows, writes
// primaryTryonImageId / tryonReady / widgetTier on Product. Concurrency
// capped at 2 so we don't saturate the Shopify CDN with HEAD probes.
const imageQualityWorker = new Worker<ImageQualityJobData>(
  "image-quality",
  async (job) => {
    console.log(`[image-quality] shop=${job.data.shopId} product=${job.data.productId ?? "all"}`);
    return processImageQuality(job.data);
  },
  { connection, concurrency: 2 },
);

// Brand DNA catalog worker — extracts aesthetic DNA from a shop's top 30
// products via Gemini Vision, writes BrandProfile. Concurrency 1 (heavy
// outbound API work, rate-limit safe).
const brandDnaCatalogWorker = new Worker<BrandDnaCatalogJobData>(
  "brand-dna-catalog",
  async (job) => {
    console.log(`[brand-dna-catalog] shop=${job.data.shopId}`);
    return processBrandDnaCatalog(job.data);
  },
  { connection, concurrency: 1 },
);

// Brand Instagram worker — processes an uploaded Instagram ZIP archive,
// extracts visual DNA from post images, merges into BrandProfile. Concurrency 1.
const brandInstagramWorker = new Worker<BrandInstagramJobData>(
  "brand-instagram",
  async (job) => {
    console.log(`[brand-instagram] shop=${job.data.shopId}`);
    return processBrandInstagram(job.data);
  },
  { connection, concurrency: 1 },
);

// Replenishment notification worker — sends restock reminder emails to opted-in
// shoppers whose beauty/care products are due within 7 days. Concurrency 2:
// each run does one batch of DB reads + outbound email calls per shop, no heavy
// compute; two concurrent runs lets us email two shops simultaneously without
// blocking on Resend/SMTP latency.
const replenishmentNotifyWorker = new Worker<ReplenishmentNotifyJobData>(
  "replenishment-notify",
  async (job) => {
    console.log(`[replenishment-notify] shop=${job.data.shopId}`);
    return processReplenishmentNotify(job.data);
  },
  { connection, concurrency: 2 },
);

// Outcome resolver worker — nightly MEASURE→LEARN sweep. Resolves every Outcome
// whose resolution window has elapsed, classifies the result, fires
// OUTCOME_RESOLVED, and feeds the per-shop recommendation-weight map.
const outcomeResolverWorker = createOutcomeResolverWorker(connection);

// Billing reconcile worker — daily subscription health check at 04:00 UTC.
// Verifies Shopify AppSubscription status per shop; downgrades to FREE on
// cancellation/expiry and emits SUBSCRIPTION_CANCELLED. Idempotent.
const billingReconcileWorker = createBillingReconcileWorker(connection);

// ─── On boot: ensure every active shop has a nightly recurring job ──────
// BullMQ deduplicates on jobId, so this is safe to run on every worker
// restart. Runs at 02:30 UTC daily.
const recommendationsQueue = new Queue("recommendations", { connection });
const sentimentQueue = new Queue("sentiment-extract", { connection });
const sizeChartQueue = new Queue("size-chart-extract", { connection });
const creativeSetQueue = new Queue("creative-set", { connection });
const replenishmentNotifyQueue = new Queue("replenishment-notify", { connection });

async function scheduleNightlyRecommendations() {
  const shops = await prisma.shop.findMany({
    where: { uninstalledAt: null },
    select: { id: true, shopifyDomain: true },
  });
  for (const shop of shops) {
    await recommendationsQueue.add(
      "run",
      { shopId: shop.id },
      {
        jobId: `rec-nightly:${shop.id}`,
        repeat: { pattern: "30 2 * * *" },
        removeOnComplete: 20,
        removeOnFail: 100,
      },
    );
    await sentimentQueue.add(
      "extract",
      { shopId: shop.id },
      {
        jobId: `sentiment-nightly:${shop.id}`,
        repeat: { pattern: "45 2 * * *" },
        removeOnComplete: 20,
        removeOnFail: 100,
      },
    );
    // Replenishment notify at 10:00 AM UTC — morning send time fits "restock
    // before I run out today" shopper behaviour. 30-min stagger from sentiment
    // (02:45) so the two Gemini-heavy jobs don't burst simultaneously.
    await replenishmentNotifyQueue.add(
      "notify",
      { shopId: shop.id, daysAhead: 7 },
      {
        jobId: `replenishment-nightly:${shop.id}`,
        repeat: { pattern: "0 10 * * *" },
        removeOnComplete: 20,
        removeOnFail: 100,
      },
    );
  }
  console.log(`✓ Scheduled nightly recommendations for ${shops.length} shop(s)`);
  console.log(`✓ Scheduled nightly sentiment extraction for ${shops.length} shop(s)`);
  console.log(`✓ Scheduled nightly replenishment notifications for ${shops.length} shop(s)`);
}
void scheduleNightlyRecommendations().catch((e) => {
  console.error("Failed to schedule nightly recommendations:", e);
});

// Nightly outcome resolver at 03:00 UTC. Idempotent (BullMQ dedupes on jobId).
void scheduleOutcomeResolver(connection).catch((e) => {
  console.error("Failed to schedule nightly outcome resolver:", e);
});

// Daily billing reconcile at 04:00 UTC. Idempotent (BullMQ dedupes on jobId).
void scheduleBillingReconcile(connection).catch((e) => {
  console.error("Failed to schedule billing reconcile:", e);
});

// ─── Content calendar: hourly check for scheduled creative sets ─────────
// CreativeSets stored with providerMeta.scheduledFor (ISO string) are picked
// up within one hour of their scheduled time. Jobs already in a non-PENDING
// state are skipped by the worker (step 0 guard).
async function enqueueScheduledCreativeSets() {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Find PENDING sets with scheduledFor in the past hour.
  const pendingSets = await prisma.creativeSet.findMany({
    where: { status: "PENDING" },
    select: {
      id: true,
      shopId: true,
      productId: true,
      triggeredBy: true,
      brief: true,
      providerMeta: true,
    },
    take: 100, // cap per tick
  });

  let enqueued = 0;
  for (const set of pendingSets) {
    const meta = set.providerMeta as Record<string, unknown> | null;
    if (!meta?.scheduledFor) continue;
    const scheduledFor = new Date(meta.scheduledFor as string);
    if (isNaN(scheduledFor.getTime())) continue;
    // Only enqueue if scheduledFor is in the window [oneHourAgo, now].
    if (scheduledFor > now || scheduledFor < oneHourAgo) continue;

    const brief = (set.brief as Record<string, unknown> | null)?.text as string | undefined;
    const kind = (meta.kind as string | undefined) as import("@stylique/core").CreativeOutputKind | undefined;

    await creativeSetQueue.add(
      "generate",
      {
        shopId: set.shopId,
        setId: set.id,
        productId: set.productId ?? "",
        triggeredBy: set.triggeredBy ?? "scheduled",
        brief,
        kind,
      },
      {
        jobId: `scheduled-creative:${set.id}`,
        removeOnComplete: 20,
        removeOnFail: 100,
      },
    ).catch(() => { /* best effort — already queued is fine */ });
    enqueued++;
  }

  if (enqueued > 0) {
    console.log(`[content-calendar] enqueued ${enqueued} scheduled creative set(s)`);
  }
}

// Run once on boot then every hour via setInterval.
void enqueueScheduledCreativeSets().catch((e) => {
  console.error("[content-calendar] initial scan failed:", e);
});
setInterval(() => {
  void enqueueScheduledCreativeSets().catch((e) => {
    console.error("[content-calendar] hourly scan failed:", e);
  });
}, 60 * 60 * 1000);

catalogWorker.on("failed", async (job, err) => {
  console.error(`[catalog-sync] failed`, job?.id, err);
  if (!job) return;
  try {
    await prisma.notification.create({
      data: { shopId: job.data.shopId, kind: "CATALOG_SYNC_FAILED", payload: { error: err.message, jobId: job.id } },
    });
  } catch { /* best effort */ }
  void handleFailedJob(catalogWorker.name, job, err, connection);
});

// ─── Dead-letter handler wired to all remaining workers ──────────────────────
// catalogWorker already has its own failed handler above (writes a Notification
// row in addition to the DLQ entry). All other workers get the generic handler.
for (const [worker, name] of [
  [recommendationsWorker,      "recommendations"],
  [creativeSetWorker,          "creative-set"],
  [brandInstallWorker,         "brand-install"],
  [tryonRenderWorker,          "tryon-render"],
  [sentimentWorker,            "sentiment-extract"],
  [sizeChartWorker,            "size-chart-extract"],
  [imageQualityWorker,         "image-quality"],
  [brandDnaCatalogWorker,      "brand-dna-catalog"],
  [brandInstagramWorker,       "brand-instagram"],
  [replenishmentNotifyWorker,  "replenishment-notify"],
  [outcomeResolverWorker,      "outcome-resolver"],
  [billingReconcileWorker,     "billing-reconcile"],
] as const) {
  (worker as { on: (event: string, cb: (...args: unknown[]) => void) => void }).on(
    "failed",
    (job: unknown, err: unknown) => {
      void handleFailedJob(
        name,
        job as Parameters<typeof handleFailedJob>[1],
        err as Error,
        connection,
      );
    },
  );
}

console.log("✓ Stylique worker started");
console.log(
  "✓ Active workers:",
  [
    "catalog-sync",
    "recommendations",
    "creative-set",
    "brand-install",
    "tryon-render",
    "sentiment-extract",
    "size-chart-extract",
    "image-quality",
    "brand-dna-catalog",
    "brand-instagram",
    "replenishment-notify",
    "outcome-resolver",
    "billing-reconcile",
  ].join(", "),
);

// ─── Register global repeatable jobs (idempotent) ────────────────────────────
void startScheduler(connection).catch((err) => {
  console.error("[scheduler] startup error:", (err as Error).message);
});

// ─── Health check HTTP server ────────────────────────────────────────────────
// Exposes GET /health (and GET /) with live BullMQ queue counts so uptime
// monitors and orchestrators can detect a stuck worker.
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 3001);

// Read-only Queue handles for the health endpoint — Workers don't expose
// getJobCounts() directly, so we create lightweight Queue clients on the same
// connection for the three most-critical queues.
const healthQueues = {
  "catalog-sync": new Queue("catalog-sync", { connection }),
  "tryon-render": tryonQueue, // reuse the shared Queue (no extra connection)
  recommendations: new Queue("recommendations", { connection }),
  "creative-set": new Queue("creative-set", { connection }),
  "sentiment-extract": new Queue("sentiment-extract", { connection }),
  "size-chart-extract": new Queue("size-chart-extract", { connection }),
  "image-quality": new Queue("image-quality", { connection }),
  "brand-install": new Queue("brand-install", { connection }),
  "brand-dna-catalog": new Queue("brand-dna-catalog", { connection }),
  "brand-instagram": new Queue("brand-instagram", { connection }),
  "replenishment-notify": new Queue("replenishment-notify", { connection }),
  "outcome-resolver": new Queue("outcome-resolver", { connection }),
  "billing-reconcile": new Queue("billing-reconcile", { connection }),
};

const healthServer = http.createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  const url = req.url?.split("?")[0];
  if (url !== "/health" && url !== "/") {
    res.writeHead(404);
    res.end();
    return;
  }

  try {
    const counts = await Promise.all(
      Object.entries(healthQueues).map(async ([name, q]) => {
        const c = await q.getJobCounts("waiting", "active", "failed");
        return [name, c] as const;
      }),
    );
    const queues = Object.fromEntries(counts);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, queues }));
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "redis_unavailable" }));
  }
});

healthServer.listen(HEALTH_PORT, () => {
  console.log(`[worker-health] listening on :${HEALTH_PORT}`);
});

async function shutdown() {
  console.log("Shutting down worker…");
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  await Promise.all(Object.values(healthQueues).map((q) => q.close()));
  await catalogWorker.close();
  await recommendationsWorker.close();
  await creativeSetWorker.close();
  await imageQualityWorker.close();
  await brandInstallWorker.close();
  await tryonRenderWorker.close();
  await sentimentWorker.close();
  await sizeChartWorker.close();
  await brandDnaCatalogWorker.close();
  await brandInstagramWorker.close();
  await replenishmentNotifyWorker.close();
  await outcomeResolverWorker.close();
  await billingReconcileWorker.close();
  await recommendationsQueue.close();
  await sentimentQueue.close();
  await sizeChartQueue.close();
  await creativeSetQueue.close();
  await replenishmentNotifyQueue.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
