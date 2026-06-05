// Stylique Internal Ops — Brand Detail Page.
// Shows full activity, jobs, VTO, Studio, and Brand DNA for one brand.

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireInternalAuth } from "../lib/internal-auth.server";
import { getBrandDetail } from "../lib/internal-dashboard.server";
import { generateCSRFToken, verifyCSRFToken } from "../lib/entitlement.server";
import { prisma } from "../db.server";

// ─── Loader ──────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  requireInternalAuth(request);
  const shopId = params.shopId as string;
  const detail = await getBrandDetail(shopId);
  if (!detail) throw new Response("Brand not found", { status: 404 });
  // Generate a CSRF token bound to STYLIQUE_INTERNAL_SECRET so destructive
  // action forms (change_tier, requeue_set, save_plan_features) are CSRF-protected.
  const secret = process.env.STYLIQUE_INTERNAL_SECRET ?? "unset";
  const csrf = generateCSRFToken(secret);
  return json({ detail, csrf });
}

// ─── Action ───────────────────────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  requireInternalAuth(request);
  const shopId = params.shopId as string;
  const formData = await request.formData();

  // CSRF guard — all destructive actions must carry a valid token.
  const csrf = formData.get("csrf") as string | null;
  const secret = process.env.STYLIQUE_INTERNAL_SECRET ?? "unset";
  if (!verifyCSRFToken(csrf, secret)) {
    return json({ ok: false, error: "Invalid or missing CSRF token." }, { status: 403 });
  }

  const intent = formData.get("intent") as string;

  if (intent === "requeue_set") {
    const setId = formData.get("setId") as string;
    await prisma.creativeSet.update({
      where: { id: setId },
      data: { status: "PENDING", error: null, retryCount: 0 },
    });
    return json({ ok: true, message: `Creative set ${setId.slice(0, 8)} re-queued` });
  }

  if (intent === "save_plan_features") {
    const raw = formData.get("planFeaturesJson") as string;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }
    await prisma.plan.upsert({
      where: { shopId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { planFeaturesJson: parsed as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { shopId, planFeaturesJson: parsed as any },
    });
    return json({ ok: true, message: "Plan features JSON saved" });
  }

  if (intent === "change_tier") {
    const tier = formData.get("tier") as string;
    await prisma.plan.upsert({
      where: { shopId },
      update: { tier: tier as "STARTER" | "GROWTH" | "ULTIMATE" },
      create: { shopId, tier: tier as "STARTER" | "GROWTH" | "ULTIMATE" },
    });
    return json({ ok: true, message: `Tier updated to ${tier}` });
  }

  return json({ ok: false, error: "unknown intent" }, { status: 400 });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function timeAgo(date: Date | string | null): string {
  if (!date) return "Never";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusPill(status: string) {
  const map: Record<string, { bg: string; color: string }> = {
    SUCCEEDED: { bg: "#f0fdf4", color: "#166534" },
    READY: { bg: "#f0fdf4", color: "#166534" },
    FAILED: { bg: "#fef2f2", color: "#dc2626" },
    PENDING: { bg: "#fefce8", color: "#854d0e" },
    GENERATING: { bg: "#eff6ff", color: "#1e40af" },
    RUNNING: { bg: "#eff6ff", color: "#1e40af" },
    PARTIAL: { bg: "#fff7ed", color: "#9a3412" },
  };
  const style = map[status] ?? { bg: "#f5f5f5", color: "#555" };
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 700,
        background: style.bg,
        color: style.color,
      }}
    >
      {status}
    </span>
  );
}

// ─── Activity chart (pure CSS bars) ──────────────────────────────────────

function ActivityChart({ data }: { data: Array<{ date: string; sessions: number }> }) {
  const max = Math.max(...data.map((d) => d.sessions), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 64, padding: "0 4px" }}>
      {data.map((d) => (
        <div
          key={d.date}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
        >
          <div
            style={{
              width: "100%",
              background: d.sessions > 0 ? "#3b82f6" : "#e5e7eb",
              borderRadius: "3px 3px 0 0",
              height: `${Math.max(4, (d.sessions / max) * 48)}px`,
              transition: "height 0.2s",
            }}
            title={`${d.sessions} session${d.sessions !== 1 ? "s" : ""}`}
          />
          <div style={{ fontSize: 10, color: "#999", whiteSpace: "nowrap" }}>
            {d.date.slice(5)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e5e5",
        borderRadius: 7,
        marginBottom: 20,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #f0f0f0",
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "#444",
          background: "#fafafa",
        }}
      >
        {title}
      </div>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}

// ─── Creative set row with requeue button ─────────────────────────────────

function CreativeSetRow({ set, csrf }: { set: { id: string; status: string; triggeredBy: string | null; error: string | null; createdAt: Date; updatedAt: Date }; csrf: string }) {
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();
  return (
    <tr>
      <td style={{ padding: "7px 0", fontSize: 12, fontFamily: "monospace", color: "#555" }}>
        {set.id.slice(0, 12)}…
      </td>
      <td style={{ padding: "7px 8px" }}>{statusPill(set.status)}</td>
      <td style={{ padding: "7px 8px", fontSize: 12, color: "#666" }}>
        {set.triggeredBy ?? "—"}
      </td>
      <td style={{ padding: "7px 8px", fontSize: 12, color: "#dc2626", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {set.error ?? "—"}
      </td>
      <td style={{ padding: "7px 8px", fontSize: 12, color: "#888" }}>
        {timeAgo(set.createdAt)}
      </td>
      <td style={{ padding: "7px 0" }}>
        {set.status === "FAILED" && (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="requeue_set" />
            <input type="hidden" name="setId" value={set.id} />
            <input type="hidden" name="csrf" value={csrf} />
            <button
              type="submit"
              style={{
                padding: "4px 10px",
                fontSize: 12,
                border: "1px solid #ddd",
                borderRadius: 4,
                cursor: "pointer",
                background: "#fff",
                color: "#333",
              }}
            >
              {fetcher.state === "submitting" ? "…" : "Requeue"}
            </button>
          </fetcher.Form>
        )}
        {fetcher.data?.message && (
          <span style={{ fontSize: 11, color: "#166534", marginLeft: 6 }}>✓</span>
        )}
      </td>
    </tr>
  );
}

// ─── Plan features JSON editor ────────────────────────────────────────────

function PlanFeaturesEditor({ current, shopId, csrf }: { current: unknown; shopId: string; csrf: string }) {
  const [value, setValue] = useState(JSON.stringify(current ?? {}, null, 2));
  const fetcher = useFetcher<{ ok: boolean; message?: string; error?: string }>();
  const result = fetcher.data;

  return (
    <div>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
        ⚠ Direct JSON edit. Changes take effect immediately on next request.
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{
          width: "100%",
          minHeight: 160,
          padding: 10,
          fontFamily: "monospace",
          fontSize: 12,
          border: "1px solid #ddd",
          borderRadius: 5,
          resize: "vertical",
          background: "#f9f9f9",
          color: "#111",
        }}
      />
      {result && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: result.ok ? "#166534" : "#dc2626",
          }}
        >
          {result.message ?? result.error}
        </div>
      )}
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="save_plan_features" />
        <input type="hidden" name="planFeaturesJson" value={value} />
        <input type="hidden" name="csrf" value={csrf} />
        <button
          type="submit"
          style={{
            marginTop: 10,
            padding: "8px 20px",
            background: "#1a1a1a",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {fetcher.state === "submitting" ? "Saving…" : "Save plan features JSON"}
        </button>
      </fetcher.Form>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function BrandDetailPage() {
  const { detail, csrf } = useLoaderData<typeof loader>();
  const d = detail;
  const tierFetcher = useFetcher<{ ok: boolean; message?: string }>();

  const healthColors: Record<string, string> = {
    healthy: "#22c55e",
    at_risk: "#f59e0b",
    churning: "#ef4444",
    new: "#3b82f6",
    inactive: "#9ca3af",
  };

  return (
    <>
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <title>Ops — {d.shopifyDomain}</title>
          <style>{`
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: #F5F5F5; color: #111; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
            table { width: 100%; border-collapse: collapse; font-size: 13px; }
            th { text-align: left; padding: 6px 8px; font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #f0f0f0; }
          `}</style>
        </head>
        <body>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 64px" }}>
            {/* Nav */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "16px 0",
                borderBottom: "1px solid #e0e0e0",
                marginBottom: 24,
              }}
            >
              <a href="/internal" style={{ fontSize: 13, color: "#3b82f6", textDecoration: "none" }}>
                ← All brands
              </a>
              <span style={{ color: "#ddd" }}>|</span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                {d.shopifyDomain.replace(".myshopify.com", "")}
              </span>
            </div>

            {/* Header */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #e5e5e5",
                borderRadius: 7,
                padding: "20px 24px",
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                gap: 24,
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: healthColors[d.brandHealthStatus] ?? "#9ca3af",
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  <h1 style={{ fontSize: 20, fontWeight: 700 }}>{d.shopifyDomain}</h1>
                </div>
                <div style={{ fontSize: 13, color: "#666" }}>
                  {d.planTier} · Installed {timeAgo(d.installedAt)} · Last active {timeAgo(d.lastActiveAt)}
                </div>
              </div>

              {/* Quick tier changer */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#888" }}>Tier:</span>
                {(["STARTER", "GROWTH", "ULTIMATE"] as const).map((t) => (
                  <tierFetcher.Form key={t} method="post">
                    <input type="hidden" name="intent" value="change_tier" />
                    <input type="hidden" name="tier" value={t} />
                    <input type="hidden" name="csrf" value={csrf} />
                    <button
                      type="submit"
                      style={{
                        padding: "5px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        border: "1px solid #ddd",
                        borderRadius: 4,
                        cursor: "pointer",
                        background: d.planTier === t ? "#1a1a1a" : "#fff",
                        color: d.planTier === t ? "#fff" : "#333",
                      }}
                    >
                      {t}
                    </button>
                  </tierFetcher.Form>
                ))}
                {tierFetcher.data?.message && (
                  <span style={{ fontSize: 12, color: "#166534" }}>✓ {tierFetcher.data.message}</span>
                )}
              </div>
            </div>

            {/* Key stats row */}
            <div
              style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}
            >
              {[
                { label: "Sessions (7d)", value: d.sessionsLast7Days },
                { label: "Total sessions", value: d.totalShopperSessions },
                { label: "Chat messages", value: d.totalChatMessages },
                { label: "VTO sessions", value: d.totalTryOnSessions },
                { label: "Credits/mo", value: d.creditsBurnedThisMonth },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 6, padding: "12px 16px" }}
                >
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{s.value.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Issues */}
            {d.openIssues.length > 0 && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 6,
                  padding: "12px 16px",
                  marginBottom: 20,
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 12, color: "#dc2626", marginRight: 4 }}>Issues:</span>
                {d.openIssues.map((issue: string, i: number) => (
                  <span key={i} style={{ fontSize: 13, color: "#7f1d1d" }}>• {issue}</span>
                ))}
              </div>
            )}

            {/* Activity chart */}
            <Section title="Stylist sessions — last 7 days">
              <ActivityChart data={d.activityByDay} />
            </Section>

            {/* Creative sets */}
            <Section title={`Creative Studio — ${d.totalCreativeSets} sets`}>
              {d.recentCreativeSets.length === 0 ? (
                <p style={{ color: "#888", fontSize: 13 }}>No creative sets yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Status</th>
                      <th>Triggered by</th>
                      <th>Error</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentCreativeSets.map((set) => (
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      <CreativeSetRow key={set.id} csrf={csrf} set={set as unknown as { id: string; status: string; triggeredBy: string | null; error: string | null; createdAt: Date; updatedAt: Date }} />
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            {/* VTO sessions */}
            <Section title="VTO renders — last 10">
              {d.recentTryOns.length === 0 ? (
                <p style={{ color: "#888", fontSize: 13 }}>No VTO renders yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Status</th>
                      <th>Provider</th>
                      <th>Latency</th>
                      <th>Error</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentTryOns.map((t) => (
                      <tr key={t.id}>
                        <td style={{ padding: "7px 0", fontSize: 12, fontFamily: "monospace", color: "#555" }}>
                          {t.id.slice(0, 12)}…
                        </td>
                        <td style={{ padding: "7px 8px" }}>{statusPill(t.status)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 12, color: "#555" }}>{t.providerKey ?? "—"}</td>
                        <td style={{ padding: "7px 8px", fontSize: 12, color: "#555" }}>
                          {t.latencyMs != null ? `${t.latencyMs}ms` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 12, color: "#dc2626", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.error ?? "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 12, color: "#888" }}>{timeAgo(String(t.createdAt))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            {/* Catalog gaps */}
            {d.topCatalogGaps.length > 0 && (
              <Section title="Top catalog gaps">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {d.topCatalogGaps.map((g) => (
                    <div
                      key={g.query}
                      style={{
                        background: "#f5f5f5",
                        border: "1px solid #e5e5e5",
                        borderRadius: 4,
                        padding: "5px 10px",
                        fontSize: 12,
                        color: "#333",
                      }}
                    >
                      {g.query} <strong>×{g.count}</strong>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Brand DNA */}
            <Section title="Brand DNA">
              {d.brandProfile ? (
                <div>
                  <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
                    Last trained: {d.brandProfile.trainedAt ? timeAgo(String(d.brandProfile.trainedAt)) : "Never"}
                  </p>
                  {!!d.brandProfile.toneJson && (
                    <pre
                      style={{
                        background: "#f9f9f9",
                        border: "1px solid #eee",
                        borderRadius: 5,
                        padding: 12,
                        fontSize: 12,
                        fontFamily: "monospace",
                        overflowX: "auto",
                        color: "#333",
                      }}
                    >
                      {JSON.stringify(d.brandProfile.toneJson, null, 2)}
                    </pre>
                  )}
                </div>
              ) : (
                <p style={{ color: "#888", fontSize: 13 }}>No brand DNA computed yet.</p>
              )}
            </Section>

            {/* Recent events */}
            <Section title="Recent analytics events">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Product</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentEvents.slice(0, 20).map((e) => (
                    <tr key={e.id}>
                      <td style={{ padding: "5px 0", fontSize: 12, fontFamily: "monospace" }}>{e.name}</td>
                      <td style={{ padding: "5px 8px", fontSize: 12, color: "#888" }}>{e.productId?.slice(0, 12) ?? "—"}</td>
                      <td style={{ padding: "5px 8px", fontSize: 12, color: "#888" }}>{timeAgo(String(e.createdAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Raw plan features JSON editor */}
            <Section title="⚠ Raw plan override — planFeaturesJson">
              <PlanFeaturesEditor current={d.planFeaturesJson} shopId={d.shopId} csrf={csrf} />
            </Section>
          </div>
        </body>
      </html>
    </>
  );
}
