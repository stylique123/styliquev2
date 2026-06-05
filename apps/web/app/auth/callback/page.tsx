"use client";

// /auth/callback — receives token from Shopify app after OAuth.
// Stores token in localStorage and cookie, then redirects to /dashboard.

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const TOKEN_KEY = "sq_dashboard_token";
const SHOP_KEY = "sq_dashboard_shop";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const token = searchParams.get("token");
    const shop = searchParams.get("shop");

    if (!token || !shop) {
      router.replace("/login?error=missing_token");
      return;
    }

    // Store in localStorage for subsequent API calls
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(SHOP_KEY, shop);
    } catch {
      // localStorage may be blocked (SSR guard, incognito limits, etc.)
    }

    // Also set a cookie so server components can read it (30-day expiry)
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; expires=${expires}; path=/; SameSite=Lax`;
    document.cookie = `${SHOP_KEY}=${encodeURIComponent(shop)}; expires=${expires}; path=/; SameSite=Lax`;

    router.replace("/dashboard");
  }, [router, searchParams]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.45em",
            textTransform: "uppercase",
            color: "var(--mute)",
          }}
        >
          Connecting your store…
        </p>
      </div>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackInner />
    </Suspense>
  );
}
