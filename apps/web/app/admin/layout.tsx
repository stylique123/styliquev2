"use client";
import Link from "next/link";

const NAV = [
  { href: "/admin", label: "Overview", icon: "◈" },
  { href: "/admin/brands", label: "Brands", icon: "◉" },
  { href: "/admin/revenue", label: "Revenue", icon: "◆" },
  { href: "/admin/system", label: "System", icon: "◎" },
  { href: "/admin/enterprise", label: "Enterprise", icon: "✦" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "var(--sans)" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          minWidth: 220,
          background: "#0D0B10",
          borderRight: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          padding: "28px 0",
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 50,
        }}
      >
        {/* Logo */}
        <div style={{ padding: "0 24px 28px", borderBottom: "1px solid var(--line)" }}>
          <Link href="/admin" style={{ textDecoration: "none" }}>
            <div
              style={{
                fontFamily: "var(--serif)",
                fontSize: 22,
                background: "var(--grad)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                letterSpacing: "-0.02em",
              }}
            >
              Stylique
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 9.5,
                color: "var(--mute-2)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginTop: 3,
              }}
            >
              Internal dashboard
            </div>
          </Link>
        </div>

        {/* Nav */}
        <nav style={{ padding: "20px 12px", flex: 1 }}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 8,
                color: "var(--mute)",
                textDecoration: "none",
                fontSize: 13.5,
                fontWeight: 500,
                marginBottom: 2,
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "rgba(139,92,246,0.1)";
                (e.currentTarget as HTMLElement).style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--mute)";
              }}
            >
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 13,
                  color: "var(--electric)",
                  opacity: 0.7,
                }}
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line)" }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--mute-2)",
              letterSpacing: "0.05em",
            }}
          >
            Stylique HQ · Internal
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          marginLeft: 220,
          background: "var(--bg)",
          minHeight: "100vh",
        }}
      >
        {children}
      </main>
    </div>
  );
}
