import { notFound } from "next/navigation";
import { prisma } from "~/lib/db";
import BrandActions from "./BrandActions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ shopId: string }>;
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
        padding: "4px 12px",
        borderRadius: 20,
        fontFamily: "var(--mono)",
        fontSize: 11,
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

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "18px 22px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--mute)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: 30,
          lineHeight: 1,
          color: "var(--text)",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default async function BrandDetailPage({ params }: PageProps) {
  const { shopId } = await params;

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      plan: true,
      brandProfile: true,
      _count: {
        select: {
          products: true,
          events: true,
          tryOnSessions: true,
        },
      },
    },
  });

  if (!shop) notFound();
  // After notFound(), shop is guaranteed to be non-null
  const shopData = shop!;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [eventsByName, assistedOrders, recentEvents] = await Promise.all([
    prisma.analyticsEvent.groupBy({
      by: ["name"],
      where: { shopId, createdAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
      orderBy: { _count: { name: "desc" } },
      take: 15,
    }),
    prisma.analyticsEvent.findMany({
      where: { shopId, name: "MIRA_ASSISTED_ORDER" },
      select: { payload: true },
    }),
    prisma.analyticsEvent.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { name: true, createdAt: true, payload: true },
    }),
  ]);

  // Sum assisted revenue
  let assistedRevenuePence = 0;
  for (const ev of assistedOrders) {
    const p = ev.payload as Record<string, unknown>;
    const val = p?.orderValuePence ?? p?.value ?? p?.total;
    if (typeof val === "number") assistedRevenuePence += val;
  }

  const isActive = !shopData.uninstalledAt;

  const tdCss: React.CSSProperties = {
    padding: "11px 0",
    borderBottom: "1px solid var(--line)",
    fontFamily: "var(--mono)",
    fontSize: 12,
    color: "var(--mute)",
    verticalAlign: "middle",
  };

  return (
    <div style={{ padding: "40px 48px", maxWidth: 1100 }}>
      {/* Back */}
      <a
        href="/admin/brands"
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--mute)",
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 24,
        }}
      >
        ← All brands
      </a>

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 32,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <h1
              style={{
                fontFamily: "var(--serif)",
                fontSize: 32,
                fontWeight: 400,
                color: "var(--text)",
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              {shopData.shopifyDomain}
            </h1>
            <TierBadge tier={shopData.plan?.tier ?? "—"} />
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: isActive ? "#4ade80" : "#f87171",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: isActive ? "#4ade80" : "#f87171",
                  display: "inline-block",
                }}
              />
              {isActive ? "Active" : "Uninstalled"}
            </span>
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--mute)",
            }}
          >
            Installed{" "}
            {shopData.installedAt.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {shopData.uninstalledAt &&
              ` · Uninstalled ${shopData.uninstalledAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginBottom: 28,
        }}
      >
        <KpiCard label="Products" value={shopData._count.products.toLocaleString()} />
        <KpiCard label="Events (30d)" value={eventsByName.reduce((s: number, e) => s + (e._count as { _all: number })._all, 0).toLocaleString()} />
        <KpiCard label="Try-ons" value={shopData._count.tryOnSessions.toLocaleString()} />
        <KpiCard
          label="Assisted revenue"
          value={
            assistedRevenuePence > 0
              ? new Intl.NumberFormat("en-GB", {
                  style: "currency",
                  currency: "GBP",
                  minimumFractionDigits: 0,
                }).format(assistedRevenuePence / 100)
              : "—"
          }
        />
      </div>

      {/* Actions + Events side-by-side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Event breakdown */}
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
            Top events (30d)
          </div>
          {eventsByName.length === 0 ? (
            <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--mute)" }}>
              No events in last 30 days.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {eventsByName.map((ev) => (
                  <tr key={ev.name}>
                    <td style={{ ...tdCss, color: "var(--text)", paddingRight: 16 }}>
                      {ev.name}
                    </td>
                    <td
                      style={{
                        ...tdCss,
                        textAlign: "right",
                        color: "var(--electric)",
                        fontWeight: 500,
                      }}
                    >
                      {(ev._count as { _all: number })._all.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Actions */}
        <BrandActions shopId={shopId} domain={shopData.shopifyDomain} currentTier={shopData.plan?.tier ?? "STARTER"} />
      </div>

      {/* Recent events feed */}
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
          Recent events
        </div>
        {recentEvents.length === 0 ? (
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--mute)" }}>
            No events yet.
          </div>
        ) : (
          <div>
            {recentEvents.map((ev, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "9px 0",
                  borderBottom: i < recentEvents.length - 1 ? "1px solid var(--line)" : "none",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: "var(--text)",
                  }}
                >
                  {ev.name}
                </div>
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--mute)",
                  }}
                >
                  {ev.createdAt.toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
