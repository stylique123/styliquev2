// Billing reconciliation worker — daily subscription health check.
//
// Queue: billing-reconcile
// Schedule: 04:00 UTC daily (after recommendations at 02:30 and outcome resolver
// at 03:00 so all nightly Gemini-heavy jobs have cleared before this run).
//
// For each active shop this worker:
//   1. Queries Shopify AppSubscription GraphQL to verify the subscription is
//      still ACTIVE.
//   2. If the subscription has been cancelled / expired: downgrades the shop's
//      Plan to FREE tier in the DB and emits a SUBSCRIPTION_CANCELLED event.
//   3. If the subscription is active: no-op (idempotent, safe to run daily).
//
// Processes one shopId at a time (serialised by BullMQ queue — see scheduler).

import { prisma, Prisma } from "@stylique/db";
import { PLAN_FEATURES } from "@stylique/core";
import { Worker, Queue } from "bullmq";
import type { Redis as IORedisClient } from "ioredis";
import { createDecipheriv } from "node:crypto";

// Inline decryptField — the worker can't import from apps/shopify-app.
// Mirrors apps/shopify-app/app/lib/crypto.server.ts exactly.
function decryptField(value: string): string {
  const KEY_HEX = process.env.APP_ENCRYPTION_KEY ?? "";
  if (!KEY_HEX || KEY_HEX.length < 64 || !value.startsWith("enc:")) return value;
  try {
    const key = Buffer.from(KEY_HEX.slice(0, 64), "hex");
    const buf = Buffer.from(value.slice(4), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", new Uint8Array(key), new Uint8Array(iv));
    decipher.setAuthTag(new Uint8Array(tag));
    return decipher.update(new Uint8Array(enc)).toString("utf8") + decipher.final("utf8");
  } catch { return value; }
}

// ─── Types ────────────────────────────────────────────────────────────────

export type BillingReconcileJobData = {
  shopId: string;
};

export type BillingReconcileResult = {
  shopId: string;
  status: "active" | "cancelled" | "error" | "skipped";
  message?: string;
};

const QUEUE_NAME = "billing-reconcile";

// ─── Core processor ───────────────────────────────────────────────────────

export async function processBillingReconcile(
  data: BillingReconcileJobData,
): Promise<BillingReconcileResult> {
  const { shopId } = data;

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true, shopifyDomain: true, accessToken: true, uninstalledAt: true },
  });

  if (!shop || shop.uninstalledAt) {
    // Shop is uninstalled — skip reconciliation.
    return { shopId, status: "skipped", message: "shop_uninstalled" };
  }

  let accessToken: string | undefined;
  try {
    // accessToken may be AES-GCM encrypted (OI-25). Decrypt if APP_ENCRYPTION_KEY set.
    accessToken = shop.accessToken
      ? decryptField(shop.accessToken)
      : undefined;
  } catch {
    accessToken = shop.accessToken ?? undefined;
  }

  if (!accessToken) {
    console.warn(`[billing-reconcile] no accessToken for shop ${shopId} — skipping`);
    return { shopId, status: "skipped", message: "no_access_token" };
  }

  // ── Query Shopify for activeSubscriptions ─────────────────────────────
  let subscriptionActive = false;
  try {
    const endpoint = `https://${shop.shopifyDomain}/admin/api/2025-01/graphql.json`;
    const query = `{
      currentAppInstallation {
        activeSubscriptions {
          id
          status
        }
      }
    }`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      throw new Error(`Shopify responded ${res.status}`);
    }

    const json = (await res.json()) as {
      data?: {
        currentAppInstallation?: {
          activeSubscriptions?: Array<{ id: string; status: string }>;
        };
      };
      errors?: unknown;
    };

    if (json.errors) {
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    const subs = json.data?.currentAppInstallation?.activeSubscriptions ?? [];
    subscriptionActive = subs.some((s) => s.status === "ACTIVE");
  } catch (err) {
    console.error(
      `[billing-reconcile] Shopify query failed for shop ${shopId}:`,
      (err as Error).message,
    );
    return { shopId, status: "error", message: (err as Error).message };
  }

  if (subscriptionActive) {
    // Nothing to do — subscription is healthy.
    return { shopId, status: "active" };
  }

  // ── Subscription cancelled — downgrade to FREE tier ──────────────────
  console.log(`[billing-reconcile] subscription CANCELLED for shop ${shopId} — downgrading to FREE`);

  try {
    const existing = await prisma.plan.findUnique({
      where: { shopId },
      select: { planFeaturesJson: true },
    });
    const current = (existing?.planFeaturesJson as Record<string, unknown> | null) ?? {};
    const nextFeatures = { ...current };
    delete nextFeatures.billingActive;
    nextFeatures.billing = {
      ...(typeof current.billing === "object" && current.billing ? current.billing as Record<string, unknown> : {}),
      status: "CANCELLED",
      active: false,
      reconciledAt: new Date().toISOString(),
    };
    const nextFeaturesJson = nextFeatures as Prisma.InputJsonValue;

    const starter = PLAN_FEATURES.STARTER;
    // Update or create the Plan row — downgrade to STARTER (the minimum tier).
    // There is no FREE tier in the schema; STARTER is the base entitlement.
    // Preserve non-billing overrides (stylist voice, provider, policy, tuning)
    // so cancellation does not erase merchant configuration.
    await prisma.plan.upsert({
      where: { shopId },
      create: {
        shopId,
        tier: "STARTER",
        monthlyTryOnPersonal: starter.widget.monthlyTryOnPersonal,
        monthlyTryOnBody: starter.widget.monthlyTryOnBody,
        monthlyStylistTurns: starter.stylist.monthlyTurns,
        monthlyStyleRecs: starter.widget.monthlyStyleRecs,
        monthlyFitRecs: starter.widget.monthlyFitRecs,
        analyticsLevel: starter.analytics.level,
        planFeaturesJson: nextFeaturesJson,
      },
      update: {
        tier: "STARTER",
        monthlyTryOnPersonal: starter.widget.monthlyTryOnPersonal,
        monthlyTryOnBody: starter.widget.monthlyTryOnBody,
        monthlyStylistTurns: starter.stylist.monthlyTurns,
        monthlyStyleRecs: starter.widget.monthlyStyleRecs,
        monthlyFitRecs: starter.widget.monthlyFitRecs,
        analyticsLevel: starter.analytics.level,
        planFeaturesJson: nextFeaturesJson,
      },
    });

    // Emit SUBSCRIPTION_CANCELLED analytics event.
    await prisma.analyticsEvent.create({
      data: {
        shopId,
        name: "SUBSCRIPTION_CANCELLED" as any,
        payload: {
          previousAction: "billing-reconcile",
          downgradedTo: "STARTER",
          timestamp: new Date().toISOString(),
        },
      },
    });

    console.log(`[billing-reconcile] shop ${shopId} downgraded to STARTER tier`);
    return { shopId, status: "cancelled", message: "downgraded_to_starter" };
  } catch (err) {
    console.error(
      `[billing-reconcile] downgrade write failed for shop ${shopId}:`,
      (err as Error).message,
    );
    return { shopId, status: "error", message: (err as Error).message };
  }
}

// ─── BullMQ Worker factory ────────────────────────────────────────────────

export function createBillingReconcileWorker(
  connection: IORedisClient,
): Worker<BillingReconcileJobData> {
  return new Worker<BillingReconcileJobData>(
    QUEUE_NAME,
    async (job) => {
      console.log(`[billing-reconcile] processing shop=${job.data.shopId}`);
      return processBillingReconcile(job.data);
    },
    {
      connection,
      // One at a time — Shopify rate limits are per-shop; no value in parallel.
      concurrency: 1,
    },
  );
}

// ─── Scheduler ────────────────────────────────────────────────────────────

/**
 * Schedule one billing-reconcile job per active shop at 04:00 UTC daily.
 * Idempotent — BullMQ deduplicates on jobId so calling this on every worker
 * boot is safe.
 */
export async function scheduleBillingReconcile(
  connection: IORedisClient,
): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection });

  const shops = await prisma.shop.findMany({
    where: { uninstalledAt: null },
    select: { id: true },
  });

  for (const shop of shops) {
    await queue.add(
      "reconcile",
      { shopId: shop.id },
      {
        jobId: `billing-reconcile:${shop.id}`,
        repeat: { pattern: "0 4 * * *" },
        removeOnComplete: 20,
        removeOnFail: 100,
      },
    );
  }

  console.log(
    `✓ Scheduled daily billing reconciliation for ${shops.length} shop(s) (04:00 UTC)`,
  );
}
