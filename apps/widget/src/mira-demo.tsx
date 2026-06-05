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

// ONE backend — the same one the demo uses (Mira chat + try-on render + assets).
const ORIGIN = "https://stylique-web-production.up.railway.app";
const w = window as unknown as Record<string, unknown>;
w.__sqApi = ORIGIN;                 // API base for Mira/tryon fetches
w.__styliqueTryonApiBase = ORIGIN;  // try-on render base (legacy global name)
w.__sqAssetBase = ORIGIN;           // runtime asset base (belt-and-braces with the build-time define)
w.__sqProductSeg = "products";      // Shopify PDP path is /products/<handle> (plural)

// Design tokens — single source, shared by widget + dashboard + demo.
const TOKENS_CSS = `
#sq-mira-root {
  --bg:#08070A; --surface:#14111A; --surface-2:rgba(255,255,255,.025);
  --line:rgba(255,255,255,.08); --line-2:rgba(255,255,255,.14); --line-acc:rgba(201,181,255,.35);
  --text:#F4F2EE; --mute:#8E8A99; --mute-2:#5A5663; --electric:#8B5CF6; --pink:#E879C8;
  --grad:linear-gradient(135deg,#8B5CF6 0%,#C26BE6 55%,#E879C8 100%);
  --grad-soft:linear-gradient(135deg,rgba(139,92,246,.16) 0%,rgba(232,121,200,.10) 100%);
  --glow:radial-gradient(60% 60% at 50% 50%,rgba(139,92,246,.45) 0%,rgba(232,121,200,.10) 45%,rgba(0,0,0,0) 70%);
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
  if (document.getElementById("sq-tryon-pdp-btn")) return;
  const img = findProductImage();
  const host = img?.parentElement;
  if (!img || !host) return false;
  // The button is absolutely positioned inside the image's container.
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  const btn = document.createElement("button");
  btn.id = "sq-tryon-pdp-btn";
  btn.type = "button";
  btn.innerHTML = 'TRY-ON HERE&nbsp;&nbsp;<span style="font-size:12px;line-height:1">&#9654;</span>';
  btn.style.cssText = [
    "position:absolute", "z-index:50",
    "display:inline-flex", "align-items:center", "gap:4px",
    "padding:13px 22px", "background:#0E0E10", "color:#fff", "border:0", "border-radius:12px",
    "font-family:ui-sans-serif,system-ui,-apple-system,sans-serif", "font-size:14px", "font-weight:700",
    "letter-spacing:.05em", "cursor:pointer", "box-shadow:0 8px 22px rgba(0,0,0,.38)",
    "transition:transform .15s,box-shadow .15s", "-webkit-tap-highlight-color:transparent",
  ].join(";");
  btn.onmouseenter = () => { btn.style.transform = "translateY(-2px)"; btn.style.boxShadow = "0 12px 30px rgba(0,0,0,.48)"; };
  btn.onmouseleave = () => { btn.style.transform = ""; btn.style.boxShadow = "0 8px 22px rgba(0,0,0,.38)"; };
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent("stylique:open-tryon"));
  });
  host.appendChild(btn);
  // Anchor to the BOTTOM-LEFT CORNER OF THE IMAGE itself — the container is often
  // taller than the image (thumbnails, zoom layers), which pushed the button too
  // high before. We compute the image's box inside the host and reposition on
  // resize/scroll so it always sits on the image's bottom-left.
  const place = () => {
    const ho = host.getBoundingClientRect();
    const io = img.getBoundingClientRect();
    if (!io.height) return;
    btn.style.left = Math.max(0, io.left - ho.left + 16) + "px";
    btn.style.top = (io.bottom - ho.top - btn.offsetHeight - 16) + "px";
  };
  place();
  setTimeout(place, 200);
  window.addEventListener("resize", place, { passive: true });
  if ((img as HTMLImageElement).complete) place();
  else img.addEventListener("load", place);
  return true;
}

function mount() {
  if (document.getElementById("sq-mira-root")) return;
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
