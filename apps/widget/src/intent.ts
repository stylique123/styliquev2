// Stylique Intent Engine — client-side behavioral signal detection.
//
// Modeled on production patterns from Amazon COSMO/Rufus and
// "Identifying Shopping Intent in Product QA for Proactive Recommendations"
// (arXiv:2404.06017).
//
// Pure TypeScript — no npm deps, no DOM frameworks. Runs in the browser.
// All DOM queries wrapped in try/catch. sessionStorage writes are guarded.

export type IntentSignal =
  | "dwell_30s"         // 0.30 — 30s on PDP without scroll
  | "dwell_90s"         // 0.50 — 90s on PDP (supersedes 30s)
  | "scroll_deep"       // 0.20 — scrolled > 80% of page
  | "size_guide_click"  // 0.40 — clicked size guide link
  | "image_zoom"        // 0.30 — zoomed product image or clicked image gallery
  | "variant_switch"    // 0.25 — changed size/color selector without adding to cart
  | "return_visit"      // 0.60 — same product handle seen in sessionStorage viewHistory
  | "price_inspect"     // 0.35 — hovered over price or compare-at price > 3s
  | "compare_back"      // 0.40 — navigated back (history) after viewing a different product
  | "scroll_back_up"    // 0.25 — scrolled down then reversed back up (uncertainty signal)
  | "add_no_checkout";  // 0.70 — ATC fired but no checkout navigation within 2 min

export const SIGNAL_WEIGHTS: Record<IntentSignal, number> = {
  dwell_30s:        0.30,
  dwell_90s:        0.50,
  scroll_deep:      0.20,
  size_guide_click: 0.40,
  image_zoom:       0.30,
  variant_switch:   0.25,
  return_visit:     0.60,
  price_inspect:    0.35,
  compare_back:     0.40,
  scroll_back_up:   0.25,
  add_no_checkout:  0.70,
};

export type IntentState = "BROWSING" | "DISCOVERING" | "CONSIDERING" | "DECIDING" | "CONVERTING";

export type IntentContext = {
  state: IntentState;
  confidenceScore: number;       // 0–1, weighted sum of active signals
  activeSignals: IntentSignal[];
  currentPdpHandle: string | null;
  currentPdpDwellSeconds: number;
  viewHistory: string[];         // last 5 product handles viewed this session
  comparedPair: [string, string] | null;  // two products the shopper bounced between
  sessionDepthSeconds: number;
  returnVisit: boolean;
  cartHasItems: boolean;
};

const STORAGE_KEY = "sq_intent_ctx";

// Safely read from sessionStorage.
function ssGet(key: string): string | null {
  try { return sessionStorage.getItem(key); }
  catch { return null; }
}

// Safely write to sessionStorage.
function ssSet(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); }
  catch { /* private mode — swallow */ }
}

// Detect current PDP handle from URL or OG meta.
function detectPdpHandle(): string | null {
  try {
    const m = window.location.pathname.match(/\/products\/([^/?#]+)/);
    if (m) return m[1]!;
  } catch { /* ignore */ }
  try {
    const og = document.querySelector('meta[property="og:url"]')?.getAttribute("content");
    if (og) {
      const m2 = og.match(/\/products\/([^/?#]+)/);
      if (m2) return m2[1]!;
    }
  } catch { /* ignore */ }
  return null;
}

export class IntentEngine {
  private signals: Map<IntentSignal, number> = new Map(); // signal → timestamp (ms)
  private readonly WINDOW_MS = 10 * 60 * 1000;           // 10-minute sliding window
  private sessionStartMs: number;
  private pdpHandle: string | null;
  private pdpOpenMs: number;
  private viewHistory: string[];
  private cartHasItems = false;

  constructor() {
    this.sessionStartMs = Date.now();
    this.pdpHandle = detectPdpHandle();
    this.pdpOpenMs = Date.now();

    // Restore state from sessionStorage across same-session page navigations.
    const raw = ssGet(STORAGE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as Partial<IntentContext & { _signals?: [IntentSignal, number][] }>;
        if (saved._signals) {
          const now = Date.now();
          for (const [sig, ts] of saved._signals) {
            if (now - ts < this.WINDOW_MS) this.signals.set(sig, ts);
          }
        }
        this.viewHistory = (saved.viewHistory ?? []).slice(-5);
        this.sessionStartMs = Date.now() - ((saved.sessionDepthSeconds ?? 0) * 1000);
        this.cartHasItems = saved.cartHasItems ?? false;
      } catch {
        this.viewHistory = [];
      }
    } else {
      this.viewHistory = [];
    }

    // Capture return-visit state BEFORE mutating viewHistory.
    const wasReturnVisit = !!(this.pdpHandle && this.viewHistory.includes(this.pdpHandle));

    // Update view history for this page.
    if (this.pdpHandle) this.pushViewHistory(this.pdpHandle);

    // Detect return visit — same handle was already in viewHistory before this page load.
    if (wasReturnVisit) {
      this.fire("return_visit");
    }
  }

  /** Record a signal with its timestamp, prune expired ones, persist. */
  fire(signal: IntentSignal): void {
    const now = Date.now();
    this.signals.set(signal, now);
    // dwell_90s supersedes dwell_30s — remove lower signal.
    if (signal === "dwell_90s") this.signals.delete("dwell_30s");
    this.pruneExpired();
    this.persist();
  }

  /** Sum of weights for signals active within the sliding window. Capped at 1. */
  getConfidence(): number {
    this.pruneExpired();
    let score = 0;
    for (const [sig] of this.signals) {
      score += SIGNAL_WEIGHTS[sig] ?? 0;
    }
    return Math.min(score, 1);
  }

  /** Derive IntentState from confidence thresholds (arXiv:2404.06017). */
  getState(): IntentState {
    if (this.signals.has("add_no_checkout")) return "CONVERTING";
    const c = this.getConfidence();
    if (c >= 0.65) return "DECIDING";
    if (c >= 0.50) return "CONSIDERING";
    if (c >= 0.30) return "DISCOVERING";
    return "BROWSING";
  }

  /** Full snapshot for the Brain. */
  getContext(): IntentContext {
    this.pruneExpired();
    const activeSignals = Array.from(this.signals.keys());
    const nowMs = Date.now();
    return {
      state: this.getState(),
      confidenceScore: Math.round(this.getConfidence() * 100) / 100,
      activeSignals,
      currentPdpHandle: this.pdpHandle,
      currentPdpDwellSeconds: Math.floor((nowMs - this.pdpOpenMs) / 1000),
      viewHistory: [...this.viewHistory],
      comparedPair: this.detectComparedPair(),
      sessionDepthSeconds: Math.floor((nowMs - this.sessionStartMs) / 1000),
      returnVisit: this.signals.has("return_visit"),
      cartHasItems: this.cartHasItems,
    };
  }

  /** Reset on page navigation. */
  reset(): void {
    this.signals.clear();
    this.pdpHandle = detectPdpHandle();
    this.pdpOpenMs = Date.now();
    // Capture return-visit state BEFORE mutating viewHistory.
    const wasReturnVisit = !!(this.pdpHandle && this.viewHistory.includes(this.pdpHandle));
    if (this.pdpHandle) this.pushViewHistory(this.pdpHandle);
    if (wasReturnVisit) {
      this.fire("return_visit");
    }
    this.persist();
  }

  /** Record ATC + start a 2-minute timer; if no checkout navigation, fire add_no_checkout. */
  recordAtc(): void {
    this.cartHasItems = true;
    let checkedOut = false;
    const onNav = () => { checkedOut = true; };
    window.addEventListener("beforeunload", onNav, { once: true, passive: true });
    setTimeout(() => {
      window.removeEventListener("beforeunload", onNav);
      if (!checkedOut) this.fire("add_no_checkout");
    }, 120_000);
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private pruneExpired(): void {
    const now = Date.now();
    for (const [sig, ts] of this.signals) {
      if (now - ts > this.WINDOW_MS) this.signals.delete(sig);
    }
  }

  private pushViewHistory(handle: string): void {
    // Remove duplicates, push to end, keep last 5.
    this.viewHistory = [...this.viewHistory.filter((h) => h !== handle), handle].slice(-5);
  }

  /**
   * Detect bounce pattern: A→B→A or B→A→B in viewHistory.
   * Returns [A, B] when detected, null otherwise.
   */
  private detectComparedPair(): [string, string] | null {
    const h = this.viewHistory;
    if (h.length < 3) return null;
    // Walk backwards through history looking for [X, Y, X] pattern.
    for (let i = h.length - 1; i >= 2; i--) {
      if (h[i] === h[i - 2] && h[i] !== h[i - 1]) {
        const a = h[i]!;
        const b = h[i - 1]!;
        return [a, b];
      }
    }
    return null;
  }

  private persist(): void {
    try {
      const payload = {
        ...this.getContext(),
        _signals: Array.from(this.signals.entries()),
      };
      ssSet(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* swallow */ }
  }
}
