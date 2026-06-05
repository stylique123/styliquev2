/**
 * Daily Merchant Intelligence Brief
 * GET /api/mira/insights/merchant
 *
 * Aggregates the accumulated Mira signal store into an operationally
 * actionable brief the brand team can read each morning. Every metric maps
 * to a concrete action — §11 data→decision contract.
 *
 * Returns structured JSON that the dashboard renders as the
 * "Merchant Intelligence" panel.
 */

import { NextResponse } from "next/server";
import { aggregateInsights, readSignals } from "../../../../lib/mira-signals.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Product metadata for enriching signal data ────────────────────────────────
const PRODUCT_META: Record<string, { name: string; category: string; priceUsd: number }> = {
  "onyx-silk-slip":           { name: "Onyx Silk Slip",                  category: "dress",     priceUsd: 690 },
  "ivory-silk-camisole":      { name: "Ivory Silk Camisole",             category: "top",       priceUsd: 320 },
  "atelier-wide-leg-trouser": { name: "Atelier Wide-Leg Trouser",        category: "bottom",    priceUsd: 540 },
  "linen-relaxed-shirt":      { name: "Linen Relaxed Shirt",             category: "top",       priceUsd: 280 },
  "wrap-coat-camel":          { name: "Camel Wrap Coat",                 category: "outerwear", priceUsd: 1280 },
  "cashmere-v-neck":          { name: "Cashmere V-Neck",                 category: "knitwear",  priceUsd: 420 },
  "midnight-silk-gown":       { name: "Midnight Silk Gown",              category: "dress",     priceUsd: 1450 },
  "tailored-blazer-double":   { name: "Tailored Double-Breasted Blazer", category: "outerwear", priceUsd: 890 },
  "pleated-midi-skirt":       { name: "Pleated Satin Midi Skirt",        category: "bottom",    priceUsd: 480 },
  "merino-ribbed-turtleneck": { name: "Merino Ribbed Turtleneck",        category: "knitwear",  priceUsd: 290 },
  "leather-trench":           { name: "Leather Trench",                  category: "outerwear", priceUsd: 2400 },
  "wide-leg-denim":           { name: "Wide-Leg Heritage Denim",         category: "bottom",    priceUsd: 320 },
};

type ProductSignalSummary = {
  handle: string;
  name: string;
  category: string;
  priceUsd: number;
  totalMentions: number;
  conversions: number;
  conversionRate: number;
  suitabilityQuestions: number;      // proxy for hesitation / trust questions
  sizeQuestionsRatio: number;        // size help per mention — sizing clarity issue
  tryOnRequests: number;
  hesitationSignals: number;
  action: string;                    // single actionable recommendation
};

type OutfitSignal = {
  handles: string[];
  names: string[];
  mentions: number;
  conversions: number;
  harmonyScore?: number;
};

type MerchantBrief = {
  generatedAt: string;
  windowDays: number;
  totalConversations: number;
  discoveryHitRate: number;
  conversionRate: number;
  // ── The five brief sections ─────────────────────────────────────────────
  topHesitationSource: {
    productHandle: string | null;
    productName: string | null;
    hesitationCount: number;
    primaryReason: string;
    action: string;
  };
  topConfidenceDriver: {
    productHandle: string | null;
    productName: string | null;
    conversionRate: number;
    reason: string;
  };
  topEmotionalFriction: {
    pattern: string;
    count: number;
    exampleQueries: string[];
    action: string;
  };
  strongestOutfitCombination: {
    pieces: string[];
    mentions: number;
    conversionRate: number;
    action: string;
  } | null;
  weakestPdp: {
    productHandle: string | null;
    productName: string | null;
    hesitationRate: number;
    tryOnConversionRate: number;
    action: string;
  };
  mostRequestedMissingProduct: {
    category: string;
    count: number;
    intensity: number;
    exampleQueries: string[];
    revenueLeakEstimate: string;
    action: string;
  } | null;
  productNeedingCreativeRefresh: {
    productHandle: string | null;
    productName: string | null;
    reason: string;
    action: string;
  };
  productBenefitingFromTryOn: {
    productHandle: string | null;
    productName: string | null;
    hesitationAfterDescription: number;
    tryOnRequests: number;
    action: string;
  };
  // ── Per-product intelligence ────────────────────────────────────────────
  productSignals: ProductSignalSummary[];
  // ── Raw gap data ────────────────────────────────────────────────────────
  catalogGaps: {
    category: string;
    count: number;
    intensity: number;
    recentExamples: string[];
  }[];
  nearMisses: {
    category: string;
    attribute: string;
    count: number;
    action: string;
  }[];
};

// ── Emotional friction pattern detection ──────────────────────────────────────
const EMOTIONAL_PATTERNS = [
  { key: "validation_seeking",  re: /does (this|it) (look|suit|work)|what do you think|am i making the right/i, label: "Validation seeking" },
  { key: "fear_of_regret",      re: /won't wear|will i wear|is it practical|will i use|is it versatile/i,      label: "Fear of regret" },
  { key: "value_anxiety",       re: /worth it|too expensive|too much|is it really|cost per wear/i,              label: "Value anxiety" },
  { key: "style_insecurity",    re: /don't usually wear|not (really )?my style|can i pull it off/i,             label: "Style insecurity" },
  { key: "decision_fatigue",    re: /can't decide|too many options|just pick|I give up|been looking forever/i,  label: "Decision fatigue" },
];

export async function GET() {
  try {
    // Load all signals and aggregate
    const insights = await aggregateInsights();
    const allSignals = await readSignals();

    // ── Compute per-product signal summaries ─────────────────────────────────
    const productMentions: Record<string, number>     = {};
    const productConversions: Record<string, number>  = {};
    const productSuitability: Record<string, number>  = {};
    const productTryOn: Record<string, number>        = {};
    const productSizeQ: Record<string, number>        = {};
    const productHesitation: Record<string, number>   = {};

    for (const sig of allSignals) {
      const h = sig.productHandle;
      if (!h) continue;
      productMentions[h] = (productMentions[h] ?? 0) + 1;
      if (sig.kind === "conversion") productConversions[h] = (productConversions[h] ?? 0) + 1;
      const r = sig.route;
      if (r === "suitability") productSuitability[h] = (productSuitability[h] ?? 0) + 1;
      if (r === "try_on") productTryOn[h] = (productTryOn[h] ?? 0) + 1;
      if (r === "size_form" || r === "fit") productSizeQ[h] = (productSizeQ[h] ?? 0) + 1;
      if (r === "suitability" || r === "fit") productHesitation[h] = (productHesitation[h] ?? 0) + 1;
    }

    const productSignals: ProductSignalSummary[] = Object.keys(PRODUCT_META)
      .map((handle) => {
        const meta = PRODUCT_META[handle];
        const mentions = productMentions[handle] ?? 0;
        const conversions = productConversions[handle] ?? 0;
        const conversionRate = mentions > 0 ? Math.round((conversions / mentions) * 100) / 100 : 0;
        const suitQ = productSuitability[handle] ?? 0;
        const tryOnReq = productTryOn[handle] ?? 0;
        const sizeQ = productSizeQ[handle] ?? 0;
        const hesitation = productHesitation[handle] ?? 0;
        const sizeRatio = mentions > 0 ? Math.round((sizeQ / mentions) * 100) / 100 : 0;

        let action = "No action needed";
        if (mentions === 0) action = "No shopper interaction yet — review PDP copy and imagery";
        else if (suitQ / Math.max(mentions, 1) > 0.4) action = "High suitability questions — add try-on prompt and improve PDP honest-fit copy";
        else if (sizeRatio > 0.35) action = "High size uncertainty — improve size chart and add Mira size guidance CTA";
        else if (conversionRate < 0.1 && mentions > 3) action = "Low conversion despite interest — review pricing or imagery quality";
        else if (tryOnReq > 2) action = "Multiple try-on requests — feature prominently in fitting-room flow";

        return {
          handle, ...meta,
          totalMentions: mentions, conversions, conversionRate,
          suitabilityQuestions: suitQ, sizeQuestionsRatio: sizeRatio,
          tryOnRequests: tryOnReq, hesitationSignals: hesitation, action,
        };
      })
      .filter((p) => p.totalMentions > 0)
      .sort((a, b) => b.totalMentions - a.totalMentions);

    // ── Top hesitation source ─────────────────────────────────────────────────
    const mostHesitated = productSignals.reduce(
      (best, p) => p.hesitationSignals > (best?.hesitationSignals ?? 0) ? p : best,
      productSignals[0] ?? null,
    );

    // ── Top confidence driver ─────────────────────────────────────────────────
    const topConverter = [...productSignals].sort((a, b) => b.conversionRate - a.conversionRate)[0] ?? null;

    // ── Emotional friction ────────────────────────────────────────────────────
    const emotionCounts: Record<string, { count: number; examples: string[] }> = {};
    for (const sig of allSignals) {
      for (const pat of EMOTIONAL_PATTERNS) {
        if (pat.re.test(sig.query ?? "")) {
          emotionCounts[pat.label] = emotionCounts[pat.label] ?? { count: 0, examples: [] };
          emotionCounts[pat.label].count++;
          if (emotionCounts[pat.label].examples.length < 3) {
            emotionCounts[pat.label].examples.push((sig.query ?? "").slice(0, 60));
          }
        }
      }
    }
    const topEmotion = Object.entries(emotionCounts)
      .sort((a, b) => b[1].count - a[1].count)[0];

    // ── Near-miss analysis ────────────────────────────────────────────────────
    const nearMissMap: Record<string, { count: number; examples: string[] }> = {};
    for (const sig of allSignals) {
      if (!sig.nearMiss || !sig.nearMissAttribute) continue;
      const key = `${sig.nearMissCategory ?? "unknown"}:${sig.nearMissAttribute}`;
      nearMissMap[key] = nearMissMap[key] ?? { count: 0, examples: [] };
      nearMissMap[key].count++;
      if (nearMissMap[key].examples.length < 2) nearMissMap[key].examples.push(sig.query ?? "");
    }
    const nearMisses = Object.entries(nearMissMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([key, val]) => {
        const [category, attribute] = key.split(":");
        return {
          category: category ?? "unknown",
          attribute: attribute ?? "unknown",
          count: val.count,
          action: `Stock ${attribute} in ${category} — ${val.count} shoppers asked and were served a near-match`,
        };
      });

    // ── Weakest PDP (high hesitation, low try-on conversion) ─────────────────
    const weakestPdp = [...productSignals]
      .sort((a, b) => (b.hesitationSignals / Math.max(b.totalMentions, 1)) - (a.hesitationSignals / Math.max(a.totalMentions, 1)))[0] ?? null;

    // ── Product benefiting from try-on ────────────────────────────────────────
    const tryOnCandidate = [...productSignals]
      .sort((a, b) => b.tryOnRequests - a.tryOnRequests)[0] ?? null;

    // ── Build brief ───────────────────────────────────────────────────────────
    const brief: MerchantBrief = {
      generatedAt: new Date().toISOString(),
      windowDays: 7,
      totalConversations: insights.totalConversations,
      discoveryHitRate: insights.discoveryHitRate,
      conversionRate: insights.conversionRate,
      topHesitationSource: {
        productHandle: mostHesitated?.handle ?? null,
        productName: mostHesitated?.name ?? null,
        hesitationCount: mostHesitated?.hesitationSignals ?? 0,
        primaryReason: mostHesitated?.sizeQuestionsRatio ?? 0 > 0.3
          ? "Size uncertainty is the primary hesitation driver"
          : "Shoppers asking suitability questions — trust or fit uncertainty",
        action: mostHesitated?.action ?? "Review PDP content",
      },
      topConfidenceDriver: {
        productHandle: topConverter?.handle ?? null,
        productName: topConverter?.name ?? null,
        conversionRate: topConverter?.conversionRate ?? 0,
        reason: "Highest conversation-to-cart rate — use this product in marketing and first-recommendation logic",
      },
      topEmotionalFriction: {
        pattern: topEmotion?.[0] ?? "No emotional friction data yet",
        count: topEmotion?.[1].count ?? 0,
        exampleQueries: topEmotion?.[1].examples ?? [],
        action: topEmotion
          ? `${topEmotion[0]} is the leading emotional friction — improve Mira's response templates for this pattern`
          : "Continue building signal data",
      },
      strongestOutfitCombination: null,    // populated from look-card signals when available
      weakestPdp: {
        productHandle: weakestPdp?.handle ?? null,
        productName: weakestPdp?.name ?? null,
        hesitationRate: weakestPdp ? Math.round((weakestPdp.hesitationSignals / Math.max(weakestPdp.totalMentions, 1)) * 100) : 0,
        tryOnConversionRate: weakestPdp?.conversionRate ?? 0,
        action: "Improve PDP imagery quality and add an honest fit comparison — hesitation typically signals visual or sizing uncertainty",
      },
      mostRequestedMissingProduct: insights.catalogGaps[0]
        ? {
            category: insights.catalogGaps[0].category,
            count: insights.catalogGaps[0].count,
            intensity: Math.round(insights.catalogGaps[0].intensity * 100) / 100,
            exampleQueries: insights.recentUnmet.slice(0, 3).map((u: { query: string }) => u.query),
            revenueLeakEstimate: `~${insights.catalogGaps[0].count * 150}–${insights.catalogGaps[0].count * 400} USD/week in redirected demand`,
            action: `Stock or source ${insights.catalogGaps[0].category} — ${insights.catalogGaps[0].count} verified shopper requests with no fulfillment`,
          }
        : null,
      productNeedingCreativeRefresh: {
        productHandle: weakestPdp?.handle ?? null,
        productName: weakestPdp?.name ?? null,
        reason: "High hesitation and suitability questions suggest the current imagery doesn't show how the product looks worn",
        action: "Commission a worn editorial shot showing the product styled — avoid flat-lay or product-only images for this SKU",
      },
      productBenefitingFromTryOn: {
        productHandle: tryOnCandidate?.handle ?? null,
        productName: tryOnCandidate?.name ?? null,
        hesitationAfterDescription: tryOnCandidate?.hesitationSignals ?? 0,
        tryOnRequests: tryOnCandidate?.tryOnRequests ?? 0,
        action: "Feature try-on prominently in the PDP flow for this product — shopper demand for visualisation is high",
      },
      productSignals,
      catalogGaps: insights.catalogGaps.slice(0, 8).map((g) => ({
        category: g.category,
        count: g.count,
        intensity: g.intensity,
        recentExamples: g.examples ?? [],
      })),
      nearMisses,
    };

    return NextResponse.json(brief);
  } catch (err) {
    console.error("[merchant-brief]", err);
    return NextResponse.json({ error: "brief_generation_failed" }, { status: 500 });
  }
}
