// Stylique Brand Portal — landing page
// Fashion-centric editorial hero with brand-intelligence copy.
// Two CTAs: "Connect your store" (Shopify install flow) + "View demo" (/demo)

import Link from "next/link";
import Image from "next/image";

// Editorial fashion hero imagery — Stylique-generated maison campaign frames
// (camel wrap coat over ivory slip, charcoal studio, violet rim light).
const HERO_IMAGE = "/editorial/hero-main.png";
const HERO_PORTRAIT = "/editorial/hero-cta.png";

const MODULES = [
  {
    tag: "Module 01",
    name: "Mira AI Stylist",
    tagline: "Conversational commerce at scale",
    description:
      "An AI stylist that learns your catalog, reads each shopper's taste, and proposes looks that convert. Chat sessions become revenue — trackable, attributable, real.",
    accent: "electric",
  },
  {
    tag: "Module 02",
    name: "Virtual Try-On",
    tagline: "See it before you buy it",
    description:
      "Photorealistic try-on powered by IDM-VTON. Shoppers pick a model or upload their photo, see your pieces on a body like theirs. Fewer returns. More confidence.",
    accent: "pink",
  },
];

const STATS = [
  { value: "4.2×", label: "avg. lift in cart adds via Mira chat" },
  { value: "18%", label: "return rate reduction with try-on" },
  { value: "+23%", label: "avg. order value with complete-the-look" },
];

export default function LandingPage() {
  return (
    <main style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100vh" }}>

      {/* ─── Hero — full-bleed fashion editorial ──────────────────────── */}
      <section
        style={{
          position: "relative",
          minHeight: "100vh",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* Background: editorial fashion image */}
        <Image
          src={HERO_IMAGE}
          alt=""
          fill
          priority
          sizes="100vw"
          className="sq-hero-img"
          style={{ objectFit: "cover", objectPosition: "center 20%" }}
        />
        {/* Deep gradient — ensures text is always legible */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(105deg, rgba(8,7,10,0.92) 0%, rgba(8,7,10,0.72) 45%, rgba(8,7,10,0.28) 70%, rgba(8,7,10,0.05) 100%)",
          }}
        />
        {/* Subtle bottom fade */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 200,
            background: "linear-gradient(to top, var(--bg), transparent)",
          }}
        />

        {/* Content */}
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 1100,
            margin: "0 auto",
            padding: "160px 32px 120px",
          }}
        >
          <div style={{ maxWidth: 580 }}>
            <p
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.45em",
                textTransform: "uppercase",
                color: "rgba(201,181,255,0.75)",
                margin: "0 0 24px",
              }}
            >
              Brand Intelligence Platform
            </p>
            <h1
              style={{
                fontFamily: "var(--serif)",
                fontSize: "clamp(52px,6vw,84px)",
                fontWeight: 400,
                lineHeight: 1.02,
                margin: "0 0 28px",
                textShadow: "0 2px 40px rgba(0,0,0,0.4)",
              }}
            >
              Your brand
              <br />
              <em
                style={{
                  fontStyle: "italic",
                  background: "var(--grad)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                is learning.
              </em>
            </h1>
            <p
              style={{
                fontFamily: "var(--sans)",
                fontSize: 18,
                lineHeight: 1.7,
                color: "rgba(244,242,238,0.7)",
                maxWidth: 480,
                margin: "0 0 48px",
              }}
            >
              Stylique gives fashion brands an AI sales associate that guides
              shoppers, builds complete looks, and gets the fit right — on one
              platform that knows your catalog and learns from every shopper.
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link
                href="/login"
                style={{
                  display: "inline-block",
                  padding: "15px 32px",
                  background: "var(--grad)",
                  color: "#0E0A14",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  borderRadius: 999,
                  fontWeight: 700,
                  boxShadow: "0 8px 24px rgba(139,92,246,0.4)",
                }}
              >
                Connect your store →
              </Link>
              <Link
                href="/demo"
                style={{
                  display: "inline-block",
                  padding: "15px 32px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(20,17,26,0.5)",
                  backdropFilter: "blur(12px)",
                  color: "#F4F2EE",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  borderRadius: 999,
                }}
              >
                See the demo
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats strip ─────────────────────────────────────────────── */}
      <section
        style={{
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 1,
            background: "var(--line)",
          }}
          className="sq-module-grid"
        >
          {STATS.map((s) => (
            <div
              key={s.value}
              style={{
                background: "var(--bg)",
                padding: "52px 44px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--serif)",
                  fontSize: "clamp(48px,4.5vw,72px)",
                  fontStyle: "italic",
                  background: "var(--grad)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  lineHeight: 1,
                }}
              >
                {s.value}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  color: "var(--mute)",
                }}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Module highlights ──────────────────────────────────────────── */}
      <section
        style={{
          borderTop: "1px solid var(--line)",
          padding: "120px 32px",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 64,
            }}
          >
            <div>
              <p
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  letterSpacing: "0.4em",
                  textTransform: "uppercase",
                  color: "var(--mute)",
                  margin: "0 0 12px",
                }}
              >
                The platform
              </p>
              <h2
                style={{
                  fontFamily: "var(--serif)",
                  fontSize: "clamp(36px,4vw,56px)",
                  fontWeight: 400,
                  margin: 0,
                  lineHeight: 1.1,
                }}
              >
                Three modules.{" "}
                <em style={{ fontStyle: "italic" }}>One ecosystem.</em>
              </h2>
            </div>
          </div>

          <div
            className="sq-module-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 1,
              background: "var(--line)",
            }}
          >
            {MODULES.map((mod) => (
              <div
                key={mod.name}
                style={{
                  background: "var(--surface)",
                  padding: "48px 40px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      letterSpacing: "0.45em",
                      textTransform: "uppercase",
                      color:
                        mod.accent === "electric"
                          ? "var(--electric)"
                          : "var(--pink)",
                    }}
                  >
                    {mod.tag}
                  </span>
                  <h3
                    style={{
                      fontFamily: "var(--serif)",
                      fontSize: 32,
                      fontStyle: "italic",
                      fontWeight: 400,
                      margin: 0,
                      lineHeight: 1.15,
                    }}
                  >
                    {mod.name}
                  </h3>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      letterSpacing: "0.15em",
                      color: "var(--mute)",
                    }}
                  >
                    {mod.tagline}
                  </span>
                </div>
                <p
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: 15,
                    lineHeight: 1.7,
                    color: "var(--mute)",
                    margin: 0,
                    flexGrow: 1,
                  }}
                >
                  {mod.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Stylique Beauty ─────────────────────────────────────────── */}
      <section
        style={{
          borderTop: "1px solid var(--line)",
          padding: "120px 32px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Soft rose-violet ambient glow behind the section */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 800,
            height: 600,
            background:
              "radial-gradient(ellipse at center, rgba(232,121,200,0.10) 0%, rgba(139,92,246,0.06) 45%, rgba(0,0,0,0) 70%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative" }}>
          {/* Eyebrow */}
          <p
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.45em",
              textTransform: "uppercase",
              background: "linear-gradient(90deg, #E879C8 0%, #C26BE6 60%, #8B5CF6 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              margin: "0 0 20px",
              display: "inline-block",
            }}
          >
            Stylique Beauty
          </p>

          {/* Headline */}
          <h2
            style={{
              fontFamily: "var(--serif)",
              fontSize: "clamp(36px,4vw,56px)",
              fontWeight: 400,
              lineHeight: 1.1,
              margin: "0 0 20px",
              maxWidth: 680,
            }}
          >
            The AI skincare advisor your{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "linear-gradient(90deg, #E879C8 0%, #C26BE6 60%, #8B5CF6 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Shopify store deserves.
            </em>
          </h2>

          {/* Sub-copy */}
          <p
            style={{
              fontFamily: "var(--sans)",
              fontSize: 17,
              lineHeight: 1.7,
              color: "rgba(244,242,238,0.65)",
              maxWidth: 600,
              margin: "0 0 72px",
            }}
          >
            Shade matching, personalised routines, replenishment nudges —
            everything a DTC beauty brand needs to reduce returns and drive
            repeat purchases.
          </p>

          {/* Feature cards */}
          <div
            className="sq-module-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 1,
              background: "var(--line)",
              marginBottom: 1,
            }}
          >
            {/* ShadeMatch */}
            <div
              style={{
                background: "var(--surface)",
                padding: "44px 36px",
                display: "flex",
                flexDirection: "column",
                gap: 20,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "linear-gradient(135deg, rgba(232,121,200,0.18) 0%, rgba(139,92,246,0.12) 100%)",
                  border: "1px solid rgba(232,121,200,0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {/* Palette SVG */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z"
                    fill="rgba(232,121,200,0.8)"
                  />
                  <circle cx="6.5" cy="11.5" r="1.5" fill="rgba(139,92,246,0.9)" />
                  <circle cx="9.5" cy="7.5" r="1.5" fill="rgba(232,121,200,0.9)" />
                  <circle cx="14.5" cy="7.5" r="1.5" fill="rgba(194,107,230,0.9)" />
                  <circle cx="17.5" cy="11.5" r="1.5" fill="rgba(139,92,246,0.7)" />
                </svg>
              </div>
              <div>
                <h3
                  style={{
                    fontFamily: "var(--serif)",
                    fontSize: 26,
                    fontStyle: "italic",
                    fontWeight: 400,
                    margin: "0 0 10px",
                    lineHeight: 1.2,
                  }}
                >
                  ShadeMatch
                </h3>
                <p
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: 15,
                    lineHeight: 1.65,
                    color: "var(--mute)",
                    margin: 0,
                  }}
                >
                  4 undertones × 5 depths. Zero wrong-shade returns.
                </p>
              </div>
            </div>

            {/* Routine Builder */}
            <div
              style={{
                background: "var(--surface)",
                padding: "44px 36px",
                display: "flex",
                flexDirection: "column",
                gap: 20,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(232,121,200,0.12) 100%)",
                  border: "1px solid rgba(139,92,246,0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {/* Dropper SVG */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M20.71 5.63l-2.34-2.34a1 1 0 00-1.41 0l-3.12 3.12-1.41-1.42-1.42 1.42 1.41 1.41-6.6 6.6A2 2 0 005 16v3h3a2 2 0 001.41-.59l6.6-6.6 1.41 1.42 1.42-1.42-1.42-1.41 3.12-3.12a1 1 0 000-1.65z"
                    fill="rgba(139,92,246,0.85)"
                  />
                  <path d="M5 19h2v2H5v-2z" fill="rgba(232,121,200,0.7)" />
                </svg>
              </div>
              <div>
                <h3
                  style={{
                    fontFamily: "var(--serif)",
                    fontSize: 26,
                    fontStyle: "italic",
                    fontWeight: 400,
                    margin: "0 0 10px",
                    lineHeight: 1.2,
                  }}
                >
                  Routine Builder
                </h3>
                <p
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: 15,
                    lineHeight: 1.65,
                    color: "var(--mute)",
                    margin: 0,
                  }}
                >
                  AM/PM personalised stacks. Add the whole routine to cart.
                </p>
              </div>
            </div>

            {/* Replenishment Engine */}
            <div
              style={{
                background: "var(--surface)",
                padding: "44px 36px",
                display: "flex",
                flexDirection: "column",
                gap: 20,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "linear-gradient(135deg, rgba(194,107,230,0.18) 0%, rgba(139,92,246,0.12) 100%)",
                  border: "1px solid rgba(194,107,230,0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {/* Cycle/refresh SVG */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0020 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"
                    fill="rgba(194,107,230,0.85)"
                  />
                </svg>
              </div>
              <div>
                <h3
                  style={{
                    fontFamily: "var(--serif)",
                    fontSize: 26,
                    fontStyle: "italic",
                    fontWeight: 400,
                    margin: "0 0 10px",
                    lineHeight: 1.2,
                  }}
                >
                  Replenishment Engine
                </h3>
                <p
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: 15,
                    lineHeight: 1.65,
                    color: "var(--mute)",
                    margin: 0,
                  }}
                >
                  14-day nudge window. Never let a customer run dry.
                </p>
              </div>
            </div>
          </div>

          {/* Beauty stats row */}
          <div
            className="sq-module-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 1,
              background: "var(--line)",
              marginBottom: 56,
            }}
          >
            {(
              [
                { value: "2.1×", label: "routine AOV" },
                { value: "34%", label: "fewer returns" },
                { value: "10-min", label: "install" },
              ] as const
            ).map((s) => (
              <div
                key={s.label}
                style={{
                  background: "var(--bg)",
                  padding: "36px 44px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--serif)",
                    fontSize: "clamp(36px,3.5vw,52px)",
                    fontStyle: "italic",
                    background:
                      "linear-gradient(90deg, #E879C8 0%, #C26BE6 60%, #8B5CF6 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    lineHeight: 1,
                  }}
                >
                  {s.value}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    letterSpacing: "0.25em",
                    textTransform: "uppercase",
                    color: "var(--mute)",
                  }}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>

          {/* Beauty CTA */}
          <div>
            <Link
              href="/login"
              style={{
                display: "inline-block",
                padding: "15px 36px",
                background:
                  "linear-gradient(135deg, #E879C8 0%, #C26BE6 55%, #8B5CF6 100%)",
                color: "#0E0A14",
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                borderRadius: 999,
                fontWeight: 700,
                boxShadow: "0 8px 28px rgba(232,121,200,0.35)",
              }}
            >
              Start your free 30-day pilot →
            </Link>
          </div>
        </div>
      </section>

      {/* ─── CTA band — editorial fashion image + copy ───────────────── */}
      <section
        style={{
          borderTop: "1px solid var(--line)",
          position: "relative",
          overflow: "hidden",
          minHeight: 520,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Image
          src={HERO_PORTRAIT}
          alt=""
          fill
          sizes="100vw"
          style={{ objectFit: "cover", objectPosition: "center 30%" }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(8,7,10,0.95) 0%, rgba(8,7,10,0.75) 55%, rgba(8,7,10,0.25) 100%)",
          }}
        />
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 600,
            padding: "100px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          <p
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.45em",
              textTransform: "uppercase",
              color: "rgba(201,181,255,0.75)",
              margin: 0,
            }}
          >
            Ready to start
          </p>
          <h2
            style={{
              fontFamily: "var(--serif)",
              fontSize: "clamp(40px,5vw,64px)",
              fontWeight: 400,
              lineHeight: 1.05,
              margin: 0,
              textShadow: "0 2px 30px rgba(0,0,0,0.5)",
            }}
          >
            Install on your{" "}
            <em
              style={{
                fontStyle: "italic",
                background: "var(--grad)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Shopify store
            </em>
          </h2>
          <p
            style={{
              fontFamily: "var(--sans)",
              fontSize: 17,
              lineHeight: 1.65,
              color: "rgba(244,242,238,0.7)",
              margin: 0,
            }}
          >
            Connect your store in under two minutes. Stylique syncs your catalog,
            activates Mira on your storefront, and starts learning immediately.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link
              href="/login"
              style={{
                display: "inline-block",
                padding: "15px 32px",
                background: "var(--grad)",
                color: "#0E0A14",
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                borderRadius: 999,
                fontWeight: 700,
                boxShadow: "0 8px 24px rgba(139,92,246,0.4)",
              }}
            >
              Connect your store →
            </Link>
            <Link
              href="/demo"
              style={{
                display: "inline-block",
                padding: "15px 32px",
                border: "1px solid rgba(255,255,255,0.22)",
                background: "rgba(20,17,26,0.5)",
                backdropFilter: "blur(12px)",
                color: "#F4F2EE",
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                borderRadius: 999,
              }}
            >
              See the demo first
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
