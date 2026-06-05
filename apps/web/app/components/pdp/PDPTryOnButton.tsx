"use client";

import { useState, useCallback } from "react";
import TryOnPanel from "../surfaces/TryOnPanel";
import {
  startTryOnSession,
  updateTryOnStatus,
  markTryOnCartAdded,
  getImageQualityWarning,
} from "../../lib/tryon-context";
import type { Product } from "../../lib/catalog";

type PDPTryOnButtonProps = {
  product: Product;
  selectedSize?: string;
  className?: string;
};

function emitTryOnEvent(event: string, handle: string, size?: string): void {
  fetch("/api/tryon/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, handle, size, trigger: "pdp_button" }),
  }).catch(() => {});
}

/**
 * Standalone PDP Virtual Try-On entry point.
 * Works entirely without Mira — shoppers can try-on directly from the product
 * page. When the session state is written, Mira reads it on her next turn and
 * provides context-aware aftermath support.
 */
export default function PDPTryOnButton({ product, selectedSize, className }: PDPTryOnButtonProps) {
  const [showPanel, setShowPanel] = useState(false);
  const [cartAdded, setCartAdded] = useState(false);

  const effectiveSize = selectedSize ?? product.sizes[0] ?? "M";
  const eligible = product.images.length > 0 && product.sizes.length > 0;
  const qualityWarning = getImageQualityWarning(product.handle);

  const handleOpen = useCallback(() => {
    if (!eligible) return;
    // Epoch seconds — avoids Date.now() in render-path logic
    const epoch = Math.floor(new Date().getTime() / 1000);
    startTryOnSession("pdp_button", product.handle, product.name, effectiveSize, epoch, []);
    emitTryOnEvent("PDP_TRYON_CLICKED", product.handle, effectiveSize);
    setCartAdded(false);
    setShowPanel(true);
  }, [eligible, product.handle, product.name, effectiveSize]);

  const handleClose = useCallback(() => {
    const epoch = Math.floor(new Date().getTime() / 1000);
    if (!cartAdded) {
      updateTryOnStatus("abandoned", epoch);
      emitTryOnEvent("TRYON_ABANDONED", product.handle, effectiveSize);
    }
    setShowPanel(false);
  }, [cartAdded, product.handle, effectiveSize]);

  const handleCartAdd = useCallback(() => {
    markTryOnCartAdded();
    setCartAdded(true);
    emitTryOnEvent("CART_FROM_TRYON", product.handle, effectiveSize);
  }, [product.handle, effectiveSize]);

  if (!eligible) {
    return (
      <div className={className} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 0", opacity: 0.4,
        fontFamily: "var(--mono, monospace)", fontSize: 11,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: "rgba(244,242,238,0.5)",
      }}>
        <PersonIcon />
        Try-on not available for this item
      </div>
    );
  }

  return (
    <>
      <div className={className} style={{ display: "flex", flexDirection: "column", gap: 8 }}>

        {/* Primary try-on button */}
        <button
          onClick={handleOpen}
          aria-label={`Virtual try-on for ${product.name}`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            width: "100%", padding: "13px 20px",
            background: "transparent",
            border: "1.5px solid rgba(139,92,246,0.5)",
            borderRadius: 10, cursor: "pointer",
            fontFamily: "var(--sans, sans-serif)", fontWeight: 600, fontSize: 14,
            color: "#F4F2EE", letterSpacing: "0.01em",
            transition: "border-color 180ms ease, background 180ms ease",
          }}
          onMouseEnter={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.borderColor = "rgba(139,92,246,0.9)";
            btn.style.background  = "rgba(139,92,246,0.08)";
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.borderColor = "rgba(139,92,246,0.5)";
            btn.style.background  = "transparent";
          }}
        >
          <PersonIcon />
          Try this on
          {effectiveSize && (
            <span style={{
              marginLeft: 2, padding: "2px 8px", borderRadius: 999,
              background: "rgba(139,92,246,0.15)",
              fontFamily: "var(--mono, monospace)", fontSize: 10,
              letterSpacing: "0.1em", color: "rgba(139,92,246,0.9)",
            }}>
              {effectiveSize}
            </span>
          )}
        </button>

        {/* "Preview available" signal */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          fontFamily: "var(--mono, monospace)", fontSize: 9.5,
          letterSpacing: "0.14em", textTransform: "uppercase",
          color: "rgba(78,196,158,0.7)",
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: "#4EC49E", flexShrink: 0,
          }} />
          Virtual preview available
        </div>

        {/* Image quality warning if flagged */}
        {qualityWarning && (
          <div style={{
            padding: "7px 11px", borderRadius: 7,
            background: "rgba(251,191,36,0.07)",
            border: "1px solid rgba(251,191,36,0.22)",
            fontFamily: "var(--sans, sans-serif)", fontSize: 11,
            color: "rgba(251,191,36,0.8)", lineHeight: 1.55,
          }}>
            {qualityWarning}
          </div>
        )}
      </div>

      {/* TryOnPanel — same component Mira uses, opened directly from PDP */}
      {showPanel && (
        <TryOnPanel
          product={product}
          onClose={handleClose}
        />
      )}
    </>
  );
}

// ── Inline icon — no external dependency ──────────────────────────────────────
function PersonIcon() {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="8" r="5" />
      <path d="M3 21v-2a7 7 0 0 1 14 0v2" />
    </svg>
  );
}
