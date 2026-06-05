/**
 * Try-On Context — shared session state between PDP Try-On and Mira.
 * sessionStorage-backed so state persists across component mounts within the
 * same tab. Falls back gracefully when sessionStorage is unavailable.
 * Pure TypeScript — no React, no DOM APIs beyond sessionStorage.
 */

export type TryOnTrigger = "pdp_button" | "mira_suggest" | "look_card" | "reco_card";
export type TryOnStatus  = "idle" | "opened" | "rendering" | "completed" | "abandoned" | "failed";

export type TryOnSession = {
  trigger:        TryOnTrigger;
  productHandle:  string;
  productName:    string;
  selectedSize:   string;
  status:         TryOnStatus;
  resultImageUrl: string | null;   // null until render completes
  errorCode:      string | null;   // null unless status === "failed"
  addedToCart:    boolean;
  openedEpoch:    number;          // epoch seconds (not Date.now() — must be passed in)
  completedEpoch: number | null;
  abandonedEpoch: number | null;
  outfitPieces:   string[];        // handles of other pieces in a combined look render
};

const KEY = "sq_tryon_ctx";

// Products known to have imagery unsuitable for try-on renders.
// Populated from merchant intelligence when flagged by the imaging pipeline.
const LOW_QUALITY_HANDLES: ReadonlySet<string> = new Set<string>();

// ── sessionStorage helpers ────────────────────────────────────────────────────

function ssGet(): TryOnSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TryOnSession) : null;
  } catch {
    return null;
  }
}

function ssSet(s: TryOnSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode or storage full — degrade gracefully */
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a new try-on session. Call this when the fitting room opens, whether
 * from the PDP button or a Mira suggestion.
 * epochSeconds: pass Math.floor(Date.now() / 1000) from the caller.
 */
export function startTryOnSession(
  trigger: TryOnTrigger,
  productHandle: string,
  productName: string,
  selectedSize: string,
  epochSeconds: number,
  outfitPieces: string[] = [],
): void {
  ssSet({
    trigger,
    productHandle,
    productName,
    selectedSize,
    status: "opened",
    resultImageUrl: null,
    errorCode: null,
    addedToCart: false,
    openedEpoch: epochSeconds,
    completedEpoch: null,
    abandonedEpoch: null,
    outfitPieces,
  });
}

/**
 * Update the try-on status. Call this as the render progresses:
 *   "rendering" → when the render API call is initiated
 *   "completed" → when the composite image is returned
 *   "abandoned" → when the panel closes before cart add
 *   "failed"    → when the render returns an error
 * epochSeconds: pass Math.floor(Date.now() / 1000) from the caller.
 */
export function updateTryOnStatus(
  status: TryOnStatus,
  epochSeconds: number,
  resultImageUrl?: string,
  errorCode?: string,
): void {
  const cur = ssGet();
  if (!cur) return;
  ssSet({
    ...cur,
    status,
    resultImageUrl: resultImageUrl ?? cur.resultImageUrl,
    errorCode:      errorCode      ?? cur.errorCode,
    completedEpoch: status === "completed" ? epochSeconds : cur.completedEpoch,
    abandonedEpoch: status === "abandoned" ? epochSeconds : cur.abandonedEpoch,
  });
}

/** Mark that the shopper added to cart after seeing the try-on result. */
export function markTryOnCartAdded(): void {
  const cur = ssGet();
  if (!cur) return;
  ssSet({ ...cur, addedToCart: true });
}

/** Read the current session (may be null if none started). */
export function getTryOnSession(): TryOnSession | null {
  return ssGet();
}

/** Clear the session (call after checkout or new product visit). */
export function clearTryOnSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

/**
 * Build a short context block injected into Mira's prompt so she knows what
 * happened in the fitting room without the shopper having to explain.
 * nowEpoch: pass Math.floor(Date.now() / 1000) from the caller.
 * Returns "" if no session or session is stale (>30 min old).
 */
export function getTryOnSummaryForMira(nowEpoch: number): string {
  const s = ssGet();
  if (!s || s.status === "idle") return "";
  const ageSeconds = nowEpoch - s.openedEpoch;
  if (ageSeconds > 1800) return ""; // stale after 30 min

  const source = s.trigger === "pdp_button" ? "PDP button" : "Mira suggestion";
  const pieces = s.outfitPieces.length > 0
    ? ` (combined look: ${s.outfitPieces.join(", ")})`
    : "";

  if (s.status === "abandoned" && !s.addedToCart) {
    return (
      `TRYON CONTEXT: shopper tried ${s.productName} (size ${s.selectedSize}, via ${source})${pieces} ` +
      `— completed the render but closed without adding to cart. ` +
      `This is a hesitation or dissatisfaction signal. ` +
      `Ask what felt off before pushing to close.`
    );
  }
  if (s.status === "completed" && s.addedToCart) {
    return (
      `TRYON CONTEXT: shopper tried ${s.productName} (size ${s.selectedSize}, via ${source}) ` +
      `and added to cart after the render. High confidence. Offer to complete the look.`
    );
  }
  if (s.status === "completed" && !s.addedToCart) {
    return (
      `TRYON CONTEXT: shopper just completed try-on for ${s.productName} ` +
      `(size ${s.selectedSize}) but has not added to cart yet. ` +
      `This is the closing window — ask if they want to add it.`
    );
  }
  if (s.status === "failed") {
    return (
      `TRYON CONTEXT: try-on failed for ${s.productName} (error: ${s.errorCode ?? "unknown"}). ` +
      `Explain clearly and offer size help or a better-quality alternative.`
    );
  }
  if (s.status === "opened" || s.status === "rendering") {
    return (
      `TRYON CONTEXT: shopper has the fitting room open for ${s.productName} ` +
      `(size ${s.selectedSize}). They are currently in the try-on flow.`
    );
  }
  return "";
}

/**
 * Returns a warning string if the product is known to have poor try-on imagery,
 * null otherwise. Currently uses a static set — will be populated from merchant
 * imaging pipeline signals in production.
 */
export function getImageQualityWarning(handle: string): string | null {
  if (LOW_QUALITY_HANDLES.has(handle)) {
    return "This product's imagery may not render well in try-on. Consider requesting better garment-focused photography.";
  }
  return null;
}
