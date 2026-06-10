// Tool definitions — schema only. Handlers live in apps/shopify-app/lib/brain-tools.server.ts
// (because they need Prisma + shop-side services).
//
// Why split? The schema is pure data and ships in @stylique/ai so the
// registry can be assembled in any context (server, dashboard preview, tests).
// The handlers depend on the Remix app's runtime — they get attached when the
// app boots the Brain (see apps/shopify-app/app/lib/brain.server.ts).
//
// This file declares WHAT each tool is. brain-tools.server.ts declares HOW
// each runs.

import type { ToolDef } from "./types.js";

// ─── Implemented today ───────────────────────────────────────────────────

export const searchCatalogToolSchema: ToolDef = {
  name: "search_catalog",
  description:
    "Search the brand's product catalog. Use intent-based queries like 'linen shirt for summer' or 'something for a wedding'. Returns up to `limit` products. IMPORTANT: When the shopper is on a product page, always search for COMPLEMENTARY categories (e.g., if on a shirt, search for trousers/jeans/shoes — NOT more shirts). Use the `category` filter to constrain to a specific complementary type. Always pass maxPriceUsd when the shopper has mentioned a budget — never show products above their stated ceiling.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural-language search query." },
      category: { type: "string", description: "Optional category filter. Use this to constrain results to a specific clothing type. When building an outfit combo, use one search per complementary category (e.g., separate calls for 'trouser' and 'shoes')." },
      colorFamily: { type: "string", description: "Optional color family filter (neutral, warm, cool)." },
      maxPriceUsd: { type: "number", description: "Maximum price in USD (or the brand's price unit). Set this to the shopper's stated budget ceiling. Products above this are excluded. Leave unset when no budget has been mentioned." },
      minPriceUsd: { type: "number", description: "Minimum price in USD. Optional — use only when shopper explicitly wants a higher-end range." },
      limit: { type: "integer", description: "Max results. Default 8, hard cap 20." },
    },
    required: ["query"],
  },
};

export const proposeComboToolSchema: ToolDef = {
  name: "propose_combo",
  description:
    "Present a curated outfit combo (2-4 items) to the shopper. Cards render automatically — your text reply should NOT restate the items. Combos should consist of COMPLEMENTARY items that together form a complete look — anchor piece + bottom/top + shoes + outerwear or accessory. Never combine two items of the same category.",
  schema: {
    type: "object",
    properties: {
      productIds: {
        type: "array", items: { type: "string" },
        description: "2-4 product ids from prior search_catalog results.",
      },
      name:      { type: "string", description: "Short evocative name." },
      reasoning: { type: "string", description: "One sentence on why this works." },
    },
    required: ["productIds", "name", "reasoning"],
  },
};

export const navigateToolSchema: ToolDef = {
  name: "navigate",
  description:
    "Navigate the shopper's browser to a product page. Use when the shopper asks 'show me' or 'open' a specific item — NOT when proposing a combo (cards already link).",
  schema: {
    type: "object",
    properties: {
      handle: { type: "string", description: "Shopify product handle from prior search results." },
    },
    required: ["handle"],
  },
  requiresFeature: "stylist.navigateActions",
};

export const addToCartToolSchema: ToolDef = {
  name: "add_to_cart_request",
  description:
    "Request that an item be added to the shopper's cart. Use when they say 'add it', 'I'll take it', 'put it in my bag'. A confirm card with size selector renders.",
  schema: {
    type: "object",
    properties: {
      productId:     { type: "string", description: "Product id from a prior search." },
      suggestedSize: { type: "string", description: "Optional size hint." },
    },
    required: ["productId"],
  },
  requiresFeature: "stylist.cartActions",
};

export const addOutfitToCartToolSchema: Omit<ToolDef, "handler"> = {
  name: "add_outfit_to_cart",
  description:
    "Add a complete outfit (multiple items) to the shopper's cart in one action. Use when the shopper says 'yes to the whole look', 'add them all', or after a combo try-on. Passes each product with the Mira-recommended size.",
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "Each item to add. At least 2 items — use add_to_cart_request for single items.",
        items: { type: "object" },
      },
      comboName: { type: "string", description: "The name of the combo/outfit being added, for analytics." },
    },
    required: ["items"],
  },
  requiresFeature: "stylist.cartActions",
  metric: "STYLE_RECOMMENDATION",
};

export const offerSignupToolSchema: ToolDef = {
  name: "offer_account_signup",
  description:
    "Surface a small inline card asking the shopper if they want to save their taste profile. Use AT MOST ONCE per conversation, after a productive exchange. Server gates this — no-op if already offered/claimed.",
  schema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "One short sentence on why now is a good moment." },
    },
    required: ["reason"],
  },
  requiresFeature: "stylist.signupOffer",
};

// ─── Phase 2 — try-on integration. Stubbed until widget cross-call lands. ─

export const seeOnModelToolSchema: ToolDef = {
  name: "see_on_model",
  description:
    "Open the Try-On widget pre-loaded with a combo, on a body model the shopper chooses. Use after the shopper says 'show me how it looks' or 'on a model'. Returns nothing — the widget takes over.",
  schema: {
    type: "object",
    properties: {
      productIds: {
        type: "array", items: { type: "string" },
        description: "1-4 product ids to render. Usually the most recent combo.",
      },
      modelHint: { type: "string", description: "Optional body model hint (ava, lina, noor, maya, zara, elena)." },
    },
    required: ["productIds"],
  },
  requiresFeature: "widget.enabled",
};

export const seeOnMeToolSchema: ToolDef = {
  name: "see_on_me",
  description:
    "Open the Try-On widget for personal photo upload — renders the combo on the shopper's own photo via VTO. Only call when the shopper has explicitly opted into uploading.",
  schema: {
    type: "object",
    properties: {
      productIds: {
        type: "array", items: { type: "string" },
        description: "1-4 product ids to render.",
      },
    },
    required: ["productIds"],
  },
  requiresFeature: "widget.personalPhotoTryOn",
  metric: "TRYON_PERSONAL",
};

// (Creative Studio / creative-generation tool removed — Stylique is a sales +
// intelligence layer, not a content generator.)

// ─── Skills layer (Sprint 3) — domain reasoning tools ─────────────────
// These are LIGHTWEIGHT — they don't fetch from the catalog. They return
// structured guidance the model uses to reason confidently. Think of them
// as the stylist's training data, callable.

export const applyColorRuleToolSchema: ToolDef = {
  name: "apply_color_rule",
  description:
    "Get colour-theory-grounded guidance for pairing an anchor item with the rest of a look. Returns complementary, analogous, and neutral-anchor suggestions plus what to avoid.",
  schema: {
    type: "object",
    properties: {
      anchorColorFamily: { type: "string", description: "warm / cool / neutral / brown / black / white." },
      anchorIntensity:   { type: "string", enum: ["saturated", "muted", "dark", "pastel"], description: "How strongly the anchor color dominates the palette. Handler uses this to adjust contrast bias and lean instruction." },
      occasion:          { type: "string", description: "Optional occasion hint." },
    },
    required: ["anchorColorFamily"],
  },
  requiresFeature: "stylist.enabled",
};

export const suggestOccasionDressingToolSchema: ToolDef = {
  name: "suggest_occasion_dressing",
  description:
    "Return dress-code-aware silhouette + formality guidance for an occasion (wedding guest, brunch, work, gala, casual evening). Use this BEFORE search_catalog to constrain the search.",
  schema: {
    type: "object",
    properties: {
      occasion:    { type: "string", description: "Free-text occasion description from the shopper." },
      timeOfDay:   { type: "string", description: "morning / afternoon / evening / night" },
      weatherHint: { type: "string", description: "Optional weather/season hint." },
    },
    required: ["occasion"],
  },
  requiresFeature: "stylist.enabled",
};

export const compareTwoItemsToolSchema: ToolDef = {
  name: "compare_two_items",
  description:
    "When the shopper is torn between two products, return a confident pick + reason. Use this instead of asking them to choose. Returns the winning productId.",
  schema: {
    type: "object",
    properties: {
      productIdA:     { type: "string", description: "First option's id." },
      productIdB:     { type: "string", description: "Second option's id." },
      occasion:       { type: "string", description: "Occasion / use case the shopper mentioned." },
      shopperBodyType:{ type: "string", description: "Optional body type hint." },
    },
    required: ["productIdA", "productIdB"],
  },
  requiresFeature: "stylist.enabled",
};

// Fix 12 — removed in D40 cleanup: whyItWorks is now embedded in propose_combo
// reasoning via handleProposeCombo's color-harmony + score enrichment. Keeping
// the schema as a documented stub prevents the model from calling it and
// silently failing. If the model lists it, the registry filter drops it.
/** @deprecated Fix 12 — whyItWorks now embedded in propose_combo reasoning.
 *  Schema is retained as a documentation stub but no longer registered. */
export const explainWhyComboWorksToolSchema: ToolDef = {
  name: "explain_why_combo_works",
  description:
    "DEPRECATED — Mira now embeds 'why this works' inside propose_combo reasoning. Do not call.",
  schema: { type: "object", properties: {} },
};

export const recallPastPreferenceToolSchema: ToolDef = {
  name: "recall_past_preference",
  description:
    "Read the shopper's past acceptances + rejections from previous sessions. Use this when starting a new recommendation to avoid re-pitching what they declined. Returns short bullet lists.",
  schema: {
    type: "object",
    properties: {
      lookbackDays: { type: "integer", description: "How far back to look. Default 60." },
    },
  },
  requiresFeature: "stylist.tasteVector",        // Growth+
};

// ─── Cross-surface bridge — Mira ↔ Widget Fit step ───────────────────────
// Mira can collect body type / measurements / fit preference during chat,
// store them on ShopperSession, and the Widget's Fit step then pre-fills
// (or skips entirely). The reverse is already wired — the Widget signals
// these via /api/shopper/signal when the shopper picks them there.
//
// Use this tool ONLY when the shopper has volunteered or you've genuinely
// asked one specific question (never run a 4-field intake form). It's a
// friend tool: a friend asks "what size are you in [brand]?" once, casually.
//
// Behaviour rules baked into the description so the model treats it right.
// ─── Guided-extraction helper ──────────────────────────────────────────
// Shoppers don't say "FITTED" — they say "not too tight," "second skin,"
// "breezy," "structured." This tool maps their words to the structured
// values capture_shopper_profile expects. Call it BEFORE capture, with the
// shopper's actual phrase. Returns a confidence-rated mapping.
export const interpretFitLanguageToolSchema: ToolDef = {
  name: "interpret_fit_language",
  description:
    "Map the shopper's free-text description of fit/style preference (e.g. 'not too tight', 'breezy', 'I don't like clingy', 'structured') to a structured fit preference (FITTED / REGULAR / RELAXED / OVERSIZED). Use this BEFORE calling capture_shopper_profile to make sure you're saving the right value. Returns the mapping + confidence.",
  schema: {
    type: "object",
    properties: {
      phrase: {
        type: "string",
        description: "The shopper's exact words describing how they want it to fit/feel.",
      },
    },
    required: ["phrase"],
  },
  requiresFeature: "stylist.enabled",
};

export const captureShopperProfileToolSchema: ToolDef = {
  name: "capture_shopper_profile",
  description:
    "Save the shopper's body type, height, weight, fit preference, or budget to their session so the Widget pre-fills and all future searches stay within budget. Use this ONLY when the shopper actually tells you one of these — never proactively interview. Save whatever you have, leave the rest blank. One field at a time is fine. Budget is especially important: the moment they mention a number ('under $200', 'around £150', '$500 budget'), call this immediately so every subsequent search_catalog call respects it.",
  schema: {
    type: "object",
    properties: {
      bodyType: {
        type: "string",
        description: "PETITE / SLIM / REGULAR / CURVY / PLUS / TALL — match the shopper's words to the closest one.",
      },
      heightCm: { type: "integer", description: "80-230. Convert from imperial if needed (5'8\" = 173)." },
      weightKg: { type: "integer", description: "25-250. Convert from pounds if needed (150lb = 68)." },
      fitPreference: {
        type: "string",
        description: "FITTED / REGULAR / RELAXED / OVERSIZED / SLIM — the shopper's stated fit preference.",
      },
      budgetMin: { type: "number", description: "Lower end of their stated budget range, in their currency. e.g. if they say 'between $100 and $300' set budgetMin=100. Leave blank if they only said a max." },
      budgetMax: { type: "number", description: "Upper end of their stated budget, in their currency. e.g. 'under $200' → budgetMax=200. This is the primary budget constraint." },
      budgetCurrency: { type: "string", description: "3-letter ISO code if they used a non-USD currency (GBP, EUR, AED, etc). Default USD." },
    },
  },
  requiresFeature: "stylist.enabled",
};

// ─── match_reference_photo ─────────────────────────────────────────────
// When the shopper has shared a reference photo earlier in the turn (Gemini
// Vision already saw it), call this to find catalog products that visually
// resemble what was in the photo. The handler bridges Vision → text-embed →
// cosine-rank against ProductEmbedding rows. Returns the same shape as
// search_catalog so the model can compose results identically.
export const matchReferencePhotoToolSchema: ToolDef = {
  name: "match_reference_photo",
  description:
    "Find catalog products that visually resemble a reference photo the shopper just shared. Use ONLY when the shopper uploaded an image this turn and is asking 'find me something like this' (or similar). Returns up to `limit` matches ranked by visual similarity.",
  schema: {
    type: "object",
    properties: {
      hint: {
        type: "string",
        description: "Optional one-line hint about what to focus on, e.g. 'the dress, not the bag'.",
      },
      limit: { type: "integer", description: "Max results. Default 8, hard cap 20." },
    },
  },
  requiresFeature: "stylist.enabled",
};

// ─── Guided shopping tools (Rufus-pattern page-aware navigation) ─────────
// These tools implement the "show, don't tell" shopping guide protocol.
// Mira navigates the shopper to products, calls out specific details, confirms
// size before try-on, and leads a complete combo walkthrough — all using the
// page-context awareness added to BrainContext.currentProductHandle.

export const leadBrowseToolSchema: ToolDef = {
  name: "lead_browse",
  description:
    "Navigate the shopper to a specific product and speak about it as you arrive. Use when you want to SHOW a product rather than just describe it. Fires a navigation event on the storefront AND generates a spoken-arrival message. More powerful than navigate — you guide, not just redirect.",
  schema: {
    type: "object",
    properties: {
      handle:       { type: "string", description: "Shopify product handle." },
      productId:    { type: "string", description: "Product id from a prior search result." },
      title:        { type: "string", description: "Product title for the arrival message." },
      arrivalFocus: { type: "string", description: "The specific detail to call out when arriving, e.g. 'the drape of the linen', 'how the waist sits', 'the length'." },
      imageUrl:     { type: "string", description: "Optional image URL for the preview card." },
    },
    required: ["handle", "title"],
  },
  requiresFeature: "stylist.navigateActions",
};

export const guideComboWalkthroughToolSchema: ToolDef = {
  name: "guide_combo_walkthrough",
  description:
    "Initiate a step-by-step walkthrough of a combo. Navigates the shopper to each product in sequence, with Mira explaining why each piece works for them specifically. Use when the shopper agrees to explore a recommended look. Pass `steps` as a JSON string array where each element is a JSON object with keys: handle (string), productId (string, optional), title (string), role (string — e.g. 'the anchor piece'), whyItWorksForYou (string — specific to this shopper), imageUrl (string, optional).",
  schema: {
    type: "object",
    properties: {
      comboName: { type: "string", description: "Short evocative name for this combo." },
      steps: {
        type: "array",
        description: "Ordered list of step objects (top → bottom → accessory). Each object must have: handle, title, role, whyItWorksForYou. Optional: productId, imageUrl.",
        items: { type: "string" },
      },
    },
    required: ["comboName", "steps"],
  },
  requiresFeature: "stylist.navigateActions",
};

export const highlightProductDetailToolSchema: ToolDef = {
  name: "highlight_product_detail",
  description:
    "Draw the shopper's attention to a specific visual detail on the product currently on screen. Use after navigating to a PDP to call out something specific: fabric texture, silhouette line, colour in context. Works only when the shopper is on a product page (ctx.currentProductHandle is set).",
  schema: {
    type: "object",
    properties: {
      detail: {
        type: "string",
        description: "What to highlight and why, e.g. 'the hem length — lands at mid-calf which works well for your height'.",
      },
      imageZone: {
        type: "string",
        enum: ["full", "top", "bottom", "left", "right", "center"],
        description: "Which zone of the product image to draw attention to.",
      },
    },
    required: ["detail"],
  },
  requiresFeature: "stylist.enabled",
};

export const showSizeRecommendationToolSchema: ToolDef = {
  name: "show_size_recommendation",
  description:
    "Show the shopper a size recommendation card for the current or a specific product. Call this BEFORE suggesting they try on — size confidence should come before the visual. If the shopper has no body data yet, this triggers the fit collection flow instead.",
  schema: {
    type: "object",
    properties: {
      productId:    { type: "string", description: "Product id. Defaults to the current page product when omitted." },
      productTitle: { type: "string", description: "Product title for the card header." },
      triggeredBy:  { type: "string", description: "Why now: 'before_tryon' | 'at_add_to_cart' | 'size_question'." },
    },
    required: ["productTitle"],
  },
  requiresFeature: "stylist.enabled",
};

// ─── check_stock — real-time availability (Request B) ───────────────────
// Mira already SEES per-size stock for the current product in context. Call
// this when she needs a fresh/explicit answer for ANY product — "is the M
// still there?", before an add-to-cart confirmation, or to find which sizes
// are left. The handler reads the inventory mirror (refreshed at sync) and
// can do a live Shopify refresh for a hard pre-purchase confirmation. Returns
// per-size quantities + rollups. NEVER block a sale on unknown (null) stock.
export const checkStockToolSchema: ToolDef = {
  name: "check_stock",
  description:
    "Check live availability for a product — which sizes are in stock, low, or sold out, and how many units remain per size. Call this when the shopper asks 'is it still available?', 'do you have my size?', before confirming an add-to-cart, or whenever you want to steer toward what's actually buyable. Defaults to the product the shopper is currently viewing when productId is omitted. Use the result to recommend honestly (never push a sold-out size) and to create truthful urgency ('only 2 left in M').",
  schema: {
    type: "object",
    properties: {
      productId: { type: "string", description: "Product id. Defaults to the current page product when omitted." },
      size:      { type: "string", description: "Optional — check one specific size only (e.g. 'M'). Omit to get all sizes." },
    },
  },
  requiresFeature: "stylist.enabled",
};

// ─── get_size_chart — the brand's actual measurements (Request B / D37/D39) ─
// Returns the extracted, normalised size chart for a product regardless of
// the source format (JSON/HTML metafield, description table, linked size-guide
// page, or OCR of a size-chart image). Use this when the shopper asks about
// measurements ("what's the chest on the L?", "is this true to size?") so Mira
// answers from the brand's real numbers instead of guessing. For a personalised
// "you're an M" recommendation, prefer show_size_recommendation.
export const getSizeChartToolSchema: ToolDef = {
  name: "get_size_chart",
  description:
    "Fetch the brand's actual size chart (real garment measurements) for a product. Call this when the shopper asks about specific measurements, 'is it true to size?', 'what are the dimensions of the L?', or when comparing two sizes by the numbers. Defaults to the current page product. Returns sizes with chest/waist/hip/length in the chart's unit, or tells you no chart exists (then lean on show_size_recommendation + category defaults). Quote the real numbers — it builds trust.",
  schema: {
    type: "object",
    properties: {
      productId: { type: "string", description: "Product id. Defaults to the current page product when omitted." },
    },
  },
  requiresFeature: "stylist.enabled",
};

// ─── Proactive sales-stylist tools (Mira upgrade) ───────────────────────
// These six tools encode the proactive sales-stylist behavior into callable
// capabilities the model uses to (a) ground product talk in real catalog data,
// (b) complete outfits with styling logic, (c) time try-on naturally, (d) read
// and respond to hesitation, (e) close the sale, and (f) capture catalog
// demand honestly. Each follows the exact ToolDef schema pattern of the tools
// above. Handlers live in apps/shopify-app/app/lib/brain-tools.server.ts and
// are attached at boot (see brain.server.ts).

export const explainProductToolSchema: ToolDef = {
  name: "explain_product",
  description:
    "Explain a specific product using the brand's REAL catalog data — name, color, fabric, fit-type, occasion-suitability, season, and stock status. Use when the shopper asks about a product, lands on a PDP, or before recommending it, so your explanation is grounded in fact not invention. Returns the structured product detail; relay it in your own confident voice. If a field is genuinely missing, say so honestly and use what is known — never fabricate fabric, fit, or occasion.",
  schema: {
    type: "object",
    properties: {
      productId: { type: "string", description: "Product id (defaults to the current PDP product when omitted)." },
    },
    required: ["productId"],
  },
  requiresFeature: "stylist.enabled",
};

export const completeOutfitToolSchema: ToolDef = {
  name: "complete_outfit",
  description:
    "Build a complete outfit around a focal product. Returns 2-3 complementary pieces (NOT more of the same category) chosen by color-harmony rules (neutral anchors, accent pieces, one bold item max) and occasion alignment, with a one-sentence styling rationale. Use when the shopper has a piece they like and you want to complete the look. Emits the outfit-recommended signal automatically. Anchor on the focal product; explain WHY the pieces work together in one sentence.",
  schema: {
    type: "object",
    properties: {
      focalProductId: { type: "string", description: "The anchor product the outfit is built around." },
      shopperIntent:  { type: "string", description: "The occasion / vibe / need in the shopper's own words, e.g. 'smart-casual dinner', 'outdoor garden wedding'." },
    },
    required: ["focalProductId", "shopperIntent"],
  },
  requiresFeature: "stylist.enabled",
};

export const offerTryonNaturalToolSchema: ToolDef = {
  name: "offer_tryon_natural",
  description:
    "Offer try-on at the RIGHT moment — only when the shopper is uncertain about fit/look, comparing products, has dwelled on a PDP, or explicitly asked. NEVER as a first message and NEVER before intent is understood. Returns a structured offer with options (this product / the full outfit / a model close to their build) and sets up the cross-surface VTO trigger. Try-on is model-only — never offer the shopper's own photo. Frame it as a useful next step, not a gimmick.",
  schema: {
    type: "object",
    properties: {
      productId: { type: "string", description: "Product id to offer try-on for (defaults to current PDP product)." },
      reason:    { type: "string", enum: ["uncertain", "comparing", "dwell", "requested"], description: "Why now: shopper is uncertain about fit/look / comparing products / has dwelled on the PDP / explicitly asked." },
    },
    required: ["productId", "reason"],
  },
  requiresFeature: "widget.enabled",
};

export const captureHesitationToolSchema: ToolDef = {
  name: "capture_hesitation",
  description:
    "Record that the shopper is hesitating and what KIND of hesitation it is, so you respond to THAT rather than a generic offer. Returns a helpful response direction tuned to the hesitation type. Call this the moment you read a hesitation signal (returns to the same product, 'I'm not sure…', going back and forth, price doubt, size uncertainty). Then act on the returned direction — answer the unanswered question, decide for them, reframe value, or surface a size recommendation.",
  schema: {
    type: "object",
    properties: {
      productId:      { type: "string", description: "Product the shopper is hesitating on (defaults to current PDP product)." },
      hesitationType: { type: "string", enum: ["size_uncertain", "style_unsure", "price_concern", "comparing", "unknown"], description: "Which kind of hesitation you read." },
      context:        { type: "string", description: "One line of what you observed, e.g. 'returned to this dress twice, asked about the M then went quiet'." },
    },
    required: ["productId", "hesitationType", "context"],
  },
  requiresFeature: "stylist.enabled",
};

export const closeSaleToolSchema: ToolDef = {
  name: "close_sale",
  description:
    "Help the shopper decide and act once they've seen the product, checked size, and built the look. Triggers the add-to-cart flow for a single item or the full outfit at the recommended sizes, or records a 'decide later'. Use the assumptive close ('Should I add it, or the full look?') — two options max, confident not pushy. Pass sizes you've confirmed; never add to cart without a confirmed size and clear intent.",
  schema: {
    type: "object",
    properties: {
      productIds: { type: "array", items: { type: "string" }, description: "The product id(s) to act on. One for a single item, multiple for the full outfit." },
      sizes:      { type: "object", description: "Map of productId → confirmed size (e.g. {\"<id>\":\"M\"}). Only include sizes you've actually confirmed with the shopper." },
      action:     { type: "string", enum: ["add_item", "add_outfit", "decide_later"], description: "add_item = single piece, add_outfit = the full look, decide_later = they're not ready (record it, no cart change)." },
    },
    required: ["productIds", "action"],
  },
  requiresFeature: "stylist.cartActions",
};

export const captureUnmetDemandToolSchema: ToolDef = {
  name: "capture_unmet_demand",
  description:
    "Record catalog demand honestly — the production port of the demo's near-miss system. Call this after a search that came back empty/off-target (a hard gap) OR when you served the closest real piece but it was exactly ONE attribute off what the shopper named (a near-miss — e.g. they wanted cropped linen, you have linen but none cropped). Hard gaps and near-misses are the brand's sharpest reorder hints. Always emits the search-run signal; when a near-miss is named, also emits the near-miss signal. Never fake a match to avoid logging a gap — honest absence is the moat.",
  schema: {
    type: "object",
    properties: {
      query:             { type: "string", description: "What the shopper asked for, in plain words." },
      resultCount:       { type: "integer", description: "How many real matches the catalog returned (0 = hard gap)." },
      nearMissProductId: { type: "string", description: "The closest real piece you served, when this is a near-miss (omit for a hard gap)." },
      nearMissAttribute: { type: "string", enum: ["color", "size", "fabric", "cut", "price"], description: "The ONE attribute that was off on the near-miss. Only set when exactly one attribute is wrong — more than one = hard gap, leave blank." },
      canonicalCategory: { type: "string", description: "Stable category bucket for ranking (e.g. 'footwear', 'outerwear', 'price point'). Folds free-text into a consistent label." },
    },
    required: ["query", "resultCount"],
  },
  requiresFeature: "stylist.enabled",
};

export const ALL_TOOL_SCHEMAS: ToolDef[] = [
  searchCatalogToolSchema,
  proposeComboToolSchema,
  navigateToolSchema,
  addToCartToolSchema,
  addOutfitToCartToolSchema as ToolDef,
  offerSignupToolSchema,
  seeOnModelToolSchema,
  seeOnMeToolSchema,
  // Skills layer
  applyColorRuleToolSchema,
  suggestOccasionDressingToolSchema,
  compareTwoItemsToolSchema,
  // Fix 12 — explainWhyComboWorksToolSchema removed from registry; whyItWorks
  // is now embedded in propose_combo reasoning by handleProposeCombo.
  // explainWhyComboWorksToolSchema,
  recallPastPreferenceToolSchema,
  interpretFitLanguageToolSchema,
  captureShopperProfileToolSchema,
  matchReferencePhotoToolSchema,
  // Guided shopping tools — Rufus-pattern page-aware navigation + highlights
  leadBrowseToolSchema,
  guideComboWalkthroughToolSchema,
  highlightProductDetailToolSchema,
  showSizeRecommendationToolSchema,
  // Stock + size-chart intelligence (Request B)
  checkStockToolSchema,
  getSizeChartToolSchema,
  // Proactive sales-stylist tools (Mira upgrade)
  explainProductToolSchema,
  completeOutfitToolSchema,
  offerTryonNaturalToolSchema,
  captureHesitationToolSchema,
  closeSaleToolSchema,
  captureUnmetDemandToolSchema,
];
