"use client";

import { useState, FormEvent } from "react";

export default function EnterprisePage() {
  const [form, setForm] = useState({
    domain: "",
    monthlyTryOnPersonal: "",
    monthlyTryOnBody: "",
    monthlyCreatives: "",
    monthlyStyleRecs: "",
    monthlyFitRecs: "",
    supportLevel: "DEDICATED",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    // Get session cookie value
    const adminSecret =
      document.cookie
        .split(";")
        .find((c) => c.trim().startsWith("sq_admin_session="))
        ?.split("=")[1] ?? "";

    try {
      const body: Record<string, unknown> = {
        domain: form.domain.trim(),
        supportLevel: form.supportLevel,
        notes: form.notes || undefined,
      };

      const numFields = [
        "monthlyTryOnPersonal",
        "monthlyTryOnBody",
        "monthlyCreatives",
        "monthlyStyleRecs",
        "monthlyFitRecs",
      ] as const;

      for (const f of numFields) {
        if (form[f]) body[f] = parseInt(form[f], 10);
      }

      const res = await fetch("/api/admin/enterprise", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminSecret}`,
        },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as { ok: boolean; error?: string; shopId?: string };
      if (data.ok) {
        setResult({ ok: true, message: `Enterprise plan created for ${form.domain}` });
        setForm({
          domain: "",
          monthlyTryOnPersonal: "",
          monthlyTryOnBody: "",
          monthlyCreatives: "",
          monthlyStyleRecs: "",
          monthlyFitRecs: "",
          supportLevel: "DEDICATED",
          notes: "",
        });
      } else {
        setResult({ ok: false, message: data.error ?? "Failed to create enterprise client" });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--line-2)",
    borderRadius: 8,
    padding: "11px 14px",
    color: "var(--text)",
    fontFamily: "var(--mono)",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontFamily: "var(--mono)",
    fontSize: 10,
    color: "var(--mute)",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 6,
  };

  const fieldGroup = (label: string, name: keyof typeof form, type = "text", placeholder = "") => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type}
        value={form[name]}
        onChange={(e) => update(name, e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );

  return (
    <div style={{ padding: "40px 48px", maxWidth: 700 }}>
      <div style={{ marginBottom: 40 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--pink)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Enterprise
        </div>
        <h1
          style={{
            fontFamily: "var(--serif)",
            fontSize: 36,
            fontWeight: 400,
            color: "var(--text)",
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          Create enterprise client
        </h1>
        <p
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            color: "var(--mute)",
            marginTop: 10,
            lineHeight: 1.6,
          }}
        >
          Upgrades an existing shop to ULTIMATE tier with custom limits and dedicated support.
          The shop must already be installed on the platform.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: "32px",
        }}
      >
        {/* Shop domain */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Shop domain *</label>
          <input
            type="text"
            value={form.domain}
            onChange={(e) => update("domain", e.target.value)}
            placeholder="example.myshopify.com"
            required
            style={inputStyle}
          />
        </div>

        {/* Custom limits */}
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--electric)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 16,
            paddingBottom: 8,
            borderBottom: "1px solid var(--line)",
          }}
        >
          Custom monthly limits (leave blank for unlimited)
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}
        >
          {fieldGroup("Try-on personal", "monthlyTryOnPersonal", "number", "e.g. 5000")}
          {fieldGroup("Try-on body model", "monthlyTryOnBody", "number", "e.g. 10000")}
          {fieldGroup("Creatives", "monthlyCreatives", "number", "e.g. 500")}
          {fieldGroup("Style recs", "monthlyStyleRecs", "number", "e.g. 20000")}
          {fieldGroup("Fit recs", "monthlyFitRecs", "number", "e.g. 20000")}
        </div>

        {/* Support level */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Support level</label>
          <select
            value={form.supportLevel}
            onChange={(e) => update("supportLevel", e.target.value)}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            <option value="STANDARD">STANDARD</option>
            <option value="PRIORITY">PRIORITY</option>
            <option value="DEDICATED">DEDICATED</option>
          </select>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 28 }}>
          <label style={labelStyle}>Internal notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="Contract details, special pricing, POC name..."
            rows={3}
            style={{
              ...inputStyle,
              resize: "vertical",
              fontFamily: "var(--sans)",
              lineHeight: 1.5,
            }}
          />
        </div>

        {/* Result message */}
        {result && (
          <div
            style={{
              marginBottom: 20,
              padding: "12px 16px",
              borderRadius: 8,
              fontFamily: "var(--mono)",
              fontSize: 12,
              background: result.ok
                ? "rgba(74,222,128,0.08)"
                : "rgba(248,113,113,0.08)",
              color: result.ok ? "#4ade80" : "#f87171",
              border: `1px solid ${result.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
            }}
          >
            {result.message}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? "rgba(232,121,200,0.4)" : "var(--grad)",
            border: "none",
            borderRadius: 10,
            padding: "14px 28px",
            color: "#fff",
            fontFamily: "var(--sans)",
            fontWeight: 700,
            fontSize: 14,
            cursor: loading ? "not-allowed" : "pointer",
            letterSpacing: "0.01em",
          }}
        >
          {loading ? "Creating..." : "Create enterprise client →"}
        </button>
      </form>
    </div>
  );
}
