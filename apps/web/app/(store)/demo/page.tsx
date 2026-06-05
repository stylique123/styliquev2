import Link from "next/link";
import Image from "next/image";
import ScrollExpandMedia from "../../components/store/ScrollExpandMedia";
import { products } from "../../lib/catalog";

const HERO_BG =
  "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=2400&q=80";
const HERO_MEDIA =
  "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=2000&q=85";

export default function StoreHome() {
  const featured   = products.slice(0, 6);
  const secondary  = products.slice(6, 12);

  return (
    <main style={{ background: "var(--bg)", color: "var(--text)" }}>

      {/* ─── Hero ────────────────────────────────────────────────────── */}
      <ScrollExpandMedia
        mediaType="image"
        mediaSrc={HERO_MEDIA}
        bgImageSrc={HERO_BG}
        title="Spring Atelier"
        date="Collection · 26"
        scrollToExpand="Scroll to reveal"
        textBlend={false}
      >
        <div
          style={{
            maxWidth: 680,
            margin: "0 auto",
            textAlign: "center",
            padding: "40px 24px",
          }}
        >
          <p
            style={{
              fontFamily: "var(--sans)",
              fontSize: 16,
              lineHeight: 1.65,
              color: "var(--mute)",
              maxWidth: 460,
              margin: "0 auto",
            }}
          >
            Twelve pieces, finished by hand. Silk, linen, wool and cashmere —
            made to wear, not to wait.
          </p>
        </div>
      </ScrollExpandMedia>

      {/* ─── Featured products — straight after the hero ─────────────── */}
      <section style={{ padding: "80px 32px 120px", borderTop: "1px solid var(--line)" }}>
        <div
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 40,
          }}
        >
          <h2
            style={{
              fontFamily: "var(--serif)",
              fontSize: "clamp(32px,4vw,52px)",
              fontWeight: 400,
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            New in. <em style={{ fontStyle: "italic" }}>This week.</em>
          </h2>
          <Link
            href="/collection/the-atelier"
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.35em",
              textTransform: "uppercase",
              color: "var(--mute)",
              borderBottom: "1px solid var(--line-2)",
              paddingBottom: 3,
              whiteSpace: "nowrap",
            }}
          >
            View all →
          </Link>
        </div>

        <div
          className="sq-featured-grid"
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 2,
          }}
        >
          {featured.map((p, idx) => (
            <Link
              key={p.handle}
              href={`/product/${p.handle}`}
              data-product-card
              style={{ display: "block", color: "#F4F2EE", textDecoration: "none" }}
            >
              <div
                style={{
                  position: "relative",
                  aspectRatio: idx === 0 ? "2 / 3" : "3 / 4",
                  overflow: "hidden",
                  background: "var(--surface)",
                }}
              >
                <Image
                  src={p.images[0]}
                  alt={p.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  style={{ objectFit: "cover", transition: "transform 1.1s var(--ease-spring)" }}
                />
                {/* Hover overlay */}
                <div
                  className="sq-card-overlay"
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(8,7,10,0)",
                    transition: "background 400ms ease",
                    display: "flex",
                    alignItems: "flex-end",
                    padding: 20,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      letterSpacing: "0.3em",
                      textTransform: "uppercase",
                      color: "rgba(244,242,238,0)",
                      transition: "color 300ms ease",
                      background: "rgba(14,11,20,0.8)",
                      padding: "8px 14px",
                      borderRadius: 999,
                      backdropFilter: "blur(8px)",
                    }}
                  >
                    Quick view →
                  </span>
                </div>
              </div>
              <div
                style={{
                  padding: "16px 4px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <div>
                  <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontStyle: "italic", lineHeight: 1.2 }}>
                    {p.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 9,
                      letterSpacing: "0.3em",
                      textTransform: "uppercase",
                      color: "var(--mute)",
                      marginTop: 3,
                    }}
                  >
                    {p.collection.replace(/-/g, " ")}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    letterSpacing: "0.15em",
                    color: "var(--mute)",
                  }}
                >
                  ${p.priceUsd}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ─── Editorial story panel ───────────────────────────────────── */}
      <section
        style={{
          padding: "120px 32px",
          background: "#0B0A0E",
          borderTop: "1px solid var(--line)",
        }}
      >
        <div
          className="sq-story-grid"
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 80,
            alignItems: "center",
          }}
        >
          <div style={{ position: "relative", aspectRatio: "4 / 5", overflow: "hidden" }}>
            <Image
              src="https://images.unsplash.com/photo-1551803091-e20673f15770?auto=format&fit=crop&w=1400&q=80"
              alt="In the atelier"
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              style={{ objectFit: "cover" }}
            />
          </div>
          <div>
            <p
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: "var(--mute)",
                margin: 0,
              }}
            >
              Journal · No. 12
            </p>
            <h2
              style={{
                fontFamily: "var(--serif)",
                fontSize: "clamp(32px,4vw,50px)",
                fontWeight: 400,
                margin: "20px 0 22px",
                lineHeight: 1.1,
              }}
            >
              The long answer to{" "}
              <em style={{ fontStyle: "italic" }}>"what is this made of"</em>.
            </h2>
            <p
              style={{
                fontFamily: "var(--sans)",
                fontSize: 16,
                lineHeight: 1.7,
                color: "var(--mute)",
              }}
            >
              Every piece comes with a card. On the back: the mill, the weaver,
              the cutter, the finisher — and the hours it took. A house should
              know its own answer to that question.
            </p>
            <a
              href="#"
              style={{
                display: "inline-block",
                marginTop: 28,
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: "#F4F2EE",
                borderBottom: "1px solid var(--line-2)",
                paddingBottom: 4,
              }}
            >
              Read the journal →
            </a>
          </div>
        </div>
      </section>

      {/* ─── Rest of the catalog ─────────────────────────────────────── */}
      <section style={{ padding: "100px 32px 140px", borderTop: "1px solid var(--line)" }}>
        <div
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 40,
          }}
        >
          <h2
            style={{
              fontFamily: "var(--serif)",
              fontSize: "clamp(28px,3.5vw,44px)",
              fontWeight: 400,
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            More from{" "}
            <em style={{ fontStyle: "italic" }}>the collection.</em>
          </h2>
        </div>
        <div
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 28,
          }}
        >
          {secondary.map((p) => (
            <Link
              key={p.handle}
              href={`/product/${p.handle}`}
              data-product-card
              style={{ display: "block", color: "#F4F2EE", textDecoration: "none" }}
            >
              <div style={{ position: "relative", aspectRatio: "3 / 4", overflow: "hidden", background: "var(--surface)" }}>
                <Image
                  src={p.images[0]}
                  alt={p.name}
                  fill
                  sizes="(max-width: 768px) 50vw, 25vw"
                  style={{ objectFit: "cover", transition: "transform 1.1s var(--ease-spring)" }}
                />
              </div>
              <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontFamily: "var(--serif)", fontSize: 18, fontStyle: "italic" }}>{p.name}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--mute)", letterSpacing: "0.2em" }}>${p.priceUsd}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <style>{`
        @media (max-width: 768px) {
          .sq-story-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
          .sq-featured-grid { grid-template-columns: 1fr 1fr !important; gap: 2px !important; }
        }
        @media (max-width: 480px) {
          .sq-featured-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}
