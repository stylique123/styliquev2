import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { collections, byCollection, type CollectionSlug } from "../../../lib/catalog";

type Params = { slug: string };

export default async function CollectionPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const collection = collections.find((c) => c.slug === (slug as CollectionSlug));
  if (!collection) return notFound();
  const items = byCollection(collection.slug);

  return (
    <main style={{ background: "var(--bg)", color: "var(--text)", paddingTop: 64 }}>
      {/* Collection hero */}
      <section
        style={{
          position: "relative",
          height: "70vh",
          minHeight: 520,
          overflow: "hidden",
        }}
      >
        <Image
          src={collection.cover}
          alt={collection.name}
          fill
          sizes="100vw"
          style={{ objectFit: "cover" }}
          priority
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(8,7,10,0.3) 0%, rgba(8,7,10,0.85) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 48,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "rgba(244,242,238,0.7)",
              marginBottom: 16,
            }}
          >
            The collection
          </p>
          <h1
            style={{
              fontFamily: "var(--serif)",
              fontSize: "clamp(56px,8vw,128px)",
              fontWeight: 400,
              fontStyle: "italic",
              margin: 0,
              lineHeight: 1,
            }}
          >
            {collection.name}
          </h1>
          <p
            style={{
              fontFamily: "var(--sans)",
              fontSize: 16,
              color: "var(--mute)",
              marginTop: 16,
              maxWidth: 540,
              margin: "16px auto 0",
              padding: "0 20px",
            }}
          >
            {collection.tagline}
          </p>
        </div>
      </section>

      {/* Product grid */}
      <section style={{ padding: "120px 32px" }}>
        <div
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 48,
          }}
        >
          {items.map((p) => (
            <Link
              key={p.handle}
              href={`/product/${p.handle}`}
              data-product-card={p.handle}
              style={{ display: "block", color: "#F4F2EE" }}
            >
              <div
                style={{
                  position: "relative",
                  aspectRatio: "3 / 4",
                  overflow: "hidden",
                  background: "var(--surface)",
                }}
              >
                <Image
                  src={p.images[0]}
                  alt={p.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  style={{ objectFit: "cover" }}
                />
              </div>
              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <span style={{ fontFamily: "var(--serif)", fontSize: 22, fontStyle: "italic" }}>
                  {p.name}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    letterSpacing: "0.2em",
                    color: "var(--mute)",
                  }}
                >
                  ${p.priceUsd}
                </span>
              </div>
              <p
                style={{
                  fontFamily: "var(--sans)",
                  fontSize: 13,
                  color: "var(--mute)",
                  marginTop: 6,
                }}
              >
                {p.colors.join(" · ")}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
