/**
 * Mira Event Bridge
 * ─────────────────────────────────────────────────────────────────────────────
 * Connects demo Mira signals to the production Prisma event mesh when the
 * shopify-app is reachable. Falls back gracefully to JSON-only logging.
 *
 * Event flow:
 *   Shopper behavior
 *   → emitEvent() called here
 *   → optional JSON debug mirror when recordLocal is explicitly requested
 *   → IF SHOPIFY_APP_URL is set: POST to /api/mira/event on the shopify-app
 *     → Prisma AnalyticsEvent persisted
 *     → recommendation engine consumes it
 *     → merchant insights updated
 *     → outcome loop triggered on add-to-cart
 *
 * This means the demo route can write exactly one local signal row for the
 * shopper turn, while helper events forward to the production pipeline without
 * duplicating local JSON rows.
 */

import { recordSignal, type RecordSignalInput } from "./mira-signals.server";

// ── Production event shape (matches shopify-app AnalyticsEvent schema) ─────

type ProductionEventPayload = {
  event: string;                       // MIRA_* event name
  shopifyDomain?: string;              // brand identifier when known
  shopperSessionId?: string;           // anonymised shopper ID
  productHandle?: string | null;
  source?: string;
  data?: Record<string, unknown>;
};

// ── Bridge state ─────────────────────────────────────────────────────────────

let _bridgeHealthy = true;       // optimistic — reset on failure
let _lastFailureAt = 0;
const FAILURE_BACKOFF_MS = 60_000; // 1 minute before retrying after a failure

function shouldAttemptBridge(): boolean {
  const url = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_SHOPIFY_APP_URL;
  if (!url || url === "http://localhost:3000") return false; // don't self-loop in demo
  if (!_bridgeHealthy && Date.now() - _lastFailureAt < FAILURE_BACKOFF_MS) return false;
  return true;
}

async function postToProductionMesh(
  baseUrl: string,
  payload: ProductionEventPayload,
): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/api/mira/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.MIRA_EVENT_BRIDGE_SECRET
          ? { "x-stylique-bridge-secret": process.env.MIRA_EVENT_BRIDGE_SECRET }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _bridgeHealthy = true;
  } catch (err) {
    _bridgeHealthy = false;
    _lastFailureAt = Date.now();
    // Silent — never break the shopper flow for analytics
    if (process.env.MIRA_DEBUG) {
      console.warn("[event-bridge] production mesh unreachable:", String(err).slice(0, 80));
    }
  }
}

// ── Unified emit ─────────────────────────────────────────────────────────────

/**
 * Emit a Mira event. Optionally writes to the JSON debug mirror and forwards to
 * the production Prisma event mesh when configured.
 *
 * This is the single emit point — all route.ts event calls go through here.
 */
export async function emitEvent(
  eventName: string,
  input: RecordSignalInput,
  extra?: {
    shopifyDomain?: string;
    shopperCookieId?: string;
    extraPayload?: Record<string, unknown>;
    // When true, ALSO write a local signal row. Default false: the named
    // emit* helpers forward to the production mesh ONLY — route.ts writes
    // exactly ONE consolidated `recordSignal` per turn, so these must not
    // create duplicate turn rows (that double/triple-counted the loop).
    recordLocal?: boolean;
  },
): Promise<void> {
  // 1. Optionally write the local JSON signal store (off by default — see above)
  if (extra?.recordLocal) await recordSignal(input).catch(() => {});

  // 2. Forward to production mesh when available
  if (shouldAttemptBridge()) {
    const url = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_SHOPIFY_APP_URL ?? "";
    const payload: ProductionEventPayload = {
      event: eventName,
      shopifyDomain: extra?.shopifyDomain,
      shopperSessionId: extra?.shopperCookieId,
      productHandle: input.productHandle,
      source: input.source,
      data: {
        intent: input.intent,
        unmet: input.unmet,
        unmetCategory: input.unmetCategory,
        nearMiss: input.nearMiss,
        nearMissCategory: input.nearMissCategory,
        nearMissAttribute: input.nearMissAttribute,
        query: input.query,
        route: input.route,
        ...(extra?.extraPayload ?? {}),
      },
    };
    void postToProductionMesh(url, payload); // fire-and-forget
  }
}

// ── Named event helpers (typed wrappers used by route.ts) ────────────────────

export async function emitIntentCaptured(
  query: string,
  intent: string,
  productHandle: string | null,
  source: "gemini" | "fallback",
): Promise<void> {
  await emitEvent("MIRA_INTENT_CAPTURED", {
    query, route: "intent", intent: intent as RecordSignalInput["intent"],
    productHandle, source,
  });
}

export async function emitProductRecommended(
  query: string,
  productHandle: string,
  route: string,
): Promise<void> {
  await emitEvent("MIRA_PRODUCT_RECOMMENDED", {
    query, route, intent: "specific", productHandle, source: "gemini",
  });
}

export async function emitOutfitRecommended(
  focalHandle: string | null,
  pieceHandles: string[],
): Promise<void> {
  await emitEvent("MIRA_OUTFIT_RECOMMENDED", {
    query: `[outfit: ${pieceHandles.join(",") || (focalHandle ?? "")}]`,
    route: "look", intent: "look",
    productHandle: focalHandle, source: "gemini",
  });
}

export async function emitSizeHelpStarted(productHandle: string | null): Promise<void> {
  await emitEvent("MIRA_SIZE_HELP_STARTED", {
    query: "[size_help]", route: "size_form", intent: "size",
    productHandle, source: "gemini",
  });
}

export async function emitTryOnOffered(productHandle: string | null): Promise<void> {
  await emitEvent("MIRA_TRYON_OFFERED", {
    query: "[tryon_offered]", route: "try_on", intent: "try_on",
    productHandle, source: "gemini",
  });
}

export async function emitHesitationDetected(
  query: string,
  productHandle: string | null,
): Promise<void> {
  await emitEvent("MIRA_HESITATION_DETECTED", {
    query, route: "suitability", intent: "suitability",
    productHandle, source: "gemini",
  });
}

export async function emitAddToCartAssist(
  productHandle: string | null,
  isBundle: boolean,
  bundleSize?: number,
): Promise<void> {
  await emitEvent("MIRA_ADD_TO_CART_ASSIST", {
    query: isBundle ? `[bundle_add:${bundleSize ?? 1}]` : "[add_to_cart]",
    route: "add_to_cart", intent: "specific",
    productHandle, source: "gemini",
  });
}

export async function emitUnmetDemand(
  query: string,
  category: string,
  reason: string,
): Promise<void> {
  await emitEvent("MIRA_UNMET_DEMAND", {
    query, route: "talk_only", intent: "discover",
    productHandle: null, source: "gemini",
    unmet: true, unmetCategory: category, unmetReason: reason,
  });
}

export async function emitNearMiss(
  query: string,
  productHandle: string,
  category: string,
  attribute: string,
  reason: string,
): Promise<void> {
  await emitEvent("CHAT_NEAR_MISS", {
    query, route: "reco_handle", intent: "specific",
    productHandle, source: "gemini",
    nearMiss: true, nearMissCategory: category,
    nearMissAttribute: attribute, nearMissReason: reason,
  });
}

// ── Health check ─────────────────────────────────────────────────────────────

export function getBridgeStatus(): { active: boolean; healthy: boolean; target: string | null } {
  const url = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_SHOPIFY_APP_URL;
  const isDemo = !url || url === "http://localhost:3000";
  return {
    active: !isDemo,
    healthy: _bridgeHealthy,
    target: isDemo ? null : (url ?? null),
  };
}
