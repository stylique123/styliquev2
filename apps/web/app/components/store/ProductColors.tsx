"use client";

import { useState } from "react";
import { colorHex } from "../../lib/catalog";

/**
 * Interactive color picker for the PDP.
 * Dispatches a `stylique:pdp-color` CustomEvent on `document` so the
 * (separately-rendered) image gallery can tint the garment to match.
 * index 0 = the product's photographed color → no tint.
 */
export default function ProductColors({ colors }: { colors: string[] }) {
  const [active, setActive] = useState(0);

  function pick(i: number) {
    setActive(i);
    document.dispatchEvent(
      new CustomEvent("stylique:pdp-color", {
        detail: { index: i, color: colors[i], hex: colorHex(colors[i]) },
      }),
    );
  }

  return (
    <div data-pdp-colors>
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
        Color · {colors[active]}
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        {colors.map((c, i) => {
          const isActive = i === active;
          return (
            <button
              key={c}
              type="button"
              onClick={() => pick(i)}
              title={c}
              aria-label={c}
              aria-pressed={isActive}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: colorHex(c),
                border: isActive
                  ? "2px solid #F4F2EE"
                  : "1px solid var(--line-2)",
                boxShadow: isActive ? "0 0 0 2px rgba(244,242,238,0.25)" : "none",
                cursor: "pointer",
                padding: 0,
                transition: "box-shadow 200ms ease, border 200ms ease",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
