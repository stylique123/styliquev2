// Shared contracts between widget, web, shopify-app, worker.
// Implementations live in packages/core and packages/ai.

import { z } from "zod";

// ----- Shopper inputs (widget → API) -----

export const FitPreferenceSchema = z.enum(["FITTED", "SLIM", "REGULAR", "RELAXED", "OVERSIZED"]);

export const ShopperProfileSchema = z.object({
  sessionId: z.string().min(8),
  heightCm: z.number().int().min(80).max(230).optional(),
  weightKg: z.number().int().min(25).max(250).optional(),
  fitPreference: FitPreferenceSchema.optional(),
  bodyType: z.string().max(40).optional(),
  photoAssetId: z.string().optional(),
});
export type ShopperProfile = z.infer<typeof ShopperProfileSchema>;

// ----- Try-On -----

export const TryOnModeSchema = z.enum(["BODY_MODEL", "PERSONAL_PHOTO"]);
export const TryOnRequestSchema = z.object({
  sessionId: z.string(),
  productId: z.string(),
  mode: TryOnModeSchema,
  photoAssetId: z.string().optional(),
});

// ----- Fit -----

export const FitRequestSchema = z.object({
  sessionId: z.string(),
  productId: z.string(),
});

export const FitResponseSchema = z.object({
  recommendedSize: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),
});

// ----- Style / color combos -----

export const ColorComboSchema = z.object({
  name: z.string(),
  palette: z.array(z.string()).min(2),
  rationale: z.string(),
  occasion: z.string().optional(),     // "weekend", "office", "evening"
  season: z.enum(["SS", "AW", "ALL"]).optional(),
});
export type ColorCombo = z.infer<typeof ColorComboSchema>;

export const OutfitItemSchema = z.object({
  productId: z.string(),
  role: z.enum(["ANCHOR", "BOTTOM", "TOP", "OUTERWEAR", "SHOES", "ACCESSORY"]),
  colorNote: z.string().optional(),
});
export type OutfitItem = z.infer<typeof OutfitItemSchema>;

export const StyleResponseSchema = z.object({
  outfit: z.array(OutfitItemSchema),
  colorCombos: z.array(ColorComboSchema),
});

// ----- Color rule contracts (consumed by Style + Studio) -----

export const ColorRuleSchema = z.object({
  anchorColor: z.string(),                   // hex
  compatibleColors: z.array(z.string()),     // hex
  contrastColors: z.array(z.string()),       // hex (high-contrast pairings)
  neutralPairings: z.array(z.string()),      // hex (whites/beiges/blacks/etc.)
  seasonalPairings: z.object({
    SS: z.array(z.string()),
    AW: z.array(z.string()),
  }).optional(),
});
export type ColorRule = z.infer<typeof ColorRuleSchema>;

// ----- Plan / usage contracts -----

export const PlanTierSchema = z.enum(["STARTER", "GROWTH", "ULTIMATE"]);
export type PlanTier = z.infer<typeof PlanTierSchema>;

export const ANALYTICS_LEVELS = ["BASIC", "ADVANCED", "ULTIMATE"] as const;
export type AnalyticsLevel = (typeof ANALYTICS_LEVELS)[number];

export const UsageMetricSchema = z.enum([
  "TRYON_PERSONAL",
  "TRYON_BODY",
  "CREATIVE_GENERATED",
  "CREATIVE_SET_GENERATED",
  "STYLE_RECOMMENDATION",
  "FIT_RECOMMENDATION",
  "VISION_TURN",        // Gemini Vision call from Mira (Sprint 5 audit fix)
  "STYLIST_TURN",       // One Mira chat turn against a Plan.monthlyTurns cap (P1)
]);
export type UsageMetric = z.infer<typeof UsageMetricSchema>;

// ----- Analytics events -----

export const EventNameSchema = z.enum([
  "WIDGET_VIEWED",
  "TRYON_STARTED",
  "TRYON_COMPLETED",
  "TRYON_PHOTO_UPLOADED",
  "FIT_RECOMMENDED",
  "SIZE_SELECTED",
  "STYLE_VIEWED",
  "STYLE_PRODUCT_CLICKED",
  "COLOR_COMBO_VIEWED",
  "PRODUCT_AUDIT_GENERATED",
  "ADD_TO_CART",
  "CHECKOUT_STARTED",
  "PURCHASE",
  // Demo-only
  "DEMO_PRODUCT_VIEWED",
  "DEMO_TRYON_BODY_SELECTED",
  "DEMO_TRYON_PHOTO_REQUESTED",
  "DEMO_FIT_SUBMITTED",
  "DEMO_STYLE_RECOMMENDATION_VIEWED",
  "DEMO_COLOR_COMBO_VIEWED",
  "DEMO_AUDIT_VIEWED",
  "WIDGET_OPENED",
  "WIDGET_CLOSED",
  "WIDGET_CTA_CLICKED",
  "WIDGET_BODY_MODEL_SELECTED",
  "WIDGET_FIT_SUBMITTED",
  "WIDGET_STYLE_VIEWED",
  // Stylist / chat (Layer 2)
  "CHAT_OPENED",
  "CHAT_CLOSED",
  "CHAT_MESSAGE_SENT",
  "CHAT_REPLY_RECEIVED",
  "CHAT_PRODUCT_CLICKED",
  "CHAT_COMBO_PROPOSED",
  "CHAT_SEARCH_RUN",
  "CHAT_IMAGE_MATCH_RUN",
  "CHAT_NAV_REQUESTED",
  "CHAT_CART_REQUESTED",
  "CART_CONFIRMED",
  "CART_CANCELLED",
  "CART_FAILED",
  "SIGNUP_OFFERED",
  "SIGNUP_CARD_SHOWN",
  "SIGNUP_CLAIMED",
  "SIGNUP_DISMISSED",
  "ACCOUNT_CLAIMED",
  // Widget extras
  "WIDGET_STEP_VIEWED",
  "WIDGET_MOOD_SELECTED",
  "WIDGET_MODEL_SELECTED",
  "WIDGET_EXPERIENCE_SELECTED",
  // VTO render lifecycle (Sprint 6 / D34).
  "PDP_TRYON_CLICKED",
  "TRYON_RENDER_REQUESTED",
  "TRYON_RENDER_COMPLETED",
  "TRYON_RENDER_FAILED",
  "TRYON_ABANDONED",
  // Mira-collected via capture_shopper_profile. Distinct from WIDGET_FIT_SUBMITTED
  // because the chat doesn't compute a recommendedSize / confidence — the
  // Widget does. Reusing WIDGET_FIT_SUBMITTED dropped these events at zod
  // validation. (Fixed Sprint 5 audit.)
  "CHAT_PROFILE_CAPTURED",
  // OI-23: shopper votes up/down on a combo card.
  "CHAT_COMBO_VOTED",
  // OI-24 / Combo dwell: combo card was visible for ≥3s in the chat scroll.
  "WIDGET_COMBO_VIEWED",
  // D40 — shopper tapped "Try this look" on a combo card; sequential
  // multi-garment render chain kicks off.
  "COMBO_TRYON_REQUESTED",
  // D40 — single-click add-all CTA on a combo card; AOV lever.
  "COMBO_ADD_ALL",
  // D40 — inline swap on a combo piece; scoreCombo recomputes for the
  // swapped slot and surfaces top-3 alternatives.
  "COMBO_PIECE_SWAPPED",
  // Widget telemetry — shopper engagement signals fed back into BrainContext.
  "PRODUCT_DWELL_LONG",
  "STYLE_VOTED",
  "PRODUCT_VIEWED",
  // Revenue attribution — order fulfilled where ≥1 item was Mira-recommended.
  "MIRA_ASSISTED_ORDER",
  // Request B — Mira checked live availability for a product. High-intent
  // signal: a spike of stock checks on one product = restock urgency.
  "CHAT_STOCK_CHECKED",
  // Request B — Mira surfaced the brand's real size chart. Signals shoppers
  // who need measurement reassurance before buying.
  "CHAT_SIZE_CHART_VIEWED",
  // Theme-audit score, posted ~3s after widget mount per page load. Powers the
  // dashboard's "Placement confidence" tile + the internal low-confidence
  // ops view that drives the Growth/Scale theme-optimization upsell.
  "WIDGET_PLACEMENT_AUDIT",
  // Brand admin used the AI "New product from image" flow (D43).
  "PRODUCT_CREATED_VIA_AI",
  // ─── Intelligence loop — measure→learn (Outcome tracking) ────────────────
  // Mira served the closest real match but it was one named attribute off —
  // sharper reorder hint than a hard gap (the brand already half-stocks it).
  "CHAT_NEAR_MISS",
  // Cart add after the shopper saw a VTO render (cart attribution). Present in
  // the Prisma EventName enum since the cart-attribution work; added here so
  // the analytics ingest contract validates it.
  "CART_FROM_MIRA",
  "CART_FROM_TRYON",
  "CART_FROM_WIDGET_STYLE",
  // Nightly resolver classified an Outcome (IMPROVED / NO_CHANGE / WORSENED).
  "OUTCOME_RESOLVED",
  // ─── Mira proactive sales-stylist loop ───────────────────────────────────
  // The full lifecycle of Mira-as-proactive-sales-stylist. Each event answers
  // a brand decision (§11): which proactive openers convert, where intent is
  // captured, which outfits get accepted vs rejected, where shoppers hesitate,
  // and what the catalog is missing. Centrally emitted by brain.server.ts via
  // the Brain post-run signal hook (no longer the caller's responsibility).
  "MIRA_OPENED",
  "MIRA_PROACTIVE_TRIGGERED",
  "MIRA_INTENT_CAPTURED",
  "MIRA_PRODUCT_EXPLAINED",
  "MIRA_PRODUCT_RECOMMENDED",
  "MIRA_OUTFIT_RECOMMENDED",
  "MIRA_OUTFIT_ACCEPTED",
  "MIRA_OUTFIT_REJECTED",
  "MIRA_SIZE_HELP_STARTED",
  "MIRA_SIZE_SAVED",
  "MIRA_TRYON_OFFERED",
  "MIRA_TRYON_STARTED",
  "MIRA_TRYON_COMPLETED",
  "MIRA_ADD_TO_CART_ASSIST",
  "MIRA_CART_COMPLETED",
  "MIRA_HESITATION_DETECTED",
  "MIRA_UNMET_DEMAND",
  "MIRA_NEAR_MISS",
  "MIRA_NAVIGATION_FAILED",
  // ─── Mira behavioral intelligence layer ──────────────────────────────────
  // The shopper-state inference + behavioral-trigger engine (widget-side).
  // STATE_DETECTED fires when a behavioral state is inferred; TRIGGER_FIRED /
  // _SUPPRESSED record every intervention decision so we can measure precision.
  "MIRA_SHOPPER_STATE_DETECTED",
  "MIRA_BEHAVIORAL_TRIGGER_FIRED",
  "MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED",
]);
export type EventName = z.infer<typeof EventNameSchema>;

export const EventPayloadSchemas = {
  WIDGET_VIEWED: z.object({}),
  TRYON_STARTED: z.object({ mode: TryOnModeSchema }),
  TRYON_COMPLETED: z.object({ mode: TryOnModeSchema, latencyMs: z.number() }),
  TRYON_PHOTO_UPLOADED: z.object({ assetId: z.string() }),
  FIT_RECOMMENDED: z.object({ size: z.string(), confidence: z.number() }),
  SIZE_SELECTED: z.object({
    chosenSize: z.string(),
    recommendedSize: z.string().optional(),
    sizeDelta: z.number().int(),
  }),
  STYLE_VIEWED: z.object({ anchorProductId: z.string() }),
  STYLE_PRODUCT_CLICKED: z.object({ productId: z.string(), role: z.string() }),
  COLOR_COMBO_VIEWED: z.object({ comboName: z.string() }),
  PRODUCT_AUDIT_GENERATED: z.object({ productId: z.string(), priorityScore: z.number() }),
  ADD_TO_CART: z.object({ variantId: z.string(), quantity: z.number().int() }),
  CHECKOUT_STARTED: z.object({ cartTokenHash: z.string() }),
  PURCHASE: z.object({ orderIdHash: z.string(), totalCents: z.number().int() }),

  // Demo-only payloads.
  DEMO_PRODUCT_VIEWED: z.object({ productHandle: z.string() }),
  DEMO_TRYON_BODY_SELECTED: z.object({ bodyType: z.string() }),
  DEMO_TRYON_PHOTO_REQUESTED: z.object({}),
  DEMO_FIT_SUBMITTED: z.object({
    heightCm: z.number().int(),
    weightKg: z.number().int(),
    fitPreference: z.string(),
    bodyType: z.string().optional(),
    recommendedSize: z.string(),
    confidence: z.number(),
  }),
  DEMO_STYLE_RECOMMENDATION_VIEWED: z.object({ anchorProductId: z.string(), itemCount: z.number().int() }),
  DEMO_COLOR_COMBO_VIEWED: z.object({ comboName: z.string() }),
  DEMO_AUDIT_VIEWED: z.object({ productId: z.string(), recommendationCount: z.number().int() }),

  // Widget
  WIDGET_OPENED: z.object({ productHandle: z.string(), placement: z.string().optional() }),
  WIDGET_CLOSED: z.object({ dwellMs: z.number().int().optional() }),
  WIDGET_CTA_CLICKED: z.object({ placement: z.string() }),
  WIDGET_BODY_MODEL_SELECTED: z.object({ bodyType: z.string() }),
  WIDGET_FIT_SUBMITTED: z.object({
    heightCm: z.number().int(),
    weightKg: z.number().int(),
    fitPreference: z.string(),
    bodyType: z.string().optional(),
    chestCm: z.number().optional(),
    waistCm: z.number().optional(),
    hipCm: z.number().optional(),
    recommendedSize: z.string(),
    confidence: z.number(),
  }),
  WIDGET_STYLE_VIEWED: z.object({ anchorProductId: z.string(), itemCount: z.number().int() }),

  // ─── Stylist + chat (Layer 2) ─────────────────────────────────────────
  CHAT_OPENED: z.object({ surface: z.string().optional() }),
  CHAT_CLOSED: z.object({ dwellMs: z.number().int().optional(), turns: z.number().int().optional() }),
  CHAT_MESSAGE_SENT: z.object({ length: z.number().int(), tokenCount: z.number().int().optional() }),
  CHAT_REPLY_RECEIVED: z.object({ latencyMs: z.number().int(), combos: z.number().int(), actions: z.number().int() }),
  CHAT_PRODUCT_CLICKED: z.object({ productHandle: z.string(), comboName: z.string().optional() }),
  CHAT_COMBO_PROPOSED: z.object({ comboName: z.string(), productIds: z.array(z.string()), reasoning: z.string().optional() }),
  CHAT_SEARCH_RUN: z.object({
    query: z.string(),
    resultCount: z.number().int(),
    category: z.string().optional(),
    colorFamily: z.string().optional(),
    gap: z.boolean().optional(),         // true when resultCount < 2
  }),
  CHAT_IMAGE_MATCH_RUN: z.object({
    caption: z.string().optional(),
    resultCount: z.number().int(),
    topScore: z.number().optional(),
    reason: z.string().optional(),       // "no_reference_image" | "no_garment" etc
  }),
  CHAT_NAV_REQUESTED: z.object({ productHandle: z.string() }),
  CHAT_CART_REQUESTED: z.object({ productId: z.string(), suggestedSize: z.string().optional() }),
  CART_CONFIRMED: z.object({ productId: z.string(), size: z.string().optional(), qty: z.number().int() }),
  CART_CANCELLED: z.object({ productId: z.string() }),
  CART_FAILED: z.object({ productId: z.string(), reason: z.string().optional() }),
  SIGNUP_OFFERED: z.object({ reason: z.string().optional() }),
  SIGNUP_CARD_SHOWN: z.object({}),
  SIGNUP_CLAIMED: z.object({ marketingOptIn: z.boolean() }),
  SIGNUP_DISMISSED: z.object({}),
  ACCOUNT_CLAIMED: z.object({ source: z.string() }),

  WIDGET_STEP_VIEWED: z.object({ step: z.number().int() }),
  WIDGET_MOOD_SELECTED: z.object({ moodId: z.string() }),
  WIDGET_MODEL_SELECTED: z.object({ modelId: z.string() }),
  WIDGET_EXPERIENCE_SELECTED: z.object({ experience: z.string() }),
  // VTO render lifecycle. providerKey + modelKey identify the engine; latencyMs
  // is wall-clock provider-call time. errorReason on FAILED is a stable code,
  // never a raw provider string (security invariant #6).
  PDP_TRYON_CLICKED: z.object({
    productId: z.string().optional(),
    productHandle: z.string().optional(),
    size: z.string().optional(),
    trigger: z.enum(["pdp_button", "mira_suggest", "look_card", "reco_card"]).optional(),
  }),
  TRYON_RENDER_REQUESTED: z.object({
    productId: z.string().optional(),
    productHandle: z.string().optional(),
    mode: z.enum(["BODY_MODEL", "PERSONAL_PHOTO"]),
    modelHint: z.string().optional(),
    providerKey: z.string().optional(),
    size: z.string().optional(),
    trigger: z.enum(["pdp_button", "mira_suggest", "look_card", "reco_card"]).optional(),
  }),
  TRYON_RENDER_COMPLETED: z.object({
    productId: z.string().optional(),
    productHandle: z.string().optional(),
    mode: z.enum(["BODY_MODEL", "PERSONAL_PHOTO"]),
    providerKey: z.string().optional(),
    modelKey: z.string().optional(),
    latencyMs: z.number().int().optional(),
    size: z.string().optional(),
    cached: z.boolean().optional(),
    trigger: z.enum(["pdp_button", "mira_suggest", "look_card", "reco_card"]).optional(),
  }),
  TRYON_RENDER_FAILED: z.object({
    productId: z.string().optional(),
    productHandle: z.string().optional(),
    mode: z.enum(["BODY_MODEL", "PERSONAL_PHOTO"]).optional(),
    providerKey: z.string().optional(),
    errorReason: z.string().optional(),       // stable code, not raw provider text
    latencyMs: z.number().int().optional(),
    size: z.string().optional(),
    trigger: z.enum(["pdp_button", "mira_suggest", "look_card", "reco_card"]).optional(),
  }),
  TRYON_ABANDONED: z.object({
    productId: z.string().optional(),
    productHandle: z.string().optional(),
    size: z.string().optional(),
    trigger: z.enum(["pdp_button", "mira_suggest", "look_card", "reco_card"]).optional(),
    aftermathType: z.enum(["abandoned_ask", "liked_close", "failed_explain"]).optional(),
  }),
  CHAT_PROFILE_CAPTURED: z.object({
    captured: z.array(z.string()),               // ["body type", "height", ...]
    heightCm: z.number().int().optional(),
    weightKg: z.number().int().optional(),
    bodyType: z.string().optional(),
    fitPreference: z.string().optional(),
    budgetMin: z.number().optional(),
    budgetMax: z.number().optional(),
    budgetCurrency: z.string().optional(),
  }),
  // OI-23: combo vote micro-action.
  CHAT_COMBO_VOTED: z.object({
    comboName: z.string(),
    vote: z.enum(["up", "down"]),
  }),
  // Combo dwell signal: card was visible ≥3s.
  WIDGET_COMBO_VIEWED: z.object({
    comboName: z.string(),
  }),
  // D40 — shopper kicked off a multi-garment combo try-on.
  // productIds preserves the layer-ordered chain so we can join to the
  // comboCacheKey hash for cache-hit analytics.
  COMBO_TRYON_REQUESTED: z.object({
    comboName: z.string(),
    productIds: z.array(z.string()),
    museId: z.string().optional(),
    comboCacheKey: z.string().optional(),  // present when chain was hashed
  }),
  // D40 — add-all CTA fired. AOV lever — the single highest-value
  // event in the combo funnel.
  COMBO_ADD_ALL: z.object({
    comboName: z.string(),
    productIds: z.array(z.string()),
    sizeHints: z.array(z.string()).optional(),  // per-piece recommended size
    totalPriceCents: z.number().int().optional(),
  }),
  // D40 — inline piece swap on a combo card. Tracks which slot was
  // swapped + the new candidate so we can learn which alternatives win.
  COMBO_PIECE_SWAPPED: z.object({
    comboName: z.string(),
    swappedSlot: z.string(),                // "top" | "bottom" | "accessory"
    fromProductId: z.string(),
    toProductId: z.string(),
    newScore: z.number().optional(),        // 0..1 — recomputed from scoreCombo
  }),
  // Widget telemetry — shopper engagement signals fed back into BrainContext.
  PRODUCT_DWELL_LONG: z.object({
    productId: z.string(),
    dwellMs: z.number().int(),              // actual dwell time in ms (>=10 000)
    category: z.string().optional(),
  }),
  STYLE_VOTED: z.object({
    productId: z.string(),
    vote: z.enum(["up", "down"]),
    category: z.string().optional(),
  }),
  PRODUCT_VIEWED: z.object({
    productId: z.string(),
    productHandle: z.string().optional(),
    category: z.string().optional(),
  }),
  // Revenue attribution — fires once per fulfilled order where Mira assisted.
  MIRA_ASSISTED_ORDER: z.object({
    orderId: z.string(),
    assistedProductIds: z.array(z.string()),
    assistedRevenueCents: z.number().int(),
    totalLineItems: z.number().int(),
  }).optional(),
  // Request B — live availability check via check_stock tool.
  CHAT_STOCK_CHECKED: z.object({
    productId: z.string(),
    size: z.string().optional(),               // present when a single size was checked
    inStockSizes: z.number().int(),            // count of buyable sizes
    outOfStockSizes: z.number().int(),
    inventoryKnown: z.boolean(),               // false when no inventory mirror yet
  }),
  // Request B — size-chart surfaced via get_size_chart tool.
  CHAT_SIZE_CHART_VIEWED: z.object({
    productId: z.string(),
    hasChart: z.boolean(),
    source: z.string().optional(),             // where the chart came from (audit)
    sizeCount: z.number().int().optional(),
  }),
  // Theme-audit score fired once per page load from the widget. Score 0-100;
  // checks[] carries per-rule pass/fail for the ops drill-in. themeHint is
  // read from `<meta theme-name>` or `Shopify.theme.name` when available.
  WIDGET_PLACEMENT_AUDIT: z.object({
    score: z.number().int().min(0).max(100),
    themeHint: z.string().max(120).nullable(),
    url: z.string().max(2000).optional(),
    isPdp: z.boolean().optional(),
    checks: z.array(z.object({
      id: z.string().max(60),
      passed: z.boolean(),
    })).max(20),
  }),

  // Fired when a brand admin creates a product via the AI image-upload flow (D43).
  PRODUCT_CREATED_VIA_AI: z.object({
    shopifyProductId: z.string(),
    shopifyHandle: z.string().optional(),
    category: z.string().optional(),
    confidenceScore: z.number().optional(),
    creativeSetId: z.string().optional(),
  }),
  // ─── Intelligence loop — measure→learn (Outcome tracking) ────────────────
  CHAT_NEAR_MISS: z.object({
    query: z.string().optional(),
    nearMissProductId: z.string().optional(),
    nearMissAttribute: z.string().optional(),
    category: z.string().optional(),
    resultCount: z.number().optional(),
  }),
  CART_FROM_TRYON: z.object({
    productId: z.string().optional(),
    renderId: z.string().optional(),
    comboName: z.string().optional(),
  }),
  CART_FROM_WIDGET_STYLE: z.object({
    productIds: z.array(z.string()).optional(),
    comboName: z.string().optional(),
  }),
  CART_FROM_MIRA: z.object({
    productId: z.string().optional(),
    productIds: z.array(z.string()).optional(),
    comboName: z.string().optional(),
    source: z.string().optional(),
    size: z.string().optional(),
    itemCount: z.number().int().optional(),
  }),
  OUTCOME_RESOLVED: z.object({
    outcomeId: z.string().optional(),
    recommendationType: z.string().optional(),
    resultClass: z.string().optional(),
    confidenceScore: z.number().optional(),
    delta: z.record(z.number()).optional(),
  }),
  // ─── Mira proactive sales-stylist loop ───────────────────────────────────
  // All fields optional so the centralized Brain signal hook can emit a
  // best-effort payload from whatever a tool result carried, without ever
  // failing zod validation and silently dropping the signal (the gap the
  // post-run hook in brain.ts was built to close).
  MIRA_OPENED: z.object({
    surface: z.enum(["pdp", "collection", "homepage", "cart", "unknown"]).optional(),
    productId: z.string().optional(),
    proactive: z.boolean().optional(),
  }),
  MIRA_PROACTIVE_TRIGGERED: z.object({
    triggerId: z.string().optional(),
    reason: z.string().optional(),
    productId: z.string().optional(),
    intentState: z.string().optional(),
    confidence: z.number().optional(),
  }),
  MIRA_INTENT_CAPTURED: z.object({
    occasion: z.string().optional(),
    styleDirection: z.string().optional(),
    budgetMax: z.number().optional(),
    fitPreference: z.string().optional(),
  }),
  MIRA_PRODUCT_EXPLAINED: z.object({
    productId: z.string().optional(),
    attributes: z.array(z.string()).optional(),
  }),
  MIRA_PRODUCT_RECOMMENDED: z.object({
    productId: z.string().optional(),
    reason: z.string().optional(),
  }),
  MIRA_OUTFIT_RECOMMENDED: z.object({
    focalProductId: z.string().optional(),
    productIds: z.array(z.string()).optional(),
    comboName: z.string().optional(),
    shopperIntent: z.string().optional(),
    harmonyType: z.string().optional(),
  }),
  MIRA_OUTFIT_ACCEPTED: z.object({
    comboName: z.string().optional(),
    productIds: z.array(z.string()).optional(),
  }),
  MIRA_OUTFIT_REJECTED: z.object({
    comboName: z.string().optional(),
    productIds: z.array(z.string()).optional(),
    reason: z.string().optional(),
  }),
  MIRA_SIZE_HELP_STARTED: z.object({
    productId: z.string().optional(),
    triggeredBy: z.string().optional(),
  }),
  MIRA_SIZE_SAVED: z.object({
    productId: z.string().optional(),
    size: z.string().optional(),
    confidence: z.number().optional(),
  }),
  MIRA_TRYON_OFFERED: z.object({
    productId: z.string().optional(),
    productIds: z.array(z.string()).optional(),
    reason: z.enum(["uncertain", "comparing", "dwell", "requested"]).optional(),
    mode: z.enum(["model", "photo"]).optional(),
  }),
  MIRA_TRYON_STARTED: z.object({
    productId: z.string().optional(),
    mode: z.enum(["model", "photo"]).optional(),
  }),
  MIRA_TRYON_COMPLETED: z.object({
    productId: z.string().optional(),
    mode: z.enum(["model", "photo"]).optional(),
    latencyMs: z.number().optional(),
  }),
  MIRA_ADD_TO_CART_ASSIST: z.object({
    productIds: z.array(z.string()).optional(),
    action: z.enum(["add_item", "add_outfit", "decide_later"]).optional(),
  }),
  MIRA_CART_COMPLETED: z.object({
    productIds: z.array(z.string()).optional(),
    comboName: z.string().optional(),
  }),
  MIRA_HESITATION_DETECTED: z.object({
    productId: z.string().optional(),
    hesitationType: z
      .enum(["size_uncertain", "style_unsure", "price_concern", "comparing", "unknown"])
      .optional(),
    context: z.string().optional(),
  }),
  MIRA_UNMET_DEMAND: z.object({
    query: z.string().optional(),
    canonicalCategory: z.string().optional(),
    resultCount: z.number().optional(),
  }),
  MIRA_NEAR_MISS: z.object({
    query: z.string().optional(),
    nearMissProductId: z.string().optional(),
    nearMissAttribute: z.enum(["color", "size", "fabric", "cut", "price"]).optional(),
    canonicalCategory: z.string().optional(),
  }),
  MIRA_NAVIGATION_FAILED: z.object({
    handle: z.string().optional(),
    reason: z.string().optional(),
  }),

  // ─── Mira behavioral intelligence layer ──────────────────────────────────
  MIRA_SHOPPER_STATE_DETECTED: z.object({
    shopperState: z.string().optional(),
    confidence: z.number().optional(),
    reasons: z.array(z.string()).optional(),
    suggestedMiraMode: z.string().optional(),
    productId: z.string().optional(),
    cartItemCount: z.number().int().optional(),
    pageType: z.string().optional(),
  }),
  MIRA_BEHAVIORAL_TRIGGER_FIRED: z.object({
    shopperState: z.string().optional(),
    confidence: z.number().optional(),
    reasons: z.array(z.string()).optional(),
    triggerType: z.string().optional(),
    suggestedMiraMode: z.string().optional(),
    productId: z.string().optional(),
    cartItemCount: z.number().int().optional(),
    pageType: z.string().optional(),
    urgency: z.number().optional(),
  }),
  MIRA_BEHAVIORAL_TRIGGER_SUPPRESSED: z.object({
    shopperState: z.string().optional(),
    confidence: z.number().optional(),
    reasons: z.array(z.string()).optional(),
    suggestedMiraMode: z.string().optional(),
    suppressionReason: z.string().optional(),
    productId: z.string().optional(),
    cartItemCount: z.number().int().optional(),
    pageType: z.string().optional(),
    urgency: z.number().optional(),
  }),
} as const;

export function safeParseEventPayload(name: EventName, payload: unknown) {
  const schema: z.ZodTypeAny = EventPayloadSchemas[name];
  if (schema instanceof z.ZodObject) {
    return schema.strict().safeParse(payload);
  }
  if (schema instanceof z.ZodOptional) {
    const inner = schema.unwrap();
    if (inner instanceof z.ZodObject) {
      return inner.strict().optional().safeParse(payload);
    }
  }
  return schema.safeParse(payload);
}

export type EventPayload<T extends EventName> = z.infer<(typeof EventPayloadSchemas)[T]>;
