"use client";

import { Suspense, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function AdminLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: password }),
      });

      if (res.ok) {
        const next = searchParams.get("next") ?? "/admin";
        router.push(next);
      } else {
        setError("Invalid password. Access denied.");
      }
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--sans)",
      }}
    >
      <div
        style={{
          width: 400,
          padding: "48px 40px",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
        }}
      >
        {/* Wordmark */}
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontSize: 28,
              background: "var(--grad)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              letterSpacing: "-0.02em",
            }}
          >
            Stylique
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--mute)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginTop: 8,
            }}
          >
            Internal access only
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: "block",
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--mute)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Admin password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--line-2)",
                borderRadius: 8,
                padding: "12px 16px",
                color: "var(--text)",
                fontFamily: "var(--mono)",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--electric)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--line-2)";
              }}
            />
          </div>

          {error && (
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: "#f87171",
                marginBottom: 16,
                padding: "10px 12px",
                background: "rgba(248,113,113,0.08)",
                borderRadius: 6,
                border: "1px solid rgba(248,113,113,0.2)",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: loading ? "rgba(139,92,246,0.5)" : "var(--grad)",
              border: "none",
              borderRadius: 8,
              padding: "13px 24px",
              color: "#fff",
              fontFamily: "var(--sans)",
              fontWeight: 600,
              fontSize: 14,
              cursor: loading ? "not-allowed" : "pointer",
              letterSpacing: "0.01em",
            }}
          >
            {loading ? "Checking..." : "Enter →"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginInner />
    </Suspense>
  );
}
