// Stylique Brain — provider-agnostic orchestrator core types.
//
// Architecture in plain words: the Brain is the *only* thing that talks to an
// LLM. Every shopper-facing surface (Stylist, Studio agent, future returns
// agent) calls `brain.run(input)` and gets back `{ reply, combos, actions,
// events }`. The Brain in turn:
//
//   1. Loads BrainContext (shopper identity, shop, tier features, recent
//      history, taste vector, brief).
//   2. Picks a ModelProvider (Gemini, Claude, GPT-4, local Llama) per config.
//   3. Composes a system prompt from BrainContext.
//   4. Calls provider.turn(...) which yields tool calls.
//   5. Dispatches each tool call through ToolRegistry — with entitlement
//      checks, tier gating, and analytics events automatic.
//   6. Returns the model's final text reply plus any structured payload the
//      surface needs to render (combos, signup card, cart card, etc).
//
// The point: when we add Claude, we add ONE file. When we add a new tool
// (e.g. `see_on_model` for Phase 2), we register ONE object — no provider
// code is touched. When we A/B-test prompts, the variant lives in
// BrainConfig, not in the model adapter.

import type { PlanFeatures } from "@stylique/core/src/plans/features";
import type { PlanTier } from "@stylique/types";

// Re-export so consumers of @stylique/ai don't have to also depend on @stylique/core
// just to type a tool handler. Brain owns the public surface.
export type { PlanFeatures, PlanTier };

// ─── Roles + messages ────────────────────────────────────────────────────

export type BrainRole = "user" | "model";

export type BrainMessage = {
  role: BrainRole;
  text: string;
  // Surfaces (stylist UI, future Studio chat) attach rich payload here so
  // they can render product cards / combos without re-parsing the text.
  combos?: BrainCombo[];
  // Image attachment — selfie, reference look, product photo. The shopper
  // sends, Mira sees. We do NOT store images server-side; they are passed
  // through to the model and dropped. Format: data URL, e.g.
  // "data:image/jpeg;base64,/9j/4AAQ...". Cap 5MB at the client.
  imageDataUrl?: string;
};

// ─── Product / combo shapes (shared by every surface) ────────────────────

export type BrainProduct = {
  id: string;
  handle: string;
  title: string;
  imageUrl: string | null;
  primaryColor: string | null;
  colorFamily: string | null;
  category: string | null;
  sizes: string[];
};

export type BrainCombo = {
  name: string;
  reasoning: string;
  products: BrainProduct[];
};

// ─── Legacy chat-module aliases (Sprint 6 round 3 / OI-11) ───────────────
// The standalone `packages/ai/src/chat/` module was deleted. Surfaces that
// were importing `ChatMessage` / `ChatProduct` / `ChatCombo` keep working
// because we re-export the same shapes under those names. New code should
// prefer the `Brain*` names. Marked @deprecated so IDEs nudge migration.
/** @deprecated Use BrainMessage. */
export type ChatMessage = BrainMessage;
/** @deprecated Use BrainProduct. */
export type ChatProduct = BrainProduct;
/** @deprecated Use BrainCombo. */
export type ChatCombo   = BrainCombo;
/** @deprecated The legacy `ChatRole` is now `BrainRole`. */
export type ChatRole    = BrainRole;

// ─── Current product enrichment ──────────────────────────────────────────
// Full product data for the PDP the shopper is currently viewing. Resolved
// from currentProductHandle/currentProductId by buildBrainContext(). Null on
// collection pages, homepage, etc.
export type BrainCurrentProduct = {
  id: string;
  handle: string;
  title: string;
  category: string | null;
  productType: string | null;
  primaryColor: string | null;
  colorFamily: string | null;
  vendor: string | null;
  tags: string[];
  sizes: string[];          // distinct from variants
  priceRange: { min: number; max: number } | null;  // in cents
  imageUrl: string | null;

  // ─── Live availability (Request B). Per-size remaining quantity for the
  // product the shopper is looking at, so Mira never recommends a size that's
  // gone and can create honest urgency ("only 2 left in M"). Key = size label
  // (e.g. "M"), value = units remaining. A size missing from the map OR mapped
  // to 0 is out of stock. Empty/undefined = inventory unknown (don't block).
  stockBySize?: Record<string, number>;
  // Convenience rollups derived from stockBySize at build time.
  inStockSizes?: string[];
  outOfStockSizes?: string[];
  lowStockSizes?: string[];     // 1–3 units left — the urgency tier

  // ─── Size chart (Request B / D37 / D39). The extracted, normalised chart
  // for THIS product, whatever the source format was (JSON metafield, HTML
  // table, description, linked size-guide page, or Gemini-Vision OCR of a
  // size-chart image). Measurements in the unit given. Null = no chart found
  // anywhere → Mira leans on category defaults via show_size_recommendation.
  sizeChart?: {
    unit: "cm" | "in";
    source: string | null;      // where it came from (audit/trust)
    sizes: Array<{
      name: string;
      chest?: number; waist?: number; hip?: number;
      length?: number; sleeve?: number; inseam?: number;
    }>;
  } | null;
};

// ─── Client-side actions the surface should execute after a turn ─────────
// These are NOT tools — they are post-turn instructions to the UI. Tools are
// the model's hands; actions are the model's mouth telling the surface what
// to do next.

export type BrainClientAction =
  | { kind: "navigate"; handle: string }
  | { kind: "add_to_cart_request"; productId: string; suggestedSize?: string }
  | { kind: "show_signup_card"; reason: string }
  // autoRender: when true (default for see_on_model — we have everything we
  // need to fire the render the moment the widget opens), the widget kicks
  // off /api/tryon/render automatically. PERSONAL_PHOTO can't auto-render
  // because we don't have the photo yet — the widget waits for upload.
  | { kind: "open_tryon"; mode: "model" | "photo"; productIds: string[]; modelHint?: string; autoRender?: boolean; comboName?: string }
  | { kind: "open_studio"; sourceComboName: string; productIds: string[] }
  // Guided shopping actions — Rufus-pattern page-aware navigation and highlighting.
  // lead_browse: navigate to a PDP and speak about a specific detail on arrival.
  | { kind: "lead_browse"; handle: string; productId?: string; title: string; arrivalFocus?: string; imageUrl?: string }
  // guide_combo_walkthrough: step-by-step guided tour of a combo, product by product.
  | { kind: "guide_combo_walkthrough"; comboName: string; steps: Array<{ handle: string; productId?: string; title: string; role?: string; whyItWorksForYou: string; imageUrl?: string }> }
  // highlight_product_detail: draw the shopper's attention to a specific zone of the
  // product image currently on screen. Only meaningful when on a PDP.
  | { kind: "highlight_product_detail"; detail: string; imageZone?: "full" | "top" | "bottom" | "left" | "right" | "center" }
  // show_size_recommendation: surface a size recommendation card proactively.
  // If the shopper has no fit data, the widget shows the fit collection form instead.
  | { kind: "show_size_recommendation"; productId: string; productTitle: string; recommendation: { recommendedSize: string; confidence: number; trustLine: string; fitPreference?: string; alternativeSizes?: string[] } }
  | { kind: "collect_fit_for_sizing"; productId: string; productTitle: string }
  | { kind: "add_outfit_to_cart"; items: Array<{ productId: string; suggestedSize?: string }>; comboName?: string };

// ─── Tools — registered once, called by any provider ─────────────────────

export type ToolSchema = {
  // JSON-Schema-ish — what the model sees and must produce in args.
  type: "object";
  properties: Record<string, {
    type: "string" | "number" | "integer" | "boolean" | "array" | "object";
    description: string;
    items?: { type: string };
    enum?: string[];
  }>;
  required?: string[];
};

export type ToolDef<TArgs = Record<string, unknown>, TResult = unknown> = {
  name: string;
  description: string;             // shown to the model
  schema: ToolSchema;

  // Tier required to even SEE the tool. Tools above the shop's tier are
  // hidden from the model — it doesn't know they exist.
  minTier?: PlanTier;

  // Feature flag (resolved via PlanFeatures). If false, tool is hidden.
  requiresFeature?: keyof FeatureFlagMap;

  // Per-shopper usage cap (defaults: unlimited). Brain checks before dispatch.
  metric?:
    | "TRYON_PERSONAL" | "TRYON_BODY"
    | "CREATIVE_GENERATED" | "CREATIVE_SET_GENERATED"
    | "STYLE_RECOMMENDATION" | "FIT_RECOMMENDATION";

  // Implementation. If `unimplemented: true`, brain returns a "coming soon"
  // result without invoking the handler — useful for Phase 2 stubs that the
  // model can reference but not yet trigger.
  unimplemented?: boolean;

  // The handler runs server-side with the brain context. Throw to fail the
  // call — the model will see an error in the function response and may
  // recover. Return value must be JSON-serialisable.
  handler?: (args: TArgs, ctx: BrainContext) => Promise<TResult>;
};

// Compact alias map used by `requiresFeature` so we don't repeat the union.
export type FeatureFlagMap = {
  "studio.enabled": boolean;
  "studio.video": boolean;
  "studio.upscaler": boolean;
  "widget.enabled": boolean;
  "widget.personalPhotoTryOn": boolean;
  "widget.multiAngleTryOn": boolean;
  "stylist.enabled": boolean;
  "stylist.tasteVector": boolean;
  "stylist.signupOffer": boolean;
  "stylist.cartActions": boolean;
  "stylist.navigateActions": boolean;
  "stylist.proactiveTriggers": boolean;
};

// ─── Brain context — passed to every tool handler ────────────────────────
//
// This is the bundled "what we know" payload. Tools query it for shop scope,
// tier features, shopper identity, recent taste — instead of re-fetching
// per call. The Brain hydrates it once per turn.

export type BrainContext = {
  // Tenancy
  shopId: string;
  shopDomain: string;
  shopperRowId: string;
  shopperSessionId: string;       // cookie value

  // Plan + entitlement
  tier: PlanTier;
  features: PlanFeatures;

  // Shopper memory + taste
  brief: string | null;
  accountClaimed: boolean;
  signupAlreadyOffered: boolean;
  recentHistory: BrainMessage[];
  signalCount: number;

  // Surface that opened the brain (so prompts can adapt)
  surface: BrainSurface;

  // i18n: shopper's preferred locale (from Accept-Language via /api/shopper/me).
  // Mira uses this to respond in the same language when the locale is non-English.
  // Wired in buildBrainContext() via detectLocale(acceptLanguage).
  locale?: string;

  // Page context — what product the shopper is currently viewing.
  // Set by the chat route when the widget sends `currentProductHandle` in the
  // request body. Tools and the system prompt use this so Mira can reference
  // the specific product on screen without asking "which product do you mean?"
  currentProductHandle?: string;
  currentProductId?: string;

  // The product page the shopper is currently viewing. Resolved from
  // currentProductHandle/currentProductId by buildBrainContext(). Null on
  // collection pages, homepage, etc.
  currentProduct: BrainCurrentProduct | null;

  // Catalog overview — top categories + total count. Used in the system prompt
  // so Mira knows what the brand carries.
  catalogOverview: Array<{ category: string; count: number }>;
  totalProducts: number;

  // Top 3 active brand recommendations — injected so Mira can proactively
  // mention them ("I noticed your blazer combo is trending this week").
  // Empty array when no recs exist or shop is on STARTER tier.
  recentRecs: Array<{ kind: string; title: string; body: string }>;

  // Shopper's top-engaged product categories in the last 7 days, derived from
  // PRODUCT_DWELL_LONG + STYLE_VOTED + PRODUCT_VIEWED events. Lets Mira say
  // "you've been gravitating toward blazers and wide-leg trousers this week."
  // Empty array when no signals or fewer than 3 events.
  recentBehavior: Array<{ category: string; count: number }>;

  // Behavioral intent context from the shopper's browser-side IntentEngine.
  // Injected into every chat request and surfaced to Mira via the prompt so
  // she knows dwell time, active signals, and compare-bounce patterns.
  intentContext?: IntentContext;

  // ─── Brand stock pulse (Request B — "stock-level catalog injection").
  // A brand-wide availability snapshot so Mira knows the floor she's working
  // with before she recommends anything: how many products are fully stocked,
  // which are running low, which are gone. Lets her steer toward what's
  // actually buyable and create honest scarcity. Built once per turn in
  // buildBrainContext(); always shopId-scoped.
  brandSnapshot?: {
    totalProducts: number;
    inStockProducts: number;
    lowStockProducts: number;     // ≥1 size at 1–3 units
    outOfStockProducts: number;   // every size 0/unavailable
    // A few named low-stock items Mira can name-drop for urgency. Title only —
    // never internal ids. Capped to keep the prompt lean.
    runningLow: Array<{ title: string; handle: string; lowSizes: string[] }>;
    topCategories: Array<{ category: string; count: number }>;
  };

  // ─── Active sales / promotions the brand is running right now (Request B —
  // "know about business when sales come"). Admin-declared on
  // Plan.planFeaturesJson.activeSales (Shopify has no single clean "current
  // promos" endpoint and a half-synced discount mirror would lie). Mira
  // surfaces these honestly — never invents a discount. Empty = no live promo.
  activeSales?: Array<{
    title: string;
    detail?: string;              // "20% off all linen", "Buy 2 get 1"
    code?: string;                // discount code to mention, if any
    endsAt?: string;              // ISO — lets Mira add a real deadline
    appliesTo?: string;           // category/collection hint
  }>;

  // Brand DNA — visual/tone/style memory learned from catalog scans, reference
  // assets, and creative review feedback. Soft guidance only: it must never
  // override catalog facts or shopper preferences.
  brandDNA?: {
    palette?: string[];
    tone?: string[];
    style?: string[];
    creativeMemory?: string[];
    trainedAt?: Date | null;
  };

  // Brand mode — "fashion" (default) or "beauty". Controls which prompt
  // variant is injected and which tools are visible. Set once at shop
  // configuration via Plan.planFeaturesJson.brandMode.
  // When "beauty", the Brain auto-selects the beautyAdvisorVariant prompt
  // and makes beauty tools (shade match, routine builder, etc.) visible.
  brandMode?: "fashion" | "beauty";

  // Beauty-specific shopper context — populated when brandMode === "beauty".
  // Read by buildBeautyBrainContext() and injected into buildBrainContext().
  // Mira uses this to skip re-asking skin questions and to discuss the saved
  // routine without calling build_routine every turn.
  beautyContext?: {
    skinType?: string;
    concerns?: string[];
    depth?: string;
    undertone?: string;
    skinHex?: string;
    routinePreference?: string;
    savedRoutine?: {
      name: string;
      timeOfDay: string;
      stepCount: number;
      totalPriceUsd: number;
      /** e.g. "Cleanse (Gentle Foam Cleanser), Moisturise (Hydra Cream)" */
      stepSummary: string;
      savedAt: Date | null;
    };
  };

  // Cross-call cache (lives only for this turn) — tools use this to avoid
  // double-fetching products that propose_combo references after search.
  cache: Map<string, unknown>;

  // Logger + event emitter — fire-and-forget, errors swallowed.
  log: (event: BrainEvent) => void;
};

export type BrainSurface = "stylist_chat" | "studio_chat" | "admin_assistant" | "api";

// ─── Client-side intent context (from IntentEngine in apps/widget/src/intent.ts) ─
// Injected into every chat request body by the widget and surfaced to Mira
// via buildShopperBrief() so she has behavioral context on each turn.
// The full type lives client-side; this mirror is for server-side type-checking.
export type IntentState = "BROWSING" | "DISCOVERING" | "CONSIDERING" | "DECIDING" | "CONVERTING";

export type IntentContext = {
  state: IntentState;
  confidenceScore: number;
  activeSignals: string[];
  currentPdpHandle: string | null;
  currentPdpDwellSeconds: number;
  viewHistory: string[];
  comparedPair: [string, string] | null;
  sessionDepthSeconds: number;
  returnVisit: boolean;
  cartHasItems: boolean;
};

export type BrainEvent = {
  name: string;                   // matches AnalyticsEvent.name (EventName enum)
  productId?: string;
  payload?: Record<string, unknown>;
};

// ─── Brain input + output ────────────────────────────────────────────────

export type BrainInput = {
  ctx: BrainContext;
  messages: BrainMessage[];        // current conversation
  // Optional config overrides used by A/B testing later.
  config?: {
    providerKey?: string;          // "gemini" | "anthropic" | "openai" | "local"
    promptVariant?: string;        // experiment label
    temperature?: number;
    maxToolHops?: number;
  };
};

export type BrainOutput = {
  reply: string;
  combos: BrainCombo[];
  actions: BrainClientAction[];
  latencyMs: number;
  modelUsed: string;
  toolsCalled: string[];           // for analytics + A/B comparison

  // Routing metadata — present only when a classifier + router are wired into
  // the BrainConfig (the hybrid AI+Rules path). Lets the caller log which model
  // handled which turn and why, so merchants/analytics can see the cost-routing
  // in action. Absent when the Brain runs without routing (behaves as before).
  routingMeta?: {
    intent: string;
    complexity: string;
    provider: string;
    reason: string;
  };
};

// ─── Model provider interface — implemented by gemini.ts, anthropic.ts, … ─
//
// Each provider knows nothing about Stylique tools or context. It receives a
// list of messages, a list of tool declarations, and a system prompt, and it
// yields tool calls + text. The Brain owns the actual tool dispatch.

export type ProviderToolCall = {
  name: string;
  args: Record<string, unknown>;
  callId?: string;                 // some providers (Claude) need this
};

export type ProviderToolResult = {
  name: string;
  callId?: string;
  response: Record<string, unknown>;
};

export type ProviderTurnInput = {
  systemPrompt: string;
  messages: BrainMessage[];
  tools: ToolDef[];                 // model only sees these
  // Multi-hop tool-calling state. The Brain accumulates these across hops
  // and passes them into the provider on each call so the wire-format chain
  // reconstructs correctly (Gemini: model{functionCall} → user{functionResponse}).
  priorToolCalls?: ProviderToolCall[];
  pendingToolResults?: ProviderToolResult[];
  temperature?: number;
};

export type ProviderTurnOutput = {
  // Either the model is asking for tools, OR it returned final text.
  toolCalls: ProviderToolCall[];
  text: string;                   // empty if toolCalls.length > 0
};

export interface ModelProvider {
  readonly key: string;            // "gemini" | "anthropic" | "openai" | "local"
  readonly defaultModel: string;
  turn(input: ProviderTurnInput): Promise<ProviderTurnOutput>;
}
