"use client";

import { useState } from "react";

interface Props {
  shopId: string;
  domain: string;
  currentTier: string;
}

export default function BrandActions({ shopId, domain, currentTier }: Props) {
  const [tier, setTier] = useState(currentTier);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const [terminateInput, setTerminateInput] = useState("");

  const adminSecret =
    typeof window !== "undefined"
      ? (document.cookie
          .split(";")
          .find((c) => c.trim().startsWith("sq_admin_session="))
          ?.split("=")[1] ?? "")
      : "";

  async function callAction(action: string, extra?: Record<string, string>) {
    setLoading(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/brands/${shopId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminSecret}`,
        },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setMessage({ text: `Action "${action}" completed.`, ok: true });
      } else {
        setMessage({ text: data.error ?? "Unknown error", ok: false });
      }
    } catch {
      setMessage({ text: "Network error", ok: false });
    } finally {
      setLoading(null);
    }
  }

  const btnBase: React.CSSProperties = {
    border: "1px solid var(--line-2)",
    borderRadius: 8,
    padding: "10px 16px",
    fontFamily: "var(--sans)",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
  };

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "24px 28px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--mute)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 20,
        }}
      >
        Admin actions
      </div>

      {/* Change tier */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--mute)",
            marginBottom: 8,
          }}
        >
          Change tier
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--line-2)",
              borderRadius: 8,
              padding: "9px 12px",
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="STARTER">STARTER</option>
            <option value="GROWTH">GROWTH</option>
            <option value="ULTIMATE">ULTIMATE</option>
          </select>
          <button
            onClick={() => callAction("change_tier", { tier })}
            disabled={loading !== null}
            style={{
              ...btnBase,
              background: "rgba(139,92,246,0.12)",
              border: "1px solid rgba(139,92,246,0.3)",
              color: "var(--electric)",
              width: "auto",
              padding: "9px 16px",
            }}
          >
            {loading === "change_tier" ? "..." : "Apply"}
          </button>
        </div>
      </div>

      {/* Suspend */}
      <button
        onClick={() => callAction("suspend")}
        disabled={loading !== null}
        style={{
          ...btnBase,
          background: "rgba(251,191,36,0.08)",
          color: "#fbbf24",
          border: "1px solid rgba(251,191,36,0.2)",
          marginBottom: 10,
        }}
      >
        {loading === "suspend" ? "Suspending..." : "⊘ Suspend account"}
      </button>

      {/* Terminate */}
      {!confirmTerminate ? (
        <button
          onClick={() => setConfirmTerminate(true)}
          disabled={loading !== null}
          style={{
            ...btnBase,
            background: "rgba(248,113,113,0.08)",
            color: "#f87171",
            border: "1px solid rgba(248,113,113,0.2)",
          }}
        >
          ✕ Terminate account
        </button>
      ) : (
        <div
          style={{
            background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "#f87171",
              marginBottom: 10,
            }}
          >
            Type <strong>{domain}</strong> to confirm termination:
          </div>
          <input
            value={terminateInput}
            onChange={(e) => setTerminateInput(e.target.value)}
            placeholder={domain}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(248,113,113,0.3)",
              borderRadius: 6,
              padding: "8px 12px",
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 12,
              outline: "none",
              marginBottom: 10,
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                if (terminateInput === domain) callAction("terminate");
              }}
              disabled={terminateInput !== domain || loading !== null}
              style={{
                flex: 1,
                ...btnBase,
                background:
                  terminateInput === domain
                    ? "rgba(248,113,113,0.18)"
                    : "rgba(255,255,255,0.04)",
                color: terminateInput === domain ? "#f87171" : "var(--mute)",
                border: "1px solid rgba(248,113,113,0.3)",
              }}
            >
              {loading === "terminate" ? "Terminating..." : "Confirm terminate"}
            </button>
            <button
              onClick={() => {
                setConfirmTerminate(false);
                setTerminateInput("");
              }}
              style={{
                ...btnBase,
                background: "transparent",
                color: "var(--mute)",
                width: "auto",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Feedback */}
      {message && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 14px",
            borderRadius: 8,
            fontFamily: "var(--mono)",
            fontSize: 12,
            background: message.ok ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
            color: message.ok ? "#4ade80" : "#f87171",
            border: `1px solid ${message.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
          }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
