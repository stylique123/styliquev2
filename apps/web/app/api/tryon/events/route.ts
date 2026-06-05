/**
 * Try-On Event Analytics API
 * POST /api/tryon/events — receive and persist try-on lifecycle events
 * GET  /api/tryon/events — return try-on analytics summary
 *
 * Events flow from both the standalone PDP Try-On button (trigger: pdp_button)
 * and Mira-guided flows (trigger: mira_suggest / look_card / reco_card).
 * Keeping them separate lets the merchant dashboard distinguish:
 *   - PDP Try-On: direct product-page initiated try-on (captures intent)
 *   - Mira Try-On: assistant-guided confidence recovery (captures hesitation)
 * Both feed the same signal store and merchant intelligence pipeline.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { readSignals } from "../../../lib/mira-signals.server";
import { emitEvent } from "../../../lib/event-bridge.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRYON_EVENTS = [
  "PDP_TRYON_CLICKED",
  "TRYON_RENDER_REQUESTED",
  "TRYON_RENDER_COMPLETED",
  "TRYON_RENDER_FAILED",
  "TRYON_ABANDONED",
  "CART_FROM_TRYON",
  "MIRA_TRYON_OFFERED",
  "MIRA_TRYON_AFTERMATH",
] as const;

const BodySchema = z.object({
  event:         z.enum(TRYON_EVENTS),
  handle:        z.string().max(120).optional(),
  size:          z.string().max(8).optional(),
  trigger:       z.enum(["pdp_button", "mira_suggest", "look_card", "reco_card"]).optional(),
  aftermathType: z.enum(["abandoned_ask", "liked_close", "failed_explain"]).optional(),
  errorCode:     z.string().max(40).optional(),
  cached:        z.boolean().optional(),
  ms:            z.number().optional(),
  shopifyDomain: z.string().max(120).optional(),
  shopperSessionId: z.string().max(160).optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try { json = await req.json(); } catch { return NextResponse.json({ ok: true }); }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: true }); // analytics never hard-fail

  const b = parsed.data;

  // Write to the debug mirror and, when configured, the production AnalyticsEvent
  // mesh. Route name is lowercased so the analytics GET can group by event.
  void emitEvent(b.event, {
    query:         `[${b.event}]${b.handle ? " " + b.handle : ""}`,
    route:         b.event.toLowerCase(),
    intent:        b.trigger === "pdp_button" ? "specific" : "try_on",
    productHandle: b.handle ?? null,
    source:        "gemini",
  }, {
    shopifyDomain: b.shopifyDomain,
    shopperCookieId: b.shopperSessionId,
    extraPayload: {
      productHandle: b.handle,
      size: b.size,
      trigger: b.trigger,
      aftermathType: b.aftermathType,
      errorReason: b.errorCode,
      cached: b.cached,
      latencyMs: typeof b.ms === "number" ? Math.round(b.ms) : undefined,
      mode: "BODY_MODEL",
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function GET() {
  try {
    const signals = await readSignals();

    // Filter to try-on signals only
    const tryon = signals.filter((s) =>
      s.route.includes("tryon") || s.route === "pdp_tryon_clicked",
    );

    const count = (route: string) => tryon.filter((s) => s.route === route).length;

    const pdpClicks     = count("pdp_tryon_clicked");
    const miraOffered   = count("mira_tryon_offered");
    const completed     = count("tryon_render_completed");
    const failed        = count("tryon_render_failed");
    const abandoned     = count("tryon_abandoned");
    const cartFromTryon = count("cart_from_tryon");
    const total = completed + failed + abandoned;

    // Per-product breakdown — groups by handle, top 5 by try-on volume
    const byHandle: Record<string, { total: number; conversions: number }> = {};
    for (const s of tryon) {
      const h = s.productHandle;
      if (!h) continue;
      byHandle[h] = byHandle[h] ?? { total: 0, conversions: 0 };
      byHandle[h].total++;
      if (s.route === "cart_from_tryon") byHandle[h].conversions++;
    }

    const topProductsByTryOn = Object.entries(byHandle)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([handle, v]) => ({
        handle,
        tryOnCount:     v.total,
        cartConversions: v.conversions,
        conversionRate:  v.total > 0 ? Math.round((v.conversions / v.total) * 100) : 0,
      }));

    // Products with high try-on but low cart — need confidence recovery
    const highTryOnLowCart = topProductsByTryOn
      .filter((p) => p.tryOnCount >= 3 && p.conversionRate < 30)
      .map((p) => ({
        handle: p.handle,
        tryOnCount: p.tryOnCount,
        conversionRate: p.conversionRate,
        insight: `High try-on (${p.tryOnCount}x) but low cart conversion (${p.conversionRate}%) — ` +
                 `shopper sees the product but hesitates. Review fit copy, price point, or provide better size guidance post try-on.`,
      }));

    // Merchant insights — 8 as specified
    const insights = [
      pdpClicks > 0
        ? `${pdpClicks} shopper${pdpClicks !== 1 ? "s" : ""} initiated try-on directly from the product page (PDP button — no Mira involvement)`
        : null,
      miraOffered > 0
        ? `${miraOffered} Mira-guided try-on${miraOffered !== 1 ? "s" : ""} — these are confidence recovery moments where Mira judged hesitation before offering`
        : null,
      total > 0
        ? `Try-on completion rate: ${Math.round((completed / total) * 100)}% (${completed} of ${total} attempts)`
        : null,
      failed > 0
        ? `${failed} try-on failure${failed !== 1 ? "s" : ""} — check image quality for: ${topProductsByTryOn.slice(0, 3).map((p) => p.handle).join(", ") || "affected products"}`
        : null,
      cartFromTryon > 0
        ? `Try-on to cart rate: ${Math.round((cartFromTryon / Math.max(completed, 1)) * 100)}% (${cartFromTryon} cart add${cartFromTryon !== 1 ? "s" : ""} directly from try-on)`
        : null,
      abandoned > 0
        ? `${abandoned} shopper${abandoned !== 1 ? "s" : ""} abandoned try-on without adding to cart — prime target for Mira aftermath messaging`
        : null,
      highTryOnLowCart.length > 0
        ? `${highTryOnLowCart.length} product${highTryOnLowCart.length !== 1 ? "s" : ""} have high try-on volume but low cart conversion: ${highTryOnLowCart.map((p) => p.handle).join(", ")}`
        : null,
      failed > 2
        ? `Imagery quality issue detected: ${failed} render failures suggest certain products need try-on-ready photography (garment-focused, clean backdrop, no lifestyle overlap)`
        : null,
    ].filter(Boolean) as string[];

    return NextResponse.json({
      // ── Headline metrics ──────────────────────────────────────────────────
      pdpClicks,
      miraTriggered:    miraOffered,
      completed,
      failed,
      abandoned,
      cartFromTryOn:    cartFromTryon,
      completionRate:   total > 0 ? Math.round((completed / total) * 100) / 100 : 0,
      tryOnToCartRate:  completed > 0 ? Math.round((cartFromTryon / completed) * 100) / 100 : 0,
      failureRate:      total > 0 ? Math.round((failed / total) * 100) / 100 : 0,
      abandonmentRate:  total > 0 ? Math.round((abandoned / total) * 100) / 100 : 0,
      // ── Breakdowns ───────────────────────────────────────────────────────
      topProductsByTryOn,
      highTryOnLowCart,
      // ── Merchant insights ─────────────────────────────────────────────────
      insights,
      // ── Source split — the key distinction ───────────────────────────────
      sourceSplit: {
        pdpInitiated:   pdpClicks,
        miraGuided:     miraOffered,
        pdpPct:         (pdpClicks + miraOffered) > 0
                          ? Math.round((pdpClicks / (pdpClicks + miraOffered)) * 100)
                          : 0,
        miraGuidedPct:  (pdpClicks + miraOffered) > 0
                          ? Math.round((miraOffered / (pdpClicks + miraOffered)) * 100)
                          : 0,
        note: "PDP-initiated = direct product interest. Mira-guided = hesitation recovery. Both matter differently.",
      },
    });
  } catch (err) {
    console.error("[tryon/events GET]", err);
    return NextResponse.json({ error: "analytics_failed" }, { status: 500 });
  }
}
