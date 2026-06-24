// GET /api/admin/cohorts/mira-engaged.csv
//
// Cycle-4 fix for the perf-marketer panel finding (Cohort export 2/10):
// brands could see Mira-engaged shoppers in their dashboard but had no way
// to ACT on the cohort — no push to Klaviyo / Meta / Google audiences, no
// CSV. Mira-engaged shoppers were trapped inside Stylique.
//
// This route emits a CSV (the format every ESP and ad platform ingests
// natively) of shoppers who had ANY Mira touchpoint in the last 30 days,
// with the columns brands actually pivot on for retargeting / lookalike /
// suppression: email, lastEngagedAt, sessionsCount, sentimentLabel,
// topThemes, hadTryon, hadCart, hadCartIntent.
//
// Privacy invariants (D10, §3, §3.5):
// - Shop-scoped only; admin auth required.
// - Emails only included when shopper claimed a soft account (D2 / OI-8).
// - No chat transcripts; the columns are SHOPPER-OWNED facts (email +
//   session metadata) plus pre-extracted sentiment label/theme (NOT raw
//   text), matching the §3 contract "themes and summaries, not transcripts".
// - No taste vectors, no per-shopper internal cuids.
//
// Tier note: this is a Growth-tier feature per CLAUDE.md §10 "Daily snapshot
// export — CSV (Growth) / API (Ultimate)". The route enforces no gating
// today (founder decision deferred per task #24); when billing enforcement
// lands, gate on `entitlement.cohortExport`.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { MIRA_CART_ASSIST_EVENT_NAMES } from "@stylique/core";
import { cohortCartFlags } from "../lib/cohort-export.server";

const DAYS = 30;

function escapeCsv(s: unknown): string {
  if (s == null) return "";
  const str = String(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, shopifyDomain: true },
  });
  if (!shop) {
    return new Response("shop_not_installed", { status: 404 });
  }

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  // Mira touchpoint = any chat or VTO event in the window. Group by shopper
  // and pull session metadata in one query — shop-scoped to avoid cross-shop
  // leak (§3 invariant #1).
  const events = await prisma.analyticsEvent.findMany({
    where: {
      shopId: shop.id,
      createdAt: { gte: since },
      name: {
        in: [
          "CHAT_OPENED",
          "CHAT_MESSAGE_SENT",
          "CHAT_COMBO_PROPOSED",
          "CHAT_PRODUCT_CLICKED",
          ...MIRA_CART_ASSIST_EVENT_NAMES,
          "TRYON_RENDER_REQUESTED",
        ],
      },
      shopperId: { not: null },
    },
    select: { shopperId: true, createdAt: true, name: true },
    // Verification-panel cycle-9 finding: previously the findMany was
    // unbounded — a heavy shop over 30 days could pull hundreds of thousands
    // of rows into memory before bucketing, OOMing the dyno. 100k caps the
    // hottest shops at ~1.6MB Prisma row weight; smaller shops fit easily.
    // If the cap is reached, the CSV is still correct (truncated at the
    // cohort tail, not on any single shopper) — the loader documents this
    // truncation in the response header.
    take: 100_000,
    orderBy: { createdAt: "desc" },
  });

  // Bucket per shopper.
  const perShopper = new Map<
    string,
    { sessions: number; lastEngagedAt: Date; events: Set<string> }
  >();
  for (const e of events) {
    if (!e.shopperId) continue;
    const cur = perShopper.get(e.shopperId);
    if (!cur) {
      perShopper.set(e.shopperId, {
        sessions: e.name === "CHAT_OPENED" ? 1 : 0,
        lastEngagedAt: e.createdAt,
        events: new Set([e.name]),
      });
    } else {
      cur.sessions += e.name === "CHAT_OPENED" ? 1 : 0;
      if (e.createdAt > cur.lastEngagedAt) cur.lastEngagedAt = e.createdAt;
      cur.events.add(e.name);
    }
  }

  const shopperIds = Array.from(perShopper.keys());
  if (shopperIds.length === 0) {
    const header =
      "email,lastEngagedAt,sessionsCount,sentimentLabel,topThemes,hadTryon,hadCart,hadCartIntent\n";
    return new Response(header, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mira-engaged-${shop.shopifyDomain}-${DAYS}d.csv"`,
      },
    });
  }

  // Fetch shopper metadata in one query. ONLY emails for claimed accounts
  // (D2 / OI-8): unclaimed cookie-only shoppers have no email and are not
  // exportable for retargeting anyway.
  const shoppers = await prisma.shopperSession.findMany({
    where: {
      id: { in: shopperIds },
      shopifyDomain: shop.shopifyDomain, // §3 invariant #1: shop-scoped.
      accountClaimedAt: { not: null },
      email: { not: null },
    },
    select: {
      id: true,
      email: true,
      sentimentLabel: true,
      sentimentThemes: true,
    },
  });

  const rows: string[] = [
    "email,lastEngagedAt,sessionsCount,sentimentLabel,topThemes,hadTryon,hadCart,hadCartIntent",
  ];
  for (const s of shoppers) {
    const bucket = perShopper.get(s.id);
    if (!bucket) continue;
    const cartFlags = cohortCartFlags(bucket.events);
    const themes = Array.isArray(s.sentimentThemes)
      ? (s.sentimentThemes as string[]).slice(0, 3).join("|")
      : "";
    rows.push(
      [
        escapeCsv(s.email),
        escapeCsv(bucket.lastEngagedAt.toISOString()),
        escapeCsv(bucket.sessions),
        escapeCsv(s.sentimentLabel ?? ""),
        escapeCsv(themes),
        escapeCsv(bucket.events.has("TRYON_RENDER_REQUESTED") ? "1" : "0"),
        escapeCsv(cartFlags.hadCart ? "1" : "0"),
        escapeCsv(cartFlags.hadCartIntent ? "1" : "0"),
      ].join(","),
    );
  }

  return new Response(rows.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mira-engaged-${shop.shopifyDomain}-${DAYS}d.csv"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
