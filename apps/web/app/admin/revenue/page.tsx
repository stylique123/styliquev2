import { prisma } from "~/lib/db";

export const dynamic = "force-dynamic";

// Pricing tiers (adjust to real pricing)
const PLAN_MRR: Record<string, number> = {
  STARTER: 0,
  GROWTH: 9900, // £99/mo in pence
  ULTIMATE: 29900, // £299/mo in pence
};

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
          fontSize: 36,
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

type ShopRevRow = { shopId: string; _count: { _all: number } };

export default async function RevenuePage() {
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [planDist, allAssistedEvents, recent30Events, topShopsByRevenue] = await Promise.all([
      prisma.plan.groupBy({ by: ["tier"], _count: { _all: true } }),
      prisma.analyticsEvent.findMany({
        where: {
          name: "MIRA_ASSISTED_ORDER",
          createdAt: { gte: sixMonthsAgo },
        },
        select: { payload: true, createdAt: true, shopId: true },
      }),
      prisma.analyticsEvent.findMany({
        where: {
          name: "MIRA_ASSISTED_ORDER",
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { payload: true },
      }),
      prisma.analyticsEvent.groupBy({
        by: ["shopId"],
        _count: { _all: true },
        where: { name: "MIRA_ASSISTED_ORDER" },
        orderBy: { _count: { shopId: "desc" } },
        take: 10,
      }),
    ]);

  // MRR calculation
  const planMap: Record<string, number> = {};
  for (const g of planDist) planMap[g.tier] = g._count._all;
  const totalMrr =
    (planMap.STARTER ?? 0) * PLAN_MRR.STARTER +
    (planMap.GROWTH ?? 0) * PLAN_MRR.GROWTH +
    (planMap.ULTIMATE ?? 0) * PLAN_MRR.ULTIMATE;

  // All-time assisted revenue
  let allTimeAssisted = 0;
  let last30Assisted = 0;

  for (const ev of allAssistedEvents) {
    const p = ev.payload as Record<string, unknown>;
    const val = p?.orderValuePence ?? p?.value ?? p?.total;
    if (typeof val === "number") allTimeAssisted += val;
  }
  for (const ev of recent30Events) {
    const p = ev.payload as Record<string, unknown>;
    const val = p?.orderValuePence ?? p?.value ?? p?.total;
    if (typeof val === "number") last30Assisted += val;
  }

  // Group by month
  const monthlyMap: Record<string, number> = {};
  for (const ev of allAssistedEvents) {
    const key = ev.createdAt.toISOString().slice(0, 7); // "2025-01"
    const p = ev.payload as Record<string, unknown>;
    const val = p?.orderValuePence ?? p?.value ?? p?.total;
    if (typeof val === "number") {
      monthlyMap[key] = (monthlyMap[key] ?? 0) + val;
    }
  }

  // Get shop domains for top revenue shops
  const topShops: ShopRevRow[] = topShopsByRevenue.map((r) => ({
    shopId: r.shopId,
    _count: { _all: r._count._all },
  }));
  const topShopIds = topShops.map((r) => r.shopId);
  const topShopsData = await prisma.shop.findMany({
    where: { id: { in: topShopIds } },
    select: { id: true, shopifyDomain: true, plan: { select: { tier: true } } },
  });
  const shopLookup: Record<string, { domain: string; tier?: string }> = {};
  for (const s of topShopsData) {
    shopLookup[s.id] = { domain: s.shopifyDomain, tier: s.plan?.tier };
  }

  const tierColors: Record<string, string> = {
    STARTER: "var(--mute-2)",
    GROWTH: "var(--electric)",
    ULTIMATE: "var(--pink)",
  };
  const totalWithPlan = Object.values(planMap).reduce((a, b) => a + b, 0);

  const tdCss: React.CSSProperties = {
    padding: "12px 0",
    borderBottom: "1px solid var(--line)",
    fontFamily: "var(--mono)",
    fontSize: 12,
    color: "var(--mute)",
    verticalAlign: "middle",
  };

  return (
    <div style={{ padding: "40px 48px", maxWidth: 1100 }}>
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
          Revenue & billing
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
          Revenue
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
        <KpiCard label="Est. MRR" value={fmtCurrency(totalMrr)} sub="from plan subscriptions" />
        <KpiCard label="Est. ARR" value={fmtCurrency(totalMrr * 12)} />
        <KpiCard
          label="Assisted revenue (30d)"
          value={last30Assisted > 0 ? fmtCurrency(last30Assisted) : "—"}
        />
        <KpiCard
          label="Assisted revenue (all-time)"
          value={allTimeAssisted > 0 ? fmtCurrency(allTimeAssisted) : "—"}
          sub={`${allAssistedEvents.length} assisted orders`}
        />
      </div>

      {/* Plan distribution */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: "24px 28px",
          marginBottom: 24,
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
          Plan distribution & MRR breakdown
        </div>

        {totalWithPlan > 0 && (
          <div
            style={{
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              display: "flex",
              marginBottom: 20,
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
                  style={{ width: `${pct}%`, background: tierColors[tier] }}
                />
              );
            })}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {(["STARTER", "GROWTH", "ULTIMATE"] as const).map((tier) => {
            const count = planMap[tier] ?? 0;
            const mrr = count * PLAN_MRR[tier];
            return (
              <div
                key={tier}
                style={{
                  padding: "16px",
                  background: "rgba(255,255,255,0.025)",
                  borderRadius: 8,
                  border: `1px solid ${tierColors[tier]}30`,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    color: tierColors[tier],
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginBottom: 10,
                  }}
                >
                  {tier}
                </div>
                <div
                  style={{
                    fontFamily: "var(--serif)",
                    fontSize: 28,
                    color: "var(--text)",
                    letterSpacing: "-0.02em",
                    lineHeight: 1,
                    marginBottom: 4,
                  }}
                >
                  {count}
                </div>
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--mute)",
                  }}
                >
                  {fmtCurrency(mrr)} / mo
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Monthly assisted revenue chart (text-based) */}
      {Object.keys(monthlyMap).length > 0 && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "24px 28px",
            marginBottom: 24,
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
            Assisted revenue by month (6 months)
          </div>
          <div>
            {Object.entries(monthlyMap)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([month, pence]) => {
                const maxPence = Math.max(...Object.values(monthlyMap));
                const pct = maxPence > 0 ? (pence / maxPence) * 100 : 0;
                return (
                  <div
                    key={month}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--mute)",
                        minWidth: 60,
                      }}
                    >
                      {month}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        height: 8,
                        background: "rgba(255,255,255,0.05)",
                        borderRadius: 4,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: "var(--grad)",
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 12,
                        color: "var(--text)",
                        minWidth: 80,
                        textAlign: "right",
                      }}
                    >
                      {fmtCurrency(pence)}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Top shops by revenue */}
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
            marginBottom: 16,
          }}
        >
          Top revenue-contributing shops
        </div>
        {topShopsByRevenue.length === 0 ? (
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--mute)" }}>
            No assisted orders recorded yet.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["#", "Domain", "Tier", "Assisted orders"].map((h) => (
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
              {topShops.map((row: ShopRevRow, i: number) => {
                const info = shopLookup[row.shopId];
                return (
                  <tr key={row.shopId}>
                    <td style={{ ...tdCss, paddingRight: 16, width: 32 }}>{i + 1}</td>
                    <td style={{ ...tdCss, color: "var(--text)", paddingRight: 16 }}>
                      <a
                        href={`/admin/brands/${row.shopId}`}
                        style={{ color: "var(--electric)", textDecoration: "none" }}
                      >
                        {info?.domain ?? row.shopId}
                      </a>
                    </td>
                    <td style={{ ...tdCss, paddingRight: 16 }}>
                      {info?.tier ? (
                        <span
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10,
                            color: tierColors[info.tier] ?? "var(--mute)",
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                          }}
                        >
                          {info.tier}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ ...tdCss, color: "var(--text)", fontWeight: 500 }}>
                      {row._count._all.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
