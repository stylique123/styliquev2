// Mira's hybrid brain, stronger Gemini for UNDERSTANDING, our deterministic
// catalog engine for GROUNDING.
//
// The LLM never invents a product, price, or size. It does one job: read the
// shopper's free-form message (plus the PDP context and recent history) and
// decide (a) what Mira should *say* in her own editorial voice, and (b) which
// grounded `route` the client should execute against the real catalog
// (lib/catalog.ts). The client then builds the cards deterministically, same
// recoMsg / lookMsg / size / fabric builders the regex engine uses.
//
// If GEMINI_API_KEY is absent or the call fails, the client falls back to the
// pure-regex getMiraResponse, so the demo always works. "Wired to a stronger
// Gemini, supported by our backend regex."

import { NextResponse } from "next/server";
import { z } from "zod";
import { products as catalog, buildLook, type Product } from "../../lib/catalog";
import { knowledgePromptBlock } from "../../lib/mira-knowledge.server";
import {
  recordSignal,
  type MiraIntent,
} from "../../lib/mira-signals.server";
import {
  emitIntentCaptured,
  emitProductRecommended,
  emitOutfitRecommended,
  emitSizeHelpStarted,
  emitTryOnOffered,
  emitHesitationDetected,
  emitAddToCartAssist,
  emitUnmetDemand,
  emitNearMiss,
} from "../../lib/event-bridge.server";
import {
  extractSignals,
  decideClose,
  buildClosingContextBlock,
} from "../../lib/closing-intelligence";
import { buildLookContextBlock } from "../../lib/active-look-memory";
import { BodySchema, type MiraDecision, buildSystem, type BrandIdentity, callGemini, enforceExecution, applySalesPolicy, buildPrompt, buildResilientFallback, type MiraDeps } from "@stylique/mira-brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Demo wiring of the brain's injected seams: the local catalog's complete-the-look
// builder + the demo closing-intelligence trio. The demo Product is a structural
// superset of MiraProduct, so this object is cast once at the boundary.
const demoDeps = { buildLook, extractSignals, decideClose, buildClosingContextBlock } as unknown as MiraDeps;






export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    // ── ONE BRAIN, THREE CATALOGS ───────────────────────────────────────────
    // Demo path: no injection → uses the hardcoded 14-product `catalog`.
    // Production path: mira-adapter (stylique-app) sends `injectedCatalog`
    // (merchant's Prisma catalog mapped to Product shape) so a REAL shopper on
    // a REAL Shopify store hits THIS brain code with THEIR products. Identical
    // intelligence — only the catalog source differs.
    const activeCatalog = (parsed.data.injectedCatalog && parsed.data.injectedCatalog.length > 0
      ? (parsed.data.injectedCatalog as unknown as Product[])
      : catalog);
    const activeKnowledge = parsed.data.injectedKnowledge ?? await knowledgePromptBlock();
    // Brand identity: storefront callers inject the merchant's brand POV; demo
    // direct hit gets Stylique Maison defaults.
    const activeBrand: BrandIdentity = parsed.data.injectedBrand ?? {};
    const activeCurrency = parsed.data.injectedCurrency?.toUpperCase();
    const { decision: rawDecision, model: modelUsed } = await callGemini(
      buildPrompt(parsed.data, activeCatalog, demoDeps),
      buildSystem(activeKnowledge, activeCatalog, activeBrand, activeCurrency),
      activeCatalog,
    );
    // Deterministic navigation execution, force the route+handle when the shopper
    // clearly asked to act on the product they're viewing but the model dead-ended.
    let decision = rawDecision
      ? enforceExecution(rawDecision, parsed.data.message, parsed.data.currentProductHandle, !!parsed.data.bodyOnFile || !!parsed.data.knownSize, activeCatalog, parsed.data.history?.length ?? 0)
      : buildResilientFallback(parsed.data, activeCatalog, demoDeps);
    decision = applySalesPolicy(decision, parsed.data, activeCatalog);

    // ── ANTI-REPEAT GUARD ───────────────────────────────────────────────────
    // Pilot found 7/20 conversations where Mira sent the exact same `voice`
    // string on two consecutive turns ("Of course. Here are the most accessible
    // pieces we have.", "Yes, that's for this exact Linen Relaxed Shirt…").
    // When the model returns text byte-identical to the previous mira turn,
    // prefix a short bridge so the shopper never sees a copy-paste. The model
    // chose the same line because the prompt context didn't change much, NOT
    // because that's the right behaviour — the bridge nudges + we log so we
    // can see how often this fires in production.
    if (decision?.voice) {
      const history = parsed.data.history ?? [];
      // Find the most recent mira turn (skip the user's latest message).
      for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i];
        if (h.from === "mira") {
          if (h.text === decision.voice) {
            const BRIDGES = ["Right — ", "Quick — ", "On that — ", "OK — "];
            const pick = BRIDGES[Math.floor(history.length / 2) % BRIDGES.length];
            decision = { ...decision, voice: pick + decision.voice };
            console.warn("[mira] anti-repeat fired", { handle: parsed.data.currentProductHandle, len: decision.voice.length });
          }
          break;
        }
      }
    }
    const responseSource = rawDecision ? "gemini" : "fallback";
    // ── Full event mesh emission ──────────────────────────────────────────────
    // Every turn flows through the event bridge, writes to the JSON debug
    // mirror AND forwards to the production Prisma event mesh when configured.
    // All fire-and-forget, never blocks the reply.
    const productHandle = decision.productHandle ?? parsed.data.currentProductHandle ?? null;

    // ── ONE consolidated turn signal per request (the learning loop) ──────────
    // Everything the brand needs about THIS turn lives on a SINGLE row: intent,
    // the served handle, and any catalog gap / near-miss. This is the fix for
    // the double/triple-count bug, aggregateInsights counts turn rows, so one
    // request must produce exactly one turn row.
    // A served real product on a reco/navigate route is NOT a hard catalog gap,
    // demote any stray unmet=true to a near-miss so it doesn't pollute the
    // catalog-gap ranking (the model occasionally sets both; unmet must be
    // reserved for genuine absences with NO product served).
    const servedReal =
      !!productHandle && (decision.route === "reco_handle" || decision.route === "navigate" || decision.route === "reco_filter" || decision.route === "reco_category");
    const isUnmet = !!(decision.unmet && decision.unmetCategory) && !servedReal;
    // A near-miss is a catalog-gap HINT ("has linen shirts but none cropped"),
    // the productHandle is optional context, NOT a requirement. Requiring it
    // silently dropped the reorder signal whenever the model named a closest
    // piece that failed handle validation (panel P2). Capture on category alone.
    const isNearMiss = !!(decision.nearMiss && decision.nearMissCategory);
    void recordSignal({
      query: parsed.data.message,
      route: decision.route,
      intent: (decision.intent as MiraIntent) ?? "other",
      productHandle,
      source: responseSource,
      unmet: isUnmet,
      unmetCategory: isUnmet ? decision.unmetCategory : undefined,
      unmetReason: isUnmet ? (decision.unmetReason ?? "") : undefined,
      nearMiss: isNearMiss,
      nearMissCategory: isNearMiss ? decision.nearMissCategory : undefined,
      nearMissAttribute: isNearMiss ? (decision.nearMissAttribute ?? "") : undefined,
      nearMissReason: isNearMiss ? (decision.nearMissReason ?? "") : undefined,
    }).catch(() => {});

    // ── Production event mesh forwarding ONLY (no local duplicate rows) ───────
    // These forward to the production Prisma event mesh when SHOPIFY_APP_URL is
    // configured; in the demo they are no-ops. They do NOT write local signals.
    void emitIntentCaptured(parsed.data.message, (decision.intent as MiraIntent) ?? "other", productHandle, responseSource).catch(() => {});
    switch (decision.route) {
      case "reco_handle":
      case "navigate":
        if (productHandle) void emitProductRecommended(parsed.data.message, productHandle, decision.route).catch(() => {});
        break;
      case "look": void emitOutfitRecommended(productHandle, []).catch(() => {}); break;
      case "size_form":
      case "fit": void emitSizeHelpStarted(productHandle).catch(() => {}); break;
      case "try_on": void emitTryOnOffered(productHandle).catch(() => {}); break;
      case "suitability": void emitHesitationDetected(parsed.data.message, productHandle).catch(() => {}); break;
      // NOTE: add_to_cart is Mira OFFERING to bag, NOT a real conversion. We do
      // NOT record a conversion here (that measured the wrong event). A real
      // conversion is recorded only when the shopper actually adds to bag, via
      // POST /api/mira/conversion from the client.
      case "add_to_cart": void emitAddToCartAssist(productHandle, false).catch(() => {}); break;
      default: break;
    }
    if (isUnmet) void emitUnmetDemand(parsed.data.message, decision.unmetCategory!, decision.unmetReason ?? "").catch(() => {});
    if (isNearMiss) void emitNearMiss(parsed.data.message, productHandle!, decision.nearMissCategory!, decision.nearMissAttribute ?? "", decision.nearMissReason ?? "").catch(() => {});

    return NextResponse.json({ source: responseSource, model: modelUsed, decision });
  } catch (err) {
    console.error("[mira] route error", err instanceof Error ? err.message : err);
    const fallback = BodySchema.safeParse(body);
    return NextResponse.json({
      source: "fallback",
      decision: fallback.success ? applySalesPolicy(buildResilientFallback(fallback.data, catalog, demoDeps), fallback.data, catalog) : null,
    });
  }
}
