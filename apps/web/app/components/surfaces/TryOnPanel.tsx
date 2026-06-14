"use client";

// Stylique Try-On Panel — v3 (MUSE-ONLY)
//   • Bottom-sheet modal, mobile-first.
//   • Step 0 — Choose your muse (hyperrealistic body models).
//   • Step 1 — Height + weight (type or nudge) → live brand-exact fit pick.
//   • Step 2 — Render on the chosen body, region-by-region fit map, size compare
//              with a real "try this size" re-render, and combined complete-the-look
//              (added pieces layer onto the SAME body — no restart).

import { Fragment, useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  completeLookFor, canAddToLook, products as catalog, recommendSizeForProduct, fitBreakdown, renderEaseOf, confidenceBreakdown, resolveAsset, ASSET_BASE,
  type Product, type FitPref, type SizeFit,
} from "../../lib/catalog";
import { addToCart, addOutfitToCart } from "../../lib/storefront-cart";

// Surface config (same as MiraWidget): the build-time backend origin — no
// module-load-ordering hazard (a runtime window read at module-init evaluated to
// "" before the entry set it → storefront try-on hit the shop domain).
const SQ_TRYON_API = ASSET_BASE;
function shopperApi(): string {
  if (typeof window === "undefined") return ASSET_BASE;
  const api = (window as unknown as { __sqApi?: unknown }).__sqApi;
  return typeof api === "string" ? api : ASSET_BASE;
}

// Loophole A — slot-aware worn outfit. Given an ordered worn list (focus first),
// keep only the pieces that genuinely combine into ONE outfit: a dress occupies
// the whole torso+legs, so a pant/skirt/top can NEVER join it; you wear at most
// one top, one bottom, one outer layer; accessories are unlimited. This is the
// hard guard that runs both when a piece is toggled into the look AND right
// before a render, so an invalid combination (founder: "never pair a pant with a
// gown") can never reach the renderer even if a stale candidate slips through.
function sanitizeWornSet(worn: Product[]): Product[] {
  const kept: Product[] = [];
  for (const p of worn) {
    // The focus (first item) is always kept; every other piece must pass the
    // incremental slot check against what's been kept so far.
    if (kept.length === 0 || canAddToLook(p, kept)) kept.push(p);
  }
  return kept;
}

// ── Curated muse cast (hyperrealistic, pre-rendered, consistent) ──────────────
// A FIXED diverse cast — not random AI humans regenerated per render. Each muse
// is one full-body studio frame shot to a single template (same pose, lighting,
// warm light-grey backdrop, sand-beige fitted wardrobe, identical framing) so
// only body shape, height and skin tone vary across the set. Stored once in
// /public/muses. Display-only — no facial data is gathered or analysed.
//
// SIZING NOTE (SIZE-1 — non-negotiable): try-on is MUSE-ONLY. The muse is the
// VISUAL avatar only; the SIZE + per-region fit map are a clean function of the
// shopper's OWN typed height + weight × this product's cut. The muse's body
// measurements NEVER enter the recommender (that silent override WAS the SIZE-1
// bug). `pref` is retained on the data but not read — fit preference is held
// neutral so the size is a clean function of (typed body × this product's cut).

type MuseBody = { bust: number; waist: number; hip: number };
type MuseGender = "f" | "m";

// Each muse is "trained" — she/he carries a real measurement identity (bust/chest,
// waist, hip in cm) that drives the size + per-region fit map in AVATAR mode (D54).
// Men use chest in the `bust` slot so the one fit engine reads both genders.
const MUSES = [
  { id: "petite",   label: "Petite",   gender: "f" as MuseGender, silhouette: "Minimal · petite",     hint: "5\'2\" · 52 kg",  img: "/muses/petite.png",   h: 158, w: 52,  pref: "snug"    as FitPref, body: { bust: 79,  waist: 64,  hip: 86  } as MuseBody },
  { id: "slim",     label: "Editorial",gender: "f" as MuseGender, silhouette: "Editorial · straight", hint: "5\'7\" · 62 kg",  img: "/muses/slim.png",     h: 170, w: 62,  pref: "true"    as FitPref, body: { bust: 84,  waist: 66,  hip: 90  } as MuseBody },
  { id: "athletic", label: "Athletic", gender: "f" as MuseGender, silhouette: "Sport · defined",      hint: "5\'8\" · 68 kg",  img: "/muses/athletic.png", h: 173, w: 68,  pref: "true"    as FitPref, body: { bust: 88,  waist: 70,  hip: 94  } as MuseBody },
  { id: "curve",    label: "Curve",    gender: "f" as MuseGender, silhouette: "Luxe · hourglass",     hint: "5\'5\" · 78 kg",  img: "/muses/curve.png",    h: 165, w: 78,  pref: "relaxed" as FitPref, body: { bust: 102, waist: 82,  hip: 110 } as MuseBody },
  { id: "tall",     label: "Tall",     gender: "f" as MuseGender, silhouette: "Runway · long-line",   hint: "5\'11\" · 65 kg", img: "/muses/tall.png",     h: 180, w: 65,  pref: "true"    as FitPref, body: { bust: 84,  waist: 65,  hip: 91  } as MuseBody },
  { id: "m-lean",     label: "Lean",     gender: "m" as MuseGender, silhouette: "Lean · slim",       hint: "5\'9\" · 65 kg",  img: "/muses/m-lean.png",     h: 175, w: 65,  pref: "true"    as FitPref, body: { bust: 92,  waist: 78,  hip: 94  } as MuseBody },
  { id: "m-athletic", label: "Athletic", gender: "m" as MuseGender, silhouette: "Sport · V-shape",   hint: "6\'0\" · 82 kg",  img: "/muses/m-athletic.png", h: 182, w: 82,  pref: "true"    as FitPref, body: { bust: 104, waist: 82,  hip: 99  } as MuseBody },
  { id: "m-broad",    label: "Broad",    gender: "m" as MuseGender, silhouette: "Solid · broad",     hint: "5\'10\" · 102 kg",img: "/muses/m-broad.png",    h: 178, w: 102, pref: "relaxed" as FitPref, body: { bust: 118, waist: 106, hip: 114 } as MuseBody },
] as const;

// The muse the shopper SEES should match the body the sizing math describes —
// otherwise the picture (a fixed-body model) and the size/ease bars (computed from
// the shopper's own height + weight) contradict each other. We DON'T feed the muse
// body into the recommender (that was the SIZE-1 regression); instead we pick the
// muse whose frame is NEAREST the shopper's, so the body on screen agrees with the
// numbers. Distance is over height + weight (BMI-aware), within the chosen gender.
function nearestMuseId(height: number, weight: number, gender: MuseGender): MuseId {
  const pool = MUSES.filter((m) => m.gender === gender);
  let best = pool[0];
  let bestD = Infinity;
  for (const m of pool) {
    // Normalise so neither axis dominates: ~25cm height ≈ ~30kg weight in spread.
    const dh = (m.h - height) / 25;
    const dw = (m.w - weight) / 30;
    const d = dh * dh + dw * dw;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best.id;
}

type MuseId = (typeof MUSES)[number]["id"];

// Viewport hook — drives the desktop-modal vs mobile-bottom-sheet split.
// Inline styles can't carry media queries, so we branch on a matchMedia signal.
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isDesktop;
}

const PHASES = ["Reading your frame", "Draping the piece", "Finishing your look"] as const;

// Vertical placement (% from top of a full-body frame) for each fit region.
const REGION_Y: Record<string, number> = { bust: 30, waist: 44, hip: 54, inseam: 78 };

// A stable signature for "what is currently composited" = the set of pieces +
// the size. The complete-the-look "Try the look on" button shows only when the
// shopper's current selection differs from what's actually been rendered, so
// tapping a piece SELECTS it (no render) and the explicit button renders the
// combined look. (Fix #3 — founder: "tap shouldn't auto-try-on")
const sigOf = (items: Product[], sz: string) =>
  items.map((p) => p.handle).sort().join("|") + "@" + sz;

// ── Brand-exact fit computation ───────────────────────────────────────────────

function computeFit(
  product: Product,
  heightCm: number,
  weightKg: number,
  _bodyType: MuseId | null,
  body?: MuseBody,
  age?: number,
  usualBrandSize?: string,
) {
  // The body that decides the size comes from the shopper's own typed numbers
  // (estimated from height+weight). An explicit `body` (exact bust/waist/hip)
  // wins when provided; otherwise we estimate. Fit preference stays neutral so
  // the size is a clean function of (body × this product's cut).
  const profile = body;
  const pref: FitPref = "true";
  const rec = recommendSizeForProduct(product, {
    heightCm, weightKg, fitPref: pref,
    bust: profile?.bust, waist: profile?.waist, hip: profile?.hip,
    age, usualBrandSize,
  });
  return {
    size: rec.size,
    confidence: rec.confidence,
    reasoning: rec.reasoning,
    alt: rec.alt,
    primaryLabel: rec.primaryLabel,
    bodyValue: rec.bodyValue,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

// The body Mira already captured this session (same key MiraWidget writes on
// `rememberBody`). Lets the fitting room reuse it instead of re-asking, and
// keeps the size it shows consistent with the size Mira already named.
type SavedBody = { heightCm: number; weightKg: number; age?: number; usualBrandSize?: string };
type StorefrontFitResult = {
  size: string;
  confidence: number;
  reasoning: string;
  alt: { size: string; note: string } | undefined;
  primaryLabel: string;
  bodyValue: number;
};

function readSavedBody(): SavedBody | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("mira_body_v1");
    if (!raw) return null;
    const b = JSON.parse(raw) as Partial<SavedBody>;
    if (typeof b?.heightCm === "number" && typeof b?.weightKg === "number") {
      return {
        heightCm: b.heightCm,
        weightKg: b.weightKg,
        age: typeof b.age === "number" ? b.age : undefined,
        usualBrandSize: typeof b.usualBrandSize === "string" ? b.usualBrandSize : undefined,
      };
    }
  } catch { /* ignore */ }
  return null;
}

export default function TryOnPanel({
  product: initialProduct,
  catalogProducts,
  trigger = "reco_card",
  onClose,
  onRenderComplete,
  onRenderFailed,
}: {
  product?: Product;
  catalogProducts?: Product[];
  trigger?: "pdp_button" | "mira_suggest" | "look_card" | "reco_card";
  onClose?: () => void;
  onRenderComplete?: (imageUrl: string) => void;
  onRenderFailed?: (errorCode: string) => void;
}) {
  const defaultProduct = catalog.find((p) => p.handle === "onyx-silk-slip") ?? catalog[0];
  const [currentProduct, setCurrentProduct] = useState<Product>(initialProduct ?? defaultProduct);

  // Reuse the body the shopper already gave Mira this session (mira_body_v1) so
  // the fitting room NEVER asks for height/weight again, and the size it shows
  // agrees with the size Mira already named. When a body is known we also SKIP
  // the size step entirely and open straight on model choice (founder: "when I
  // say try it on, why does it ask me my size again").
  const savedBody = useMemo(readSavedBody, []);
  // Open behaviour: a returning shopper (body already saved) skips straight to the
  // model picker — they've sized themselves before, the next step that matters is
  // choosing the avatar. A first-timer (no body) lands on Size first so the panel
  // never opens without the shopper having a frame on file.
  const [step,           setStep          ] = useState(savedBody ? 1 : 0);
  // NO auto-selection — the shopper MUST pick a muse before we proceed. Starts
  // null; the footer is gated until a choice is made.
  const [muse,           setMuse          ] = useState<MuseId | null>(null);
  // Women is the default cast; switching clears any muse whose gender no longer matches.
  const [gender,         setGender        ] = useState<MuseGender>("f");
  // Set when the shopper tries to advance without choosing — surfaces a prompt.
  const [chooseError,    setChooseError   ] = useState(false);
  const [height,         setHeight        ] = useState(savedBody?.heightCm ?? 168);
  const [weight,         setWeight        ] = useState(savedBody?.weightKg ?? 62);
  // BoldMatrix-style additional signals — optional, improve confidence score
  const [fitAge,         setFitAge        ] = useState<number>(savedBody?.age ?? 0);
  const [usualSize,      setUsualSize     ] = useState<string>(savedBody?.usualBrandSize ?? "none");
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderPhase,    setRenderPhase   ] = useState(0);
  // The real composited image (garment actually worn on the muse).
  // null + renderError → graceful fallback to the studio shot.
  const [renderedUrl,    setRenderedUrl   ] = useState<string | null>(null);
  const [renderError,    setRenderError   ] = useState(false);
  // P4 — when the abuse cap trips, the result step shows a "you've reached the
  // limit, try again in N s" message instead of the generic render error.
  const [rateInfo,       setRateInfo      ] = useState<number | null>(null);
  // Specific failure code (render_unavailable / quota_reached / timeout) so the
  // error overlay can tell the shopper the truth instead of one generic line.
  const [renderErrCode,  setRenderErrCode ] = useState<string | null>(null);
  // Pieces layered onto the SAME body alongside the primary product (demand l).
  const [lookItems,      setLookItems     ] = useState<Product[]>([]);
  // chosenSize = the size the CURRENT render was produced at (null → fitResult).
  // previewSize = a size the shopper TAPPED but hasn't committed to yet — it only
  // updates the fit map; the actual re-render waits for the explicit
  // "Try on this size →" button (founder: "tap previews, button re-renders").
  const [chosenSize,     setChosenSize    ] = useState<string | null>(null);
  const [previewSize,    setPreviewSize   ] = useState<string | null>(null);
  // Signature of the look + size that the CURRENT render was produced for. The
  // "Try the look on" button appears whenever the live selection diverges. (Fix #3)
  const [renderedSig,    setRenderedSig   ] = useState<string | null>(null);
  const [saved,          setSaved         ] = useState(false);
  // Monotonic token so a superseded in-flight render never overwrites a newer one.
  const renderToken = useRef(0);
  const renderStartedRef = useRef(false);
  const renderCompletedRef = useRef(false);
  const renderFailedRef = useRef(false);
  const cartAddedRef = useRef(false);
  const isDesktop = useIsDesktop();

  const emitStorefrontEvent = useCallback((
    name: "PDP_TRYON_CLICKED" | "TRYON_ABANDONED" | "CART_FROM_TRYON",
    product: Product,
    payload: Record<string, unknown>,
  ) => {
    if (!ASSET_BASE) return;
    const eventPayload = name === "CART_FROM_TRYON"
      ? { productId: product.productId, ...payload }
      : {
          productId: product.productId,
          productHandle: product.handle,
          trigger,
          ...payload,
        };
    void fetch(`${shopperApi()}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        productId: product.productId,
        payload: eventPayload,
      }),
    }).catch(() => {});
  }, [trigger]);

  useEffect(() => {
    const openedProduct = initialProduct;
    if (openedProduct && trigger === "pdp_button") {
      emitStorefrontEvent("PDP_TRYON_CLICKED", openedProduct, {});
    }
    return () => {
      if (
        openedProduct &&
        renderStartedRef.current &&
        !renderCompletedRef.current &&
        !renderFailedRef.current &&
        !cartAddedRef.current
      ) {
        emitStorefrontEvent("TRYON_ABANDONED", openedProduct, {});
      }
    };
  }, [initialProduct, trigger, emitStorefrontEvent]);

  const isRendering = renderProgress > 0 && renderProgress < 100;
  // null until the shopper picks one.
  const activeMuse  = muse ? (MUSES.find((m) => m.id === muse) ?? null) : null;
  // The muse whose frame best matches the shopper's typed height/weight — so the
  // body shown agrees with the size/ease the bars describe (no more contradiction).
  const bestMatchMuse = nearestMuseId(height, weight, gender);
  // Default the selection to that best match the moment we have a body and no muse
  // is chosen yet. The shopper can still override; switching gender re-defaults.
  useEffect(() => {
    if (!muse && height > 0 && weight > 0) {
      setMuse(bestMatchMuse);
    }
  }, [muse, height, weight, bestMatchMuse]);

  // Persist muse + body across PDP navigation (panel rec #20). A full page reload
  // remounts the widget, so without this the shopper re-picks their muse and
  // re-enters their measurements on every product. Size itself is per-product
  // (each piece is cut differently) so it correctly re-derives from the restored
  // body. sessionStorage survives same-tab navigation, clears on tab close.
  const tryonRestored = useRef(false);
  useEffect(() => {
    if (tryonRestored.current) return;
    tryonRestored.current = true;
    try {
      const raw = sessionStorage.getItem("mira_tryon_v1");
      if (!raw) return;
      const m = JSON.parse(raw) as { muse?: MuseId; gender?: MuseGender; height?: number; weight?: number };
      if (m.gender) setGender(m.gender);
      if (typeof m.height === "number" && m.height > 0) setHeight(m.height);
      if (typeof m.weight === "number" && m.weight > 0) setWeight(m.weight);
      if (m.muse) setMuse(m.muse);
    } catch { /* read-only / corrupt — fine */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem("mira_tryon_v1", JSON.stringify({ muse, gender, height, weight })); }
    catch { /* quota / read-only — fine */ }
  }, [muse, gender, height, weight]);
  // SIZE-1 (non-negotiable): the SIZE is a clean function of the shopper's OWN
  // height + weight × this product's cut. The muse is the VISUAL avatar only —
  // her measurements NEVER enter the recommender (that was the SIZE-1 bug: the
  // muse silently overriding typed input so the numbers did nothing). So fitBody
  // is always undefined; the size is estimated from the typed height/weight, and
  // two muses with the same typed body give the same size — the picture changes,
  // the recommendation does not.
  const fitBody = undefined;
  const fitH    = height;
  const fitW    = weight;
  const localFitResult = computeFit(currentProduct, fitH, fitW, muse, fitBody, fitAge > 0 ? fitAge : undefined, usualSize !== "none" ? usualSize : undefined);
  const [storefrontFit, setStorefrontFit] = useState<StorefrontFitResult | null>(null);
  const [fitPending, setFitPending] = useState(Boolean(ASSET_BASE));
  const [fitError, setFitError] = useState<string | null>(null);

  // The installed widget must use the tenant-scoped fit service as its sizing
  // authority. Local chart math remains available only to the standalone demo.
  useEffect(() => {
    if (!ASSET_BASE) return;
    const productId = currentProduct.productId;
    setStorefrontFit(null);
    setFitError(null);
    if (!productId) {
      // No tenant fit row yet → fall back to the on-device estimate (computeFit
      // from height/weight + category; fitResult already === localFitResult when
      // storefrontFit is null). NEVER show a null / "not synced" state.
      setFitPending(false);
      return;
    }

    const controller = new AbortController();
    setFitPending(true);
    const timer = window.setTimeout(() => {
      void fetch(`${shopperApi()}/api/fit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          productId,
          heightCm: Math.round(height),
          weightKg: Math.round(weight),
          fitPreference: "REGULAR",
        }),
      })
        .then(async (res) => {
          const payload = (await res.json().catch(() => null)) as {
            ok?: boolean;
            error?: string;
            data?: {
              recommendedSize?: string;
              confidence?: number;
              rationale?: string;
              trustLine?: string;
              alternativeSize?: string;
              sizeUpAdvice?: string;
            };
          } | null;
          if (!res.ok || !payload?.ok || !payload.data?.recommendedSize) {
            throw new Error(payload?.error ?? "fit_unavailable");
          }
          const data = payload.data;
          const recommendedSize = data.recommendedSize!;
          setStorefrontFit({
            size: recommendedSize,
            confidence: Math.round((data.confidence ?? 0) * 100),
            reasoning: data.rationale ?? data.trustLine ?? "Matched against this product's available sizes.",
            alt: data.alternativeSize
              ? { size: data.alternativeSize, note: data.sizeUpAdvice ?? `Try ${data.alternativeSize} for more room.` }
              : undefined,
            primaryLabel: "Verified fit",
            bodyValue: 0,
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          // Service unavailable / product not synced → silently fall back to the
          // on-device estimate (fitResult === localFitResult when storefrontFit is
          // null). NEVER surface a null / "unavailable" / "not synced" state — the
          // shopper always gets a real size from their measurements + the category.
        })
        .finally(() => {
          if (!controller.signal.aborted) setFitPending(false);
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentProduct.productId, height, weight]);

  const fitResult = ASSET_BASE && storefrontFit ? storefrontFit : localFitResult;
  const fitReady = !ASSET_BASE || Boolean(storefrontFit);
  // Persist age + usualBrandSize into the shared body store whenever they change
  // so Mira and the sizing engine both see the most-complete profile next session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("mira_body_v1");
      const existing = raw ? (JSON.parse(raw) as SavedBody) : { heightCm: height, weightKg: weight };
      const updated: SavedBody = {
        ...existing,
        age: fitAge > 0 ? fitAge : undefined,
        usualBrandSize: usualSize !== "none" ? usualSize : undefined,
      };
      window.localStorage.setItem("mira_body_v1", JSON.stringify(updated));
    } catch { /* quota / SSR */ }
  }, [fitAge, usualSize, height, weight]);
  // Complete-the-look is SLOT-AWARE and DYNAMIC (founder P3a/b/c): it suggests only
  // pieces that genuinely complete what's currently worn (no camisole-with-a-gown,
  // no two jackets) and RE-RANKS every time a piece is added/removed — so adding a
  // top surfaces trousers, adding trousers surfaces a coat, never the same stale list.
  const recommendationCatalog = catalogProducts ?? (ASSET_BASE ? [currentProduct, ...lookItems] : catalog);
  const outfit = completeLookFor(
    [currentProduct, ...lookItems],
    recommendationCatalog,
  ).map((e) => e.product);
  // The body the garment is composited onto — the chosen muse.
  // null → nothing chosen yet (gates the flow).
  const bodyImg     = activeMuse?.img ? resolveAsset(activeMuse.img) : null;
  // Has the shopper picked a muse?
  const hasSelection = !!muse;

  // Reset only when a genuinely different product opens the panel from outside.
  useEffect(() => {
    if (initialProduct) {
      setCurrentProduct(initialProduct);
      setLookItems([]);
      setChosenSize(null);
      setPreviewSize(null);
      setRenderedUrl(null);
      setRenderError(false);
    }
  }, [initialProduct?.handle]);

  // The effective size: whatever the shopper chose on the result step, else the
  // recommendation. The complete-the-look footer + filmstrip read this. (B7)
  const effectiveSize = chosenSize ?? fitResult.size;

  // REAL add-to-cart (P0). On a live Shopify storefront this resolves the variant
  // for the chosen size and POSTs to /cart/add.js; on the demo it's a simulated
  // success. Focus piece adds at the selected size; look pieces add at their own
  // best-available variant. Closes the panel on success so the shopper lands on
  // the (now non-empty) cart.
  const [adding, setAdding] = useState(false);
  const addOneToBag = useCallback(async () => {
    setAdding(true);
    try {
      const result = await addToCart(currentProduct.handle, effectiveSize);
      if (!result.ok) {
        setRenderErrCode(result.error ?? "cart_failed");
        return;
      }
      cartAddedRef.current = true;
      emitStorefrontEvent("CART_FROM_TRYON", currentProduct, {
        renderId: undefined,
      });
      onClose?.();
    } finally {
      setAdding(false);
    }
  }, [currentProduct, effectiveSize, emitStorefrontEvent, onClose]);
  const addLookToBag = useCallback(async () => {
    setAdding(true);
    const pieces = [
      { handle: currentProduct.handle, size: effectiveSize },
      ...lookItems.map((p) => ({ handle: p.handle, size: null as string | null })),
    ];
    try {
      const result = await addOutfitToCart(pieces);
      if (!result.ok) {
        setRenderErrCode(result.error ?? "cart_failed");
        return;
      }
      cartAddedRef.current = true;
      emitStorefrontEvent("CART_FROM_TRYON", currentProduct, {
        comboName: `${pieces.length}-piece look`,
      });
      onClose?.();
    } finally {
      setAdding(false);
    }
  }, [currentProduct, effectiveSize, lookItems, emitStorefrontEvent, onClose]);

  // SIZE-1: the muse is the picture, NOT the body. Picking a muse must NEVER
  // overwrite the shopper's typed height/weight (that silent autofill was the
  // SIZE-1 bug — it erased what the shopper entered, so 210cm/143kg and
  // 200cm/35kg both showed the muse's size). The shopper's typed numbers are the
  // sole size driver; switching muse only changes the avatar shown.

  // Cosmetic progress crawl. It asymptotes to 92% and WAITS there for the real
  // fetch to land; runRender pushes it to 100 when the composite is back, and
  // this effect then advances to the result step. So the animation length tracks
  // the actual render time instead of a fake fixed timer.
  useEffect(() => {
    if (renderProgress <= 0) return;
    if (renderProgress >= 100) {
      const t = window.setTimeout(() => { setRenderPhase(3); setStep(2); setRenderProgress(0); }, 280);
      return () => clearTimeout(t);
    }
    const t = window.setInterval(() => {
      setRenderProgress((p) => {
        // Move briskly to ~85, then keep creeping slowly toward 99 so the bar
        // NEVER looks frozen while the network finishes (founder: "it gets stuck
        // on 92"). runRender slams it to 100 the instant the composite lands.
        if (p >= 99) return p;
        const next = p < 85
          ? Math.min(85, p + 3 + Math.random() * 5)
          : Math.min(99, p + 0.5 + Math.random() * 0.4);
        if (next >= 30 && renderPhase < 1) setRenderPhase(1);
        if (next >= 70 && renderPhase < 2) setRenderPhase(2);
        return next;
      });
    }, 200);
    return () => clearInterval(t);
  }, [renderProgress, renderPhase]);

  // The real compositing call. `garments[0]` is the focus piece; the rest layer
  // on as a combined look. The muse render hits the disk-cached static render.
  const runRender = useCallback(
    async (garmentsIn: Product[], sizeForRender: string) => {
      // Fix #1 — never proceed without an explicit muse choice. Otherwise bail
      // back to the model step and surface the "choose a model" prompt instead of
      // silently auto-selecting one.
      if (!activeMuse) {
        // No model picked — bounce back to the model step (now step 1).
        setChooseError(true);
        setStep(1);
        return;
      }

      // Loophole A — final slot guard. Strip any piece that can't share the body
      // with the focus (a pant onto a gown, a second bottom, a second top) so an
      // impossible outfit never reaches Gemini. The focus is always preserved.
      const garments = sanitizeWornSet(garmentsIn);

      const token = ++renderToken.current;
      renderStartedRef.current = true;
      renderCompletedRef.current = false;
      renderFailedRef.current = false;
      setRenderError(false);
      setRateInfo(null);
      setRenderErrCode(null);
      setRenderPhase(0);
      setRenderProgress(2);

      // SIZE-1: the size + ease that drive the render come from the shopper's OWN
      // typed height/weight × this product's cut — the muse body never enters
      // (it's the picture, not the body). So the rendered tightness/looseness is
      // the shopper's true fit, identical across muses for the same typed body.
      const rH = height;
      const rW = weight;
      const rBody = undefined;

      const focus = garments[0];
      const recSize = ASSET_BASE && focus.handle === currentProduct.handle
        ? fitResult.size
        : computeFit(focus, rH, rW, muse, rBody).size;
      // Map the focus product's category to a fit axis the render understands
      // (top/bottom/dress/outerwear) so the size change reads on the right body
      // region. knitwear falls back to "top"; ACCESSORIES (belts/bags/sunglasses/
      // jewelry) carry their own "accessory" kind so the render ADDS them in their
      // natural place instead of sizing them as a garment (founder #11).
      const garmentKind =
        focus.category === "bottom" ? "bottom"
        : focus.category === "dress" ? "dress"
        : focus.category === "outerwear" ? "outerwear"
        : focus.category === "accessory" ? "accessory"
        : "top";
      const garmentImages = garments.map((g) => g.images[0]).filter(Boolean);
      // The HONEST size signal: the real per-body ease (signed cm) and tightness
      // (−1..+1) of THIS size on THIS shopper, from the brand-exact size map. The
      // render uses these concrete numbers so S/M/L look genuinely different and
      // the true fit (tight = pulling, loose = voluminous) is never hidden.
      const fitForRender = fitBreakdown(focus, sizeForRender, rH, rW, rBody);
      // Drive the render off the BINDING region, not the average: a size that's
      // tight at the waist but roomy at the hip must still render TIGHT (the waist
      // pulls). Averaging masked this and made size-down look "true". (founder:
      // "when they reduce size it turns into a tighter article and let them see it")
      const { easeCm, tightness, bindLabel } = renderEaseOf(fitForRender);
      // Per-piece fit for a COMBINED look: EACH garment carries its own size +
      // ease so the render shows the pant at the pant's size and the top at the
      // top's — not one global size applied to everything. The focus piece uses
      // the explicitly-selected sizeForRender; every other piece uses its own
      // body-matched recommended size. (Founder D: "it did not change the pant
      // size as well.")
      const kindOf = (p: Product) =>
        p.category === "bottom" ? "bottom"
        : p.category === "dress" ? "dress"
        : p.category === "outerwear" ? "outerwear"
        : p.category === "accessory" ? "accessory"
        : "top";
      const garmentFits = garments.map((g) => {
        const pieceSize = g.handle === focus.handle ? sizeForRender : computeFit(g, rH, rW, muse, rBody).size;
        const pieceEase = renderEaseOf(fitBreakdown(g, pieceSize, rH, rW, rBody));
        return {
          name: g.name,
          kind: kindOf(g),
          size: pieceSize,
          easeCm: pieceEase.easeCm,
          bindLabel: pieceEase.bindLabel ?? undefined,
        };
      });
      // Remember exactly what this render represents so the complete-the-look
      // "Try the look on" button can tell when the live selection has diverged.
      setRenderedSig(sigOf(garments, sizeForRender));

      // Per-brand cache partition (founder fix). On the real storefront the
      // widget bundle sets `window.Shopify.shop` (e.g. "stylee.myshopify.com");
      // on the demo `__sqShopSlug` may be set explicitly. Otherwise we send no
      // slug and the server uses a sentinel — preserves demo behaviour.
      const shopSlug = (() => {
        if (typeof window === "undefined") return undefined;
        const w = window as unknown as Record<string, unknown>;
        const explicit = typeof w.__sqShopSlug === "string" ? (w.__sqShopSlug as string) : null;
        const shopify = (w.Shopify as { shop?: string } | undefined)?.shop;
        return explicit ?? shopify ?? undefined;
      })();

      const body = {
        mode: "muse" as const,
        museId: muse!,
        museImage: activeMuse.img,
        garmentImages,
        size: sizeForRender,
        recommendedSize: recSize,
        garmentKind,
        handle: focus.handle,
        easeCm,
        tightness,
        bindLabel,
        garmentFits: garmentFits.length > 1 ? garmentFits : undefined,
        shopSlug,
      };

      try {
        const productionIds = garments
          .map((g) => g.productId)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (ASSET_BASE && productionIds.length !== garments.length) {
          setRenderedUrl(null);
          setRenderErrCode("product_not_synced");
          setRenderError(true);
          onRenderFailed?.("product_not_synced");
          return;
        }

        const productionBody = productionIds.length > 1
          ? {
              productIds: productionIds,
              mode: "BODY_MODEL" as const,
              modelHint: muse!,
              selectedSize: sizeForRender,
              bodyProfile: `${Math.round(rH)}:${Math.round(rW)}`,
            }
          : {
              productId: productionIds[0],
              mode: "BODY_MODEL" as const,
              modelHint: muse!,
              selectedSize: sizeForRender,
              bodyProfile: `${Math.round(rH)}:${Math.round(rW)}`,
            };
        const res = await fetch(
          ASSET_BASE ? `${shopperApi()}/api/tryon/render` : `${SQ_TRYON_API}/api/tryon`,
          {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ASSET_BASE ? productionBody : body),
          },
        );
        if (token !== renderToken.current) return; // superseded
        if (res.status === 429) {
          const info = (await res.json().catch(() => ({}))) as { retryAfterSec?: number };
          if (token !== renderToken.current) return;
          setRenderedUrl(null);
          setRateInfo(info.retryAfterSec ?? 60);
          setRenderError(true);
          return;
        }
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          if (token !== renderToken.current) return;
          setRenderedUrl(null);
          setRenderErrCode(j.error ?? (res.status >= 500 ? "render_unavailable" : "render_failed"));
          setRenderError(true);
          return;
        }
        const payload = (await res.json()) as {
          ok?: boolean;
          error?: string;
          data?: {
            renderId?: string;
            imageUrl?: string;
            status?: "PENDING" | "SUCCEEDED";
          };
          imageUrl?: string;
        };
        if (token !== renderToken.current) return;
        if (ASSET_BASE && !payload.ok) {
          const error = payload.error ?? "render_failed";
          setRenderedUrl(null);
          setRenderErrCode(error);
          setRenderError(true);
          onRenderFailed?.(error);
          return;
        }

        let raw = ASSET_BASE ? (payload.data?.imageUrl ?? null) : (payload.imageUrl ?? null);
        if (ASSET_BASE && payload.data?.status === "PENDING" && payload.data.renderId) {
          const renderId = payload.data.renderId;
          const deadline = Date.now() + 70_000;
          while (Date.now() < deadline && token === renderToken.current) {
            await new Promise((resolve) => window.setTimeout(resolve, 1_000));
            const statusRes = await fetch(
              `${shopperApi()}/api/tryon/render/status?renderId=${encodeURIComponent(renderId)}`,
              { cache: "no-store" },
            );
            const statusPayload = (await statusRes.json().catch(() => null)) as {
              ok?: boolean;
              data?: { status?: string; imageUrl?: string | null };
            } | null;
            if (!statusRes.ok || !statusPayload?.ok) continue;
            if (statusPayload.data?.status === "SUCCEEDED") {
              raw = statusPayload.data.imageUrl ?? null;
              break;
            }
            if (statusPayload.data?.status === "FAILED") {
              throw new Error("render_failed");
            }
          }
          if (!raw) throw new Error("timeout");
        }

        // The render URL is served by the backend, not the storefront — a
        // relative "/api/tryon/image/<key>" must be prefixed with the backend
        // origin or it 404s against the shop domain.
        const abs = raw && raw.startsWith("/") ? `${SQ_TRYON_API}${raw}` : raw; // backend-origin prefix
        setRenderedUrl(abs);
        setRenderError(!abs);
        if (abs) {
          renderCompletedRef.current = true;
          onRenderComplete?.(abs);
        }
      } catch (err) {
        if (token !== renderToken.current) return;
        setRenderedUrl(null);
        const code = err instanceof Error && err.message === "render_failed" ? "render_failed" : "timeout";
        setRenderErrCode(code);
        setRenderError(true); // StepResult shows an explicit error + retry
        renderFailedRef.current = true;
        onRenderFailed?.(code);
      } finally {
        if (token === renderToken.current) setRenderProgress(100);
      }
    },
    [height, weight, muse, activeMuse, currentProduct.handle, fitResult.size, onRenderComplete, onRenderFailed],
  );

  // "Generate my look" / re-render the current focus + look at the active size.
  const startRender = () => { runRender([currentProduct, ...lookItems], effectiveSize); };

  // The live selection signature (focus + look + size) vs what's actually been
  // rendered. When they diverge, the result step shows a "Try the look on" button.
  const currentSig = sigOf([currentProduct, ...lookItems], effectiveSize);
  const lookDirty = currentSig !== renderedSig;

  // Tap a size pill → PREVIEW only (updates the fit map). The render waits for the
  // explicit "Try on this size →" button. (founder: "tap previews, button re-renders")
  const previewSizeTap = (sz: string) => {
    setPreviewSize(sz === effectiveSize ? null : sz);
  };

  // The explicit button → commit the previewed size and actually RE-RUN the render.
  const tryThisSize = () => {
    const sz = previewSize;
    if (!sz || sz === effectiveSize) return;
    setChosenSize(sz);
    setPreviewSize(null);
    runRender([currentProduct, ...lookItems], sz);
  };

  // Tap a "complete the look" piece → TOGGLE it into the look. This is SELECTION
  // ONLY — it does NOT render (Fix #3 — founder: "when you click it, it
  // automatically just tries those on. No."). The explicit "Try the look on"
  // button does the combined render. Tapping an already-selected piece removes it.
  const toggleLookPiece = (p: Product) => {
    if (p.handle === currentProduct.handle) return;
    setLookItems((prev) => {
      // Removing an already-selected piece is always allowed.
      if (prev.some((x) => x.handle === p.handle)) {
        return prev.filter((x) => x.handle !== p.handle);
      }
      // Adding: only if it slots onto the current worn set (Loophole A). The rail
      // is already filtered by completeLookFor, but this guards against a stale
      // candidate (e.g. a piece that became invalid after another addition).
      if (!canAddToLook(p, [currentProduct, ...prev])) return prev;
      return [...prev, p];
    });
  };

  // Bring an already-tried piece back into focus (shown big). Selection only —
  // no render; the look signature goes dirty so the "Try the look on" button
  // reappears for the shopper to confirm.
  const focusPiece = (p: Product) => {
    if (p.handle === currentProduct.handle) return;
    const without = lookItems.filter((x) => x.handle !== p.handle);
    const hasOutgoing = without.some((x) => x.handle === currentProduct.handle);
    const nextLook = hasOutgoing ? without : [...without, currentProduct];
    setLookItems(nextLook);
    setCurrentProduct(p);
    setChosenSize(null);
    setPreviewSize(null);
  };

  // The explicit combined render — composites the focus + every selected look
  // piece onto the SAME body at the active size, in one call.
  const tryTheLook = () => { runRender([currentProduct, ...lookItems], effectiveSize); };

  const removeLookItem = (handle: string) =>
    setLookItems((prev) => prev.filter((x) => x.handle !== handle));

  // The whole outfit being built = the focus piece + every other tried piece.
  const outfitCount = lookItems.length + 1;

  return (
    <div
      // Accessibility (panel P0): Escape closes, Escape/Tab trapped inside
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose?.(); } }}
      style={{
        // Sit above EVERYTHING — the site header (z80) and the Mira launcher
        // (z90) must not bleed through the fitting-room takeover.
        position: "fixed", inset: 0, zIndex: 2147483000,
        isolation: "isolate",
        background: "rgba(8,7,10,0.88)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        display: "flex",
        alignItems: isDesktop ? "center" : "flex-end",
        justifyContent: "center",
        padding: isDesktop ? "40px" : 0,
        animation: "sqOverlayIn 280ms cubic-bezier(.2,.8,.2,1)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Virtual Try-On fitting room"
        onClick={(e) => e.stopPropagation()}
        ref={(el) => {
          // Focus trap: on mount focus first focusable element; on Tab/Shift-Tab
          // cycle within the dialog (WCAG SC 2.1.2).
          if (!el) return;
          const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';
          const trap = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;
            const els = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (!els.length) return;
            const first = els[0], last = els[els.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          };
          el.addEventListener("keydown", trap);
          // Focus first focusable element when the panel opens.
          const first = el.querySelector<HTMLElement>(FOCUSABLE);
          first?.focus();
          // Cleanup stored on element.
          (el as HTMLElement & { __trapCleanup?: () => void }).__trapCleanup?.();
          (el as HTMLElement & { __trapCleanup?: () => void }).__trapCleanup = () => el.removeEventListener("keydown", trap);
        }}
        style={{
          width: isDesktop ? "min(1120px, 100%)" : "min(480px, 100%)",
          height: isDesktop ? "min(720px, calc(100vh - 80px))" : "92dvh",
          maxHeight: isDesktop ? "calc(100vh - 80px)" : "94dvh",
          background: "#12101A",
          borderRadius: isDesktop ? "22px" : "22px 22px 0 0",
          border: "1px solid rgba(255,255,255,0.08)",
          borderBottom: isDesktop ? "1px solid rgba(255,255,255,0.08)" : "none",
          overflow: "hidden",
          display: "flex",
          flexDirection: isDesktop ? "row" : "column",
          color: "#F4F2EE",
          boxShadow: isDesktop ? "0 40px 120px rgba(0,0,0,0.6)" : "none",
          animation: isDesktop
            ? "sqModalIn 320ms cubic-bezier(.2,.8,.2,1)"
            : "sqSheetUp 360ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* Desktop left pane — the brand visual, Forever21-style imagery-left.
            On the result step it also owns the fit-map markers + the fit-telling
            strip (founder: "the image AND the lines telling it's tight/loose go
            on the LEFT; everything else on the right"). */}
        {isDesktop && (
          <DesktopVisual
            step={isRendering ? 1 : step}
            product={currentProduct}
            muse={activeMuse}
            renderedUrl={renderedUrl}
            renderError={renderError}
            height={fitH}
            weight={fitW}
            body={fitBody}
            displaySize={previewSize ?? effectiveSize}
          />
        )}

        {/* Removed the middle "THE PIECE" compare pane (founder: "you can still
            see the piece which is irrelevant, that's not needed. Why is it still
            there?"). The composite IS the piece-on-the-body — a static product
            photo next to it added a third column and clipped the look pieces. */}

        {/* Right column — drag handle, header, steps, scroll, footer */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, height: "100%" }}>
        {/* Drag handle (mobile only — desktop modal doesn't drag) */}
        {!isDesktop && (
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", paddingTop: 12 }}>
            <div style={{ width: 36, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.15)" }} />
          </div>
        )}

        {/* Header */}
        <div style={{ flexShrink: 0, padding: isDesktop ? "16px 18px 0 24px" : "10px 16px 0 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
          <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
            {/* On desktop the left image pane already brands "The Fitting Room ·
                Powered by Stylique", so the header shows ONLY the product name —
                no duplicate eyebrow. On mobile (no left pane) the eyebrow stays. */}
            {!isDesktop && (
              <p style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.45em", textTransform: "uppercase", color: "var(--mute)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                The Fitting Room
              </p>
            )}
            <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: isDesktop ? 18 : 16, color: "rgba(255,255,255,0.82)", margin: isDesktop ? 0 : "3px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {currentProduct.name}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close"
              className="sq-tt-btn"
              style={{
                flexShrink: 0,
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(244,242,238,0.82)", width: 36, height: 36, borderRadius: "50%",
                fontSize: 17, lineHeight: 1, cursor: "pointer", display: "grid", placeItems: "center",
              }}
            >×</button>
          )}
        </div>

        {/* Step dots */}
        <StepDots step={isRendering ? 1 : step} />

        {/* Scrollable body */}
        <ScrollBody>
          {step === 0 && (
            <StepSize
              height={height} onHeight={setHeight}
              weight={weight} onWeight={setWeight}
              age={fitAge} onAge={setFitAge}
              usualSize={usualSize} onUsualSize={setUsualSize}
              body={fitBody}
              fitResult={fitResult}
              fitPending={fitPending}
              fitError={fitError}
              authoritative={Boolean(ASSET_BASE && storefrontFit)}
              product={currentProduct}
            />
          )}
          {step === 1 && !isRendering && (
            <StepChoose
              muse={muse}
              bestMatch={bestMatchMuse}
              onMuse={(m) => { setChooseError(false); setMuse(m); }}
              gender={gender}
              onGender={(g) => {
                setGender(g);
                // Clear the selected muse if it no longer belongs to the chosen cast.
                if (muse) {
                  const cur = MUSES.find((m) => m.id === muse);
                  if (cur && cur.gender !== g) setMuse(null);
                }
              }}
              productName={currentProduct.name}
              sizes={currentProduct.sizes}
              chooseError={chooseError}
            />
          )}
          {/* Loading state — ONE place only (founder: "fix this at both places
              are doing same, like loading screen. One should show"). On desktop
              the LEFT pane (DesktopVisual) already shows the breathing render
              tile, so the right column suppresses StepRendering and shows a
              quiet inline progress strip instead. On mobile there is no left
              pane, so the full StepRendering screen still owns the surface. */}
          {isRendering && !isDesktop && (
            <StepRendering
              progress={renderProgress}
              phase={renderPhase}
              bodyImg={bodyImg ?? currentProduct.images[0]}
            />
          )}
          {isRendering && isDesktop && (
            <div style={{ padding: "18px 4px 8px", display: "flex", flexDirection: "column", gap: 10, animation: "sqFadeSlide 280ms ease both" }}>
              <p style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--electric)", margin: 0 }}>
                Generating your look
              </p>
              <p style={{ fontFamily: "var(--sans)", fontSize: 13, color: "rgba(244,242,238,0.78)", margin: 0, lineHeight: 1.5 }}>
                {renderPhase === 0 ? "Reading your measurements…" : renderPhase === 1 ? "Composing the piece on the body…" : renderPhase === 2 ? "Refining the drape…" : "Finishing up…"}
              </p>
              <div style={{ position: "relative", height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  position: "absolute", inset: 0,
                  width: `${Math.max(8, Math.min(100, renderProgress))}%`,
                  background: "var(--grad)", transition: "width 240ms ease",
                }} />
              </div>
              <p style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.18em", color: "var(--mute)", margin: "6px 0 0" }}>
                Watch the fitting room on the left.
              </p>
            </div>
          )}
          {step === 2 && !isRendering && (
            <StepResult
              product={currentProduct}
              muse={activeMuse}
              height={fitH}
              weight={fitW}
              body={fitBody}
              fitResult={fitResult}
              outfit={outfit}
              lookItems={lookItems}
              onToggleLook={toggleLookPiece}
              onFocus={focusPiece}
              onRemoveLook={removeLookItem}
              onTryTheLook={tryTheLook}
              lookDirty={lookDirty}
              size={effectiveSize}
              previewSize={previewSize}
              onPreviewSize={previewSizeTap}
              onTryThisSize={tryThisSize}
              renderedUrl={renderedUrl}
              renderError={renderError}
              rateInfo={rateInfo}
              errCode={renderErrCode}
              onRetry={startRender}
              isDesktop={isDesktop}
            />
          )}
        </ScrollBody>

        {/* Footer nav */}
        {!isRendering && step !== 2 && (
          <div style={{ flexShrink: 0, padding: isDesktop ? "14px 20px 18px" : "14px 20px max(48px, env(safe-area-inset-bottom))", display: "flex", gap: 10, borderTop: "1px solid rgba(255,255,255,0.06)", background: "#12101A" }}>
            <button onClick={() => (step > 0 ? setStep(step - 1) : onClose?.())} className="sq-tt-btn" style={ghostBtn()}>
              {step === 0 ? "Close" : "← Back"}
            </button>
            <button
              onClick={() => {
                if (step === 0) {
                  if (!fitReady) return;
                  setStep(1);
                } else {
                  // Step 1 is MODEL — require an explicit model pick before render.
                  if (!hasSelection) { setChooseError(true); return; }
                  startRender();
                }
              }}
              disabled={step === 0 && !fitReady}
              className="sq-tt-btn sq-tt-primary"
              style={{
                ...primaryBtn(), flex: 1,
                ...((step === 1 && !hasSelection) || (step === 0 && !fitReady) ? { opacity: 0.55 } : null),
              }}
            >
              {step === 0
                ? fitPending ? "Verifying your size…" : fitError ? "Sizing unavailable" : "Choose your model →"
                : "Generate my look →"}
            </button>
          </div>
        )}

        {step === 2 && !isRendering && (
          <div style={{ flexShrink: 0, padding: isDesktop ? "12px 20px 16px" : "12px 20px max(40px, env(safe-area-inset-bottom))", borderTop: "1px solid rgba(255,255,255,0.08)", background: "#12101A", boxShadow: "0 -12px 24px rgba(8,7,10,0.55)" }}>
            {/* Simple: buy THIS piece at the chosen size, or buy the whole look.
                When only one piece is on, it's just one clear "Add to bag". */}
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <button onClick={addOneToBag} disabled={adding} className="sq-tt-btn sq-tt-primary" style={{ ...primaryBtn(), flex: 1, padding: "13px 12px", opacity: adding ? 0.7 : 1 }}>
                {adding ? "Adding…" : outfitCount > 1
                  ? `Add this · ${effectiveSize} · $${currentProduct.priceUsd}`
                  : `Add to bag · ${effectiveSize} →`}
              </button>

              {outfitCount > 1 && (
                <button onClick={addLookToBag} disabled={adding} className="sq-tt-btn" style={{ ...ghostBtn(), flex: 1, padding: "12px 10px", minWidth: 0, opacity: adding ? 0.7 : 1 }}>
                  Add all {outfitCount} →
                </button>
              )}
            </div>
            {outfitCount > 1 && (
              <p style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.32)", margin: "9px 0 0", textAlign: "center" }}>
                The whole look · {outfitCount} pieces · ${[currentProduct, ...lookItems].reduce((s, p) => s + p.priceUsd, 0)}
              </p>
            )}
          </div>
        )}
        </div>{/* /right column */}
      </div>

      <style>{`
        @keyframes sqOverlayIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes sqSheetUp    { from { transform:translateY(100%) } to { transform:translateY(0) } }
        @keyframes sqModalIn    { from { opacity:0; transform:translateY(16px) scale(.98) } to { opacity:1; transform:translateY(0) scale(1) } }
        @keyframes sqFadeSlide  { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        @keyframes sqRise       { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        @keyframes sqRingSpin   { from { transform:rotate(0deg) }   to { transform:rotate(360deg) } }
        @keyframes sqRingSpinRv { from { transform:rotate(360deg) } to { transform:rotate(0deg) } }
        @keyframes sqScan       { 0% { top:-12% } 100% { top:104% } }
        @keyframes sqBounce     { 0%,100% { transform:translate(-50%,0) } 50% { transform:translate(-50%,6px) } }
        @keyframes sqBounceY    { 0%,100% { transform:translateY(0) } 50% { transform:translateY(6px) } }
        @keyframes sqShimmer    { 0% { background-position:-180% 0 } 100% { background-position:180% 0 } }
        @keyframes sqResettle   { 0% { transform:scale(1) } 22% { transform:scale(0.985); filter:brightness(1.06) } 100% { transform:scale(1); filter:brightness(1) } }
        @keyframes sqGlowPulse  { 0%,100% { box-shadow:0 0 0 1px rgba(139,92,246,0.35), 0 0 36px rgba(139,92,246,0.22) } 50% { box-shadow:0 0 0 1px rgba(139,92,246,0.55), 0 0 52px rgba(139,92,246,0.4) } }
        /* Forever21-style premium micro-interactions (inline styles can't do :hover/:active) */
        .sq-tt-card   { transition:transform 280ms cubic-bezier(.2,.8,.2,1), box-shadow 280ms cubic-bezier(.2,.8,.2,1), border-color 200ms ease, filter 220ms ease; will-change:transform }
        .sq-tt-card:hover   { transform:translateY(-4px) }
        .sq-tt-btn    { transition:transform 150ms cubic-bezier(.2,.8,.2,1), box-shadow 220ms ease, background 200ms ease, border-color 200ms ease, color 200ms ease }
        .sq-tt-btn:hover    { transform:translateY(-1px) }
        .sq-tt-btn:active   { transform:scale(.97) }
        .sq-tt-primary { position:relative; overflow:hidden }
        .sq-tt-primary:hover { box-shadow:0 10px 30px rgba(139,92,246,0.5) }
        .sq-tt-primary::after { content:""; position:absolute; inset:0; pointer-events:none; background:linear-gradient(105deg, transparent 32%, rgba(255,255,255,0.4) 50%, transparent 68%); background-size:220% 100%; background-position:-180% 0; border-radius:inherit }
        .sq-tt-primary:hover::after { animation:sqShimmer 900ms ease }
        @media (hover:none) { .sq-tt-card:hover, .sq-tt-btn:hover { transform:none } }
        @media (prefers-reduced-motion: reduce) { .sq-tt-card, .sq-tt-btn { transition:none } *[style*="animation"] { animation:none !important } }
        ::-webkit-scrollbar { display:none }
      `}</style>
    </div>
  );
}

// ── Desktop left visual pane — Forever21-style imagery-left ───────────────────
// Shows the chosen muse while the shopper is choosing / sizing, and the worn
// studio render once the look is generated. Pure display; the right column
// owns all interaction.
function DesktopVisual({
  step, product, muse, renderedUrl, renderError,
  height, weight, body, displaySize,
}: {
  step: number;
  product: Product;
  muse: (typeof MUSES)[number] | null;
  renderedUrl: string | null;
  renderError: boolean;
  height: number;
  weight: number;
  // The effective fit body (muse's circumferences when available, undefined →
  // estimate from height+weight). Drives the fit map so the markers/strip agree
  // with the body on screen.
  body?: MuseBody;
  displaySize: string;
}) {
  const onResult = step === 2;
  // The body the garment is shown on: the chosen muse. Null when nothing's chosen yet.
  const bodyImg = muse?.img ? resolveAsset(muse.img) : null;
  // No muse picked yet → a clean "choose a model" state.
  const awaitingPhoto = !onResult && !muse;
  // The composited render. On the result step, if it failed we DON'T silently
  // swap to the studio shot here — StepResult owns the explicit error banner;
  // this pane just holds the last body image so the layout stays stable.
  const img = onResult && renderedUrl && !renderError
    ? renderedUrl                                         // the real worn render
    : bodyImg ?? product.images[0];                       // body, or product as last resort
  const caption = onResult
    ? product.name
    : muse
      ? `${muse.label} · ${muse.silhouette}`
      : "Choose a model";

  // On the result step the left pane owns the fit-telling: the live fit map over
  // the worn render + a per-region "tight / true / loose" strip below it. Driven
  // by the shopper's body (height + weight) against the product's cut at the size
  // currently shown — updates instantly when a size pill is previewed on the right.
  const haveRender = onResult && !!renderedUrl && !renderError;
  const fit: SizeFit = haveRender
    ? fitBreakdown(product, displaySize, height, weight, body)
    : { size: displaySize, regions: [], overallEaseCm: 0, overallTightness: 0, headline: "" };
  const fitMarkers = haveRender ? fit.regions.filter((r) => r.label.toLowerCase() !== "inseam") : [];

  return (
    <div style={{
      // Founder fix: the fitting-room pane was clamped at 44% of the modal width
      // while a middle "THE PIECE" column ate another 26% and the controls took
      // the remaining 30%. With the middle pane removed, the composite expands
      // to ALL the space the right controls don't claim → reads as the full
      // canvas the founder asked for ("left screen has not become full screen").
      flex: "1 1 auto", minWidth: 0, position: "relative", overflow: "hidden",
      background: "#0E0B14", borderRight: "1px solid rgba(255,255,255,0.06)",
    }}>
      {/* The render + its fit markers live in a TRUE 3:4 frame, centered in the
          pane. This is the Loophole-H fix: markers use `top:${y}%`, so they only
          land on the right body region if the box they sit in has the SAME aspect
          as the image (3:4). The pane itself is an arbitrary shape, and
          `objectFit:cover` over an arbitrary pane crops vertically — which is what
          pushed the bust marker up onto the face. A centered `aspectRatio:3/4`
          frame (margin:auto + inset:0 sizes it to the largest 3:4 that fits)
          guarantees REGION_Y maps 1:1 to the body in every pane geometry; the
          letterbox is the same colour as the pane, so it's seamless. */}
      <div style={{
        position: "absolute", inset: 0, margin: "auto",
        aspectRatio: "3 / 4", maxWidth: "100%", maxHeight: "100%",
        overflow: "hidden",
      }}>
        {awaitingPhoto ? (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 16, padding: 28,
            background: "radial-gradient(120% 90% at 50% 30%, rgba(139,92,246,0.16) 0%, rgba(14,11,20,0) 60%)",
          }}>
            <div style={{
              width: 92, height: 92, borderRadius: "50%",
              border: "1.5px dashed rgba(199,184,255,0.45)",
              display: "grid", placeItems: "center",
              background: "rgba(139,92,246,0.08)",
            }}>
              <UploadGlyph size={34} />
            </div>
            <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 21, color: "rgba(244,242,238,0.92)", margin: 0, textAlign: "center", lineHeight: 1.25 }}>
              See it on you.
            </p>
            <p style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--mute)", margin: 0, textAlign: "center", maxWidth: 230, lineHeight: 1.5 }}>
              Drop a full-length photo on the right — we render the look on your own frame.
            </p>
          </div>
        ) : (
          <img
            key={img}
            src={img} alt={caption}
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "cover", objectPosition: "top center",
              animation: "sqFadeSlide 360ms ease both",
            }}
          />
        )}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(14,11,20,0.92) 0%, rgba(14,11,20,0.05) 50%)", pointerEvents: "none" }} />

        {/* Fit-map markers — move/relabel with the previewed size (result step only) */}
        {fitMarkers.map((r) => {
          const y = REGION_Y[r.label.toLowerCase()] ?? 45;
          return (
            <div key={r.label} style={{ position: "absolute", left: 0, right: 0, top: `${y}%`, animation: "sqFadeSlide 260ms ease both", pointerEvents: "none" }}>
              <div style={{ height: 1, background: "rgba(255,255,255,0.22)", boxShadow: "0 0 8px rgba(139,92,246,0.5)" }} />
              <span style={{
                position: "absolute", right: 12, top: -10,
                fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase",
                background: "rgba(14,11,20,0.86)", color: TAG_COLOR[r.tag],
                border: `1px solid ${TAG_COLOR[r.tag]}55`,
                padding: "3px 7px", borderRadius: 999, backdropFilter: "blur(6px)",
              }}>
                {r.label} · {r.tag}{r.easeCm > 0 ? ` +${r.easeCm}cm` : r.easeCm < 0 ? ` ${r.easeCm}cm` : ""}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ position: "absolute", top: 20, left: 20 }}>
        <p style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", margin: 0 }}>
          The Fitting Room
        </p>
        <p style={{ fontFamily: "var(--mono)", fontSize: 7.5, letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(255,255,255,0.32)", margin: "3px 0 0" }}>
          Powered by Stylique Technologies
        </p>
      </div>

      {/* Size badge — top right on the result step, honest about what's shown */}
      {haveRender && (
        <div style={{
          position: "absolute", top: 16, right: 16,
          padding: "7px 13px", background: "rgba(14,11,20,0.90)", backdropFilter: "blur(8px)",
          border: "1px solid rgba(139,92,246,0.45)", borderRadius: 999,
          display: "flex", alignItems: "center", gap: 7,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--electric)", flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.18em", color: "#C7B8FF" }}>
            Size {displaySize}
          </span>
        </div>
      )}

      {!awaitingPhoto && (
        <div style={{ position: "absolute", left: 20, right: 20, bottom: 20 }}>
          <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 22, color: "#F4F2EE", margin: 0, lineHeight: 1.2 }}>
            {caption}
          </p>
          {!onResult && (
            <p style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(199,184,255,0.7)", margin: "8px 0 0" }}>
              {muse
                ? `${muse.silhouette} · ${muse.hint}`
                : "Pick the model closest to you"}
            </p>
          )}

          {/* Fit-telling strip — "this runs tight / true / loose", region by region.
              Founder: the lines telling how it fits live on the LEFT with the image. */}
          {haveRender && fit.regions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontFamily: "var(--sans)", fontSize: 13, color: "rgba(244,242,238,0.95)", margin: "0 0 10px", lineHeight: 1.5 }}>
                {fit.headline}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {fit.regions.map((r) => {
                  const isLen = r.label.toLowerCase() === "inseam";
                  const pct = Math.round(50 + r.tightness * 45);
                  return (
                    <div key={r.label} style={{ display: "grid", gridTemplateColumns: "52px 1fr 56px", alignItems: "center", gap: 9 }}>
                      <span style={{ fontFamily: "var(--sans)", fontSize: 11, color: "rgba(244,242,238,0.8)", textTransform: "capitalize" }}>{r.label}</span>
                      <div style={{ position: "relative", height: 5, borderRadius: 999, background: "rgba(255,255,255,0.1)" }}>
                        <span style={{ position: "absolute", left: "50%", top: -2, width: 1, height: 9, background: "rgba(255,255,255,0.22)" }} />
                        <div style={{
                          position: "absolute", top: 0, height: "100%", borderRadius: 999,
                          left: isLen ? "0%" : `${Math.min(50, pct)}%`,
                          width: isLen ? "100%" : `${Math.abs(pct - 50)}%`,
                          background: TAG_COLOR[r.tag],
                          transition: "all 400ms cubic-bezier(.2,.8,.2,1)",
                        }} />
                      </div>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: TAG_COLOR[r.tag], textAlign: "right" }}>
                        {isLen ? "length" : r.tag}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Clean line-art upload glyph (replaces the 📷 emoji — emojis read as unfinished).
function UploadGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="rgba(199,184,255,0.95)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" stroke="rgba(199,184,255,0.7)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// ── Scroll body with a "more below" cue (demand j) ────────────────────────────

function ScrollBody({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  const check = () => {
    const el = ref.current;
    if (!el) return;
    setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 24);
  };

  useEffect(() => {
    check();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
    // Mount-once: `check` reads ref.current + the stable setMore; the
    // ResizeObserver + scroll listener handle every later content/scroll change,
    // so re-subscribing on every render would only churn listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <div ref={ref} style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "4px 20px 16px", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
        {children}
      </div>
      {more && (
        <div
          aria-hidden
          onClick={() => ref.current?.scrollBy({ top: 240, behavior: "smooth" })}
          style={{
            position: "absolute", right: 12, bottom: 10,
            width: 30, height: 30, borderRadius: "50%",
            background: "rgba(139,92,246,0.92)", color: "#0E0A14",
            display: "grid", placeItems: "center", cursor: "pointer",
            boxShadow: "0 6px 18px rgba(139,92,246,0.45)",
            animation: "sqBounceY 1.4s ease-in-out infinite",
            fontSize: 15, fontWeight: 700, zIndex: 3,
          }}
        >↓</div>
      )}
    </div>
  );
}

// ── Step progress dots ────────────────────────────────────────────────────────

function StepDots({ step }: { step: number }) {
  const labels = ["Size", "Model", "Your look"];
  return (
    <div style={{ flexShrink: 0, padding: "14px 20px 10px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 32px 1fr 32px", alignItems: "center" }}>
        {[0, 1, 2].map((i) => (
          <Fragment key={i}>
            <div
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: i <= step ? "var(--grad)" : "rgba(255,255,255,0.06)",
                border: i > step ? "1.5px solid rgba(255,255,255,0.14)" : "none",
                display: "grid", placeItems: "center",
                color: i <= step ? "#0E0A14" : "var(--mute)",
                fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700,
                transition: "all 300ms cubic-bezier(.2,.8,.2,1)",
              }}
            >
              {i < step ? "✓" : i + 1}
            </div>
            {i < 2 && (
              <div
                style={{
                  height: 2, borderRadius: 1,
                  background: i < step ? "var(--electric)" : "rgba(255,255,255,0.08)",
                  transition: "background 400ms ease",
                }}
              />
            )}
          </Fragment>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", marginTop: 6 }}>
        {labels.map((label, i) => (
          <span
            key={label}
            style={{
              fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: i <= step ? "#F4F2EE" : "var(--mute)",
              textAlign: i === 0 ? "left" : i === 1 ? "center" : "right",
              transition: "color 300ms",
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Step 0 — Choose ───────────────────────────────────────────────────────────

function StepChoose({
  muse, onMuse, gender, onGender, productName, sizes, chooseError, bestMatch,
}: {
  muse: MuseId | null; onMuse: (m: MuseId) => void;
  bestMatch: MuseId;
  gender: MuseGender; onGender: (g: MuseGender) => void;
  productName: string;
  sizes: string[];
  chooseError: boolean;
}) {
  const sizeRun = sizes.length ? `${sizes[0]}–${sizes[sizes.length - 1]}` : "—";
  // Preferred muse FIRST — the best frame for the shopper leads the carousel so
  // it's literally in front, already selected, not buried mid-scroll.
  const shownMuses = MUSES.filter((m) => m.gender === gender)
    .sort((a, b) => (a.id === bestMatch ? -1 : b.id === bestMatch ? 1 : 0));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 8, animation: "sqFadeSlide 280ms ease both" }}>
      <div>
        <h3 style={{ fontFamily: "var(--serif)", fontSize: 24, fontWeight: 400, margin: "0 0 6px", lineHeight: 1.15 }}>
          See it before you buy it.
        </h3>
        <p style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--mute)", margin: 0, lineHeight: 1.55 }}>
          Try the <em>{productName}</em> on a model that matches your frame.
        </p>
        <p style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(139,92,246,0.7)", margin: "8px 0 0" }}>
          This piece comes in {sizeRun}
        </p>
      </div>

      {chooseError && (
        <div
          role="alert"
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 14px", borderRadius: 12,
            background: "rgba(244,63,94,0.10)", border: "1px solid rgba(244,63,94,0.45)",
            animation: "sqFadeSlide 220ms ease both",
          }}
        >
          <span style={{ fontSize: 15, flexShrink: 0 }}>⚠</span>
          <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "#FECDD3", lineHeight: 1.45 }}>
            Pick a model below first — choose the frame closest to you.
          </span>
        </div>
      )}

      <div>
          {/* Gender toggle — Women / Men. The cast is split; women is the default. */}
          <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 3, gap: 3, marginBottom: 14 }}>
            {([["f", "Women"], ["m", "Men"]] as const).map(([g, lbl]) => (
              <button
                key={g}
                onClick={() => onGender(g)}
                style={{
                  flex: 1, padding: "8px", borderRadius: 8,
                  border: gender === g ? "1px solid rgba(139,92,246,0.5)" : "1px solid transparent",
                  background: gender === g ? "rgba(139,92,246,0.18)" : "transparent",
                  color: gender === g ? "#F4F2EE" : "var(--mute)",
                  fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.25em",
                  textTransform: "uppercase", cursor: "pointer", transition: "all 200ms",
                }}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <p style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--mute)", margin: 0 }}>
              Pick the model closest to you
            </p>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: "0.15em" }}>
              scroll →
            </span>
          </div>

          <div style={{
            display: "flex", gap: 12, overflowX: "auto", scrollbarWidth: "none",
            paddingBottom: 6, scrollSnapType: "x mandatory",
            WebkitOverflowScrolling: "touch",
          }}>
            {shownMuses.map((m, i) => {
              const selected = muse === m.id;
              const isBest = m.id === bestMatch;
              return (
                <button
                  key={m.id}
                  onClick={() => onMuse(m.id)}
                  className="sq-tt-card"
                  style={{
                    flex: "0 0 134px", width: 134, scrollSnapAlign: "start",
                    borderRadius: 16, padding: 0, overflow: "hidden",
                    border: selected ? "2px solid rgba(139,92,246,0.9)" : "1.5px solid rgba(255,255,255,0.08)",
                    boxShadow: selected ? "0 0 22px rgba(139,92,246,0.4)" : "none",
                    background: "rgba(255,255,255,0.02)",
                    cursor: "pointer",
                    transform: selected ? "translateY(-4px)" : "none",
                    animation: "sqRise 460ms cubic-bezier(.2,.8,.2,1) both",
                    animationDelay: `${i * 60}ms`,
                  }}
                >
                  <div style={{ position: "relative", width: "100%", aspectRatio: "3 / 4" }}>
                    <img
                      src={resolveAsset(m.img)} alt={m.label}
                      loading="lazy"
                      style={{
                        position: "absolute", inset: 0, width: "100%", height: "100%",
                        objectFit: "cover", objectPosition: "top center",
                        filter: selected ? "none" : "grayscale(0.35) brightness(0.82)",
                        transition: "filter 200ms",
                      }}
                    />
                    <div style={{
                      position: "absolute", inset: 0,
                      background: "linear-gradient(to top, rgba(14,11,20,0.92) 0%, rgba(14,11,20,0.1) 55%)",
                    }} />
                    {selected && (
                      <span style={{
                        position: "absolute", top: 8, right: 8,
                        width: 20, height: 20, borderRadius: "50%",
                        background: "var(--grad)", color: "#0E0A14",
                        display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
                      }}>✓</span>
                    )}
                    {isBest && (
                      <span style={{
                        position: "absolute", top: 8, left: 8,
                        padding: "3px 7px", borderRadius: 999,
                        background: "rgba(78,196,158,0.92)", color: "#04130D",
                        fontFamily: "var(--sans)", fontSize: 9, fontWeight: 700, letterSpacing: "0.02em",
                      }}>Best for you</span>
                    )}
                    <div style={{ position: "absolute", left: 10, right: 10, bottom: 9 }}>
                      <div style={{
                        fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.14em",
                        textTransform: "uppercase", fontWeight: 700,
                        color: selected ? "#F4F2EE" : "rgba(255,255,255,0.82)",
                      }}>{m.label}</div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: selected ? "rgba(196,181,253,0.9)" : "rgba(255,255,255,0.5)", marginTop: 2 }}>
                        {m.silhouette}
                      </div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.06em", color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                        {m.hint} · {m.body.bust}/{m.body.waist}/{m.body.hip}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
    </div>
  );
}

// ── Step 1 — Size ─────────────────────────────────────────────────────────────

const USUAL_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

function StepSize({
  height, onHeight, weight, onWeight,
  age, onAge, usualSize, onUsualSize,
  body, fitResult, fitPending, fitError, authoritative, product,
}: {
  height: number; onHeight: (v: number) => void;
  weight: number; onWeight: (v: number) => void;
  age: number;    onAge: (v: number) => void;
  usualSize: string; onUsualSize: (v: string) => void;
  body?: MuseBody;                    // muse bust/waist/hip refine the fit map
  fitResult: StorefrontFitResult;
  fitPending: boolean;
  fitError: string | null;
  authoritative: boolean;
  product: Product;
}) {
  const nudge = (cur: number, d: number, lo: number, hi: number, set: (v: number) => void) =>
    set(Math.max(lo, Math.min(hi, cur + d)));

  // Live confidence breakdown — updates as the shopper adds signals.
  const cb = confidenceBreakdown({
    heightCm: height, weightKg: weight,
    age: age > 0 ? age : undefined,
    usualBrandSize: usualSize !== "none" ? usualSize : undefined,
  });
  const displayedConfidence = authoritative ? fitResult.confidence : cb.score;

  // Unit preference — internally we always store cm/kg, but a shopper who thinks
  // in inches/lbs needs to enter and read their measurements that way. Persist
  // the choice so they only flip the toggle once.
  const [units, setUnits] = useState<"metric" | "imperial">(() => {
    if (typeof window === "undefined") return "metric";
    try { return (window.localStorage.getItem("mira_units_v1") as "metric" | "imperial") || "metric"; } catch { return "metric"; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("mira_units_v1", units); } catch { /* read-only storage */ }
  }, [units]);

  const cmToIn  = (cm: number) => Math.round(cm / 2.54);
  const inToCm  = (inches: number) => Math.round(inches * 2.54);
  const kgToLb  = (kg: number) => Math.round(kg * 2.20462);
  const lbToKg  = (lb: number) => Math.round(lb / 2.20462);

  const heightDisplay = units === "metric" ? height : cmToIn(height);
  const heightUnit    = units === "metric" ? "cm" : "in";
  const heightMin     = units === "metric" ? 140 : cmToIn(140); // 55
  const heightMax     = units === "metric" ? 210 : cmToIn(210); // 83
  const setHeightFromDisplay = (v: number) => {
    const cm = units === "metric" ? v : inToCm(v);
    onHeight(Math.max(140, Math.min(210, cm)));
  };
  const stepHeight = (d: number) => {
    if (units === "metric") nudge(height, d, 140, 210, onHeight);
    else { const cm = inToCm(cmToIn(height) + d); onHeight(Math.max(140, Math.min(210, cm))); }
  };

  const weightDisplay = units === "metric" ? weight : kgToLb(weight);
  const weightUnit    = units === "metric" ? "kg" : "lb";
  const weightMin     = units === "metric" ? 35 : kgToLb(35);  // 77
  const weightMax     = units === "metric" ? 150 : kgToLb(150); // 331
  const setWeightFromDisplay = (v: number) => {
    const kg = units === "metric" ? v : lbToKg(v);
    onWeight(Math.max(35, Math.min(150, kg)));
  };
  const stepWeight = (d: number) => {
    if (units === "metric") nudge(weight, d, 35, 150, onWeight);
    else { const kg = lbToKg(kgToLb(weight) + d); onWeight(Math.max(35, Math.min(150, kg))); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 8, animation: "sqFadeSlide 280ms ease both" }}>
      {/* LEAD WITH THE ANSWER — the size that suits them, front and centre. */}
      <div
        key={`${height}-${weight}-${age}-${usualSize}`}
        style={{
          padding: "20px 18px",
          background: "radial-gradient(120% 100% at 50% 0%, rgba(139,92,246,0.16) 0%, rgba(139,92,246,0.05) 60%)",
          border: "1px solid rgba(139,92,246,0.35)",
          borderRadius: 18,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          textAlign: "center",
          animation: "sqFadeSlide 220ms ease both",
        }}
      >
        <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(199,184,255,0.85)" }}>
          {authoritative ? "Verified size" : "Your size"} in the {product.name}
        </span>
        <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 56, color: "#F4F2EE", lineHeight: 0.95 }}>
          {fitPending ? "…" : fitError ? "—" : fitResult.size}
        </span>
        {!fitPending && !fitError && (
          <div style={{ width: "100%", maxWidth: 240 }}>
            <FitBar value={fitResult.confidence} />
          </div>
        )}
        {fitError && (
          <p role="status" style={{ fontFamily: "var(--sans)", fontSize: 12, color: "#E8A44C", margin: 0, lineHeight: 1.5 }}>
            {fitError}
          </p>
        )}
        {!fitPending && !fitError && fitResult.alt && (
          <p style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--mute)", margin: 0, lineHeight: 1.5 }}>
            {fitResult.alt.note}{" "}
            <span style={{ color: "var(--electric)" }}>You can try the {fitResult.alt.size} on the next step →</span>
          </p>
        )}
      </div>

      {/* Refine — height + weight tune the pick above, live. */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 10px" }}>
          <p style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--mute)", margin: 0 }}>
            Tune it to your frame — the size above updates as you do.
          </p>
          {/* cm/kg ↔ in/lb toggle — internal storage stays cm/kg, only display flips */}
          <div role="group" aria-label="Units" style={{ display: "inline-flex", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 999, padding: 2 }}>
            {(["metric", "imperial"] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnits(u)}
                aria-pressed={units === u}
                className="sq-tt-btn"
                style={{
                  padding: "4px 10px",
                  background: units === u ? "rgba(139,92,246,0.28)" : "transparent",
                  border: "none",
                  borderRadius: 999,
                  fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
                  color: units === u ? "rgba(244,242,238,0.95)" : "rgba(244,242,238,0.55)",
                  cursor: "pointer",
                }}
              >{u === "metric" ? "cm · kg" : "in · lb"}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Height" unit={heightUnit} value={heightDisplay}
            onChange={(v) => setHeightFromDisplay(Math.max(heightMin, Math.min(heightMax, v)))}
            onStep={stepHeight} />
          <NumberField label="Weight" unit={weightUnit} value={weightDisplay}
            onChange={(v) => setWeightFromDisplay(Math.max(weightMin, Math.min(weightMax, v)))}
            onStep={stepWeight} />
        </div>
      </div>

      {/* Optional signals — BoldMatrix-style progressive disclosure */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Confidence score trail — shows the shopper exactly how each signal helps */}
        <div style={{
          background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 12, padding: "12px 14px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em", color: "var(--electric)", textTransform: "uppercase" }}>
              Sizing confidence
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: cb.score >= 80 ? "#4EC49E" : cb.score >= 68 ? "#E8A44C" : "var(--mute)", fontWeight: 600 }}>
              {displayedConfidence}%
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {(authoritative ? ["Height and weight sent to the brand fit service", "Matched to this product's synced sizes"] : cb.signals).map((s) => (
              <span key={s} style={{ fontFamily: "var(--sans)", fontSize: 11.5, color: "rgba(244,242,238,0.7)" }}>
                ✓ {s}
              </span>
            ))}
          </div>
          {!authoritative && cb.score < 93 && (
            <p style={{ fontFamily: "var(--sans)", fontSize: 11, color: "var(--mute)", margin: 0, lineHeight: 1.5 }}>
              {cb.upgradeMessage}
            </p>
          )}
        </div>

        {/* Age — improves waist estimate for 30+ (body composition shift) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.12em", color: "var(--mute)", textTransform: "uppercase", marginBottom: 6 }}>
              Age <span style={{ color: "rgba(139,92,246,0.7)", fontWeight: 400 }}>{authoritative ? "optional · saved" : "optional · +8%"}</span>
            </label>
            <input
              type="number"
              value={age > 0 ? age : ""}
              placeholder="e.g. 34"
              min={16} max={90}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onAge(isNaN(v) ? 0 : Math.max(0, Math.min(90, v)));
              }}
              className="sq-mira-field"
              aria-label="Your age (optional, improves sizing accuracy)"
              style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 12px", color: "#F4F2EE", fontFamily: "var(--mono)", fontSize: 12, outline: "none" }}
            />
          </div>

          {/* Usual brand size — single strongest pre-measurement predictor */}
          <div>
            <label style={{ display: "block", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.12em", color: "var(--mute)", textTransform: "uppercase", marginBottom: 6 }}>
              Usual size <span style={{ color: "rgba(139,92,246,0.7)", fontWeight: 400 }}>{authoritative ? "optional · saved" : "optional · +10%"}</span>
            </label>
            <select
              value={usualSize}
              onChange={(e) => onUsualSize(e.target.value)}
              aria-label="Your usual size in a similar brand"
              style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 12px", color: usualSize === "none" ? "rgba(244,242,238,0.4)" : "#F4F2EE", fontFamily: "var(--mono)", fontSize: 12, outline: "none", cursor: "pointer" }}
            >
              <option value="none">In similar brands…</option>
              {USUAL_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Simplified fit breakdown — region by region (B1 / B2) */}
      {!fitPending && !fitError && (
        <FitSummary product={product} size={fitResult.size} height={height} weight={weight} body={body} />
      )}
    </div>
  );
}

// ── Simplified fit breakdown — easy to read, region by region (B1) ─────────────
// One plain-language line, then a small per-region scale (snug ◂ true ▸ relaxed).
// Replaces the old "overblast" block + the verbose "How I sized this" collapsible.
function FitSummary({ product, size, height, weight, body }: { product: Product; size: string; height: number; weight: number; body?: MuseBody }) {
  const fit = fitBreakdown(product, size, height, weight, body);
  if (!fit.regions.length) return null;
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 14, padding: "14px 16px",
    }}>
      <p style={{ fontFamily: "var(--sans)", fontSize: 13.5, color: "#F4F2EE", margin: "0 0 12px", lineHeight: 1.5 }}>
        {fit.headline}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {fit.regions.map((r) => {
          const isLen = r.label.toLowerCase() === "inseam";
          const pct = Math.round(50 + r.tightness * 45);
          return (
            <div key={r.label} style={{ display: "grid", gridTemplateColumns: "58px 1fr 64px", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--sans)", fontSize: 12, color: "rgba(244,242,238,0.85)", textTransform: "capitalize" }}>{r.label}</span>
              <div style={{ position: "relative", height: 5, borderRadius: 999, background: "rgba(255,255,255,0.07)" }}>
                <span style={{ position: "absolute", left: "50%", top: -2, width: 1, height: 9, background: "rgba(255,255,255,0.16)" }} />
                <div style={{
                  position: "absolute", top: 0, height: "100%", borderRadius: 999,
                  left: isLen ? "0%" : `${Math.min(50, pct)}%`,
                  width: isLen ? "100%" : `${Math.abs(pct - 50)}%`,
                  background: TAG_COLOR[r.tag],
                  transition: "all 400ms cubic-bezier(.2,.8,.2,1)",
                }} />
              </div>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: TAG_COLOR[r.tag], textAlign: "right" }}>
                {isLen ? "length" : r.tag}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NumberField({
  label, unit, value, onChange, onStep,
}: {
  label: string; unit: string; value: number;
  onChange: (v: number) => void; onStep: (d: number) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--mute)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
        <button type="button" onClick={() => onStep(-1)} style={stepBtn()} aria-label={`Decrease ${label}`}>−</button>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            type="number" inputMode="numeric" value={value}
            onChange={(e) => onChange(Number(e.target.value) || value)}
            style={{ ...inputSt(), textAlign: "center", paddingRight: 30 }}
          />
          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontFamily: "var(--mono)", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{unit}</span>
        </div>
        <button type="button" onClick={() => onStep(1)} style={stepBtn()} aria-label={`Increase ${label}`}>+</button>
      </div>
    </label>
  );
}

// ── Rendering animation — scans over the actual body (demand g) ───────────────

function StepRendering({ progress, phase, bodyImg }: { progress: number; phase: number; bodyImg: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 20px", gap: 18, animation: "sqFadeSlide 280ms ease both" }}>
      {/* The body with a sweeping scan line + shimmer — reads as a real render */}
      <div style={{
        position: "relative", width: 200, aspectRatio: "3 / 4",
        borderRadius: 16, overflow: "hidden",
        animation: "sqGlowPulse 2s ease-in-out infinite",
      }}>
        <img src={bodyImg} alt="Fit-preview model" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center", filter: "saturate(0.9) brightness(0.92)" }} />
        {/* sweeping scan line */}
        <div style={{
          position: "absolute", left: 0, right: 0, height: "14%",
          background: "linear-gradient(180deg, transparent, rgba(139,92,246,0.55), transparent)",
          animation: "sqScan 1.5s ease-in-out infinite",
        }} />
        {/* shimmer sheen */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.18) 50%, transparent 65%)",
          backgroundSize: "220% 100%",
          animation: "sqShimmer 1.8s linear infinite",
          mixBlendMode: "screen",
        }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(14,11,20,0.55), transparent 45%)" }} />
        <div style={{ position: "absolute", left: 12, bottom: 10, fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.85)" }}>
          {PHASES[Math.min(phase, PHASES.length - 1)]}
        </div>
      </div>

      <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 40, background: "var(--grad)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1 }}>
        {Math.floor(progress)}<span style={{ fontSize: 18 }}>%</span>
      </div>

      <div style={{ width: "100%", height: 4, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{ width: `${progress}%`, height: "100%", background: "var(--grad)", borderRadius: 999, transition: "width 220ms ease" }} />
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {PHASES.map((p, i) => (
          <div key={p} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%",
              background: phase >= i ? "var(--grad)" : "rgba(255,255,255,0.08)",
              display: "grid", placeItems: "center",
              fontSize: 9, color: "#0E0A14", fontWeight: 700,
              transition: "background 320ms",
            }}>
              {phase > i ? "✓" : ""}
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: "0.15em", textTransform: "uppercase", color: phase >= i ? "#F4F2EE" : "var(--mute)", textAlign: "center", maxWidth: 60 }}>
              {p.split(" ")[1] ?? p.split(" ")[0]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 2 — Result ───────────────────────────────────────────────────────────

const TAG_COLOR: Record<string, string> = {
  tight:   "#C77DFF",
  true:    "#8B5CF6",
  relaxed: "#A78BFA",
  loose:   "#7C5CFF",
};

// ── Look-card geometry — ONE source of truth so every thumbnail (the worn-look
//    filmstrip AND the complete-the-look rail) is byte-identical in size and uses
//    the same entrance animation (founder: "some boxes incomplete… should be same
//    size and animations in it"). Image area is a fixed 3:4 box; the caption is a
//    fixed-height block so a long vs short product name never makes a card taller.
const LOOK_CARD_W = 96;          // px — card column width (no shrink)
const LOOK_CAP_H = 34;           // px — caption block height (name + price / label)
const LOOK_ANIM = "sqRise 440ms cubic-bezier(.2,.8,.2,1) both";
const lookCardStagger = (i: number) => `${i * 55}ms`;

function StepResult({
  product, muse, height, weight, body, fitResult, outfit, lookItems,
  onToggleLook, onFocus, onRemoveLook, onTryTheLook, lookDirty, onRetry,
  size, previewSize, onPreviewSize, onTryThisSize,
  renderedUrl, renderError, rateInfo, errCode, isDesktop,
}: {
  product: Product;
  muse: (typeof MUSES)[number] | null;
  height: number; weight: number;
  body?: MuseBody;                    // muse bust/waist/hip refine the fit map
  fitResult: ReturnType<typeof computeFit>;
  outfit: Product[];
  lookItems: Product[];
  onToggleLook: (p: Product) => void;  // tap a piece → add/remove from the look (no render)
  onFocus: (p: Product) => void;       // tap a worn thumb → bring into focus (no render)
  onRemoveLook: (handle: string) => void;
  onTryTheLook: () => void;            // explicit button → render the whole look together
  lookDirty: boolean;                  // selection differs from what's rendered
  onRetry: () => void;                 // re-fire the render after an error
  size: string;                       // the size the CURRENT render was produced at
  previewSize: string | null;         // a size the shopper tapped but hasn't committed
  onPreviewSize: (s: string) => void; // tap a pill → preview only
  onTryThisSize: () => void;          // the explicit button → re-render at previewSize
  renderedUrl: string | null;         // the real composited render
  renderError: boolean;               // true → show an explicit error, never the bare product
  rateInfo: number | null;            // P4 — non-null → abuse cap hit, retry after N seconds
  errCode: string | null;             // specific failure code for honest per-code copy
  isDesktop: boolean;                 // desktop → image + fit-telling live in the LEFT pane
}) {
  const museLabel = muse?.label ?? "your model";
  const sizeRun = product.sizes;
  // displaySize = what the fit map / badge reflect right now. A tapped (preview)
  // size updates the map instantly; the actual re-render waits for the button.
  const displaySize = previewSize ?? size;
  // The fit map reflects the body the garment is shown on — the muse's real
  // bust/waist/hip refine it so the map agrees with the avatar. Same source of
  // truth as the recommended size.
  const fit: SizeFit = fitBreakdown(product, displaySize, height, weight, body);
  const isRec = displaySize === fitResult.size;
  const previewing = !!previewSize && previewSize !== size;

  // The render shows the garment ACTUALLY worn — the real composited image of this
  // piece on the chosen muse. We NEVER silently fall back to the bare product
  // shot (founder: "showing just the product" is a failure).
  const haveRender = !renderError && !!renderedUrl;
  // Hero list: the focus piece first, then any complete-the-look additions.
  const wornLook = [product, ...lookItems];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 12, animation: "sqFadeSlide 300ms ease both" }}>
      {/* Render — the piece worn on the muse, with a live fit map.
          On error we show an explicit retry, NOT the bare product.
          On DESKTOP the worn render + fit map + size badge live in the LEFT pane
          (DesktopVisual) — here we only keep the explicit error/retry banner so
          the image never shows twice (founder: "main image on the left only"). */}
      {(!isDesktop || renderError) && (
      <div style={{
        position: "relative", borderRadius: 18, overflow: "hidden",
        aspectRatio: "3 / 4",
        background: "#0E0B14",
        boxShadow: "0 18px 48px rgba(8,7,10,0.55), inset 0 0 0 1px rgba(255,255,255,0.06)",
      }}>
        {renderError ? (
          /* Explicit error — never pretend the bare studio shot is a try-on */
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 16, padding: 28, textAlign: "center",
          }}>
            <span style={{ fontSize: 34 }}>{rateInfo ? "⏳" : "⚠"}</span>
            <div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 20, color: "#F4F2EE", marginBottom: 6 }}>
                {rateInfo ? "Easy there — give it a moment."
                  : errCode === "render_unavailable" ? "Try-on is briefly offline."
                  : errCode === "quota_reached" ? "You’ve used your try-ons for now."
                  : errCode === "feature_disabled" ? "Try-on isn’t enabled here."
                  : "The try-on didn’t come through."}
              </div>
              <p style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--mute)", margin: 0, lineHeight: 1.5, maxWidth: 280 }}>
                {rateInfo
                  ? `You’ve run a lot of try-ons quickly. Try again in about ${rateInfo < 90 ? `${rateInfo}s` : `${Math.ceil(rateInfo / 60)} min`}.`
                  : errCode === "render_unavailable" ? "The try-on service is taking a quick breather — try again in a few minutes."
                  : errCode === "quota_reached" ? "You’ve hit the try-on limit for now — it refreshes soon."
                  : errCode === "feature_disabled" ? "This store hasn’t turned on virtual try-on yet."
                  : "The render timed out or the model couldn’t place the piece. Let’s run it again."}
              </p>
            </div>
            {!rateInfo && (
              <button
                onClick={onRetry}
                className="sq-tt-btn sq-tt-primary"
                style={{ ...primaryBtn(), padding: "12px 22px" }}
              >
                Try again →
              </button>
            )}
          </div>
        ) : (
          /* The garment, actually worn on the muse */
          <img
            src={renderedUrl ?? wornLook[0].images[0]}
            alt={`${product.name} worn`}
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "cover", objectPosition: "top center",
            }}
          />
        )}

        {/* Fit-map markers — move/relabel with the selected size (only over a real render) */}
        {haveRender && fit.regions.filter((r) => r.label.toLowerCase() !== "inseam").map((r) => {
          const y = REGION_Y[r.label.toLowerCase()] ?? 45;
          return (
            <div key={r.label} style={{ position: "absolute", left: 0, right: 0, top: `${y}%`, animation: "sqFadeSlide 260ms ease both" }}>
              <div style={{ height: 1, background: "rgba(255,255,255,0.22)", boxShadow: "0 0 8px rgba(139,92,246,0.5)" }} />
              <span style={{
                position: "absolute", right: 10, top: -10,
                fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase",
                background: "rgba(14,11,20,0.86)", color: TAG_COLOR[r.tag],
                border: `1px solid ${TAG_COLOR[r.tag]}55`,
                padding: "3px 7px", borderRadius: 999, backdropFilter: "blur(6px)",
              }}>
                {r.label} · {r.tag}{r.easeCm > 0 ? ` +${r.easeCm}cm` : r.easeCm < 0 ? ` ${r.easeCm}cm` : ""}
              </span>
            </div>
          );
        })}

        {/* Frame chip — honest about whose body is shown (only over a real render) */}
        {haveRender && (
          <div style={{
            position: "absolute", top: 12, left: 12,
            display: "flex", alignItems: "center", gap: 7,
            background: "rgba(14,11,20,0.8)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 999, padding: "5px 11px", backdropFilter: "blur(8px)",
          }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.8)" }}>
              {`Fit to ${museLabel}`}
            </span>
          </div>
        )}

        {/* Size badge (only over a real render) */}
        {haveRender && (
          <div style={{
            position: "absolute", bottom: 14, right: 14,
            padding: "8px 14px",
            background: "rgba(14,11,20,0.90)", backdropFilter: "blur(8px)",
            border: "1px solid rgba(139,92,246,0.45)", borderRadius: 999,
            display: "flex", alignItems: "center", gap: 7,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--electric)", flexShrink: 0 }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.18em", color: "#C7B8FF" }}>
              Size {displaySize} · {previewing ? "preview" : isRec ? `${fitResult.confidence}% fit` : fit.regions.length ? fit.headline.split(" ")[0].toLowerCase() : "custom"}
            </span>
          </div>
        )}
      </div>
      )}

      {/* Your look so far — the focus piece (shown big) is starred; tap any other
          to bring it back into focus, × to drop it. */}
      {wornLook.length > 1 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <p style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.32em", textTransform: "uppercase", color: "#C7B8FF", margin: 0 }}>
              Your look · {wornLook.length} pieces
            </p>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.1em", color: "var(--mute)" }}>tap to view</span>
          </div>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
            {wornLook.map((p, i) => (
              <div key={p.handle} style={{ flex: `0 0 ${LOOK_CARD_W}px`, position: "relative", animation: LOOK_ANIM, animationDelay: lookCardStagger(i) }}>
                <button
                  onClick={() => onFocus(p)}
                  aria-label={`View ${p.name}`}
                  className="sq-tt-card"
                  style={{
                    width: "100%", aspectRatio: "3 / 4", borderRadius: 10, overflow: "hidden", padding: 0,
                    backgroundImage: `url(${p.images[0]})`, backgroundSize: "cover", backgroundPosition: "top center",
                    border: i === 0 ? "2px solid rgba(139,92,246,0.9)" : "1px solid rgba(255,255,255,0.1)",
                    boxShadow: i === 0 ? "0 0 16px rgba(139,92,246,0.4)" : "none",
                    cursor: "pointer", display: "block",
                  }}
                />
                {i > 0 && (
                  <button
                    onClick={() => onRemoveLook(p.handle)}
                    aria-label={`Remove ${p.name}`}
                    style={{
                      // 44×44 transparent hit target (WCAG 2.5.5 / iOS HIG) with a
                      // smaller visible chip inside, so the tap area is reachable on
                      // a phone without a giant badge over the thumbnail (panel P1).
                      position: "absolute", top: -12, right: -12, width: 44, height: 44, padding: 0,
                      background: "transparent", border: "none", cursor: "pointer",
                      display: "grid", placeItems: "center",
                    }}
                  >
                    <span style={{
                      width: 24, height: 24, borderRadius: "50%",
                      background: "rgba(14,11,20,0.92)", border: "1px solid rgba(255,255,255,0.22)",
                      color: "#F4F2EE", fontSize: 13, lineHeight: 1,
                      display: "grid", placeItems: "center", backdropFilter: "blur(6px)",
                    }}>×</span>
                  </button>
                )}
                <div style={{ height: LOOK_CAP_H, display: "flex", flexDirection: "column", justifyContent: "flex-start", marginTop: 6, overflow: "hidden" }}>
                  <div style={{ fontFamily: "var(--sans)", fontSize: 11, lineHeight: 1.2, color: "rgba(255,255,255,0.78)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {i === 0 ? "★ " : ""}{p.name}
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.1em", color: "var(--electric)", marginTop: 2 }}>
                    ${p.priceUsd}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Item + price */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 19, lineHeight: 1.2 }}>{product.name}</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.2em", color: "var(--mute)", marginTop: 3 }}>
            on {museLabel}
          </div>
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 13, letterSpacing: "0.15em", color: "var(--electric)" }}>
          ${product.priceUsd}
        </div>
      </div>

      {/* ── Size — TAP a pill to PREVIEW the fit (the map + badge update instantly);
              the render only changes when you press "Try on this size →".
              (founder: "tap previews, button re-renders") ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--mute)" }}>
            Size — tap to preview
          </span>
          <span style={{ fontFamily: "var(--sans)", fontSize: 11.5, color: TAG_COLOR[fit.regions[0]?.tag ?? "true"] }}>
            {fit.headline.split(".")[0]}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {sizeRun.map((sz) => {
            const isPreview = sz === displaySize;   // the size the map currently reflects
            const isWorn = sz === size;             // the size the render was produced at
            const rec = sz === fitResult.size;
            return (
              <button
                key={sz}
                onClick={() => onPreviewSize(sz)}
                className="sq-tt-btn"
                style={{
                  flex: 1, padding: "11px 4px", borderRadius: 10,
                  border: isPreview ? "1.5px solid rgba(139,92,246,0.9)" : "1px solid rgba(255,255,255,0.1)",
                  background: isPreview ? "rgba(139,92,246,0.2)" : "transparent",
                  color: isPreview ? "#F4F2EE" : "var(--mute)",
                  fontFamily: "var(--mono)", fontSize: 12, fontWeight: isPreview ? 700 : 400,
                  cursor: "pointer", position: "relative",
                }}
              >
                {sz}
                {rec && <span style={{ position: "absolute", top: 3, right: 5, fontSize: 7, color: "var(--electric)" }} title="Recommended">★</span>}
                {isWorn && !isPreview && <span style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: "var(--electric)" }} title="Now showing" />}
              </button>
            );
          })}
        </div>

        {/* The explicit re-render button — only shown when a different size is previewed */}
        {previewing ? (
          <button
            onClick={onTryThisSize}
            className="sq-tt-btn sq-tt-primary"
            style={{ ...primaryBtn(), width: "100%", marginTop: 10, padding: "12px 16px" }}
          >
            Try on the {previewSize} →
          </button>
        ) : (
          <p style={{ fontFamily: "var(--sans)", fontSize: 11.5, color: "var(--mute)", margin: "9px 0 0", lineHeight: 1.5 }}>
            {isRec
              ? <>You&apos;re on the <b style={{ color: "#C7B8FF" }}>{size}</b> — your recommended fit.</>
              : <>Showing the <b style={{ color: "#C7B8FF" }}>{size}</b>. <span style={{ color: "var(--electric)", cursor: "pointer" }} onClick={() => onPreviewSize(fitResult.size)}>Preview your size ({fitResult.size})</span></>}
          </p>
        )}
      </div>

      {/* ── Complete the look — tap a piece to ADD it to your look (selection only,
              no render). Press "Try the look on" to render them all together on the
              same body. (founder: tapping must NOT auto-render). ── */}
      {outfit.length > 0 && (
        <div>
          <p style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.35em", textTransform: "uppercase", color: "var(--mute)", margin: "0 0 4px" }}>
            Complete the look
          </p>
          <p style={{ fontFamily: "var(--sans)", fontSize: 11, color: "rgba(255,255,255,0.32)", margin: "0 0 12px", lineHeight: 1.4 }}>
            Tap pieces to build your look — then try them on together.
          </p>
          {/* GRID, not horizontal scroll. Founder: "I can't open it. It's not…
              some are big, some are small. It's not well placed." Cards now wrap
              into a uniform 2-column grid (one column on a very narrow right
              pane) so every piece is visible at once and tappable. Same fixed
              aspect-ratio per card → consistent sizing, no clipped edge. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10, paddingBottom: 4 }}>
            {outfit.map((p, i) => {
              const inLook = lookItems.some((x) => x.handle === p.handle);
              return (
                <button
                  key={p.handle}
                  onClick={() => onToggleLook(p)}
                  className="sq-tt-card"
                  style={{
                    width: "100%", background: "transparent", border: "none",
                    cursor: "pointer", color: "#F4F2EE", textAlign: "left", padding: 0,
                    animation: LOOK_ANIM,
                    animationDelay: lookCardStagger(i),
                    // Guarantee a real tap target — WCAG 2.5.5 + matches mobile audit
                    minHeight: 44,
                  }}
                >
                  <div style={{
                    width: "100%", aspectRatio: "3 / 4",
                    backgroundImage: `url(${p.images[0]})`,
                    backgroundSize: "cover", backgroundPosition: "top center",
                    borderRadius: 10,
                    border: inLook ? "2px solid rgba(139,92,246,0.9)" : "1px solid rgba(255,255,255,0.07)",
                    boxShadow: inLook ? "0 0 16px rgba(139,92,246,0.4)" : "none",
                    position: "relative", overflow: "hidden",
                  }}>
                    <div style={{
                      position: "absolute", inset: 0, display: "flex",
                      alignItems: "flex-end", justifyContent: "center", padding: "0 0 8px",
                      background: "linear-gradient(to top, rgba(14,11,20,0.78) 0%, transparent 50%)",
                    }}>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", color: inLook ? "#C7B8FF" : "rgba(255,255,255,0.7)" }}>
                        {inLook ? "✓ In look" : "+ Add"}
                      </span>
                    </div>
                  </div>
                  <div style={{ height: LOOK_CAP_H, display: "flex", flexDirection: "column", justifyContent: "flex-start", marginTop: 6, overflow: "hidden" }}>
                    <div style={{ fontFamily: "var(--sans)", fontSize: 11, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.78)" }}>
                      {p.name}
                    </div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.1em", color: "var(--electric)", marginTop: 2 }}>
                      ${p.priceUsd}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Explicit render trigger — selection alone never re-renders; this does.
              STICKY so it's ALWAYS reachable: with 2-3 look pieces the grid grows
              tall and a non-sticky button drops below the fold (founder: "the
              try-it-together button goes down so the user cannot see it"). Pinned
              to the bottom of the scroll area, it never hides. */}
          {lookDirty && (
            <div style={{ position: "sticky", bottom: 0, zIndex: 5, marginTop: 12, paddingTop: 8, paddingBottom: 4, background: "linear-gradient(to top, var(--surface) 70%, transparent)" }}>
              <button
                onClick={onTryTheLook}
                className="sq-tt-btn sq-tt-primary"
                style={{ ...primaryBtn(), width: "100%", padding: "14px 16px" }}
              >
                Try the look on · {1 + lookItems.length} pieces →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared utilities ──────────────────────────────────────────────────────────

function FitBar({ value }: { value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.25em", textTransform: "uppercase", color: "var(--mute)", whiteSpace: "nowrap" }}>
        Fit confidence
      </span>
      <div style={{ flex: 1, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
        <div style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          height: "100%",
          background: "var(--grad)",
          borderRadius: 999,
          transition: "width 400ms cubic-bezier(.2,.8,.2,1)",
        }} />
      </div>
      <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "#C7B8FF", fontWeight: 600, whiteSpace: "nowrap" }}>
        {value}%
      </span>
    </div>
  );
}

function primaryBtn(): React.CSSProperties {
  return {
    padding: "14px 20px", background: "var(--grad)",
    color: "#0E0A14", border: "none", borderRadius: 999,
    fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.3em",
    textTransform: "uppercase", cursor: "pointer", fontWeight: 700,
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    padding: "14px 18px", background: "transparent",
    color: "#F4F2EE", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 999, fontFamily: "var(--mono)", fontSize: 11,
    letterSpacing: "0.2em", textTransform: "uppercase",
    cursor: "pointer", minWidth: 44,
  };
}

function stepBtn(): React.CSSProperties {
  return {
    width: 38, flexShrink: 0,
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10, color: "#F4F2EE", fontSize: 18, lineHeight: 1,
    cursor: "pointer", display: "grid", placeItems: "center",
  };
}

function inputSt(): React.CSSProperties {
  return {
    padding: "13px 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10, color: "#F4F2EE",
    fontFamily: "var(--sans)", fontSize: 15,
    outline: "none", width: "100%",
    boxSizing: "border-box",
  };
}
