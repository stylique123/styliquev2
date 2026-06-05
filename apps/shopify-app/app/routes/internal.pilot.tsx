// Stylique Pilot Admin Dashboard
// Shows the 20 most recent pilot shops with 24h event counts, error counts, and quick links.
// Protected by STYLIQUE_INTERNAL_SECRET — same auth pattern as internal._index.tsx

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireInternalAuth } from "../lib/internal-auth.server";
import { prisma } from "../db.server";

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  requireInternalAuth(request);

  // 24-hour threshold for event counts
  const threshold = new Date();
  threshold.setHours(threshold.getHours() - 24);

  // Fetch 20 most recent shops with plan tier and total event count
  const shops = await prisma.shop.findMany({
    orderBy: { installedAt: "desc" },
    take: 20,
    select: {
      id: true,
      shopifyDomain: true,
      installedAt: true,
      accessToken: true,
      scopes: true,
      uninstalledAt: true,
      plan: {
        select: {
          tier: true,
          planFeaturesJson: true,
        },
      },
      _count: {
        select: {
          events: true,
        },
      },
    },
  });

  // For each shop, count events in the last 24h and error events in the last 24h
  const augmented = await Promise.all(
    shops.map(async (shop) => {
      const events24h = await prisma.analyticsEvent.count({
        where: {
          shopId: shop.id,
          createdAt: { gte: threshold },
        },
      });

      const errors24h = await prisma.analyticsEvent.count({
        where: {
          shopId: shop.id,
          createdAt: { gte: threshold },
          name: { in: ["TRYON_RENDER_FAILED", "CART_FAILED", "MIRA_NAVIGATION_FAILED"] },
        },
      });

      return {
        ...shop,
        events24h,
        errors24h,
      };
    })
  );

  return json({
    shops: augmented,
    generatedAt: new Date().toISOString(),
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PilotDashboard() {
  const { shops, generatedAt } = useLoaderData<typeof loader>();

  return (
    <>
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <title>Stylique — Pilot Dashboard</title>
          <style>{`
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: #F5F5F5; color: #111; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
            a { color: #1a1a1a; text-decoration: none; }
            a:hover { text-decoration: underline; }
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
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 15,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Stylique Ops
                </span>
                <a href="/internal" style={{ fontSize: 13, color: "#666" }}>
                  Brands
                </a>
                <a href="/internal/jobs" style={{ fontSize: 13, color: "#666" }}>
                  Jobs
                </a>
                <a
                  href="/internal/pilot"
                  style={{ fontSize: 13, fontWeight: 600, color: "#111" }}
                >
                  Pilot
                </a>
              </div>
              <span style={{ fontSize: 12, color: "#999" }}>
                Internal — not for merchant access
              </span>
            </div>

            {/* Header */}
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              Pilot Dashboard
            </h1>
            <p style={{ fontSize: 13, color: "#888", marginBottom: 28 }}>
              20 most recent shops &nbsp;·&nbsp; Generated{" "}
              {new Date(generatedAt).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>

            {/* Quick links */}
            <div
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 28,
                flexWrap: "wrap",
              }}
            >
              {[
                { label: "Brand List", href: "/internal" },
                { label: "Failed Jobs", href: "/internal/jobs" },
                { label: "App Health", href: "/api/health" },
                { label: "Worker Health", href: "/internal/jobs" },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  style={{
                    padding: "6px 14px",
                    background: "#fff",
                    border: "1px solid #e0e0e0",
                    borderRadius: 5,
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#333",
                  }}
                >
                  {link.label}
                </a>
              ))}
            </div>

            {/* Table */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #e5e5e5",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#f9f9f9",
                      borderBottom: "1px solid #e5e5e5",
                    }}
                  >
                    {[
                      "Store",
                      "Tier",
                      "Pilot",
                      "Events 24h",
                      "Errors 24h",
                      "Total Events",
                      "Joined",
                      "Detail",
                    ].map((col) => (
                      <th
                        key={col}
                        style={{
                          padding: "10px 14px",
                          textAlign: "left",
                          fontWeight: 600,
                          fontSize: 12,
                          color: "#555",
                          letterSpacing: "0.03em",
                          textTransform: "uppercase",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shops.map((shop) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const features = (shop.plan?.planFeaturesJson ?? {}) as Record<string, any>;
                    const isPilot = Boolean(features.isPilot);
                    const rowBg = shop.errors24h > 0 ? "#fff8f0" : "#fff";

                    return (
                      <tr
                        key={shop.id}
                        style={{
                          background: rowBg,
                          borderBottom: "1px solid #f0f0f0",
                        }}
                      >
                        {/* Store */}
                        <td style={{ padding: "10px 14px" }}>
                          <a
                            href={`/internal/${shop.id}`}
                            style={{ fontWeight: 600, color: "#1a1a1a" }}
                          >
                            {shop.shopifyDomain.replace(".myshopify.com", "")}
                          </a>
                          <div
                            style={{
                              fontSize: 11,
                              color: "#999",
                              marginTop: 2,
                            }}
                          >
                            {shop.shopifyDomain}
                          </div>
                        </td>

                        {/* Tier */}
                        <td style={{ padding: "10px 14px" }}>
                          {shop.plan?.tier ? (
                            <span
                              style={{
                                padding: "2px 8px",
                                borderRadius: 3,
                                fontSize: 11,
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                backgroundColor:
                                  shop.plan.tier === "ULTIMATE"
                                    ? "#166534"
                                    : shop.plan.tier === "GROWTH"
                                    ? "#1e3a5f"
                                    : "#2d2d2d",
                                color:
                                  shop.plan.tier === "ULTIMATE"
                                    ? "#86efac"
                                    : shop.plan.tier === "GROWTH"
                                    ? "#93c5fd"
                                    : "#aaa",
                              }}
                            >
                              {shop.plan.tier}
                            </span>
                          ) : (
                            <span style={{ color: "#bbb", fontSize: 12 }}>—</span>
                          )}
                        </td>

                        {/* Pilot flag */}
                        <td
                          style={{
                            padding: "10px 14px",
                            textAlign: "center",
                            fontSize: 15,
                          }}
                        >
                          {isPilot ? (
                            <span
                              style={{ color: "#22c55e" }}
                              title="isPilot = true"
                            >
                              ✓
                            </span>
                          ) : (
                            <span style={{ color: "#ddd" }}>—</span>
                          )}
                        </td>

                        {/* Events 24h */}
                        <td
                          style={{
                            padding: "10px 14px",
                            fontWeight: 600,
                            color: shop.events24h > 0 ? "#111" : "#bbb",
                          }}
                        >
                          {shop.events24h.toLocaleString()}
                        </td>

                        {/* Errors 24h */}
                        <td style={{ padding: "10px 14px" }}>
                          {shop.errors24h > 0 ? (
                            <span
                              style={{
                                fontWeight: 700,
                                color: "#dc2626",
                              }}
                            >
                              {shop.errors24h.toLocaleString()}
                            </span>
                          ) : (
                            <span style={{ color: "#bbb" }}>0</span>
                          )}
                        </td>

                        {/* Total events */}
                        <td
                          style={{
                            padding: "10px 14px",
                            color: "#555",
                          }}
                        >
                          {shop._count.events.toLocaleString()}
                        </td>

                        {/* Joined */}
                        <td
                          style={{
                            padding: "10px 14px",
                            color: "#777",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatDate(shop.installedAt as unknown as string)}
                        </td>

                        {/* Detail link */}
                        <td style={{ padding: "10px 14px" }}>
                          <a
                            href={`/internal/${shop.id}`}
                            style={{
                              padding: "4px 10px",
                              background: "#1a1a1a",
                              color: "#fff",
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                            }}
                          >
                            View
                          </a>
                        </td>
                      </tr>
                    );
                  })}

                  {shops.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        style={{
                          padding: "40px 0",
                          textAlign: "center",
                          color: "#999",
                          fontSize: 14,
                        }}
                      >
                        No shops found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div
              style={{
                display: "flex",
                gap: 20,
                marginTop: 16,
                fontSize: 12,
                color: "#888",
                flexWrap: "wrap",
              }}
            >
              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: 12,
                    height: 12,
                    background: "#fff8f0",
                    border: "1px solid #e5e5e5",
                    verticalAlign: "middle",
                    marginRight: 4,
                  }}
                />
                Row highlighted = errors in last 24h
              </span>
              <span>
                <span style={{ color: "#22c55e", marginRight: 4 }}>✓</span>
                Pilot flag set on planFeaturesJson.isPilot
              </span>
              <span>Events sourced from AnalyticsEvent table &nbsp;·&nbsp; Errors filtered to TRYON_RENDER_FAILED, CART_FAILED, MIRA_NAVIGATION_FAILED</span>
            </div>
          </div>
        </body>
      </html>
    </>
  );
}
