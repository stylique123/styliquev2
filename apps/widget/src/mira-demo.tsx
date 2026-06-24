/**
 * Stylique — ONE SYSTEM, ONE TRUTH.
 *
 * There is exactly ONE backend: the App Proxy at
 * stylique-app-production.up.railway.app — the real Shopify-connected
 * backend with tenancy, the production Brain, entitlement, and the worker.
 *
 * There is exactly ONE UI: MiraWidget + TryOnPanel (the polished interface).
 *
 * There is NO demo backend. apps/web is for the marketing site only.
 * This widget IS the live Shopify surface, talking to the ONE real backend.
 */
import { render, h } from "preact";
// SINGLE SOURCE: import the ONE MiraWidget straight from apps/web. There is no
// widget-side copy anymore — the storefront and the demo run the IDENTICAL
// component, made surface-aware via the window globals set below + the
// build-time asset base. esbuild bundles it (react→preact + next/image aliases).
import MiraWidget from "../../web/app/components/mira/MiraWidget";

// ═══ ONE SHOPIFY BACKEND ═══
// The storefront ALWAYS runs on Shopify, so Mira + try-on now route through the
// App Proxy (/apps/<subpath>) → the REAL Shopify app (stylique-app): the
// per-tenant brain + THIS shop's real synced catalog. The demo backend is no
// longer in the shopper path — there is one backend that powers any store. The
// proxy subpath is merchant-configurable; the liquid block may set __sqProxyBase,
// else the standard /apps/stylique. Static muse/portrait images are the only
// thing still served from the CDN origin (they're shop-agnostic assets).
const w = window as unknown as Record<string, unknown>;
const PROXY = (typeof w.__sqProxyBase === "string" && w.__sqProxyBase) || "/apps/stylique";
const ASSET_CDN = "https://stylique-web-production.up.railway.app"; // static images only
const THEME = (w.__sqTheme && typeof w.__sqTheme === "object" ? w.__sqTheme : {}) as Record<string, unknown>;
const ACCENT = typeof THEME.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(THEME.accentColor)
  ? THEME.accentColor
  : "#8B5CF6";
const CTA_LABEL = typeof THEME.ctaLabel === "string" && THEME.ctaLabel.trim()
  ? THEME.ctaLabel.trim().slice(0, 32)
  : "Try It On";
const STYLIST_ENABLED = THEME.enableStylist !== false;
const WIDGET_ENABLED = THEME.enableWidget !== false;
const SHOW_SIZE = THEME.showSize !== false;
const SHOW_STYLE = THEME.showStyle !== false;
const PDP_INLINE_ENABLED = THEME.enablePdpInline !== false && WIDGET_ENABLED;
w.__sqApi = PROXY;                  // Mira + try-on API → the one Shopify backend
w.__styliqueTryonApiBase = PROXY;   // try-on render → the one Shopify backend
w.__sqAssetBase = ASSET_CDN;        // static muse/portrait images only
w.__sqProductSeg = "products";      // Shopify PDP path is /products/<handle> (plural)

// Design tokens — single source, shared by widget + dashboard + demo.
const TOKENS_CSS = `
#sq-mira-root {
  --bg:#08070A; --surface:#14111A; --surface-2:rgba(255,255,255,.025);
  --line:rgba(255,255,255,.08); --line-2:rgba(255,255,255,.14); --line-acc:rgba(201,181,255,.35);
  --text:#F4F2EE; --mute:#8E8A99; --mute-2:#5A5663; --electric:${ACCENT}; --pink:#E879C8;
  --grad:linear-gradient(135deg,${ACCENT} 0%,#C26BE6 55%,#E879C8 100%);
  --grad-soft:linear-gradient(135deg,color-mix(in srgb, ${ACCENT} 16%, transparent) 0%,rgba(232,121,200,.10) 100%);
  --glow:radial-gradient(60% 60% at 50% 50%,color-mix(in srgb, ${ACCENT} 45%, transparent) 0%,rgba(232,121,200,.10) 45%,rgba(0,0,0,0) 70%);
  --shadow:0 24px 60px rgba(0,0,0,.55);
  --serif:"Instrument Serif","Cormorant Garamond",Georgia,serif;
  --sans:"Manrope",ui-sans-serif,system-ui,-apple-system,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --ease-spring:cubic-bezier(.2,.8,.2,1); --ease-fade:cubic-bezier(.4,0,.2,1);
  font-family: var(--sans);
}
#sq-mira-root *, #sq-mira-root *::before, #sq-mira-root *::after { box-sizing: border-box; }
`;

// Is an element actually rendered (has a box)?
function sqVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

// Find the product HERO image, theme-agnostically: try the known product-media
// selectors that the popular Shopify themes (Dawn, Debut, Prestige, Impulse,
// Brooklyn, etc.) use, then fall back to the largest visible image near the top
// of the page (which on a PDP is virtually always the product photo).
function findProductImage(): HTMLImageElement | null {
  const selectors = [
    ".product__media img", ".product-single__photo", ".product-single__media img",
    ".product-gallery__image img", ".product__main-photos img", "[data-product-featured-media] img",
    ".product-media img", "media-gallery img", ".product__image", ".product-image-main img",
    ".product__media-item img", ".product-photo-container img", ".product-single__media-wrapper img",
    '[id^="ProductMedia"] img', ".product-gallery img",
  ];
  for (const s of selectors) {
    const el = document.querySelector(s) as HTMLImageElement | null;
    if (el && sqVisible(el)) return el;
  }
  let best: HTMLImageElement | null = null;
  let bestArea = 0;
  for (const el of Array.from(document.images)) {
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea && r.width > 180 && r.height > 180 && r.top < window.innerHeight * 1.5 && sqVisible(el)) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

// Overlay a "TRY-ON HERE ▶" pill ON the product image (bottom-left), like the
// reference. Theme-agnostic: anchors to the image's own container. Opens the
// fitting room independently of Mira via the stylique:open-tryon event.
function injectTryOnButton() {
  if (!/\/products?\//.test(location.pathname)) return; // PDP only
  if (!PDP_INLINE_ENABLED) return false;
  if (document.getElementById("sq-tryon-pdp-btn")) return;
  const img = findProductImage();
  const host = img?.parentElement;
  if (!img || !host) return false;
  // The button is absolutely positioned inside the image's container.
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  const btn = document.createElement("button");
  btn.id = "sq-tryon-pdp-btn";
  btn.type = "button";
  btn.textContent = CTA_LABEL.toUpperCase();
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.style.fontSize = "12px";
  arrow.style.lineHeight = "1";
  arrow.textContent = "▶";
  btn.appendChild(arrow);
  // Anchor to the host's BOTTOM-LEFT as a small pill. CRITICAL: the host is the
  // theme's `.product__media`, whose CSS forces absolutely-positioned children to
  // `top:0; width/height:100%` (for the cover/zoom image) WITH !important — which
  // stretched our pill to 614×822 and, with border-radius:999px, rendered it as a
  // giant BLACK ELLIPSE over the photo (founder: "it's all black"). So we set the
  // geometry with setProperty(...,'important') to win against the theme: explicit
  // top:auto/right:auto/width:auto/height:auto keeps it a content-sized corner pill.
  const imp = (k: string, v: string) => btn.style.setProperty(k, v, "important");
  imp("position", "absolute"); imp("z-index", "50");
  imp("left", "16px"); imp("bottom", "16px"); imp("top", "auto"); imp("right", "auto");
  imp("width", "auto"); imp("height", "auto"); imp("max-width", "none"); imp("min-width", "0"); imp("max-height", "none"); imp("min-height", "0");
  imp("margin", "0"); imp("inset", "auto auto 16px 16px");
  imp("display", "inline-flex"); imp("align-items", "center"); imp("gap", "6px");
  imp("padding", "11px 18px"); imp("background", "#0E0E10"); imp("color", "#fff"); imp("border", "0"); imp("border-radius", "999px");
  imp("font", "700 13px/1 ui-sans-serif,system-ui,-apple-system,sans-serif"); imp("letter-spacing", ".05em");
  imp("cursor", "pointer"); imp("box-shadow", "0 6px 18px rgba(0,0,0,.34)");
  imp("-webkit-tap-highlight-color", "transparent");
  btn.onmouseenter = () => { btn.style.transform = "translateY(-2px)"; btn.style.boxShadow = "0 12px 30px rgba(0,0,0,.48)"; };
  btn.onmouseleave = () => { btn.style.transform = ""; btn.style.boxShadow = "0 6px 18px rgba(0,0,0,.34)"; };
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent("stylique:open-tryon"));
  });
  host.appendChild(btn);
  return true;
}

/**
 * Theme audit — scores how cleanly Stylique placed itself on the host theme.
 * Runs once, ~3 seconds after mount, so lazy-loaded selectors have time to
 * appear. Results power the dashboard's "Placement confidence" tile + the
 * internal ops view that lists low-confidence stores for the team to
 * optimize as a paid service (Growth / Scale tier upsell).
 *
 * Each check is binary and earns a fixed weight. Total = 100. The merchant
 * only sees the final score and the human-readable label; the per-check
 * breakdown is shipped along for the ops team.
 *
 * Bias: weight the checks that most directly predict conversion. Mira's
 * launcher visibility (24) + PDP try-on button (22) + a real product
 * surface for it to anchor to (20) carry the bulk of the score.
 */
type AuditCheck = { id: string; label: string; weight: number; passed: boolean };

function auditPlacement(): { score: number; checks: AuditCheck[]; themeHint: string | null } {
  const isPdp = /\/products?\//.test(location.pathname);
  const launcher = document.querySelector("#sq-mira-root, [data-stylique-open]");
  const tryonBtn = document.getElementById("sq-tryon-pdp-btn");
  const productImg = isPdp ? findProductImage() : null;
  const hasCartForm = !!document.querySelector(
    'form[action*="/cart/add"], form[action*="/cart/change"], [data-cart-form]'
  );
  const hasShopifyGlobal = !!(window as unknown as { Shopify?: { shop?: string } }).Shopify;
  // Theme hint — read from the storefront so the ops team can group reports.
  const themeHint =
    document.querySelector('meta[name="theme-name"]')?.getAttribute("content") ??
    (window as unknown as { Shopify?: { theme?: { name?: string } } }).Shopify?.theme?.name ??
    null;

  const checks: AuditCheck[] = [
    { id: "launcher_present", label: "Mira launcher mounted", weight: 24, passed: !STYLIST_ENABLED || !!launcher },
    {
      id: "pdp_tryon_visible",
      label: "Try-on overlay sits on product image (PDP only)",
      weight: 22,
      passed: !isPdp || !WIDGET_ENABLED || (!!tryonBtn && !!tryonBtn.offsetParent),
    },
    {
      id: "product_image_anchored",
      label: "Found a real product hero image to anchor",
      weight: 20,
      passed: !isPdp || (!!productImg && productImg.naturalWidth > 200),
    },
    { id: "cart_form_detected", label: "Cart form selector matched (add-to-bag wiring)", weight: 10, passed: hasCartForm },
    { id: "shopify_runtime", label: "Shopify storefront globals present", weight: 8, passed: hasShopifyGlobal },
    {
      id: "viewport_meta",
      label: "Mobile viewport meta present (no scaling lock)",
      weight: 6,
      passed: !!document.querySelector('meta[name="viewport"]'),
    },
    {
      id: "fonts_loaded",
      label: "Mira brand fonts loaded (no FOUT on the dock)",
      weight: 5,
      passed: typeof document.fonts !== "undefined" && document.fonts.status === "loaded",
    },
    {
      id: "no_overlapping_widget",
      label: "No competing chat widget overlapping the dock corner",
      weight: 5,
      passed: !document.querySelector("[data-tidio-key], #intercom-container, .drift-frame-controller"),
    },
  ];
  const score = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
  return { score, checks, themeHint };
}

/**
 * Post the audit to the App Proxy. Fire-and-forget; widget lifecycle never
 * blocks on it. The proxy persists it as a WIDGET_PLACEMENT_AUDIT event.
 */
function postAuditFireAndForget(): void {
  // Verification-panel cycle-9 finding: previously the audit fired on every
  // full page-load — non-SPA Shopify themes (Dawn etc.) reload every PDP
  // nav, so a single shopper visiting 12 PDPs polluted one shop's sample
  // with 12 near-identical audits. With the 200-event window cap, heavy
  // PDP browsers dominated the score. Now: stash a sessionStorage flag so
  // we audit ONCE per session — the placement score reflects unique
  // surfaces, not unique pageviews.
  try {
    if (sessionStorage.getItem("sq-audit-fired") === "1") return;
    sessionStorage.setItem("sq-audit-fired", "1");
  } catch {
    /* sessionStorage blocked — proceed without dedupe rather than skip */
  }
  setTimeout(() => {
    try {
      const audit = auditPlacement();
      const apiBase = (window as unknown as { __sqApi?: string }).__sqApi ?? "/apps/stylique";
      fetch(`${apiBase}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: "WIDGET_PLACEMENT_AUDIT",
          payload: {
            score: audit.score,
            themeHint: audit.themeHint,
            url: location.pathname,
            isPdp: /\/products?\//.test(location.pathname),
            surfaceConfig: {
              enableStylist: STYLIST_ENABLED,
              enableWidget: WIDGET_ENABLED,
              showSize: SHOW_SIZE,
              showStyle: SHOW_STYLE,
            },
            checks: audit.checks.map((c) => ({ id: c.id, passed: c.passed })),
          },
        }),
        keepalive: true,
      }).catch((e) => {
        // Surface delivery failures in devtools so a misconfigured proxy
        // doesn't go silent.
        if (typeof console !== "undefined") console.warn("[stylique-audit]", e);
      });
    } catch {
      /* ignore */
    }
  }, 3000);
}

function mount() {
  if (document.getElementById("sq-mira-root")) return;
  if (!STYLIST_ENABLED && !WIDGET_ENABLED) return;
  // Keep the PDP try-on button alive: themes lazy-load the hero image and image
  // sliders re-render the DOM, so we poll for ~20s and RE-inject if the button
  // ever disappears (the #id guard inside makes a no-op when it's still present).
  let ticks = 0;
  const tryInject = () => {
    if (/\/products?\//.test(location.pathname) && !document.getElementById("sq-tryon-pdp-btn")) {
      injectTryOnButton();
    }
    if (ticks++ < 40) setTimeout(tryInject, 500);
  };
  tryInject();
  // Fire the placement audit once per page load, ~3s after mount so lazy
  // theme selectors have settled. Powers the dashboard tile + low-confidence
  // ops view.
  postAuditFireAndForget();
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
  document.head.appendChild(link);
  const style = document.createElement("style");
  style.textContent = TOKENS_CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.id = "sq-mira-root";
  document.body.appendChild(root);
  render(h(MiraWidget, {}), root);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
else mount();
