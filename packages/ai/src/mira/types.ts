// ─────────────────────────────────────────────────────────────────────────
// Mira — shared types. The ONE TRUTH consumed by every store:
//   - Shopify production (apps/shopify-app/app/lib/mira-adapter.server.ts)
//   - Demo store (apps/web/app/api/mira/route.ts)
//   - Any future caller
//
// Every store passes its OWN catalog (merchant Prisma OR demo hardcoded OR test),
// its OWN brand identity (BrandProfile DNA OR demo defaults), its OWN
// knowledge block (admin teach OR empty). The brain is provider-agnostic,
// tenant-agnostic, store-agnostic — pure logic.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Catalog product — the shape the brain reads. Stores transform their native
 * shape (Prisma Product, demo hardcoded, anything else) into this BEFORE
 * passing it in. Optional fields make the brain robust on stores that
 * haven't run every extraction pipeline yet.
 */
export interface MiraProduct {
  handle: string;
  name: string;
  category: string;
  collection?: string;
  priceUsd: number;
  colors: string[];
  sizes: string[];
  /** Sizes confirmed in-stock NOW (variant.inventoryQuantity > 0 OR availableForSale ≠ false). NULL → unknown, treat as available. */
  inStockSizes?: string[];
  fitNotes?: string;
  fabricComposition?: string;
  careInstructions?: string;
  /** Image-quality-winner first; remaining images behind. */
  images?: string[];
  /** Multi-source extracted size chart (D37/D39: metafield / HTML / description / linked page / image OCR). */
  sizeChart?: unknown;
  sizeChartSource?: string | null;
  description?: string;
  keepRate?: number;
  lowStock?: boolean;
  tags?: string[];
  tryonReady?: boolean;
  widgetTier?: number;
}

/**
 * Merchant brand identity — replaces "Stylique Maison" hardcoded block when
 * synthesized server-side from BrandProfile.toneJson + Plan stylist override
 * + Shop name. Demo passes nothing → falls through to Stylique Maison defaults.
 */
export interface MiraBrandIdentity {
  /** Shop name shown to the shopper. e.g. "Stylee", "Acme Apparel". */
  name?: string;
  /** "You are {stylist}, a warm assistant at {brand}…" — replaces the demo's intro line. */
  intro?: string;
  /** THE BRAND YOU WORK FOR block — synthesised from BrandProfile DNA (dominantFabrics, dominantColors, vibeWords, pricePositioning, formality). */
  pov?: string;
  /** Per-merchant returns policy (if set in Plan.planFeaturesJson.policy.returns). */
  returns?: string;
  /** Per-merchant shipping policy. */
  shipping?: string;
}

/**
 * Shopper request — exactly what the brain needs. Every caller (Shopify
 * production, demo, test) builds this from its own session state.
 */
export interface MiraInput {
  message: string;
  currentProductHandle?: string | null;
  history?: Array<{ from: "user" | "mira"; text: string }>;
  shownHandles?: string[];
  knownSize?: string | null;
  bodyOnFile?: {
    heightCm: number;
    weightKg: number;
    fitPref: string;
    age?: number;
    usualBrandSize?: string;
  } | null;
  // Closing intelligence (panel rec): the more we know about THIS shopper's
  // session, the sharper Mira's close. All optional — brain runs fine with none.
  sizeConfirmed?: boolean;
  tryOnCompleted?: boolean;
  tryOnAbandoned?: boolean;
  outfitAccepted?: boolean;
  outfitPiecesRecommended?: number;
  cartItemCount?: number;
  activeLookSummary?: string | null;
  tryOnContextSummary?: string | null;
}

/**
 * Tenant + environment context. The provider, env vars, locale, and which
 * sink callbacks to use travel here so the brain is pure logic.
 */
export interface MiraContext {
  /** Merchant catalog projected to MiraProduct shape. Required. */
  catalog: MiraProduct[];
  /** Brand identity — undefined fields fall through to Stylique Maison defaults. */
  brand?: MiraBrandIdentity;
  /** Admin-injected knowledge block ("Sale runs through Friday", "All blazers true to size"). */
  knowledge?: string;
  /** ISO currency code from Shop.currencyCode (e.g. "USD", "GBP", "INR"). Demo defaults to USD. */
  currency?: string;
  /** Accept-Language → locale signal so Mira can mirror the shopper's region. */
  acceptLanguage?: string | null;
  /** Optional shopId for shopId-scoped sinks. */
  shopId?: string;
  /** Gemini API key — provider abstraction layer (Claude/OpenAI stubs land here later). */
  geminiApiKey?: string;
  /** Override the model (defaults to gemini-2.5-flash per LOCAL-FIX-CONSOLIDATION). */
  primaryModel?: string;
  fallbackModel?: string;
  /** Sink callbacks — every store has its own (Prisma for shopify-app, flat-file for demo). */
  sinks?: MiraSinks;
}

/**
 * Side-effect sinks the brain fires AFTER the decision lands. Every caller
 * wires its own — Prisma writes on shopify-app, flat-file on the demo.
 */
export interface MiraSinks {
  recordSignal?: (s: {
    query: string;
    route: string;
    intent: string;
    productHandle?: string | null;
    source: "gemini" | "fallback";
    unmet?: boolean;
    unmetCategory?: string;
    unmetReason?: string;
    nearMiss?: boolean;
    nearMissCategory?: string;
    nearMissAttribute?: string;
    nearMissReason?: string;
  }) => Promise<void> | void;
  emitIntentCaptured?: (intent: string, message: string) => Promise<void> | void;
  emitProductRecommended?: (handle: string) => Promise<void> | void;
  emitOutfitRecommended?: (handle: string) => Promise<void> | void;
  emitSizeHelpStarted?: (handle: string | null) => Promise<void> | void;
  emitTryOnOffered?: (handle: string | null) => Promise<void> | void;
  emitHesitationDetected?: (message: string, handle: string | null) => Promise<void> | void;
  emitAddToCartAssist?: (handle: string | null, real: boolean) => Promise<void> | void;
  emitUnmetDemand?: (message: string, category: string, reason: string) => Promise<void> | void;
  emitNearMiss?: (message: string, handle: string, category: string, attribute: string, reason: string) => Promise<void> | void;
}

/** Final result. */
export interface MiraResult {
  source: "gemini" | "fallback";
  model: string | null;
  decision: MiraDecision | null;
}

// ─── Decision schema (15 routes, all the recent fixes baked in) ────────────

export const MIRA_ROUTES = [
  "reco_category",
  "reco_handle",
  "reco_filter",
  "navigate",
  "look",
  "fit",
  "fabric",
  "suitability",
  "size_form",
  "try_on",
  "returns",
  "add_to_cart",
  "studio",
  "search",
  "talk_only",
] as const;

export type MiraRoute = typeof MIRA_ROUTES[number];

export const MIRA_FILTERS = [
  "cheapest", "premium", "new", "dark", "no_dark", "edgy", "minimal",
  "winter", "summer", "everyday", "gift", "evening", "wedding",
] as const;
export type MiraFilter = typeof MIRA_FILTERS[number];

export const MIRA_CATEGORIES = ["top", "bottom", "knitwear", "outerwear", "evening", "dress"] as const;
export type MiraCategoryEnum = typeof MIRA_CATEGORIES[number];

export const MIRA_INTENTS = [
  "discover", "occasion", "specific", "size", "suitability", "fabric",
  "price", "look", "try_on", "support", "greeting", "other",
] as const;
export type MiraIntent = typeof MIRA_INTENTS[number];

export interface MiraDecision {
  voice: string;
  route: MiraRoute;
  category?: MiraCategoryEnum;
  filter?: MiraFilter;
  productHandle?: string;
  searchQuery?: string;
  disagree?: boolean;
  quickReplies?: string[];
  intent?: MiraIntent;
  // Learning-loop fields — the moat
  unmet?: boolean;
  unmetCategory?: string;
  unmetReason?: string;
  nearMiss?: boolean;
  nearMissCategory?: string;
  nearMissAttribute?: string;
  nearMissReason?: string;
}
