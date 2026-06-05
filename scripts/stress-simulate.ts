// Stress simulation — 1000 shoppers × 1 year of synthetic activity.
//
// What this does (and doesn't):
//   ✅ Inserts synthetic ShopperSession + AnalyticsEvent + ProductAudit rows
//      spread realistically over the past 365 days.
//   ✅ Runs the FULL server-side pipeline against that data:
//        taste vector recompute → brand snapshot → network benchmark
//        → recommendations engine → dashboard overview
//   ✅ Times each phase and reports.
//   ❌ Does NOT call Gemini (conversation quality is a separate test).
//   ❌ Does NOT exercise the HTTP layer (that needs the app + tunnel running).
//
// Run with:
//   pnpm dlx dotenv-cli -e .env -- pnpm --filter @stylique/db exec npx tsx ../../scripts/stress-simulate.ts
// or, from repo root:
//   pnpm dlx dotenv-cli -e .env -- npx tsx scripts/stress-simulate.ts

import { prisma } from "@stylique/db";
import { createRecommendationsService } from "@stylique/core";
import { createHash } from "node:crypto";

// Silence the query log so we can read the output.
process.env.DEBUG = "";

// ─── Config ────────────────────────────────────────────────────────────
const SHOPPER_COUNT = Number(process.env.SIM_SHOPPERS ?? "1000");
const DAYS_WINDOW = 365;
const DAY_MS = 86_400_000;
const NOW = Date.now();

// Deterministic PRNG (mulberry32) so runs are reproducible.
function rng(seed: number) {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rand: () => number, arr: T[]): T { return arr[Math.floor(rand() * arr.length)]!; }
function pickWeighted<T>(rand: () => number, arr: Array<[T, number]>): T {
  const total = arr.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [v, w] of arr) { if ((r -= w) <= 0) return v; }
  return arr[0][0];
}

// ─── Phase timer ────────────────────────────────────────────────────────
function phase<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return (async () => {
    const t0 = Date.now();
    process.stdout.write(`[${label}]… `);
    try {
      const out = await fn();
      const dt = Date.now() - t0;
      console.log(`✓ ${dt}ms`);
      return out;
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`);
      throw err;
    }
  })();
}

// ─── Realistic distributions ───────────────────────────────────────────
const BODY_TYPES = ["PETITE", "SLIM", "REGULAR", "CURVY", "PLUS", "TALL"];
const FIT_PREFS  = ["FITTED", "REGULAR", "RELAXED", "OVERSIZED"];
const MOODS      = ["luxury-neutral", "monochrome", "soft-editorial", "bold-contrast", "streetwear-dark"];
const MODELS     = ["ava", "lina", "noor", "maya", "zara", "elena"];

// Realistic event mix per active session (some sessions are just opens, some convert).
type EventSpec = { name: string; weight: number; needsProduct?: boolean; payload?: (rand: () => number) => Record<string, unknown> };
const EVENT_MIX: EventSpec[] = [
  { name: "CHAT_OPENED",         weight: 100, payload: () => ({ surface: "dock" }) },
  { name: "CHAT_MESSAGE_SENT",   weight: 75,  payload: (r) => ({ length: 30 + Math.floor(r() * 80) }) },
  { name: "CHAT_SEARCH_RUN",     weight: 70,  payload: (r) => ({ query: pick(r, ["brunch outfit","wedding guest","work tailored","weekend casual","linen something","cream linen pants","cool blazer","date night"]), resultCount: Math.floor(r()*8), gap: r() < 0.25 }) },
  { name: "CHAT_COMBO_PROPOSED", weight: 45,  payload: (r) => ({ comboName: pick(r, ["Brunch in good light","After-dark for the slip","Sunday energy","Studio Monday","First-date easy","Quiet luxury"]), productIds: ["__placeholder"], reasoning: "stress sim" }) },
  { name: "CHAT_PRODUCT_CLICKED",weight: 30,  needsProduct: true, payload: (r) => ({ productHandle: "p" + Math.floor(r()*1000) }) },
  { name: "CHAT_CART_REQUESTED", weight: 18,  needsProduct: true, payload: (r) => ({ productId: "p" + Math.floor(r()*1000), suggestedSize: pick(r,["XS","S","M","L"]) }) },
  { name: "CART_CONFIRMED",      weight: 12,  needsProduct: true, payload: (r) => ({ productId: "p" + Math.floor(r()*1000), size: pick(r,["S","M","L"]), qty: 1 }) },
  { name: "CART_CANCELLED",      weight: 6,   needsProduct: true, payload: () => ({ productId: "placeholder" }) },
  { name: "WIDGET_OPENED",       weight: 35,  payload: () => ({ productHandle: "p", placement: "floating" }) },
  { name: "WIDGET_MOOD_SELECTED",weight: 22,  payload: (r) => ({ moodId: pick(r, MOODS) }) },
  { name: "WIDGET_MODEL_SELECTED",weight: 18, payload: (r) => ({ modelId: pick(r, MODELS) }) },
  { name: "WIDGET_FIT_SUBMITTED", weight: 14, needsProduct: true, payload: (r) => ({
    heightCm: 155 + Math.floor(r()*30), weightKg: 50 + Math.floor(r()*40),
    fitPreference: pick(r, FIT_PREFS), bodyType: pick(r, BODY_TYPES),
    recommendedSize: pick(r, ["S","M","L"]), confidence: 0.5 + r()*0.5,
  })},
  { name: "WIDGET_STYLE_VIEWED",  weight: 10, needsProduct: true, payload: (r) => ({ anchorProductId: "p" + Math.floor(r()*1000), itemCount: 2 + Math.floor(r()*3) }) },
  { name: "SIZE_SELECTED",        weight: 8,  needsProduct: true, payload: (r) => ({ chosenSize: pick(r,["S","M","L"]), recommendedSize: pick(r,["S","M","L"]), sizeDelta: Math.floor(r()*3) - 1 }) },
  { name: "SIGNUP_OFFERED",       weight: 6,  payload: () => ({ reason: "stress sim" }) },
  { name: "SIGNUP_CLAIMED",       weight: 2,  payload: (r) => ({ marketingOptIn: r() < 0.4 }) },
];

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  Stylique stress simulation`);
  console.log(`  ${SHOPPER_COUNT} synthetic shoppers × ${DAYS_WINDOW} days`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // ─── Find or create the test shop ────────────────────────────────────
  const shop = await phase("setup shop", async () => {
    const existing = await prisma.shop.findFirst({
      where: { shopifyDomain: { contains: "stylique-dev" } },
    });
    if (existing) return existing;
    // Fall back to first shop in DB
    const any = await prisma.shop.findFirst();
    if (any) return any;
    throw new Error("No shop in DB. Install the app on a Shopify dev store first.");
  });

  const productIds = await phase("load product ids", async () => {
    const products = await prisma.product.findMany({
      where: { shopId: shop.id }, select: { id: true }, take: 200,
    });
    if (products.length === 0) {
      console.log("  (no products — events will be productless)");
    }
    return products.map((p) => p.id);
  });

  console.log(`  shop=${shop.shopifyDomain} products=${productIds.length}\n`);

  // ─── Phase 0: cleanup any leftover synthetic data ────────────────────
  await phase("cleanup leftover synthetic data from prior runs", async () => {
    const leftover = await prisma.shopperSession.findMany({
      where: { sessionId: { startsWith: "sim-" } },
      select: { id: true },
    });
    if (!leftover.length) return { deleted: 0 };
    const ids = leftover.map((s) => s.id);
    await prisma.analyticsEvent.deleteMany({ where: { shopperId: { in: ids } } });
    await prisma.catalogGap.deleteMany({ where: { source: "stress_sim" } });
    await prisma.brandRecommendation.deleteMany({ where: { source: { in: ["catalog_gap","pdp_audit","fit_accuracy","stylist_combo","mood","cross"] } } });
    await prisma.shopperSession.deleteMany({ where: { id: { in: ids } } });
    return { deleted: ids.length };
  });

  // ─── Phase 1: generate synthetic shoppers + sessions + events ────────
  const created = await phase(`insert ${SHOPPER_COUNT} synthetic shoppers + events`, async () => {
    let shopperCount = 0;
    let eventCount = 0;
    let auditCount = 0;
    let gapCount = 0;

    // Bucket events into batches of 1000 for createMany.
    let eventBatch: Array<Parameters<typeof prisma.analyticsEvent.createMany>[0]["data"]>[number] = [] as any;
    eventBatch = [];
    const FLUSH = 1000;

    const flush = async () => {
      if (!eventBatch.length) return;
      await prisma.analyticsEvent.createMany({ data: eventBatch as any });
      eventCount += eventBatch.length;
      eventBatch = [];
    };

    for (let i = 0; i < SHOPPER_COUNT; i++) {
      const rand = rng(0xC0FFEE + i);

      // Shopper has roughly log-normal session count: most have 1-3, some have 10-30.
      const sessionsThisYear = Math.max(1, Math.floor(Math.exp(rand() * 3 + 0.3)));

      // 20% have account claimed, 10% have signupOffered without claim.
      const accountClaimed = rand() < 0.2;
      const signupOffered  = !accountClaimed && rand() < 0.15;

      // Some have body/fit profile saved (mix of widget submit + chat capture).
      const hasProfile = rand() < 0.55;

      const shopperRow = await prisma.shopperSession.create({
        data: {
          sessionId: `sim-${i.toString(36)}-${createHash("sha256").update(`sim:${i}`).digest("hex").slice(0,12)}`,
          shopifyDomain: shop.shopifyDomain,
          bodyType:      hasProfile ? pick(rand, BODY_TYPES) : null,
          heightCm:      hasProfile ? 155 + Math.floor(rand()*30) : null,
          weightKg:      hasProfile ? 50  + Math.floor(rand()*40) : null,
          fitPreference: hasProfile ? (pick(rand, FIT_PREFS) as any) : null,
          email:           accountClaimed ? `sim+${i}@stress.test` : null,
          displayName:     accountClaimed ? pick(rand, ["Sarah","Mira","Aliya","Zoe","Ava","Lina","Noor","Maya"]) : null,
          accountClaimedAt: accountClaimed ? new Date(NOW - Math.floor(rand() * DAYS_WINDOW * DAY_MS)) : null,
          signupOfferedAt:  signupOffered ? new Date(NOW - Math.floor(rand() * DAYS_WINDOW * DAY_MS)) : null,
          createdAt:        new Date(NOW - Math.floor(rand() * DAYS_WINDOW * DAY_MS)),
        },
        select: { id: true },
      });
      shopperCount++;

      // Spread sessions over the year, with recency bias (more recent activity).
      for (let s = 0; s < sessionsThisYear; s++) {
        const daysAgo = Math.floor(Math.pow(rand(), 1.7) * DAYS_WINDOW);
        const sessionStart = NOW - daysAgo * DAY_MS - Math.floor(rand() * 12 * 3600_000);

        // Per session: 5-25 events.
        const eventsThisSession = 5 + Math.floor(rand() * 20);
        for (let e = 0; e < eventsThisSession; e++) {
          const spec = pickWeighted(rand, EVENT_MIX.map((es) => [es, es.weight] as [EventSpec, number]));
          const productId = spec.needsProduct && productIds.length
            ? pick(rand, productIds) : null;
          const at = new Date(sessionStart + e * 30_000 + Math.floor(rand() * 30_000));
          eventBatch.push({
            shopId: shop.id, shopperId: shopperRow.id,
            name: spec.name as any,
            productId,
            payload: spec.payload?.(rand) ?? {},
            createdAt: at,
            url: null, userAgent: null, variantId: null, variantTag: null,
          });

          // Catalog gap rows when CHAT_SEARCH_RUN with gap=true
          if (spec.name === "CHAT_SEARCH_RUN" && (eventBatch[eventBatch.length-1] as any).payload?.gap) {
            const q = (eventBatch[eventBatch.length-1] as any).payload?.query ?? "";
            if (q) {
              await prisma.catalogGap.create({
                data: {
                  shopId: shop.id, shopperId: shopperRow.id,
                  rawQuery: q,
                  normalizedQuery: q.toLowerCase().split(/\s+/).sort().join(" "),
                  resultCount: 0, source: "stress_sim",
                  createdAt: at,
                },
              }).catch(() => undefined);
              gapCount++;
            }
          }

          if (eventBatch.length >= FLUSH) await flush();
        }
      }

      // 10% of shoppers get a ProductAudit — but the audit table is keyed by
      // (shopId, productId) unique, so we upsert. Real product code does the
      // same via the catalog-audit worker.
      if (productIds.length && rand() < 0.1) {
        const pid = pick(rand, productIds);
        await prisma.productAudit.upsert({
          where: { shopId_productId: { shopId: shop.id, productId: pid } },
          create: {
            shopId: shop.id,
            productId: pid,
            weakImageQuality: rand() < 0.5,
            missingTryOnReady: rand() < 0.3,
            missingStyling: rand() < 0.3,
            recommendations: { items: [] },
            priorityScore: rand(),
          },
          update: { priorityScore: rand() },
        }).catch(() => undefined);
        auditCount++;
      }

      if ((i + 1) % 100 === 0) {
        process.stdout.write(`\n    ${i + 1}/${SHOPPER_COUNT} shoppers · ${eventCount + eventBatch.length} events · ${gapCount} gaps · ${auditCount} audits…`);
      }
    }
    await flush();
    console.log(`\n    final: ${shopperCount} shoppers, ${eventCount} events, ${gapCount} gaps, ${auditCount} audits`);
    return { shopperCount, eventCount, gapCount, auditCount };
  });

  // ─── Phase 2: run the rec engine across this data ────────────────────
  const recs = await phase("run all 5 recommendation generators", async () => {
    const svc = createRecommendationsService(prisma);
    return svc.runAll(shop.id);
  });
  console.log(`    wrote ${recs.written} recommendation rows`);

  // ─── Phase 3: read-back checks ───────────────────────────────────────
  const counts = await phase("read-back: count what we created", async () => {
    const events = await prisma.analyticsEvent.count({ where: { shopId: shop.id } });
    const recsR  = await prisma.brandRecommendation.count({ where: { shopId: shop.id, dismissedAt: null } });
    const gaps   = await prisma.catalogGap.count({ where: { shopId: shop.id } });
    return { events, recsR, gaps };
  });
  console.log(`    events=${counts.events} active-recs=${counts.recsR} gaps=${counts.gaps}`);

  // ─── Phase 3.5: brand snapshot + network benchmark + dashboard rollup ─
  const snap = await phase("compute today's BrandTasteSnapshot", async () => {
    // Lazy import — avoids pulling shopify-app code into this script.
    const mod = await import("../apps/shopify-app/app/lib/network.server.js" as string);
    await mod.recomputeBrandSnapshot(shop.id);
    return prisma.brandTasteSnapshot.findFirst({
      where: { shopId: shop.id }, orderBy: { snapshotDate: "desc" },
    });
  }).catch(async () => {
    // Fall back to direct dynamic import path through tsx aliasing.
    console.log("    (could not import network.server directly — skipping)");
    return null;
  });
  if (snap) {
    console.log(`    sample=${snap.sampleSize} comboCtr=${snap.comboCtr.toFixed(3)} signupRate=${snap.signupRate.toFixed(3)}`);
  }

  // ─── Phase 4: top catalog gaps + top combos (the brand-side reports) ─
  const reports = await phase("aggregate the brand reports", async () => {
    const topGaps = await prisma.catalogGap.groupBy({
      by: ["normalizedQuery"],
      where: { shopId: shop.id },
      _count: { _all: true },
      orderBy: { _count: { normalizedQuery: "desc" } },
      take: 5,
    });
    const recBySeverity = await prisma.brandRecommendation.groupBy({
      by: ["severity"],
      where: { shopId: shop.id, dismissedAt: null },
      _count: { _all: true },
    });
    const recByKind = await prisma.brandRecommendation.groupBy({
      by: ["kind"],
      where: { shopId: shop.id, dismissedAt: null },
      _count: { _all: true },
    });
    return { topGaps, recBySeverity, recByKind };
  });
  console.log(`    top gaps:`);
  for (const g of reports.topGaps) console.log(`      ${g._count._all}× "${g.normalizedQuery}"`);
  console.log(`    recs by severity: ${reports.recBySeverity.map((r) => `${r.severity}=${r._count._all}`).join(", ")}`);
  console.log(`    recs by kind:     ${reports.recByKind.map((r) => `${r.kind}=${r._count._all}`).join(", ")}`);

  // ─── Phase 5: cleanup option ─────────────────────────────────────────
  if (process.env.SIM_CLEANUP === "1") {
    await phase("cleanup synthetic data", async () => {
      // Delete by sessionId prefix so we never touch real shoppers.
      const shoppers = await prisma.shopperSession.findMany({
        where: { sessionId: { startsWith: "sim-" } },
        select: { id: true },
      });
      const ids = shoppers.map((s) => s.id);
      await prisma.analyticsEvent.deleteMany({ where: { shopperId: { in: ids } } });
      await prisma.catalogGap.deleteMany({ where: { source: "stress_sim" } });
      await prisma.brandRecommendation.deleteMany({ where: { shopId: shop.id } });
      await prisma.shopperSession.deleteMany({ where: { id: { in: ids } } });
      return { deleted: ids.length };
    });
  } else {
    console.log(`\n  (run with SIM_CLEANUP=1 to delete synthetic data)\n`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("\n✗ simulation failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
