#!/usr/bin/env node
/**
 * P7 — Pilot conversion + AOV measurement (founder directive: "Simulated
 * conversations cannot establish revenue lift").
 *
 * Pulls the REAL CART_CONFIRMED / CHAT_SESSION_STARTED events from the
 * production Prisma DB for one shop over two 30-day windows (pilot vs
 * pre-pilot) and computes the deltas a merchant cares about:
 *
 *   - assisted conversion rate    (# CART_CONFIRMED where a Mira session
 *                                  preceded the order, / # CHAT_SESSION)
 *   - AOV                          (avg line total of CART_CONFIRMED events)
 *   - assisted revenue             (Σ confirmed-line-totals where Mira was
 *                                  in the funnel within 24h pre-order)
 *
 * Usage:
 *   node apps/web/scripts/pilot-measure.mjs \
 *     --shop stylique-fashion-dev.myshopify.com \
 *     --pilot-start 2026-05-11 \
 *     --pilot-end   2026-06-10
 *
 * The pre-pilot window is the 30 days immediately preceding `--pilot-start`
 * unless --baseline-start/--baseline-end are passed. Output is a single MD
 * block ready to paste into a case study (P6 hands off to this).
 *
 * Requires DATABASE_URL in env. Read-only — never writes.
 */
import { PrismaClient } from "@prisma/client";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null))
    .filter(Boolean),
);
if (!args.shop || !args["pilot-start"] || !args["pilot-end"]) {
  console.error("Missing --shop --pilot-start --pilot-end");
  process.exit(1);
}

const pilotStart = new Date(args["pilot-start"]);
const pilotEnd = new Date(args["pilot-end"]);
const baselineStart = args["baseline-start"]
  ? new Date(args["baseline-start"])
  : new Date(pilotStart.getTime() - 30 * 86400_000);
const baselineEnd = args["baseline-end"] ? new Date(args["baseline-end"]) : pilotStart;

const prisma = new PrismaClient();

async function windowMetrics(shopifyDomain, from, to) {
  const shop = await prisma.shop.findFirst({
    where: { shopifyDomain },
    select: { id: true, currencyCode: true },
  });
  if (!shop) throw new Error(`Shop not found: ${shopifyDomain}`);
  const chatSessions = await prisma.analyticsEvent.count({
    where: { shopId: shop.id, name: "CHAT_SESSION_STARTED", ts: { gte: from, lt: to } },
  });
  const confirmed = await prisma.analyticsEvent.findMany({
    where: { shopId: shop.id, name: "CART_CONFIRMED", ts: { gte: from, lt: to } },
    select: { payload: true, shopperRowId: true, ts: true },
  });
  // assistedConfirmed: a CART_CONFIRMED whose shopperRowId had a CHAT event in
  // the 24h preceding the confirm. Bounded join — no N+1 because we filter
  // chat events first.
  const assistedIds = new Set();
  for (const c of confirmed) {
    if (!c.shopperRowId) continue;
    const recentChat = await prisma.analyticsEvent.findFirst({
      where: {
        shopId: shop.id,
        shopperRowId: c.shopperRowId,
        name: { in: ["CHAT_SESSION_STARTED", "CHAT_MESSAGE_SENT"] },
        ts: { gte: new Date(c.ts.getTime() - 86400_000), lt: c.ts },
      },
      select: { id: true },
    });
    if (recentChat) assistedIds.add(c.shopperRowId);
  }
  // AOV / total-revenue source of truth: CART_CONFIRMED.payload.lineValue is
  // written in CENTS (orders.fulfilled.tsx), not currency units. Each row is
  // unit price × actual quantity for ONE line item — so summing across all
  // CART_CONFIRMED rows of an order gives the real order total, and grouping
  // by orderId gives a per-order AOV that respects multi-line orders +
  // real quantities (founder panel finding fixed at the write side).
  const lineTotals = confirmed
    .map((c) => Number(c.payload?.lineValue ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  // Per-order AOV: group line totals by orderId so a 3-line order doesn't
  // count as 3 orders in the AOV mean.
  const totalByOrder = new Map();
  for (const c of confirmed) {
    const p = c.payload || {};
    const lv = Number(p.lineValue ?? 0);
    const oid = p.orderId;
    if (!oid || !(lv > 0)) continue;
    totalByOrder.set(oid, (totalByOrder.get(oid) ?? 0) + lv);
  }
  const orderTotalsCents = [...totalByOrder.values()];
  const totalRevCents = lineTotals.reduce((a, b) => a + b, 0);
  const aov = orderTotalsCents.length
    ? Math.round(orderTotalsCents.reduce((a, b) => a + b, 0) / orderTotalsCents.length / 100)
    : 0;
  return {
    currency: shop.currencyCode || "USD",
    chatSessions,
    confirmedOrders: confirmed.length,
    assistedOrders: assistedIds.size,
    conversionPctRaw:
      chatSessions > 0 ? Math.round((assistedIds.size / chatSessions) * 1000) / 10 : 0,
    aov,
    totalRevenue: Math.round(totalRevCents / 100),
  };
}

const baseline = await windowMetrics(args.shop, baselineStart, baselineEnd);
const pilot = await windowMetrics(args.shop, pilotStart, pilotEnd);

const delta = (a, b) =>
  a === 0 ? (b > 0 ? "+∞" : "0") : `${b > a ? "+" : ""}${Math.round(((b - a) / a) * 1000) / 10}%`;

const md = `
## ${args.shop} — pilot measurement

| Metric                          | Baseline (30d pre)  | Pilot (30d)         | Δ              |
|--------------------------------|---------------------|---------------------|----------------|
| Chat sessions started          | ${baseline.chatSessions} | ${pilot.chatSessions} | ${delta(baseline.chatSessions, pilot.chatSessions)} |
| Confirmed orders               | ${baseline.confirmedOrders} | ${pilot.confirmedOrders} | ${delta(baseline.confirmedOrders, pilot.confirmedOrders)} |
| Mira-assisted orders           | ${baseline.assistedOrders} | ${pilot.assistedOrders} | ${delta(baseline.assistedOrders, pilot.assistedOrders)} |
| Assisted conversion rate       | ${baseline.conversionPctRaw}% | ${pilot.conversionPctRaw}% | ${delta(baseline.conversionPctRaw, pilot.conversionPctRaw)} |
| AOV (${pilot.currency})        | ${baseline.aov} | ${pilot.aov} | ${delta(baseline.aov, pilot.aov)} |
| Total revenue (${pilot.currency}) | ${baseline.totalRevenue} | ${pilot.totalRevenue} | ${delta(baseline.totalRevenue, pilot.totalRevenue)} |

Windows: baseline ${baseline.chatSessions === 0 ? "(no Mira data — pre-install)" : ""} ${baselineStart.toISOString().slice(0, 10)} → ${baselineEnd.toISOString().slice(0, 10)}; pilot ${pilotStart.toISOString().slice(0, 10)} → ${pilotEnd.toISOString().slice(0, 10)}.

Honest caveats:
- Conversion rate denominator is chat sessions (Mira's funnel), not total store sessions.
- "Assisted" = a Mira event within 24h preceding the confirmed order, attribution heuristic.
- Pre-install baselines will show 0 chat sessions; treat the lift number as directional.
- Statistical significance requires N ≥ 200 confirmed orders per window — flag below.
${pilot.confirmedOrders < 200 ? "- ⚠ pilot < 200 orders — treat lift as directional, not significant." : ""}
`;

console.log(md);
await prisma.$disconnect();
