"use client";

import { useState } from "react";
import TryOnPanel from "../surfaces/TryOnPanel";
import type { Product } from "../../lib/catalog";
import { addToCart } from "../../lib/storefront-cart";

export default function ProductActions({
  sizes,
  price,
  product,
}: {
  sizes: string[];
  price: number;
  product?: Product;
}) {
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [tryOnOpen, setTryOnOpen] = useState(false);
  const [addedToast, setAddedToast] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);

  const handleAddToBag = async () => {
    if (!selectedSize && sizes.length > 1) {
      // flash sizes section to prompt selection
      const sizeSection = document.querySelector("[data-pdp-sizes]") as HTMLElement | null;
      if (sizeSection) {
        sizeSection.style.outline = "2px solid var(--electric)";
        sizeSection.style.outlineOffset = "8px";
        setTimeout(() => { sizeSection.style.outline = ""; }, 1200);
      }
      return;
    }
    if (adding) return;
    setCartError(null);
    setAdding(true);
    const size = selectedSize ?? (sizes.length === 1 ? sizes[0] : null);
    const result = product ? await addToCart(product.handle, size) : { ok: true, real: false };
    setAdding(false);
    if (!result.ok) {
      setCartError(
        result.error === "requested_size_unavailable"
          ? "That size just sold out. Pick another size."
          : result.error === "variant_not_found"
            ? "I could not match this product to a Shopify variant."
            : "Shopify could not add this item. Try again.",
      );
      return;
    }
    setAddedToast(true);
    setTimeout(() => setAddedToast(false), 2200);
  };

  return (
    <>
      {/* Size buttons */}
      <div data-pdp-sizes>
        <p
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            color: "var(--mute)",
            marginBottom: 12,
          }}
        >
          Size
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {sizes.map((s) => (
            <button
              key={s}
              onClick={() => setSelectedSize(s)}
              style={{
                width: 52,
                height: 44,
                background: selectedSize === s ? "rgba(139,92,246,0.15)" : "transparent",
                color: "#F4F2EE",
                border: selectedSize === s
                  ? "1px solid rgba(139,92,246,0.8)"
                  : "1px solid var(--line-2)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                letterSpacing: "0.15em",
                cursor: "pointer",
                transition: "all 180ms",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* See it on yourself — independent virtual try-on, full-width, near sizing */}
      <button
        data-stylique-tryon
        onClick={() => setTryOnOpen(true)}
        style={{
          padding: "17px 24px",
          background: "rgba(139,92,246,0.12)",
          color: "#F4F2EE",
          border: "1px solid var(--electric)",
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          cursor: "pointer",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 10,
          width: "100%",
          boxShadow: "0 0 0 1px rgba(139,92,246,.10), 0 10px 30px rgba(139,92,246,.14)",
          transition: "background 180ms, box-shadow 180ms",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(139,92,246,0.20)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(139,92,246,0.12)"; }}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>
        <span>See it on yourself</span>
        <span style={{ color: "var(--electric)" }}>· Virtual try-on</span>
      </button>

      {/* Add to bag */}
      <div style={{ position: "relative" }}>
        <button
          onClick={handleAddToBag}
          disabled={adding}
          style={{
            padding: "18px 24px",
            background: "var(--grad)",
            color: "#0E0A14",
            border: "none",
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            cursor: "pointer",
            width: "100%",
            transition: "opacity 180ms",
            opacity: adding ? 0.7 : 1,
          }}
        >
          {adding ? "Adding…" : addedToast ? "Added ✓" : "Add to bag"}
        </button>
        {cartError ? (
          <p
            role="alert"
            style={{
              fontFamily: "var(--sans)",
              fontSize: 12,
              color: "#E8A44C",
              marginTop: 8,
              lineHeight: 1.4,
            }}
          >
            {cartError}
          </p>
        ) : !selectedSize && sizes.length > 1 && (
          <p
            style={{
              fontFamily: "var(--mono)",
              fontSize: 9,
              letterSpacing: "0.2em",
              color: "var(--mute)",
              marginTop: 8,
              textTransform: "uppercase",
            }}
          >
            Select a size above
          </p>
        )}
      </div>

      {/* Try-On panel — mounts when button clicked */}
      {tryOnOpen && <TryOnPanel product={product} onClose={() => setTryOnOpen(false)} />}

      {/* Added-to-bag toast */}
      {addedToast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(20,17,26,0.96)",
            border: "1px solid rgba(139,92,246,0.4)",
            borderRadius: 999,
            padding: "12px 24px",
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#F4F2EE",
            zIndex: 200,
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
            animation: "sqToastIn 300ms cubic-bezier(.2,.8,.2,1)",
            pointerEvents: "none",
          }}
        >
          Added to bag — ${price} USD
          <style>{`@keyframes sqToastIn { from { opacity:0; transform:translateX(-50%) translateY(12px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>
        </div>
      )}
    </>
  );
}
