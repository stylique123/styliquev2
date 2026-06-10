import { prisma } from "~/lib/db";

export const dynamic = "force-dynamic";

// Hardcoded active experiments (matches lib/experiments.server.ts in shopify app)
const BUILTIN_EXPERIMENTS = [
  {
    key: "stylist_persona_q1_2026",
    description: "A/B test for Mira persona — terse vs default",
    allocation: { default: 0.5, terse: 0.5 },
  },
];

function HealthDot({ status }: { status: "green" | "yellow" | "red" }) {
  const colors = { green: "#4ade80", yellow: "#fbbf24", red: "#f87171" };
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: colors[status],
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

export default async function SystemPage() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    tryOnPending,
    tryOnSucceeded,
    tryOnFailed,
    dbExperiments,
  ] = await Promise.all([
    prisma.tryOnSession.count({
      where: { status: "PENDING", createdAt: { gte: oneDayAgo } },
    }),
    prisma.tryOnSession.count({
      where: { status: "SUCCEEDED", createdAt: { gte: oneDayAgo } },
    }),
    prisma.tryOnSession.count({
      where: { status: "FAILED", createdAt: { gte: oneDayAgo } },
    }),
    prisma.experiment.findMany({
      where: { active: true },
      select: { key: true, description: true, allocation: true, startedAt: true },
    }),
  ]);

  // Combine DB + builtin experiments
  type DbExp = { key: string; description: string | null; allocation: unknown; startedAt: Date | null };
  const allExperiments = [
    ...(dbExperiments as DbExp[]).map((e) => ({
      key: e.key,
      description: e.description ?? "",
      allocation: e.allocation as Record<string, number>,
      source: "db" as const,
    })),
    ...BUILTIN_EXPERIMENTS.filter(
      (b) => !(dbExperiments as DbExp[]).find((d) => d.key === b.key)
    ).map((b) => ({ ...b, source: "code" as const })),
  ];

  // Health calculation
  const tryOnHealth: "green" | "yellow" | "red" =
    tryOnFailed > 10 ? "red" : tryOnFailed > 3 ? "yellow" : "green";

  const sectionHeader: React.CSSProperties = {
    fontFamily: "var(--mono)",
    fontSize: 11,
    color: "var(--mute)",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 20,
  };

  const card: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 12,
    padding: "24px 28px",
  };

  const statRow: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 0",
    borderBottom: "1px solid var(--line)",
    fontFamily: "var(--mono)",
    fontSize: 13,
  };

  return (
    <div style={{ padding: "40px 48px", maxWidth: 1000 }}>
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
          Platform health
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
          System
        </h1>
      </div>

      {/* Health indicators row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
          marginBottom: 28,
        }}
      >
        {[
          {
            label: "Try-on renders",
            status: tryOnHealth,
            sub: `${tryOnFailed} failed (24h)`,
          },
          {
            label: "Active experiments",
            status: "green" as const,
            sub: `${allExperiments.length} running`,
          },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              ...card,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <HealthDot status={item.status} />
            <div>
              <div style={{ color: "var(--text)", fontFamily: "var(--sans)", fontSize: 14, fontWeight: 500 }}>
                {item.label}
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--mute)", marginTop: 3 }}>
                {item.sub}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Try-on sessions */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={sectionHeader}>Try-on renders (last 24h)</div>
        <div>
          {[
            { label: "Pending", value: tryOnPending, color: "#fbbf24" },
            { label: "Succeeded", value: tryOnSucceeded, color: "#4ade80" },
            { label: "Failed", value: tryOnFailed, color: "#f87171" },
          ].map((row, i, arr) => (
            <div
              key={row.label}
              style={{
                ...statRow,
                borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : "none",
              }}
            >
              <span style={{ color: "var(--mute)" }}>{row.label}</span>
              <span style={{ color: row.color, fontWeight: 500 }}>
                {row.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* A/B Experiments */}
      <div style={card}>
        <div style={sectionHeader}>A/B experiments</div>
        {allExperiments.length === 0 ? (
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--mute)" }}>
            No active experiments.
          </div>
        ) : (
          <div>
            {allExperiments.map((exp, i) => (
              <div
                key={exp.key}
                style={{
                  padding: "16px 0",
                  borderBottom:
                    i < allExperiments.length - 1
                      ? "1px solid var(--line)"
                      : "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
                    {exp.key}
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 9.5,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      padding: "2px 8px",
                      borderRadius: 12,
                      background:
                        exp.source === "db"
                          ? "rgba(139,92,246,0.15)"
                          : "rgba(255,255,255,0.06)",
                      color:
                        exp.source === "db" ? "var(--electric)" : "var(--mute)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {exp.source === "db" ? "DB" : "CODE"}
                  </span>
                </div>
                {exp.description && (
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--mute)", marginBottom: 8 }}>
                    {exp.description}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(exp.allocation).map(([variant, weight]) => (
                    <span
                      key={variant}
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        color: "var(--mute)",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid var(--line)",
                        borderRadius: 6,
                        padding: "3px 8px",
                      }}
                    >
                      {variant}: {Math.round((weight as number) * 100)}%
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
