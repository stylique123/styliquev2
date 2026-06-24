import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  DashboardPlanUsageCard,
  EMBEDDED_USAGE_METERS,
  embeddedUsageTone,
  embeddedUsageValue,
} from "./dashboard-plan-usage";

describe("DashboardPlanUsageCard", () => {
  const plan = {
    tier: "GROWTH",
    usage: {
      TRYON_PERSONAL: { used: 12, cap: 100, remaining: 88 },
      TRYON_BODY: { used: 7, cap: 50, remaining: 43 },
      STYLE_RECOMMENDATION: { used: 80, cap: 100, remaining: 20 },
      FIT_RECOMMENDATION: { used: 25, cap: 25, remaining: 0 },
      VISION_TURN: { used: 44, cap: null, remaining: null },
      STYLIST_TURN: { used: 1200, cap: 2000, remaining: 800 },
    },
  };

  it("renders every enforced usage meter in the embedded merchant dashboard card", () => {
    const html = renderToStaticMarkup(
      <AppProvider i18n={enTranslations}>
        <DashboardPlanUsageCard plan={plan} />
      </AppProvider>,
    );

    expect(html).toContain("Plan usage");
    expect(html).toContain("GROWTH");
    expect(html).toContain("Current billing period");
    expect(html).toContain("Unlimited meters still show usage");

    for (const [, label] of EMBEDDED_USAGE_METERS) {
      expect(html).toContain(label);
    }

    expect(html).toContain("12 / 100");
    expect(html).toContain("88 left");
    expect(html).toContain("25 / 25");
    expect(html).toContain("0 left");
    expect(html).toContain("44 / Unlimited");
    expect(html).toContain("Unlimited");
    expect(html).toContain("1,200 / 2,000");
  });

  it("keeps exhausted, warning, healthy, unlimited, and missing rows distinguishable", () => {
    expect(embeddedUsageValue(undefined)).toBe("0 / 0");
    expect(embeddedUsageValue({ used: 44, cap: null, remaining: null })).toBe("44 / Unlimited");
    expect(embeddedUsageValue({ used: 1200, cap: 2000, remaining: 800 })).toBe("1,200 / 2,000");

    expect(embeddedUsageTone(undefined)).toBe("success");
    expect(embeddedUsageTone({ used: 44, cap: null, remaining: null })).toBe("success");
    expect(embeddedUsageTone({ used: 79, cap: 100, remaining: 21 })).toBe("success");
    expect(embeddedUsageTone({ used: 80, cap: 100, remaining: 20 })).toBe("attention");
    expect(embeddedUsageTone({ used: 25, cap: 25, remaining: 0 })).toBe("critical");
  });
});
