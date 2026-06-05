// Brain wiring — server side.
//
// This file is where the provider-agnostic Brain (in @stylique/ai) meets the
// actual Stylique runtime: Prisma, analytics, taste, recommendations.
//
//   • Constructs the registry with REAL handlers (Prisma queries, shop scoping).
//   • Registers every model provider whose env key is present.
//   • Exposes a `getBrain()` singleton + a `buildBrainContext()` helper.
//
// When we add Claude or a local Llama, only the `providers` block changes here.

import { reportError } from "./sentry.server";
import { createLogger } from "./logger.server";
import {
  Brain, ToolRegistry,
  salesStylistVariant, defaultStylistVariant, concisedStylistVariant, beautyAdvisorVariant,
  createGeminiProvider, createAnthropicProvider, createOpenAIProvider,
  searchCatalogToolSchema, proposeComboToolSchema, navigateToolSchema,
  addToCartToolSchema, addOutfitToCartToolSchema, offerSignupToolSchema,
  seeOnModelToolSchema, seeOnMeToolSchema, requestCreativeSetToolSchema,
  applyColorRuleToolSchema, suggestOccasionDressingToolSchema,
  compareTwoItemsToolSchema, // Fix 12 — explainWhyComboWorksToolSchema removed
  recallPastPreferenceToolSchema, interpretFitLanguageToolSchema,
  captureShopperProfileToolSchema, matchReferencePhotoToolSchema,
  leadBrowseToolSchema, guideComboWalkthroughToolSchema,
  highlightProductDetailToolSchema, showSizeRecommendationToolSchema,
  checkStockToolSchema, getSizeChartToolSchema,
  // Hybrid AI + Rules layer — multi-model routing + deterministic fact guardrail.
  BrainRouter, RulesEngine, classifyShopperIntent,
  type BrainContext, type BrainCombo, type BrainProduct, type BrainClientAction,
  type BrainCurrentProduct,
  type ToolDef, type ModelProvider,
  type BrainSignal,
} from "@stylique/ai";

import { prisma } from "../db.server";
import { toShopperProduct } from "./serialize";
import { logCatalogGap, readTasteVector } from "./taste.server";
import { markSignupOffered } from "./session.server";
import { getEffectivePlan } from "./entitlement.server";
import { enqueueCreativeSet } from "../queue.server";
import { vectorSearchProducts } from "./embeddings.server";
import { matchByReferenceImage } from "./image-match.server";
import { detectLocale, recommendFit, analyzeColorHarmony, scoreCombo } from "@stylique/core";
import { listRecommendations } from "./recommendations.server";
import { buildBeautyToolHandlers, buildBeautyBrainContext } from "./beauty-brain.server";
import { BEAUTY_TOOL_SCHEMAS } from "@stylique/ai";

// ─── OI-37: Redis cache for recentBehavior ──────────────────────────────────
// Each shopper's top-5 category engagement is stable over a 5-minute window.
// We cache the computed result so repeated chat turns (common in a single
// session) don't re-scan the analytics table on every hop.
// Falls back silently to a fresh DB read when Redis is absent or errors.

const BEHAVIOR_TTL_S = 300; // 5 minutes
let _behaviorRedis: import("ioredis").Redis | null = null;

async function getBehaviorRedis(): Promise<import("ioredis").Redis | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!_behaviorRedis) {
    // Dynamic import (NOT require) — the app runs as an ES module.
    const mod = await import("ioredis");
    const Redis = (mod as { Redis?: typeof import("ioredis").Redis }).Redis
      ?? (mod as { default: typeof import("ioredis").Redis }).default;
    _behaviorRedis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
    _behaviorRedis.on("error", () => { _behaviorRedis = null; });
  }
  return _behaviorRedis;
}

async function getCachedBehavior(
  shopId: string,
  shopperRowId: string,
): Promise<Array<{ category: string; count: number }> | null> {
  const r = await getBehaviorRedis();
  if (!r) return null;
  try {
    const raw = await r.get(`behavior:${shopId}:${shopperRowId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Array<{ category: string; count: number }>;
  } catch { return null; }
}

async function setCachedBehavior(
  shopId: string,
  shopperRowId: string,
  value: Array<{ category: string; count: number }>,
): Promise<void> {
  const r = await getBehaviorRedis();
  if (!r) return;
  try {
    await r.setex(`behavior:${shopId}:${shopperRowId}`, BEHAVIOR_TTL_S, JSON.stringify(value));
  } catch { /* non-fatal — cache miss on next turn */ }
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown, limit = 8): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => typeof v === "string" ? v : typeof v === "object" && v != null && "label" in v ? String((v as { label?: unknown }).label ?? "") : "")
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, limit);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()].slice(0, limit);
  return [];
}

async function loadBrandDNA(shopId: string): Promise<BrainContext["brandDNA"]> {
  const profile = await prisma.brandProfile.findUnique({
    where: { shopId },
    select: { paletteJson: true, toneJson: true, styleVectors: true, trainedAt: true },
  }).catch(() => null);
  if (!profile) return undefined;

  const paletteJson = jsonObject(profile.paletteJson);
  const toneJson = jsonObject(profile.toneJson);
  const styleVectors = jsonObject(profile.styleVectors);
  const palette = [
    ...stringArray(profile.paletteJson),
    ...stringArray(paletteJson.colors),
    ...stringArray(paletteJson.palette),
    ...stringArray(toneJson.colorPalette),
  ].slice(0, 8);
  const tone = [
    ...stringArray(toneJson.voice),
    ...stringArray(toneJson.tone),
    ...stringArray(toneJson.descriptors),
    ...stringArray(toneJson.approvedPatterns),
  ].slice(0, 8);
  const style = [
    ...stringArray(styleVectors.style),
    ...stringArray(styleVectors.visual),
    ...stringArray(styleVectors.silhouettes),
    ...stringArray(toneJson.styleKeywords),
  ].slice(0, 8);
  const creativeMemory = [
    ...stringArray(toneJson.creativeApprovals),
    ...stringArray(toneJson.creativeRejections),
    ...stringArray(toneJson.creativeMemory),
  ].slice(0, 8);
  if (!palette.length && !tone.length && !style.length && !creativeMemory.length) return undefined;
  return { palette, tone, style, creativeMemory, trainedAt: profile.trainedAt };
}

// ─── Helpers (size-chart → skuMeasurements) ─────────────────────────────
/**
 * Parse Product.sizeChartJson into Record<size, SkuMeasurements> for recommendFit.
 * Mirrors the shopper.server.ts parser. Returns undefined when unparseable so
 * recommendFit falls back to category defaults.
 */
function parseSkuMeasurementsForFit(
  json: unknown,
): Record<string, { chest?: number; waist?: number; hip?: number; length?: number; sleeve?: number }> | undefined {
  if (!json) return undefined;
  try {
    const chart = json as { sizes?: Array<{ name?: string; chest?: number; waist?: number; hip?: number; length?: number; sleeve?: number }> };
    if (!Array.isArray(chart.sizes)) return undefined;
    const out: Record<string, { chest?: number; waist?: number; hip?: number; length?: number; sleeve?: number }> = {};
    for (const s of chart.sizes) {
      if (!s.name) continue;
      out[s.name] = {
        chest: s.chest, waist: s.waist, hip: s.hip, length: s.length, sleeve: s.sleeve,
      };
    }
    return Object.keys(out).length ? out : undefined;
  } catch { return undefined; }
}

// ─── Module logger ───────────────────────────────────────────────────────
const brainLog = createLogger({ component: "brain" });

// ─── Singleton ───────────────────────────────────────────────────────────

let _brain: Brain | null = null;

export function getBrain(): Brain {
  if (_brain) return _brain;

  // PILOT KILL SWITCH: set ENABLE_MIRA=false to disable Mira instantly without redeploy
  if (process.env.ENABLE_MIRA === 'false') {
    throw new Error('chat_unavailable');
  }

  // Providers — only those whose key is configured get registered.
  const providers: Record<string, ModelProvider> = {};
  if (process.env.GEMINI_API_KEY) {
    providers.gemini = createGeminiProvider({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
    });
  }
  // Stub providers — register so config can name them, but they throw on call
  // until their respective API keys land. This is the provider-agnosticism
  // proof: a Brain.run({ providerKey: "anthropic" }) will fail loudly with
  // "anthropic_not_configured", not silently fall back.
  providers.anthropic = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
  providers.openai    = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

  if (Object.keys(providers).length === 0) {
    throw new Error("brain_no_providers_configured");
  }

  // Registry + tool handlers.
  const tools = new ToolRegistry();
  tools.registerMany(toolsWithHandlers());

  // Beauty mode — register beauty tools when the shop has brandMode "beauty".
  // We register them always (gated by requiresFeature in the schema) so the
  // registry is ready regardless of which shop triggers the first request.
  const beautyHandlers = buildBeautyToolHandlers();
  const beautyToolDefs = BEAUTY_TOOL_SCHEMAS.map(schema => ({
    ...schema,
    handler: beautyHandlers[schema.name] ?? (async () => ({ error: "handler_not_found" })),
  }));
  tools.registerMany(beautyToolDefs);

  // ─── Hybrid AI + Rules layer (multi-model routing + fact guardrail) ──────
  //
  // Router: cheap → standard → strong. Today cheap === standard === the Gemini
  // Flash provider (a placeholder until a faster/cheaper tier is configured),
  // and `strong` is null until a strong-reasoning key (ANTHROPIC_API_KEY /
  // STRONG_MODEL_API_KEY) lands — high-complexity turns fall back to standard.
  // When the day comes, this is the ONLY block that changes.
  const geminiProvider = providers.gemini ?? null;
  const strongProvider =
    (process.env.ANTHROPIC_API_KEY || process.env.STRONG_MODEL_API_KEY)
      ? providers.anthropic
      : null;

  const router = geminiProvider
    ? new BrainRouter({
        cheap: geminiProvider,
        standard: geminiProvider,   // same for now — placeholder for a future cheaper/faster tier
        strong: strongProvider,
      })
    : undefined;

  // Rules engine — validates combos / navigate / sizes / cart / inventory
  // against hydrated catalog facts before they reach the shopper. Pure + sync.
  const rules = new RulesEngine();

  // Cheap pre-flight classifier — only wired when GEMINI_API_KEY is present
  // (it makes its own direct Flash call). Never throws (safe fallback inside).
  const geminiKey = process.env.GEMINI_API_KEY;
  const classify = geminiKey
    ? (message: string, pageContext: unknown) =>
        classifyShopperIntent(
          message,
          pageContext as Parameters<typeof classifyShopperIntent>[1],
          geminiKey,
        )
    : undefined;

  _brain = new Brain({
    providers,
    defaultProviderKey: process.env.GEMINI_API_KEY ? "gemini" : Object.keys(providers)[0],
    tools,
    promptVariants: {
      // sales_stylist is the proactive AI sales-stylist build and the new
      // canonical default; `default` aliases it so the Brain's required
      // "default" key resolves to the same prompt.
      default:        defaultStylistVariant,
      sales_stylist:  salesStylistVariant,
      // Router selects "concise" for low-complexity STARTER turns — alias it
      // to the existing concise/terse stylist variant.
      concise:        concisedStylistVariant,
      terse:          concisedStylistVariant,
      beauty:         beautyAdvisorVariant,
    },
    // Optional hybrid layer — additive. Absent any of these, the Brain runs
    // exactly as before.
    router,
    rules,
    classify,
    // Post-run signal sink: surface the routing decision so merchants can see
    // which model handled which turn (and why) in the central analytics log.
    onSignal: handleBrainSignal,
  });
  return _brain;
}

// Central post-run signal sink. Today it logs the routing decision (which model
// handled the turn + why) on the run-level lifecycle signal so the cost-routing
// is observable. Per-tool signals flow through here too; analytics mapping of
// those happens in chat.server.ts where the surface context lives. Never throws
// (the Brain wraps this call, but we keep it defensive anyway).
function handleBrainSignal(signal: BrainSignal): void {
  if (signal.type === "run:complete" && signal.data?.routing) {
    const r = signal.data.routing as { provider?: string; intent?: string; complexity?: string; reason?: string };
    brainLog.info(
      { shopId: signal.shopId, provider: r.provider, intent: r.intent, complexity: r.complexity, reason: r.reason },
      "brain.routing",
    );
  }
}

// ─── Tool handlers — bind schemas to Prisma + services ───────────────────

function toolsWithHandlers(): ToolDef[] {
  return [
    { ...searchCatalogToolSchema, handler: handleSearchCatalog },
    { ...proposeComboToolSchema,  handler: handleProposeCombo },
    { ...navigateToolSchema,      handler: handleNavigate },
    { ...addToCartToolSchema,     handler: handleAddToCart },
    { ...(addOutfitToCartToolSchema as ToolDef), handler: handleAddOutfitToCart },
    { ...offerSignupToolSchema,   handler: handleOfferSignup },
    // Phase 2 — try-on on Stylist combos. Handlers validate productIds against
    // the shop's catalog then emit an open_tryon client action. The Stylist
    // dock receives this and dispatches a stylique:request-tryon event the
    // widget listens for (cross-surface coordination already wired).
    { ...seeOnModelToolSchema, handler: handleSeeOnModel },
    { ...seeOnMeToolSchema,    handler: handleSeeOnMe },
    // Sprint 2 — Stylist can now trigger Studio creative generation directly.
    // Real handler below: creates a CreativeSet row + enqueues a job. The
    // worker actually calls the upstream image/video providers asynchronously.
    { ...requestCreativeSetToolSchema, handler: handleRequestCreativeSet },
    // Sprint 3 — Skills layer. Domain reasoning the model can call to ground
    // confident decisions without hallucinating.
    { ...applyColorRuleToolSchema,           handler: handleApplyColorRule },
    { ...suggestOccasionDressingToolSchema,  handler: handleSuggestOccasion },
    { ...compareTwoItemsToolSchema,          handler: handleCompareTwoItems },
    // Fix 12 — explain_why_combo_works removed; whyItWorks is now embedded in propose_combo reasoning.
    // { ...explainWhyComboWorksToolSchema,     handler: handleExplainCombo },
    { ...recallPastPreferenceToolSchema,     handler: handleRecallPastPreference },
    // Guided extraction — translate the shopper's free-text into structured
    // fit preferences without making them think about jargon.
    { ...interpretFitLanguageToolSchema,     handler: handleInterpretFitLanguage },
    // Cross-surface bridge — Mira's saves land in ShopperSession, where
    // the Widget's Fit step reads them on mount.
    { ...captureShopperProfileToolSchema,    handler: handleCaptureShopperProfile },
    // Tier-A #3 — reference-photo matching. Vision-bridge image encoder +
    // text-embedding ranks against ProductEmbedding rows.
    { ...matchReferencePhotoToolSchema,      handler: handleMatchReferencePhoto },
    // D40 — combo try-on: render all outfit pieces sequentially on a muse.
    { ...comboTryOnToolSchema, handler: handleComboTryOn },
    // Guided shopping — Rufus-pattern page-aware navigation + detail highlighting.
    { ...leadBrowseToolSchema,              handler: handleLeadBrowse },
    { ...guideComboWalkthroughToolSchema,   handler: handleGuideComboWalkthrough },
    { ...highlightProductDetailToolSchema,  handler: handleHighlightProductDetail },
    { ...showSizeRecommendationToolSchema,  handler: handleShowSizeRecommendation },
    // Stock + size-chart intelligence (Request B) — real availability +
    // the brand's actual garment measurements, both shopId-scoped.
    { ...checkStockToolSchema,   handler: handleCheckStock },
    { ...getSizeChartToolSchema, handler: handleGetSizeChart },
    // ─── Mira floor-salesperson tools — schemas inline below ──────────────
    // Six new tools that turn Mira into a real in-store associate: explain the
    // piece in front of the shopper, complete the look, offer the fitting room
    // at the right moment, read hesitation, close the sale, and capture demand
    // we can't meet (the learning-loop signal, production port of D60).
    { ...explainProductToolSchema,      handler: handleExplainProduct },
    { ...completeOutfitToolSchema,      handler: handleCompleteOutfit },
    { ...offerTryonNaturalToolSchema,   handler: handleOfferTryonNatural },
    { ...captureHesitationToolSchema,   handler: handleCaptureHesitation },
    { ...closeSaleToolSchema,           handler: handleCloseSale },
    { ...captureUnmetDemandToolSchema,  handler: handleCaptureUnmetDemand },
  ];
}

// ─── match_reference_photo ─────────────────────────────────────────────
async function handleMatchReferencePhoto(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "data"; data: { products: BrainProduct[]; caption: string } }> {
  const limit = Math.min(Math.max(Number(args.limit ?? 8), 1), 20);
  const dataUrl = ctx.cache.get("reference_image") as string | undefined;
  if (!dataUrl) {
    ctx.log({ name: "CHAT_IMAGE_MATCH_RUN", payload: { reason: "no_reference_image", resultCount: 0 } });
    return { kind: "data", data: { products: [], caption: "" } };
  }

  // Parse data URL — already validated by the chat route's MIME regex.
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
  if (!m) return { kind: "data", data: { products: [], caption: "" } };
  const mime = m[1]!;
  const base64 = m[2]!;

  const { caption, matches } = await matchByReferenceImage({
    shopId: ctx.shopId,
    imageBase64: base64,
    mime,
    limit,
  });

  if (!matches.length) {
    ctx.log({ name: "CHAT_IMAGE_MATCH_RUN", payload: { caption: caption.slice(0, 200), resultCount: 0 } });
    return { kind: "data", data: { products: [], caption } };
  }

  // Hydrate matched products — shopId guard is defensive (vectorSearch is
  // already shopId-scoped; never drop it).
  const ids = matches.map((x) => x.productId);
  const rows = await prisma.product.findMany({
    where: { shopId: ctx.shopId, id: { in: ids } },
    include: {
      images:   { orderBy: { position: "asc" }, take: 1 },
      variants: { select: { size: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const products: BrainProduct[] = [];
  for (const hit of matches) {
    const r = byId.get(hit.productId);
    if (r) {
      const bp = toBrainProduct(r);
      ctx.cache.set(`product:${bp.id}`, bp);
      products.push(bp);
    }
  }

  ctx.log({
    name: "CHAT_IMAGE_MATCH_RUN",
    payload: { caption: caption.slice(0, 200), resultCount: products.length, topScore: matches[0]?.score },
  });

  return { kind: "data", data: { products, caption } };
}

// ─── search_catalog ──────────────────────────────────────────────────────

async function handleSearchCatalog(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "data"; data: { products: BrainProduct[] } }> {
  const q = String(args.query ?? "").trim();
  const category = (args.category as string | undefined)?.trim();
  const colorFamily = (args.colorFamily as string | undefined)?.trim();
  const maxPriceUsd = args.maxPriceUsd != null ? Number(args.maxPriceUsd) : undefined;
  const minPriceUsd = args.minPriceUsd != null ? Number(args.minPriceUsd) : undefined;
  const limit = Math.min(Math.max(Number(args.limit ?? 8), 1), 20);

  const tokens = q.split(/\s+/).filter((t) => t.length > 1).slice(0, 4);
  const where: Record<string, unknown> = { shopId: ctx.shopId };
  if (category) where.category = { equals: category, mode: "insensitive" };
  if (colorFamily) where.colorFamily = { equals: colorFamily, mode: "insensitive" };
  if (tokens.length) {
    where.AND = tokens.map((t) => ({
      OR: [
        { title: { contains: t, mode: "insensitive" as const } },
        { tags: { has: t.toLowerCase() } },
        { category: { contains: t, mode: "insensitive" as const } },
      ],
    }));
  }

  // Always include priceCents so we can apply budget filtering without a
  // second query. The extra field is tiny. Price is stored as cents (Int?)
  // in ProductVariant.priceCents — divide by 100 to get USD display price.
  const hasBudget = maxPriceUsd != null || minPriceUsd != null;

  const rows = await prisma.product.findMany({
    where, take: hasBudget ? limit * 3 : limit, // over-fetch when we'll post-filter
    include: {
      images:   { orderBy: { position: "asc" }, take: 1 },
      variants: { select: { size: true, priceCents: true } },
    },
  });

  // Post-filter by price — keep products where at least one variant is
  // within the stated budget. Unknown prices (null) always pass through.
  type FetchedRow = (typeof rows)[number];
  const priceMatches = (row: FetchedRow): boolean => {
    if (!hasBudget) return true;
    return row.variants.some((v) => {
      if (v.priceCents == null) return true; // unknown price → include
      const priceUsd = v.priceCents / 100;
      if (maxPriceUsd != null && priceUsd > maxPriceUsd) return false;
      if (minPriceUsd != null && priceUsd < minPriceUsd) return false;
      return true;
    });
  };

  const filteredRows = hasBudget ? rows.filter(priceMatches).slice(0, limit) : rows;

  const products = filteredRows.map(toBrainProduct);

  // Vector fallback — when keyword/ILIKE search is thin AND the query is
  // semantic enough to be worth embedding. Tier-A lift from NVIDIA blueprint
  // + Chroma pattern. SECURITY: vectorSearchProducts is shopId-scoped.
  if (products.length < 3 && q.length > 5) {
    const need = limit - products.length;
    const haveIds = new Set(products.map((p) => p.id));
    try {
      const hits = await vectorSearchProducts({ shopId: ctx.shopId, query: q, limit: need + 4 });
      const newIds = hits.map((h) => h.productId).filter((id) => !haveIds.has(id));
      if (newIds.length) {
        const vrows = await prisma.product.findMany({
          // shopId guard is defensive (already scoped above) — never drop it.
          where: { shopId: ctx.shopId, id: { in: newIds } },
          include: {
            images:   { orderBy: { position: "asc" }, take: 1 },
            variants: { select: { size: true, priceCents: true } },
          },
          take: need * 3,
        });
        // Preserve cosine-rank order + apply same price filter.
        const filteredVrows = hasBudget ? vrows.filter(priceMatches) : vrows;
        const byId = new Map(filteredVrows.map((r) => [r.id, r]));
        for (const id of newIds) {
          const r = byId.get(id);
          if (r) products.push(toBrainProduct(r));
          if (products.length >= limit) break;
        }
      }
    } catch {
      // Fail-open — ILIKE results still returned.
    }
  }

  for (const p of products) ctx.cache.set(`product:${p.id}`, p);

  // Analytics + catalog gap capture.
  const isGap = q.length > 1 && products.length < 2;
  ctx.log({
    name: "CHAT_SEARCH_RUN",
    payload: { query: q.slice(0, 200), resultCount: products.length, category, colorFamily, gap: isGap },
  });
  if (isGap) {
    void logCatalogGap({
      shopId: ctx.shopId, shopperRowId: ctx.shopperRowId, rawQuery: q,
      resultCount: products.length, category, colorFamily, source: "chat_search",
    });
  }

  return { kind: "data", data: { products } };
}

// ─── propose_combo ───────────────────────────────────────────────────────

async function handleProposeCombo(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "combo"; combo: BrainCombo }> {
  const ids = (args.productIds as string[] | undefined ?? []).slice(0, 4);
  const name = String(args.name ?? "").slice(0, 80);
  const reasoning = String(args.reasoning ?? "").slice(0, 280);

  // Resolve from per-turn cache first.
  const missing = ids.filter((id) => !ctx.cache.has(`product:${id}`));
  if (missing.length) {
    const rows = await prisma.product.findMany({
      where: { shopId: ctx.shopId, id: { in: missing } },
      include: {
        images:   { orderBy: { position: "asc" }, take: 1 },
        variants: { select: { size: true } },
      },
    });
    for (const r of rows) ctx.cache.set(`product:${r.id}`, toBrainProduct(r));
  }
  const products = ids
    .map((id) => ctx.cache.get(`product:${id}`) as BrainProduct | undefined)
    .filter((p): p is BrainProduct => Boolean(p));

  // Fix 7 — compute color harmony + combo score so Mira can explain WHY it works.
  // The result is appended to the reasoning so the model sees it inline and can
  // quote it naturally. Non-blocking — failures fall through to bare reasoning.
  let enrichedReasoning = reasoning;
  try {
    if (products.length >= 2) {
      const palette = products.map((p) => p.primaryColor ?? "#888888");
      const harmony = analyzeColorHarmony({ palette });
      const score = scoreCombo({
        pieces: products.map((p) => ({
          id: p.id, handle: p.handle, title: p.title,
          category: p.category ?? null,
          primaryColor: p.primaryColor ?? null,
          // NOTE (D-consolidation): the graded color theory is already live here.
          // The conversion term (price elasticity + keepRate) falls back to neutral
          // until toBrainProduct carries price/stock — a follow-up stage will widen
          // the serializer so impulse-add scoring goes live for combos too.
        })),
      });
      const reasonParts: string[] = [];
      if (harmony.harmonyType && harmony.harmonyType !== "uncategorized") {
        reasonParts.push(`${harmony.harmonyType.replace(/_/g, " ")} palette`);
      }
      if (score.breakdown.silhouetteBalance > 0.5) reasonParts.push("balanced silhouette");
      if (score.breakdown.coverage >= 0.7) reasonParts.push("complete look");
      const whyItWorks = reasonParts.join(" · ");
      if (whyItWorks) enrichedReasoning = `${reasoning} | ${whyItWorks}`;
    }
  } catch { /* non-blocking — score is enhancement only */ }

  ctx.log({
    name: "CHAT_COMBO_PROPOSED",
    payload: { comboName: name, productIds: products.map((p) => p.id), reasoning: enrichedReasoning },
  });

  return { kind: "combo", combo: { name, reasoning: enrichedReasoning, products } };
}

// ─── navigate ────────────────────────────────────────────────────────────

async function handleNavigate(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "action"; action: BrainClientAction }> {
  const handle = String(args.handle ?? "").trim();
  const exists = await prisma.product.findFirst({
    where: { shopId: ctx.shopId, handle }, select: { id: true },
  });
  if (exists) {
    ctx.log({ name: "CHAT_NAV_REQUESTED", productId: exists.id, payload: { productHandle: handle } });
    return { kind: "action", action: { kind: "navigate", handle } };
  }
  return { kind: "action", action: { kind: "navigate", handle: "" } };
}

// ─── add_to_cart_request ─────────────────────────────────────────────────

async function handleAddToCart(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "action"; action: BrainClientAction }> {
  const productId = String(args.productId ?? "");
  const suggestedSize = args.suggestedSize ? String(args.suggestedSize) : undefined;
  const exists = await prisma.product.findFirst({
    where: { shopId: ctx.shopId, id: productId }, select: { id: true },
  });
  if (!exists) {
    return { kind: "action", action: { kind: "add_to_cart_request", productId: "", suggestedSize: undefined } };
  }
  ctx.log({ name: "CHAT_CART_REQUESTED", productId, payload: { productId, suggestedSize } });
  return { kind: "action", action: { kind: "add_to_cart_request", productId, suggestedSize } };
}

// ─── add_outfit_to_cart ──────────────────────────────────────────────────

async function handleAddOutfitToCart(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "action"; action: BrainClientAction } | { kind: "error"; error: string }> {
  const items = (args.items as Array<{ productId?: string; handle?: string; suggestedSize?: string }>) ?? [];
  if (!items.length) return { kind: "error", error: "no_items" };

  // Validate every productId is in this shop's catalog.
  const resolvedItems: Array<{ productId: string; suggestedSize?: string }> = [];
  for (const item of items) {
    const p = await prisma.product.findFirst({
      where: {
        shopId: ctx.shopId,
        ...(item.productId ? { id: item.productId } : { handle: item.handle }),
      },
      select: { id: true },
    });
    if (p) resolvedItems.push({ productId: p.id, suggestedSize: item.suggestedSize });
  }

  if (!resolvedItems.length) return { kind: "error", error: "no_valid_products" };

  return {
    kind: "action" as const,
    action: {
      kind: "add_outfit_to_cart" as const,
      items: resolvedItems,
      comboName: String(args.comboName ?? ""),
    } satisfies BrainClientAction,
  };
}

// ─── offer_account_signup ────────────────────────────────────────────────

async function handleOfferSignup(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "action"; action: BrainClientAction } | { kind: "data"; data: { error: string } }> {
  if (ctx.accountClaimed || ctx.signupAlreadyOffered) {
    return { kind: "data", data: { error: "already_handled" } };
  }
  await markSignupOffered(ctx.shopperRowId);
  const reason = String(args.reason ?? "").slice(0, 200);
  ctx.log({ name: "SIGNUP_OFFERED", payload: { reason } });
  return { kind: "action", action: { kind: "show_signup_card", reason } };
}

// ─── see_on_model / see_on_me — Phase 2 try-on ────────────────────────

async function handleSeeOnModel(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "action"; action: BrainClientAction }> {
  const ids = (args.productIds as string[] | undefined ?? []).slice(0, 4);
  const modelHint = args.modelHint ? String(args.modelHint) : undefined;
  // Validate every id is in this shop's catalog before we tell the widget
  // to render it. Prevents the model from sending phantom ids.
  const valid = await prisma.product.findMany({
    where: { shopId: ctx.shopId, id: { in: ids } },
    select: { id: true },
  });
  const productIds = valid.map((v) => v.id);
  // NOTE: Do NOT emit TRYON_RENDER_REQUESTED here. That event is fired by
  // tryon.server.ts with the correct schema-compliant payload once the widget
  // actually calls /api/tryon/render. Emitting it here would double-count and
  // would produce a payload that doesn't match EventNameSchema requirements
  // (productId: string — singular, not array; mode: "BODY_MODEL"|"PERSONAL_PHOTO").
  return {
    kind: "action",
    // autoRender: true — body-model mode has everything (productId + modelHint)
    // to fire /api/tryon/render the moment the widget opens. Mira promises
    // "I'll render this on her" and we deliver, no extra click.
    action: { kind: "open_tryon", mode: "model", productIds, modelHint, autoRender: true },
  };
}

async function handleSeeOnMe(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "action"; action: BrainClientAction }> {
  const ids = (args.productIds as string[] | undefined ?? []).slice(0, 4);
  const valid = await prisma.product.findMany({
    where: { shopId: ctx.shopId, id: { in: ids } },
    select: { id: true },
  });
  const productIds = valid.map((v) => v.id);
  // NOTE: Do NOT emit TRYON_RENDER_REQUESTED here — fired by tryon.server.ts
  // once /api/tryon/render is actually called. See handleSeeOnModel note.
  return {
    kind: "action",
    // autoRender: false — personal-photo needs the shopper to upload first.
    // Widget opens at the upload card; render fires on the upload + click.
    action: { kind: "open_tryon", mode: "photo", productIds, autoRender: false },
  };
}

// ─── request_creative_set — Stylist → Studio cross-call ────────────────

async function handleRequestCreativeSet(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "action"; action: BrainClientAction } | { kind: "data"; data: { error: string } }> {
  const productId = String(args.productId ?? "");
  const sourceComboName = args.sourceComboName ? String(args.sourceComboName).slice(0, 80) : undefined;
  const brief = args.brief ? String(args.brief).slice(0, 400) : undefined;

  // Validate the product belongs to this shop.
  const product = await prisma.product.findFirst({
    where: { shopId: ctx.shopId, id: productId },
    select: { id: true, title: true },
  });
  if (!product) return { kind: "data", data: { error: "product_not_found" } };

  // Create the CreativeSet row first so we have an id to enqueue + trace.
  const set = await prisma.creativeSet.create({
    data: {
      shopId: ctx.shopId,
      productId: product.id,
      status: "PENDING",
      brief: brief ? { brief, sourceComboName } : { sourceComboName },
      triggeredBy: sourceComboName
        ? `stylist_combo:${sourceComboName}`
        : `stylist:${ctx.shopperSessionId.slice(0, 8)}`,
    },
    select: { id: true },
  });

  // Best-effort enqueue. Failure here means the worker won't pick it up; we
  // still keep the PENDING row so the brand-side dashboard can see the intent
  // and an admin can re-enqueue later.
  void enqueueCreativeSet({
    shopId: ctx.shopId,
    setId: set.id,
    productId: product.id,
    triggeredBy: sourceComboName ? `stylist_combo:${sourceComboName}` : "stylist",
    brief,
  }).catch(() => undefined);

  ctx.log({
    name: "CREATIVE_SET_GENERATED",
    productId: product.id,
    payload: { setId: set.id, assetCount: 5 }, // 4 stills + 1 motion is our v1 pattern
  });

  return {
    kind: "action",
    action: { kind: "open_studio", sourceComboName: sourceComboName ?? product.title, productIds: [product.id] },
  };
}

// ─── Skills layer handlers (Sprint 3) ──────────────────────────────────
// These don't hit the catalog. They return structured guidance the model
// uses to reason. Think of them as the stylist's training data, callable.

async function handleApplyColorRule(args: Record<string, unknown>, _ctx: BrainContext): Promise<{ kind: "data"; data: Record<string, unknown> }> {
  const anchor = String(args.anchorColorFamily ?? "").toLowerCase();
  const intensity = String(args.anchorIntensity ?? "").toLowerCase();
  // Hand-tuned colour rules. Cheap, fast, decisive — the model gets a clear
  // answer instead of guessing.
  const RULES: Record<string, { complementary: string[]; analogous: string[]; neutralAnchors: string[]; avoid: string[] }> = {
    warm:    { complementary: ["cool blue", "navy"], analogous: ["bronze", "rust", "olive"], neutralAnchors: ["cream", "camel"], avoid: ["fuchsia", "lime"] },
    cool:    { complementary: ["warm bronze", "camel"], analogous: ["slate", "ice"], neutralAnchors: ["ivory", "charcoal"], avoid: ["mustard yellow"] },
    neutral: { complementary: ["any saturated accent"], analogous: ["cream", "stone", "sand"], neutralAnchors: ["bone", "ivory", "charcoal"], avoid: ["clashing brights together"] },
    brown:   { complementary: ["cream", "ivory"], analogous: ["cognac", "camel", "rust"], neutralAnchors: ["bone", "black"], avoid: ["pure white head-to-toe"] },
    black:   { complementary: ["bone", "ivory", "metallic"], analogous: ["charcoal", "midnight"], neutralAnchors: ["cream", "camel"], avoid: ["black + navy without a break"] },
    white:   { complementary: ["onyx", "black"], analogous: ["cream", "bone", "ivory"], neutralAnchors: ["camel", "charcoal"], avoid: ["mixing whites with different undertones"] },
  };
  const rule = RULES[anchor] ?? RULES.neutral;

  // Fix 10 — anchorIntensity now actually shapes the guidance instead of being
  // a passive parameter. Tells Mira how strongly to lean on the anchor when
  // composing the look, and adjusts the contrast bias accordingly.
  const intensityHints: Record<string, { contrastBias: number; lean: string }> = {
    saturated: { contrastBias:  0.15, lean: "let the anchor dominate — one strong accent, the rest neutral" },
    muted:     { contrastBias: -0.05, lean: "build a tonal palette — small tonal shifts, no loud accents" },
    dark:      { contrastBias:  0.10, lean: "anchor reads as the look's gravity — lift with one lighter neutral" },
    pastel:    { contrastBias: -0.10, lean: "keep everything in soft register — no high-contrast pieces" },
  };
  const intensityRule = intensityHints[intensity] ?? { contrastBias: 0, lean: "balance the palette evenly" };
  const baseHint = "Lead the look with the anchor; let the rest of the palette breathe — one accent only.";
  return {
    kind: "data",
    data: {
      anchor,
      intensity,
      ...rule,
      contrastBias: intensityRule.contrastBias,
      hint: `${baseHint} ${intensityRule.lean}.`,
    },
  };
}

async function handleSuggestOccasion(args: Record<string, unknown>, _ctx: BrainContext): Promise<{ kind: "data"; data: Record<string, unknown> }> {
  const occasion = String(args.occasion ?? "").toLowerCase();
  const time = String(args.timeOfDay ?? "").toLowerCase();
  // Decision-tree dress code. Returns: silhouette guidance, formality 1-5,
  // material families, and a "lean" instruction. The model uses these to
  // shape its catalog search.
  const tier = (...kws: string[]) => kws.some((k) => occasion.includes(k));
  let formality = 3; let silhouette = "balanced"; let lean = "smart casual"; let materials: string[] = ["cotton", "linen", "wool blend"];
  if (tier("wedding", "gala", "black tie")) { formality = 5; silhouette = "structured or fluid evening"; lean = "elevated evening"; materials = ["silk", "satin", "crepe"]; }
  else if (tier("work", "office", "meeting", "interview")) { formality = 4; silhouette = "tailored"; lean = "polished tailoring"; materials = ["wool", "fine knit", "crepe"]; }
  else if (tier("brunch", "lunch", "daytime")) { formality = 2; silhouette = "relaxed but considered"; lean = "easy daytime"; materials = ["linen", "cotton", "light knit"]; }
  else if (tier("dinner", "date", "drinks")) { formality = 4; silhouette = "elegant"; lean = "evening but not gala"; materials = ["silk", "satin", "fine wool"]; }
  else if (tier("weekend", "casual", "errand", "coffee")) { formality = 1; silhouette = "easy"; lean = "elevated casual"; materials = ["cotton", "denim", "knit"]; }
  if (time === "evening" || time === "night") formality = Math.min(5, formality + 1);
  return { kind: "data", data: { occasion, formality, silhouette, lean, materials, hint: `Search the catalog for: ${lean}. Prefer ${silhouette} silhouettes in ${materials.join(", ")}.` } };
}

async function handleCompareTwoItems(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "data"; data: Record<string, unknown> }> {
  const idA = String(args.productIdA ?? "");
  const idB = String(args.productIdB ?? "");
  const occasion = String(args.occasion ?? "").toLowerCase();
  const bodyType = String(args.shopperBodyType ?? "").toLowerCase();

  const [a, b] = await Promise.all([
    prisma.product.findFirst({ where: { shopId: ctx.shopId, id: idA }, select: { id: true, title: true, category: true, colorFamily: true, tags: true } }),
    prisma.product.findFirst({ where: { shopId: ctx.shopId, id: idB }, select: { id: true, title: true, category: true, colorFamily: true, tags: true } }),
  ]);
  if (!a || !b) return { kind: "data", data: { error: "product_not_found" } };

  // Decision heuristic — lightweight scoring. The model will use this to back
  // its pick. We deliberately keep the logic simple and explainable so the
  // model's stated rationale aligns with the actual scoring.
  const score = (p: typeof a) => {
    let s = 0;
    if (occasion) {
      if ((p.tags ?? []).some((t) => t.toLowerCase().includes("tailored")) && /work|interview|meeting|office/.test(occasion)) s += 3;
      if ((p.tags ?? []).some((t) => t.toLowerCase().includes("evening")) && /dinner|gala|wedding|date/.test(occasion)) s += 3;
      if ((p.tags ?? []).some((t) => t.toLowerCase().includes("casual")) && /weekend|brunch|coffee/.test(occasion)) s += 3;
    }
    if (bodyType && (p.tags ?? []).some((t) => t.toLowerCase().includes(bodyType))) s += 1;
    return s;
  };
  const scoreA = score(a); const scoreB = score(b);
  const winner = scoreA >= scoreB ? a : b;
  const loser  = winner === a ? b : a;
  return {
    kind: "data",
    data: {
      winnerProductId: winner.id, winnerTitle: winner.title,
      loserProductId: loser.id, loserTitle: loser.title,
      reason: occasion
        ? `${winner.title} better matches "${occasion}" — its tags and category align with the dress code.`
        : `${winner.title} edges out on versatility for this brand's catalog.`,
    },
  };
}

async function handleExplainCombo(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "data"; data: Record<string, unknown> }> {
  const ids = (args.productIds as string[] | undefined ?? []).slice(0, 4);
  const products = await prisma.product.findMany({
    where: { shopId: ctx.shopId, id: { in: ids } },
    select: { id: true, title: true, category: true, colorFamily: true },
  });
  if (products.length < 2) return { kind: "data", data: { error: "need_two_or_more_products" } };

  const families = Array.from(new Set(products.map((p) => p.colorFamily).filter(Boolean)));
  const categories = products.map((p) => p.category).filter(Boolean) as string[];
  const hasAnchor = categories.includes("Outerwear") || categories.includes("Dress");

  const reasons: string[] = [];
  if (families.length === 1) reasons.push(`tonal — ${families[0]} family throughout, no fighting`);
  else if (families.length === 2) reasons.push(`${families[0]} + ${families[1]} balance — anchored without flat`);
  if (hasAnchor) reasons.push("there's one hero piece, the rest support");
  const uniqueCategories = new Set(categories);
  if (uniqueCategories.size === categories.length && categories.length > 1) reasons.push("silhouette balance is right — no two items in the same energy");

  return {
    kind: "data",
    data: {
      productIds: ids,
      oneLine: reasons[0] ?? "balanced palette and proportions for the occasion",
      details: reasons,
    },
  };
}

async function handleRecallPastPreference(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "data"; data: Record<string, unknown> }> {
  const lookbackDays = Math.min(180, Math.max(7, Number(args.lookbackDays ?? 60)));
  const since = new Date(Date.now() - lookbackDays * 86_400_000);

  // Positive signal: cart confirmed.
  // §3.5 invariant #1 — filter by shopId so events from a prior installation
  // on a different brand are excluded at the event-read level (not just at the
  // product-hydration level below).
  const accepts = await prisma.analyticsEvent.findMany({
    where: { shopId: ctx.shopId, shopperId: ctx.shopperRowId, name: "CART_CONFIRMED", createdAt: { gte: since } },
    select: { productId: true, payload: true },
    take: 20,
  });
  // Negative signal: cart cancelled OR signup dismissed OR rec dismissed.
  const rejects = await prisma.analyticsEvent.findMany({
    where: { shopId: ctx.shopId, shopperId: ctx.shopperRowId, name: { in: ["CART_CANCELLED", "SIGNUP_DISMISSED"] }, createdAt: { gte: since } },
    select: { productId: true, payload: true },
    take: 20,
  });

  const acceptedIds = accepts.map((e) => e.productId).filter((x): x is string => !!x);
  const rejectedIds = rejects.map((e) => e.productId).filter((x): x is string => !!x);
  // SECURITY: filter by shopId — taste vector may contain stale product IDs
  // from a prior installation on another brand. Without this, we could leak
  // titles from another shop's catalog into Mira's prompt context.
  const [acceptedProducts, rejectedProducts] = await Promise.all([
    acceptedIds.length ? prisma.product.findMany({
      where: { shopId: ctx.shopId, id: { in: acceptedIds } },
      select: { title: true, category: true, colorFamily: true },
    }) : Promise.resolve([]),
    rejectedIds.length ? prisma.product.findMany({
      where: { shopId: ctx.shopId, id: { in: rejectedIds } },
      select: { title: true, category: true, colorFamily: true },
    }) : Promise.resolve([]),
  ]);

  return {
    kind: "data",
    data: {
      accepted: acceptedProducts.map((p) => p.title),
      rejected: rejectedProducts.map((p) => p.title),
      hint: rejectedProducts.length
        ? "Avoid re-pitching the rejected items — propose adjacent options instead."
        : "No strong rejection signal yet — proceed normally.",
    },
  };
}

// ─── interpret_fit_language — turn human words into structured prefs ───
// Keyword-and-phrase mapping. Deliberately simple and decisive — the model
// gets a clean answer instead of a probability cloud. Each preference has a
// set of "tell-tale" phrases; first match wins, with a confidence score
// based on how many positive vs negative keywords were present.

async function handleInterpretFitLanguage(args: Record<string, unknown>, _ctx: BrainContext): Promise<{ kind: "data"; data: Record<string, unknown> }> {
  const phrase = String(args.phrase ?? "").toLowerCase();
  if (!phrase) return { kind: "data", data: { error: "no_phrase" } };

  const buckets: Array<{ pref: string; signals: string[]; counter: string[] }> = [
    {
      pref: "FITTED",
      signals: ["second skin", "tight", "snug", "fitted", "bodycon", "hugging", "tailored close", "close to the body", "shows my shape", "structured"],
      counter: ["not tight", "not too tight", "not fitted", "not snug"],
    },
    {
      pref: "REGULAR",
      signals: ["regular", "normal", "standard", "true to size", "neither tight nor loose", "balanced", "easy fit", "comfortable"],
      counter: [],
    },
    {
      pref: "RELAXED",
      signals: ["breezy", "loose", "easy", "flowy", "drapey", "skim", "not clingy", "don't like clingy", "don't like tight", "doesn't stick", "not too close", "breathing room", "drape"],
      counter: ["not loose", "not too loose"],
    },
    {
      pref: "OVERSIZED",
      signals: ["oversized", "baggy", "boxy", "huge", "big", "drown in it", "borrowed from", "borrowed-from", "size up", "couple sizes up"],
      counter: ["not oversized", "not baggy", "not too big"],
    },
  ];

  let best: { pref: string; score: number } = { pref: "REGULAR", score: 0 };
  for (const b of buckets) {
    let score = 0;
    for (const s of b.signals) if (phrase.includes(s)) score += 2;
    for (const c of b.counter) if (phrase.includes(c)) score -= 3;
    if (score > best.score) best = { pref: b.pref, score };
  }

  // Confidence: roughly how cleanly the phrase pointed to one bucket.
  const confidence = best.score >= 4 ? "high" : best.score >= 2 ? "medium" : "low";

  return {
    kind: "data",
    data: {
      fitPreference: best.pref,
      confidence,
      hint: confidence === "low"
        ? "Signal was weak — don't save yet. Ask one specific follow-up ('like a t-shirt fits, or more relaxed?') before calling capture_shopper_profile."
        : "Strong enough to save. Call capture_shopper_profile with this fitPreference; don't announce the save.",
    },
  };
}

// ─── capture_shopper_profile — Mira ↔ Widget Fit bridge ───────────────
//
// Writes body type / measurements / fit preference to ShopperSession so the
// next Widget Fit step pre-fills (or skips entirely). Validates everything
// — we trust nothing the model emits.

const BODY_TYPES = ["PETITE", "SLIM", "REGULAR", "CURVY", "PLUS", "TALL"] as const;
const FIT_PREFS  = ["FITTED", "REGULAR", "RELAXED", "OVERSIZED", "SLIM"] as const;

async function handleCaptureShopperProfile(args: Record<string, unknown>, ctx: BrainContext): Promise<{ kind: "data"; data: Record<string, unknown> }> {
  const update: Record<string, unknown> = {};
  const captured: string[] = [];

  const bodyType = String(args.bodyType ?? "").toUpperCase();
  if ((BODY_TYPES as readonly string[]).includes(bodyType)) {
    update.bodyType = bodyType;
    captured.push("body type");
  }

  const heightCm = Number(args.heightCm);
  if (Number.isFinite(heightCm) && heightCm >= 80 && heightCm <= 230) {
    update.heightCm = Math.round(heightCm);
    captured.push("height");
  }

  const weightKg = Number(args.weightKg);
  if (Number.isFinite(weightKg) && weightKg >= 25 && weightKg <= 250) {
    update.weightKg = Math.round(weightKg);
    captured.push("weight");
  }

  const fitPreference = String(args.fitPreference ?? "").toUpperCase();
  if ((FIT_PREFS as readonly string[]).includes(fitPreference)) {
    update.fitPreference = fitPreference;
    captured.push("fit preference");
  }

  // Budget — store as-stated so Mira can reference them naturally.
  const budgetMax = args.budgetMax != null ? Number(args.budgetMax) : NaN;
  if (Number.isFinite(budgetMax) && budgetMax > 0) {
    update.budgetMax = budgetMax;
    captured.push("budget ceiling");
  }
  const budgetMin = args.budgetMin != null ? Number(args.budgetMin) : NaN;
  if (Number.isFinite(budgetMin) && budgetMin >= 0) {
    update.budgetMin = budgetMin;
    captured.push("budget floor");
  }
  const budgetCurrency = String(args.budgetCurrency ?? "").toUpperCase().slice(0, 3);
  if (budgetCurrency.length === 3) {
    update.budgetCurrency = budgetCurrency;
  }

  if (!Object.keys(update).length) {
    return { kind: "data", data: { saved: false, error: "no_valid_fields" } };
  }

  // §3 invariant #1 defence-in-depth: updateMany with shopifyDomain guard so a
  // leaked shopperRowId from a different brand can't trigger a cross-tenant write.
  await prisma.shopperSession.updateMany({
    where: { id: ctx.shopperRowId, shopifyDomain: ctx.shopDomain },
    data: update,
  }).catch(() => undefined);

  // Use the dedicated event — reusing WIDGET_FIT_SUBMITTED previously dropped
  // these at zod validation because recommendedSize was empty. (Audit fix.)
  ctx.log({
    name: "CHAT_PROFILE_CAPTURED",
    payload: {
      captured,
      heightCm: typeof update.heightCm === "number" ? update.heightCm : undefined,
      weightKg: typeof update.weightKg === "number" ? update.weightKg : undefined,
      bodyType: typeof update.bodyType === "string" ? update.bodyType : undefined,
      fitPreference: typeof update.fitPreference === "string" ? update.fitPreference : undefined,
      budgetMax: typeof update.budgetMax === "number" ? update.budgetMax : undefined,
      budgetCurrency: typeof update.budgetCurrency === "string" ? update.budgetCurrency : undefined,
    },
  });

  const budgetHint = update.budgetMax
    ? ` Budget saved at ${update.budgetCurrency ?? "USD"} ${update.budgetMax}. Every future search_catalog call MUST pass maxPriceUsd=${update.budgetMax} — the shopper expects to stay within their range.`
    : "";

  return {
    kind: "data",
    data: {
      saved: true,
      captured,
      hint: `Saved to the shopper's profile. The Widget's Fit step will pre-fill next time. Don't restate the values — just continue helping.${budgetHint}`,
    },
  };
}

// ─── D40: combo_tryon — render all outfit pieces on a muse ────────────

const comboTryOnToolSchema: ToolDef = {
  name: "combo_tryon",
  description:
    "Render the full outfit combo on a muse so the shopper can see how all pieces look together. Use when the shopper wants to try the whole look at once.",
  schema: {
    type: "object",
    properties: {
      productIds: {
        type: "array", items: { type: "string" },
        description: "IDs of 2-4 products in the combo, top → bottom → accessory order",
      },
      comboName: { type: "string", description: "Short name for this combo, e.g. 'weekend casual'" },
      modelHint: { type: "string", description: "Optional body-shape hint for the muse (ava, lina, noor, maya, zara, elena)" },
    },
    required: ["productIds", "comboName"],
  },
  requiresFeature: "widget.enabled",
};

async function handleComboTryOn(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "action"; action: BrainClientAction }> {
  const ids = (args.productIds as string[] | undefined ?? []).slice(0, 4);
  const comboName = String(args.comboName ?? "combo").slice(0, 80);
  const modelHint = args.modelHint ? String(args.modelHint) : undefined;

  // Validate every id belongs to this shop's catalog — prevents phantom ids.
  const valid = await prisma.product.findMany({
    where: { shopId: ctx.shopId, id: { in: ids } },
    select: { id: true, primaryColor: true, category: true },
  });
  const productIds = valid.map((v) => v.id);

  ctx.log({
    name: "COMBO_TRYON_REQUESTED",
    payload: { comboName, productIds, museId: modelHint },
  });

  return {
    kind: "action",
    action: {
      kind: "open_tryon",
      mode: "model",
      productIds,
      modelHint,
      autoRender: true,
      // comboName is carried forward so the widget's progress bar can label
      // each render step. Appended to the open_tryon action via type assertion
      // because BrainClientAction doesn't yet have an optional comboName field
      // on open_tryon — this is additive and ignored by older consumers.
      ...({ comboName } as Record<string, unknown>),
    } as BrainClientAction,
  };
}

// ─── Guided shopping handlers (Rufus-pattern) ────────────────────────────

async function handleLeadBrowse(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "action"; action: BrainClientAction }> {
  const handle = String(args.handle ?? "").trim();
  const title = String(args.title ?? "").slice(0, 120);
  const arrivalFocus = args.arrivalFocus ? String(args.arrivalFocus).slice(0, 300) : undefined;
  const imageUrl = args.imageUrl ? String(args.imageUrl).slice(0, 500) : undefined;

  // Validate the product belongs to this shop. This also gives us the real id.
  const product = await prisma.product.findFirst({
    where: { shopId: ctx.shopId, handle },
    select: { id: true, title: true },
  });
  const productId = product?.id ?? (args.productId ? String(args.productId) : undefined);

  ctx.log({
    name: "CHAT_NAV_REQUESTED",
    productId,
    payload: { productHandle: handle, guidedBrowse: true, arrivalFocus },
  });

  return {
    kind: "action",
    action: { kind: "lead_browse", handle, productId, title: product?.title ?? title, arrivalFocus, imageUrl },
  };
}

async function handleGuideComboWalkthrough(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "action"; action: BrainClientAction }> {
  const comboName = String(args.comboName ?? "look").slice(0, 80);
  // Steps may arrive as an array of JSON strings (matching the ToolSchema items
  // type constraint) or as pre-parsed objects (Gemini sometimes does both).
  const rawArr = Array.isArray(args.steps) ? args.steps : [];
  const rawSteps: Array<Record<string, unknown>> = rawArr.map((s) => {
    if (typeof s === "string") {
      try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
    }
    return (s as Record<string, unknown>) ?? {};
  });

  // Validate every handle belongs to this shop (shopId-scoped).
  const handles = rawSteps.map((s) => String(s.handle ?? "")).filter(Boolean);
  const validProducts = handles.length
    ? await prisma.product.findMany({
        where: { shopId: ctx.shopId, handle: { in: handles } },
        select: { id: true, handle: true, title: true, images: { orderBy: { position: "asc" }, take: 1, select: { url: true } } },
      })
    : [];
  const byHandle = new Map(validProducts.map((p) => [p.handle, p]));

  const steps = rawSteps
    .map((s) => {
      const handle = String(s.handle ?? "").trim();
      const prod = byHandle.get(handle);
      if (!prod) return null; // drop steps for products not in this shop
      return {
        handle,
        productId: prod.id,
        title: prod.title,
        role: String(s.role ?? "").slice(0, 100),
        whyItWorksForYou: String(s.whyItWorksForYou ?? "").slice(0, 300),
        imageUrl: (prod.images[0]?.url ?? (s.imageUrl ? String(s.imageUrl) : undefined)) as string | undefined,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  ctx.log({
    name: "CHAT_COMBO_PROPOSED",
    payload: {
      comboName,
      productIds: steps.map((s) => s.productId),
      reasoning: `guided walkthrough: ${steps.map((s) => s.role).join(", ")}`,
    },
  });

  return {
    kind: "action",
    action: { kind: "guide_combo_walkthrough", comboName, steps },
  };
}

async function handleHighlightProductDetail(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "action"; action: BrainClientAction }> {
  const detail = String(args.detail ?? "").slice(0, 300);
  const imageZone = (["full", "top", "bottom", "left", "right", "center"].includes(String(args.imageZone))
    ? String(args.imageZone)
    : "full") as "full" | "top" | "bottom" | "left" | "right" | "center";

  // This tool only makes sense when the shopper is on a PDP.
  if (!ctx.currentProductHandle) {
    // No-op: return a data response so the model knows the highlight won't fire.
    return {
      kind: "action" as const,
      action: { kind: "highlight_product_detail", detail, imageZone },
    };
  }

  ctx.log({
    name: "MIRA_PRODUCT_EXPLAINED",
    productId: ctx.currentProductId,
    payload: { productId: ctx.currentProductId, attributes: [detail.slice(0, 100), imageZone] },
  });

  return {
    kind: "action",
    action: { kind: "highlight_product_detail", detail, imageZone },
  };
}

// show_size_recommendation — proactive size card before try-on.
// Reuses the recommendFit() engine that powers POST /api/fit.
// If the shopper has no body data, returns collect_fit_for_sizing instead.
async function handleShowSizeRecommendation(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "action"; action: BrainClientAction }> {
  // Resolve productId — from args, or fall back to the current page product.
  let productId = args.productId ? String(args.productId) : ctx.currentProductId;
  const productTitle = String(args.productTitle ?? "").slice(0, 120);

  // Look up the product to get category + available sizes + size chart.
  let product: { id: string; title: string; category: string | null; sizeChartJson: unknown; variants: { size: string | null }[] } | null = null;
  if (productId) {
    product = await prisma.product.findFirst({
      where: { shopId: ctx.shopId, id: productId },
      select: {
        id: true, title: true, category: true, sizeChartJson: true,
        variants: { select: { size: true } },
      },
    });
  }
  if (!product && ctx.currentProductHandle) {
    product = await prisma.product.findFirst({
      where: { shopId: ctx.shopId, handle: ctx.currentProductHandle },
      select: {
        id: true, title: true, category: true, sizeChartJson: true,
        variants: { select: { size: true } },
      },
    });
  }

  if (!product) {
    // Product not found in this shop — return data error that model can act on.
    return {
      kind: "action" as const,
      action: { kind: "collect_fit_for_sizing", productId: productId ?? "", productTitle },
    };
  }
  productId = product.id;

  // Fetch the shopper's saved body data.
  const sessionRow = await prisma.shopperSession.findUnique({
    where: { id: ctx.shopperRowId },
    select: { heightCm: true, weightKg: true, fitPreference: true, bodyType: true, chestCm: true, waistCm: true, hipCm: true },
  });

  const hasBodyData = !!(sessionRow?.heightCm && sessionRow?.weightKg);
  if (!hasBodyData) {
    // No fit data — show fit collection form instead of a recommendation.
    ctx.log({ name: "MIRA_SIZE_HELP_STARTED", productId, payload: { productId, triggeredBy: "show_size_recommendation" } });
    return {
      kind: "action",
      action: { kind: "collect_fit_for_sizing", productId, productTitle: product.title },
    };
  }

  const availableSizes = Array.from(
    new Set(product.variants.map((v) => v.size).filter((s): s is string => Boolean(s)))
  );

  // Fix 4/5/6 — wire skuMeasurements + past-purchase + brand-bias signals.
  const skuMeasurements = parseSkuMeasurementsForFit(product.sizeChartJson);
  let purchaseCount = 0;
  try {
    purchaseCount = await prisma.analyticsEvent.count({
      where: { shopId: ctx.shopId, shopperId: ctx.shopperRowId, name: "CART_CONFIRMED" },
    });
  } catch { /* non-blocking */ }

  const fitResult = recommendFit({
    heightCm: sessionRow!.heightCm!,
    weightKg: sessionRow!.weightKg!,
    fitPreference: (sessionRow!.fitPreference as "FITTED" | "REGULAR" | "RELAXED" | "SLIM" | "OVERSIZED" | null) ?? "REGULAR",
    bodyType: sessionRow!.bodyType as "PETITE" | "SLIM" | "REGULAR" | "CURVY" | "PLUS" | "TALL" | null | undefined ?? undefined,
    category: product.category,
    availableSizes,
    chest: sessionRow!.chestCm ?? undefined,
    waist: sessionRow!.waistCm ?? undefined,
    hip:   sessionRow!.hipCm   ?? undefined,
    skuMeasurements,
    hasPastPurchase: purchaseCount > 0,
    brandBiasCount: purchaseCount,
  });

  ctx.log({
    name: "MIRA_SIZE_SAVED",
    productId,
    payload: {
      productId,
      size: fitResult.recommendedSize,
      confidence: fitResult.confidence,
    },
  });

  // Compute up to 2 alternative sizes from available sizes (excluding primary).
  const alternativeSizes = [
    ...(fitResult.alternativeSize ? [fitResult.alternativeSize] : []),
    ...availableSizes.filter((s) => s !== fitResult.recommendedSize && s !== fitResult.alternativeSize),
  ].slice(0, 2);

  return {
    kind: "action",
    action: {
      kind: "show_size_recommendation",
      productId,
      productTitle: product.title,
      recommendation: {
        recommendedSize: fitResult.recommendedSize,
        confidence: fitResult.confidence,
        trustLine: fitResult.trustLine ?? "",
        fitPreference: sessionRow!.fitPreference ?? undefined,
        alternativeSizes,
      },
    },
  };
}

// ─── Stock + size-chart intelligence (Request B) ─────────────────────────

type VariantStockRow = {
  size: string | null;
  inventoryQuantity: number | null;
  availableForSale: boolean | null;
};

// Collapse variant rows into a per-size stock map + rollups. A size can map to
// several colour variants; we sum their quantities. Quantity rules:
//   • inventoryQuantity present → use it (the truth).
//   • only availableForSale present → treat true as "plenty" (99), false as 0.
//   • nothing present → size is "unknown" and omitted from stockBySize so Mira
//     never claims a number she doesn't have (and never blocks a sale).
function buildStock(variants: VariantStockRow[]): {
  stockBySize: Record<string, number>;
  inStockSizes: string[];
  outOfStockSizes: string[];
  lowStockSizes: string[];
  hasData: boolean;
} {
  const bySize = new Map<string, { qty: number; knownQty: boolean; available: boolean; knownAvail: boolean }>();
  let hasData = false;
  for (const v of variants) {
    if (!v.size) continue;
    const cur = bySize.get(v.size) ?? { qty: 0, knownQty: false, available: false, knownAvail: false };
    if (v.inventoryQuantity != null) { cur.qty += Math.max(0, v.inventoryQuantity); cur.knownQty = true; hasData = true; }
    if (v.availableForSale != null) { cur.knownAvail = true; if (v.availableForSale) cur.available = true; hasData = true; }
    bySize.set(v.size, cur);
  }

  const stockBySize: Record<string, number> = {};
  const inStockSizes: string[] = [];
  const outOfStockSizes: string[] = [];
  const lowStockSizes: string[] = [];
  for (const [size, s] of bySize) {
    if (!s.knownQty && !s.knownAvail) continue; // unknown — omit
    const qty = s.knownQty ? s.qty : (s.available ? 99 : 0);
    stockBySize[size] = qty;
    if (qty <= 0) outOfStockSizes.push(size);
    else {
      inStockSizes.push(size);
      if (s.knownQty && qty <= 3) lowStockSizes.push(size);
    }
  }
  return { stockBySize, inStockSizes, outOfStockSizes, lowStockSizes, hasData };
}

// Normalise a stored sizeChartJson (whatever the extraction source produced)
// into the typed BrainCurrentProduct["sizeChart"] shape. Tolerant of loose
// numeric strings ("95cm") and missing fields. Returns null when there isn't
// at least one named size with a measurement.
function parseSizeChart(raw: unknown, source: string | null): BrainCurrentProduct["sizeChart"] {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as { unit?: unknown; source?: unknown; sizes?: unknown };
  const rows = Array.isArray(c.sizes) ? (c.sizes as Array<Record<string, unknown>>) : [];
  const num = (r: Record<string, unknown>, k: string): number | undefined => {
    const v = r[k];
    if (v == null) return undefined;
    const n = typeof v === "number" ? v : Number.parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
  };
  const sizes = rows
    .map((r) => {
      const name = r.name != null ? String(r.name).trim() : "";
      if (!name) return null;
      const entry = {
        name,
        chest: num(r, "chest"), waist: num(r, "waist"), hip: num(r, "hip"),
        length: num(r, "length"), sleeve: num(r, "sleeve"), inseam: num(r, "inseam"),
      };
      const hasMeasurement = entry.chest != null || entry.waist != null || entry.hip != null ||
        entry.length != null || entry.sleeve != null || entry.inseam != null;
      return hasMeasurement ? entry : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  if (!sizes.length) return null;
  const unit: "cm" | "in" = c.unit === "in" ? "in" : "cm";
  return { unit, source: source ?? (c.source != null ? String(c.source) : null), sizes };
}

// check_stock — real availability for a product (defaults to current PDP).
// Reads the inventory mirror (refreshed at catalog-sync). Never blocks a sale
// on unknown stock. shopId-scoped — cross-tenant impossible.
async function handleCheckStock(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "data"; data: unknown }> {
  const productId = args.productId ? String(args.productId) : ctx.currentProductId;
  const sizeFilter = args.size ? String(args.size).trim() : null;

  const variantSelect = { select: { size: true, inventoryQuantity: true, availableForSale: true } } as const;
  let product: { id: string; title: string; handle: string; variants: VariantStockRow[] } | null = null;
  if (productId) {
    product = await prisma.product.findFirst({
      where: { shopId: ctx.shopId, id: productId },
      select: { id: true, title: true, handle: true, variants: variantSelect },
    }).catch(() => null);
  }
  if (!product && ctx.currentProductHandle) {
    product = await prisma.product.findFirst({
      where: { shopId: ctx.shopId, handle: ctx.currentProductHandle },
      select: { id: true, title: true, handle: true, variants: variantSelect },
    }).catch(() => null);
  }
  if (!product) {
    return { kind: "data", data: { found: false, reason: "product_not_found" } };
  }

  const stock = buildStock(product.variants);
  ctx.log({
    name: "CHAT_STOCK_CHECKED",
    productId: product.id,
    payload: {
      productId: product.id,
      ...(sizeFilter ? { size: sizeFilter } : {}),
      inStockSizes: stock.inStockSizes.length,
      outOfStockSizes: stock.outOfStockSizes.length,
      inventoryKnown: stock.hasData,
    },
  });

  if (sizeFilter) {
    const qty = stock.stockBySize[sizeFilter];
    const known = qty != null;
    return {
      kind: "data",
      data: {
        found: true,
        productTitle: product.title,
        size: sizeFilter,
        available: known ? qty > 0 : true, // unknown → don't block
        unitsLeft: known ? qty : null,
        low: known && qty > 0 && qty <= 3,
        inventoryKnown: known,
      },
    };
  }

  return {
    kind: "data",
    data: {
      found: true,
      productTitle: product.title,
      inventoryKnown: stock.hasData,
      inStockSizes: stock.inStockSizes,
      lowStockSizes: stock.lowStockSizes,
      outOfStockSizes: stock.outOfStockSizes,
      stockBySize: stock.hasData ? stock.stockBySize : null,
    },
  };
}

// get_size_chart — the brand's real garment measurements for a product.
// Defaults to the current PDP. Returns the normalised chart or { hasChart:false }
// so the model knows to fall back to show_size_recommendation.
async function handleGetSizeChart(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "data"; data: unknown }> {
  const productId = args.productId ? String(args.productId) : ctx.currentProductId;

  const select = { id: true, title: true, sizeChartJson: true, sizeChartSource: true } as const;
  let product: { id: string; title: string; sizeChartJson: unknown; sizeChartSource: string | null } | null = null;
  if (productId) {
    product = await prisma.product.findFirst({
      where: { shopId: ctx.shopId, id: productId }, select,
    }).catch(() => null);
  }
  if (!product && ctx.currentProductHandle) {
    product = await prisma.product.findFirst({
      where: { shopId: ctx.shopId, handle: ctx.currentProductHandle }, select,
    }).catch(() => null);
  }
  if (!product) {
    return { kind: "data", data: { found: false, reason: "product_not_found" } };
  }

  const chart = parseSizeChart(product.sizeChartJson, product.sizeChartSource);
  ctx.log({
    name: "CHAT_SIZE_CHART_VIEWED",
    productId: product.id,
    payload: {
      productId: product.id,
      hasChart: !!chart,
      ...(chart?.source ? { source: chart.source } : {}),
      ...(chart ? { sizeCount: chart.sizes.length } : {}),
    },
  });

  if (!chart) {
    return {
      kind: "data",
      data: { found: true, productTitle: product.title, hasChart: false },
    };
  }
  return {
    kind: "data",
    data: {
      found: true,
      productTitle: product.title,
      hasChart: true,
      unit: chart.unit,
      sizes: chart.sizes,
    },
  };
}

// ─── Mira floor-salesperson tools (schemas + handlers) ───────────────────
//
// Six tools that turn Mira from a search box into a real in-store associate.
// All schemas are defined inline here (they're not in @stylique/ai). Every
// handler is wrapped in try/catch with a safe fallback, and every analytics
// emit is fire-and-forget through ctx.log (the same path every other handler
// uses) — never awaited in the return path. Events are validated against
// EventPayloadSchemas; we only emit fields those schemas allow.

// ─── explain_product — read the piece in front of the shopper ──────────
const explainProductToolSchema: ToolDef = {
  name: "explain_product",
  description:
    "Explain the product the shopper is currently looking at — its fit/cut, color, fabric, what occasions it suits, and live stock. Use ONLY what's known about the current product; never invent fabric, occasion, or stock you don't have. Call this when the shopper asks 'tell me about this' or seems to be weighing the piece on the page.",
  schema: { type: "object", properties: {}, required: [] },
  requiresFeature: "stylist.enabled",
};

async function handleExplainProduct(
  _args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "data"; data: Record<string, unknown> }> {
  try {
    const p = ctx.currentProduct;
    if (!p) {
      return { kind: "data", data: { explained: false, reason: "no_current_product" } };
    }

    // Build a structured explanation from ONLY the fields we actually have.
    // Each part is omitted when its source field is null/empty — never invent.
    const attributes: string[] = [];

    const fit = p.category ? `${p.category}` : undefined;
    if (fit) attributes.push("fit");

    const color = p.primaryColor ?? undefined;
    if (color) attributes.push("color");

    // Fabric: productType is the closest real signal we carry. Never fabricate.
    const fabric = p.productType ?? undefined;
    if (fabric) attributes.push("fabric");

    // Occasion suitability — inferred only from tags we actually hold.
    const occasionTags = (p.tags ?? []).filter((t) =>
      /wedding|work|office|evening|casual|weekend|formal|party|brunch|date|gala|interview/i.test(t),
    );
    const occasion = occasionTags.length ? occasionTags.join(", ") : undefined;
    if (occasion) attributes.push("occasion");

    // Stock state — from the live per-size map. Omit entirely when unknown.
    let stockSummary: string | undefined;
    if (p.stockBySize && Object.keys(p.stockBySize).length) {
      const inStock = p.inStockSizes ?? [];
      const low = p.lowStockSizes ?? [];
      const out = p.outOfStockSizes ?? [];
      const parts: string[] = [];
      if (inStock.length) parts.push(`in stock: ${inStock.join(", ")}`);
      if (low.length) parts.push(`running low: ${low.join(", ")}`);
      if (out.length) parts.push(`sold out: ${out.join(", ")}`);
      if (parts.length) {
        stockSummary = parts.join(" · ");
        attributes.push("stock");
      }
    }

    // One-line natural explanation the model can quote. Only includes parts
    // that exist — no null slots leaked into the sentence.
    const sentenceParts: string[] = [];
    if (fit) sentenceParts.push(`a ${fit.toLowerCase()}`);
    if (color) sentenceParts.push(`in ${color}`);
    if (fabric) sentenceParts.push(`(${fabric})`);
    if (occasion) sentenceParts.push(`good for ${occasion}`);
    const explanation = sentenceParts.length
      ? `${p.title} — ${sentenceParts.join(" ")}.`
      : p.title;

    ctx.log({
      name: "MIRA_PRODUCT_EXPLAINED",
      productId: p.id,
      payload: { productId: p.id, attributes },
    });

    const data: Record<string, unknown> = { explained: true, productName: p.title, explanation };
    if (color) data.color = color;
    if (fabric) data.fabric = fabric;
    if (occasion) data.occasion = occasion;
    if (stockSummary) data.stockSummary = stockSummary;
    return { kind: "data", data };
  } catch (err) {
    brainLog.error({ shopId: ctx.shopId, err: (err as Error).message }, "brain.explain_product error");
    reportError(err, { shopId: ctx.shopId, tool: "explain_product" });
    return { kind: "data", data: { explained: false, reason: "explain_failed" } };
  }
}

// ─── complete_outfit — build a look around the piece (real catalog only) ─
const completeOutfitToolSchema: ToolDef = {
  name: "complete_outfit",
  description:
    "Complete the look around a focal product the shopper likes — return up to 3 complementary pieces from THIS shop's catalog with a one-line reason each. Uses only real products; no AI image work. Call this when the shopper wants 'what goes with this' or to build a full outfit.",
  schema: {
    type: "object",
    properties: {
      focalProductId: { type: "string", description: "The anchor product to build around. Defaults to the current PDP product." },
      shopperIntent: { type: "string", description: "What the shopper is dressing for, in their words (e.g. 'an outdoor evening wedding')." },
    },
    required: [],
  },
  requiresFeature: "stylist.enabled",
};

async function handleCompleteOutfit(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "combo"; combo: BrainCombo } | { kind: "data"; data: Record<string, unknown> }> {
  try {
    const focalProductId = args.focalProductId ? String(args.focalProductId) : (ctx.currentProduct?.id ?? undefined);
    const shopperIntent = args.shopperIntent ? String(args.shopperIntent).slice(0, 200) : undefined;
    if (!focalProductId) {
      return { kind: "data", data: { error: "no_focal_product" } };
    }

    // Hydrate the focal product (shopId-scoped) so we can score against its
    // category + color. Prefer the per-turn cache, fall back to DB.
    let focal = ctx.cache.get(`product:${focalProductId}`) as BrainProduct | undefined;
    if (!focal) {
      const frow = await prisma.product.findFirst({
        where: { shopId: ctx.shopId, id: focalProductId },
        include: {
          images:   { orderBy: { position: "asc" }, take: 1 },
          variants: { select: { size: true } },
        },
      });
      if (frow) {
        focal = toBrainProduct(frow);
        ctx.cache.set(`product:${focal.id}`, focal);
      }
    }
    if (!focal) {
      return { kind: "data", data: { error: "focal_product_not_found" } };
    }

    // Pull a small candidate pool from this shop's catalog (shopId-scoped).
    const rows = await prisma.product.findMany({
      where: { shopId: ctx.shopId, id: { not: focalProductId } },
      include: {
        images:   { orderBy: { position: "asc" }, take: 1 },
        variants: { select: { size: true } },
      },
      take: 8,
    });
    const candidates = rows.map(toBrainProduct);
    const taste = await readTasteVector(ctx.shopperRowId).catch(() => null);
    const tasteColors = new Set(Object.entries(taste?.colorFamily ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k));
    const tasteCategories = new Set(Object.entries(taste?.category ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k));
    const tasteTopProducts = new Set(taste?.topProducts ?? []);

    // Lightweight, explainable scoring — no external service:
    //   • reward a DIFFERENT category from the focal (a real outfit layers
    //     across categories, not three of the same thing).
    //   • reward neutral or complementary colors (neutrals pair with anything;
    //     a different color family adds contrast without clashing).
    const NEUTRALS = ["black", "white", "ivory", "cream", "beige", "camel", "grey", "gray", "navy", "stone", "sand", "charcoal", "bone"];
    const focalCat = (focal.category ?? "").toLowerCase();
    const focalFamily = (focal.colorFamily ?? "").toLowerCase();

    const scored = candidates
      .map((c) => {
        let score = 0;
        const reasons: string[] = [];
        const cat = (c.category ?? "").toLowerCase();
        if (cat && cat !== focalCat) { score += 2; reasons.push(`a ${cat} to layer with the ${focalCat || "piece"}`); }
        const color = (c.primaryColor ?? c.colorFamily ?? "").toLowerCase();
        const isNeutral = NEUTRALS.some((n) => color.includes(n));
        const fam = (c.colorFamily ?? "").toLowerCase();
        if (isNeutral) { score += 1.5; reasons.push(`${c.primaryColor ?? "a neutral"} keeps it easy to wear`); }
        else if (fam && focalFamily && fam !== focalFamily) { score += 1; reasons.push(`${c.primaryColor ?? fam} adds a clean contrast`); }
        if (fam && tasteColors.has(fam)) { score += 1.25; reasons.push(`fits their saved ${fam} preference`); }
        if (cat && tasteCategories.has(cat)) { score += 1.25; reasons.push(`matches their saved ${cat} lane`); }
        if (tasteTopProducts.has(c.id)) { score += 1.5; reasons.push("similar to pieces they engaged with"); }
        const rationale = reasons[0] ?? `${c.title} rounds out the look`;
        return { product: c, score, rationale };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (!scored.length) {
      return { kind: "data", data: { error: "no_complementary_products" } };
    }

    const products = [focal, ...scored.map((s) => s.product)];
    const comboName = "Complete Look";
    const styling = scored.map((s) => `${s.product.title}: ${s.rationale}`).join(" · ");
    const occasion = shopperIntent ?? "everyday";

    ctx.log({
      name: "MIRA_OUTFIT_RECOMMENDED",
      payload: {
        focalProductId,
        productIds: scored.map((s) => s.product.id),
        comboName,
        shopperIntent,
      },
    });

    return {
      kind: "combo",
      combo: {
        name: comboName,
        reasoning: shopperIntent ? `Built for ${shopperIntent}. ${styling}` : styling,
        products,
        // Carried as extra context the surface can ignore; BrainCombo's known
        // fields are name/reasoning/products — styling+occasion are additive.
        ...({ styling, occasion } as Record<string, unknown>),
      } as BrainCombo,
    };
  } catch (err) {
    brainLog.error({ shopId: ctx.shopId, err: (err as Error).message }, "brain.complete_outfit error");
    reportError(err, { shopId: ctx.shopId, tool: "complete_outfit" });
    return { kind: "data", data: { error: "complete_outfit_failed" } };
  }
}

// ─── offer_tryon_natural — offer the fitting room at the right moment ────
const offerTryonNaturalToolSchema: ToolDef = {
  name: "offer_tryon_natural",
  description:
    "Offer to show a product on the shopper (the fitting room) at a natural moment — when they're uncertain, comparing, dwelling, or have asked. The shopper decides whether to render (no auto-render). Requires the try-on feature.",
  schema: {
    type: "object",
    properties: {
      productId: { type: "string", description: "The product to offer try-on for." },
      reason: { type: "string", description: "Why now", enum: ["uncertain", "comparing", "dwell", "requested"] },
    },
    required: ["productId"],
  },
  requiresFeature: "widget.enabled",
};

async function handleOfferTryonNatural(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "action"; action: BrainClientAction } | { kind: "data"; data: Record<string, unknown> }> {
  try {
    const productId = String(args.productId ?? "");
    const reasonRaw = String(args.reason ?? "requested");
    const reason = (["uncertain", "comparing", "dwell", "requested"].includes(reasonRaw)
      ? reasonRaw
      : "requested") as "uncertain" | "comparing" | "dwell" | "requested";

    // Try-on requires the widget feature. Gracefully no-op (data) when off so
    // Mira can fall back to words instead of dangling an action that can't fire.
    if (!ctx.features.widget.enabled) {
      return { kind: "data", data: { offered: false, reason: "tryon_not_enabled" } };
    }
    if (!productId) {
      return { kind: "data", data: { offered: false, reason: "no_product" } };
    }

    // Validate the product is in this shop's catalog before offering it.
    const exists = await prisma.product.findFirst({
      where: { shopId: ctx.shopId, id: productId },
      select: { id: true },
    });
    if (!exists) {
      return { kind: "data", data: { offered: false, reason: "product_not_found" } };
    }

    ctx.log({
      name: "MIRA_TRYON_OFFERED",
      productId,
      payload: { productId, reason },
    });

    // autoRender: false — the shopper decides whether to render. We model this
    // as a personal-photo open (mode "photo" waits for the shopper), carrying
    // the reason forward for the widget. open_tryon takes productIds[].
    return {
      kind: "action",
      action: {
        kind: "open_tryon",
        mode: "photo",
        productIds: [productId],
        autoRender: false,
        ...({ reason } as Record<string, unknown>),
      } as BrainClientAction,
    };
  } catch (err) {
    brainLog.error({ shopId: ctx.shopId, err: (err as Error).message }, "brain.offer_tryon_natural error");
    reportError(err, { shopId: ctx.shopId, tool: "offer_tryon_natural" });
    return { kind: "data", data: { offered: false, reason: "offer_tryon_failed" } };
  }
}

// ─── capture_hesitation — read what's holding the shopper back ───────────
const captureHesitationToolSchema: ToolDef = {
  name: "capture_hesitation",
  description:
    "Record that the shopper is hesitating and why, then get a suggested direction for your reply. Use when they go quiet on a size, second-guess the style, flinch at price, or keep comparing. Returns guidance only — it shapes how YOU respond, the shopper sees nothing.",
  schema: {
    type: "object",
    properties: {
      productId: { type: "string", description: "The product they're hesitating on, if known." },
      hesitationType: {
        type: "string",
        description: "What kind of hesitation",
        enum: ["size_uncertain", "style_unsure", "price_concern", "comparing", "unknown"],
      },
      context: { type: "string", description: "What they said or did that signalled hesitation." },
    },
    required: ["hesitationType"],
  },
  requiresFeature: "stylist.enabled",
};

async function handleCaptureHesitation(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "data"; data: Record<string, unknown> }> {
  try {
    const productId = args.productId ? String(args.productId) : undefined;
    const hRaw = String(args.hesitationType ?? "unknown");
    const hesitationType = (["size_uncertain", "style_unsure", "price_concern", "comparing", "unknown"].includes(hRaw)
      ? hRaw
      : "unknown") as "size_uncertain" | "style_unsure" | "price_concern" | "comparing" | "unknown";
    const context = args.context ? String(args.context).slice(0, 200) : undefined;

    const SUGGESTED: Record<typeof hesitationType, string> = {
      size_uncertain: "offer_size_help",
      style_unsure: "show_styling",
      price_concern: "show_alternatives",
      comparing: "compare_products",
      unknown: "ask_clarify",
    };

    ctx.log({
      name: "MIRA_HESITATION_DETECTED",
      ...(productId ? { productId } : {}),
      payload: { ...(productId ? { productId } : {}), hesitationType, ...(context ? { context } : {}) },
    });

    return { kind: "data", data: { hesitationType, suggestedAction: SUGGESTED[hesitationType] } };
  } catch (err) {
    brainLog.error({ shopId: ctx.shopId, err: (err as Error).message }, "brain.capture_hesitation error");
    reportError(err, { shopId: ctx.shopId, tool: "capture_hesitation" });
    return { kind: "data", data: { hesitationType: "unknown", suggestedAction: "ask_clarify" } };
  }
}

// ─── close_sale — the assumptive close: bag it, bag the look, or try first ─
const closeSaleToolSchema: ToolDef = {
  name: "close_sale",
  description:
    "Close the sale — add the item, add the whole outfit, send them to the fitting room first, or acknowledge they want to decide later. Use the assumptive close when the shopper is ready ('Should I add the M?'). Validates every product against this shop's catalog.",
  schema: {
    type: "object",
    properties: {
      productIds: { type: "array", items: { type: "string" }, description: "Products to act on." },
      sizes: { type: "object", description: "Map of productId → chosen size, e.g. { \"abc\": \"M\" }." },
      action: { type: "string", description: "What to do", enum: ["add_item", "add_outfit", "try_first", "decide_later"] },
    },
    required: ["productIds", "action"],
  },
  requiresFeature: "stylist.enabled",
};

async function handleCloseSale(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "action"; action: BrainClientAction } | { kind: "data"; data: Record<string, unknown> }> {
  try {
    const ids = (args.productIds as string[] | undefined ?? []).map((x) => String(x)).slice(0, 4);
    const sizes = (args.sizes as Record<string, string> | undefined) ?? {};
    const actionRaw = String(args.action ?? "decide_later");
    const action = (["add_item", "add_outfit", "try_first", "decide_later"].includes(actionRaw)
      ? actionRaw
      : "decide_later") as "add_item" | "add_outfit" | "try_first" | "decide_later";

    // decide_later — no cart/try-on side effect, just record the intent.
    if (action === "decide_later") {
      ctx.log({
        name: "MIRA_ADD_TO_CART_ASSIST",
        payload: { productIds: ids, action: "decide_later" },
      });
      return { kind: "data", data: { acknowledged: true } };
    }

    // Validate every id belongs to this shop's catalog before acting.
    const valid = ids.length
      ? await prisma.product.findMany({
          where: { shopId: ctx.shopId, id: { in: ids } },
          select: { id: true },
        })
      : [];
    const validIds = valid.map((v) => v.id);
    if (!validIds.length) {
      return { kind: "data", data: { acknowledged: false, error: "no_valid_products" } };
    }

    // try_first — send them to the fitting room (try-on) before buying.
    if (action === "try_first") {
      ctx.log({
        name: "MIRA_TRYON_OFFERED",
        productId: validIds[0],
        payload: { productIds: validIds, reason: "requested" },
      });
      return {
        kind: "action",
        action: {
          kind: "open_tryon",
          mode: "model",
          productIds: validIds,
          autoRender: true,
        } as BrainClientAction,
      };
    }

    // add_item / add_outfit — build the cart action. Look up the chosen size
    // per product from the args map; fall back to undefined when unknown.
    ctx.log({
      name: "MIRA_ADD_TO_CART_ASSIST",
      payload: { productIds: validIds, action: action === "add_outfit" ? "add_outfit" : "add_item" },
    });

    return {
      kind: "action",
      action: {
        kind: "add_outfit_to_cart",
        items: validIds.map((id) => ({ productId: id, suggestedSize: sizes[id] })),
      } as BrainClientAction,
    };
  } catch (err) {
    brainLog.error({ shopId: ctx.shopId, err: (err as Error).message }, "brain.close_sale error");
    reportError(err, { shopId: ctx.shopId, tool: "close_sale" });
    return { kind: "data", data: { acknowledged: false, error: "close_sale_failed" } };
  }
}

// ─── capture_unmet_demand — the learning-loop signal (D60 production port) ─
const captureUnmetDemandToolSchema: ToolDef = {
  name: "capture_unmet_demand",
  description:
    "Record demand this catalog can't meet — when the shopper wants something the store doesn't carry, or you served the closest real piece but it was one attribute off (a near-miss). This is how the store learns what to stock next. Be honest: only flag a true absence, never to dodge a real match.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What the shopper asked for, in their words." },
      resultCount: { type: "integer", description: "How many real matches you could offer (0 = nothing)." },
      nearMissProductId: { type: "string", description: "If you served the CLOSEST real piece, its id." },
      nearMissAttribute: { type: "string", description: "The one attribute that piece is missing (e.g. 'cropped', 'cream', 'petite')." },
      canonicalCategory: { type: "string", description: "The canonical category of the unmet demand (e.g. 'footwear')." },
    },
    required: ["query", "resultCount"],
  },
  requiresFeature: "stylist.enabled",
};

async function handleCaptureUnmetDemand(
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<{ kind: "data"; data: Record<string, unknown> }> {
  try {
    const query = String(args.query ?? "").slice(0, 200);
    const resultCount = Number.isFinite(Number(args.resultCount)) ? Number(args.resultCount) : 0;
    const nearMissProductId = args.nearMissProductId ? String(args.nearMissProductId) : undefined;
    const nearMissAttribute = args.nearMissAttribute ? String(args.nearMissAttribute) : undefined;
    const canonicalCategory = args.canonicalCategory ? String(args.canonicalCategory).slice(0, 80) : undefined;

    if (!query) {
      return { kind: "data", data: { recorded: false, reason: "no_query" } };
    }

    // Persist to the catalog-gap pipeline (same store that feeds the
    // recommendations engine). Fire-and-forget — never block the turn.
    void logCatalogGap({
      shopId: ctx.shopId,
      shopperRowId: ctx.shopperRowId,
      rawQuery: query,
      resultCount,
      source: "chat_unmet_demand",
      ...(canonicalCategory ? { category: canonicalCategory } : {}),
      ...(nearMissProductId ? { nearMissProductId } : {}),
      ...(nearMissAttribute ? { nearMissAttribute } : {}),
    }).catch(() => undefined);

    ctx.log({
      name: "MIRA_UNMET_DEMAND",
      payload: {
        query,
        resultCount,
        ...(canonicalCategory ? { canonicalCategory } : {}),
      },
    });

    return {
      kind: "data",
      data: { recorded: true, isNearMiss: !!nearMissProductId, ...(canonicalCategory ? { canonicalCategory } : {}) },
    };
  } catch (err) {
    brainLog.error({ shopId: ctx.shopId, err: (err as Error).message }, "brain.capture_unmet_demand error");
    return { kind: "data", data: { recorded: false, reason: "capture_unmet_demand_failed" } };
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

function toBrainProduct(p: Parameters<typeof toShopperProduct>[0]): BrainProduct {
  const s = toShopperProduct(p);
  return {
    id: s.id, handle: s.handle, title: s.title,
    imageUrl: s.imageUrl, primaryColor: s.primaryColor, colorFamily: s.colorFamily,
    category: s.category, sizes: s.sizes,
  };
}

// ─── BrainContext builder ────────────────────────────────────────────────
// Single entry to construct a BrainContext for a turn. Used by postChat (and
// any future surface) so we don't duplicate the hydration logic.

export async function buildBrainContext(args: {
  shopId: string;
  shopDomain: string;
  shopperRowId: string;
  shopperSessionId: string;
  brief: string | null;
  accountClaimed: boolean;
  signupAlreadyOffered: boolean;
  recentHistory: BrainContext["recentHistory"];
  signalCount: number;
  surface: BrainContext["surface"];
  log: (event: Parameters<BrainContext["log"]>[0]) => void;
  // i18n: Accept-Language from the shopper's request, resolved via detectLocale().
  acceptLanguage?: string | null;
  // Page context — Shopify product handle + id of the PDP the shopper has open.
  // Sent by the widget in the chat request body. When set, Mira knows exactly
  // what's on screen and can reference it without asking.
  currentProductHandle?: string | null;
  currentProductId?: string | null;
  // Behavioral intent context from IntentEngine — multi-signal fusion object
  // sent by the widget with every chat turn. Injected into the prompt as the
  // 🧭 behavioral context block so Mira has page-level behavioral data.
  intentContext?: BrainContext["intentContext"];
}): Promise<BrainContext> {
  const plan = await getEffectivePlan(args.shopId);
  if (!plan) throw new Error("plan_missing");

  // ─── Parallel enrichment fetches ─────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // ─── Resolve current product from handle or id ───────────────────────────
  // Scoped to shopId — no cross-tenant access possible.
  let currentProduct: BrainContext["currentProduct"] = null;
  if (args.currentProductHandle || args.currentProductId) {
    const p = await prisma.product.findFirst({
      where: {
        shopId: args.shopId,
        ...(args.currentProductId
          ? { id: args.currentProductId }
          : { handle: args.currentProductHandle! }),
      },
      select: {
        id: true, handle: true, title: true, category: true, productType: true,
        primaryColor: true, colorFamily: true, vendor: true, tags: true,
        sizeChartJson: true, sizeChartSource: true,
        variants: { select: { size: true, priceCents: true, inventoryQuantity: true, availableForSale: true }, take: 50 },
        images: { where: { position: 0 }, select: { url: true }, take: 1 },
      },
    }).catch(() => null);

    if (p) {
      const sizes = [...new Set(p.variants.map(v => v.size).filter(Boolean) as string[])];
      const prices = p.variants.map(v => v.priceCents).filter((x): x is number => x != null);
      // Request B — per-size availability + the brand's real size chart, so
      // Mira knows what's buyable and what the garment actually measures.
      const stock = buildStock(p.variants);
      const sizeChart = parseSizeChart(p.sizeChartJson, p.sizeChartSource);
      currentProduct = {
        id: p.id,
        handle: p.handle,
        title: p.title,
        category: p.category,
        productType: p.productType,
        primaryColor: p.primaryColor,
        colorFamily: p.colorFamily,
        vendor: p.vendor,
        tags: p.tags,
        sizes,
        priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
        imageUrl: p.images[0]?.url ?? null,
        ...(stock.hasData
          ? {
              stockBySize: stock.stockBySize,
              inStockSizes: stock.inStockSizes,
              outOfStockSizes: stock.outOfStockSizes,
              lowStockSizes: stock.lowStockSizes,
            }
          : {}),
        sizeChart,
      };
    }
  }

  // ─── Catalog overview ─────────────────────────────────────────────────────
  const [catalogOverviewRaw, totalProducts] = await Promise.all([
    prisma.product.groupBy({
      by: ["category"],
      where: { shopId: args.shopId, category: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 6,
    }).catch(() => []),
    prisma.product.count({ where: { shopId: args.shopId } }).catch(() => 0),
  ]);
  const catalogOverview: Array<{ category: string; count: number }> = catalogOverviewRaw
    .filter((c) => (c as { category: unknown }).category != null)
    .map(c => ({
      category: String((c as { category: unknown }).category),
      count: (c as { _count: { id: number } })._count.id,
    }));

  const [recentRecs, recentBehavior] = await Promise.all([
    // Top 3 active brand recommendations — only for non-STARTER tiers.
    plan.tier === "STARTER"
      ? Promise.resolve([] as Array<{ kind: string; title: string; body: string }>)
      : listRecommendations({
          shopId: args.shopId,
          visibleKinds: [
            "TOP_COMBO_TO_PROMOTE",
            "STYLIST_DEMAND_SIGNAL",
            "CART_ABANDON_PATTERN",
            "CATALOG_GAP",
          ],
          includeDismissed: false,
        })
          .then((recs) =>
            recs.slice(0, 3).map((r) => ({ kind: r.kind, title: r.title, body: r.body }))
          )
          .catch(() => [] as Array<{ kind: string; title: string; body: string }>),

    // Top 5 product categories the shopper engaged with in the last 7 days.
    // OI-37: Redis 5-min TTL cache on (shopId, shopperRowId) — stable within a
    // session, so repeated turns skip the DB scan entirely. Falls back to a
    // fresh read when Redis is absent or errors.
    // Capped at 200 rows to bound table scan on large analytics tables.
    (async (): Promise<Array<{ category: string; count: number }>> => {
      // Cache hit — avoid the DB scan entirely.
      const cached = await getCachedBehavior(args.shopId, args.shopperRowId);
      if (cached) return cached;

      try {
        const events = await prisma.analyticsEvent.findMany({
          where: {
            shopId: args.shopId,
            shopperId: args.shopperRowId,
            name: { in: ["PRODUCT_DWELL_LONG", "STYLE_VOTED", "PRODUCT_VIEWED"] },
            createdAt: { gte: sevenDaysAgo },
          },
          select: { productId: true },
          take: 200, // cap scan — 200 rows is more than enough signal
        });
        if (events.length < 3) return [];
        const productIds = [...new Set(events.map((e) => e.productId).filter(Boolean))] as string[];
        if (!productIds.length) return [];
        const products = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, category: true },
        });
        const categoryMap = new Map(products.map((p) => [p.id, p.category]));
        const counts: Record<string, number> = {};
        for (const e of events) {
          const cat = e.productId ? (categoryMap.get(e.productId) ?? null) : null;
          if (cat) counts[cat] = (counts[cat] ?? 0) + 1;
        }
        const result = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([category, count]) => ({ category, count }));

        // Write-through cache — fire-and-forget, don't block the response.
        void setCachedBehavior(args.shopId, args.shopperRowId, result);
        return result;
      } catch {
        return [];
      }
    })(),
  ]);

  // ─── Brand stock pulse + active sales (Request B) ──────────────────────────
  // Both best-effort: a failure here never breaks a chat turn (Mira just loses
  // a context block). brandSnapshot scans a bounded slice of the catalog so the
  // cost stays flat on large shops; activeSales is admin-declared config.
  const [brandSnapshot, activeSales, brandDNA] = await Promise.all([
    (async (): Promise<BrainContext["brandSnapshot"]> => {
      try {
        const rows = await prisma.product.findMany({
          where: { shopId: args.shopId },
          select: {
            title: true, handle: true,
            variants: { select: { size: true, inventoryQuantity: true, availableForSale: true } },
          },
          take: 400, // bound the scan — enough to characterise the catalog
        });
        let inStockProducts = 0, lowStockProducts = 0, outOfStockProducts = 0;
        const runningLow: NonNullable<BrainContext["brandSnapshot"]>["runningLow"] = [];
        for (const r of rows) {
          const s = buildStock(r.variants);
          if (!s.hasData) { inStockProducts++; continue; } // unknown → assume buyable
          if (s.inStockSizes.length === 0) { outOfStockProducts++; continue; }
          inStockProducts++;
          if (s.lowStockSizes.length > 0) {
            lowStockProducts++;
            if (runningLow.length < 6) {
              runningLow.push({ title: r.title, handle: r.handle, lowSizes: s.lowStockSizes });
            }
          }
        }
        return {
          totalProducts,
          inStockProducts,
          lowStockProducts,
          outOfStockProducts,
          runningLow,
          topCategories: catalogOverview,
        };
      } catch {
        return undefined;
      }
    })(),

    (async (): Promise<BrainContext["activeSales"]> => {
      try {
        const planRow = await prisma.plan.findUnique({
          where: { shopId: args.shopId },
          select: { planFeaturesJson: true },
        });
        const raw = (planRow?.planFeaturesJson as { activeSales?: unknown } | null)?.activeSales;
        if (!Array.isArray(raw)) return undefined;
        const now = Date.now();
        const sales = raw
          .map((s) => {
            if (!s || typeof s !== "object") return null;
            const o = s as Record<string, unknown>;
            const title = o.title != null ? String(o.title).slice(0, 120) : "";
            if (!title) return null;
            const endsAt = o.endsAt != null ? String(o.endsAt) : undefined;
            // Drop expired promos so Mira never quotes a dead deadline.
            if (endsAt) { const t = Date.parse(endsAt); if (Number.isFinite(t) && t < now) return null; }
            return {
              title,
              detail: o.detail != null ? String(o.detail).slice(0, 200) : undefined,
              code: o.code != null ? String(o.code).slice(0, 40) : undefined,
              endsAt,
              appliesTo: o.appliesTo != null ? String(o.appliesTo).slice(0, 80) : undefined,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x != null)
          .slice(0, 5);
        return sales.length ? sales : undefined;
      } catch {
        return undefined;
      }
    })(),

    loadBrandDNA(args.shopId),
  ]);

  return {
    shopId: args.shopId,
    shopDomain: args.shopDomain,
    shopperRowId: args.shopperRowId,
    shopperSessionId: args.shopperSessionId,
    tier: plan.tier,
    features: plan.features,
    brief: args.brief,
    accountClaimed: args.accountClaimed,
    signupAlreadyOffered: args.signupAlreadyOffered,
    recentHistory: args.recentHistory,
    signalCount: args.signalCount,
    surface: args.surface,
    locale: detectLocale(args.acceptLanguage ?? undefined),
    currentProductHandle: args.currentProductHandle ?? undefined,
    currentProductId: args.currentProductId ?? undefined,
    currentProduct,
    catalogOverview,
    totalProducts,
    recentRecs,
    recentBehavior,
    intentContext: args.intentContext,
    brandSnapshot,
    activeSales,
    brandDNA,
    brandMode: (plan.features as unknown as { brandMode?: string }).brandMode === "beauty"
      ? "beauty"
      : "fashion",
    // Populate beautyContext only when this shop is in beauty mode so the
    // Brain prompt block is non-empty only when Mira can actually act on it.
    beautyContext: (plan.features as unknown as { brandMode?: string }).brandMode === "beauty"
      ? await buildBeautyBrainContext(args.shopperSessionId ?? null, args.shopDomain)
      : undefined,
    cache: new Map(),
    log: args.log,
  };
}
