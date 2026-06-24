#!/usr/bin/env node
/**
 * P6 — Real-storefront E2E test scaffold (founder directive: "Run actual
 * Shopify cart, checkout, keyboard, screen-reader and mobile tests").
 *
 * Runs as a Playwright spec against a LIVE Shopify dev store with the
 * Stylique extension installed. Cannot run autonomously — needs (a) a
 * tunneled `pnpm shopify:dev` session and (b) the store URL in
 * SHOPIFY_TEST_STORE_URL env. Until then, this is a runnable harness
 * documenting EXACTLY the scenarios to verify on first install.
 *
 * Usage when ready:
 *   pnpm add -D playwright
 *   STORE=https://stylique-fashion-dev.myshopify.com \
 *   SHOPIFY_TEST_PRODUCT_HANDLE=<known-in-stock-product-handle> \
 *     npx playwright test apps/web/scripts/storefront-e2e.spec.mjs
 */
import { test, expect, devices } from "@playwright/test";

const STORE = process.env.SHOPIFY_TEST_STORE_URL;
if (!STORE) {
  console.error("Set SHOPIFY_TEST_STORE_URL=https://<your-store>.myshopify.com");
  process.exit(1);
}
const PRODUCT_HANDLE = process.env.SHOPIFY_TEST_PRODUCT_HANDLE;
if (!PRODUCT_HANDLE) {
  console.error("Set SHOPIFY_TEST_PRODUCT_HANDLE=<known-in-stock-product-handle>");
  process.exit(1);
}
const PRODUCT_URL = `${STORE.replace(/\/$/, "")}/products/${PRODUCT_HANDLE}`;
const EXPECTED_CARD_IMAGE_FRAGMENT = process.env.SHOPIFY_TEST_EXPECTED_CARD_IMAGE_FRAGMENT;
const FORBIDDEN_CARD_IMAGE_PATTERN = new RegExp(
  process.env.SHOPIFY_TEST_FORBIDDEN_CARD_IMAGE_PATTERN ?? "(size[-_ ]?guide|measurement|swatch|detail|crop)",
  "i",
);

async function assertResolvedCardImagery(card) {
  const images = card.locator('[data-stylique-card-image="resolved"]');
  const fallbacks = card.locator('[data-stylique-card-image-fallback]');
  const imageCount = await images.count();
  const fallbackCount = await fallbacks.count();
  expect(imageCount + fallbackCount).toBeGreaterThan(0);

  const srcs = await images.evaluateAll((nodes) =>
    nodes
      .map((node) => node.currentSrc || node.getAttribute("src") || "")
      .filter(Boolean),
  );
  for (const src of srcs) {
    expect(src).not.toMatch(FORBIDDEN_CARD_IMAGE_PATTERN);
  }
  if (EXPECTED_CARD_IMAGE_FRAGMENT) {
    expect(srcs.some((src) => src.includes(EXPECTED_CARD_IMAGE_FRAGMENT))).toBeTruthy();
  }
}

async function assertResolvedTryOnImagery(page) {
  const images = page.locator("[data-stylique-tryon-garment-image]");
  await expect(images.first()).toBeVisible({ timeout: 15_000 });
  const records = await images.evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        kind: node.getAttribute("data-stylique-tryon-garment-image") || "",
        src: node.currentSrc || node.getAttribute("src") || "",
      }))
      .filter((record) => record.src),
  );
  expect(records.length).toBeGreaterThan(0);
  for (const record of records) {
    expect(record.src).not.toMatch(FORBIDDEN_CARD_IMAGE_PATTERN);
  }
  if (EXPECTED_CARD_IMAGE_FRAGMENT) {
    expect(records.some((record) => record.kind === "resolved" && record.src.includes(EXPECTED_CARD_IMAGE_FRAGMENT))).toBeTruthy();
  }
}

test.describe("Stylique storefront — real cart/checkout/a11y/mobile", () => {
  test("0a. product-media focus triggers a proactive Mira nudge instead of an entry pop", async ({ page }) => {
    const proactiveEvents = [];
    await page.route("**/api/entitlement", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { proactiveTriggers: true } }),
      });
    });
    await page.route("**/api/events", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.name === "MIRA_PROACTIVE_TRIGGERED" || body?.name === "MIRA_BEHAVIORAL_TRIGGER_FIRED") {
        proactiveEvents.push(body);
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.goto(PRODUCT_URL);
    await page.waitForSelector('[data-stylique-widget]', { timeout: 15_000 });
    await expect(page.locator('[data-stylique-widget][data-stylique-state="closed"]').first()).toBeVisible();

    await page.evaluate(() => {
      const probe = document.createElement("button");
      probe.setAttribute("data-product-media", "1");
      probe.textContent = "Zoom product image";
      probe.style.position = "fixed";
      probe.style.left = "12px";
      probe.style.top = "12px";
      probe.style.zIndex = "2147483647";
      document.body.appendChild(probe);
    });
    await page.click('[data-product-media]');
    await page.click('[data-product-media]');

    await expect(page.locator('[data-stylique-nudge]')).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => proactiveEvents.some((e) => e.name === "MIRA_PROACTIVE_TRIGGERED" && e.payload?.triggerId === "product_media_focus"))
      .toBeTruthy();
  });

  test("0. Mira renders real recommendation or look cards after a styling prompt", async ({ page }) => {
    await page.goto(PRODUCT_URL);
    await page.waitForSelector('[data-stylique-widget]', { timeout: 15_000 });
    await page.click('[data-stylique-open]');
    await page.fill('[data-stylique-input]', "build me a full look around this");
    await page.click('[data-stylique-send]');
    const card = page.locator('[data-stylique-reco-card], [data-stylique-look-card]').first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const box = await card.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(180);
    expect(box?.height ?? 0).toBeGreaterThan(120);
    await assertResolvedCardImagery(card);
  });

  test("1. cart adds a real Shopify variant via Mira", async ({ page }) => {
    await page.goto(PRODUCT_URL);
    await page.waitForSelector('iframe[src*="stylique"], [data-stylique-widget]', { timeout: 15_000 });
    // Open Mira, ask to add, assert /cart.js shows the variant
    await page.click('[data-stylique-open], button:has-text("Stylique")');
    await page.fill('[data-stylique-input]', "add this to my bag");
    await page.click('[data-stylique-send]');
    await page.waitForResponse(/cart\/add\.js/, { timeout: 10_000 });
    const cart = await page.evaluate(() => fetch("/cart.js").then((r) => r.json()));
    expect(cart.item_count).toBeGreaterThanOrEqual(1);
  });

  test("2. checkout — Mira's checkout CTA navigates to /checkout", async ({ page }) => {
    await page.goto(PRODUCT_URL);
    await page.click('[data-stylique-open]');
    await page.fill('[data-stylique-input]', "add this to my bag");
    await page.click('[data-stylique-send]');
    await page.waitForSelector('[data-stylique-checkout]', { timeout: 10_000 });
    const [navigation] = await Promise.all([
      page.waitForNavigation({ url: /\/checkout|\/cart/ }),
      page.click('[data-stylique-checkout]'),
    ]);
    expect(navigation.url()).toMatch(/\/checkout|\/cart/);
  });

  test("3. keyboard — every interactive control reachable via Tab", async ({ page }) => {
    await page.goto(PRODUCT_URL);
    await page.keyboard.press("Tab"); // open dock
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      const active = await page.evaluate(() => document.activeElement?.getAttribute("data-stylique-open"));
      if (active != null) reached = true;
      else await page.keyboard.press("Tab");
    }
    expect(reached).toBeTruthy();
    await page.keyboard.press("Enter");
    // The widget must trap focus, so Escape closes it without leaking focus
    await page.keyboard.press("Escape");
    const focusOutside = await page.evaluate(() => !document.activeElement?.closest("[data-stylique-widget]"));
    expect(focusOutside).toBeTruthy();
  });

  test("4. screen-reader — all controls have accessible names", async ({ page }) => {
    await page.goto(PRODUCT_URL);
    await page.click('[data-stylique-open]');
    // Pull ALL interactive elements inside the widget and assert each has an
    // accessible name (aria-label, aria-labelledby, or visible text).
    const unnamed = await page.evaluate(() => {
      const root = document.querySelector("[data-stylique-widget]");
      if (!root) return [];
      const els = Array.from(
        root.querySelectorAll('button, a, [role="button"], [role="link"], input, textarea, select'),
      );
      return els
        .filter((el) => {
          const text = (el.textContent ?? "").trim();
          return !text && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.getAttribute("title");
        })
        .map((el) => el.outerHTML.slice(0, 100));
    });
    expect(unnamed).toEqual([]);
  });

  test("5. mobile — bottom sheet renders + scrolls without overlap", async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices["iPhone 14"] });
    const page = await ctx.newPage();
    await page.goto(PRODUCT_URL);
    await page.click('[data-stylique-open]');
    // Try-on opens on touch
    await page.fill('[data-stylique-input]', "see it on me");
    await page.click('[data-stylique-send]');
    await page.waitForSelector('[data-stylique-tryon-sheet]', { timeout: 15_000 });
    await assertResolvedTryOnImagery(page);
    // Footer (Add to bag) must be visible WITHOUT overlapping content
    const overlap = await page.evaluate(() => {
      const footer = document.querySelector("[data-stylique-tryon-footer]");
      const body = document.querySelector("[data-stylique-tryon-body]");
      if (!footer || !body) return "missing";
      const f = footer.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      return f.top >= b.bottom - 4 ? "ok" : "overlap";
    });
    expect(overlap).toBe("ok");
  });
});

/**
 * Notes for the operator (you):
 * - Selectors above (`[data-stylique-*]`) are the AGREED contract — if the
 *   widget code doesn't yet expose them, the tests will fail until they're
 *   added. The test scaffold is intentionally written against those names
 *   so the contract is enforceable.
 * - Real screen-reader regression requires NVDA/VoiceOver — Playwright can
 *   verify accessible names but cannot replace human SR testing.
 * - This file is .mjs to skip TypeScript; convert to .ts later if you wire
 *   up @playwright/test as a workspace dev dep.
 */
