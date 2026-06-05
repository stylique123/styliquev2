export default function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "80px 32px 40px",
        background: "var(--bg)",
        color: "var(--mute)",
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        display: "grid",
        gap: 48,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 40 }}>
        <div>
          <div style={{ color: "#F4F2EE", marginBottom: 14 }}>The Maison</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <li>Our story</li>
            <li>The atelier</li>
            <li>Sustainability</li>
            <li>Press</li>
          </ul>
        </div>
        <div>
          <div style={{ color: "#F4F2EE", marginBottom: 14 }}>Services</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <li>Personal styling</li>
            <li>Alterations</li>
            <li>Repairs</li>
            <li>Client care</li>
          </ul>
        </div>
        <div>
          <div style={{ color: "#F4F2EE", marginBottom: 14 }}>Boutiques</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <li>Milan</li>
            <li>Paris</li>
            <li>Tokyo</li>
            <li>New York</li>
          </ul>
        </div>
        <div>
          <div style={{ color: "#F4F2EE", marginBottom: 14 }}>The Letter</div>
          <p style={{ textTransform: "none", letterSpacing: "0.02em", fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.55, color: "var(--mute)" }}>
            Quiet dispatches from the studio — new pieces, journal entries, invitations.
          </p>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <span>© Stylique Maison</span>
        <span>An editorial demo · powered by Stylique AI</span>
      </div>
    </footer>
  );
}
