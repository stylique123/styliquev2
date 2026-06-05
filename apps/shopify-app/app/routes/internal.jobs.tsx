// Stylique Internal Ops — Jobs Overview.
// Shows job health using DB-backed proxies (AnalyticsEvent + CreativeSet + TryOnSession).
// BullMQ runs in the worker process, not here — we approximate via DB state.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireInternalAuth } from "../lib/internal-auth.server";
import { prisma } from "../db.server";

// ─── Loader ──────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  requireInternalAuth(request);

  const since24h = new Date(Date.now() - 86_400_000);
  const since7d = new Date(Date.now() - 7 * 86_400_000);

  const [
    // Creative set status counts
    csStats,
    // VTO status counts
    vtoStats,
    // Failed creative sets with shop domain
    recentFailedCS,
    // Failed VTO with shop
    recentFailedVTO,
    // Event throughput in last 24h
    eventVolume,
    // Queue proxies — pending creative sets
    pendingCS,
    // Embedding coverage
    totalProducts,
    embeddedProducts,
  ] = await Promise.all([
    prisma.creativeSet.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.tryOnSession.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.creativeSet.findMany({
      where: { status: "FAILED", updatedAt: { gte: since24h } },
      select: {
        id: true,
        shopId: true,
        error: true,
        triggeredBy: true,
        updatedAt: true,
        shop: { select: { shopifyDomain: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
    prisma.tryOnSession.findMany({
      where: { status: "FAILED", createdAt: { gte: since24h } },
      select: {
        id: true,
        shopId: true,
        error: true,
        providerKey: true,
        createdAt: true,
        shop: { select: { shopifyDomain: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    // Events per hour over last 24h (group by name)
    prisma.analyticsEvent.groupBy({
      by: ["name"],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
      orderBy: { _count: { name: "desc" } },
      take: 15,
    }),
    prisma.creativeSet.count({ where: { status: "PENDING" } }),
    prisma.product.count(),
    prisma.productEmbedding.count(),
  ]);

  const csByStatus = Object.fromEntries(csStats.map((s) => [s.status, s._count._all]));
  const vtoByStatus = Object.fromEntries(vtoStats.map((s) => [s.status, s._count._all]));

  // Weekly event total for throughput gauge
  const weeklyEvents = await prisma.analyticsEvent.count({ where: { createdAt: { gte: since7d } } });

  return json({
    queues: {
      creativeSet: {
        pending: csByStatus.PENDING ?? 0,
        running: csByStatus.GENERATING ?? 0,
        succeeded: csByStatus.READY ?? 0,
        failed: csByStatus.FAILED ?? 0,
        partial: csByStatus.PARTIAL ?? 0,
      },
      vtoRender: {
        pending: vtoByStatus.PENDING ?? 0,
        running: 0,
        succeeded: vtoByStatus.SUCCEEDED ?? 0,
        failed: vtoByStatus.FAILED ?? 0,
      },
      embeddings: {
        total: totalProducts,
        embedded: embeddedProducts,
        coverage: totalProducts > 0 ? Math.round((embeddedProducts / totalProducts) * 100) : 0,
      },
    },
    pendingCSGlobal: pendingCS,
    recentFailedCS: recentFailedCS.map((c) => ({
      id: c.id,
      shopDomain: c.shop.shopifyDomain,
      error: c.error,
      triggeredBy: c.triggeredBy,
      updatedAt: c.updatedAt,
    })),
    recentFailedVTO: recentFailedVTO.map((v) => ({
      id: v.id,
      shopDomain: v.shop.shopifyDomain,
      error: v.error,
      providerKey: v.providerKey,
      createdAt: v.createdAt,
    })),
    eventVolume: eventVolume.map((e) => ({ name: e.name, count: e._count._all })),
    weeklyEvents,
  });
}

// ─── Action (global controls) ─────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  requireInternalAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "requeue_all_failed") {
    const result = await prisma.creativeSet.updateMany({
      where: { status: "FAILED" },
      data: { status: "PENDING", error: null, retryCount: 0 },
    });
    return json({ ok: true, message: `Re-queued ${result.count} failed creative set(s)` });
  }

  if (intent === "pause_all") {
    // Set paused: true on all plans
    const plans = await prisma.plan.findMany({ select: { shopId: true, planFeaturesJson: true } });
    await Promise.all(
      plans.map((p) => {
        const current = (p.planFeaturesJson as Record<string, unknown>) ?? {};
        return prisma.plan.update({
          where: { shopId: p.shopId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { planFeaturesJson: { ...current, paused: true } as any },
        });
      }),
    );
    return json({ ok: true, message: `Paused generation for ${plans.length} brand(s)` });
  }

  if (intent === "resume_all") {
    const plans = await prisma.plan.findMany({ select: { shopId: true, planFeaturesJson: true } });
    await Promise.all(
      plans.map((p) => {
        const current = (p.planFeaturesJson as Record<string, unknown>) ?? {};
        const updated = { ...current };
        delete updated.paused;
        return prisma.plan.update({
          where: { shopId: p.shopId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { planFeaturesJson: updated as any },
        });
      }),
    );
    return json({ ok: true, message: `Resumed generation for ${plans.length} brand(s)` });
  }

  return json({ ok: false, error: "unknown intent" }, { status: 400 });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function timeAgo(date: Date | string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function QueueCard({
  title,
  pending,
  running,
  succeeded,
  failed,
  extra,
}: {
  title: string;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  extra?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e5e5",
        borderRadius: 7,
        padding: "16px 20px",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {[
          { label: "Pending", value: pending, color: "#92400e", bg: "#fffbeb" },
          { label: "Running", value: running, color: "#1e40af", bg: "#eff6ff" },
          { label: "Succeeded", value: succeeded, color: "#166534", bg: "#f0fdf4" },
          { label: "Failed", value: failed, color: "#dc2626", bg: "#fef2f2" },
        ].map((s) => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 5, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#888" }}>{s.label}</div>
          </div>
        ))}
      </div>
      {extra}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function InternalJobsPage() {
  const d = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message?: string; error?: string }>();
  const result = fetcher.data;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Stylique Ops — Jobs</title>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #F5F5F5; color: #111; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { text-align: left; padding: 6px 8px; font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; border-bottom: 1px solid #f0f0f0; }
          a { color: #3b82f6; text-decoration: none; }
        `}</style>
      </head>
      <body>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 64px" }}>
          {/* Nav */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 0",
              borderBottom: "1px solid #e0e0e0",
              marginBottom: 24,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Stylique Ops
              </span>
              <a href="/internal" style={{ fontSize: 13, color: "#666" }}>Brands</a>
              <a href="/internal/jobs" style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>Jobs</a>
            </div>
          </div>

          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Jobs overview</h2>

          {/* Global controls */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 7,
              padding: "16px 20px",
              marginBottom: 20,
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>Global controls</span>
            {result && (
              <span
                style={{
                  fontSize: 12,
                  color: result.ok ? "#166534" : "#dc2626",
                  background: result.ok ? "#f0fdf4" : "#fef2f2",
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`,
                }}
              >
                {result.message ?? result.error}
              </span>
            )}
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="requeue_all_failed" />
              <button
                type="submit"
                style={{
                  padding: "7px 14px",
                  fontSize: 13,
                  border: "1px solid #ddd",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: "#fff",
                  fontWeight: 500,
                }}
              >
                🔄 Re-queue all failed creative sets
              </button>
            </fetcher.Form>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="pause_all" />
              <button
                type="submit"
                style={{
                  padding: "7px 14px",
                  fontSize: 13,
                  border: "1px solid #fecaca",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: "#fff9f9",
                  color: "#dc2626",
                  fontWeight: 500,
                }}
              >
                ⏸ Pause all generation
              </button>
            </fetcher.Form>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="resume_all" />
              <button
                type="submit"
                style={{
                  padding: "7px 14px",
                  fontSize: 13,
                  border: "1px solid #bbf7d0",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: "#f0fdf4",
                  color: "#166534",
                  fontWeight: 500,
                }}
              >
                ▶ Resume all generation
              </button>
            </fetcher.Form>
          </div>

          {/* Queue status cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <QueueCard
              title="creative-set queue"
              pending={d.queues.creativeSet.pending}
              running={d.queues.creativeSet.running}
              succeeded={d.queues.creativeSet.succeeded}
              failed={d.queues.creativeSet.failed}
              extra={
                d.queues.creativeSet.partial > 0 ? (
                  <div style={{ fontSize: 12, color: "#9a3412", marginTop: 8 }}>
                    {d.queues.creativeSet.partial} partial sets
                  </div>
                ) : null
              }
            />
            <QueueCard
              title="tryon-render queue"
              pending={d.queues.vtoRender.pending}
              running={d.queues.vtoRender.running}
              succeeded={d.queues.vtoRender.succeeded}
              failed={d.queues.vtoRender.failed}
            />
          </div>

          {/* Embeddings coverage */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 7,
              padding: "16px 20px",
              marginBottom: 20,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Catalog embeddings</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  background: "#f0f0f0",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${d.queues.embeddings.coverage}%`,
                    height: "100%",
                    background: d.queues.embeddings.coverage >= 90 ? "#22c55e" : d.queues.embeddings.coverage >= 50 ? "#f59e0b" : "#ef4444",
                    borderRadius: 4,
                  }}
                />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, minWidth: 40 }}>
                {d.queues.embeddings.coverage}%
              </span>
              <span style={{ fontSize: 12, color: "#888" }}>
                {d.queues.embeddings.embedded.toLocaleString()} / {d.queues.embeddings.total.toLocaleString()} products
              </span>
            </div>
          </div>

          {/* Event volume (24h) */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 7,
              padding: "16px 20px",
              marginBottom: 20,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Analytics event volume — last 24h</div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
              {d.weeklyEvents.toLocaleString()} events in the last 7 days across all brands
            </div>
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Count (24h)</th>
                </tr>
              </thead>
              <tbody>
                {d.eventVolume.map((e: { name: string; count: number }) => (
                  <tr key={e.name}>
                    <td style={{ padding: "5px 0", fontFamily: "monospace", fontSize: 12 }}>{e.name}</td>
                    <td style={{ padding: "5px 8px", fontSize: 12 }}>{e.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Failed creative sets */}
          {d.recentFailedCS.length > 0 && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #fecaca",
                borderRadius: 7,
                overflow: "hidden",
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  padding: "12px 20px",
                  borderBottom: "1px solid #fecaca",
                  fontWeight: 700,
                  fontSize: 13,
                  background: "#fef2f2",
                  color: "#dc2626",
                }}
              >
                Failed creative sets — last 24h ({d.recentFailedCS.length})
              </div>
              <div style={{ padding: "16px 20px" }}>
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Brand</th>
                      <th>Error</th>
                      <th>Triggered by</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentFailedCS.map((c) => (
                      <tr key={c.id}>
                        <td style={{ padding: "6px 0", fontFamily: "monospace", fontSize: 12, color: "#555" }}>
                          {c.id.slice(0, 12)}…
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 12 }}>
                          <a href={`/internal/${c.shopDomain}`} style={{ color: "#3b82f6" }}>
                            {c.shopDomain.replace(".myshopify.com", "")}
                          </a>
                        </td>
                        <td
                          style={{
                            padding: "6px 8px",
                            fontSize: 12,
                            color: "#dc2626",
                            maxWidth: 220,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.error ?? "—"}
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 12, color: "#666" }}>
                          {c.triggeredBy ?? "—"}
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 12, color: "#888" }}>
                          {timeAgo(c.updatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Failed VTO */}
          {d.recentFailedVTO.length > 0 && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #fecaca",
                borderRadius: 7,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "12px 20px",
                  borderBottom: "1px solid #fecaca",
                  fontWeight: 700,
                  fontSize: 13,
                  background: "#fef2f2",
                  color: "#dc2626",
                }}
              >
                Failed VTO renders — last 24h ({d.recentFailedVTO.length})
              </div>
              <div style={{ padding: "16px 20px" }}>
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Brand</th>
                      <th>Provider</th>
                      <th>Error</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentFailedVTO.map((v) => (
                      <tr key={v.id}>
                        <td style={{ padding: "6px 0", fontFamily: "monospace", fontSize: 12, color: "#555" }}>
                          {v.id.slice(0, 12)}…
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 12 }}>
                          <a href={`/internal/${v.shopDomain}`} style={{ color: "#3b82f6" }}>
                            {v.shopDomain.replace(".myshopify.com", "")}
                          </a>
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 12, color: "#666" }}>{v.providerKey ?? "—"}</td>
                        <td
                          style={{
                            padding: "6px 8px",
                            fontSize: 12,
                            color: "#dc2626",
                            maxWidth: 220,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {v.error ?? "—"}
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 12, color: "#888" }}>
                          {timeAgo(v.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
