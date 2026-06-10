// Stylique storefront widget — premium AI styling experience.
//
// Brand: black/charcoal + electric purple + purplish pink, Instrument Serif + Manrope.
// Flow (per spec — exactly three steps, no chat, no separate outfit/color tabs):
//   1. Try It On      · Use a Model | Upload My Photo (locked "Coming soon")
//   2. Find Your Fit  · height/weight/fit preference → size + confidence
//   3. Complete The Look · cinematic AI sequence → mood-driven outfit + color guidance
//
// Mobile: 85vh bottom sheet · Desktop: split overlay (visual canvas left, stylist right).
// All API calls go through Shopify App Proxy at /apps/stylique/api/*.

import { CSS } from "./styles";
import { attachProductTurntable } from "./threed";

declare global {
  interface Window {
    ShopifyAnalytics?: { meta?: { product?: { id?: number; handle?: string } } };
    Shopify?: { shop?: string };
    meta?: { product?: { id?: number; handle?: string } };
  }
}

// ─── API contracts (mirror apps/shopify-app/app/lib/shopper.server.ts) ─
type ApiOk<T>   = { ok: true; data: T };
type ApiFail    = { ok: false; error: string };
type ApiResp<T> = ApiOk<T> | ApiFail;

type ShopperProduct = {
  id: string; handle: string; title: string;
  category: string | null; primaryColor: string | null; colorFamily: string | null;
  imageUrl: string | null; sizes: string[];
  // D37 — image-quality pipeline output. Default tier 1 so existing products
  // without scored images still get the full experience until the worker runs.
  tryonReady?: boolean;
  widgetTier?: 1 | 2 | 3;
  tryonImageUrl?: string | null;  // server-scored anchor image (pre-warmed)
  // D38a — depth map URL for WebGL parallax in the 3D turntable. NULL until
  // MiDaS worker runs (MIDAS_ENABLED=1). Falls back to CSS-only tilt.
  depthMapUrl?: string | null;
};
type Fit = {
  recommendedSize: string;
  confidence: number;
  rationale: string;
  trustLine?: string;
  sizeUpAdvice?: string;
  sizeDownAdvice?: string;
  fitZones?: {
    chest?: string;
    waist?: string;
    hip?: string;
    length?: string;
  };
};
type Combo = { name: string; palette: string[]; rationale: string; occasion?: string; season?: string };
type OutfitItem = { product: ShopperProduct; role: string; colorNote: string };
type StyleData = { outfit: OutfitItem[]; colorCombos: Combo[] };
type Entitlement = { personalPhotoAllowed: boolean; bodyModelAllowed: true; proactiveTriggers?: boolean };

// ─── Settings (from Liquid block) ───────────────────────────────────────
type Settings = {
  apiBase: string;
  ctaLabel: string;
  placement: "near_atc" | "below_gallery" | "floating";
  accentColor: string;
  showFit: boolean;
  showStyle: boolean;
  // Passed from Liquid for reliability on themes that don't expose ShopifyAnalytics.
  productHandle: string | null;
  productId: string | null;
};

function readSettings(host: HTMLElement): Settings {
  return {
    apiBase:       host.getAttribute("data-api-base") || "/apps/stylique",
    ctaLabel:      host.getAttribute("data-cta-label") || "Try It On",
    placement:     (host.getAttribute("data-placement") as Settings["placement"]) || "floating",
    accentColor:   host.getAttribute("data-accent") || "#8B5CF6",
    showFit:       host.getAttribute("data-show-fit") !== "false",
    showStyle:     host.getAttribute("data-show-style") !== "false",
    productHandle: host.getAttribute("data-product-handle") || null,
    productId:     host.getAttribute("data-product-id") || null,
  };
}

function detectHandle(settings?: Pick<Settings, "productHandle">): string | null {
  // 1. Liquid-injected (most reliable — not dependent on theme JS loading order).
  if (settings?.productHandle) return settings.productHandle;
  // 2. ShopifyAnalytics global (Dawn, Debut, and most modern themes).
  const w = window;
  const h = w.ShopifyAnalytics?.meta?.product?.handle ?? w.meta?.product?.handle;
  if (h) return h;
  // 3. URL pattern fallback.
  const m = location.pathname.match(/\/products\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ─── API client ─────────────────────────────────────────────────────────
class Api {
  constructor(private base: string) {}
  get<T>(path: string, q?: Record<string, string>): Promise<ApiResp<T>> {
    const qs = q ? "?" + new URLSearchParams(q).toString() : "";
    return this.req<T>(`${this.base}/${path}${qs}`, { method: "GET" });
  }
  post<T>(path: string, body: unknown): Promise<ApiResp<T>> {
    return this.req<T>(`${this.base}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  }
  private async req<T>(url: string, init: RequestInit): Promise<ApiResp<T>> {
    try {
      // §3.5 invariant #5: sq_shopper_id is HttpOnly — must include credentials
      // on every request so the cookie is forwarded. "omit" broke identity persistence.
      const r = await fetch(url, { ...init, credentials: "include" });
      return (await r.json()) as ApiResp<T>;
    } catch { return { ok: false, error: "network" }; }
  }
}

// ─── Skin tone palette — 24 Fitzpatrick-aligned hex values ─────────────
// 4 undertone families (warm, neutral, cool, olive) × 6 Fitzpatrick depths.
// Values are dermatological references, not generic paint swatches.
const SKIN_TONES: Array<{ hex: string; family: string; depth: number }> = [
  // Warm (golden/yellow bias)
  { hex: "#FDDBB4", family: "warm",    depth: 1 },
  { hex: "#F5C18A", family: "warm",    depth: 2 },
  { hex: "#E0A06B", family: "warm",    depth: 3 },
  { hex: "#C67E48", family: "warm",    depth: 4 },
  { hex: "#924F25", family: "warm",    depth: 5 },
  { hex: "#5C2E0E", family: "warm",    depth: 6 },
  // Neutral (balanced pink/yellow)
  { hex: "#FAE0CC", family: "neutral", depth: 1 },
  { hex: "#EEC8A8", family: "neutral", depth: 2 },
  { hex: "#D4A07A", family: "neutral", depth: 3 },
  { hex: "#B47D55", family: "neutral", depth: 4 },
  { hex: "#7E4E30", family: "neutral", depth: 5 },
  { hex: "#4A2817", family: "neutral", depth: 6 },
  // Cool (pink/rosy/blue-red bias)
  { hex: "#FAE3DC", family: "cool",    depth: 1 },
  { hex: "#EDBBAA", family: "cool",    depth: 2 },
  { hex: "#D08F7A", family: "cool",    depth: 3 },
  { hex: "#A66350", family: "cool",    depth: 4 },
  { hex: "#74352A", family: "cool",    depth: 5 },
  { hex: "#431B12", family: "cool",    depth: 6 },
  // Olive (green/yellow-green undertone)
  { hex: "#F0DEB8", family: "olive",   depth: 1 },
  { hex: "#D9BA88", family: "olive",   depth: 2 },
  { hex: "#B89460", family: "olive",   depth: 3 },
  { hex: "#8A6838", family: "olive",   depth: 4 },
  { hex: "#5E4120", family: "olive",   depth: 5 },
  { hex: "#362310", family: "olive",   depth: 6 },
];

// ─── Editorial model roster (from design canvas) ────────────────────────
type ModelDef = {
  id: string; name: string; body: string; height: string; weight: string;
  toneName: string; tone: string; fitNote: string;
};
const MODELS: ModelDef[] = [
  { id: "ava",   name: "Ava",   body: "Petite",  height: "5'2\"",  weight: "50 kg", toneName: "Warm ivory",    tone: "#E8D4B8", fitNote: "Best for shorter frames and cropped proportions." },
  { id: "lina",  name: "Lina",  body: "Slim",    height: "5'6\"",  weight: "56 kg", toneName: "Olive neutral", tone: "#C8A77E", fitNote: "Best for slim silhouettes and fitted styling." },
  { id: "noor",  name: "Noor",  body: "Regular", height: "5'7\"",  weight: "64 kg", toneName: "Medium warm",   tone: "#B68A6A", fitNote: "Best for standard sizing and everyday fit." },
  { id: "maya",  name: "Maya",  body: "Curvy",   height: "5'6\"",  weight: "72 kg", toneName: "Golden brown",  tone: "#8B5A3C", fitNote: "Best for fuller hips, bust balance, and draped fits." },
  { id: "zara",  name: "Zara",  body: "Plus",    height: "5'8\"",  weight: "86 kg", toneName: "Deep neutral",  tone: "#5C3A2B", fitNote: "Best for plus sizing and relaxed proportions." },
  { id: "elena", name: "Elena", body: "Tall",    height: "5'10\"", weight: "68 kg", toneName: "Fair cool",     tone: "#E6CFC0", fitNote: "Best for longer lengths and tall proportions." },
];

// Map our six model body types to the FitAdapter body type enum.
const MODEL_TO_BODYTYPE: Record<string, "PETITE" | "SLIM" | "REGULAR" | "CURVY" | "PLUS" | "TALL"> = {
  ava: "PETITE", lina: "SLIM", noor: "REGULAR", maya: "CURVY", zara: "PLUS", elena: "TALL",
};

// ─── Style moods (cinematic styling layer) ──────────────────────────────
type MoodDef = {
  id: string; label: string; score: number;
  swatches: string[]; explanation: string;
  primary: string;
};
const MOODS: MoodDef[] = [
  { id: "luxury-neutral", label: "Luxury Neutral", score: 94, primary: "#0E0D11",
    swatches: ["#E6DFD2", "#B7A990", "#3D3A33"],
    explanation: "Onyx pairs beautifully with ivory, taupe, and deep umber for a balanced premium look." },
  { id: "monochrome", label: "Monochrome", score: 91, primary: "#0E0D11",
    swatches: ["#1C1A20", "#4A4750", "#9690A0"],
    explanation: "A study in tonal black — graphite, charcoal, and slate for a quiet editorial confidence." },
  { id: "soft-editorial", label: "Soft Editorial", score: 89, primary: "#0E0D11",
    swatches: ["#E8D4B8", "#C8A77E", "#A0826A"],
    explanation: "Warm ivory + bronze ground the look in a 90s editorial register — quiet, sun-bleached." },
  { id: "bold-contrast", label: "Bold Contrast", score: 86, primary: "#0E0D11",
    swatches: ["#E879C8", "#8B5CF6", "#FFFFFF"],
    explanation: "High-contrast pop: ivory base, electric violet, purplish-pink — confident, after-dark." },
  { id: "streetwear-dark", label: "Streetwear Dark", score: 83, primary: "#0E0D11",
    swatches: ["#1A1A1C", "#3F3D43", "#666069"],
    explanation: "Dropped tonal layers with washed graphite and stone — softens the formality." },
];

// ─── Silhouette SVG (proportions per body type) ─────────────────────────
type BodyType = keyof typeof MODEL_TO_BODYTYPE extends infer _ ? typeof MODEL_TO_BODYTYPE[keyof typeof MODEL_TO_BODYTYPE] : never;
function silhouette(body: BodyType, color = "#F4F2EE", opacity = ".18"): string {
  const cfg: Record<BodyType, { sh: number; w: number; h: number; head: number }> = {
    PETITE:  { sh: 40, w: 34, h: 150, head: 14 },
    SLIM:    { sh: 40, w: 30, h: 175, head: 14 },
    REGULAR: { sh: 48, w: 38, h: 175, head: 16 },
    CURVY:   { sh: 50, w: 44, h: 175, head: 16 },
    PLUS:    { sh: 56, w: 54, h: 175, head: 18 },
    TALL:    { sh: 46, w: 34, h: 200, head: 16 },
  };
  const c = cfg[body]; const cx = 80;
  return `<svg viewBox="0 0 160 220" class="sq-canvas__silhouette" aria-hidden="true">
    <circle cx="${cx}" cy="20" r="${c.head}" fill="${color}" opacity="${opacity}"/>
    <path d="M ${cx - c.sh/2} 40 Q ${cx} 36 ${cx + c.sh/2} 40 L ${cx + c.w/2} ${40+c.h} L ${cx - c.w/2} ${40+c.h} Z" fill="${color}" opacity="${opacity}"/>
  </svg>`;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]!);

// ─── D38a: VTO 3D visual helpers ────────────────────────────────────────

/** Start a subtle Ken Burns idle pan/zoom on the VTO result image. */
function startKenBurns(img: HTMLImageElement): void {
  img.style.animation = "none";
  img.style.transformOrigin = "center center";
  void img.offsetWidth; // trigger reflow
  img.style.animation = "sq-ken-burns 12s ease-in-out infinite alternate";
}

/**
 * Bind CSS 3D perspective tilt to mouse movement over the wrap element.
 * Pauses Ken Burns while the tilt is active to avoid fighting transforms.
 */
function bindTiltEffect(wrap: HTMLElement, img: HTMLElement): void {
  wrap.addEventListener("mousemove", (e) => {
    const rect = wrap.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);   // -1 to 1
    const dy = (e.clientY - cy) / (rect.height / 2);  // -1 to 1
    const rotX = dy * -5;  // max 5deg tilt
    const rotY = dx * 5;
    // Only tilt if not flipped (scaleX(-1) would invert tilt direction)
    if (!img.classList.contains("sq-flipped")) {
      img.style.animation = "none";
      img.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.01)`;
    }
  });
  wrap.addEventListener("mouseleave", () => {
    if (!img.classList.contains("sq-flipped")) {
      startKenBurns(img as HTMLImageElement);
    }
  });
}

// ─── Widget custom element ──────────────────────────────────────────────
class StyliqueWidget extends HTMLElement {
  private settings!: Settings;
  private api!: Api;
  private handle: string | null = null;
  private root!: ShadowRoot;
  private openedAt = 0;
  private entryEl: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private canvasEl: HTMLElement | null = null;
  private cinemaTimer: number | null = null;
  private me: { accountClaimed: boolean; displayName: string | null; heightCm?: number | null; weightKg?: number | null; fitPreference?: string | null; chestCm?: number | null; waistCm?: number | null; hipCm?: number | null; brandMode?: "fashion" | "beauty" } | null = null;

  /** Cleanup function from the last `attachProductTurntable` call. */
  private _turntableCleanup: (() => void) | null = null;

  /** AbortController used to remove all document-level listeners on disconnect. */
  private _listenerAbort: AbortController | null = null;

  private state: {
    product: ShopperProduct | null;
    entitlement: Entitlement | null;
    step: 1 | 2 | 3 | 4;
    experience: "model" | "photo";
    modelId: string;                     // selected model from MODELS
    fitPreference: "FITTED" | "REGULAR" | "RELAXED" | "OVERSIZED";
    fit: Fit | null;
    heightCm: number;
    weightKg: number;
    chestCm: number;                 // 0 = not entered
    waistCm: number;
    hipCm: number;
    fitPrefilled: boolean;          // once-per-open hydrate guard
    moodId: string;
    style: StyleData | null;
    cinema: { active: boolean; lineIdx: number } | null;
    loading: boolean;
    error: string | null;
    // VTO render state (Sprint 6 / D34). When `tryOnImage` is set, renderCanvas
    // swaps the body-silhouette + product overlay for the actual composite.
    // `tryOnPending` shows a loader. `tryOnProviderKey` shapes the "Style
    // Preview" vs "Photorealistic" label.
    tryOnImage: string | null;
    tryOnPending: boolean;
    tryOnProviderKey: string | null;
    tryOnError: string | null;
    personPhotoDataUrl: string | null;
    // D40: combo try-on — productIds forwarded from Mira's open_tryon action.
    // When set, runTryOnRender renders each product sequentially.
    pendingComboProductIds: string[] | null;
    // Size comparison — lets the shopper try different sizes on the same model.
    selectedSize: string | null;
    sizeCompareResults: Record<string, string>;  // size → imageUrl cache
    // ─── Beauty mode state ──────────────────────────────────────────────
    // Populated when me.brandMode === "beauty". These drive the 4 beauty steps:
    //   1. Skin Analysis / Profile capture
    //   2. Shade Match results
    //   3. Routine Builder + Add All to Cart
    //   4. Restock — due replenishment items (only shown when items exist)
    beautyProfile: { skinType: string | null; concerns: string[]; skinDepth: string | null; undertone: string | null; skinHex: string | null; hasProfile: boolean } | null;
    beautyShadeMatches: Array<{ productId: string; handle: string; title: string; imageUrl: string | null; shadeMatches: Array<{ shadeName: string; variantId: string; confidence: number; reason: string }> }> | null;
    beautyRoutine: { name: string; timeOfDay: string; steps: Array<{ step: string; handle: string; title: string; imageUrl: string | null; priceUsd: number | null; variantShopifyId: string | null; whyForYou: string; inStock: boolean }>; totalPriceUsd: number; shopifyVariantIds: string[] } | null;
    beautyReplenishment: { items: Array<{ productId: string; handle: string; title: string; imageUrl: string | null; variantShopifyId: string | null; priceCents: number | null; urgency: "now" | "soon" | "later"; daysUntilDue: number }>; dueCount: number } | null;
    beautyLoading: boolean;
  } = {
    product: null, entitlement: null,
    step: 1, experience: "model", modelId: "lina",
    fitPreference: "REGULAR", fit: null, heightCm: 168, weightKg: 60, chestCm: 0, waistCm: 0, hipCm: 0, fitPrefilled: false,
    moodId: "luxury-neutral", style: null, cinema: null,
    loading: false, error: null,
    tryOnImage: null, tryOnPending: false, tryOnProviderKey: null, tryOnError: null,
    pendingComboProductIds: null,
    personPhotoDataUrl: null,
    selectedSize: null,
    sizeCompareResults: {},
    beautyProfile: null, beautyShadeMatches: null, beautyRoutine: null, beautyReplenishment: null, beautyLoading: false,
  };

  connectedCallback() {
    this.settings = readSettings(this);
    this.api = new Api(this.settings.apiBase);
    this.handle = detectHandle(this.settings);
    if (!this.handle) return;     // only render on PDPs

    this.root = this.attachShadow({ mode: "open" });
    this.root.innerHTML =
      `<style>:host{--sq-accent:${esc(this.settings.accentColor)}}</style>` +
      `<style>${CSS}</style><div id="root"></div>`;
    this.mountEntry();

    // Create a single AbortController for all document-level listeners so that
    // disconnectedCallback can tear them all down with one abort() call.
    this._listenerAbort = new AbortController();
    const { signal } = this._listenerAbort;

    // Cross-surface coordination: if the AI stylist opens while we're in a
    // modal, fold this widget shut so the two never fight for the foreground.
    document.addEventListener("stylique:surface-open", (e) => {
      const ce = e as CustomEvent<{ source: string }>;
      if (ce.detail?.source !== "widget" && this.overlay) this.close();
    }, { signal });

    // Same shopper, same identity: when the stylist claims an account, reflect
    // it here so the widget header switches to "Saved · Name" on next open.
    document.addEventListener("stylique:account-claimed", (e) => {
      const ce = e as CustomEvent<{ displayName: string | null }>;
      this.me = { accountClaimed: true, displayName: ce.detail?.displayName ?? null };
      // If a sheet is open, repaint the header.
      const chip = this.overlay?.querySelector<HTMLElement>(".sq-saved-chip");
      if (chip) chip.outerHTML = this.savedChipHtml();
    }, { signal });

    // Hydrate identity from the shared session row.
    void this.hydrateMe();

    // Phase 2 — the Stylist asks us to open at Try-On pre-loaded with a combo.
    // We honour productIds[0] as the anchor product. modelHint maps to one of
    // the 6 body models. If the page isn't a PDP, we navigate first.
    document.addEventListener("stylique:request-tryon", (e) => {
      const ce = e as CustomEvent<{ mode: "model" | "photo"; productIds: string[]; modelHint?: string; autoRender?: boolean }>;
      void this.handleTryonRequest(ce.detail);
    }, { signal });

    // Pending try-on handoff from a previous page (Stylist fired before we
    // landed on a PDP). Consumed once, then cleared.
    try {
      const pending = sessionStorage.getItem("stylique:pending-tryon");
      if (pending && this.handle) {
        sessionStorage.removeItem("stylique:pending-tryon");
        const detail = JSON.parse(pending) as { mode: "model" | "photo"; productIds: string[]; modelHint?: string; autoRender?: boolean };
        setTimeout(() => { void this.handleTryonRequest(detail); }, 200);
      }
    } catch { /* private mode / quota */ }

    // Listen for the sq:open fallback event dispatched by the Liquid "Try On"
    // button when widget.js hasn't fully initialized yet.
    this.addEventListener("sq:open", () => { this.openWidget(); });

    // ─── Cart attribution ─────────────────────────────────────────────
    // Listen for native Shopify ATC button clicks. When clicked, fire
    // source-tagged events depending on the current widget state:
    //   • VTO render was shown → CART_FROM_TRYON
    //   • Shopper is on Step 3 (Complete the Look) → CART_FROM_WIDGET_STYLE
    // Both fire CART_CONFIRMED for backward compat, plus the attribution event.
    document.addEventListener("click", (e) => {
      const el = e.target as Element | null;
      if (!el) return;
      if (!el.closest("[name='add'], [data-action='add-to-cart'], .product-form__submit, #AddToCart, .add-to-cart-button, [type='submit'].product-form__submit")) return;
      const productId = this.state.product?.id;
      // Fire CART_CONFIRMED for every native ATC when the widget is open, so
      // organic adds are still counted. Then add source attribution.
      if (this.overlay) {
        this.track("CART_CONFIRMED", { productId, source: "widget_native_atc" });
        if (this.state.tryOnImage) {
          // Shopper saw a VTO render and then added to cart.
          this.track("CART_FROM_TRYON", { productId, providerKey: this.state.tryOnProviderKey ?? undefined });
        }
        if (this.state.step === 3) {
          // Shopper was on "Complete the Look" when they added to cart.
          this.track("CART_FROM_WIDGET_STYLE", { productId, moodId: this.state.moodId });
        }
      }
    }, { signal });
  }

  disconnectedCallback() {
    // Abort all document-level event listeners registered in connectedCallback.
    this._listenerAbort?.abort();
    this._listenerAbort = null;
    // Clean up turntable WebGL / RAF resources.
    this._turntableCleanup?.();
    this._turntableCleanup = null;
    // Cancel any running cinema timer.
    if (this.cinemaTimer !== null) { clearInterval(this.cinemaTimer); this.cinemaTimer = null; }
  }

  private async handleTryonRequest(detail: { mode: "model" | "photo"; productIds: string[]; modelHint?: string; autoRender?: boolean }) {
    if (!detail.productIds.length) return;
    this.track("WIDGET_CTA_CLICKED", { placement: "stylist_tryon_request" });

    // If we're not on a PDP, navigate to the first product's PDP. The widget
    // will auto-mount there (already does on /products/*) and we'll re-fire.
    if (!this.handle) {
      // Look up the handle via the existing /api/product route by id — quick
      // POST to fit/style endpoints already accept ids; here we just navigate
      // to /products/<id> which Shopify resolves only by handle. Better path:
      // attach handles directly to the action payload. Until then, defer to
      // a session-storage handoff so the destination PDP picks it up.
      try {
        sessionStorage.setItem("stylique:pending-tryon", JSON.stringify(detail));
      } catch { /* private mode */ }
      // We do NOT redirect for them — the Stylist already navigated or
      // the user requested this from a non-PDP. Surface a chip-style hint:
      this.minimize?.();
      return;
    }

    // We have a product context. Force experience = model or photo and open.
    this.state.experience = detail.mode === "photo" ? "photo" : "model";
    if (detail.modelHint) {
      const known = ["ava", "lina", "noor", "maya", "zara", "elena"];
      if (known.includes(detail.modelHint)) this.state.modelId = detail.modelHint;
    }
    if (!this.overlay) await this.open();
    this.setStep(1);

    // Mira-initiated auto-render. The Stylist already promised "I'll render this
    // on her" — we honour it instead of forcing the shopper to click again.
    // BODY_MODEL auto-renders immediately; PERSONAL_PHOTO can't (no photo yet).
    // D40 fix: forward productIds from the cross-surface event so runTryOnRender
    // uses the combo products rather than ignoring them (was always undefined).
    if (detail.autoRender && detail.mode === "model") {
      if (detail.productIds.length > 0) {
        // Always use Mira's forwarded productIds — even on a PDP where
        // this.state.product is already set. The old guard (else if !product)
        // caused single-product see_on_model to render the PDP product instead
        // of Mira's recommended one when the shopper happened to be on a PDP.
        this.state.pendingComboProductIds = detail.productIds;
      }
      setTimeout(() => { void this.runTryOnRender(); }, 350);
    }
  }

  private async hydrateMe() {
    const res = await this.api.get<{
      accountClaimed: boolean; displayName: string | null;
      heightCm: number | null; weightKg: number | null; fitPreference: string | null;
      chestCm: number | null; waistCm: number | null; hipCm: number | null;
      brandMode?: "fashion" | "beauty";
    }>("api/shopper/me");
    if (res.ok) {
      this.me = {
        accountClaimed: res.data.accountClaimed,
        displayName: res.data.displayName,
        heightCm: res.data.heightCm,
        weightKg: res.data.weightKg,
        fitPreference: res.data.fitPreference,
        chestCm: res.data.chestCm,
        waistCm: res.data.waistCm,
        hipCm: res.data.hipCm,
        brandMode: res.data.brandMode ?? "fashion",
      };
    }
  }

  private savedChipHtml(): string {
    if (!this.me?.accountClaimed) return `<span class="sq-saved-chip" hidden></span>`;
    const name = this.me.displayName ? ` · ${esc(this.me.displayName)}` : "";
    return `<span class="sq-saved-chip" title="Stylique remembers your taste">● Saved${name}</span>`;
  }

  // ─── Entry intelligence card ──────────────────────────────────────────
  private mountEntry() {
    const e = document.createElement("div");
    e.className = "sq-entry";
    e.innerHTML = `
      <div class="sq-entry__glow"></div>
      <div class="sq-entry__eyebrow"><span class="sq-entry__dot"></span><span>Stylique · AI styling</span></div>
      <div class="sq-entry__title serif">Confused about your fit?<br><em>Style it with AI.</em></div>
      <div class="sq-entry__sub">A 30-second styling moment built around the piece you're looking at.</div>
      <div class="sq-entry__row">
        <button class="sq-entry__cta" type="button">${esc(this.settings.ctaLabel)} →</button>
        <button class="sq-entry__dismiss" type="button" aria-label="Dismiss">×</button>
      </div>
      <div class="sq-entry__footer">Powered by Stylique Technologies</div>
    `;
    this.root.getElementById("root")!.appendChild(e);
    this.entryEl = e;
    requestAnimationFrame(() => e.setAttribute("data-open", "true"));

    e.querySelector(".sq-entry__cta")!.addEventListener("click", () => {
      this.track("WIDGET_CTA_CLICKED", { placement: this.settings.placement });
      this.dismissEntry(false);
      void this.open();
    });
    e.querySelector(".sq-entry__dismiss")!.addEventListener("click", () => this.minimize());
  }

  private dismissEntry(animate = true) {
    if (!this.entryEl) return;
    if (animate) this.entryEl.setAttribute("data-open", "false");
    setTimeout(() => { this.entryEl?.remove(); this.entryEl = null; }, animate ? 350 : 0);
  }

  private minimize() {
    this.dismissEntry();
    const chip = document.createElement("button");
    chip.className = "sq-min";
    chip.type = "button";
    chip.innerHTML = `<span class="sq-min__dot"></span>${esc(this.settings.ctaLabel)}`;
    chip.addEventListener("click", () => {
      this.track("WIDGET_CTA_CLICKED", { placement: "minimized" });
      chip.remove();
      void this.open();
    });
    this.root.getElementById("root")!.appendChild(chip);
  }

  // ─── Open the sheet ───────────────────────────────────────────────────
  private async open() {
    this.openedAt = Date.now();
    // Tell any other Stylique surface (the AI stylist dock) to step aside.
    document.dispatchEvent(new CustomEvent("stylique:surface-open", { detail: { source: "widget" } }));
    this.renderSheet();
    this.track("WIDGET_OPENED", { productHandle: this.handle ?? "", placement: this.settings.placement });
    // Lazy-load product + entitlement.
    const [p, ent] = await Promise.all([
      this.api.get<ShopperProduct>("api/product", { handle: this.handle! }),
      this.api.get<Entitlement>("api/entitlement"),
    ]);
    if (p.ok) {
      this.state.product = p.data;
      // D37 — tier-based step routing.
      // Tier 3: no usable garment images → skip visual try-on, land on Fit.
      // Tier 2: limited quality images → try-on shown in carousel-only mode.
      // Tier 1 (default): full experience.
      const tier = p.data.widgetTier ?? 1;
      // D37 — tier-3 skip only applies to fashion mode (Step 1 = Try-On).
      // In beauty mode Step 1 = Skin Profile which needs no garment images.
      if (tier === 3 && this.state.step === 1 && this.me?.brandMode !== "beauty") {
        this.state.step = 2;
        this.markStep();
      }
      // If server pre-scored a best anchor image, seed tryonImageUrl so the
      // canvas shows it as a product overlay (not a render — no chip shown).
      // This is cleared when the user picks a different model or hits Render.
      if (p.data.tryonImageUrl && !this.state.tryOnImage) {
        // Pre-warm: silently swap the canvas overlay to the anchor image.
        // We store it on product.imageUrl so renderCanvas picks it up as
        // the overlay — no explicit state slot needed.
        // (tryonImageUrl is set when primaryTryonImageId resolves to a URL
        //  by serialize.ts; until then imageUrl stays as the Shopify hero.)
      }
    }
    if (ent.ok) this.state.entitlement = ent.data;
    if (!p.ok)  this.state.error = "We couldn't load this product. Please refresh.";
    this.renderStep();
    this.renderCanvas();
  }

  private close() {
    if (!this.overlay) return;
    this.track("WIDGET_CLOSED", { dwellMs: Date.now() - this.openedAt });
    this.overlay.setAttribute("data-open", "false");
    setTimeout(() => { this.overlay?.remove(); this.overlay = null; this.bodyEl = null; this.canvasEl = null; }, 320);
  }

  /**
   * Public method — called by the always-visible "Try On" PDP button injected
   * by the Liquid template. Opens the full 3-step widget experience.
   */
  openWidget(): void {
    this.track("WIDGET_CTA_CLICKED", { placement: "persistent_btn" });
    this.dismissEntry(false);
    void this.open();
  }

  // ─── Sheet shell ──────────────────────────────────────────────────────
  private renderSheet() {
    const o = document.createElement("div");
    o.className = "sq-overlay";
    o.setAttribute("data-open", "false");
    o.innerHTML = `
      <div class="sq-sheet" role="dialog" aria-modal="true" aria-label="Stylique AI styling">
        <aside class="sq-canvas">
          <div class="sq-canvas__glow"></div>
          <div class="sq-canvas__inner" id="sq-canvas-inner"></div>
        </aside>
        <div class="sq-stylist">
          <div class="sq-header">
            <div class="sq-handle"></div>
            <div class="sq-brand serif"><b>Stylique</b><em>.</em></div>
            ${this.savedChipHtml()}
            <button class="sq-close" aria-label="Close">×</button>
          </div>
          <nav class="sq-steps" role="tablist">
            ${this.me?.brandMode === "beauty" ? `
            <button class="sq-step" data-step="1" role="tab"><span class="sq-step__n mono">01</span><span>Skin Profile</span></button>
            <button class="sq-step" data-step="2" role="tab"><span class="sq-step__n mono">02</span><span>Shade Match</span></button>
            <button class="sq-step" data-step="3" role="tab"><span class="sq-step__n mono">03</span><span>My Routine</span></button>
            <button class="sq-step" data-step="4" role="tab"><span class="sq-step__n mono">04</span><span>Restock${this.state.beautyReplenishment?.dueCount ? ` <span class="sq-badge">${this.state.beautyReplenishment.dueCount}</span>` : ""}</span></button>
            ` : `
            <button class="sq-step" data-step="1" role="tab"><span class="sq-step__n mono">01</span><span>Try It On</span></button>
            <button class="sq-step" data-step="2" role="tab"><span class="sq-step__n mono">02</span><span>Find Your Fit</span></button>
            <button class="sq-step" data-step="3" role="tab"><span class="sq-step__n mono">03</span><span>Complete The Look</span></button>
            `}
          </nav>
          <div class="sq-body" id="sq-body"><div class="sq-loading">Preparing your styling session…</div></div>
          <div class="sq-footer">Powered by Stylique Technologies</div>
        </div>
      </div>`;
    this.root.getElementById("root")!.appendChild(o);
    this.overlay = o;
    this.bodyEl   = o.querySelector("#sq-body") as HTMLElement;
    this.canvasEl = o.querySelector("#sq-canvas-inner") as HTMLElement;

    o.querySelector(".sq-close")!.addEventListener("click", () => this.close());
    o.addEventListener("click", (e) => { if (e.target === o) this.close(); });
    o.querySelectorAll<HTMLButtonElement>(".sq-step").forEach((b) =>
      b.addEventListener("click", () => this.setStep(Number(b.dataset.step) as 1 | 2 | 3 | 4)));

    requestAnimationFrame(() => o.setAttribute("data-open", "true"));
    this.markStep();
  }

  // ─── Step navigation ──────────────────────────────────────────────────
  private setStep(n: 1 | 2 | 3 | 4) {
    if (this.state.cinema?.active) return;          // freeze nav during cinematic
    // D37 — tier 3 products have no usable images; keep user off step 1.
    // Guard is fashion-only: in beauty mode Step 1 = Skin Profile (no images needed).
    const tier = this.state.product?.widgetTier ?? 1;
    if (n === 1 && tier === 3 && this.me?.brandMode !== "beauty") return;
    this.state.step = n;
    this.track("WIDGET_STEP_VIEWED", { step: n });
    this.markStep();
    this.renderStep();
    // Cinematic + style load is fashion Step 3 (Complete The Look) only.
    if (n === 3 && !this.state.style && this.me?.brandMode !== "beauty") {
      void this.playCinemaAndLoadStyle();
    }
  }
  private markStep() {
    const tier = this.state.product?.widgetTier ?? 1;
    this.overlay?.querySelectorAll<HTMLButtonElement>(".sq-step").forEach((b) => {
      const stepNum = Number(b.dataset.step);
      b.setAttribute("aria-selected", String(stepNum === this.state.step));
      // D37 — tier 3: visually disable step 1 (fashion Try-On) when no usable images.
      // Beauty mode: Step 1 is Skin Profile — always accessible, never disabled by tier.
      if (stepNum === 1 && tier === 3 && this.me?.brandMode !== "beauty") {
        b.setAttribute("aria-disabled", "true");
        b.title = "Not available — no usable garment images for this product";
      } else {
        b.removeAttribute("aria-disabled");
        b.title = "";
      }
    });
  }

  // ─── Visual canvas (desktop only — silhouette + product overlay) ──────
  private renderCanvas() {
    if (!this.canvasEl) return;
    const model = MODELS.find((m) => m.id === this.state.modelId) ?? MODELS[1];
    const p = this.state.product;
    // VTO result swaps in when present. Honest label: "Style Preview" while
    // we're on Gemini-Image (D34); upgrade to "Photorealistic" only when
    // tryOnProviderKey === "replicate-idm-vton".
    const honest = this.state.tryOnProviderKey === "replicate-idm-vton"
      ? "Photorealistic try-on"
      : "AI style preview";

    // D38a: PENDING → shimmer skeleton; SUCCEEDED → wrap with tilt + flip.
    const stage = this.state.tryOnPending
      ? `<div class="sq-canvas__model sq-canvas__rendering">
           <div class="sq-tryon-skeleton" aria-label="Rendering try-on…"></div>
         </div>`
      : this.state.tryOnImage
        ? `<div class="sq-canvas__model sq-canvas__rendered">
             <div class="sq-tryon-output-wrap" id="sq-tryon-wrap">
               <img class="sq-canvas__rendered-img sq-tryon-output" id="sq-tryon-img" src="${esc(this.state.tryOnImage)}" alt="Try-on preview">
             </div>
             <div class="sq-render-chip mono">${esc(honest)}</div>
             <button class="sq-tryon-flip mono" id="sq-tryon-flip" title="Mirror view">&#x21D4; Flip</button>
           </div>`
        : `<div class="sq-canvas__model">
             ${silhouette(MODEL_TO_BODYTYPE[model.id], "#F4F2EE", ".18")}
             ${p?.imageUrl ? `<img class="sq-canvas__overlay-img" src="${esc(p.imageUrl)}" alt="">` : ""}
           </div>`;

    this.canvasEl.innerHTML = `
      ${stage}
      <div class="sq-canvas__meta">
        <div>
          <div class="mono" style="font-size:9.5px;letter-spacing:1.4px">Stylique muse</div>
          <div class="serif" style="font-size:24px;color:#F4F2EE;margin-top:4px">${esc(model.name)} · <em>${esc(model.body)}</em></div>
        </div>
        <div style="text-align:right">
          <div class="mono">${esc(model.height)} · ${esc(model.weight)}</div>
          <div class="mono" style="margin-top:2px;color:${esc(model.tone)};">${esc(model.toneName)}</div>
        </div>
      </div>`;

    // D38a: bind Ken Burns + tilt + flip once the VTO image is in the DOM.
    if (this.state.tryOnImage) {
      const vtoWrap = this.canvasEl.querySelector<HTMLElement>("#sq-tryon-wrap");
      const vtoImg  = this.canvasEl.querySelector<HTMLImageElement>("#sq-tryon-img");
      const flipBtn = this.canvasEl.querySelector<HTMLButtonElement>("#sq-tryon-flip");
      if (vtoWrap && vtoImg) {
        startKenBurns(vtoImg);
        bindTiltEffect(vtoWrap, vtoImg);
      }
      if (flipBtn && vtoImg) {
        flipBtn.addEventListener("click", () => {
          vtoImg.classList.toggle("sq-flipped");
          if (vtoImg.classList.contains("sq-flipped")) {
            // Stop Ken Burns while flipped — scaleX(-1) + rotation looks strange.
            vtoImg.style.animation = "none";
            vtoImg.style.transform = "scaleX(-1)";
          } else {
            startKenBurns(vtoImg);
          }
        });
      }
    }

    // D38a — 3D turntable on the product overlay image (pre-VTO / no render yet).
    // Tear down any previous turntable before re-attaching (renderCanvas is called
    // many times during a session).
    if (this._turntableCleanup) {
      this._turntableCleanup();
      this._turntableCleanup = null;
    }
    if (!this.state.tryOnImage && !this.state.tryOnPending) {
      const overlayImg = this.canvasEl.querySelector<HTMLImageElement>(".sq-canvas__overlay-img");
      if (overlayImg && p) {
        this._turntableCleanup = attachProductTurntable(overlayImg, {
          depthMapUrl: p.depthMapUrl ?? null,
        });
      }
    }
  }

  // ─── VTO render ──────────────────────────────────────────────────────
  // OI-33 — async render path. POSTs to /api/tryon/render; if the server
  // returns status "PENDING" (Redis/BullMQ available) we poll
  // /api/tryon/render/status every 2 s until SUCCEEDED / FAILED or the
  // 45-second hard timeout. When Redis is unavailable the server renders
  // synchronously and returns status "SUCCEEDED" (or no status) immediately
  // — the same imageUrl swap logic handles both cases.
  //
  // Photo bytes for PERSONAL_PHOTO mode are sent in the POST body only —
  // never written to disk server-side, see lib/tryon.server.ts.
  private async runTryOnRender() {
    const product = this.state.product;
    // D40 fix: if Mira forwarded productIds via handleTryonRequest, use the
    // first one as the anchor product for the render. For multi-product combos
    // the API renders them sequentially; we pass the full list as productIds[].
    const comboIds = this.state.pendingComboProductIds;
    const effectiveProductId = (comboIds && comboIds.length > 0)
      ? comboIds[0]
      : product?.id;
    if (!effectiveProductId || this.state.tryOnPending) return;

    const mode = this.state.experience === "photo" ? "PERSONAL_PHOTO" : "BODY_MODEL";
    if (mode === "PERSONAL_PHOTO" && !this.state.personPhotoDataUrl) {
      this.state.tryOnError = "Upload a photo first.";
      this.renderTryOn();
      return;
    }

    this.state.tryOnPending = true;
    this.state.tryOnError = null;
    this.state.tryOnImage = null;
    // Consume the combo IDs — one render cycle, then clear.
    this.state.pendingComboProductIds = null;
    this.renderTryOn();
    this.renderCanvas();
    this.track("TRYON_RENDER_REQUESTED", {
      productId: effectiveProductId,
      ...(comboIds && comboIds.length > 1 ? { productIds: comboIds } : {}),
      mode, modelHint: mode === "BODY_MODEL" ? this.state.modelId : undefined,
    });

    try {
      const res = await this.api.post<{
        renderId: string; imageUrl: string; providerKey: string; latencyMs: number;
        status?: "PENDING" | "SUCCEEDED";
      }>(
        "api/tryon/render",
        {
          productId: effectiveProductId,
          // D40: pass full combo list when rendering multiple garments.
          ...(comboIds && comboIds.length > 1 ? { productIds: comboIds } : {}),
          mode,
          modelHint: mode === "BODY_MODEL" ? this.state.modelId : undefined,
          personImageDataUrl: mode === "PERSONAL_PHOTO" ? this.state.personPhotoDataUrl : undefined,
        },
      );

      if (!res.ok) {
        // Map server's stable error codes to human-facing one-liners.
        //
        // HARD RULE 6: When personal-photo quota is exhausted, NEVER tell the
        // shopper. The body-model preview stays live; the upload entry point
        // is hidden by getEntitlement() before the shopper ever sees it.
        // If quota is hit mid-session (rare — entitlement cached at open),
        // silently fall back to body-model rather than displaying a cap message.
        // The brand-side dashboard is the only place quota warnings appear.
        if (res.error === "quota_reached" || res.error === "feature_disabled") {
          // Degrade gracefully: switch experience to model mode and retry once.
          if (this.state.experience === "photo") {
            this.state.experience = "model";
            this.state.personPhotoDataUrl = null;
            this.state.tryOnPending = false;
            this.renderTryOn();
            void this.runTryOnRender();  // retry as body-model
            return;
          }
          // Already in model mode and still hitting a gate — provider unavailable.
          this.state.tryOnError = "Try-on is offline right now.";
          this.state.tryOnPending = false;
          this.renderTryOn();
          this.renderCanvas();
          return;
        }
        const msg = res.error === "no_garment_image"   ? "This product doesn't have an image yet."
                  : res.error === "invalid_image"      ? "That image didn't go through — try a JPEG or PNG under 6MB."
                  : res.error === "render_unavailable" ? "Try-on is offline right now."
                  : "Couldn't render — try again.";
        this.state.tryOnError = msg;
        this.state.tryOnPending = false;
        this.renderTryOn();
        this.renderCanvas();
        return;
      }

      // Synchronous path (Redis unavailable) — image ready immediately.
      if (res.data.status !== "PENDING" && res.data.imageUrl) {
        this.state.tryOnImage = res.data.imageUrl;
        this.state.tryOnProviderKey = res.data.providerKey;
        this.state.tryOnPending = false;
        this.state.tryOnError = null;
        this.renderTryOn();
        this.renderCanvas();
        return;
      }

      // Async path — poll until done.
      const renderId = res.data.renderId;
      const providerKey = res.data.providerKey;
      const POLL_INTERVAL_MS = 2000;
      const TIMEOUT_MS = 45000;
      const deadline = Date.now() + TIMEOUT_MS;

      const poll = async (): Promise<void> => {
        if (!this.state.tryOnPending) return; // cancelled (widget closed / new render started)
        if (Date.now() > deadline) {
          this.state.tryOnError = "Render timed out — try again.";
          this.state.tryOnPending = false;
          this.renderTryOn();
          this.renderCanvas();
          return;
        }
        const statusRes = await this.api.get<{
          status: string; imageUrl: string | null; latencyMs: number | null;
        }>("api/tryon/render/status", { renderId });

        if (!statusRes.ok) {
          // Non-fatal — keep polling (transient network hiccup).
          window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
          return;
        }

        if (statusRes.data.status === "SUCCEEDED" && statusRes.data.imageUrl) {
          this.state.tryOnImage = statusRes.data.imageUrl;
          this.state.tryOnProviderKey = providerKey;
          this.state.tryOnPending = false;
          this.state.tryOnError = null;
          this.renderTryOn();
          this.renderCanvas();
          return;
        }

        if (statusRes.data.status === "FAILED") {
          this.state.tryOnError = "Couldn't render — try again.";
          this.state.tryOnPending = false;
          this.renderTryOn();
          this.renderCanvas();
          return;
        }

        // Still PENDING — schedule next poll.
        window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
      };

      window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
    } catch {
      this.state.tryOnError = "Couldn't render — try again.";
      this.state.tryOnPending = false;
      this.renderTryOn();
      this.renderCanvas();
    }
  }

  /** Heuristic fit notes based on product category + selected size. Pure client-side. */
  private getFitAnnotation(): string {
    const sz = this.state.selectedSize;
    const product = this.state.product;
    if (!sz || !product) return '';
    const cat = (product.category ?? '').toLowerCase();
    const notes: string[] = [];
    if (cat.includes('jacket') || cat.includes('blazer') || cat.includes('coat')) {
      if (sz === 'XS' || sz === 'S')  notes.push('May run close through the shoulders');
      if (sz === 'L' || sz === 'XL' || sz === 'XXL') notes.push('Extra room through the torso');
    } else if (cat.includes('dress') || cat.includes('skirt')) {
      if (sz === 'XS' || sz === 'S')  notes.push('Fitted silhouette');
      if (sz === 'L' || sz === 'XL')  notes.push('Relaxed through the hips');
    } else if (cat.includes('jean') || cat.includes('trouser') || cat.includes('pant')) {
      if (sz === 'XS' || sz === 'S')  notes.push('Slim through the thigh');
      if (sz === 'L' || sz === 'XL')  notes.push('More room in the seat and thigh');
    }
    // If user submitted fit preference in step 2, it may be in sessionStorage.
    const fitPref = sessionStorage.getItem('stylique:fitPreference');
    if (fitPref === 'OVERSIZED' && (sz === 'L' || sz === 'XL')) notes.push('Aligns with your oversized preference');
    if (fitPref === 'FITTED' && (sz === 'XS' || sz === 'S'))    notes.push('Matches your fitted preference');
    if (notes.length === 0) return '';
    return `<div class="sq-fit-note mono">${notes.join(' · ')}</div>`;
  }

  /** Re-run VTO render with a size hint; caches result in sizeCompareResults. */
  private async runTryOnRenderForSize(size: string) {
    this.state.selectedSize = size;
    const product = this.state.product;
    const comboIds = this.state.pendingComboProductIds;
    const effectiveProductId = (comboIds && comboIds.length > 0) ? comboIds[0] : product?.id;
    if (!effectiveProductId || this.state.tryOnPending) return;

    const mode = this.state.experience === "photo" ? "PERSONAL_PHOTO" : "BODY_MODEL";

    this.state.tryOnPending = true;
    this.state.tryOnError = null;
    this.state.tryOnImage = null;
    this.renderTryOn();
    this.renderCanvas();

    try {
      const res = await this.api.post<{
        renderId: string; imageUrl: string; providerKey: string; latencyMs: number;
        status?: "PENDING" | "SUCCEEDED";
      }>(
        "api/tryon/render",
        {
          productId: effectiveProductId,
          mode,
          modelHint: mode === "BODY_MODEL" ? this.state.modelId : undefined,
          personImageDataUrl: mode === "PERSONAL_PHOTO" ? this.state.personPhotoDataUrl : undefined,
          sizeHint: size,
        },
      );

      if (!res.ok) {
        this.state.tryOnError = "Couldn't render this size — try again.";
        this.state.tryOnPending = false;
        this.renderTryOn();
        this.renderCanvas();
        return;
      }

      // Synchronous path.
      if (res.data.status !== "PENDING" && res.data.imageUrl) {
        this.state.sizeCompareResults[size] = res.data.imageUrl;
        this.state.tryOnImage = res.data.imageUrl;
        this.state.tryOnProviderKey = res.data.providerKey;
        this.state.tryOnPending = false;
        this.state.tryOnError = null;
        this.renderTryOn();
        this.renderCanvas();
        return;
      }

      // Async polling path.
      const renderId = res.data.renderId;
      const providerKey = res.data.providerKey;
      const POLL_INTERVAL_MS = 2000;
      const TIMEOUT_MS = 45000;
      const deadline = Date.now() + TIMEOUT_MS;

      const poll = async (): Promise<void> => {
        if (!this.state.tryOnPending) return;
        if (Date.now() > deadline) {
          this.state.tryOnError = "Render timed out — try again.";
          this.state.tryOnPending = false;
          this.renderTryOn();
          this.renderCanvas();
          return;
        }
        const statusRes = await this.api.get<{
          status: string; imageUrl: string | null; latencyMs: number | null;
        }>("api/tryon/render/status", { renderId });

        if (!statusRes.ok) {
          window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
          return;
        }

        if (statusRes.data.status === "SUCCEEDED" && statusRes.data.imageUrl) {
          this.state.sizeCompareResults[size] = statusRes.data.imageUrl;
          this.state.tryOnImage = statusRes.data.imageUrl;
          this.state.tryOnProviderKey = providerKey;
          this.state.tryOnPending = false;
          this.state.tryOnError = null;
          this.renderTryOn();
          this.renderCanvas();
          return;
        }

        if (statusRes.data.status === "FAILED") {
          this.state.tryOnError = "Couldn't render this size — try again.";
          this.state.tryOnPending = false;
          this.renderTryOn();
          this.renderCanvas();
          return;
        }

        window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
      };

      window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
    } catch {
      this.state.tryOnError = "Couldn't render this size — try again.";
      this.state.tryOnPending = false;
      this.renderTryOn();
      this.renderCanvas();
    }
  }

  private async pickPersonPhoto(file: File) {
    const showUploadError = (msg: string) => {
      this.state.tryOnError = msg;
      this.renderTryOn();
      // Also surface inline near the upload zone (re-query after renderTryOn re-paints).
      const uploadErr = this.bodyEl?.querySelector<HTMLElement>('.sq-upload__error');
      if (uploadErr) {
        uploadErr.textContent = msg;
        uploadErr.style.display = 'block';
      }
    };

    if (file.size > 6 * 1024 * 1024) {
      showUploadError("Photo too large — keep it under 6MB.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showUploadError("Use a JPEG, PNG or WebP photo.");
      return;
    }

    // Show a loading state on the upload zone while the file is being read.
    this.state.tryOnError = null;
    const uploadZone = this.bodyEl?.querySelector<HTMLElement>('.sq-upload');
    if (uploadZone) uploadZone.classList.add('sq-upload--loading');

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (uploadZone) uploadZone.classList.remove('sq-upload--loading');
      if (!dataUrl) return;
      this.state.personPhotoDataUrl = dataUrl;
      this.state.tryOnError = null;
      this.renderTryOn();
    };
    reader.onerror = () => {
      if (uploadZone) uploadZone.classList.remove('sq-upload--loading');
      showUploadError("Couldn't read the file — try again.");
    };
    reader.readAsDataURL(file);
  }

  // ─── Step rendering ───────────────────────────────────────────────────
  private renderStep() {
    if (!this.bodyEl) return;
    if (this.state.error) { this.bodyEl.innerHTML = `<div class="sq-error">${esc(this.state.error)}</div>`; return; }
    if (!this.state.product) { this.bodyEl.innerHTML = `<div class="sq-loading">Loading product…</div>`; return; }

    if (this.me?.brandMode === "beauty") {
      if (this.state.step === 1) void this.renderBeautyProfile();
      if (this.state.step === 2) void this.renderBeautyShadeMatch();
      if (this.state.step === 3) void this.renderBeautyRoutine();
      if (this.state.step === 4) void this.renderBeautyReplenishment();
    } else {
      if (this.state.step === 1) this.renderTryOn();
      if (this.state.step === 2) this.renderFit();
      if (this.state.step === 3) this.renderLook();
    }
  }

  // STEP 1 — Try It On (Use a Model / Upload My Photo)
  // D37 — tier 3 products (0–1 usable images) show a message and CTA to Fit.
  // Tier 2 (2–4 images) shows the full model grid but labels the render as
  // "Style Preview" and suppresses the photorealistic-mode badge.
  private renderTryOn() {
    const tier = this.state.product?.widgetTier ?? 1;

    // Tier 3 — no garment images worth rendering on.
    if (tier === 3) {
      this.bodyEl!.innerHTML = `
        <div class="sq-tryon-tier3">
          <div class="sq-h2 serif" style="margin-bottom:12px">Try-on not available</div>
          <p class="sq-sub">This product doesn't have enough quality garment images for visual try-on.</p>
          <p class="sq-sub" style="margin-top:6px">Find your size and complete the look instead — that's where the magic is.</p>
          <button class="sq-btn-primary" style="margin-top:20px" data-action="goto-fit">Find Your Fit →</button>
        </div>`;
      const btn = this.bodyEl!.querySelector<HTMLButtonElement>('[data-action="goto-fit"]');
      if (btn) btn.addEventListener("click", () => this.setStep(2));
      return;
    }

    // Upload-your-own-photo was removed (founder: muses only). Try-on is
    // model-only — `isModel` is locked true, the experience toggle is gone, and
    // the dead upload branch below never renders.
    const isModel = true;
    const personalAllowed = this.state.entitlement?.personalPhotoAllowed === true;
    this.bodyEl!.innerHTML = `
      <h2 class="sq-h2 serif">Try it on — <em>cinematically.</em></h2>
      <p class="sq-sub">Pick a styling muse closest to your build.</p>

      ${isModel ? `
        <div class="sq-eyebrow" style="margin:6px 0 8px">Stylique roster</div>
        <div class="sq-models">
          ${MODELS.map((m) => `
            <button class="sq-model" data-model="${esc(m.id)}" aria-pressed="${m.id === this.state.modelId}">
              ${m.id === this.state.modelId ? `<span class="sq-model__chip mono">Selected</span>` : ""}
              <div class="sq-model__name">${esc(m.name)}</div>
              <div class="sq-model__row">
                <span class="sq-model__tone" style="background:${esc(m.tone)}"></span>
                <span class="sq-model__meta">${esc(m.body)} · ${esc(m.height)} · ${esc(m.weight)}</span>
              </div>
              <div class="sq-model__note">${esc(m.fitNote)}</div>
            </button>`).join("")}
        </div>
      ` : `
        <div class="sq-upload${this.state.personPhotoDataUrl ? ' sq-upload--ready' : ''}">
          <div class="sq-upload__glow"></div>
          ${this.state.personPhotoDataUrl
            ? `<img class="sq-upload__preview" src="${esc(this.state.personPhotoDataUrl)}" alt="Your photo">`
            : `<div class="sq-upload__icon">⤴</div>`}
          <div class="sq-upload__title serif">${this.state.personPhotoDataUrl ? "Photo ready" : "Render the piece on you"}</div>
          ${this.state.personPhotoDataUrl
            ? `<div class="sq-upload__ready-badge mono">✓ Photo loaded</div>
               <div class="sq-upload__privacy mono">Privacy: sent once to render, never stored</div>`
            : `<div class="sq-upload__sub">${personalAllowed
                ? "JPEG, PNG or WebP. Under 6MB. Your photo is sent once to the renderer — we never store it."
                : "Personal photo try-on isn't enabled on this store yet. Body-model preview is always available."}</div>`}
          ${personalAllowed
            ? `<label class="sq-upload__pick mono">
                 <input type="file" accept="image/jpeg,image/png,image/webp" data-action="pick-photo" hidden>
                 ${this.state.personPhotoDataUrl ? "Change photo" : "Choose photo"}
               </label>`
            : `<div class="sq-upload__chip mono">Coming soon</div>`}
          <div class="sq-upload__error mono" style="display:none;color:#f87171;font-size:11px;margin-top:6px"></div>
        </div>
      `}

      ${this.state.tryOnError ? `<div class="sq-tryon-error mono">${esc(this.state.tryOnError)}</div>` : ""}

      ${tier === 2 && !this.state.tryOnImage && !this.state.tryOnPending
        ? `<div class="sq-tryon-tier2-note mono">Limited image quality · Style preview only</div>`
        : ""}

      <div class="sq-tryon-cta">
        <button class="${!isModel && !this.state.personPhotoDataUrl ? 'sq-render-btn sq-render-btn--secondary' : 'sq-render-btn'}"
                data-action="render-tryon"
                ${this.state.tryOnPending || (!isModel && !this.state.personPhotoDataUrl) ? "disabled" : ""}>
          ${this.state.tryOnPending
            ? "Rendering…"
            : isModel
              ? "Render on this muse"
              : (this.state.personPhotoDataUrl ? "Render on me" : "Upload a photo first →")}
        </button>
        ${this.state.tryOnImage ? `<div class="sq-render-meta mono">${esc(
            this.state.tryOnProviderKey === "replicate-idm-vton" ? "Photorealistic · Replicate" : "Style preview · Gemini Image",
          )}</div>` : ""}
      </div>

      ${this.state.tryOnImage && !this.state.tryOnPending && this.state.product?.sizes && this.state.product.sizes.length > 1 ? `
        <div class="sq-size-row" id="sq-size-row">
          <div class="sq-size-row__label mono">Try a size →</div>
          <div class="sq-size-row__chips" id="sq-size-chips">
            ${this.state.product.sizes.map(sz => `
              <button class="sq-size-chip ${sz === this.state.selectedSize ? 'sq-size-chip--active' : ''}"
                      data-action="try-size" data-size="${esc(sz)}">
                ${esc(sz)}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="sq-fit-annotation" id="sq-fit-note">
          ${this.getFitAnnotation()}
        </div>
      ` : ""}
    `;

    this.bodyEl!.querySelectorAll<HTMLButtonElement>(".sq-seg__btn").forEach((b) =>
      b.addEventListener("click", () => {
        this.state.experience = b.dataset.exp as "model" | "photo";
        this.track("WIDGET_EXPERIENCE_SELECTED", { experience: this.state.experience });
        if (this.state.experience === "photo") this.track("WIDGET_BODY_MODEL_SELECTED", { bodyType: "PHOTO" });
        this.renderTryOn();
      }));

    this.bodyEl!.querySelectorAll<HTMLButtonElement>(".sq-model").forEach((b) =>
      b.addEventListener("click", () => {
        this.state.modelId = b.dataset.model!;
        this.track("WIDGET_MODEL_SELECTED", { modelId: this.state.modelId });
        const bt = MODEL_TO_BODYTYPE[this.state.modelId];
        this.track("WIDGET_BODY_MODEL_SELECTED", { bodyType: bt });
        // Share with the stylist via ShopperSession — fire-and-forget.
        void this.signal({ kind: "body_type", bodyType: bt });
        // Picking a new muse invalidates the previous render.
        this.state.tryOnImage = null;
        this.state.tryOnProviderKey = null;
        this.renderTryOn();
        this.renderCanvas();
      }));

    // VTO — Render button + photo picker (Sprint 6 / D34).
    const renderBtn = this.bodyEl!.querySelector<HTMLButtonElement>('[data-action="render-tryon"]');
    if (renderBtn) renderBtn.addEventListener("click", () => { void this.runTryOnRender(); });
    const photoInput = this.bodyEl!.querySelector<HTMLInputElement>('[data-action="pick-photo"]');
    if (photoInput) photoInput.addEventListener("change", (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (file) void this.pickPersonPhoto(file);
    });

    // Size comparison chip clicks.
    this.bodyEl!.querySelectorAll<HTMLButtonElement>('[data-action="try-size"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const sz = btn.dataset.size ?? null;
        if (sz) {
          this.state.selectedSize = sz;
          if (this.state.sizeCompareResults[sz]) {
            this.state.tryOnImage = this.state.sizeCompareResults[sz];
            this.renderTryOn();
            this.renderCanvas();
          } else {
            void this.runTryOnRenderForSize(sz);
          }
        }
      });
    });
  }

  // STEP 2 — Find Your Fit
  private renderFit() {
    const f = this.state.fit;

    // Cross-surface bridge: if Mira (or a past Widget session) already saved
    // measurements + fit preference on the ShopperSession, pre-fill them here.
    // Done once per dock-open so subsequent edits inside the form stick.
    if (!this.state.fitPrefilled && this.me) {
      const m = this.me;
      if (typeof m.heightCm === "number" && m.heightCm > 0) this.state.heightCm = m.heightCm;
      if (typeof m.weightKg === "number" && m.weightKg > 0) this.state.weightKg = m.weightKg;
      if (m.fitPreference && ["FITTED","REGULAR","RELAXED","OVERSIZED","SLIM"].includes(m.fitPreference)) {
        this.state.fitPreference = m.fitPreference as typeof this.state.fitPreference;
      }
      if (typeof m.chestCm === "number" && m.chestCm > 0) this.state.chestCm = m.chestCm;
      if (typeof m.waistCm === "number" && m.waistCm > 0) this.state.waistCm = m.waistCm;
      if (typeof m.hipCm   === "number" && m.hipCm   > 0) this.state.hipCm   = m.hipCm;
      this.state.fitPrefilled = true;
    }
    const prefilledHint = this.state.fitPrefilled && this.me?.accountClaimed
      ? `<div class="sq-prefilled mono">Pulled from your saved profile — change anything that's changed.</div>`
      : "";

    this.bodyEl!.innerHTML = `
      <h2 class="sq-h2 serif">Find your <em>fit.</em></h2>
      <p class="sq-sub">Three quick inputs. We'll tell you the size that flatters, and what changes if you go up or down.</p>
      ${prefilledHint}

      <form class="sq-form" id="sq-fit-form" style="display:grid;gap:14px">
        <div class="sq-row2">
          <label class="sq-field"><span class="sq-field__label">Height (cm)</span>
            <input class="sq-input" type="number" name="heightCm" min="80" max="230" value="${this.state.heightCm}"></label>
          <label class="sq-field"><span class="sq-field__label">Weight (kg)</span>
            <input class="sq-input" type="number" name="weightKg" min="25" max="250" value="${this.state.weightKg}"></label>
        </div>

        <div>
          <span class="sq-field__label">Preferred fit</span>
          <div class="sq-fit-grid">
            ${(["FITTED", "REGULAR", "RELAXED", "OVERSIZED"] as const).map((p) =>
              `<button type="button" class="sq-seg__btn" data-fit="${p}" aria-selected="${p === this.state.fitPreference}">${p[0] + p.slice(1).toLowerCase()}</button>`).join("")}
          </div>
        </div>

        <details class="sq-measure-details">
          <summary class="sq-field__label" style="cursor:pointer;user-select:none">More precise fit (optional measurements)</summary>
          <div class="sq-row3" style="margin-top:10px">
            <label class="sq-field"><span class="sq-field__label">Chest (cm)</span>
              <input class="sq-input" type="number" name="chestCm" min="50" max="180" placeholder="e.g. 92" value="${this.state.chestCm > 0 ? this.state.chestCm : ""}"></label>
            <label class="sq-field"><span class="sq-field__label">Waist (cm)</span>
              <input class="sq-input" type="number" name="waistCm" min="40" max="160" placeholder="e.g. 76" value="${this.state.waistCm > 0 ? this.state.waistCm : ""}"></label>
            <label class="sq-field"><span class="sq-field__label">Hip (cm)</span>
              <input class="sq-input" type="number" name="hipCm" min="50" max="200" placeholder="e.g. 98" value="${this.state.hipCm > 0 ? this.state.hipCm : ""}"></label>
          </div>
        </details>

        <button type="submit" class="sq-btn-primary">Get my size</button>
      </form>

      <div id="sq-fit-result">${f ? this.fitResultHtml(f) : ""}</div>
    `;

    this.bodyEl!.querySelectorAll<HTMLButtonElement>("[data-fit]").forEach((b) =>
      b.addEventListener("click", () => {
        this.state.fitPreference = b.dataset.fit as typeof this.state.fitPreference;
        this.bodyEl!.querySelectorAll<HTMLButtonElement>("[data-fit]").forEach((x) =>
          x.setAttribute("aria-selected", String(x.dataset.fit === this.state.fitPreference)));
      }));

    (this.bodyEl!.querySelector("#sq-fit-form") as HTMLFormElement).addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const fd = new FormData(form);
      this.state.heightCm = Number(fd.get("heightCm"));
      this.state.weightKg = Number(fd.get("weightKg"));
      const rawChest = Number(fd.get("chestCm")); if (rawChest > 0) this.state.chestCm = rawChest;
      const rawWaist = Number(fd.get("waistCm")); if (rawWaist > 0) this.state.waistCm = rawWaist;
      const rawHip   = Number(fd.get("hipCm"));   if (rawHip   > 0) this.state.hipCm   = rawHip;
      const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
      submit.disabled = true; submit.textContent = "Reading your proportions…";
      const fitBody: Record<string, unknown> = {
        productId: this.state.product!.id,
        heightCm: this.state.heightCm, weightKg: this.state.weightKg,
        fitPreference: this.state.fitPreference,
        bodyType: MODEL_TO_BODYTYPE[this.state.modelId],
      };
      if (this.state.chestCm > 0) fitBody.chestCm = this.state.chestCm;
      if (this.state.waistCm > 0) fitBody.waistCm = this.state.waistCm;
      if (this.state.hipCm   > 0) fitBody.hipCm   = this.state.hipCm;
      const res = await this.api.post<Fit>("api/fit", fitBody);
      submit.disabled = false; submit.textContent = "Get my size";
      if (!res.ok) {
        (this.bodyEl!.querySelector("#sq-fit-result") as HTMLElement).innerHTML =
          `<div class="sq-error" style="margin-top:14px">Couldn't calculate size (${esc(res.error)}). Try again.</div>`;
        return;
      }
      this.state.fit = res.data;
      this.track("WIDGET_FIT_SUBMITTED", {
        heightCm: this.state.heightCm, weightKg: this.state.weightKg,
        fitPreference: this.state.fitPreference, bodyType: MODEL_TO_BODYTYPE[this.state.modelId],
        recommendedSize: res.data.recommendedSize, confidence: res.data.confidence,
      });
      // Persist so the stylist remembers next visit. SignalSchema accepts the
      // full FitPreference set now (A2, fixed Sprint 6 audit) — no more lossy
      // FITTED→SLIM / OVERSIZED→RELAXED mapping.
      void this.signal({ kind: "fit_preference", pref: this.state.fitPreference });
      void this.signal({ kind: "measurements", heightCm: this.state.heightCm, weightKg: this.state.weightKg });
      (this.bodyEl!.querySelector("#sq-fit-result") as HTMLElement).innerHTML = this.fitResultHtml(res.data);
    });
  }
  private fitZonesHtml(zones: Fit['fitZones']): string {
    if (!zones || Object.keys(zones).length === 0) return '';
    const zoneEmoji: Record<string, string> = {
      tight: '⚡ tight', snug: '• snug', fitted: '✓ fitted',
      comfortable: '✓ comfortable', roomy: '○ roomy', oversized: '○ oversized'
    };
    const zoneLabel: Record<string, string> = {
      chest: 'Chest', waist: 'Waist', hip: 'Hip', length: 'Length'
    };
    const entries = Object.entries(zones).filter(([, v]) => v);
    if (entries.length === 0) return '';
    return `<div class="sq-fit-zones">
      <div class="sq-fit-zones__label mono">How it fits you</div>
      <div class="sq-fit-zones__grid">
        ${entries.map(([zone, fit]) => `
          <div class="sq-fit-zone">
            <span class="sq-fit-zone__name">${zoneLabel[zone] ?? zone}</span>
            <span class="sq-fit-zone__val mono sq-fit-zone--${fit}">${zoneEmoji[fit ?? ''] ?? fit}</span>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  private fitResultHtml(f: Fit): string {
    const pct = Math.round(f.confidence * 100);
    return `<div class="sq-result">
      <div class="sq-result__row">
        <div class="sq-result__size serif">${esc(f.recommendedSize)}</div>
        <div class="sq-result__conf mono">${pct}% confidence</div>
      </div>
      <div class="sq-result__bar"><span style="width:${pct}%"></span></div>
      ${f.trustLine ? `<p class="sq-fit-trust">${esc(f.trustLine)}</p>` : ""}
      <div class="sq-result__why">${esc(f.rationale)}</div>
      <div class="sq-advice">
        ${f.sizeDownAdvice ? `<div class="sq-advice__cell"><b>Size down</b><br>${esc(f.sizeDownAdvice)}</div>` : ""}
        ${f.sizeUpAdvice   ? `<div class="sq-advice__cell"><b>Size up</b><br>${esc(f.sizeUpAdvice)}</div>` : ""}
      </div>
      ${this.fitZonesHtml(f.fitZones)}
    </div>`;
  }

  // STEP 3 — Complete The Look (cinematic AI → mood-driven outfit + colors)
  private async playCinemaAndLoadStyle() {
    const lines = [
      "Reading product shape",
      "Matching your fit profile",
      "Building your styled look",
      "Finding color harmony",
      "Styling with confidence",
    ];
    this.state.cinema = { active: true, lineIdx: 0 };
    this.renderCinema(lines);

    // Step lines forward, while the style API runs in parallel.
    const interval = window.setInterval(() => {
      if (!this.state.cinema) return;
      this.state.cinema.lineIdx = Math.min(lines.length - 1, this.state.cinema.lineIdx + 1);
      this.renderCinema(lines);
    }, 700);
    this.cinemaTimer = interval;

    const res = await this.api.post<StyleData>("api/style", { productId: this.state.product!.id });
    // Ensure cinematic minimum runtime (1.8s) so it feels like a moment, not a fetch.
    await new Promise((r) => setTimeout(r, 600));
    window.clearInterval(interval); this.cinemaTimer = null;
    if (res.ok) {
      this.state.style = res.data;
      this.track("WIDGET_STYLE_VIEWED", { anchorProductId: this.state.product!.id, itemCount: res.data.outfit.length });
    } else {
      this.state.error = `Couldn't build your look (${res.error}).`;
    }
    this.state.cinema = null;
    this.renderLook();
  }

  private renderCinema(lines: string[]) {
    if (!this.bodyEl || !this.state.cinema) return;
    const i = this.state.cinema.lineIdx;
    this.bodyEl.innerHTML = `
      <div class="sq-cinema">
        <div class="sq-cinema__glow"></div>
        <div class="sq-cinema__line serif" key="${i}"><em>${esc(lines[i])}</em></div>
        <div class="sq-cinema__steps">
          ${lines.map((_, k) => `<span class="sq-cinema__dot ${k <= i ? "is-active" : ""}"></span>`).join("")}
        </div>
      </div>`;
  }

  private renderLook() {
    if (!this.state.style) { this.bodyEl!.innerHTML = `<div class="sq-loading">Building your look…</div>`; return; }
    const mood = MOODS.find((m) => m.id === this.state.moodId) ?? MOODS[0];
    const s = this.state.style;

    // Pair mood swatches over the outfit roles — derived locally to give the
    // mood toggle visible impact even though backend pairings stay the same.
    const items = s.outfit;

    this.bodyEl!.innerHTML = `
      <h2 class="sq-h2 serif">Complete the <em>look.</em></h2>
      <p class="sq-sub">A stylist's pairing built around your piece — with color harmony you can actually wear.</p>

      <div class="sq-eyebrow" style="display:flex;justify-content:space-between;align-items:baseline">
        <span>Style mood</span>
        <span class="sq-score">Compatibility ${mood.score}</span>
      </div>
      <div class="sq-moods" style="margin-top:6px">
        ${MOODS.map((m) => `<button class="sq-mood" data-mood="${esc(m.id)}" aria-pressed="${m.id === mood.id}">${esc(m.label)}</button>`).join("")}
      </div>

      <div class="sq-palette">
        ${mood.swatches.map((sw) => `<span class="sq-palette__sw" style="background:${esc(sw)}"></span>`).join("")}
        <span class="sq-palette__why">${esc(mood.explanation)}</span>
      </div>

      ${items.length === 0
        ? `<div class="sq-empty" style="margin-top:14px">Not enough catalog data yet. Sync more products to enable the full styling layer.</div>`
        : `<div class="sq-look">
            ${items.map((it, i) => `
              <div class="sq-look__item">
                <div class="sq-look__sw" style="${it.product.imageUrl ? `background-image:url(${esc(it.product.imageUrl)})` : `background:${esc(mood.swatches[i % mood.swatches.length])}`}"></div>
                <div class="sq-look__body">
                  <div class="sq-look__role">${esc(it.role)}</div>
                  <div class="sq-look__name ${i === 0 ? "sq-look__anchor" : ""}">${esc(it.product.title)}</div>
                  <div class="sq-look__why">${esc(it.colorNote)}</div>
                </div>
              </div>`).join("")}
          </div>`}

      ${s.colorCombos.length ? `
        <h3 class="sq-h3 serif">Color combinations</h3>
        <div style="display:grid;gap:10px">
          ${s.colorCombos.slice(0, 3).map((c) => `
            <div class="sq-look__item">
              <div style="display:flex;gap:4px;flex-shrink:0">
                ${c.palette.slice(0, 4).map((h) => `<span class="sq-palette__sw" style="background:${esc(h)};width:24px;height:24px"></span>`).join("")}
              </div>
              <div class="sq-look__body">
                <div class="sq-look__name">${esc(c.name)}</div>
                <div class="sq-look__why">${esc(c.rationale)}</div>
              </div>
            </div>`).join("")}
        </div>` : ""}
    `;

    this.bodyEl!.querySelectorAll<HTMLButtonElement>(".sq-mood").forEach((b) =>
      b.addEventListener("click", () => {
        this.state.moodId = b.dataset.mood!;
        this.track("WIDGET_MOOD_SELECTED", { moodId: this.state.moodId });
        this.renderLook();
      }));
  }

  // ─── Beauty Mode Steps ────────────────────────────────────────────────
  //
  // When me.brandMode === "beauty", the 3-step flow renders these instead of
  // TryOn / Fit / Look. State is lazy-loaded per step.

  private async renderBeautyProfile() {
    if (!this.bodyEl) return;
    if (!this.state.beautyProfile) {
      this.bodyEl.innerHTML = `<div class="sq-loading">Loading your skin profile…</div>`;
      const res = await this.api.get<{
        skinType: string | null; concerns: string[]; skinDepth: string | null;
        undertone: string | null; skinHex: string | null; hasProfile: boolean;
      }>("api/beauty/profile");
      if (res.ok) this.state.beautyProfile = res.data;
    }
    const p = this.state.beautyProfile;
    const skinTypeOpts = ["oily", "dry", "combination", "normal", "sensitive"];
    const concernOpts = ["acne", "hyperpigmentation", "redness", "dryness", "oiliness", "texture", "fine_lines", "dark_circles", "pores", "sensitivity"];

    // Track the currently-selected skin hex within this render cycle.
    // Seed from saved profile so the picker reflects the server state on re-open.
    let selectedSkinHex: string | null = p?.skinHex ?? null;

    this.bodyEl.innerHTML = `
      <div class="sq-beauty-profile">
        <div class="sq-h2 serif" style="margin-bottom:4px">Your Skin Profile</div>
        <p class="sq-sub" style="margin-bottom:16px">
          ${p?.hasProfile ? "We've got you. Edit anytime." : "Tell us about your skin — Mira will personalise everything."}
        </p>

        <label class="sq-label" style="margin-bottom:10px">Closest match to your bare skin</label>
        <div class="sq-skin-swatches" id="sq-skin-swatches">
          ${SKIN_TONES.map(t => `
            <button class="sq-skin-swatch${selectedSkinHex === t.hex ? " sq-skin-swatch--selected" : ""}"
                    data-skin-hex="${esc(t.hex)}"
                    style="background:${esc(t.hex)}"
                    aria-label="${esc(t.family)} tone depth ${t.depth}"
                    title="${esc(t.family)} · depth ${t.depth}">
              ${selectedSkinHex === t.hex ? `<span class="sq-skin-swatch__check" aria-hidden="true">✓</span>` : ""}
            </button>`).join("")}
        </div>
        ${selectedSkinHex
          ? `<div class="sq-skin-selected-row" id="sq-skin-selected-row">
               <span class="sq-skin-selected-dot" style="background:${esc(selectedSkinHex)}"></span>
               <span class="sq-skin-selected-label mono">${esc(SKIN_TONES.find(t => t.hex === selectedSkinHex)?.family ?? "")} undertone selected</span>
             </div>`
          : `<div class="sq-skin-selected-row" id="sq-skin-selected-row" style="visibility:hidden">
               <span class="sq-skin-selected-dot"></span><span class="sq-skin-selected-label mono">—</span>
             </div>`}

        <label class="sq-label" style="margin-top:16px">Skin type</label>
        <div class="sq-chip-row" style="margin-bottom:14px">
          ${skinTypeOpts.map(t => `<button class="sq-chip${p?.skinType === t ? " sq-chip--on" : ""}" data-skin-type="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join("")}
        </div>
        <label class="sq-label">Top concerns <span style="color:var(--sq-muted,#888)">(pick up to 3)</span></label>
        <div class="sq-chip-row" style="margin-bottom:20px">
          ${concernOpts.map(c => `<button class="sq-chip${(p?.concerns ?? []).includes(c) ? " sq-chip--on" : ""}" data-concern="${c}">${c.replace(/_/g, " ")}</button>`).join("")}
        </div>
        <button class="sq-btn-primary sq-beauty-save" style="width:100%">Save &amp; Find Shades →</button>
      </div>`;

    // Swatch click — single select, toggle checkmark, update indicator row.
    this.bodyEl.querySelectorAll<HTMLButtonElement>("[data-skin-hex]").forEach(btn => {
      btn.addEventListener("click", () => {
        const hex = btn.dataset.skinHex ?? null;
        selectedSkinHex = hex;
        // Update all swatches in-place (no full re-render to avoid losing chip state).
        this.bodyEl!.querySelectorAll<HTMLButtonElement>("[data-skin-hex]").forEach(b => {
          const isNowSelected = b.dataset.skinHex === hex;
          b.classList.toggle("sq-skin-swatch--selected", isNowSelected);
          // Sync checkmark span inside each swatch.
          const existing = b.querySelector(".sq-skin-swatch__check");
          if (isNowSelected && !existing) {
            const chk = document.createElement("span");
            chk.className = "sq-skin-swatch__check";
            chk.setAttribute("aria-hidden", "true");
            chk.textContent = "✓";
            b.appendChild(chk);
          } else if (!isNowSelected && existing) {
            existing.remove();
          }
        });
        // Update indicator row.
        const row = this.bodyEl!.querySelector<HTMLElement>("#sq-skin-selected-row");
        if (row && hex) {
          const family = SKIN_TONES.find(t => t.hex === hex)?.family ?? "";
          row.style.visibility = "visible";
          const dot = row.querySelector<HTMLElement>(".sq-skin-selected-dot");
          const lbl = row.querySelector<HTMLElement>(".sq-skin-selected-label");
          if (dot) dot.style.background = hex;
          if (lbl) lbl.textContent = `${family} undertone selected`;
        }
      });
    });

    // Chip toggle — skin type (single select)
    this.bodyEl.querySelectorAll<HTMLButtonElement>("[data-skin-type]").forEach(btn => {
      btn.addEventListener("click", () => {
        this.bodyEl!.querySelectorAll("[data-skin-type]").forEach(b => b.classList.remove("sq-chip--on"));
        btn.classList.add("sq-chip--on");
      });
    });

    // Chip toggle — concerns (multi, max 3)
    this.bodyEl.querySelectorAll<HTMLButtonElement>("[data-concern]").forEach(btn => {
      btn.addEventListener("click", () => {
        const on = btn.classList.contains("sq-chip--on");
        const selected = this.bodyEl!.querySelectorAll("[data-concern].sq-chip--on");
        if (!on && selected.length >= 3) return;
        btn.classList.toggle("sq-chip--on");
      });
    });

    // Save + advance
    this.bodyEl.querySelector(".sq-beauty-save")?.addEventListener("click", async () => {
      const skinType = this.bodyEl!.querySelector<HTMLButtonElement>("[data-skin-type].sq-chip--on")?.dataset.skinType;
      const concerns = Array.from(this.bodyEl!.querySelectorAll<HTMLButtonElement>("[data-concern].sq-chip--on")).map(b => b.dataset.concern!);
      // skinHex from the swatch picker, falls back to whatever the server had.
      const skinHex = selectedSkinHex ?? p?.skinHex ?? null;
      if (!skinType && !concerns.length && !skinHex) { this.setStep(2); return; }
      const saveRes = await this.api.post<{ saved: Record<string, unknown> }>("api/beauty/profile", { skinType, concerns, skinHex });
      if (saveRes.ok) {
        this.state.beautyProfile = {
          skinType: skinType ?? p?.skinType ?? null,
          concerns,
          skinDepth: p?.skinDepth ?? null,
          undertone: p?.undertone ?? null,
          skinHex,
          hasProfile: true,
        };
        this.state.beautyShadeMatches = null; // invalidate cache
        this.state.beautyRoutine = null;
        this.track("BEAUTY_SKIN_PROFILE_CAPTURED", {
          skinType: skinType ?? p?.skinType ?? null,
          concerns,
          skinHex,
          undertone: p?.undertone ?? null,
        });
      }
      this.setStep(2);
    });
  }

  private async renderBeautyShadeMatch() {
    if (!this.bodyEl) return;
    if (!this.state.beautyShadeMatches) {
      this.bodyEl.innerHTML = `<div class="sq-loading">Finding your best shades…</div>`;
      const res = await this.api.post<{
        matches: Array<{ productId: string; handle: string; title: string; imageUrl: string | null; shadeMatches: Array<{ shadeName: string; variantId: string; confidence: number; reason: string }> }>;
        profile: { skinHex: string | null; undertone: string | null; depth: string | null };
      }>("api/beauty/shade-match", { category: "foundation", limit: 4 });
      if (res.ok) this.state.beautyShadeMatches = res.data.matches;
      else { this.bodyEl.innerHTML = `<div class="sq-error">Shade matching unavailable — add foundation products to your catalog.</div>`; return; }
    }

    const matches = this.state.beautyShadeMatches ?? [];
    this.bodyEl.innerHTML = `
      <div class="sq-beauty-shades">
        <div class="sq-h2 serif" style="margin-bottom:4px">Your Shade Matches</div>
        <p class="sq-sub" style="margin-bottom:16px">Matched by skin tone, depth, and undertone.</p>
        ${!matches.length ? `<p class="sq-sub">No foundation or concealer products found in this catalog yet.</p>` : matches.map(m => `
          <div class="sq-shade-card">
            ${m.imageUrl ? `<img src="${esc(m.imageUrl)}" style="width:52px;height:52px;border-radius:8px;object-fit:cover;flex-shrink:0" alt="${esc(m.title)}">` : ""}
            <div style="flex:1;min-width:0">
              <div class="sq-label" style="margin-bottom:2px">${esc(m.title)}</div>
              <div class="sq-chip-row" style="margin-bottom:0;flex-wrap:wrap;gap:4px">
                ${m.shadeMatches.slice(0, 3).map(s => `
                  <button class="sq-chip sq-shade-add" data-variant-id="${esc(s.variantId)}" data-handle="${esc(m.handle)}" title="${esc(s.reason)}">
                    ${esc(s.shadeName)} · ${Math.round(s.confidence * 100)}%
                  </button>`).join("")}
              </div>
            </div>
          </div>`).join("")}
        <button class="sq-btn-secondary" style="width:100%;margin-top:16px" data-action="build-routine">Build My Routine →</button>
      </div>`;

    // Add shade to cart
    this.bodyEl.querySelectorAll<HTMLButtonElement>(".sq-shade-add").forEach(btn => {
      btn.addEventListener("click", async () => {
        const variantId = btn.dataset.variantId;
        const handle = btn.dataset.handle;
        if (!variantId) return;
        btn.textContent = "Adding…";
        btn.disabled = true;
        try {
          await fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] }),
          });
          btn.textContent = "✓ Added";
          this.track("CART_CONFIRMED", { productHandle: handle, source: "beauty_shade_match" });
          document.dispatchEvent(new CustomEvent("cart:updated"));
        } catch { btn.textContent = "Error"; }
      });
    });

    this.bodyEl.querySelector("[data-action='build-routine']")?.addEventListener("click", () => this.setStep(3));
  }

  private async renderBeautyRoutine() {
    if (!this.bodyEl) return;
    if (!this.state.beautyRoutine) {
      this.bodyEl.innerHTML = `<div class="sq-loading">Building your routine…</div>`;
      const res = await this.api.post<{
        name: string; timeOfDay: string;
        steps: Array<{ step: string; handle: string; title: string; imageUrl: string | null; priceUsd: number | null; variantShopifyId: string | null; whyForYou: string; inStock: boolean }>;
        totalPriceUsd: number;
        shopifyVariantIds: string[];
      }>("api/beauty/routine", { timeOfDay: "both", maxProducts: 6 });
      if (res.ok) this.state.beautyRoutine = res.data;
      else { this.bodyEl.innerHTML = `<div class="sq-error">Build your skin profile first (Step 1).</div>`; return; }
    }

    const r = this.state.beautyRoutine!;
    this.bodyEl.innerHTML = `
      <div class="sq-beauty-routine">
        <div class="sq-h2 serif" style="margin-bottom:2px">${esc(r.name)}</div>
        <p class="sq-sub" style="margin-bottom:16px">Personalised for your skin — ${r.steps.length} products · $${r.totalPriceUsd.toFixed(2)} total</p>
        <div class="sq-routine-steps">
          ${r.steps.map(s => `
            <div class="sq-routine-step${!s.inStock ? " sq-routine-step--oos" : ""}">
              ${s.imageUrl ? `<img src="${esc(s.imageUrl)}" alt="${esc(s.title)}" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0">` : `<div style="width:44px;height:44px;border-radius:6px;background:rgba(255,255,255,0.06);flex-shrink:0"></div>`}
              <div style="flex:1;min-width:0">
                <div class="sq-label">${esc(s.title)} ${!s.inStock ? `<span style="color:#ef4444;font-size:10px">Out of stock</span>` : ""}</div>
                <div class="sq-sub" style="font-size:11px;line-height:1.4">${esc(s.whyForYou)}</div>
                ${s.priceUsd != null ? `<div style="font-size:11px;color:var(--sq-muted,#888);margin-top:2px">$${s.priceUsd.toFixed(2)}</div>` : ""}
              </div>
            </div>`).join("")}
        </div>
        <button class="sq-btn-primary sq-add-routine" style="width:100%;margin-top:16px" data-variant-ids="${esc(r.shopifyVariantIds.join(","))}">
          Add Routine to Cart ($${r.totalPriceUsd.toFixed(2)})
        </button>
        <p class="sq-sub" style="text-align:center;margin-top:8px;font-size:10px">
          ${r.steps.filter(s => s.inStock).length} of ${r.steps.length} products in stock
        </p>
      </div>`;

    // Add all routine products to cart
    this.bodyEl.querySelector<HTMLButtonElement>(".sq-add-routine")?.addEventListener("click", async btn => {
      const addBtn = this.bodyEl!.querySelector<HTMLButtonElement>(".sq-add-routine")!;
      const variantIds = r.shopifyVariantIds.filter(Boolean);
      if (!variantIds.length) return;
      addBtn.textContent = "Adding…";
      addBtn.disabled = true;
      try {
        await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: variantIds.map(id => ({ id: Number(id), quantity: 1 })) }),
        });
        addBtn.textContent = `✓ ${variantIds.length} items added to cart`;
        this.track("BEAUTY_ROUTINE_ADDED_TO_CART", { itemCount: variantIds.length, totalUsd: r.totalPriceUsd });
        document.dispatchEvent(new CustomEvent("cart:updated"));
      } catch { addBtn.textContent = "Error — try again"; addBtn.disabled = false; }
    });
  }

  private async renderBeautyReplenishment() {
    if (!this.bodyEl) return;
    if (!this.state.beautyReplenishment) {
      this.bodyEl.innerHTML = `<div class="sq-loading">Checking your restock list…</div>`;
      const res = await this.api.get<{
        items: Array<{ productId: string; handle: string; title: string; imageUrl: string | null; variantShopifyId: string | null; priceCents: number | null; urgency: "now" | "soon" | "later"; daysUntilDue: number }>;
        dueCount: number;
      }>("api/beauty/replenishment");
      if (res.ok) this.state.beautyReplenishment = res.data;
      else { this.bodyEl.innerHTML = `<div class="sq-error">Unable to load restock items.</div>`; return; }
    }

    const r = this.state.beautyReplenishment!;
    if (!r.items.length) {
      this.bodyEl.innerHTML = `
        <div style="padding:24px;text-align:center">
          <div style="font-size:32px;margin-bottom:12px">✓</div>
          <p class="sq-h2 serif" style="margin-bottom:8px">You&rsquo;re all stocked up</p>
          <p class="sq-sub">No products due for a refill yet. We&rsquo;ll remind you when it&rsquo;s time.</p>
        </div>`;
      return;
    }

    const urgencyLabel = (u: "now" | "soon" | "later") =>
      u === "now" ? `<span style="color:#f87171;font-size:10px;font-weight:700">OVERDUE</span>`
      : `<span style="color:#fb923c;font-size:10px;font-weight:700">DUE SOON</span>`;

    this.bodyEl.innerHTML = `
      <div class="sq-beauty-routine">
        <div class="sq-h2 serif" style="margin-bottom:2px">Time to Restock</div>
        <p class="sq-sub" style="margin-bottom:16px">${r.dueCount > 0 ? `${r.dueCount} product${r.dueCount > 1 ? "s" : ""} overdue` : `${r.items.length} product${r.items.length > 1 ? "s" : ""} coming up`}</p>
        <div class="sq-routine-steps">
          ${r.items.map(item => `
            <div class="sq-routine-step" data-variant-id="${esc(item.variantShopifyId ?? "")}">
              ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="${esc(item.title)}" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0">` : `<div style="width:44px;height:44px;border-radius:6px;background:rgba(255,255,255,0.06);flex-shrink:0"></div>`}
              <div style="flex:1;min-width:0">
                <div class="sq-label">${esc(item.title)}</div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                  ${urgencyLabel(item.urgency)}
                  <span class="sq-sub" style="font-size:11px">${item.urgency === "now" ? "Overdue" : `Due in ${item.daysUntilDue}d`}</span>
                </div>
                ${item.priceCents != null ? `<div style="font-size:11px;color:var(--sq-muted,#888);margin-top:2px">$${(item.priceCents / 100).toFixed(2)}</div>` : ""}
              </div>
              ${item.variantShopifyId ? `<button class="sq-btn-secondary sq-restock-one" style="flex-shrink:0;font-size:11px;padding:6px 10px" data-variant-id="${esc(item.variantShopifyId)}">Add</button>` : ""}
            </div>`).join("")}
        </div>
        ${r.items.some(i => i.variantShopifyId) ? `
        <button class="sq-btn-primary sq-restock-all" style="width:100%;margin-top:16px">
          Restock All (${r.items.filter(i => i.variantShopifyId).length} items)
        </button>` : ""}
      </div>`;

    // Single-item "Add" buttons
    this.bodyEl.querySelectorAll<HTMLButtonElement>(".sq-restock-one").forEach(btn => {
      btn.addEventListener("click", async () => {
        const variantId = btn.dataset.variantId;
        if (!variantId) return;
        btn.textContent = "…"; btn.disabled = true;
        try {
          await fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] }),
          });
          btn.textContent = "✓";
          document.dispatchEvent(new CustomEvent("cart:updated"));
        } catch { btn.textContent = "!"; btn.disabled = false; }
      });
    });

    // Restock all button
    this.bodyEl.querySelector<HTMLButtonElement>(".sq-restock-all")?.addEventListener("click", async btn => {
      const addBtn = this.bodyEl!.querySelector<HTMLButtonElement>(".sq-restock-all")!;
      const variantIds = r.items.map(i => i.variantShopifyId).filter(Boolean) as string[];
      if (!variantIds.length) return;
      addBtn.textContent = "Adding…"; addBtn.disabled = true;
      try {
        await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: variantIds.map(id => ({ id: Number(id), quantity: 1 })) }),
        });
        addBtn.textContent = `✓ ${variantIds.length} items added`;
        this.track("BEAUTY_RESTOCK_ALL", { itemCount: variantIds.length });
        document.dispatchEvent(new CustomEvent("cart:updated"));
      } catch { addBtn.textContent = "Error — try again"; addBtn.disabled = false; }
    });
  }

  // ─── Analytics ────────────────────────────────────────────────────────
  private track(name: string, payload: Record<string, unknown>) {
    const productId = this.state.product?.id;
    void this.api.post("api/events", { name, productId, payload }).catch(() => undefined);
  }

  // Fire-and-forget write to the shared ShopperSession (lib/session.server.ts).
  // We bypass the Api class because we need credentials: "include" so the
  // sq_shopper_id cookie round-trips.
  private async signal(body: unknown) {
    try {
      await fetch(`${this.settings.apiBase}/api/shopper/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
        keepalive: true,
      });
    } catch { /* swallow */ }
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────
if (!customElements.get("stylique-widget")) {
  customElements.define("stylique-widget", StyliqueWidget);
}
function autoMount() {
  if (document.querySelector("stylique-widget")) return;
  if (!/\/products\//.test(location.pathname)) return;
  const el = document.createElement("stylique-widget");
  el.setAttribute("data-placement", "floating");
  document.body.appendChild(el);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoMount);
} else {
  autoMount();
}
