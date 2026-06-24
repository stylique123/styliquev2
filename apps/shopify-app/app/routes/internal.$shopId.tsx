// Stylique Internal Ops — Brand Detail Page.
// Shows full activity, jobs, VTO, and Brand DNA for one brand.

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireInternalAuth } from "../lib/internal-auth.server";
import { getBrandDetail } from "../lib/internal-dashboard.server";
import { generateCSRFToken, verifyCSRFToken } from "../lib/entitlement.server";
import { prisma } from "../db.server";
import { PLAN_DEFAULTS, PLAN_FEATURES } from "@stylique/core";
import type { AnalyticsLevel, PlanTier } from "@stylique/types";

const PLAN_TIERS = ["STARTER", "GROWTH", "ULTIMATE"] as const;

function normalizeTier(raw: FormDataEntryValue | string | null): PlanTier | null {
  const tier = String(raw ?? "").toUpperCase();
  return PLAN_TIERS.includes(tier as PlanTier) ? tier as PlanTier : null;
}

function buildTierPatch(tier: PlanTier, current: Record<string, unknown>) {
  const defaults = PLAN_DEFAULTS[tier];
  const features = PLAN_FEATURES[tier];
  const now = new Date().toISOString();
  const comp = current.comp === true;
  return {
    tier,
    monthlyTryOnPersonal: defaults.monthlyTryOnPersonal,
    monthlyTryOnBody: defaults.monthlyTryOnBody,
    monthlyStylistTurns: features.stylist.monthlyTurns,
    monthlyStyleRecs: defaults.monthlyStyleRecs,
    monthlyFitRecs: defaults.monthlyFitRecs,
    analyticsLevel: features.analytics.level as AnalyticsLevel,
    planFeaturesJson: {
      ...current,
      comp,
      billingActive: comp,
      billing: {
        ...((typeof current.billing === "object" && current.billing
          ? current.billing
          : {}) as Record<string, unknown>),
        status: comp ? "ops_comp" : "pending",
        tier,
        source: "internal_ops_brand_detail",
        updatedAt: now,
      },
      provisioning: {
        ...((typeof current.provisioning === "object" && current.provisioning
          ? current.provisioning
          : {}) as Record<string, unknown>),
        updatedBy: "internal_ops",
        updatedAt: now,
      },
    },
  };
}

// ─── Loader ──────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  requireInternalAuth(request);
  const shopId = params.shopId as string;
  const detail = await getBrandDetail(shopId);
  if (!detail) throw new Response("Brand not found", { status: 404 });
  // Generate a CSRF token bound to STYLIQUE_INTERNAL_SECRET so destructive
  // action forms (change_tier, save_plan_features) are CSRF-protected.
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
    const tier = normalizeTier(formData.get("tier"));
    if (!tier) return json({ ok: false, error: "Invalid tier" }, { status: 400 });
    const existing = await prisma.plan.findUnique({ where: { shopId }, select: { planFeaturesJson: true } });
    const current = (existing?.planFeaturesJson as Record<string, unknown> | null) ?? {};
    const patch = buildTierPatch(tier, current);
    await prisma.plan.upsert({
      where: { shopId },
      update: patch,
      create: { shopId, ...patch },
    });
    return json({ ok: true, message: `Tier updated to ${tier}` });
  }

  // Comp / un-comp a brand — grants full paid access under BILLING_ENFORCED
  // without a subscription (pilot / grandfathered). Read-merge-write so other
  // planFeaturesJson keys survive.
  if (intent === "set_comp") {
    const on = formData.get("comp") === "1";
    const existing = await prisma.plan.findUnique({ where: { shopId }, select: { planFeaturesJson: true } });
    const pf = ((existing?.planFeaturesJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    pf.comp = on;
    await prisma.plan.upsert({
      where: { shopId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { planFeaturesJson: pf as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { shopId, planFeaturesJson: pf as any },
    });
    return json({ ok: true, message: on ? "Brand comp'd — full access" : "Comp removed" });
  }

  // Per-brand monthly body-render ceiling. Empty → clear the override (tier
  // default applies). Merged into planFeaturesJson.widget so resolveFeatures
  // surfaces it through capForMetric.
  if (intent === "set_render_cap") {
    const raw = ((formData.get("cap") as string | null) ?? "").trim();
    const existing = await prisma.plan.findUnique({ where: { shopId }, select: { planFeaturesJson: true } });
    const pf = ((existing?.planFeaturesJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const widget = ((pf.widget as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
    if (raw === "") {
      delete widget.monthlyTryOnBody;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return json({ ok: false, error: "Cap must be a non-negative number" }, { status: 400 });
      widget.monthlyTryOnBody = Math.round(n);
    }
    pf.widget = widget;
    await prisma.plan.upsert({
      where: { shopId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { planFeaturesJson: pf as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { shopId, planFeaturesJson: pf as any },
    });
    return json({ ok: true, message: raw === "" ? "Render cap reset to tier default" : `Render cap set to ${Math.round(Number(raw))}/mo` });
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

// ─── Plan features JSON editor ────────────────────────────────────────────

function PlanFeaturesEditor({ current, shopId, csrf }: { current: unknown; shopId: string; csrf: string }) {
  const [value, setValue] = useState(JSON.stringify(current ?? {}, null, 2));
  const fetcher = useFetcher<{ ok: boolean; message?: string; error?: string }>();
  const result = fetcher.data;
  const cur = (current ?? {}) as { comp?: boolean; billingActive?: boolean; widget?: { monthlyTryOnBody?: number } };
  const comped = cur.comp === true || cur.billingActive === true;
  const curCap = cur.widget?.monthlyTryOnBody;

  const ctrlBtn = { padding: "6px 12px", fontSize: 12, fontWeight: 600, border: "1px solid #ccc", borderRadius: 5, background: "#fff", color: "#111", cursor: "pointer" } as const;

  return (
    <div>
      {/* Manual billing + limit controls (founder: "give me the option to
          manually allot this from my dashboard"). Both read-merge-write into
          planFeaturesJson — comp = full access under BILLING_ENFORCED; the cap
          overrides this brand's monthly body-render ceiling. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-end", marginBottom: 16, padding: 12, background: "#f5f5f5", borderRadius: 6 }}>
        <fetcher.Form method="post" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="hidden" name="intent" value="set_comp" />
          <input type="hidden" name="comp" value={comped ? "0" : "1"} />
          <input type="hidden" name="csrf" value={csrf} />
          <span style={{ fontSize: 12, color: "#555" }}>Billing: <b style={{ color: comped ? "#166534" : "#b45309" }}>{comped ? "comp'd (full access)" : "standard"}</b></span>
          <button type="submit" style={ctrlBtn}>{comped ? "Remove comp" : "Comp this brand"}</button>
        </fetcher.Form>
        <fetcher.Form method="post" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="hidden" name="intent" value="set_render_cap" />
          <input type="hidden" name="csrf" value={csrf} />
          <label style={{ fontSize: 12, color: "#555" }}>Try-on render limit / mo
            <input name="cap" type="number" min={0} defaultValue={curCap ?? ""} placeholder="tier default"
              style={{ width: 110, marginLeft: 8, padding: "5px 8px", fontSize: 12, border: "1px solid #ccc", borderRadius: 5 }} />
          </label>
          <button type="submit" style={ctrlBtn}>Set limit</button>
        </fetcher.Form>
      </div>
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

            <Section title="Install + Shopify scopes">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                <div style={{ background: "#f9fafb", border: "1px solid #eee", borderRadius: 6, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#777", textTransform: "uppercase", letterSpacing: "0.05em" }}>Widget heartbeat</div>
                  <div style={{ marginTop: 6, fontWeight: 700, color: d.widgetLive ? "#166534" : "#b45309" }}>
                    {d.widgetLive ? "Seen in last 7 days" : "No recent beacon"}
                  </div>
                </div>
                <div style={{ background: "#f9fafb", border: "1px solid #eee", borderRadius: 6, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#777", textTransform: "uppercase", letterSpacing: "0.05em" }}>Required scopes</div>
                  <div style={{ marginTop: 6, fontWeight: 700, color: d.missingShopifyScopes.length ? "#dc2626" : "#166534" }}>
                    {d.missingShopifyScopes.length ? `Missing ${d.missingShopifyScopes.length}` : "Complete"}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "#666", lineHeight: 1.5 }}>
                    {d.requiredShopifyScopes.join(", ")}
                  </div>
                </div>
                <div style={{ background: "#f9fafb", border: "1px solid #eee", borderRadius: 6, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#777", textTransform: "uppercase", letterSpacing: "0.05em" }}>Action</div>
                  <div style={{ marginTop: 6, fontSize: 13, color: "#444" }}>
                    {d.missingShopifyScopes.length || d.extraShopifyScopes.length ? "Ask merchant to re-consent/reinstall." : "No scope action needed."}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {d.missingShopifyScopes.length > 0 && (
                  <div style={{ fontSize: 12, color: "#991b1b" }}>
                    Missing: {d.missingShopifyScopes.join(", ")}
                  </div>
                )}
                {d.extraShopifyScopes.length > 0 && (
                  <div style={{ fontSize: 12, color: "#92400e" }}>
                    Extra stale scopes: {d.extraShopifyScopes.join(", ")}
                  </div>
                )}
                <div style={{ fontSize: 12, color: d.liveShopifyScopeCheck.status === "checked" ? "#166534" : "#92400e" }}>
                  Live Shopify scope check: {d.liveShopifyScopeCheck.status}
                  {d.liveShopifyScopeCheck.status !== "checked" ? ` (${d.liveShopifyScopeCheck.reason})` : ""}
                </div>
                {d.liveShopifyScopeCheck.status === "checked" && (
                  <div style={{ fontSize: 12, color: "#666", wordBreak: "break-word" }}>
                    Live token scopes: {d.liveShopifyScopeCheck.scopes.join(", ") || "none"}
                  </div>
                )}
                {d.liveShopifyScopeCheck.missing.length > 0 && (
                  <div style={{ fontSize: 12, color: "#991b1b" }}>
                    Live token missing: {d.liveShopifyScopeCheck.missing.join(", ")}
                  </div>
                )}
                {d.liveShopifyScopeCheck.extra.length > 0 && (
                  <div style={{ fontSize: 12, color: "#92400e" }}>
                    Live token extra: {d.liveShopifyScopeCheck.extra.join(", ")}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#666", wordBreak: "break-word" }}>
                  Stored token scopes: {d.shopifyScopes || "none recorded"}
                </div>
              </div>
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
