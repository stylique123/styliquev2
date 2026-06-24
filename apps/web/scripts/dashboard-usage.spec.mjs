import { expect, test } from "@playwright/test";

const DASHBOARD_TOKEN_KEY = "sq_dashboard_token";
const DASHBOARD_SHOP_KEY = "sq_dashboard_shop";

const overviewFixture = {
  shopDomain: "fixture-brand.myshopify.com",
  plan: {
    tier: "GROWTH",
    analyticsLevel: "ADVANCED",
    usage: {
      TRYON_PERSONAL: { used: 12, cap: 100, remaining: 88 },
      TRYON_BODY: { used: 7, cap: 50, remaining: 43 },
      STYLE_RECOMMENDATION: { used: 80, cap: 100, remaining: 20 },
      FIT_RECOMMENDATION: { used: 25, cap: 25, remaining: 0 },
      VISION_TURN: { used: 44, cap: null, remaining: null },
      STYLIST_TURN: { used: 1200, cap: 2000, remaining: 800 },
    },
  },
  headline: {
    chatSessions: 18,
    chatTurns: 97,
    combosProposed: 21,
    cartConfirmed: 9,
    tryOnSessions: 12,
    fitSubmitted: 6,
    signupsClaimed: 4,
    windowDays: 30,
  },
  assistedRevenue: {
    formatted: "$1.4K",
    orderCount: 8,
  },
};

test.describe("External dashboard plan usage", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ tokenKey, shopKey }) => {
        window.localStorage.setItem(tokenKey, "fixture-token");
        window.localStorage.setItem(shopKey, "fixture-brand.myshopify.com");
      },
      { tokenKey: DASHBOARD_TOKEN_KEY, shopKey: DASHBOARD_SHOP_KEY },
    );

    await page.route("**/api/external-overview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(overviewFixture),
      });
    });

    for (const path of ["**/api/mira/intelligence", "**/api/mira/insights", "**/api/tryon/insights"]) {
      await page.route(path, async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "fixture unavailable" }),
        });
      });
    }
  });

  test("renders all enforced usage meters with current-period and unlimited semantics", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByText("Plan usage")).toBeVisible();
    await expect(page.getByText("Current billing period.")).toBeVisible();
    await expect(page.getByText("Unlimited meters still show activity")).toBeVisible();
    await expect(page.getByText("GROWTH tier")).toBeVisible();

    for (const label of [
      "Personal try-ons",
      "Body-model try-ons",
      "Style recommendations",
      "Fit recommendations",
      "Mira vision turns",
      "Mira chat turns",
    ]) {
      await expect(page.getByText(label)).toBeVisible();
    }

    await expect(page.getByText("12 / 100")).toBeVisible();
    await expect(page.getByText("88 left")).toBeVisible();
    await expect(page.getByText("25 / 25")).toBeVisible();
    await expect(page.getByText("Limit reached")).toBeVisible();
    await expect(page.getByText("44 / Unlimited")).toBeVisible();
    await expect(page.getByText("Unlimited", { exact: true })).toBeVisible();
    await expect(page.getByText("1.2K / 2.0K")).toBeVisible();
  });
});
