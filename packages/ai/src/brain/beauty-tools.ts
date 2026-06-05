// Stylique Beauty — tool schemas for the Brain.
// Same pattern as tools.ts: schemas only, no handlers.
// Handlers live in apps/shopify-app/app/lib/beauty-brain.server.ts.
//
// Revenue-intensive design:
//   capture_skin_profile   → profile completeness → better recs → higher AOV
//   analyze_skin_selfie    → instant personalization → trust → conversion
//   find_shade_match       → -30% foundation returns → brand loyalty
//   build_routine          → $45 single → $189 routine basket (Alhena 2025)
//   add_routine_to_cart    → multi-item add → AOV spike
//   suggest_concern_products → upsell targeted actives
//   check_ingredient_safety → clean beauty badge → trust → premium pricing
//   recall_skin_profile    → memory → loyalty → re-purchase

import type { ToolDef } from "./types.js";

export const BEAUTY_TOOL_SCHEMAS: ToolDef[] = [
  // ─── Profile ─────────────────────────────────────────────────────────────
  {
    name: "capture_skin_profile",
    description:
      "Save the shopper's skin profile — type, concerns, depth, undertone, budget. " +
      "Call SILENTLY after they mention any skin detail. Never announce it. " +
      "One or many fields per call — all optional. " +
      "This bridges to the shade-match and routine builder so you never re-ask.",
    schema: {
      type: "object",
      properties: {
        skinType: {
          type: "string",
          enum: ["oily", "dry", "combination", "normal", "sensitive"],
          description: "Primary skin type",
        },
        concerns: {
          type: "array",
          items: { type: "string" },
          description: "Up to 3 skin concerns, most important first: acne|hyperpigmentation|redness|dryness|oiliness|texture|fine_lines|dark_circles|pores|sensitivity|uneven_tone|dullness",
        },
        skinDepth: {
          type: "string",
          enum: ["light", "light-medium", "medium", "medium-deep", "deep"],
          description: "Fitzpatrick/Monk skin depth",
        },
        undertone: {
          type: "string",
          enum: ["warm", "cool", "neutral", "olive"],
          description: "Skin undertone",
        },
        skinHex: {
          type: "string",
          description: "Most representative skin hex from selfie e.g. #C68642",
        },
        budgetMax: {
          type: "number",
          description: "Maximum spend per product in USD if stated",
        },
        routinePreference: {
          type: "string",
          enum: ["minimal", "standard", "full"],
          description: "How many steps they want in their routine",
        },
      },
      required: [],
    },
    requiresFeature: "beauty.skinProfile" as never,
  },

  // ─── Selfie skin analysis ─────────────────────────────────────────────────
  {
    name: "analyze_skin_selfie",
    description:
      "Analyze the shopper's selfie for skin type, concerns, depth, undertone, and skin hex. " +
      "Call ONLY when an image is present in the current message. " +
      "Automatically saves to skin profile — never call capture_skin_profile separately. " +
      "Image bytes are never stored — pass-through only.",
    schema: {
      type: "object",
      properties: {
        imageDataUrl: {
          type: "string",
          description: "The data: URL of the selfie from the current message",
        },
        focus: {
          type: "string",
          enum: ["skin_only", "full_face", "undertone"],
          description: "What aspect to focus on — defaults to skin_only",
        },
      },
      required: ["imageDataUrl"],
    },
    requiresFeature: "beauty.skinAnalysis" as never,
  },

  // ─── Shade matching ───────────────────────────────────────────────────────
  {
    name: "find_shade_match",
    description:
      "Match the shopper's skin to foundation/concealer shades in the catalog. " +
      "Uses Lab Delta-E distance + undertone compatibility scoring. " +
      "Returns the top 3-5 shade matches with confidence and match reason. " +
      "Call whenever they ask about foundation, concealer, or shade. " +
      "The RETURN RATE KILLER — 30% fewer returns when shade is right.",
    schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["foundation", "concealer", "tinted_moisturizer", "powder"],
          description: "Which makeup category to match within",
        },
        inStockOnly: {
          type: "boolean",
          description: "Only return in-stock shades (default true)",
        },
        limit: {
          type: "number",
          description: "How many matches to return (default 3)",
        },
      },
      required: [],
    },
    requiresFeature: "beauty.shadeMatch" as never,
  },

  // ─── Routine builder ──────────────────────────────────────────────────────
  {
    name: "build_routine",
    description:
      "Build a personalised skincare or makeup routine from the brand's catalog. " +
      "Targets the shopper's concerns with real active ingredients. " +
      "Returns AM, PM, or both — each step has a product, why it works for THEIR concern, and add-to-cart data. " +
      "The AOV lever: average routine = $189 vs $45 single product. " +
      "Always call this when they ask 'what should I use' or ask about a regimen.",
    schema: {
      type: "object",
      properties: {
        timeOfDay: {
          type: "string",
          enum: ["AM", "PM", "both"],
          description: "Which routine to build — defaults to 'both'",
        },
        includesMakeup: {
          type: "boolean",
          description: "Include makeup (foundation, concealer, etc.) in the routine",
        },
        maxProducts: {
          type: "number",
          description: "Cap at N products — for 'minimal' routine preference use 3-4",
        },
        focusConcern: {
          type: "string",
          description: "If building around one concern, name it (overrides stored profile priority)",
        },
      },
      required: [],
    },
    requiresFeature: "beauty.routineBuilder" as never,
  },

  // ─── Routine add-to-cart ──────────────────────────────────────────────────
  {
    name: "add_routine_to_cart",
    description:
      "Add the full routine (or selected steps) to cart in one shot. " +
      "Call when they confirm a routine or say 'add all' / 'get everything'. " +
      "The AOV spike action — never suggest clicking items individually when this works.",
    schema: {
      type: "object",
      properties: {
        routineSteps: {
          type: "array",
          items: { type: "object" },
          description: "The routine steps to add — from build_routine output. Each item: { productId, variantId, step }",
        },
        timeOfDay: {
          type: "string",
          enum: ["AM", "PM", "both"],
          description: "Which part of the routine to add (if not adding all)",
        },
      },
      required: ["routineSteps"],
    },
    requiresFeature: "beauty.routineBuilder" as never,
  },

  // ─── Concern-targeted search ──────────────────────────────────────────────
  {
    name: "suggest_concern_products",
    description:
      "Find catalog products that directly target one or more skin concerns. " +
      "Scored by concern-ingredient keyword matching. " +
      "Use for targeted recommendations: 'what helps with acne?' / 'anything for dark circles?'. " +
      "More targeted than search_catalog for beauty use cases.",
    schema: {
      type: "object",
      properties: {
        concerns: {
          type: "array",
          items: { type: "string" },
          description: "Skin concerns to target: acne|hyperpigmentation|redness|dryness|oiliness|texture|fine_lines|dark_circles|pores|sensitivity|uneven_tone|dullness",
        },
        category: {
          type: "string",
          description: "Optional: limit to a product category (serum, cleanser, etc.)",
        },
        maxResults: {
          type: "number",
          description: "How many products to return (default 4)",
        },
      },
      required: ["concerns"],
    },
    requiresFeature: "beauty.skinProfile" as never,
  },

  // ─── Ingredient safety ────────────────────────────────────────────────────
  {
    name: "check_ingredient_safety",
    description:
      "Analyze a product's INCI ingredient list for safety, clean beauty status, and concern-fit. " +
      "Returns: overall safety score 0-10, clean beauty badge (no fragrance/parabens/SLS/formaldehyde), " +
      "key actives for their concerns, flagged ingredients. " +
      "Two usage modes: (1) pass productId to analyze the product's stored INCI from the catalog; " +
      "(2) pass ingredients[] directly when the shopper has read out a label or asks about a product not in the catalog. " +
      "Call when they ask 'is this safe for sensitive skin?' / 'does this have fragrance?' / 'clean ingredients?'. " +
      "Clean beauty badge = trust signal → conversion lift.",
    schema: {
      type: "object",
      properties: {
        productId: {
          type: "string",
          description: "The product to analyze — defaults to current PDP product. Omit when passing ingredients[] directly.",
        },
        ingredients: {
          type: "array",
          items: { type: "string" },
          description: "Explicit INCI ingredient list when the shopper provides one directly (e.g. reading a label). Each entry is one ingredient name.",
        },
        concerns: {
          type: "array",
          items: { type: "string" },
          description: "Shopper skin concerns to check ingredient fit against (e.g. ['sensitivity', 'acne']). Defaults to stored profile concerns.",
        },
        checkFor: {
          type: "array",
          items: { type: "string" },
          description: "Specific ingredients to call out explicitly (e.g. ['fragrance', 'retinol']). Works on both modes.",
        },
      },
      required: [],
    },
    requiresFeature: "beauty.ingredientCheck" as never,
  },

  // ─── Free-text skin profile interpretation ───────────────────────────────
  // Mira's "understand skin" tool. The shopper describes their skin in any
  // language ("oily T-zone, dry cheeks, dark spots from old breakouts") and
  // this tool returns a structured skin profile ready for capture_skin_profile.
  // Uses Gemini to interpret free-form text — NOT a selfie analysis.
  {
    name: "analyze_skin_profile",
    description:
      "Interpret a shopper's free-text skin description and return a structured skin profile. " +
      "Use when the shopper describes their skin in words (not a photo). " +
      "Returns { skinType, concerns[], depth?, undertone? } — then call capture_skin_profile with the result. " +
      "Examples: 'I have oily T-zone and dry cheeks' → combination skin. " +
      "'Dark spots from sun damage' → concerns: [hyperpigmentation]. " +
      "Never call this AND analyze_skin_selfie in the same turn.",
    schema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "The shopper's raw skin description text (up to 600 chars)",
        },
        existingProfile: {
          type: "object",
          description: "Optional: already-known skin fields to merge with (avoids overwriting confident data). Pass { skinType?, undertone?, depth? } from a prior recall_skin_profile call.",
        },
      },
      required: ["description"],
    },
    requiresFeature: "beauty.skinProfile" as never,
  },

  // ─── Shade recommendation by explicit parameters ──────────────────────────
  // Unlike find_shade_match (which reads from the stored shopper profile),
  // recommend_shade takes explicit skin parameters + an optional product handle
  // to constrain results — useful when a shopper provides their skin details
  // mid-conversation or asks about a SPECIFIC product's shade range.
  {
    name: "recommend_shade",
    description:
      "Recommend the best shade for a specific product (or category) given explicit skin parameters. " +
      "Use when the shopper provides skin details for a specific product they're looking at: " +
      "'I'm NC25, warm undertone — what shade of this foundation?' " +
      "Returns ranked variants with confidence and a one-line 'why' for each. " +
      "Prefer find_shade_match when you only have the stored profile and no product context.",
    schema: {
      type: "object",
      properties: {
        skinType: {
          type: "string",
          enum: ["oily", "dry", "combination", "normal", "sensitive"],
          description: "Shopper's skin type — from analyze_skin_profile or stated directly",
        },
        undertone: {
          type: "string",
          enum: ["warm", "cool", "neutral", "olive"],
          description: "Skin undertone",
        },
        depth: {
          type: "string",
          enum: ["light", "light-medium", "medium", "medium-deep", "deep"],
          description: "Fitzpatrick/Monk depth",
        },
        skinHex: {
          type: "string",
          description: "Skin hex code from selfie analysis e.g. #C68642 — improves accuracy when available",
        },
        productHandle: {
          type: "string",
          description: "Shopify product handle to match shades within — if omitted, searches across the whole catalog for the given category",
        },
        category: {
          type: "string",
          enum: ["foundation", "concealer", "tinted_moisturizer", "powder"],
          description: "Fallback category search when productHandle is omitted",
        },
        limit: {
          type: "number",
          description: "Number of ranked results to return (default 3)",
        },
      },
      required: [],
    },
    requiresFeature: "beauty.shadeMatch" as never,
  },

  // ─── Replenishment suggestions ────────────────────────────────────────────
  // Reads the shopper's CART_CONFIRMED purchase history + per-category
  // replenishment windows to surface items that are due or overdue for restock.
  // The handler lives in replenishment.server.ts (handleSuggestReplenishment).
  {
    name: "suggest_replenishment",
    description:
      "Check if any of the shopper's previous purchases are due for replenishment. " +
      "Call when they re-open the chat, mention 'running out', 'need more', or 'reorder'. " +
      "Returns up to 3 due items with urgency (now / soon) and days until due. " +
      "The loyalty lever — proactive replenishment nudge = higher LTV.",
    schema: {
      type: "object",
      properties: {
        urgencyFilter: {
          type: "string",
          enum: ["now", "soon", "any"],
          description: "Only return items at this urgency level — 'any' returns all due items (default)",
        },
      },
      required: [],
    },
    requiresFeature: "beauty.skinProfile" as never,
  },

  // ─── Skin profile recall ──────────────────────────────────────────────────
  {
    name: "recall_skin_profile",
    description:
      "Read back what we know about this shopper's skin — type, concerns, depth, undertone. " +
      "Call at the start of a returning-shopper conversation so you don't re-interview them. " +
      "Returns null when no profile exists — prompt the selfie or a quick skin question.",
    schema: {
      type: "object",
      properties: {
        include: {
          type: "array",
          items: { type: "string" },
          description: "Which parts to include: skin|shade|routine|concerns|all — defaults to all",
        },
      },
      required: [],
    },
    requiresFeature: "beauty.skinProfile" as never,
  },
];
