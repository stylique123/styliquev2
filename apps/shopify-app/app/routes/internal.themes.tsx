// /internal/themes — ops view of stores with weak widget placement.
//
// Cycle 7 — Session 2 (widget placement, the user's #1 priority): lists every
// shop ranked by their rolling mean placement-confidence score, surfaces the
// 3 most-failed checks per shop, and gives the Stylique team a queue of
// upsell-ready stores (Growth/Scale theme optimization service).
//
// Auth: STYLIQUE_INTERNAL_SECRET via /internal/* convention. Read-only.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { prisma } from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

interface ShopRow {
  shopId: string;
  shopifyDomain: string;
  meanScore: number | null;
  sampleCount: number;
  themeHint: string | null;
  lastAuditAt: string | null;
  worstChecks: Array<{ id: string; passedRate: number }>;
  upsellTriggered: boolean;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireInternalAuth(request);

  // 30-day window. Pull every audit per shop, group + summarize in JS — DB
  // size is small (one audit per page load, capped at ~1k per shop/day even
  // for high-traffic stores; over 30d still trivial).
  const since = new Date(Date.now() - 30 * 86_400_000);
  const audits = await prisma.analyticsEvent.findMany({
    where: { name: "WIDGET_PLACEMENT_AUDIT", createdAt: { gte: since } },
    select: { shopId: true, payload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50_000,
  });

  const byShop = new Map<string, {
    scoreSum: number; scoreN: number; themeHint: string | null;
    lastAuditAt: Date | null;
    checks: Map<string, { passed: number; total: number }>;
  }>();
  for (const a of audits) {
    const cur = byShop.get(a.shopId) ?? {
      scoreSum: 0, scoreN: 0, themeHint: null, lastAuditAt: null,
      checks: new Map<string, { passed: number; total: number }>(),
    };
    const p = a.payload as {
      score?: number; themeHint?: string | null;
      checks?: Array<{ id?: string; passed?: boolean }>;
    } | null;
    if (typeof p?.score === "number") { cur.scoreSum += p.score; cur.scoreN++; }
    if (!cur.themeHint && p?.themeHint) cur.themeHint = p.themeHint.slice(0, 120);
    if (!cur.lastAuditAt || a.createdAt > cur.lastAuditAt) cur.lastAuditAt = a.createdAt;
    if (Array.isArray(p?.checks)) {
      for (const c of p!.checks) {
        if (!c?.id) continue;
        const cc = cur.checks.get(c.id) ?? { passed: 0, total: 0 };
        cc.total++;
        if (c.passed) cc.passed++;
        cur.checks.set(c.id, cc);
      }
    }
    byShop.set(a.shopId, cur);
  }

  // Resolve shopify domains in one query.
  const shopIds = Array.from(byShop.keys());
  const shops = await prisma.shop.findMany({
    where: { id: { in: shopIds } },
    select: { id: true, shopifyDomain: true },
  });
  const domainById = new Map(shops.map((s) => [s.id, s.shopifyDomain]));

  const rows: ShopRow[] = Array.from(byShop.entries()).map(([shopId, v]) => {
    const meanScore = v.scoreN > 0 ? Math.round(v.scoreSum / v.scoreN) : null;
    const worstChecks = Array.from(v.checks.entries())
      .map(([id, x]) => ({ id, passedRate: x.total > 0 ? x.passed / x.total : 1 }))
      .sort((a, b) => a.passedRate - b.passedRate)
      .slice(0, 3);
    return {
      shopId,
      shopifyDomain: domainById.get(shopId) ?? "(unknown)",
      meanScore,
      sampleCount: v.scoreN,
      themeHint: v.themeHint,
      lastAuditAt: v.lastAuditAt?.toISOString() ?? null,
      worstChecks,
      upsellTriggered: meanScore != null && meanScore < 70,
    };
  }).sort((a, b) => {
    // Sort by score asc (worst first) so the upsell queue is at the top.
    if (a.meanScore == null) return 1;
    if (b.meanScore == null) return -1;
    return a.meanScore - b.meanScore;
  });

  return json({ rows, windowDays: 30 });
}

export default function InternalThemes() {
  const { rows, windowDays } = useLoaderData<typeof loader>();
  const upsellQueue = rows.filter((r) => r.upsellTriggered);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1200, margin: "40px auto", padding: "0 24px", color: "#F4F2EE", background: "#0B0A0F", minHeight: "100vh" }}>
      <h1 style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 36, fontWeight: 400 }}>Theme placement audit</h1>
      <p style={{ color: "rgba(244,242,238,0.6)", fontSize: 14 }}>
        Rolling-mean placement-confidence score per shop over the last {windowDays} days. Upsell queue (score &lt; 70) at the top.
      </p>
      <div style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.32)", borderRadius: 12, padding: 16, margin: "20px 0" }}>
        <strong style={{ color: "#C7B8FF" }}>Upsell queue:</strong>{" "}
        <span>{upsellQueue.length} shop{upsellQueue.length === 1 ? "" : "s"} below 70 — ready for theme-optimization service outreach.</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)", textAlign: "left" }}>
            <th style={{ padding: "10px 8px" }}>Shop</th>
            <th style={{ padding: "10px 8px" }}>Score</th>
            <th style={{ padding: "10px 8px" }}>Samples</th>
            <th style={{ padding: "10px 8px" }}>Theme</th>
            <th style={{ padding: "10px 8px" }}>Worst-failing checks</th>
            <th style={{ padding: "10px 8px" }}>Last audit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.shopId} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <td style={{ padding: "10px 8px" }}>
                <a href={`/internal/${r.shopId}`} style={{ color: "#F4F2EE", textDecoration: "none", borderBottom: "1px dotted rgba(255,255,255,0.3)" }}>{r.shopifyDomain}</a>
              </td>
              <td style={{ padding: "10px 8px", fontWeight: 600, color: r.meanScore == null ? "rgba(255,255,255,0.4)" : r.meanScore < 70 ? "#F87171" : r.meanScore < 85 ? "#FBBF24" : "#4EC49E" }}>
                {r.meanScore ?? "—"}
              </td>
              <td style={{ padding: "10px 8px", color: "rgba(244,242,238,0.6)" }}>{r.sampleCount}</td>
              <td style={{ padding: "10px 8px", color: "rgba(244,242,238,0.6)" }}>{r.themeHint ?? "—"}</td>
              <td style={{ padding: "10px 8px", color: "rgba(244,242,238,0.7)" }}>
                {r.worstChecks.length === 0
                  ? "—"
                  : r.worstChecks.map((c) => `${c.id} (${Math.round(c.passedRate * 100)}%)`).join(", ")}
              </td>
              <td style={{ padding: "10px 8px", color: "rgba(244,242,238,0.6)" }}>
                {r.lastAuditAt ? new Date(r.lastAuditAt).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
