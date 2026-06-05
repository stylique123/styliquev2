import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getProduct } from "../../../lib/catalog";
import ProductActions from "../../../components/store/ProductActions";
import ProductColors from "../../../components/store/ProductColors";
import ProductGallery from "../../../components/store/ProductGallery";

type Params = { handle: string };

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { handle } = await params;
  const product = getProduct(handle);
  if (!product) return notFound();

  return (
    <main style={{ background: "var(--bg)", color: "var(--text)", paddingTop: 80 }}>
      <section
        className="sq-pdp-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 64,
          padding: "40px 32px 120px",
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        {/* Image stack — tints to the chosen color */}
        <ProductGallery product={product} name={product.name} />

        {/* Detail panel */}
        <aside
          className="sq-pdp-aside"
          style={{
            position: "sticky",
            top: 100,
            alignSelf: "start",
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          <div>
            <p
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: "var(--mute)",
                margin: 0,
              }}
            >
              Stylique Maison · {product.collection.replace(/-/g, " ")}
            </p>
            <h1
              style={{
                fontFamily: "var(--serif)",
                fontSize: "clamp(36px,4vw,56px)",
                fontWeight: 400,
                lineHeight: 1.05,
                margin: "12px 0 8px",
              }}
            >
              {product.name}
            </h1>
            <p style={{ fontFamily: "var(--mono)", fontSize: 13, letterSpacing: "0.15em", color: "var(--mute)", margin: 0 }}>
              ${product.priceUsd} USD
            </p>
          </div>

          <p
            style={{
              fontFamily: "var(--sans)",
              fontSize: 15,
              lineHeight: 1.65,
              color: "var(--mute)",
              margin: 0,
            }}
          >
            {product.description}
          </p>

          {/* Colors — interactive, tints the gallery */}
          <ProductColors colors={product.colors} />

          {/* Interactive size picker, try-on + add-to-bag — client component */}
          <ProductActions sizes={product.sizes} price={product.priceUsd} product={product} />

          {/* Size chart — brand-exact, per-product. Open by default. */}
          {product.sizeChart && (
            <details open style={detailsStyle}>
              <summary style={summaryStyle}>Size guide</summary>
              <div style={{ overflowX: "auto", marginTop: 4 }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: "var(--text)",
                  }}
                >
                  <thead>
                    <tr>
                      <th style={thStyle}>Size</th>
                      {product.sizeChart.measures.map((m) => (
                        <th key={m} style={thStyle}>{m}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {product.sizes.map((s) => {
                      const row = product.sizeChart!.rows[s];
                      if (!row) return null;
                      return (
                        <tr key={s}>
                          <td style={{ ...tdStyle, color: "#F4F2EE" }}>{s}</td>
                          {row.map((v, i) => (
                            <td key={i} style={tdStyle}>{v}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ ...bodyStyle, marginTop: 10, fontSize: 12 }}>
                Body measurements in {product.sizeChart.unit}, cut for your{" "}
                {product.sizeChart.primary}.{" "}
                {product.sizeChart.ease >= 0
                  ? `Adds ~${product.sizeChart.ease}cm ease over the body.`
                  : `Cut ${Math.abs(product.sizeChart.ease)}cm close to the body.`}{" "}
                <span style={{ color: "var(--mute)" }}>· {product.sizeChart.source}</span>
              </p>
            </details>
          )}

          {/* How it fits — honest, review-grounded */}
          <details style={detailsStyle}>
            <summary style={summaryStyle}>How it fits</summary>
            <p style={bodyStyle}>{product.fitNotes}</p>
            {typeof product.keepRate === "number" && (
              <p style={{ ...bodyStyle, marginTop: 8, color: "#F4F2EE" }}>
                {Math.round(product.keepRate * 100)}% of shoppers kept their
                recommended size.
              </p>
            )}
          </details>

          {/* Materials & care — real composition + care */}
          <details style={detailsStyle}>
            <summary style={summaryStyle}>Materials & care</summary>
            <p style={bodyStyle}>{product.fabricComposition}</p>
            <p style={{ ...bodyStyle, marginTop: 8 }}>{product.careInstructions}</p>
          </details>
        </aside>
      </section>
    </main>
  );
}

const detailsStyle: CSSProperties = {
  borderTop: "1px solid var(--line)",
  paddingTop: 18,
  fontFamily: "var(--sans)",
  fontSize: 14,
  color: "var(--mute)",
};

const summaryStyle: CSSProperties = {
  cursor: "pointer",
  fontFamily: "var(--mono)",
  fontSize: 11,
  letterSpacing: "0.3em",
  textTransform: "uppercase",
  color: "#F4F2EE",
  marginBottom: 12,
};

const bodyStyle: CSSProperties = {
  margin: 0,
  lineHeight: 1.65,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "8px 12px 8px 0",
  borderBottom: "1px solid var(--line-2)",
  fontSize: 10,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "var(--mute)",
  fontWeight: 400,
};

const tdStyle: CSSProperties = {
  padding: "8px 12px 8px 0",
  borderBottom: "1px solid var(--line)",
  color: "var(--mute)",
};
