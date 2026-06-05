"use client";

// /login — Brand store connection page.
// Merchants enter their .myshopify.com domain and are redirected to Shopify OAuth.

import { useState } from "react";
import Link from "next/link";
import { SHOPIFY_APP_URL, DASHBOARD_URL } from "../lib/config";

export default function LoginPage() {
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");

  function normalise(input: string): string {
    let d = input.trim().toLowerCase();
    // Strip https:// or http://
    d = d.replace(/^https?:\/\//, "");
    // Strip trailing slashes
    d = d.replace(/\/$/, "");
    // Add .myshopify.com if bare subdomain given
    if (!d.includes(".")) {
      d = `${d}.myshopify.com`;
    } else if (!d.endsWith(".myshopify.com")) {
      d = `${d.split(".")[0]}.myshopify.com`;
    }
    return d;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const shopDomain = normalise(domain);
    if (!shopDomain) {
      setError("Please enter your Shopify store domain.");
      return;
    }
    setError("");
    // Redirect to Shopify app auth with the dashboard callback URL
    const redirectUrl = `${SHOPIFY_APP_URL}/auth?shop=${shopDomain}&dashboard_url=${encodeURIComponent(DASHBOARD_URL)}`;
    window.location.href = redirectUrl;
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 460 }}>
        {/* Wordmark */}
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <Link href="/">
            <span
              style={{
                fontFamily: "var(--serif)",
                fontSize: 28,
                fontStyle: "italic",
                letterSpacing: "0.06em",
                color: "var(--text)",
              }}
            >
              Stylique
            </span>
          </Link>
          <p
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "0.45em",
              textTransform: "uppercase",
              color: "var(--mute)",
              marginTop: 8,
            }}
          >
            Brand Portal
          </p>
        </div>

        {/* Card */}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: "48px 40px",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--serif)",
              fontSize: 32,
              fontWeight: 400,
              fontStyle: "italic",
              margin: "0 0 8px",
              lineHeight: 1.2,
            }}
          >
            Connect your store
          </h1>
          <p
            style={{
              fontFamily: "var(--sans)",
              fontSize: 15,
              color: "var(--mute)",
              margin: "0 0 40px",
              lineHeight: 1.6,
            }}
          >
            Enter your Shopify store domain to authenticate with Stylique.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 24 }}>
              <label
                htmlFor="shop-domain"
                style={{
                  display: "block",
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  color: "var(--mute)",
                  marginBottom: 10,
                }}
              >
                Store domain
              </label>
              <input
                id="shop-domain"
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="my-store.myshopify.com"
                autoComplete="off"
                spellCheck={false}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "13px 16px",
                  background: "#0F0F0F",
                  border: `1px solid ${error ? "#EF4444" : "var(--line-2)"}`,
                  borderRadius: 2,
                  color: "var(--text)",
                  fontFamily: "var(--mono)",
                  fontSize: 13,
                  letterSpacing: "0.02em",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {error && (
                <p
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: 13,
                    color: "#EF4444",
                    margin: "8px 0 0",
                  }}
                >
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              style={{
                display: "block",
                width: "100%",
                padding: "14px",
                background: "var(--electric)",
                color: "#fff",
                border: "none",
                borderRadius: 2,
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Connect store →
            </button>
          </form>
        </div>

        <p
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13,
            color: "var(--mute)",
            textAlign: "center",
            marginTop: 24,
          }}
        >
          Don&apos;t have Stylique installed?{" "}
          <Link
            href="https://apps.shopify.com"
            style={{ color: "var(--electric)", borderBottom: "1px solid rgba(139,92,246,0.4)" }}
          >
            Find it on the Shopify App Store
          </Link>
        </p>
      </div>
    </main>
  );
}
