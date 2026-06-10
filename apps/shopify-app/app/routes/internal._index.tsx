// Stylique Internal Ops Dashboard — main index.
// Shows all partner brands with health status, activity, and quick actions.
// Protected by STYLIQUE_INTERNAL_SECRET — not Shopify-authenticated.

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireInternalAuth } from "../lib/internal-auth.server";
import { getAllBrandSummaries } from "../lib/internal-dashboard.server";
import { prisma } from "../db.server";

// After json() serialization, Dates become strings. Use this type in the UI.
type SerializedBrandSummary = {
  shopId: string;
  shopifyDomain: string;
  installedAt: string;
  planTier: string;
  brandHealthStatus: string;
  lastActiveAt: string | null;
  totalShopperSessions: number;
  sessionsLast7Days: number;
  totalCreativeSets: number;
  pendingCreativeSets: number;
  failedCreativeSets: number;
  totalTryOnSessions: number;
  tryOnSuccessRate: number;
  totalChatMessages: number;
  avgMessagesPerSession: number;
  creditsBurnedThisMonth: number;
  quotaUsagePercent: number;
  hasBrandDNA: boolean;
  brandDNAAge: number | null;
  openIssues: string[];
  suggestions: string[];
};

// ─── Loader ──────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  requireInternalAuth(request);
  const brands = await getAllBrandSummaries();

  // Global stats
  const totalBrands = brands.length;
  const activeBrands = brands.filter((b) => b.sessionsLast7Days > 0).length;
  const totalCreativeSets = brands.reduce((s, b) => s + b.totalCreativeSets, 0);
  const totalVTO = brands.reduce((s, b) => s + b.totalTryOnSessions, 0);

  return json({ brands, stats: { totalBrands, activeBrands, totalCreativeSets, totalVTO } });
}

// ─── Action (quick overrides) ─────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  requireInternalAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const shopId = formData.get("shopId") as string;

  if (!shopId) return json({ ok: false, error: "shopId required" }, { status: 400 });

  if (intent === "change_tier") {
    const tier = formData.get("tier") as string;
    if (!["STARTER", "GROWTH", "ULTIMATE"].includes(tier)) {
      return json({ ok: false, error: "invalid tier" }, { status: 400 });
    }
    await prisma.plan.upsert({
      where: { shopId },
      update: { tier: tier as "STARTER" | "GROWTH" | "ULTIMATE" },
      create: { shopId, tier: tier as "STARTER" | "GROWTH" | "ULTIMATE" },
    });
    return json({ ok: true, message: `Tier updated to ${tier}` });
  }

  if (intent === "send_notification") {
    const message = formData.get("message") as string;
    if (!message?.trim()) return json({ ok: false, error: "message required" }, { status: 400 });
    await prisma.notification.create({
      data: {
        shopId,
        kind: "PRODUCT_AUDIT_READY",
        payload: { message, source: "internal_ops", sentAt: new Date().toISOString() },
      },
    });
    return json({ ok: true, message: "Notification sent to brand dashboard" });
  }

  if (intent === "pause_generation") {
    const plan = await prisma.plan.findUnique({ where: { shopId }, select: { planFeaturesJson: true } });
    const current = (plan?.planFeaturesJson as Record<string, unknown>) ?? {};
    await prisma.plan.upsert({
      where: { shopId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { planFeaturesJson: { ...current, paused: true } as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { shopId, planFeaturesJson: { paused: true } as any },
    });
    return json({ ok: true, message: "Generation paused for this brand" });
  }

  if (intent === "resume_generation") {
    const plan = await prisma.plan.findUnique({ where: { shopId }, select: { planFeaturesJson: true } });
    const current = (plan?.planFeaturesJson as Record<string, unknown>) ?? {};
    const updated = { ...current };
    delete updated.paused;
    await prisma.plan.upsert({
      where: { shopId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { planFeaturesJson: updated as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { shopId, planFeaturesJson: updated as any },
    });
    return json({ ok: true, message: "Generation resumed" });
  }

  return json({ ok: false, error: "unknown intent" }, { status: 400 });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function healthDot(status: string) {
  const colors: Record<string, string> = {
    healthy: "#22c55e",
    at_risk: "#f59e0b",
    churning: "#ef4444",
    new: "#3b82f6",
    inactive: "#9ca3af",
  };
  const color = colors[status] ?? "#9ca3af";
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        backgroundColor: color,
        marginRight: 6,
        flexShrink: 0,
      }}
      title={status}
    />
  );
}

function tierBadge(tier: string) {
  const colors: Record<string, { bg: string; color: string }> = {
    ULTIMATE: { bg: "#166534", color: "#86efac" },
    GROWTH: { bg: "#1e3a5f", color: "#93c5fd" },
    STARTER: { bg: "#2d2d2d", color: "#aaa" },
  };
  const style = colors[tier] ?? colors.STARTER;
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        backgroundColor: style.bg,
        color: style.color,
      }}
    >
      {tier}
    </span>
  );
}

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

// ─── Quick action modal ───────────────────────────────────────────────────

function QuickActionModal({
  brand,
  onClose,
}: {
  brand: SerializedBrandSummary;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ ok: boolean; message?: string; error?: string }>();
  const [notifMessage, setNotifMessage] = useState("");
  const result = fetcher.data;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 24,
          width: 420,
          maxHeight: "80vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>
          Quick actions — {brand.shopifyDomain}
        </h3>
        <p style={{ margin: "0 0 20px", color: "#666", fontSize: 13 }}>
          Current tier: {brand.planTier}
        </p>

        {result && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 16,
              borderRadius: 4,
              background: result.ok ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`,
              color: result.ok ? "#166534" : "#dc2626",
              fontSize: 13,
            }}
          >
            {result.message ?? result.error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Change tier */}
          <div style={{ background: "#f9f9f9", borderRadius: 6, padding: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Change tier</p>
            <div style={{ display: "flex", gap: 8 }}>
              {(["STARTER", "GROWTH", "ULTIMATE"] as const).map((t) => (
                <fetcher.Form key={t} method="post" style={{ flex: 1 }}>
                  <input type="hidden" name="intent" value="change_tier" />
                  <input type="hidden" name="shopId" value={brand.shopId} />
                  <input type="hidden" name="tier" value={t} />
                  <button
                    type="submit"
                    style={{
                      width: "100%",
                      padding: "6px 4px",
                      fontSize: 12,
                      fontWeight: 600,
                      border: "1px solid #ddd",
                      borderRadius: 4,
                      cursor: "pointer",
                      background: brand.planTier === t ? "#1a1a1a" : "#fff",
                      color: brand.planTier === t ? "#fff" : "#333",
                    }}
                  >
                    {t}
                  </button>
                </fetcher.Form>
              ))}
            </div>
          </div>

          {/* Creative Studio re-queue removed — module deleted per repositioning */}

          {/* Pause / resume generation */}
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="pause_generation" />
            <input type="hidden" name="shopId" value={brand.shopId} />
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "9px 12px",
                fontSize: 13,
                border: "1px solid #fecaca",
                borderRadius: 5,
                cursor: "pointer",
                background: "#fff9f9",
                textAlign: "left",
                color: "#dc2626",
              }}
            >
              ⏸ Pause generation for this brand
            </button>
          </fetcher.Form>

          {/* Send notification */}
          <div style={{ background: "#f9f9f9", borderRadius: 6, padding: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Send dashboard notification
            </p>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="send_notification" />
              <input type="hidden" name="shopId" value={brand.shopId} />
              <textarea
                name="message"
                value={notifMessage}
                onChange={(e) => setNotifMessage(e.target.value)}
                placeholder="Message to show in brand dashboard..."
                style={{
                  width: "100%",
                  padding: "8px",
                  fontSize: 13,
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  resize: "vertical",
                  minHeight: 60,
                  fontFamily: "inherit",
                  marginBottom: 8,
                }}
              />
              <button
                type="submit"
                style={{
                  width: "100%",
                  padding: "8px",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  background: "#1a1a1a",
                  color: "#fff",
                }}
              >
                Send notification
              </button>
            </fetcher.Form>
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 16,
            width: "100%",
            padding: 8,
            background: "transparent",
            border: "1px solid #ddd",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 13,
            color: "#666",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─── Brand card ───────────────────────────────────────────────────────────

function BrandCard({
  brand,
  onOverride,
}: {
  brand: SerializedBrandSummary;
  onOverride: (b: SerializedBrandSummary) => void;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e5e5",
        borderRadius: 7,
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {healthDot(brand.brandHealthStatus)}
          <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {brand.shopifyDomain.replace(".myshopify.com", "")}
          </span>
        </div>
        {tierBadge(brand.planTier)}
      </div>

      <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
        Last active: {timeAgo(brand.lastActiveAt)} &nbsp;·&nbsp; Installed {timeAgo(brand.installedAt)}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          marginBottom: 10,
          fontSize: 12,
        }}
      >
        <div style={{ background: "#f5f5f5", borderRadius: 4, padding: "6px 8px" }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#111" }}>{brand.sessionsLast7Days}</div>
          <div style={{ color: "#888" }}>sessions/7d</div>
        </div>
        <div style={{ background: "#f5f5f5", borderRadius: 4, padding: "6px 8px" }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#111" }}>
            {brand.totalTryOnSessions > 0 ? `${Math.round(brand.tryOnSuccessRate * 100)}%` : "—"}
          </div>
          <div style={{ color: "#888" }}>VTO success</div>
        </div>
      </div>

      {brand.openIssues.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {brand.openIssues.map((issue, i) => (
            <span
              key={i}
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#dc2626",
                padding: "2px 7px",
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              {issue}
            </span>
          ))}
        </div>
      )}

      {brand.suggestions.length > 0 && (
        <div style={{ fontSize: 12, color: "#888", marginBottom: 10, fontStyle: "italic" }}>
          → {brand.suggestions[0]}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <a
          href={`/internal/${brand.shopId}`}
          style={{
            flex: 1,
            padding: "7px 0",
            background: "#1a1a1a",
            color: "#fff",
            borderRadius: 5,
            fontSize: 12,
            fontWeight: 600,
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          View
        </a>
        <button
          onClick={() => onOverride(brand)}
          style={{
            flex: 1,
            padding: "7px 0",
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 5,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            color: "#333",
          }}
        >
          Override
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function InternalIndex() {
  const { brands, stats } = useLoaderData<typeof loader>();
  const [tierFilter, setTierFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [activeModal, setActiveModal] = useState<SerializedBrandSummary | null>(null);

  const filtered = brands.filter((b: SerializedBrandSummary) => {
    if (tierFilter !== "all" && b.planTier !== tierFilter) return false;
    if (healthFilter !== "all" && b.brandHealthStatus !== healthFilter) return false;
    if (search && !b.shopifyDomain.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const selectStyle = {
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 5,
    fontSize: 13,
    background: "#fff",
    color: "#333",
    cursor: "pointer",
  } as const;

  return (
    <>
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <title>Stylique Ops</title>
          <style>{`
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: #F5F5F5; color: #111; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
            a { color: inherit; }
          `}</style>
        </head>
        <body>
          <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px 48px" }}>
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
                <a href="/internal" style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>Brands</a>
                <a href="/internal/jobs" style={{ fontSize: 13, color: "#666" }}>Jobs</a>
              </div>
              <span style={{ fontSize: 12, color: "#999" }}>Internal — not for merchant access</span>
            </div>

            {/* Stats bar */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
              {[
                { label: "Total brands", value: stats.totalBrands },
                { label: "Active (7d)", value: stats.activeBrands },
                { label: "Creative sets (all time)", value: stats.totalCreativeSets },
                { label: "VTO renders (all time)", value: stats.totalVTO },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 7, padding: "16px 20px" }}
                >
                  <div style={{ fontSize: 26, fontWeight: 700 }}>{s.value.toLocaleString()}</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="text"
                placeholder="Search domain..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...selectStyle, minWidth: 200 }}
              />
              <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} style={selectStyle}>
                <option value="all">All tiers</option>
                <option value="STARTER">Starter</option>
                <option value="GROWTH">Growth</option>
                <option value="ULTIMATE">Ultimate</option>
              </select>
              <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} style={selectStyle}>
                <option value="all">All health</option>
                <option value="healthy">Healthy</option>
                <option value="new">New</option>
                <option value="at_risk">At risk</option>
                <option value="churning">Churning</option>
                <option value="inactive">Inactive</option>
              </select>
              <span style={{ fontSize: 13, color: "#888" }}>
                {filtered.length} of {brands.length} brand{brands.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Brand grid */}
            {filtered.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#999", fontSize: 14 }}>
                No brands match the current filters.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                  gap: 16,
                }}
              >
                {filtered.map((brand: SerializedBrandSummary) => (
                  <BrandCard
                    key={brand.shopId}
                    brand={brand}
                    onOverride={(b) => setActiveModal(b)}
                  />
                ))}
              </div>
            )}
          </div>

          {activeModal && (
            <QuickActionModal brand={activeModal} onClose={() => setActiveModal(null)} />
          )}
        </body>
      </html>
    </>
  );
}
