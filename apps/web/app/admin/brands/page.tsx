import Link from "next/link";
import { prisma } from "~/lib/db";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string; tier?: string }>;
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

export default async function BrandsPage({ searchParams }: PageProps) {
  const { q, tier } = await searchParams;

  const shops = await prisma.shop.findMany({
    where: {
      ...(q ? { shopifyDomain: { contains: q, mode: "insensitive" } } : {}),
      ...(tier
        ? { plan: { tier: tier as "STARTER" | "GROWTH" | "ULTIMATE" } }
        : {}),
    },
    include: {
      plan: true,
      _count: {
        select: {
          events: true,
          products: true,
          tryOnSessions: true,
          creatives: true,
        },
      },
    },
    orderBy: { installedAt: "desc" },
    take: 100,
  });

  const thCss: React.CSSProperties = {
    fontFamily: "var(--mono)",
    fontSize: 10,
    color: "var(--mute)",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    textAlign: "left",
    paddingBottom: 12,
    borderBottom: "1px solid var(--line)",
    fontWeight: 400,
    paddingRight: 20,
    whiteSpace: "nowrap",
  };

  const tdCss: React.CSSProperties = {
    padding: "13px 20px 13px 0",
    borderBottom: "1px solid var(--line)",
    fontFamily: "var(--mono)",
    fontSize: 12,
    color: "var(--mute)",
    verticalAlign: "middle",
  };

  return (
    <div style={{ padding: "40px 48px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
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
            All brands
          </div>
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
            Brands · {shops.length}
            {shops.length === 100 && "+"}
          </h1>
        </div>
      </div>

      {/* Search + filter */}
      <form
        method="GET"
        style={{ display: "flex", gap: 12, marginBottom: 28, alignItems: "center" }}
      >
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search domain..."
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line-2)",
            borderRadius: 8,
            padding: "10px 16px",
            color: "var(--text)",
            fontFamily: "var(--mono)",
            fontSize: 13,
            outline: "none",
            width: 280,
          }}
        />
        <select
          name="tier"
          defaultValue={tier ?? ""}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line-2)",
            borderRadius: 8,
            padding: "10px 16px",
            color: "var(--mute)",
            fontFamily: "var(--mono)",
            fontSize: 12,
            outline: "none",
          }}
        >
          <option value="">All tiers</option>
          <option value="STARTER">STARTER</option>
          <option value="GROWTH">GROWTH</option>
          <option value="ULTIMATE">ULTIMATE</option>
        </select>
        <button
          type="submit"
          style={{
            background: "rgba(139,92,246,0.15)",
            border: "1px solid rgba(139,92,246,0.3)",
            borderRadius: 8,
            padding: "10px 20px",
            color: "var(--electric)",
            fontFamily: "var(--sans)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Search
        </button>
        {(q || tier) && (
          <Link
            href="/admin/brands"
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--mute)",
              textDecoration: "none",
            }}
          >
            ✕ Clear
          </Link>
        )}
      </form>

      {/* Table */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", padding: "0 28px" }}>
            <thead>
              <tr style={{ padding: "0 28px" }}>
                <th style={{ ...thCss, paddingLeft: 28 }}>Domain</th>
                <th style={thCss}>Tier</th>
                <th style={thCss}>Status</th>
                <th style={thCss}>Products</th>
                <th style={thCss}>Try-Ons</th>
                <th style={thCss}>Events</th>
                <th style={thCss}>Installed</th>
                <th style={{ ...thCss, paddingRight: 28 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shops.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      ...tdCss,
                      paddingLeft: 28,
                      color: "var(--mute)",
                      textAlign: "center",
                      padding: "40px 28px",
                    }}
                  >
                    No shops found.
                  </td>
                </tr>
              )}
              {shops.map((shop: typeof shops[number]) => {
                const isActive = !shop.uninstalledAt;
                return (
                  <tr key={shop.id}>
                    <td style={{ ...tdCss, paddingLeft: 28, color: "var(--text)" }}>
                      <Link
                        href={`/admin/brands/${shop.id}`}
                        style={{
                          color: "var(--text)",
                          textDecoration: "none",
                          fontWeight: 500,
                        }}
                      >
                        {shop.shopifyDomain}
                      </Link>
                    </td>
                    <td style={tdCss}>
                      <TierBadge tier={shop.plan?.tier ?? "—"} />
                    </td>
                    <td style={tdCss}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: isActive ? "#4ade80" : "#f87171",
                            display: "inline-block",
                          }}
                        />
                        <span
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 11,
                            color: isActive ? "#4ade80" : "#f87171",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {isActive ? "Active" : "Uninstalled"}
                        </span>
                      </span>
                    </td>
                    <td style={tdCss}>{shop._count.products.toLocaleString()}</td>
                    <td style={tdCss}>{shop._count.tryOnSessions.toLocaleString()}</td>
                    <td style={tdCss}>{shop._count.events.toLocaleString()}</td>
                    <td style={{ ...tdCss, whiteSpace: "nowrap" }}>
                      {shop.installedAt.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td style={{ ...tdCss, paddingRight: 28 }}>
                      <Link
                        href={`/admin/brands/${shop.id}`}
                        style={{
                          color: "var(--electric)",
                          textDecoration: "none",
                          fontFamily: "var(--sans)",
                          fontSize: 12,
                          fontWeight: 600,
                          marginRight: 12,
                        }}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
