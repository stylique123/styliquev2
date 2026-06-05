import Link from "next/link";
import { prisma } from "~/lib/db";

export const dynamic = "force-dynamic";

function fmt(n: number) {
  return n.toLocaleString("en-GB");
}

function fmtCurrency(pence: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pence / 100);
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "24px 28px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--mute)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: 40,
          lineHeight: 1,
          color: "var(--text)",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--mute)",
            marginTop: 8,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalShops,
    activeShops,
    uninstalledShops,
    planCounts,
    totalEvents30d,
    assistedOrders,
    recentInstalls,
  ] = await Promise.all([
    prisma.shop.count(),
    prisma.shop.count({ where: { uninstalledAt: null } }),
    prisma.shop.count({ where: { uninstalledAt: { not: null } } }),
    prisma.plan.groupBy({ by: ["tier"], _count: { _all: true } }),
    prisma.analyticsEvent.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.analyticsEvent.findMany({
      where: {
        name: "MIRA_ASSISTED_ORDER",
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { payload: true },
    }),
    prisma.shop.findMany({
      where: { uninstalledAt: null },
      orderBy: { installedAt: "desc" },
      take: 5,
      select: {
        id: true,
        shopifyDomain: true,
        installedAt: true,
        plan: { select: { tier: true } },
      },
    }),
  ]);

  // Sum assisted revenue from payloads
  let assistedRevenuePence = 0;
  for (const ev of assistedOrders) {
    const p = ev.payload as Record<string, unknown>;
    const val = p?.orderValuePence ?? p?.value ?? p?.total;
    if (typeof val === "number") assistedRevenuePence += val;
  }

  // Plan distribution
  const planMap: Record<string, number> = {};
  for (const g of planCounts) planMap[g.tier] = g._count._all;
  const totalWithPlan = (planMap.STARTER ?? 0) + (planMap.GROWTH ?? 0) + (planMap.ULTIMATE ?? 0);

  const tierColors: Record<string, string> = {
    STARTER: "var(--mute-2)",
    GROWTH: "var(--electric)",
    ULTIMATE: "var(--pink)",
  };

  return (
    <div style={{ padding: "40px 48px", maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--electric)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Internal dashboard
        </div>
        <h1
          style={{
            fontFamily: "var(--serif)",
            fontSize: 36,
            fontWeight: 400,
            color: "var(--text)",
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          Platform overview
        </h1>
      </div>

      {/* KPI Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <KpiCard label="Total brands" value={fmt(totalShops)} />
        <KpiCard
          label="Active brands"
          value={fmt(activeShops)}
          sub={`${totalShops > 0 ? Math.round((activeShops / totalShops) * 100) : 0}% retention`}
        />
        <KpiCard label="Churned" value={fmt(uninstalledShops)} />
        <KpiCard label="Platform events (30d)" value={fmt(totalEvents30d)} />
      </div>

      {/* Row 2: Plan distribution + Assisted Revenue */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 32 }}>
        {/* Plan Distribution */}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "24px 28px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--mute)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: 20,
            }}
          >
            Plan distribution
          </div>
          {/* Segmented bar */}
          {totalWithPlan > 0 && (
            <div
              style={{
                height: 8,
                borderRadius: 4,
                overflow: "hidden",
                display: "flex",
                marginBottom: 16,
                background: "rgba(255,255,255,0.05)",
              }}
            >
              {(["STARTER", "GROWTH", "ULTIMATE"] as const).map((tier) => {
                const count = planMap[tier] ?? 0;
                const pct = (count / totalWithPlan) * 100;
                if (pct === 0) return null;
                return (
                  <div
                    key={tier}
                    style={{
                      width: `${pct}%`,
                      background: tierColors[tier],
                      transition: "width 0.3s",
                    }}
                  />
                );
              })}
            </div>
          )}
          {(["STARTER", "GROWTH", "ULTIMATE"] as const).map((tier) => (
            <div
              key={tier}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: tierColors[tier],
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: "var(--mute)",
                  }}
                >
                  {tier}
                </span>
              </div>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 13,
                  color: "var(--text)",
                  fontWeight: 500,
                }}
              >
                {planMap[tier] ?? 0}
              </span>
            </div>
          ))}
          <div
            style={{
              borderTop: "1px solid var(--line)",
              marginTop: 12,
              paddingTop: 12,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--mute)",
            }}
          >
            {totalWithPlan} shops with active plans
          </div>
        </div>

        {/* Assisted Revenue */}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "24px 28px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--mute)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Mira-assisted revenue (30d)
          </div>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontSize: 40,
              color: "var(--text)",
              letterSpacing: "-0.02em",
              lineHeight: 1,
              marginBottom: 8,
            }}
          >
            {assistedRevenuePence > 0 ? fmtCurrency(assistedRevenuePence) : "—"}
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--mute)",
            }}
          >
            {fmt(assistedOrders.length)} assisted orders across all shops
          </div>
        </div>
      </div>

      {/* Recent Installs */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: "24px 28px",
          marginBottom: 32,
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--mute)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 20,
          }}
        >
          Recent installs
        </div>

        {recentInstalls.length === 0 ? (
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--mute)" }}>
            No shops installed yet.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Domain", "Tier", "Installed"].map((h) => (
                  <th
                    key={h}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      color: "var(--mute)",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      textAlign: "left",
                      paddingBottom: 12,
                      borderBottom: "1px solid var(--line)",
                      fontWeight: 400,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentInstalls.map((shop: typeof recentInstalls[number]) => (
                <tr key={shop.id}>
                  <td
                    style={{
                      padding: "12px 0",
                      borderBottom: "1px solid var(--line)",
                      fontFamily: "var(--mono)",
                      fontSize: 13,
                      color: "var(--text)",
                    }}
                  >
                    <Link
                      href={`/admin/brands/${shop.id}`}
                      style={{
                        color: "var(--electric)",
                        textDecoration: "none",
                      }}
                    >
                      {shop.shopifyDomain}
                    </Link>
                  </td>
                  <td
                    style={{
                      padding: "12px 0",
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <TierBadge tier={shop.plan?.tier ?? "—"} />
                  </td>
                  <td
                    style={{
                      padding: "12px 0",
                      borderBottom: "1px solid var(--line)",
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: "var(--mute)",
                    }}
                  >
                    {shop.installedAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", gap: 12 }}>
        <Link
          href="/admin/brands"
          style={{
            background: "rgba(139,92,246,0.12)",
            border: "1px solid rgba(139,92,246,0.3)",
            borderRadius: 8,
            padding: "11px 20px",
            color: "var(--electric)",
            fontFamily: "var(--sans)",
            fontWeight: 600,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          → View all brands
        </Link>
        <Link
          href="/admin/enterprise"
          style={{
            background: "rgba(232,121,200,0.1)",
            border: "1px solid rgba(232,121,200,0.25)",
            borderRadius: 8,
            padding: "11px 20px",
            color: "var(--pink)",
            fontFamily: "var(--sans)",
            fontWeight: 600,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          → Create enterprise client
        </Link>
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const styles: Record<string, React.CSSProperties> = {
    STARTER: {
      background: "rgba(142,138,153,0.15)",
      color: "var(--mute)",
      border: "1px solid rgba(142,138,153,0.2)",
    },
    GROWTH: {
      background: "rgba(139,92,246,0.15)",
      color: "var(--electric)",
      border: "1px solid rgba(139,92,246,0.3)",
    },
    ULTIMATE: {
      background: "linear-gradient(135deg,rgba(139,92,246,0.2),rgba(232,121,200,0.2))",
      color: "var(--pink)",
      border: "1px solid rgba(232,121,200,0.3)",
    },
  };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 20,
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontWeight: 500,
        ...(styles[tier] ?? {
          background: "rgba(142,138,153,0.1)",
          color: "var(--mute)",
          border: "1px solid var(--line)",
        }),
      }}
    >
      {tier}
    </span>
  );
}
