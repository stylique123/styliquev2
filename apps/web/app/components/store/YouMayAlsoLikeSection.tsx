"use client";

// Color-matched "Complete the look" section on product pages.
// Shoppers can check the pieces they like and try them on — clicking a card
// (or the selection bar) opens a TryOnPanel modal overlay, no navigation.

import Image from "next/image";
import { useState } from "react";
import TryOnPanel from "../surfaces/TryOnPanel";
import { colorHex, type Product } from "../../lib/catalog";

export default function YouMayAlsoLikeSection({
  outfit,
  currentProductName,
  currentProductColor,
}: {
  outfit: Product[];
  currentProductName: string;
  currentProductColor: string;
}) {
  const [tryOnProduct, setTryOnProduct] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (outfit.length === 0) return null;

  function toggle(handle: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  const selectedProducts = outfit.filter((p) => selected.has(p.handle));

  return (
    <>
      <section style={{ padding: "80px 32px 120px", borderTop: "1px solid var(--line)" }}>
        {/* Section heading */}
        <div style={{ maxWidth: 1280, margin: "0 auto 36px" }}>
          <p style={{
            fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.4em",
            textTransform: "uppercase", color: "var(--mute)", margin: "0 0 10px",
          }}>
            Complete the look
          </p>
          <p style={{
            fontFamily: "var(--sans)", fontSize: 15, color: "rgba(255,255,255,0.45)",
            margin: 0, lineHeight: 1.55,
          }}>
            Pieces that work with{" "}
            <em style={{ color: "rgba(255,255,255,0.7)", fontStyle: "italic" }}>{currentProductName}</em>
            {" "}— check the ones you like, then try the whole look on.
          </p>
        </div>

        {/* Product grid */}
        <div style={{
          maxWidth: 1280, margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 28,
        }}>
          {outfit.map((p) => {
            const isChecked = selected.has(p.handle);
            return (
              <div
                key={p.handle}
                style={{ position: "relative", color: "#F4F2EE" }}
              >
                {/* Checkbox */}
                <button
                  type="button"
                  onClick={() => toggle(p.handle)}
                  aria-pressed={isChecked}
                  aria-label={isChecked ? `Remove ${p.name}` : `Add ${p.name}`}
                  style={{
                    position: "absolute", top: 12, left: 12, zIndex: 2,
                    width: 26, height: 26, borderRadius: "50%",
                    border: isChecked ? "none" : "1.5px solid rgba(255,255,255,0.7)",
                    background: isChecked ? "rgba(139,92,246,0.95)" : "rgba(14,11,20,0.45)",
                    backdropFilter: "blur(6px)",
                    color: "#F4F2EE", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, lineHeight: 1, padding: 0,
                    transition: "background 180ms ease, border 180ms ease",
                  }}
                >
                  {isChecked ? "✓" : ""}
                </button>

                <button
                  onClick={() => setTryOnProduct(p)}
                  style={{
                    display: "block", background: "transparent", border: "none",
                    cursor: "pointer", color: "#F4F2EE", textAlign: "left", padding: 0, width: "100%",
                  }}
                >
                  {/* Image */}
                  <div style={{
                    position: "relative", aspectRatio: "3 / 4",
                    overflow: "hidden", background: "var(--surface)",
                    borderRadius: 2,
                    outline: isChecked ? "2px solid rgba(139,92,246,0.9)" : "none",
                    outlineOffset: -2,
                  }}>
                    <Image src={p.images[0]} alt={p.name} fill sizes="25vw" style={{ objectFit: "cover" }} />

                    {/* Hover overlay */}
                    <div style={{
                      position: "absolute", inset: 0,
                      background: "linear-gradient(to top, rgba(14,11,20,0.75) 0%, transparent 40%)",
                      display: "flex", alignItems: "flex-end", justifyContent: "center",
                      padding: "0 0 20px",
                      opacity: 0,
                      transition: "opacity 200ms",
                    }}
                      className="sq-tryon-hover"
                    >
                      <span style={{
                        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.3em",
                        textTransform: "uppercase",
                        background: "rgba(139,92,246,0.85)", color: "#F4F2EE",
                        padding: "8px 16px", borderRadius: 999,
                      }}>
                        Try on ↗
                      </span>
                    </div>
                  </div>

                  {/* Info row */}
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontFamily: "var(--serif)", fontSize: 18, fontStyle: "italic" }}>{p.name}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--mute)" }}>${p.priceUsd}</span>
                  </div>

                  {/* Color chips */}
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    {p.colors.map((c) => (
                      <span
                        key={c}
                        title={c}
                        style={{
                          width: 14, height: 14, borderRadius: "50%",
                          background: colorHex(c),
                          border: "1px solid rgba(255,255,255,0.15)",
                        }}
                      />
                    ))}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Selection bar — try the whole look */}
      {selectedProducts.length > 0 && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40,
          display: "flex", justifyContent: "center", padding: "16px 24px 24px",
          pointerEvents: "none",
        }}>
          <div style={{
            pointerEvents: "auto",
            display: "flex", alignItems: "center", gap: 18,
            background: "rgba(14,11,20,0.92)", backdropFilter: "blur(14px)",
            border: "1px solid var(--line-2)", borderRadius: 999,
            padding: "12px 14px 12px 24px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          }}>
            <span style={{
              fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.2em",
              textTransform: "uppercase", color: "rgba(255,255,255,0.7)",
            }}>
              {selectedProducts.length} piece{selectedProducts.length > 1 ? "s" : ""} selected
            </span>
            <button
              type="button"
              onClick={() => setTryOnProduct(selectedProducts[0])}
              style={{
                fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.25em",
                textTransform: "uppercase",
                background: "rgba(139,92,246,0.95)", color: "#F4F2EE",
                border: "none", borderRadius: 999, padding: "12px 22px",
                cursor: "pointer",
              }}
            >
              Try the look ↗
            </button>
          </div>
        </div>
      )}

      {/* Try-On overlay — opens over the current product page */}
      {tryOnProduct && (
        <TryOnPanel
          product={tryOnProduct}
          onClose={() => setTryOnProduct(null)}
        />
      )}

      <style>{`
        button:hover .sq-tryon-hover { opacity: 1 !important; }
      `}</style>
    </>
  );
}
