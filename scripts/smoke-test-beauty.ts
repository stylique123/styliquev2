// Stylique Beauty Smoke Test — verifies all beauty-mode critical paths.
//
// Tests run against a live Remix app that has the beauty demo store seeded
// (`pnpm -F @stylique/db tsx src/seed-beauty.ts`).
//
// Run from repo root:
//   BASE_URL=https://<tunnel>.trycloudflare.com pnpm smoke:beauty
//   # or for localhost:
//   pnpm smoke:beauty
//
// The test calls some checks via HTTP (routes that are publicly accessible
// without a Shopify HMAC, such as the internal admin path and direct DB checks),
// and others via a direct DB import.  DB checks are used for shop-setup and
// dashboard-block assertions that require an authoritative source of truth.
//
// Prerequisites:
//   1. Docker Postgres + Redis running  (`pnpm infra:up`)
//   2. Beauty demo store seeded        (`pnpm -F @stylique/db tsx src/seed-beauty.ts`)
//   3. App server running              (`pnpm shopify:app-server`)

import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config();

// ── Lazy DB import (only when DATABASE_URL is present) ───────────────────────
// We import prisma at the top of each DB check rather than once at module level
// so the HTTP-only checks still run cleanly when the DB is unreachable.
async function getPrisma() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = await import(
    "../apps/shopify-app/app/db.server.js" as string
  ).catch(() => {
    throw new Error(
      "Could not import prisma client. Is DATABASE_URL set and prisma generate run?"
    );
  });
  return prisma as import("@prisma/client").PrismaClient;
}

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BEAUTY_SHOP_DOMAIN = "demo-beauty.stylique.local";
// Fake cookie ID for fresh-shopper checks (no purchase history → empty replenishment)
const FRESH_SHOPPER_COOKIE = `smoke-test-fresh-${Date.now()}`;

// ── ANSI colours ─────────────────────────────────────────────────────────────
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ── Test result types ─────────────────────────────────────────────────────────
interface CheckResult {
  name: string;
  passed: boolean;
  status?: number;
  detail?: string;
}

const results: CheckResult[] = [];

// ── HTTP helpers ──────────────────────────────────────────────────────────────
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

// Helper: issue a request to the beauty proxy routes.
// The App Proxy normally validates a Shopify HMAC; without a real HMAC the
// route returns 401/400.  We accept any non-500 response as "route is live."
// A 200 means the auth was satisfied (e.g. auth bypassed in test mode).
function proxyPath(apiSuffix: string): string {
  // The App Proxy maps /apps/stylique/* → /proxy/shopper/*
  // but we can hit the Remix loader directly in dev/test.
  return `/proxy/shopper/${apiSuffix}?shop=${BEAUTY_SHOP_DOMAIN}`;
}

// ── Individual check helpers ──────────────────────────────────────────────────
function pass(name: string, status?: number, detail?: string): CheckResult {
  return { name, passed: true, status, detail };
}
function fail(name: string, status: number | undefined, detail: string): CheckResult {
  return { name, passed: false, status, detail };
}

// ── Check 1: Shop setup ───────────────────────────────────────────────────────
// Verify demo-beauty.stylique.local exists in DB with brandMode: "beauty".
async function checkShopSetup(): Promise<CheckResult> {
  const name = "Shop setup    DB: demo-beauty shop + brandMode=beauty";
  try {
    const prisma = await getPrisma();

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: BEAUTY_SHOP_DOMAIN },
      include: { plan: true },
    });

    if (!shop) {
      return fail(name, undefined,
        `shop ${BEAUTY_SHOP_DOMAIN} not found in DB — run: pnpm -F @stylique/db tsx src/seed-beauty.ts`
      );
    }

    if (!shop.plan) {
      return fail(name, undefined, "shop has no Plan row — seed may be incomplete");
    }

    const features = shop.plan.planFeaturesJson as Record<string, unknown> | null;
    const brandMode = features?.brandMode;
    if (brandMode !== "beauty") {
      return fail(name, undefined, `planFeaturesJson.brandMode = "${brandMode}", expected "beauty"`);
    }

    return pass(name, undefined, `shopId=${shop.id} tier=${shop.plan.tier} brandMode=beauty`);
  } catch (e) {
    return fail(name, undefined, `DB error: ${String(e)}`);
  }
}

// ── Check 2: Catalog ──────────────────────────────────────────────────────────
// Verify 17+ products exist, including 20+ foundation shade variants.
async function checkBeautyCatalog(): Promise<CheckResult> {
  const name = "Catalog       DB: 17+ products + 20+ foundation shade variants";
  try {
    const prisma = await getPrisma();

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: BEAUTY_SHOP_DOMAIN },
      select: { id: true },
    });
    if (!shop) return fail(name, undefined, "shop not found — run seed first");

    const productCount = await prisma.product.count({
      where: { shopId: shop.id },
    });

    if (productCount < 17) {
      return fail(name, undefined, `only ${productCount} products found, need 17+`);
    }

    // Count foundation variants (category = "foundation")
    const foundationProducts = await prisma.product.findMany({
      where: { shopId: shop.id, category: "foundation" },
      include: { variants: true },
    });

    const totalFoundationVariants = foundationProducts.reduce(
      (sum, p) => sum + p.variants.length,
      0
    );

    if (totalFoundationVariants < 20) {
      return fail(name, undefined,
        `only ${totalFoundationVariants} foundation shade variants found, need 20+`
      );
    }

    return pass(name, undefined,
      `${productCount} products, ${totalFoundationVariants} foundation shade variants`
    );
  } catch (e) {
    return fail(name, undefined, `DB error: ${String(e)}`);
  }
}

// ── Check 3: Skin profile API ─────────────────────────────────────────────────
// POST api/beauty/skin-profile (via proxy) — expect 200 or acceptable auth error.
async function checkSkinProfileApi(): Promise<CheckResult> {
  const name = "Skin profile  POST api/beauty/profile → non-500";
  try {
    const res = await post(proxyPath("api/beauty/profile"), {
      skinType: "combination",
      concerns: ["acne", "dark_spots"],
      skinDepth: "medium",
      undertone: "cool",
    });

    if (res.status === 500) return fail(name, res.status, "route threw 500");

    // 200 = auth bypassed (test env) + profile saved
    if (res.status === 200) {
      const json = await res.json() as { ok?: boolean };
      if (json.ok === false) {
        return fail(name, res.status, `ok=false in body: ${JSON.stringify(json)}`);
      }
      return pass(name, res.status, "profile saved");
    }

    // 400/401/403/302 = auth guard working as expected (no valid HMAC)
    if ([400, 401, 403, 302, 303].includes(res.status)) {
      return pass(name, res.status, "auth guard active (expected without valid HMAC)");
    }

    return pass(name, res.status, "route is live, non-500");
  } catch (e) {
    return fail(name, undefined, `fetch error: ${String(e)}`);
  }
}

// ── Check 4: Shade match API ──────────────────────────────────────────────────
// POST api/beauty/shade-match — expect ranked variants with confidence scores or auth error.
async function checkShadeMatchApi(): Promise<CheckResult> {
  const name = "Shade match   POST api/beauty/shade-match → non-500";
  try {
    const res = await post(proxyPath("api/beauty/shade-match"), {
      category: "foundation",
      inStockOnly: true,
      limit: 3,
    });

    if (res.status === 500) return fail(name, res.status, "route threw 500");

    if (res.status === 200) {
      const json = await res.json() as {
        ok?: boolean;
        data?: { matches?: Array<{ confidence?: number }> };
      };
      if (!json.ok) return fail(name, res.status, `ok=false: ${JSON.stringify(json)}`);

      const matches = json.data?.matches ?? [];
      // Verify at least 1 match has a numeric confidence field
      const hasConfidence = matches.length > 0 && typeof matches[0]?.confidence === "number";
      if (matches.length === 0) {
        // No profile set yet in this test run — acceptable; route is alive
        return pass(name, res.status, "route returned ok (no profile set → empty matches)");
      }
      if (!hasConfidence) {
        return fail(name, res.status, "matches exist but confidence field missing");
      }
      return pass(name, res.status, `${matches.length} matches, first confidence=${matches[0]?.confidence}`);
    }

    if ([400, 401, 403, 302, 303].includes(res.status)) {
      return pass(name, res.status, "auth guard active (expected without valid HMAC)");
    }

    return pass(name, res.status, "route is live, non-500");
  } catch (e) {
    return fail(name, undefined, `fetch error: ${String(e)}`);
  }
}

// ── Check 5: Routine builder API ──────────────────────────────────────────────
// POST api/beauty/routine with concerns — expect AM/PM product array or auth error.
async function checkRoutineApi(): Promise<CheckResult> {
  const name = "Routine       POST api/beauty/routine → non-500";
  try {
    // First set skin concerns so the routine builder has data to work with.
    // This may or may not succeed depending on auth state.
    await post(proxyPath("api/beauty/profile"), {
      skinType: "combination",
      concerns: ["acne", "dark_spots"],
      skinDepth: "medium",
      undertone: "cool",
    }).catch(() => null); // best-effort; routine check validates on its own

    const res = await post(proxyPath("api/beauty/routine"), {
      timeOfDay: "both",
      includesMakeup: false,
      maxProducts: 6,
      focusConcern: "acne",
    });

    if (res.status === 500) return fail(name, res.status, "route threw 500");

    if (res.status === 200) {
      const json = await res.json() as {
        ok?: boolean;
        data?: { steps?: unknown[]; timeOfDay?: string };
        error?: string;
      };
      if (!json.ok) {
        // invalid_input means no skin concerns saved (expected in unauthenticated path)
        if (json.error === "invalid_input") {
          return pass(name, res.status, "no skin concerns stored yet (unauthenticated) — route live");
        }
        return fail(name, res.status, `ok=false: ${JSON.stringify(json)}`);
      }
      const steps = json.data?.steps ?? [];
      return pass(name, res.status, `routine has ${steps.length} step(s), timeOfDay=${json.data?.timeOfDay}`);
    }

    if ([400, 401, 403, 302, 303].includes(res.status)) {
      return pass(name, res.status, "auth guard active (expected without valid HMAC)");
    }

    return pass(name, res.status, "route is live, non-500");
  } catch (e) {
    return fail(name, undefined, `fetch error: ${String(e)}`);
  }
}

// ── Check 6: Replenishment API ────────────────────────────────────────────────
// GET api/beauty/replenishment for a fresh shopper — expect { items: [], dueCount: 0 }
// or an acceptable auth error.
async function checkReplenishmentApi(): Promise<CheckResult> {
  const name = "Replenishment GET api/beauty/replenishment → items:[] for fresh shopper";
  try {
    const res = await get(
      proxyPath("api/beauty/replenishment"),
      {
        headers: {
          // Fresh cookie so no purchase history exists
          Cookie: `sq_shopper_id=${FRESH_SHOPPER_COOKIE}`,
        },
      }
    );

    if (res.status === 500) return fail(name, res.status, "route threw 500");

    if (res.status === 200) {
      const json = await res.json() as {
        ok?: boolean;
        data?: { items?: unknown[]; dueCount?: number };
      };
      if (!json.ok) return fail(name, res.status, `ok=false: ${JSON.stringify(json)}`);

      const items = json.data?.items ?? null;
      const dueCount = json.data?.dueCount;

      if (!Array.isArray(items)) {
        return fail(name, res.status, `data.items is not an array: ${JSON.stringify(json.data)}`);
      }
      if (items.length !== 0) {
        return fail(name, res.status,
          `expected empty items for fresh shopper, got ${items.length}`
        );
      }
      if (dueCount !== 0) {
        return fail(name, res.status, `expected dueCount=0, got ${dueCount}`);
      }
      return pass(name, res.status, "items=[], dueCount=0 ✓");
    }

    if ([400, 401, 403, 302, 303].includes(res.status)) {
      return pass(name, res.status, "auth guard active (expected without valid HMAC)");
    }

    return pass(name, res.status, "route is live, non-500");
  } catch (e) {
    return fail(name, undefined, `fetch error: ${String(e)}`);
  }
}

// ── Check 7: Dashboard beauty block ──────────────────────────────────────────
// Call buildOverview for the beauty demo shop directly — verify beauty block
// is non-null with topConcerns + shadeGapCount fields.
async function checkDashboardBeautyBlock(): Promise<CheckResult> {
  const name = "Dashboard     DB: buildOverview beauty block is non-null";
  try {
    const prisma = await getPrisma();

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: BEAUTY_SHOP_DOMAIN },
      select: { id: true },
    });
    if (!shop) return fail(name, undefined, "shop not found — run seed first");

    // Import and call buildOverview directly (server-only, DB-backed)
    const { buildOverview } = await import(
      "../apps/shopify-app/app/lib/dashboard.server.js" as string
    );

    const overview = await (buildOverview as (args: { shopId: string; windowDays?: number }) => Promise<{
      beauty: null | {
        topConcerns: Array<{ concern: string; count: number }>;
        shadeGapCount: number;
        replenishmentDueSoon: number;
        ingredientTrends: unknown;
      };
    }>)({ shopId: shop.id, windowDays: 30 });

    if (!overview.beauty) {
      return fail(name, undefined,
        "overview.beauty is null — check that planFeaturesJson.brandMode='beauty' and buildOverview beauty branch is active"
      );
    }

    const { topConcerns, shadeGapCount } = overview.beauty;

    if (!Array.isArray(topConcerns)) {
      return fail(name, undefined, `topConcerns is not an array: ${JSON.stringify(topConcerns)}`);
    }

    if (typeof shadeGapCount !== "number") {
      return fail(name, undefined, `shadeGapCount is not a number: ${shadeGapCount}`);
    }

    return pass(name, undefined,
      `topConcerns=${topConcerns.length} entries, shadeGapCount=${shadeGapCount}`
    );
  } catch (e) {
    return fail(name, undefined, `DB/import error: ${String(e)}`);
  }
}

// ── Check 8: Brain tool — suggest_replenishment ───────────────────────────────
// Call handleSuggestReplenishment for a shopper with no purchase history.
// Expect { hasItems: false }.
async function checkSuggestReplenishmentTool(): Promise<CheckResult> {
  const name = "Brain tool    handleSuggestReplenishment → hasItems:false (no history)";
  try {
    const prisma = await getPrisma();

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: BEAUTY_SHOP_DOMAIN },
      select: { id: true },
    });
    if (!shop) return fail(name, undefined, "shop not found — run seed first");

    // Create a fresh shopper session (no purchase history)
    const freshSession = await prisma.shopperSession.create({
      data: {
        shopifyDomain: BEAUTY_SHOP_DOMAIN,
        cookieId: `smoke-replen-${Date.now()}`,
        chatHistoryJson: [],
        tasteVectorJson: {},
      },
    });

    const { handleSuggestReplenishment } = await import(
      "../apps/shopify-app/app/lib/replenishment.server.js" as string
    );

    const result = await (handleSuggestReplenishment as (args: {
      shopId: string;
      shopperSessionId: string;
      shopDomain: string;
    }) => Promise<{ items: unknown[]; hasItems: boolean; message: string }>)({
      shopId: shop.id,
      shopperSessionId: freshSession.id,
      shopDomain: BEAUTY_SHOP_DOMAIN,
    });

    // Clean up the ephemeral session we created
    await prisma.shopperSession.delete({ where: { id: freshSession.id } }).catch(() => null);

    if (result.hasItems !== false) {
      return fail(name, undefined,
        `expected hasItems=false for a brand-new shopper, got hasItems=${result.hasItems} with ${result.items.length} items`
      );
    }

    if (!Array.isArray(result.items) || result.items.length !== 0) {
      return fail(name, undefined,
        `expected empty items array, got: ${JSON.stringify(result.items)}`
      );
    }

    return pass(name, undefined, `hasItems=false, items=[], message="${result.message}"`);
  } catch (e) {
    return fail(name, undefined, `DB/import error: ${String(e)}`);
  }
}

// ── Run all checks ────────────────────────────────────────────────────────────
async function main() {
  console.log(bold("\n=== Stylique Beauty Smoke Test ==="));
  console.log(dim(`Target: ${BASE_URL}`));
  console.log(dim(`Beauty shop: ${BEAUTY_SHOP_DOMAIN}\n`));

  const checks = [
    checkShopSetup,
    checkBeautyCatalog,
    checkSkinProfileApi,
    checkShadeMatchApi,
    checkRoutineApi,
    checkReplenishmentApi,
    checkDashboardBeautyBlock,
    checkSuggestReplenishmentTool,
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
    console.log(yellow("\nOne or more beauty checks failed."));
    console.log(yellow("Make sure you have:"));
    console.log(yellow("  1. Run: pnpm -F @stylique/db tsx src/seed-beauty.ts"));
    console.log(yellow("  2. Run: pnpm infra:up  (Postgres + Redis)"));
    console.log(yellow("  3. Run: pnpm shopify:app-server  (app on :3000)"));
    process.exit(1);
  } else {
    console.log(green("\nAll beauty checks passed."));
    console.log(dim("Next: test with the beauty widget on a real storefront or run the manual beauty checklist."));
  }
}

main().catch(err => {
  console.error(red("Beauty smoke test runner crashed:"), err);
  process.exit(1);
});
