// ─── Mira brain — request + decision schemas ────────────────────────────────
// Extracted verbatim from apps/web/app/api/mira/route.ts. Zod-only; no Product
// or demo-module dependency. The decision shape the LLM must return, and the
// request body the brain accepts (including the injectedCatalog/Brand/Currency
// seams that let one brain serve the demo AND every store).

import { z } from "zod";
import { ROUTES, CATEGORIES, FILTERS, INTENTS } from "./constants.js";

export const DecisionSchema = z.object({
  voice: z.string().min(1).max(600),
  route: z.enum(ROUTES),
  // Loosely-filled optional enums use .catch(undefined): if the model drifts to
  // a value outside the vocabulary, the FIELD drops, it never fails the whole
  // decision. (A single bad `intent:"suitability"` used to nuke the entire turn
  // to the regex fallback, see route validation bug, this session.)
  category: z.enum(CATEGORIES).optional().catch(undefined),
  filter: z.enum(FILTERS).optional().catch(undefined),
  productHandle: z.string().optional(),
  // P4-comparison: up to 3 handles for side-by-side cards (route="compare").
  compareHandles: z.array(z.string()).max(3).optional().catch(undefined),
  searchQuery: z.string().optional(),
  disagree: z.boolean().optional(),
  quickReplies: z.array(z.string().max(40)).max(4).optional().catch(undefined),
  // ─── Learning-loop fields (the moat) ───────────────────────────────────
  // What the shopper wanted, classified, feeds the brand intent histogram.
  intent: z.enum(INTENTS).optional().catch(undefined),
  // TRUE when the shopper asked for something the catalog genuinely can't
  // serve (a real demand we have no answer to). This is a catalog gap the
  // brand should act on, NOT a soft "maybe". Only set when honest.
  unmet: z.boolean().optional(),
  // A short brand-readable bucket for the gap: "footwear", "price<100",
  // "leather mini skirt", "plus sizing". Lowercase, reusable across shoppers.
  unmetCategory: z.string().max(60).optional(),
  // One human line the brand reads on the dashboard explaining the gap.
  unmetReason: z.string().max(160).optional(),
  // ─── Near-miss (the sharpest reorder hint) ──────────────────────────────
  // TRUE when you DID serve a close match but it was missing exactly ONE named
  // attribute the shopper wanted (cropped, in black, petite, sleeveless,
  // long-sleeve, higher-waisted). The brand already half-stocks this, so it's
  // a sharper signal than a hard gap. Do NOT set this when the match is exact,
  // and do NOT set it together with unmet.
  nearMiss: z.boolean().optional(),
  // The broader bucket you DID stock and serve from ("linen shirts", "midi
  // dresses"). Lowercase, reusable across shoppers.
  nearMissCategory: z.string().max(60).optional(),
  // The single missing attribute that wasn't exactly right ("cropped",
  // "in black", "petite"). One or two words.
  nearMissAttribute: z.string().max(40).optional(),
  // One human line the brand reads explaining the near-miss.
  nearMissReason: z.string().max(160).optional(),
});
export type MiraDecision = z.infer<typeof DecisionSchema>;

export const BodySchema = z.object({
  message: z.string().min(1).max(1500),
  currentProductHandle: z.string().max(120).nullable().optional(),
  history: z
    .array(z.object({ from: z.enum(["user", "mira"]), text: z.string().max(1200) }))
    .max(20)
    .optional(),
  shownHandles: z.array(z.string().max(120)).max(40).optional(),
  knownSize: z.string().max(8).nullable().optional(),
  // Body the shopper gave THIS session (from the size form / saved profile). When
  // present, Mira has measurements on file for EVERY piece — she never re-asks.
  bodyOnFile: z.object({
    heightCm: z.number(), weightKg: z.number(), fitPref: z.string().max(12),
    /** Age in years — BoldMatrix age correction (+0.7cm/decade waist after 30) */
    age: z.number().int().min(0).max(120).optional(),
    /** Usual brand size — strongest pre-measurement predictor */
    usualBrandSize: z.string().max(8).optional(),
  }).nullable().optional(),
  // ── Closing intelligence context (from client-side state) ─────────────────
  sizeConfirmed: z.boolean().optional(),
  tryOnCompleted: z.boolean().optional(),
  tryOnAbandoned: z.boolean().optional(),
  outfitAccepted: z.boolean().optional(),
  outfitPiecesRecommended: z.number().int().min(0).max(10).optional(),
  cartItemCount: z.number().int().min(0).optional(),
  // ── Active look context (serialised from active-look-memory) ─────────────
  activeLookSummary: z.string().max(400).nullable().optional(),
  // Try-on context, injected by the widget from tryon-context.ts so Mira knows
  // what happened in the fitting room without the shopper re-explaining.
  tryOnContextSummary: z.string().max(400).nullable().optional(),

  // ── CONSOLIDATION: one brain serves three callers ─────────────────────────
  // Demo (apps/web direct) → no injection, uses hardcoded 14-product catalog.
  // Production (mira-adapter forwarding from stylique-app) → injects merchant's
  // Prisma catalog + merchant knowledge so a real shopper on a real Shopify
  // store gets THIS brain's intelligence with THEIR products. Zero duplicate
  // brain code, zero prompt drift, ONE source of truth.
  injectedCatalog: z.array(z.any()).max(5000).optional(),
  injectedKnowledge: z.string().max(8000).optional(),
  // Merchant-specific brand identity, synthesized server-side in mira-adapter
  // from BrandProfile.toneJson + Shop.shopifyDomain + Plan.planFeaturesJson.stylist.
  // When absent (demo direct hit), Mira speaks as Stylique Maison.
  injectedBrand: z.object({
    name: z.string().max(120).optional(),
    intro: z.string().max(800).optional(),
    pov: z.string().max(1500).optional(),
    returns: z.string().max(800).optional(),
    shipping: z.string().max(800).optional(),
  }).optional(),
  // Audit P1: currency code (ISO 4217) so catalogDigest can prefix the right
  // symbol — PKR/INR/JPY stores see ₹/Rs/¥ instead of fictitious `$`.
  injectedCurrency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  // Phase 2 / P2-T01: the prior server-side SessionObjective (session-scoped),
  // injected by the caller so the brain reasons about where the shopper is, not
  // just the last message. The brain returns the UPDATED objective for the caller
  // to persist. Loose object — the brain casts it to SessionObjective.
  priorObjective: z.any().optional(),
});
export type MiraBody = z.infer<typeof BodySchema>;
