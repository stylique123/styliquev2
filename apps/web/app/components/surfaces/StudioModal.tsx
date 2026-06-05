"use client";
import { useEffect, useState } from "react";

export default function StudioModal({ onClose }: { onClose?: () => void }) {
  const [filled, setFilled] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setFilled((f) => (f < 4 ? f + 1 : f)), 700);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 88,
        background: "rgba(8,7,10,0.78)",
        backdropFilter: "blur(18px)",
        display: "grid",
        placeItems: "center",
        padding: 24,
        animation: "sqOverlayIn 320ms cubic-bezier(.2,.8,.2,1)",
      }}
    >
      <style>{`
        @media (max-width: 640px) {
          .sq-studio-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .sq-studio-modal { padding: 20px !important; max-height: 90dvh; overflow-y: auto; }
        }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        className="sq-studio-modal"
        style={{
          width: "min(880px, 100%)",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 22,
          padding: 28,
          color: "#F4F2EE",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--mute)" }}>
            Creative Studio · this brand's voice
          </span>
          {onClose && (
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--mute)", fontSize: 20, cursor: "pointer" }}>
              ×
            </button>
          )}
        </div>

        <h2 style={{ fontFamily: "var(--serif)", fontSize: 32, fontWeight: 400, margin: 0, lineHeight: 1.05 }}>
          Generating <span style={{ fontStyle: "italic" }}>"Onyx Silk Slip"</span> · brief: golden-hour, low-lit dining.
        </h2>

        <div
          className="sq-studio-grid"
          style={{
            marginTop: 22,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                aspectRatio: "3 / 4",
                borderRadius: 10,
                border: "1px solid var(--line)",
                background:
                  i < filled
                    ? `linear-gradient(135deg, rgba(139,92,246,${0.18 - i * 0.03}) 0%, rgba(232,121,200,${0.14 - i * 0.02}) 100%)`
                    : "rgba(255,255,255,0.03)",
                display: "grid",
                placeItems: "center",
                color: i < filled ? "#F4F2EE" : "var(--mute-2)",
                fontFamily: "var(--mono)",
                fontSize: 10,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {i < filled ? `Still ${i + 1}` : (
                <span style={{ display: "flex", gap: 4 }}>
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      style={{
                        width: 5, height: 5, borderRadius: "50%",
                        background: "rgba(255,255,255,0.4)",
                        animation: `sqDockTyping 1s ${d * 0.15}s infinite`,
                      }}
                    />
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 20,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 16px",
            background: "rgba(255,255,255,0.03)",
            borderRadius: 12,
            border: "1px solid var(--line)",
          }}
        >
          <div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--mute)" }}>
              Shoot day saved
            </div>
            <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 24, marginTop: 4 }}>~$3,800</div>
          </div>
          <button
            style={{
              padding: "12px 22px",
              background: "var(--grad)",
              color: "#0E0A14",
              border: "none",
              borderRadius: 999,
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Use this set →
          </button>
        </div>
      </div>
    </div>
  );
}
