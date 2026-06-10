"use client";
import Link from "next/link";

export default function Nav() {
  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 80,
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        padding: "18px 32px",
        background: "rgba(8,7,10,0.55)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        color: "#F4F2EE",
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "0.32em",
        textTransform: "uppercase",
      }}
    >
      <nav style={{ display: "flex", gap: 28, justifyContent: "flex-start", alignItems: "center" }}>
        <Link href="/collection/the-atelier">Atelier</Link>
        <Link href="/collection/evening">Evening</Link>
        <Link href="/collection/tailoring">Tailoring</Link>
      </nav>
      <Link
        href="/"
        style={{
          fontFamily: "var(--serif)",
          fontSize: 22,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
        }}
      >
        Stylique
      </Link>
      <nav style={{ display: "flex", gap: 28, justifyContent: "flex-end", alignItems: "center" }}>
        <Link href="/collection/knitwear">Knitwear</Link>
        <Link href="/collection/outerwear">Outerwear</Link>
      </nav>
    </header>
  );
}
