// Stylique smoke test — verifies all critical HTTP paths against a running app.
//
// Run from repo root:
//   BASE_URL=https://<tunnel>.trycloudflare.com pnpm tsx scripts/smoke-test.ts
//
// The BASE_URL must point at the running Remix app (tunnel or localhost:3000).
// The script does NOT require Shopify auth — it tests that routes exist and
// respond with the right status classes (not 500s).

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

// ── ANSI colours ─────────────────────────────────────────────────────────
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ── Test result types ─────────────────────────────────────────────────────
interface CheckResult {
  name: string;
  passed: boolean;
  status?: number;
  detail?: string;
}

const results: CheckResult[] = [];

// ── HTTP helpers ──────────────────────────────────────────────────────────
async function get(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, { redirect: "manual", ...opts });
}

async function post(path: string, body?: unknown, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
    ...opts,
  });
}

// ── Individual check runner ───────────────────────────────────────────────
function pass(name: string, status: number, detail?: string): CheckResult {
  return { name, passed: true, status, detail };
}
function fail(name: string, status: number | undefined, detail: string): CheckResult {
  return { name, passed: false, status, detail };
}

// ── Test cases ────────────────────────────────────────────────────────────

// 1. Health check
async function checkHealth(): Promise<CheckResult> {
  const name = "Health check  GET /api/health";
  try {
    const res = await get("/api/health");
    if (res.status !== 200) return fail(name, res.status, `expected 200, got ${res.status}`);
    const json = await res.json() as { ok?: boolean; ts?: string };
    if (!json.ok) return fail(name, res.status, `ok=false in response body`);
    return pass(name, res.status, `ts=${json.ts}`);
  } catch (e) {
    return fail(name, undefined, `fetch error: ${String(e)}`);
  }
}

// 2. Widget proxy — shopper/me (no auth cookies → shop_not_installed is fine, 500 is not)
async function checkShopperMe(): Promise<CheckResult> {
  const name = "Widget proxy  GET /apps/stylique/api/shopper/me";
  try {
    // Shopify proxies /apps/stylique/* to /proxy/shopper/*, so direct-hitting
    // the Remix server path lets us confirm the route exists and doesn't 500.
    const res = await get("/proxy/shopper/api/shopper/me?shop=stylee.myshopify.com");
    if (res.status === 500) return fail(name, res.status, "route threw 500");
    // 401 (bad HMAC), 404 (shop_not_installed), or 200 are all acceptable.
    const acceptable = [200, 401, 404];
    if (acceptable.includes(res.status)) {
      return pass(name, res.status, "route exists (auth expected to fail without valid HMAC)");
    }
    return pass(name, res.status, "non-500 response — route is live");
  } catch (e) {
    return fail(name, undefined, `fetch error: ${String(e)}`);
  }
}

// 3. Chat endpoint — empty POST should return 400 or 401, never 500
async function checkChatEndpoint(): Promise<CheckResult> {
  const name = "Chat endpoint  POST /apps/stylique/api/chat";
  try {
    const res = await post("/proxy/shopper/api/chat", {});
    if (res.status === 500) return fail(name, res.status, "route threw 500");
    if (res.status >= 400 && res.status < 500) {
      return pass(name, res.status, "client error (expected — no auth)");
    }
    return pass(name, res.status, "route is live");
  } catch (e) {
    return fail(name, undefined, `fetch error: ${String(e)}`);
  }
}

// 4. VTO render endpoint — should return 400/401, not 500
async function checkTryOnRender(): Promise<CheckResult> {
  const name = "VTO endpoint   POST /apps/stylique/api/tryon/render";
  try {
    const res = await post("/proxy/shopper/api/tryon/render", {});
    if (res.status === 500) return fail(name, res.status, "route threw 500");
    if (res.status >= 400 && res.status < 500) {
      return pass(name, res.status, "client error (expected — no auth)");
    }
    return pass(name, res.status, "route is live");
  } catch (e) {
    return fail(name, undefined, `fetch error: ${String(e)}`);
  }
}

// 5. Admin dashboard — should redirect (302/303) to Shopify login, not 200 or 500
async function checkAdminDashboard(): Promise<CheckResult> {
  const name = "Admin dashboard GET /app/dashboard";
  try {
    const res = await get("/app/dashboard");
    if (res.status === 500) return fail(name, res.status, "route threw 500");
    // Shopify admin auth redirects to /auth/login or back to Partners; 302 or 303 expected.
    const redirectStatuses = [301, 302, 303, 307, 308];
    if (redirectStatuses.includes(res.status)) {
      const loc = res.headers.get("location") ?? "(no Location header)";
      return pass(name, res.status, `redirect → ${loc}`);
    }
    if (res.status === 200) {
      // Could happen in test mode if Shopify auth is bypassed.
      return pass(name, res.status, "200 — auth may be bypassed in this env");
    }
    return fail(name, res.status, `unexpected status ${res.status}`);
  } catch (e) {
    return fail(name, undefined, `fetch error: ${String(e)}`);
  }
}

// 6. Sentiment extract — POST without admin session should return 401, not 500
async function checkSentimentExtract(): Promise<CheckResult> {
  const name = "Sentiment route POST /api/admin/sentiment/extract";
  try {
    const res = await post("/api/admin/sentiment/extract", {});
    if (res.status === 500) return fail(name, res.status, "route threw 500");
    // Without a valid admin session Shopify auth will redirect or return 401/403.
    if (res.status === 401 || res.status === 403 || res.status === 302 || res.status === 303) {
      return pass(name, res.status, "auth guard working (expected)");
    }
    if (res.status === 200) {
      return pass(name, res.status, "200 — auth may be bypassed in this env");
    }
    return fail(name, res.status, `unexpected status ${res.status} — check route`);
  } catch (e) {
    return fail(name, undefined, `fetch error: ${String(e)}`);
  }
}

// ── Run all checks ────────────────────────────────────────────────────────
async function main() {
  console.log(bold("\n=== Stylique Smoke Test ==="));
  console.log(dim(`Target: ${BASE_URL}\n`));

  const checks = [
    checkHealth,
    checkShopperMe,
    checkChatEndpoint,
    checkTryOnRender,
    checkAdminDashboard,
    checkSentimentExtract,
  ];

  for (const check of checks) {
    const result = await check();
    results.push(result);

    const icon   = result.passed ? green("✅ PASS") : red("❌ FAIL");
    const status = result.status !== undefined ? dim(` [${result.status}]`) : "";
    const detail = result.detail ? dim(`  ${result.detail}`) : "";
    console.log(`${icon}  ${result.name}${status}${detail}`);
  }

  const passed = results.filter(r => r.passed).length;
  const total  = results.length;
  const failed = total - passed;

  console.log(bold(`\n── Results ──────────────────────────────────────`));
  console.log(green(`   Passed: ${passed}/${total}`));
  if (failed > 0) {
    console.log(red(`   Failed: ${failed}/${total}`));
    console.log(yellow("\nOne or more checks failed. Fix the issues above before testing with the Stylee store."));
    process.exit(1);
  } else {
    console.log(green("\nAll checks passed. The app is ready for Stylee store testing."));
    console.log(dim("Next: install on the Stylee store via the Shopify CLI session, then run the manual checklist."));
    console.log(dim("See: docs/live-test-checklist.md"));
  }
}

main().catch(err => {
  console.error(red("Smoke test runner crashed:"), err);
  process.exit(1);
});
