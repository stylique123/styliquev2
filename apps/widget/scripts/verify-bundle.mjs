import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const PUBLIC_WIDGET = resolve(ROOT, "apps", "shopify-app", "public", "widget.js");
const THEME_WIDGET = resolve(ROOT, "apps", "shopify-app", "extensions", "stylique-widget", "assets", "tryon.js");

const REQUIRED_STRINGS = [
  "Side by side",
  "I could not verify two real pieces to compare yet",
  "requested_size_unavailable",
  "CART_FROM_WIDGET_STYLE",
  "MIRA_BEHAVIORAL_TRIGGER_FIRED",
  "MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED",
  "MIRA_PROACTIVE_TRIGGERED",
  "product_media_focus",
  "clicked_or_zoomed_product_media_twice",
  "CHAT_SIZE_CHART_VIEWED",
  "__sqTheme",
  "__sqProxyBase",
  "freeShippingThreshold",
  "showSize",
  "showStyle",
  "Try It On",
  "data-stylique-widget",
  "data-stylique-open",
  "data-stylique-input",
  "data-stylique-send",
  "data-stylique-checkout",
  "data-stylique-nudge",
  "data-stylique-reco-card",
  "data-stylique-look-card",
  "data-stylique-tryon-sheet",
  "data-stylique-tryon-body",
  "data-stylique-tryon-footer",
];

async function main() {
  const [publicBundle, themeBundle] = await Promise.all([
    readFile(PUBLIC_WIDGET, "utf8"),
    readFile(THEME_WIDGET, "utf8"),
  ]);

  if (publicBundle !== themeBundle) {
    throw new Error("public/widget.js and extension tryon.js are not byte-identical");
  }

  const missing = REQUIRED_STRINGS.filter((needle) => !publicBundle.includes(needle));
  if (missing.length > 0) {
    throw new Error(`widget bundle is stale; missing: ${missing.join(", ")}`);
  }

  console.log("✓ widget bundle verified fresh and byte-identical");
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
