// Stylique Beauty — beauty brain wiring.
//
// This is the beauty-mode counterpart to brain.server.ts. It wires the
// beauty tool handlers (Prisma queries, skin analysis, shade matching,
// routine builder, ingredient analyzer) onto the schemas from
// @stylique/ai/brain/beauty-tools.
//
// Usage: in brain.server.ts, when `brandMode === "beauty"`, include
// these handlers in the registry alongside the base fashion tools.
//
// Security invariants from §3.5 all hold:
//   - Every query filters by shopId.
//   - Image bytes pass through — never persisted (D23/PB17).
//   - shopperRowId-scoped reads only.

import { z } from "zod";
import type { BrainContext } from "@stylique/ai";
import {
  createSkinAnalysisProvider,
  matchShades,
  buildRoutineScaffold,
  scoreProductForSlot,
  buildRoutineName,
  analyzeProductIngredients,
  estimateReplenishmentWindow,
  parseShadeUndertone,
  parseShadeDepth,
  CONCERN_INGREDIENT_KEYWORDS,
  type ProductShadeInfo,
  type BeautyRoutine,
  type RoutineProduct,
  type SkinConcern,
  type SkinType,
  type SkinDepth,
  type SkinUndertone,
} from "@stylique/core";

import { prisma } from "../db.server";
import { handleSuggestReplenishment } from "./replenishment.server";
import { readShadeWeights } from "./shade-tuner.server";

// ─── Validation schemas for Brain tool args ──────────────────────────────────
// The Brain tool args arrive from LLM output — they MUST be Zod-validated before
// any DB write, the same as REST inputs (§3.5 invariant #3).

const CaptureSkinProfileSchema = z.object({
  skinType:          z.enum(["oily", "dry", "combination", "normal", "sensitive"]).optional(),
  concerns:          z.array(z.string().max(50)).max(10).optional(),
  skinDepth:         z.enum(["light", "light-medium", "medium", "medium-deep", "deep"]).optional(),
  undertone:         z.enum(["warm", "cool", "neutral", "olive"]).optional(),
  // Hex colour from selfie analysis — must be a 6-digit hex string
  skinHex:           z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // Positive USD amount, cap at $10,000 to prevent absurd values
  budgetMax:         z.number().finite().positive().max(10_000).optional(),
  routinePreference: z.enum(["minimal", "standard", "full"]).optional(),
});

// ─── Skin analysis provider (Gemini Vision, lazy-init) ─────────────────────

let _skinProvider: ReturnType<typeof createSkinAnalysisProvider> | null = null;
function getSkinProvider() {
  if (!_skinProvider) {
    _skinProvider = createSkinAnalysisProvider({
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    });
  }
  return _skinProvider;
}

// ─── inferSkinProfileFromText — regex/heuristic fallback ─────────────────────
// Used by analyze_skin_profile when GEMINI_API_KEY is absent or Gemini fails.
// Returns a best-effort structured profile from keyword matching so beauty mode
// degrades gracefully rather than returning an error in dev environments.

function inferSkinProfileFromText(
  description: string,
  existingProfile: Record<string, string>,
): {
  skinType: string | null;
  concerns: string[];
  depth: string | null;
  undertone: string | null;
  confidence: number;
  hint: string;
} {
  const lc = description.toLowerCase();

  // Skin type detection — order matters (combination before oily/dry)
  let skinType: string | null = existingProfile.skinType ?? null;
  if (!skinType) {
    if (/t.?zone|combination|combo/.test(lc)) skinType = "combination";
    else if (/oily|shiny|greasy/.test(lc)) skinType = "oily";
    else if (/dry|tight|flaky|dehydrat/.test(lc)) skinType = "dry";
    else if (/sensitive|reactive|sting|burn|red.{0,10}skin/.test(lc)) skinType = "sensitive";
    else if (/normal|balanced/.test(lc)) skinType = "normal";
  }

  // Concerns
  const concernMap: Array<[RegExp, string]> = [
    [/acne|breakout|pimple|blemish|cystic/, "acne"],
    [/dark spot|hyper.*pigment|pih|sun spot|age spot/, "hyperpigmentation"],
    [/redness|rosacea|flush|red face/, "redness"],
    [/dry|tight|dehydrat/, "dryness"],
    [/oily|shiny|greasy/, "oiliness"],
    [/texture|rough|bump|uneven surface/, "texture"],
    [/fine line|wrinkle|aging|age|anti.age/, "fine_lines"],
    [/dark circle|under.eye|tired eye/, "dark_circles"],
    [/pore|enlarged pore/, "pores"],
    [/sensiti|react/, "sensitivity"],
    [/uneven tone|patchy|discolor/, "uneven_tone"],
    [/dull|lackluster|glow|brightening/, "dullness"],
  ];
  const concerns: string[] = [];
  for (const [re, concern] of concernMap) {
    if (re.test(lc) && !concerns.includes(concern)) {
      concerns.push(concern);
      if (concerns.length >= 3) break;
    }
  }

  // Depth
  let depth: string | null = existingProfile.depth ?? null;
  if (!depth) {
    if (/\bfair\b|very light|pale/.test(lc)) depth = "light";
    else if (/light.medium|light to medium/.test(lc)) depth = "light-medium";
    else if (/\bmedium\b|tan|olive/.test(lc)) depth = "medium";
    else if (/medium.deep|medium to deep/.test(lc)) depth = "medium-deep";
    else if (/deep|dark skin|rich skin/.test(lc)) depth = "deep";
  }

  // Undertone
  let undertone: string | null = existingProfile.undertone ?? null;
  if (!undertone) {
    if (/warm|golden|yellow|peachy|bronze/.test(lc)) undertone = "warm";
    else if (/cool|pink|rosy|bluish/.test(lc)) undertone = "cool";
    else if (/olive|greenish/.test(lc)) undertone = "olive";
    else if (/neutral|both|mix/.test(lc)) undertone = "neutral";
  }

  const fieldsFound = [skinType, concerns.length > 0, depth, undertone].filter(Boolean).length;
  const confidence = fieldsFound >= 3 ? 0.7 : fieldsFound >= 2 ? 0.5 : 0.3;

  return {
    skinType,
    concerns,
    depth,
    undertone,
    confidence,
    hint: "Call capture_skin_profile with these values. Don't announce the save.",
  };
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

export type BeautyToolHandlers = Record<
  string,
  (args: Record<string, unknown>, ctx: BrainContext) => Promise<unknown>
>;

export function buildBeautyToolHandlers(): BeautyToolHandlers {
  return {

    // ── capture_skin_profile ─────────────────────────────────────────────
    capture_skin_profile: async (args, ctx) => {
      const shopperRowId = ctx.shopperRowId;
      if (!shopperRowId) return { ok: false, error: "no_shopper_session" };

      // Validate ALL LLM-supplied args before touching the DB (§3.5 invariant #3)
      const parsed = CaptureSkinProfileSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "invalid_input" };

      const { skinType, concerns, skinDepth, undertone, skinHex, budgetMax, routinePreference } = parsed.data;

      // Build update payload — only set non-null values
      const update: Record<string, unknown> = {};
      if (skinType) update.skinTypeBeauty = skinType;
      if (concerns?.length) update.skinConcernsJson = concerns;
      if (skinDepth) update.skinDepth = skinDepth;
      if (undertone) update.skinUndertone = undertone;
      if (skinHex) update.skinHex = skinHex;
      if (budgetMax != null) update.budgetMax = budgetMax;
      if (routinePreference) update.routinePreference = routinePreference;

      if (!Object.keys(update).length) return { ok: true, saved: {} };

      // Defence-in-depth: add shopId to the where clause so a malformed ctx
      // cannot cause a cross-session write (§3.5 invariant #1).
      const updated = await prisma.shopperSession.updateMany({
        where: { id: shopperRowId, shopifyDomain: ctx.shopDomain ?? undefined },
        data: update,
      });

      if (updated.count === 0) return { ok: false, error: "unauthorized" };

      return { ok: true, saved: update };
    },

    // ── analyze_skin_selfie ──────────────────────────────────────────────
    analyze_skin_selfie: async (args, ctx) => {
      const { imageDataUrl } = args as { imageDataUrl: string; focus?: string };

      // Security: validate data URL format (§3.5 invariant #3)
      const ALLOWED = /^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/;
      if (!ALLOWED.test(imageDataUrl)) {
        return { error: "invalid_image_format" };
      }

      const provider = getSkinProvider();
      const result = await provider.analyze(imageDataUrl);
      // Never store image bytes — pass-through only (D23/PB17)

      // Auto-save to session
      const shopperRowId = ctx.shopperRowId;
      if (shopperRowId && result.confidence > 0.3) {
        // §3 invariant #1 — updateMany with shopId guard prevents cross-tenant write.
        await prisma.shopperSession.updateMany({
          where: { id: shopperRowId, shopifyDomain: ctx.shopDomain ?? undefined },
          data: {
            skinTypeBeauty: result.skinType,
            skinConcernsJson: result.concerns.filter(c => c.confidence > 0.4).map(c => c.concern),
            skinDepth: result.depth,
            skinUndertone: result.undertone,
            skinHex: result.skinHex,
            skinAnalyzedAt: new Date(),
          },
        });
      }

      return {
        skinType: result.skinType,
        undertone: result.undertone,
        depth: result.depth,
        concerns: result.concerns.filter(c => c.confidence > 0.4).map(c => c.concern),
        skinHex: result.skinHex,
        analysisNotes: result.analysisNotes,
        confidence: result.confidence,
      };
    },

    // ── find_shade_match ─────────────────────────────────────────────────
    find_shade_match: async (args, ctx) => {
      const { category = "foundation", inStockOnly = true, limit = 3 } = args as {
        category?: string;
        inStockOnly?: boolean;
        limit?: number;
      };

      const shopId = ctx.shopId;
      const shopperRowId = ctx.shopperRowId;

      // Get shopper skin profile (§3 invariant #1 — filter by shopifyDomain)
      const session = shopperRowId
        ? await prisma.shopperSession.findFirst({
            where: { id: shopperRowId, shopifyDomain: ctx.shopDomain ?? undefined },
            select: { skinHex: true, skinUndertone: true, skinDepth: true },
          })
        : null;

      // Fetch foundation/concealer products from catalog
      const products = await prisma.product.findMany({
        where: {
          shopId,
          category: { contains: category, mode: "insensitive" },
        },
        include: {
          variants: { where: { availableForSale: true } },
          images: { orderBy: { position: "asc" }, take: 1 },
        },
        take: 50,
      });

      // Build ProductShadeInfo array from catalog
      const shadeProducts: ProductShadeInfo[] = products.map(p => ({
        productId: p.id,
        productHandle: p.handle,
        productTitle: p.title,
        imageUrl: p.images[0]?.url ?? null,
        shades: p.variants.map(v => {
          const shadeName = v.color ?? v.size ?? p.title;
          const undertoneHint = parseShadeUndertone(shadeName);
          const depthHint = parseShadeDepth(shadeName);
          return {
            variantId: v.shopifyId ?? v.id,
            shadeName,
            undertoneHint,
            depthHint,
            inStock: v.availableForSale ?? true,
          };
        }),
      }));

      // Closing the learning loop: pull the per-shop shade weights tuned by
      // shade-tuner.server.ts from past BEAUTY_SHADE_MATCHED + cart outcomes.
      // Falls back to DEFAULT_SHADE_WEIGHTS when no tuned weights exist yet.
      const weights = await readShadeWeights(ctx.shopId);
      const matches = matchShades(
        shadeProducts,
        {
          skinHex: session?.skinHex ?? undefined,
          undertone: (session?.skinUndertone as SkinUndertone) ?? undefined,
          depth: (session?.skinDepth as SkinDepth) ?? undefined,
        },
        { limit, inStockOnly, weights },
      );

      return {
        matches,
        shopperProfile: {
          skinHex: session?.skinHex,
          undertone: session?.skinUndertone,
          depth: session?.skinDepth,
        },
      };
    },

    // ── build_routine ────────────────────────────────────────────────────
    build_routine: async (args, ctx) => {
      const {
        timeOfDay = "both",
        includesMakeup = false,
        maxProducts = 6,
        focusConcern,
      } = args as {
        timeOfDay?: "AM" | "PM" | "both";
        includesMakeup?: boolean;
        maxProducts?: number;
        focusConcern?: string;
      };

      const shopId = ctx.shopId;
      const shopperRowId = ctx.shopperRowId;

      // Get shopper skin profile (§3 invariant #1 — filter by shopifyDomain)
      const session = shopperRowId
        ? await prisma.shopperSession.findFirst({
            where: { id: shopperRowId, shopifyDomain: ctx.shopDomain ?? undefined },
            select: { skinTypeBeauty: true, skinConcernsJson: true, budgetMax: true },
          })
        : null;

      const rawConcerns = (session?.skinConcernsJson as string[] | null) ?? [];
      const concerns: SkinConcern[] = (focusConcern
        ? [focusConcern, ...rawConcerns.filter(c => c !== focusConcern)]
        : rawConcerns) as SkinConcern[];

      if (!concerns.length) {
        return { error: "no_skin_profile", hint: "Call capture_skin_profile or analyze_skin_selfie first." };
      }

      const skinType = session?.skinTypeBeauty as SkinType | undefined;
      const budgetMax = session?.budgetMax ?? undefined;

      // Build routine scaffold
      const slots = buildRoutineScaffold(concerns, timeOfDay, includesMakeup);

      // Fetch all products from catalog
      const allProducts = await prisma.product.findMany({
        where: { shopId },
        include: {
          variants: { where: { availableForSale: true }, take: 1 },
          images: { orderBy: { position: "asc" }, take: 1 },
        },
        take: 200,
      });

      // Score products for each slot
      const steps: RoutineProduct[] = [];
      const usedProductIds = new Set<string>();

      for (const slot of slots.slice(0, maxProducts)) {
        let bestScore = -1;
        let bestProduct: typeof allProducts[0] | null = null;

        for (const product of allProducts) {
          if (usedProductIds.has(product.id)) continue;

          // Budget filter (priceCents → USD)
          const priceCents = product.variants[0]?.priceCents ?? 0;
          if (budgetMax && priceCents > budgetMax * 100) continue;

          const score = scoreProductForSlot(
            {
              title: product.title,
              tags: product.tags ?? [],
              category: product.category ?? undefined,
            },
            slot,
            concerns,
            skinType,
          );

          if (score > bestScore) {
            bestScore = score;
            bestProduct = product;
          }
        }

        if (bestProduct && bestScore > 0) {
          usedProductIds.add(bestProduct.id);
          const variant = bestProduct.variants[0];
          const inStock = variant?.availableForSale ?? true;
          steps.push({
            step: slot.step,
            productId: bestProduct.id,
            productHandle: bestProduct.handle,
            productTitle: bestProduct.title,
            imageUrl: bestProduct.images[0]?.url ?? null,
            priceUsd: variant ? (variant.priceCents ?? 0) / 100 : null,
            whyForYou: slot.whyForConcern,
            inStock,
          });
        }
      }

      const totalPriceUsd = steps.reduce((sum, s) => sum + (s.priceUsd ?? 0), 0);
      const routineName = buildRoutineName(concerns, timeOfDay);

      const routine: BeautyRoutine = {
        name: routineName,
        timeOfDay,
        steps,
        totalPriceUsd: totalPriceUsd || null,
        concernsAddressed: concerns,
        addToCartItems: steps.map(s => ({ productId: s.productId })),
      };

      return routine;
    },

    // ── add_routine_to_cart ──────────────────────────────────────────────
    add_routine_to_cart: async (args, ctx) => {
      const { routineSteps } = args as {
        routineSteps: Array<{ productId: string; variantId?: string; step?: string }>;
      };

      if (!routineSteps?.length) return { error: "no_items" };

      const shopId = ctx.shopId;

      // Resolve shopify variant IDs — look up by productId (scoped to shop)
      const productIds = routineSteps.map(s => s.productId).filter(Boolean);
      const variants = await prisma.productVariant.findMany({
        where: { productId: { in: productIds }, product: { shopId } },
        select: { productId: true, shopifyId: true },
        distinct: ["productId"],
      });

      const variantByProduct = new Map(variants.map(v => [v.productId, v.shopifyId]));
      const shopifyVariantIds = productIds
        .map(id => variantByProduct.get(id))
        .filter(Boolean) as string[];

      return {
        kind: "action",
        action: {
          type: "add_routine_to_cart",
          shopifyVariantIds,
          itemCount: shopifyVariantIds.length,
        },
        shopifyVariantIds,
      };
    },

    // ── suggest_concern_products ─────────────────────────────────────────
    suggest_concern_products: async (args, ctx) => {
      const { concerns = [], category, maxResults: rawMaxResults = 4 } = args as {
        concerns?: string[];
        category?: string;
        maxResults?: number;
      };
      // Server-side cap — LLM args are untrusted; prevent runaway DB queries
      const maxResults = Math.min(Math.max(1, Number(rawMaxResults) || 4), 20);

      const shopId = ctx.shopId;

      // Build keyword search terms from concern mappings
      const keywords = concerns.flatMap(
        c => CONCERN_INGREDIENT_KEYWORDS[c as SkinConcern] ?? []
      );

      if (!keywords.length) {
        return { products: [], reason: "no_concern_keywords" };
      }

      const orKeywords = keywords.slice(0, 10).map(kw => ({
        OR: [
          { title: { contains: kw, mode: "insensitive" as const } },
          { tags: { has: kw } },
        ],
      }));

      const categoryFilter = category
        ? { category: { contains: category, mode: "insensitive" as const } }
        : {};

      const products = await prisma.product.findMany({
        where: { shopId, OR: orKeywords, ...categoryFilter },
        include: {
          variants: { where: { availableForSale: true }, take: 1 },
          images: { orderBy: { position: "asc" }, take: 1 },
        },
        take: maxResults * 2,
      });

      // Score by keyword density
      const scored = products.map(p => {
        const text = `${p.title} ${(p.tags ?? []).join(" ")}`.toLowerCase();
        const score = keywords.reduce((sum, kw) => sum + (text.includes(kw.toLowerCase()) ? 1 : 0), 0);
        return { product: p, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, maxResults).map(({ product: p }) => ({
        id: p.id,
        handle: p.handle,
        title: p.title,
        priceUsd: p.variants[0]?.priceCents ? p.variants[0].priceCents / 100 : null,
        imageUrl: p.images[0]?.url ?? null,
      }));

      return { products: top, concerns, keywords: keywords.slice(0, 6) };
    },

    // ── check_ingredient_safety ──────────────────────────────────────────
    // Two modes:
    //   (1) productId (or currentProduct) → fetch INCI from DB / metafields
    //   (2) ingredients[] passed directly → analyze without a DB product
    // Mode 2 is used when the shopper reads a label or asks about a product
    // not in the catalog. analyzeProductIngredients treats the id as an opaque
    // reference key only; it doesn't hit the DB, so any non-empty string works.
    check_ingredient_safety: async (args, ctx) => {
      const { productId, ingredients: directIngredients, concerns: argConcerns, checkFor } = args as {
        productId?: string;
        ingredients?: string[];
        concerns?: string[];
        checkFor?: string[];
      };

      const shopId = ctx.shopId;

      // Get shopper concerns for relevance scoring — merge arg-provided concerns
      // with stored profile so either source works.
      const shopperRowId = ctx.shopperRowId;
      const session = shopperRowId
        ? await prisma.shopperSession.findFirst({
            where: { id: shopperRowId, shopifyDomain: ctx.shopDomain ?? undefined },
            select: { skinConcernsJson: true },
          })
        : null;
      const storedConcerns = (session?.skinConcernsJson as SkinConcern[] | null) ?? [];
      // Merge: arg concerns take precedence; deduplicate.
      const mergedConcernSet = new Set<string>([
        ...(argConcerns ?? []),
        ...storedConcerns,
      ]);
      const shopperConcerns = [...mergedConcernSet] as SkinConcern[];

      // ── Mode 2: direct ingredients list ─────────────────────────────────
      if (directIngredients?.length) {
        const inciString = directIngredients.join(", ");
        const referenceId = productId ?? "external_label";
        const report = analyzeProductIngredients(referenceId, inciString, shopperConcerns);
        if (checkFor?.length) {
          const highlighted = report.keyActives
            .concat(report.flaggedIngredients)
            .filter(a => checkFor.some(c => a.name.toLowerCase().includes(c.toLowerCase())));
          return { ...report, highlighted, mode: "direct_ingredients" };
        }
        return { ...report, mode: "direct_ingredients" };
      }

      // ── Mode 1: product lookup ───────────────────────────────────────────
      const resolvedId = productId ?? ctx.currentProduct?.id;

      if (!resolvedId) {
        return {
          error: "no_product",
          hint: "Navigate to a product page first, or pass ingredients[] directly.",
        };
      }

      // Fetch product — ensure it belongs to this shop (§3.5 invariant #1)
      const product = await prisma.product.findFirst({
        where: { id: resolvedId, shopId },
        select: { id: true, title: true, sizeChartJson: true, tags: true },
      });

      if (!product) return { error: "product_not_found" };

      // Extract INCI from sizeChartJson (stored as metafields proxy) or tags.
      // In production, INCI lives in a dedicated metafield — brands add it via
      // Shopify metafield editor. For now, check sizeChartJson for an ingredients key.
      const meta = product.sizeChartJson as Record<string, unknown> | null;
      const inciString: string =
        (meta?.["ingredients"] as string | undefined) ??
        (meta?.["inci"] as string | undefined) ??
        product.tags.filter(t => t.startsWith("inci:")).map(t => t.slice(5)).join(", ") ??
        "";

      if (!inciString) {
        return {
          productId: resolvedId,
          productTitle: product.title,
          error: "no_ingredient_list",
          hint: "No INCI list found. The shopper can read the label and you can re-call with ingredients[].",
        };
      }

      const report = analyzeProductIngredients(resolvedId, inciString, shopperConcerns);

      if (checkFor?.length) {
        const highlighted = report.keyActives
          .concat(report.flaggedIngredients)
          .filter(a => checkFor.some(c => a.name.toLowerCase().includes(c.toLowerCase())));
        return { ...report, highlighted, productTitle: product.title, mode: "product_lookup" };
      }

      return { ...report, productTitle: product.title, mode: "product_lookup" };
    },

    // ── recall_skin_profile ──────────────────────────────────────────────
    recall_skin_profile: async (args, ctx) => {
      const { include = ["all"] } = args as { include?: string[] };
      const shopperRowId = ctx.shopperRowId;

      if (!shopperRowId) return null;

      // Defence-in-depth: add shopifyDomain filter so a wrong ctx.shopperRowId
      // cannot leak another shopper's profile (§3.5 invariant #1).
      const session = await prisma.shopperSession.findFirst({
        where: { id: shopperRowId, shopifyDomain: ctx.shopDomain },
        select: {
          skinTypeBeauty: true,
          skinConcernsJson: true,
          skinDepth: true,
          skinUndertone: true,
          skinHex: true,
          skinAnalyzedAt: true,
          routinePreference: true,
        },
      });

      if (!session?.skinTypeBeauty && !session?.skinConcernsJson) return null;

      const all = include.includes("all");

      return {
        ...(all || include.includes("skin") ? {
          skinType: session.skinTypeBeauty,
          depth: session.skinDepth,
          undertone: session.skinUndertone,
          skinHex: session.skinHex,
          analyzedAt: session.skinAnalyzedAt,
        } : {}),
        ...(all || include.includes("concerns") ? {
          concerns: session.skinConcernsJson as SkinConcern[] | null,
          routinePreference: session.routinePreference,
        } : {}),
      };
    },

    // ── analyze_skin_profile ─────────────────────────────────────────────
    // Interprets free-text skin descriptions ("oily T-zone, dry cheeks, dark spots")
    // into a structured skin profile. Uses the skin analysis provider (Gemini) in
    // text-only mode rather than selfie mode. The caller should then pass the result
    // to capture_skin_profile. Image bytes are NOT involved here — text only.
    analyze_skin_profile: async (args, _ctx) => {
      const description = String(args.description ?? "").trim().slice(0, 600);
      if (!description) {
        return { error: "no_description", hint: "Pass the shopper's skin description text." };
      }

      const existingProfile = (args.existingProfile as Record<string, string> | undefined) ?? {};

      // Use Gemini text API to interpret the description into structured skin data.
      // We construct a tightly-scoped prompt that outputs JSON only — same pattern
      // as the Brain's `responseMimeType: application/json` approach in brain.ts.
      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      if (!GEMINI_API_KEY) {
        // Fallback: best-effort regex interpretation so beauty mode still works in dev.
        return inferSkinProfileFromText(description, existingProfile);
      }

      try {
        const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
        const systemPrompt = [
          "You are a dermatology knowledge base. Extract structured skin attributes from the user description.",
          "Reply ONLY with valid JSON matching this schema:",
          '{ "skinType": "oily"|"dry"|"combination"|"normal"|"sensitive",',
          '  "concerns": string[], // max 3 from: acne|hyperpigmentation|redness|dryness|oiliness|texture|fine_lines|dark_circles|pores|sensitivity|uneven_tone|dullness',
          '  "depth": "light"|"light-medium"|"medium"|"medium-deep"|"deep"|null,',
          '  "undertone": "warm"|"cool"|"neutral"|"olive"|null,',
          '  "confidence": number // 0-1',
          "}",
          "Map descriptive phrases to values:",
          "- 'oily T-zone, dry cheeks' → combination",
          "- 'dark spots', 'sun damage', 'PIH' → hyperpigmentation",
          "- 'breakouts', 'acne' → acne",
          "- 'fair', 'light' → light or light-medium depth",
          "- 'olive skin' → medium depth + olive undertone",
          "- 'warm undertone', 'golden' → warm",
          "Never invent values not supported by the description.",
        ].join("\n");

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: description }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
                maxOutputTokens: 256,
              },
            }),
            signal: AbortSignal.timeout(8_000),
          },
        );

        if (!res.ok) throw new Error(`gemini_http_${res.status}`);
        const json = await res.json() as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const parsed = JSON.parse(raw) as {
          skinType?: string; concerns?: string[]; depth?: string | null;
          undertone?: string | null; confidence?: number;
        };

        // Merge with any existing profile — don't overwrite confident existing data.
        const merged = {
          skinType: parsed.skinType ?? existingProfile.skinType ?? null,
          concerns: parsed.concerns?.slice(0, 3) ?? [],
          depth: parsed.depth ?? existingProfile.depth ?? null,
          undertone: parsed.undertone ?? existingProfile.undertone ?? null,
          confidence: parsed.confidence ?? 0.6,
        };

        return {
          ...merged,
          hint: "Call capture_skin_profile with these values. Don't announce the save.",
        };
      } catch (err) {
        // Graceful fallback — regex-based heuristic extraction.
        console.error("[analyze_skin_profile] Gemini fallback:", err);
        return inferSkinProfileFromText(description, existingProfile);
      }
    },

    // ── recommend_shade ──────────────────────────────────────────────────
    // Explicit-parameter shade matching — takes skinType/undertone/depth directly
    // rather than reading from the stored profile. Useful when the shopper gives
    // skin details in the same message they ask about a specific product.
    recommend_shade: async (args, ctx) => {
      const {
        skinType,
        undertone,
        depth,
        skinHex,
        productHandle,
        category = "foundation",
        limit = 3,
      } = args as {
        skinType?: string;
        undertone?: string;
        depth?: string;
        skinHex?: string;
        productHandle?: string;
        category?: string;
        limit?: number;
      };

      const shopId = ctx.shopId;

      // Resolve products — single product if handle given, else category search.
      const productWhere = productHandle
        ? { shopId, handle: productHandle }
        : { shopId, category: { contains: category, mode: "insensitive" as const } };

      const products = await prisma.product.findMany({
        where: productWhere,
        include: {
          variants: { where: { availableForSale: true } },
          images: { orderBy: { position: "asc" }, take: 1 },
        },
        take: productHandle ? 1 : 50,
      });

      if (!products.length) {
        return { matches: [], reason: "no_products_found", hint: "Try find_shade_match for a broader search." };
      }

      // Build ProductShadeInfo array.
      const shadeProducts: ProductShadeInfo[] = products.map(p => ({
        productId: p.id,
        productHandle: p.handle,
        productTitle: p.title,
        imageUrl: p.images[0]?.url ?? null,
        shades: p.variants.map(v => {
          const shadeName = v.color ?? v.size ?? p.title;
          const undertoneHint = parseShadeUndertone(shadeName);
          const depthHint = parseShadeDepth(shadeName);
          return {
            variantId: v.shopifyId ?? v.id,
            shadeName,
            undertoneHint,
            depthHint,
            inStock: v.availableForSale ?? true,
          };
        }),
      }));

      const weights = await readShadeWeights(ctx.shopId);
      const matches = matchShades(
        shadeProducts,
        {
          skinHex: skinHex,
          undertone: undertone as SkinUndertone | undefined,
          depth: depth as SkinDepth | undefined,
        },
        { limit: Math.min(limit, 5), inStockOnly: true, weights },
      );

      return {
        matches,
        searchedHandle: productHandle ?? null,
        searchedCategory: productHandle ? null : category,
        inputProfile: { skinType: skinType ?? null, undertone: undertone ?? null, depth: depth ?? null, skinHex: skinHex ?? null },
      };
    },

    // ── suggest_replenishment ─────────────────────────────────────────────
    // Delegates to the replenishment engine in replenishment.server.ts.
    // That module is the single source of truth for replenishment windows — it
    // also powers GET api/beauty/replenishment on the shopper proxy. We call
    // handleSuggestReplenishment here so the logic stays in one place and the
    // Brain gets the same "top 3 due items + urgency" view the REST surface returns.
    suggest_replenishment: async (_args, ctx) => {
      const urgencyFilter = String((_args.urgencyFilter as string | undefined) ?? "any");

      const result = await handleSuggestReplenishment({
        shopId: ctx.shopId,
        shopperSessionId: ctx.shopperRowId,
        shopDomain: ctx.shopDomain,
      });

      if (!result.hasItems) {
        return { hasItems: false, message: result.message, items: [] };
      }

      // Apply optional urgency filter.
      const items = urgencyFilter === "any"
        ? result.items
        : result.items.filter(i => i.urgency === urgencyFilter);

      return {
        hasItems: items.length > 0,
        message: result.message,
        items: items.map(i => ({
          productId: i.productId,
          handle: i.handle,
          title: i.title,
          imageUrl: i.imageUrl,
          urgency: i.urgency,
          daysUntilDue: i.daysUntilDue,
          purchasedDaysAgo: i.purchasedDaysAgo,
        })),
      };
    },
  };
}

// ─── Beauty brain context builder ────────────────────────────────────────────
// Extends BrainContext with beauty-specific fields for the prompt builder.

export async function buildBeautyBrainContext(
  shopperRowId: string | null,
  shopDomain: string,
): Promise<{
  skinType?: string;
  concerns?: SkinConcern[];
  depth?: string;
  undertone?: string;
  skinHex?: string;
  routinePreference?: string;
  savedRoutine?: {
    name: string;
    timeOfDay: string;
    stepCount: number;
    totalPriceUsd: number;
    stepSummary: string;
    savedAt: Date | null;
  };
}> {
  if (!shopperRowId) return {};

  // §3 invariant #1 — filter by shopifyDomain so a wrong shopperRowId cannot read
  // another shop's shopper profile. ShopperSession.id is globally unique in practice
  // but the architectural invariant requires explicit cross-tenant guard.
  const session = await prisma.shopperSession.findFirst({
    where: { id: shopperRowId, shopifyDomain: shopDomain },
    select: {
      skinTypeBeauty: true,
      skinConcernsJson: true,
      skinDepth: true,
      skinUndertone: true,
      skinHex: true,
      routinePreference: true,
      savedBeautyRoutineJson: true,
      skinRoutineSavedAt: true,
    },
  });

  if (!session) return {};

  // Summarise the saved routine for Mira's context (titles + steps) without
  // including the full payload — keeps the Brain context compact.
  let savedRoutine: {
    name: string;
    timeOfDay: string;
    stepCount: number;
    totalPriceUsd: number;
    stepSummary: string;
    savedAt: Date | null;
  } | undefined;

  if (session.savedBeautyRoutineJson) {
    const r = session.savedBeautyRoutineJson as {
      name?: string;
      timeOfDay?: string;
      steps?: Array<{ step: string; title: string }>;
      totalPriceUsd?: number;
    };
    const steps = r.steps ?? [];
    savedRoutine = {
      name: r.name ?? "Routine",
      timeOfDay: r.timeOfDay ?? "both",
      stepCount: steps.length,
      totalPriceUsd: r.totalPriceUsd ?? 0,
      // e.g. "Cleanse (Gentle Foam Cleanser), Moisturise (Hydra Cream), SPF (Sun Protect)"
      stepSummary: steps.map(s => `${s.step} (${s.title})`).join(", "),
      savedAt: session.skinRoutineSavedAt ?? null,
    };
  }

  return {
    skinType: session.skinTypeBeauty ?? undefined,
    concerns: (session.skinConcernsJson as SkinConcern[] | null) ?? undefined,
    depth: session.skinDepth ?? undefined,
    undertone: session.skinUndertone ?? undefined,
    skinHex: session.skinHex ?? undefined,
    routinePreference: session.routinePreference ?? undefined,
    savedRoutine,
  };
}

// ─── Ingredient trend analysis ───────────────────────────────────────────────
// Reads 90 days of CHAT_SEARCH_RUN events and counts mentions of ~40 common
// skincare ingredient keywords. Returns top 5 with trend direction and
// gapIngredients (queried but no matching product tag in the catalog).

export type IngredientTrend = {
  ingredient: string;
  count: number;
  trend: "rising" | "stable" | "falling";
  /** Count in the most-recent 30-day window */
  recent30: number;
  /** Count in the prior 30-day window (days 31–60) */
  prior30: number;
};

export type IngredientTrendsResult = {
  top5: IngredientTrend[];
  /** Ingredients queried but for which the catalog has no matching product tag */
  gapIngredients: string[];
};

const INGREDIENT_KEYWORDS: string[] = [
  "retinol",
  "niacinamide",
  "hyaluronic acid",
  "vitamin c",
  "aha",
  "bha",
  "ceramides",
  "peptides",
  "spf",
  "bakuchiol",
  "tranexamic acid",
  "salicylic acid",
  "glycolic acid",
  "lactic acid",
  "kojic acid",
  "azelaic acid",
  "squalane",
  "panthenol",
  "centella asiatica",
  "snail mucin",
  "resveratrol",
  "coq10",
  "zinc",
  "copper peptide",
  "vitamin e",
  "vitamin b5",
  "arbutin",
  "licorice root",
  "green tea",
  "ferulic acid",
  "mandelic acid",
  "phytic acid",
  "mugwort",
  "propolis",
  "adenosine",
  "allantoin",
  "sea buckthorn",
  "rosehip",
  "marula",
  "jojoba",
];

export async function extractIngredientTrends(shopId: string): Promise<IngredientTrendsResult> {
  const now = Date.now();
  const DAY = 86_400_000;
  const since90 = new Date(now - 90 * DAY);

  // Fetch last 90 days of CHAT_SEARCH_RUN events (capped at 5000 — ample for
  // beauty brands at pilot volume; revisit if a shop crosses ~50k/quarter)
  const searchEvents = await prisma.analyticsEvent.findMany({
    where: { shopId, name: "CHAT_SEARCH_RUN", createdAt: { gte: since90 } },
    select: { payload: true, createdAt: true },
    take: 5000,
    orderBy: { createdAt: "desc" },
  });

  // Split into windows
  const recent30Cutoff = new Date(now - 30 * DAY);
  const prior30Cutoff  = new Date(now - 60 * DAY);

  const countAll: Record<string, number>    = {};
  const countRecent: Record<string, number> = {};
  const countPrior: Record<string, number>  = {};

  for (const ev of searchEvents) {
    const query = ((ev.payload as { query?: string } | null)?.query ?? "").toLowerCase();
    if (!query) continue;

    for (const kw of INGREDIENT_KEYWORDS) {
      if (query.includes(kw)) {
        countAll[kw]    = (countAll[kw]    ?? 0) + 1;
        if (ev.createdAt >= recent30Cutoff) {
          countRecent[kw] = (countRecent[kw] ?? 0) + 1;
        } else if (ev.createdAt >= prior30Cutoff) {
          countPrior[kw]  = (countPrior[kw]  ?? 0) + 1;
        }
      }
    }
  }

  // Sort by total count, take top 5
  const top5: IngredientTrend[] = Object.entries(countAll)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ingredient, count]) => {
      const recent30 = countRecent[ingredient] ?? 0;
      const prior30  = countPrior[ingredient]  ?? 0;
      // Avoid division by zero: if prior30 === 0 treat as rising when there's recent volume
      let trend: IngredientTrend["trend"];
      if (prior30 === 0) {
        trend = recent30 > 0 ? "rising" : "stable";
      } else {
        const ratio = recent30 / prior30;
        trend = ratio >= 1.15 ? "rising" : ratio <= 0.85 ? "falling" : "stable";
      }
      return { ingredient, count, trend, recent30, prior30 };
    });

  // Gap detection: fetch all product tags for the shop (flattened)
  const products = await prisma.product.findMany({
    where: { shopId },
    select: { tags: true },
    take: 2000,
  });
  const allTagsLower = new Set<string>();
  for (const p of products) {
    for (const t of p.tags ?? []) {
      allTagsLower.add(t.toLowerCase());
    }
  }

  // An ingredient is a "gap" if it appears in the top-5 or in any event in the
  // window, but no product tag contains that keyword
  const queriedIngredients = Object.keys(countAll);
  const gapIngredients = queriedIngredients.filter((kw) => {
    const hasProduct = [...allTagsLower].some((tag) => tag.includes(kw));
    return !hasProduct;
  });

  return { top5, gapIngredients };
}

// ─── Brand-level beauty analytics queries ─────────────────────────────────────
// Called by dashboard.server.ts for the beauty merchant intelligence block.

export async function buildBeautyAnalyticsBlock(shopId: string) {
  // Shade gap requests — from catalog_gap events with shade-related queries
  const shadeGapCount = await prisma.catalogGap.count({
    where: {
      shopId,
      normalizedQuery: { contains: "shade" },
    },
  });

  // Resolve shopifyDomain for ShopperSession queries (which use domain, not shopId FK)
  const shopRow = await prisma.shop.findUnique({ where: { id: shopId }, select: { shopifyDomain: true } });
  const shopifyDomain = shopRow?.shopifyDomain ?? "__none__";

  // Concern trend — from ShopperSession skinConcernsJson
  const sessions = await prisma.shopperSession.findMany({
    where: { shopifyDomain, skinConcernsJson: { not: undefined } },
    select: { skinConcernsJson: true },
    take: 1000,
    orderBy: { createdAt: "desc" },
  });

  // Aggregate concern counts
  const concernCounts: Record<string, number> = {};
  for (const s of sessions) {
    const concerns = s.skinConcernsJson as string[] | null;
    for (const c of concerns ?? []) {
      concernCounts[c] = (concernCounts[c] ?? 0) + 1;
    }
  }

  // Replenishment — from fulfilled orders
  const recentPurchases = await prisma.analyticsEvent.findMany({
    where: {
      shopId,
      name: "CART_CONFIRMED",
      createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
    select: { payload: true, createdAt: true },
    take: 500,
  });

  // Build replenishment window signals
  let replenishmentDueSoon = 0;
  const now = Date.now();
  for (const event of recentPurchases) {
    const payload = event.payload as Record<string, unknown>;
    const category = (payload?.category as string | undefined) ?? "serum";
    const purchasedDaysAgo = Math.floor((now - event.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const window = estimateReplenishmentWindow(category, purchasedDaysAgo);
    if (window.daysUntilDue <= 14) replenishmentDueSoon++;
  }

  const ingredientTrends = await extractIngredientTrends(shopId);

  return {
    topConcerns: Object.entries(concernCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([concern, count]) => ({ concern, count })),
    replenishmentDueSoon,
    shadeGapCount,
    ingredientTrends,
  };
}
