// ─── SaaS migration · Stage 1 — the Mira adapter ────────────────────────────
//
// Lets the REAL per-tenant brain (runChatTurn → recommends ONLY from each shop's
// synced Prisma catalog, never a hardcoded product list) speak the `MiraDecision`
// shape the storefront UI already understands. Crucially it ALSO returns the real,
// per-shop product data attached to the turn, so the widget renders genuine cards
// for THAT merchant — the whole point of "it's a SaaS, not a whitelabel".
//
// This is additive: it does not touch the demo path. Once the widget is repointed
// at the App Proxy (Stage 2) and consumes `products`/`look` (Stage 3), the
// storefront runs entirely on per-tenant data with zero hardcoded catalog.

import { prisma } from "../db.server";
import type { BrainClientAction, BrainCombo, BrainProduct } from "@stylique/ai";
import { canConsume, recordConsume } from "./entitlement.server";
import {
  appendChatTurns,
  buildShopperBrief,
  getOrCreateShopperSession,
} from "./session.server";

// SYSTEMIC FALLBACK — the brain's LLM sometimes replies without calling its
// search/combo tools (then brain.ts emits the "One sec…" placeholder with no
// products). Rather than ever show a productless turn, we pull real products for
// THIS shop straight from Prisma using the shopper's own words — keyword match
// first, then the shop's apparel as a floor. Works for every store, touches the
// production brain not at all.
// Format a price in the STORE'S OWN CURRENCY (panel P0: was hardcoded en-US/$).
// Uses Intl currency formatting so a GBP store reads "£145", a PKR store
// "Rs 14,500", a JPY store "¥14,500" — never a wrong symbol or locale. Most
// fashion prices are whole units, so we drop minor units for a clean read; falls
// back to a comma-grouped number if the currency code is somehow invalid.
function money(n: number | null | undefined, currency = "USD"): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const amount = Math.round(n);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return amount.toLocaleString("en-US");
  }
}

// Occasion / vibe → concrete garment + attribute tokens. Shoppers ask by
// OCCASION ("wedding", "dinner", "brunch") but products are titled by garment
// ("Cashmere V-Neck", "Wrap Coat"), so a raw keyword match finds nothing and the
// net used to fall back to the SAME "recent" products for every query (the
// panel's #1 shopper complaint: "same look every time"). Expanding the query with
// occasion-appropriate tokens makes the net return DIFFERENT, fitting products
// per intent.
const OCCASION_EXPANSION: Array<[RegExp, string[]]> = [
  [/\b(wedding|cocktail|gala|evening|formal|black.?tie|elegant|dressy|date night|night out)\b/, ["dress", "gown", "silk", "satin", "midi", "blazer", "heel", "slip"]],
  [/\b(dinner|date|restaurant|drinks)\b/, ["dress", "silk", "slip", "blazer", "trouser", "midi"]],
  [/\b(work|office|interview|professional|meeting|business)\b/, ["blazer", "trouser", "shirt", "tailored", "wool", "knit"]],
  [/\b(brunch|casual|weekend|relaxed|everyday|day|errand)\b/, ["knit", "tee", "linen", "trouser", "cardigan", "shirt"]],
  [/\b(winter|cold|cozy|warm|chilly|autumn|fall)\b/, ["coat", "wool", "cashmere", "knit", "sweater", "trench", "turtleneck"]],
  [/\b(summer|beach|hot|vacation|holiday|resort)\b/, ["linen", "dress", "cotton", "midi", "slip"]],
  [/\b(party|celebration|festive)\b/, ["dress", "silk", "satin", "sequin", "midi", "slip"]],
  // Modest / Islamic occasion wear
  [/\b(modest|hijab|abaya|eid|ramadan|conservative|covered|layered)\b/, ["coat", "blazer", "trench", "midi", "trouser", "knit", "abaya", "kurta"]],
  // ── South Asian / Desi ──────────────────────────────────────────────────────
  [/\b(shaadi|baraat|valima|dulhan|bride|bridal)\b/, ["lehenga", "bridal", "gharara", "sharara", "anarkali", "embroidered", "silk"]],
  [/\b(mehndi|mayun|diwali|sangeet|shalwar|kameez|lawn)\b/, ["lawn", "silk", "embroidered", "kurta", "kurti", "shalwar", "dupatta", "chiffon"]],
  [/\b(lehenga|lehnga|ghagra|choli|lengha)\b/, ["lehenga", "ghagra", "choli", "embroidered", "silk"]],
  [/\b(indo.?western|fusion|patiala|palazzo|anarkali)\b/, ["palazzo", "patiala", "anarkali", "ethnic", "fusion"]],
  // ── Western / streetwear / casual ───────────────────────────────────────────
  [/\b(denim|streetwear|street style)\b/, ["denim", "jeans", "tee", "hoodie", "casual"]],
  [/\b(western|cowboy|country|rodeo|boho|bohemian)\b/, ["western", "denim", "fringe", "boot", "floral", "boho"]],
  [/\b(athleisure|gym|yoga|sport|active|workout)\b/, ["activewear", "legging", "jogger", "athletic", "stretch"]],
  // ── Accessories ─────────────────────────────────────────────────────────────
  [/\b(bag|purse|handbag|tote|clutch|crossbody)\b/, ["bag", "purse", "leather", "tote", "clutch"]],
  [/\b(jewellery|jewelry|necklace|earring|ring|bracelet|bangle)\b/, ["jewellery", "gold", "silver", "necklace", "earring", "bangle"]],
  [/\b(scarf|dupatta|stole|shawl)\b/, ["scarf", "dupatta", "stole", "silk", "pashmina"]],
  [/\b(shoe|heel|flat|boot|sandal|sneaker|loafer|pump)\b/, ["shoes", "heels", "flats", "boots", "sandals", "footwear"]],
  // ── Special occasions ───────────────────────────────────────────────────────
  [/\b(prom|homecoming|red.?carpet|black.?tie)\b/, ["gown", "formal", "evening", "sequin", "embellished"]],
  [/\b(maternity|pregnant|bump)\b/, ["maternity", "stretchy", "comfortable", "nursing"]],
  [/\b(plus.?size|curvy|size (16|18|20|22|24|2xl|3xl|4xl|xxl))\b/, ["plus", "curvy", "inclusive", "extended"]],
  [/\b(nikah|walima)\b/, ["bridal", "wedding", "embroidered", "silk", "lehenga"]],
];

// When `strict`, the net does NOT fall back to "recent" products on a keyword
// miss — an empty result is an HONEST CATEGORY GAP (panel P0 #2). Used when the
// shopper REQUESTS a specific category (vs pairing/occasion styling), so "do you
// have sneakers?" returns nothing (→ honest absence) instead of papering over the
// gap with a slip dress.
async function searchShopCatalog(shopDomain: string, query: string, excludeHandle?: string | null, strict = false): Promise<AdaptedProduct[]> {
  const shop = await prisma.shop.findFirst({ where: { shopifyDomain: shopDomain }, select: { id: true } }).catch(() => null);
  if (!shop) return [];
  const lc = query.toLowerCase();
  const rawTokens = lc.split(/\s+/).filter((t) => t.length > 2).slice(0, 5);
  // Add occasion-derived garment tokens so an occasion query maps to real pieces.
  const expanded = OCCASION_EXPANSION.filter(([re]) => re.test(lc)).flatMap(([, words]) => words);
  const tokens = Array.from(new Set([...rawTokens, ...expanded])).slice(0, 12);
  const include = { images: { orderBy: { position: "asc" as const }, take: 1 }, variants: { select: { size: true, priceCents: true } } };
  // Drop obvious non-apparel noise (the dev store's leftover snowboard/gift-card demo data).
  const NOISE = ["snowboard", "gift card", "giftcard", "ski wax"];
  const notNoise = (title: string) => !NOISE.some((n) => title.toLowerCase().includes(n));

  let rows: Array<{ handle: string; title: string; category: string | null; primaryColor: string | null; images: { url: string }[]; variants: { size: string | null; priceCents: number | null }[] }> = [];
  // Bound every catalog query so a stalled Neon pooler (`Closed`, OI-49) can't hang
  // the whole adapter — it's awaited inline in the brain race, and the brain
  // AbortController does NOT cancel this Prisma promise (panel P1). On timeout we
  // fall back to an empty set (then the strict/recent logic below decides).
  const CATALOG_TIMEOUT_MS = 5000;
  const raceCatalog = (p: Promise<typeof rows>): Promise<typeof rows> =>
    Promise.race([
      p.catch(() => [] as typeof rows),
      new Promise<typeof rows>((res) => setTimeout(() => res([]), CATALOG_TIMEOUT_MS)),
    ]);
  if (tokens.length) {
    rows = await raceCatalog(prisma.product.findMany({
      where: { shopId: shop.id, OR: tokens.flatMap((t) => [
        { title: { contains: t, mode: "insensitive" as const } },
        { tags: { has: t } },
        { category: { contains: t, mode: "insensitive" as const } },
      ]) },
      take: 8, include,
    }) as Promise<typeof rows>);
  }
  // Keyword search that returns ONLY the current product (then excluded below) is
  // effectively empty — for "what goes with these trousers" we want the REST of
  // the apparel, not nothing. So fall through to recent whenever the usable set
  // (after excluding the current handle + noise) is empty.
  const usable = (rs: typeof rows) => rs.filter((r) => r.handle !== excludeHandle && notNoise(r.title));
  // In strict mode a keyword miss is a real gap — return nothing rather than
  // recent products (which would paper over the absence).
  if (!strict && usable(rows).length === 0) {
    rows = await raceCatalog(prisma.product.findMany({ where: { shopId: shop.id }, take: 12, orderBy: { updatedAt: "desc" }, include }) as Promise<typeof rows>);
  }
  const cleaned = rows.filter((r) => r.handle !== excludeHandle && notNoise(r.title));
  // Prefer products that actually have an image — an imageless card reads as a
  // broken demo on a visual-first purchase (panel rec #3). Keep imageless ones
  // only as a backfill so we never return an empty set.
  const withImg = cleaned.filter((r) => !!r.images[0]?.url);
  const ordered = [...withImg, ...cleaned.filter((r) => !r.images[0]?.url)];
  return ordered
    .slice(0, 6)
    .map((r) => {
      const prices = r.variants.map((v) => v.priceCents).filter((c): c is number => typeof c === "number" && c > 0);
      return {
        handle: r.handle,
        name: r.title,
        category: r.category ?? null,
        priceUsd: prices.length ? Math.round(Math.min(...prices) / 100) : null,
        image: r.images[0]?.url ?? null,
        sizes: r.variants.map((v) => v.size).filter((s): s is string => !!s),
        colors: r.primaryColor ? [r.primaryColor] : [],
      };
    });
}

type MiraRoute =
  | "reco_category" | "reco_handle" | "reco_filter" | "navigate" | "look"
  | "fit" | "fabric" | "suitability" | "size_form" | "try_on" | "returns"
  | "add_to_cart" | "studio" | "search" | "compare" | "talk_only";

export type AdaptedProduct = {
  id?: string;
  handle: string;
  name: string;
  category: string | null;
  priceUsd: number | null;
  image: string | null;
  sizes: string[];
  colors: string[];
};

// ─── Styled-look builder (panel rec #4 at the floor) ─────────────────────────
// The brain's combo intelligence is intermittent; the net used to return a flat
// grab-bag of products. This turns that grab-bag into a SLOT-AWARE styled look
// (one anchor + complementary pieces from DIFFERENT slots — never two bottoms),
// season/occasion-filtered, with a real one-line stylist rationale — so even on
// a brain dead-end / 429 the shopper gets a genuine "look", not a pile.
type Slot = "dress" | "top" | "bottom" | "outerwear" | "footwear" | "accessory";

function slotOf(p: AdaptedProduct): Slot {
  const s = `${p.name} ${p.category ?? ""}`.toLowerCase();
  // Desi full-garments: lehenga/gharara/sharara/anarkali are complete looks
  if (/(lehenga|lehnga|gharara|sharara|anarkali|abaya|kaftan|maxi dress|jumpsuit|saree|sari|gown|dress|slip|dungaree)/.test(s)) return "dress";
  if (/(coat|blazer|jacket|trench|cardigan|overcoat|parka|shrug|bolero|cape|koti|waistcoat)/.test(s)) return "outerwear";
  if (/(trouser|pant|jean|skirt|short|legging|culotte|palazzo|patiala|salwar|shalwar|churidar|sharara bottom|dhoti|culottes)/.test(s)) return "bottom";
  if (/(shoe|heel|boot|sneaker|flat|loafer|sandal|pump|mule|chappal|khussa|jutii|juttis|kolhapuri)/.test(s)) return "footwear";
  if (/(bag|belt|scarf|dupatta|stole|jewel|necklace|earring|maang tikka|tikka|jhumka|bangle|bracelet|ring|hat|clutch|tote|accessor|sunglass|glove|watch|potli|mang tikka)/.test(s)) return "accessory";
  // Desi tops: kurti/kurta/choli/blouse/kameez/tunic
  return "top"; // shirt/top/tee/knit/kurta/kurti/kameez/blouse/choli/cami/etc
}

// Drop season-wrong anchors (panel rec #11): no wool/cashmere for a summer brief,
// no pure-linen sundress for a deep-winter brief. Returns true to KEEP.
function seasonOk(p: AdaptedProduct, query: string): boolean {
  const q = query.toLowerCase();
  const s = `${p.name} ${p.category ?? ""}`.toLowerCase();
  const summer = /\b(summer|beach|hot|vacation|resort)\b/.test(q);
  const winter = /\b(winter|cold|freezing|snow|deep.?cold)\b/.test(q);
  if (summer && /(wool|cashmere|heavy knit|fleece|shearling|parka|puffer)/.test(s)) return false;
  if (winter && /(linen sundress|swim|bikini|tank)/.test(s)) return false;
  return true;
}

function occasionTitle(query: string): string {
  const q = query.toLowerCase();
  // Desi/South Asian occasions
  if (/\b(shaadi|baraat|valima|dulhan|bridal nikah|walima)\b/.test(q)) return "The Bridal Edit";
  if (/\b(mehndi|mayun|haldi|diwali|eid|sangeet)\b/.test(q)) return "Festive Season";
  if (/\b(lehenga|shalwar|kameez|lawn)\b/.test(q)) return "Desi Chic";
  if (/\b(indo.?western|fusion)\b/.test(q)) return "Indo-Western Fusion";
  // Western occasions
  if (/\bwedding\b/.test(q)) return "Wedding Guest";
  if (/\b(dinner|date)\b/.test(q)) return "Dinner Look";
  if (/\b(work|office|interview|meeting)\b/.test(q)) return "The Office Edit";
  if (/\b(brunch|weekend|casual|relaxed)\b/.test(q)) return "Weekend Ease";
  if (/\b(party|cocktail|gala|night out)\b/.test(q)) return "Evening Out";
  if (/\b(winter|cold|cozy)\b/.test(q)) return "Cold-Weather Layers";
  if (/\b(summer|beach|vacation)\b/.test(q)) return "Warm-Weather Look";
  if (/\b(gym|workout|sport|active|athleisure)\b/.test(q)) return "Active Edit";
  if (/\b(accessory|bag|jewel|scarf|dupatta)\b/.test(q)) return "The Accessories Edit";
  return "Your Look";
}

// Pick a slot-coherent set of up to 3 from the candidate products.
function buildStyledLook(
  products: AdaptedProduct[],
  query: string,
): { title: string; reasoning: string; pieces: AdaptedProduct[] } | null {
  const cand = products.filter((p) => seasonOk(p, query));
  if (cand.length < 2) return null;
  const bySlot = new Map<Slot, AdaptedProduct[]>();
  for (const p of cand) {
    const sl = slotOf(p);
    (bySlot.get(sl) ?? bySlot.set(sl, []).get(sl)!).push(p);
  }
  const take = (sl: Slot) => bySlot.get(sl)?.[0];
  const pieces: AdaptedProduct[] = [];
  const dress = take("dress");
  if (dress) {
    pieces.push(dress);
    const layer = take("outerwear"); if (layer) pieces.push(layer);
    const acc = take("footwear") ?? take("accessory"); if (acc) pieces.push(acc);
  } else {
    const top = take("top"); const bottom = take("bottom");
    if (top) pieces.push(top);
    if (bottom) pieces.push(bottom);
    const layer = take("outerwear"); if (layer && pieces.length < 3) pieces.push(layer);
    if (pieces.length < 2) { const extra = take("footwear") ?? take("accessory"); if (extra) pieces.push(extra); }
  }
  if (pieces.length < 2) return null;

  const names = pieces.map((p) => p.name);
  const anchor = names[0];
  const occasion = /\bwedding\b/i.test(query) ? "a wedding"
    : /\bdinner|date\b/i.test(query) ? "dinner"
    : /\bwork|office|interview\b/i.test(query) ? "the office"
    : /\bbrunch|weekend|casual\b/i.test(query) ? "an easy weekend"
    : "the occasion";
  const reasoning =
    pieces.length >= 3
      ? `The ${anchor} anchors it, the ${names[1]} balances the silhouette, and the ${names[2]} finishes the look — pulled together for ${occasion}.`
      : `The ${anchor} anchors the look — ${occasion === "a wedding" ? "elegant and occasion-ready" : occasion === "dinner" ? "polished for the evening" : "a considered pairing"} with the ${names[1]}.`;
  return { title: occasionTitle(query), reasoning, pieces };
}

export type MiraAdapterResult = {
  source: "brain";
  decision: {
    voice: string;
    route: MiraRoute;
    productHandle: string | null;
    quickReplies: string[];
    intent: string;
    // P4-comparison: up to 3 handles to render side-by-side cards.
    compareHandles?: string[];
  };
  // Real per-shop products surfaced this turn (from the brain's combo). The UI
  // renders these instead of looking a handle up in a hardcoded catalog. On a
  // compare turn this carries the 2-3 compared pieces resolved against the
  // shop's catalog (in the order the brain named them).
  products: AdaptedProduct[];
  look: { title: string; reasoning: string; pieces: AdaptedProduct[] } | null;
  objective?: unknown;
};

function toProduct(p: BrainProduct): AdaptedProduct {
  // BrainProduct (as carried on a combo) is the lean serialized shape: handle,
  // title, category, primaryColor, imageUrl, sizes. Price is resolved by the UI
  // via GET api/product?handle= when it needs the exact number (Stage 3) — we do
  // NOT invent it here.
  const anyP = p as unknown as { priceRange?: { min: number } | null };
  return {
    handle: p.handle,
    name: p.title,
    category: p.category ?? null,
    priceUsd: anyP.priceRange ? Math.round(anyP.priceRange.min / 100) : null,
    image: p.imageUrl ?? null,
    sizes: p.sizes ?? [],
    colors: p.primaryColor ? [p.primaryColor] : [],
  };
}

// Map the brain's post-turn client actions to the single grounded route the UI
// executes. Order matters: the most "committing" action wins.
function routeFromActions(actions: BrainClientAction[], hasCombo: boolean): { route: MiraRoute; handle: string | null } {
  for (const a of actions) {
    switch (a.kind) {
      case "navigate":      return { route: "navigate", handle: a.handle };
      case "lead_browse":   return { route: "navigate", handle: a.handle };
      case "open_tryon":    return { route: "try_on", handle: null };
      case "show_size_recommendation":
      case "collect_fit_for_sizing":  return { route: "size_form", handle: null };
      case "add_to_cart_request":
      case "add_outfit_to_cart":      return { route: "add_to_cart", handle: null };
      case "guide_combo_walkthrough": return { route: "look", handle: null };
      default: break;
    }
  }
  return { route: hasCombo ? "look" : "talk_only", handle: null };
}

// The brain doesn't emit quick-reply chips; synthesise sensible ones per route so
// the UI's chip affordance keeps working.
function chipsFor(route: MiraRoute): string[] {
  // Route-keyed chips with an ESCAPE chip always present (panel rec #10) so the
  // shopper is never cornered — "Show me another" / "Something else" rotates them
  // to a fresh option instead of dead-ending.
  switch (route) {
    case "navigate":
    case "reco_handle": return ["Size this one", "What goes with it?", "Show me another"];
    case "look":        return ["Add the look", "Swap a piece", "Show me another"];
    case "size_form":   return ["What's my size?", "See it on me", "Something else"];
    case "try_on":      return ["See it on me", "Pick a model", "Something else"];
    case "add_to_cart": return ["Go to checkout", "Complete the look", "Keep looking"];
    default:            return ["For an occasion", "Everyday", "Just browsing"];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSOLIDATED runMiraAdapter — ONE BRAIN, three callers (apps/web demo,
// stylique-app /api/demo/mira, storefront proxy). All paths now run the
// SAME brain code at apps/web/app/api/mira/route.ts.
//
// What this does:
//   1. Load merchant's Prisma catalog (top ~80 products)
//   2. Transform to the demo brain's Product shape
//   3. POST to MIRA_DEMO_BRAIN_URL (= apps/web /api/mira) with
//      injectedCatalog + injectedKnowledge
//   4. Map response back to MiraAdapterResult shape the storefront expects
//
// No more 568 lines of brain logic duplication. No more drift. ONE truth.
// ═══════════════════════════════════════════════════════════════════════════

// Audit P0 (this session): there used to be TWO default brain origins drifting
// between the proxy route and this adapter (`stylique-web.up.railway.app` vs
// `stylique-web-production.up.railway.app/api/mira`) — depending on whether
// MIRA_DEMO_BRAIN_URL was set, conversions and chat could hit different
// hosts. Now: one canonical env (`MIRA_BRAIN_ORIGIN`, origin only) with
// MIRA_DEMO_BRAIN_URL retained as a backward-compatible alias that gets
// normalized to origin. Both this adapter and proxy.shopper.$.tsx read from
// the same shared resolver.
function resolveBrainOrigin(): string {
  const raw =
    process.env.MIRA_BRAIN_ORIGIN ??
    process.env.MIRA_DEMO_BRAIN_URL ??
    // CANONICAL working host. The bare `stylique-web.up.railway.app` domain is
    // a STALE/dangling deploy (verified: /api/mira returns route=undefined,
    // homepage 404) — defaulting to it meant production Mira silently broke
    // whenever the env override was unset. `-production` is the live service
    // (route=navigate, homepage 200). Now correct WITHOUT depending on the env.
    "https://stylique-web-production.up.railway.app";
  // Strip any trailing /api/mira or trailing slash so callers can safely append.
  return raw.replace(/\/api\/mira\/?$/, "").replace(/\/+$/, "");
}
export const MIRA_BRAIN_ORIGIN = resolveBrainOrigin();
const UNIFIED_BRAIN_URL = `${MIRA_BRAIN_ORIGIN}/api/mira`;

/**
 * Load the merchant's full catalog from Prisma + EVERY signal the platform's
 * auto-sync / size-chart / image-quality / brand-DNA pipelines have already
 * extracted, and project it into the demo brain's `Product` shape. Nothing
 * here invents data — it just plumbs what we already extracted into the
 * brain's prompt + decision surfaces.
 *
 *   - `descriptionHtml` → fitNotes (sanitised, capped at 240 chars)
 *   - `sizeChartJson` (D37 multi-source extractor) → sizeChart
 *   - `ProductVariant.measurementsJson` (D39 per-variant) → richest sizeChart row
 *   - `ProductVariant.inventoryQuantity` + `availableForSale` → inStockSizes
 *   - `primaryColor` + `colorFamily` + variant colors → colors (deduped)
 *   - `primaryTryonImageId` → preferred image when set, falls back to position:0
 *   - `tags` + `productType` + `vendor` → tags (visible to model for matching)
 *   - `category` (from Shopify productType or our normaliser) → category
 */
// ── Per-shop catalog cache (B1 fix) ────────────────────────────────────────
// At 100 concurrent users every chat turn used to do a fresh 80-row Product
// join with variants + images. That melts the DB at any real scale. Cache
// per-shop with a 5-minute TTL. Invalidated on catalog-sync webhook fan-out;
// for now TTL is the freshness floor.
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const catalogCache = new Map<string, { catalog: unknown[]; ts: number; currency: string }>();

async function loadMerchantCatalog(shopDomain: string): Promise<{ catalog: unknown[]; currency: string }> {
  const cached = catalogCache.get(shopDomain);
  if (cached && Date.now() - cached.ts < CATALOG_CACHE_TTL_MS) {
    return { catalog: cached.catalog, currency: cached.currency };
  }
  try {
    // MED — Prisma query timeout. A stalled Neon pooler shouldn't stall the
    // whole chat turn. 5s is the realistic ceiling; beyond that we serve from
    // (empty) cache and Mira falls through to the generic talk path.
    const tx = <T>(p: Promise<T>, ms = 5000): Promise<T> => Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error("prisma_timeout")), ms)),
    ]);
    const shop = await tx(prisma.shop.findFirst({
      where: { shopifyDomain: shopDomain },
      select: { id: true, currencyCode: true },
    }));
    if (!shop) return { catalog: [], currency: "USD" };
    const currency = shop.currencyCode ?? "USD";
    // MED — prompt size cap. Cap at 80 products even when shop has 100k+.
    // Ranked by updatedAt desc so the freshest pieces win the slot.
    // Future: rank by recent CHAT_PRODUCT_CLICKED + view signals.
    const rows = await tx(prisma.product.findMany({
      where: { shopId: shop.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        handle: true,
        title: true,
        category: true,
        productType: true,
        vendor: true,
        tags: true,
        descriptionHtml: true,
        primaryColor: true,
        colorFamily: true,
        primaryTryonImageId: true,
        tryonReady: true,
        widgetTier: true,
        sizeChartJson: true,
        sizeChartSource: true,
        variants: {
          select: {
            size: true, color: true, priceCents: true,
            inventoryQuantity: true, availableForSale: true,
            measurementsJson: true,
          },
          take: 50,
        },
        images: {
          select: { id: true, url: true, role: true, position: true, qualityScore: true },
          orderBy: { position: "asc" },
          take: 8,
        },
      },
      take: 80,
    }));

    const stripHtml = (s: string | null) =>
      (s ?? "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);

    const projected = rows.map((p) => {
      // Colours: primary + family + every variant colour, deduped, lowercased
      const colorSet = new Set<string>();
      if (p.primaryColor) colorSet.add(p.primaryColor);
      if (p.colorFamily) colorSet.add(p.colorFamily);
      for (const v of p.variants) if (v.color) colorSet.add(v.color);
      const colors = Array.from(colorSet);

      // Sizes: every variant size, deduped (order preserved as first-seen)
      const sizes = Array.from(new Set(p.variants.map((v) => v.size).filter((s): s is string => !!s)));

      // In-stock sizes — combine inventoryQuantity > 0 OR availableForSale=true.
      // NULL inventory means "unknown → trust availableForSale" (D46 invariant).
      const inStockSizes = Array.from(new Set(
        p.variants
          .filter((v) => {
            if (v.inventoryQuantity != null) return v.inventoryQuantity > 0;
            return v.availableForSale !== false;
          })
          .map((v) => v.size)
          .filter((s): s is string => !!s),
      ));

      // Price: minimum variant price
      const prices = p.variants.map((v) => v.priceCents ?? Infinity).filter((c) => Number.isFinite(c));
      const minPrice = prices.length ? Math.min(...prices) : 0;

      // Image: prefer primaryTryonImageId (image-quality scored), else position:0
      const primaryImage =
        p.images.find((i) => i.id === p.primaryTryonImageId)?.url
        ?? p.images[0]?.url
        ?? null;
      const imageUrls = p.images.map((i) => i.url);

      // Tags — surface productType + vendor + tags so the model can match
      // intent against the merchant's actual taxonomy.
      const tags = [
        ...(p.tags ?? []),
        ...(p.productType ? [p.productType] : []),
        ...(p.vendor ? [p.vendor] : []),
      ].slice(0, 12);

      const desc = stripHtml(p.descriptionHtml);

      return {
        id: p.id,
        handle: p.handle,
        name: p.title,
        category: p.category ?? p.productType ?? "top",
        collection: p.productType ?? "main",
        priceUsd: Math.round(minPrice / 100),
        colors,
        sizes,
        inStockSizes,
        fitNotes: desc,
        fabricComposition: "",
        careInstructions: "",
        images: primaryImage ? [primaryImage, ...imageUrls.filter((u) => u !== primaryImage)] : imageUrls,
        sizeChart: p.sizeChartJson ?? undefined,
        description: desc,
        tags,
        tryonReady: p.tryonReady,
        widgetTier: p.widgetTier,
        sizeChartSource: p.sizeChartSource,
      };
    });
    catalogCache.set(shopDomain, { catalog: projected, ts: Date.now(), currency });
    return { catalog: projected, currency };
  } catch (e) {
    console.error("[mira-adapter] loadMerchantCatalog failed", e);
    return { catalog: [], currency: "USD" };
  }
}

/** Invalidate the catalog cache for a shop (call from catalog-sync worker after a sync completes). */
export function invalidateCatalogCache(shopDomain: string): void {
  catalogCache.delete(shopDomain);
}

/**
 * Build the merchant's brand identity block for the prompt — synthesised from
 * BrandProfile.toneJson + Shop name + Plan.planFeaturesJson.stylist (when
 * present). This REPLACES the demo's hardcoded "Stylique Maison" block so
 * Mira speaks the merchant's brand on a real install.
 */
async function loadMerchantBrand(shopDomain: string): Promise<Record<string, string> | undefined> {
  try {
    const shop = await prisma.shop.findFirst({
      where: { shopifyDomain: shopDomain },
      select: {
        id: true,
        currencyCode: true,
      },
    });
    if (!shop) return undefined;

    const brandRow = await prisma.brandProfile.findUnique({
      where: { shopId: shop.id },
      select: { paletteJson: true, toneJson: true },
    });
    const planRow = await prisma.plan.findUnique({
      where: { shopId: shop.id },
      select: { planFeaturesJson: true },
    });

    // Pretty-name the shop: stylee.myshopify.com → "Stylee"
    const fromDomain = shopDomain.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const stylistCfg = (planRow?.planFeaturesJson as { stylist?: { stylistName?: string; brandName?: string; voice?: string } } | null)?.stylist ?? {};
    const brandName = stylistCfg.brandName ?? fromDomain;
    const stylistName = stylistCfg.stylistName ?? "Mira";

    // BrandProfile.toneJson typically: { pricePositioning, dominantFabrics, dominantColors, seasonality, formality, vibeWords[] }
    const tone = (brandRow?.toneJson ?? {}) as Record<string, unknown>;
    const palette = (brandRow?.paletteJson ?? {}) as Record<string, unknown>;
    const fabrics = Array.isArray(tone.dominantFabrics) ? (tone.dominantFabrics as string[]).slice(0, 5).join(", ") : "";
    const palettew = Array.isArray(palette.dominantColors) ? (palette.dominantColors as string[]).slice(0, 5).join(", ") : "";
    const vibe = Array.isArray(tone.vibeWords) ? (tone.vibeWords as string[]).slice(0, 4).join(", ") : "";
    const positioning = typeof tone.pricePositioning === "string" ? tone.pricePositioning : "";

    const povPieces: string[] = [];
    povPieces.push(`THE BRAND YOU WORK FOR, know it, speak from it. ${brandName} is the store you sell for.`);
    if (positioning) povPieces.push(`Positioning: ${positioning}.`);
    if (fabrics) povPieces.push(`Dominant fabrics in the catalog: ${fabrics}.`);
    if (palettew) povPieces.push(`Brand palette signals: ${palettew}.`);
    if (vibe) povPieces.push(`Vibe words from brand DNA: ${vibe}.`);
    povPieces.push(`Sell from THIS catalog — every claim must trace back to a real product line, color, fabric, or size from the catalog list below. NEVER invent a brand fact, fabric, origin, or product that isn't visible in the catalog.`);
    povPieces.push(`When a shopper asks what the brand is about, answer with the POV signals above in plain words, never a marketing slogan.`);

    return {
      name: brandName,
      intro: `You are ${stylistName}, a warm, sharp shop assistant at ${brandName}. Picture the best salesperson in a real store: she walks over, sees what you're looking at, asks one good question, then takes you straight to the right thing. You lead. You don't wait. You're never robotic.`,
      pov: povPieces.join(" "),
      // Returns + shipping fall through to demo defaults until a merchant
      // configures their policy in admin (Plan.planFeaturesJson.policy).
    };
  } catch (e) {
    console.error("[mira-adapter] loadMerchantBrand failed", e);
    return undefined;
  }
}

export function decisionToAdapter(
  decision: {
    voice?: string;
    route?: string;
    productHandle?: string;
    quickReplies?: string[];
    intent?: string;
    compareHandles?: string[];
  } | null,
  fallbackVoice: string,
  activeCatalog: AdaptedProduct[] = [],
  context: {
    currentProductHandle?: string | null;
    shopperQuery?: string;
  } = {},
): MiraAdapterResult {
  if (!decision) {
    return {
      source: "brain",
      decision: { voice: fallbackVoice, route: "talk_only", productHandle: null, quickReplies: ["Show me one", "Build a look", "Size me"], intent: "other" },
      products: [],
      look: null,
    };
  }
  // Resolve every product-bearing route against this tenant's catalog. The old
  // adapter only hydrated `compare`, so Mira could correctly name a merchant
  // product while the widget received no card and fell back to demo inventory.
  let products: AdaptedProduct[] = [];
  let route = (decision.route as MiraRoute) ?? "talk_only";
  const requestedHandle = decision.productHandle ?? context.currentProductHandle ?? null;
  const resolvedProduct = requestedHandle
    ? activeCatalog.find((p) => p.handle === requestedHandle)
    : undefined;
  let look: MiraAdapterResult["look"] = null;

  if (route === "compare" && decision.compareHandles?.length && activeCatalog.length) {
    products = decision.compareHandles
      .map((h) => activeCatalog.find((p) => p.handle === h))
      .filter((p): p is AdaptedProduct => p != null)
      .slice(0, 3);
  } else if (route === "look" && activeCatalog.length) {
    const anchor = resolvedProduct ?? activeCatalog[0];
    const ordered = anchor
      ? [anchor, ...activeCatalog.filter((p) => p.handle !== anchor.handle)]
      : activeCatalog;
    look = buildStyledLook(ordered, context.shopperQuery ?? "");
    products = look?.pieces ?? (anchor ? [anchor] : []);
  } else if (resolvedProduct) {
    products = [resolvedProduct];
  } else if (["reco_category", "reco_filter", "search"].includes(route)) {
    // These routes let the client choose from a category/filter. Give it a
    // bounded tenant catalog to choose from; never make it consult demo data.
    products = activeCatalog.slice(0, 12);
  }

  const requiresProduct = new Set<MiraRoute>([
    "reco_handle", "navigate", "look", "fit", "fabric", "suitability",
    "size_form", "try_on", "add_to_cart",
  ]);
  if (requiresProduct.has(route) && products.length === 0) {
    route = "talk_only";
  }

  const groundedHandle = products[0]?.handle ?? null;
  return {
    source: "brain",
    decision: {
      voice: decision.voice ?? fallbackVoice,
      route,
      productHandle: route === "talk_only" ? null : groundedHandle,
      quickReplies: decision.quickReplies ?? [],
      intent: decision.intent ?? "other",
      compareHandles: decision.compareHandles,
    },
    products,
    look,
  };
}

export async function runMiraAdapter(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
  acceptLanguage: string | null;
}): Promise<{ result: MiraAdapterResult; setCookie?: string | null }> {
  // Translate the production request shape {messages[], currentProductHandle}
  // into the unified demo brain's shape {message, currentProductHandle, history}.
  const b = (args.body ?? {}) as {
    message?: string;
    messages?: Array<{ role?: string; text?: string }>;
    currentProductHandle?: string | null;
    history?: Array<{ from?: string; text?: string }>;
    shownHandles?: string[];
    knownSize?: string | null;
    bodyOnFile?: {
      heightCm: number;
      weightKg: number;
      fitPref: string;
      age?: number;
      usualBrandSize?: string;
    } | null;
    sizeConfirmed?: boolean;
    tryOnCompleted?: boolean;
    tryOnAbandoned?: boolean;
    outfitAccepted?: boolean;
    outfitPiecesRecommended?: number;
    cartItemCount?: number;
    activeLookSummary?: string | null;
    tryOnContextSummary?: string | null;
    priorObjective?: unknown;
  };
  const messages = b.messages ?? [];
  const lastUserMsg = b.message ?? [...messages].reverse().find((m) => m?.role === "user")?.text ?? "";
  const priorTurns = b.history ?? messages.slice(0, -1).map((m) => ({
    from: m.role === "model" ? "mira" : "user",
    text: (m.text ?? "").slice(0, 1200),
  }));

  // Load merchant catalog + brand identity so the brain speaks the merchant's
  // brand on the merchant's catalog — not "Stylique Maison" on demo products.
  // These run in parallel — both are pure Prisma reads, no LLM cost.
  // Catalog is cached 5min/shop to survive 100+ concurrent chat turns (B1 fix).
  const shopperSession = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  const [{ catalog: injectedCatalog, currency }, brandRaw, shopperBrief, shopperMemory] = await Promise.all([
    loadMerchantCatalog(args.shopDomain),
    loadMerchantBrand(args.shopDomain),
    buildShopperBrief(shopperSession.row.id),
    prisma.shopperSession.findUnique({
      where: { id: shopperSession.row.id },
      select: {
        heightCm: true,
        weightKg: true,
        fitPreference: true,
        fits: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { recommendedSize: true },
        },
      },
    }),
  ]);

  // ── Currency directive (B5) ────────────────────────────────────────────────
  const currencyClause = currency && currency !== "USD"
    ? ` All prices in the catalog above are in ${currency}. When you state a price, ALWAYS say "${currency} {amount}" — never "$" or "USD" unless USD is the actual currency.`
    : "";

  // ── Locale / region clause (H3 fix) ───────────────────────────────────────
  // Map Accept-Language top tag → climate + greeting hints so Mira mirrors
  // the shopper's region in voice without inventing facts. en-IN → "India",
  // de-DE → "Germany", pt-BR → "Brazil", etc. Empty when no signal.
  function localeRegion(al: string | null | undefined): string {
    if (!al) return "";
    const top = al.split(",")[0]?.trim() ?? "";
    const tag = top.split(";")[0]?.trim().toLowerCase();
    const region: Record<string, string> = {
      "en-in": "India", "hi-in": "India", "en-pk": "Pakistan", "ur-pk": "Pakistan",
      "en-gb": "the UK", "en-au": "Australia", "en-nz": "New Zealand", "en-ca": "Canada", "fr-ca": "Quebec",
      "de-de": "Germany", "de-at": "Austria", "de-ch": "Switzerland",
      "fr-fr": "France", "fr-ch": "Switzerland", "fr-be": "Belgium",
      "es-es": "Spain", "es-mx": "Mexico", "es-ar": "Argentina", "es-co": "Colombia",
      "pt-br": "Brazil", "pt-pt": "Portugal",
      "it-it": "Italy", "nl-nl": "Netherlands", "nl-be": "Belgium",
      "sv-se": "Sweden", "no-no": "Norway", "da-dk": "Denmark", "fi-fi": "Finland",
      "ja-jp": "Japan", "ko-kr": "South Korea",
      "zh-cn": "China", "zh-tw": "Taiwan", "zh-hk": "Hong Kong",
      "ar-ae": "the UAE", "ar-sa": "Saudi Arabia", "tr-tr": "Turkey",
      "ru-ru": "Russia", "th-th": "Thailand", "id-id": "Indonesia", "vi-vn": "Vietnam",
    };
    const r = region[tag] ?? region[tag.split("-")[0]];
    return r ? ` Shopper region (from Accept-Language ${tag}): ${r}. Mirror their region in plain words when relevant ("right, ${r} weather"/"shipping to ${r}"/etc.), but NEVER invent a delivery date or climate fact you weren't told.` : "";
  }
  const localeClause = localeRegion(args.acceptLanguage);

  const injectedBrand = (brandRaw || currencyClause || localeClause) ? {
    ...(brandRaw ?? {}),
    pov: ((brandRaw?.pov) ?? "") + currencyClause + localeClause,
  } : undefined;

  const reqBody = {
    message: lastUserMsg,
    currentProductHandle: b.currentProductHandle ?? null,
    history: priorTurns,
    shownHandles: b.shownHandles ?? [],
    injectedCatalog,
    injectedBrand,
    knownSize: b.knownSize ?? shopperMemory?.fits[0]?.recommendedSize ?? null,
    bodyOnFile: b.bodyOnFile ?? (
      shopperMemory?.heightCm && shopperMemory.weightKg
        ? {
            heightCm: shopperMemory.heightCm,
            weightKg: shopperMemory.weightKg,
            fitPref: shopperMemory.fitPreference?.toLowerCase() ?? "regular",
          }
        : null
    ),
    sizeConfirmed: b.sizeConfirmed,
    tryOnCompleted: b.tryOnCompleted,
    tryOnAbandoned: b.tryOnAbandoned,
    outfitAccepted: b.outfitAccepted,
    outfitPiecesRecommended: b.outfitPiecesRecommended,
    cartItemCount: b.cartItemCount,
    activeLookSummary: b.activeLookSummary,
    tryOnContextSummary: b.tryOnContextSummary,
    priorObjective: b.priorObjective,
    injectedKnowledge: shopperBrief.brief
      ? `SAVED SHOPPER CONTEXT:\n${shopperBrief.brief}`
      : undefined,
    // Audit P1: pass the ISO currency through so the brain prefixes prices with
    // the correct symbol (PKR/INR/JPY no longer get a fictitious `$`).
    injectedCurrency: currency,
    // injectedKnowledge: per-merchant teach-Mira facts (future feature; empty
    // for now — when a merchant has a knowledge feature, plumb here).
  };

  // ─── P1: STYLIST_TURN metering ──────────────────────────────────────────
  // Per-shop monthly cap on Mira chat turns. STARTER 1000 / GROWTH 15000 /
  // ULTIMATE unlimited (PLAN_FEATURES.stylist.monthlyTurns). When a shop
  // exceeds its cap we DON'T 500 the storefront — we serve a graceful
  // "quota reached" voice line and skip the LLM call. Founder gate:
  // BILLING_ENFORCED env (default off pre-launch); when off, we count usage
  // but never deny, so dashboards still track real volume without breaking
  // pilot brands. Shop resolution is one tiny indexed query — caches NOT
  // applied here because the count is already cheap and per-shop billing
  // accuracy must be exact.
  const shopRow = await prisma.shop
    .findFirst({ where: { shopifyDomain: args.shopDomain }, select: { id: true } })
    .catch(() => null);
  const shopId = shopRow?.id ?? null;
  let quotaExhausted = false;
  if (shopId) {
    const gate = await canConsume({ shopId, metric: "STYLIST_TURN" }).catch(() => null);
    if (gate && !gate.allowed && process.env.BILLING_ENFORCED === "1") {
      quotaExhausted = true;
    }
  }
  if (quotaExhausted) {
    return {
      result: decisionToAdapter(
        null,
        "We've hit this month's Mira conversation cap on this store — the merchant can lift it from the dashboard. I'll be back next cycle.",
      ),
      setCookie: shopperSession.setCookie,
    };
  }

  try {
    const brainStartedAt = Date.now();
    // ── ONE BRAIN, IN-PROCESS (brain relocation Stage 2c) ─────────────────────
    // The Mira decision core now lives in @stylique/mira-brain. Call it directly,
    // in this process — no cross-service HTTP hop to stylique-web, no SPOF on the
    // demo origin, lower latency. The merchant catalog is already injected via
    // reqBody.injectedCatalog, so the brain needs no defaultCatalog and there is
    // no demo KB fallback in production. USE_IN_PROCESS_BRAIN=0 reverts to the
    // legacy HTTP fetch (kept as a safety valve during rollout).
    let payload: { source?: string; model?: string | null; decision?: Parameters<typeof decisionToAdapter>[0]; objective?: unknown };
    if (process.env.USE_IN_PROCESS_BRAIN !== "0") {
      const { decideMira } = await import("@stylique/mira-brain");
      const r = await decideMira(reqBody as unknown as Parameters<typeof decideMira>[0], { defaultCatalog: [] });
      payload = { source: r.source, model: r.model, decision: r.decision as Parameters<typeof decisionToAdapter>[0], objective: r.objective };
    } else {
      const res = await fetch(UNIFIED_BRAIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(35_000),
      });
      payload = (await res.json()) as { source?: string; decision?: Parameters<typeof decisionToAdapter>[0]; objective?: unknown };
    }
    // Record the turn on the way back. Fire-and-forget; recordConsume is
    // idempotent + already swallows errors, so a Prisma blip never blocks the
    // shopper. We count attempted calls (after the LLM RT), not 200s, because
    // a timeout is still cost; downgrade to a precise "succeeded" counter
    // later if billing requires it.
    if (shopId) void recordConsume({ shopId, metric: "STYLIST_TURN", by: 1 });

    // ── ANALYTICS EVENT EMISSION (P0 — audit cycle 9) ─────────────────────
    // BEFORE this fix: storefront Mira via /api/mira → runMiraAdapter wrote
    // ZERO analytics events. Dashboard chat KPIs (chatSessions, chatTurns,
    // CHAT_CART_REQUESTED, topCombos CTR), the monthly report, and the
    // sentiment-extract job all received structurally-zero signal on every
    // production install — the §1 thesis ("brands buy the learning loop")
    // broke silently. Now: every turn fires the right event(s) so the
    // existing dashboard machinery starts seeing real numbers. All writes
    // are fire-and-forget — a Prisma blip never blocks the shopper.
    if (shopId) {
      void (async () => {
        try {
          const { analytics } = await import("./shopper-helpers.server");
          const isFirstTurn = (b.history?.length ?? 0) === 0;
          if (isFirstTurn) {
            await analytics.track({
              shopId,
              shopperId: shopperSession.row.id,
              name: "CHAT_OPENED",
              payload: { surface: "mira_proxy" },
            });
          }
          await analytics.track({
            shopId, shopperId: shopperSession.row.id, name: "CHAT_MESSAGE_SENT",
            payload: { length: lastUserMsg.length },
          });
          await analytics.track({
            shopId, shopperId: shopperSession.row.id, name: "CHAT_REPLY_RECEIVED",
            payload: {
              latencyMs: Math.max(0, Date.now() - brainStartedAt),
              combos: payload.decision?.route === "look" ? 1 : 0,
              actions: payload.decision?.route && payload.decision.route !== "talk_only" ? 1 : 0,
            },
          });
          const route = payload.decision?.route;
          const handle = payload.decision?.productHandle;
          // Resolve handle → product.id (shop-scoped, §3 #1).
          if (handle && (route === "reco_handle" || route === "navigate" || route === "look" || route === "try_on")) {
            const prod = await prisma.product.findFirst({
              where: { shopId, handle }, select: { id: true },
            });
            if (prod) {
              await analytics.track({
                shopId, shopperId: shopperSession.row.id, name: "CHAT_PRODUCT_CLICKED",
                productId: prod.id, payload: { productHandle: handle },
              });
            }
          }
          if (route === "add_to_cart") {
            const prod = handle ? await prisma.product.findFirst({
              where: { shopId, handle }, select: { id: true },
            }) : null;
            if (prod) {
              await analytics.track({
                shopId, shopperId: shopperSession.row.id, name: "CHAT_CART_REQUESTED",
                productId: prod.id, payload: {
                  productId: prod.id,
                  suggestedSize: b.knownSize ?? undefined,
                },
              });
            }
          }


          // ── CATALOG-GAP / NEAR-MISS CAPTURE (P1 #5) ───────────────────────
          // The unified brain flags unmet demand (shopper asked for something
          // the store genuinely does NOT carry) and near-misses (served the
          // closest real piece, one named attribute off). BEFORE this fix the
          // storefront path persisted NEITHER — so the §1 learning-loop thesis
          // ("brands buy demand intelligence: what to stock next") shipped on
          // the demo (D59/D60) but the production merchant's CatalogGap table
          // stayed empty. Now both land, shop-scoped (§3 #1), fire-and-forget.
          const dec = payload.decision as {
            unmet?: boolean; unmetCategory?: string;
            nearMiss?: boolean; nearMissCategory?: string; nearMissAttribute?: string;
          } | null;
          const askedText = (lastUserMsg || "").slice(0, 300).trim();
          if (askedText && (dec?.unmet || dec?.nearMiss)) {
            const { logCatalogGap } = await import("./taste.server");
            if (dec.unmet) {
              await logCatalogGap({
                shopId, shopperRowId: shopperSession.row.id, rawQuery: askedText,
                resultCount: 0, category: dec.unmetCategory, source: "mira_proxy",
              });
            } else if (dec.nearMiss && handle) {
              const np = await prisma.product.findFirst({
                where: { shopId, handle }, select: { id: true },
              });
              await logCatalogGap({
                shopId, shopperRowId: shopperSession.row.id, rawQuery: askedText,
                resultCount: 1, category: dec.nearMissCategory,
                source: "mira_proxy_nearmiss",
                nearMissProductId: np?.id, nearMissAttribute: dec.nearMissAttribute,
              });
            }
          }
        } catch (err) {
          console.error("[mira-adapter] analytics/gap emission failed", err);
        }
      })();
    }

    // Project the injected (rich demo-brain) catalog into AdaptedProduct shape
    // so the adapter's compare-resolution can find the named handles. The
    // projection is a thin field-rename — same data, smaller surface.
    const cat = injectedCatalog as Array<{
      id?: string;
      handle?: string; name?: string; category?: string | null;
      priceUsd?: number | null;
      images?: string[]; sizes?: string[]; colors?: string[];
    }>;
    const compareCatalog: AdaptedProduct[] = cat
      .filter((p) => typeof p?.handle === "string")
      .map((p) => ({
        id: p.id,
        handle: p.handle!,
        name: p.name ?? p.handle!,
        category: p.category ?? null,
        priceUsd: p.priceUsd ?? null,
        image: Array.isArray(p.images) && p.images[0] ? p.images[0] : null,
        sizes: Array.isArray(p.sizes) ? p.sizes : [],
        colors: Array.isArray(p.colors) ? p.colors : [],
      }));
    const result = decisionToAdapter(
      payload.decision ?? null,
      "Tell me what you're after and I'll pull one piece, not a wall.",
      compareCatalog,
      {
        currentProductHandle: b.currentProductHandle,
        shopperQuery: lastUserMsg,
      },
    );
    result.objective = payload.objective;
    void appendChatTurns(shopperSession.row.id, [
      { role: "user", text: lastUserMsg },
      { role: "model", text: result.decision.voice },
    ]).catch((err) => console.error("[mira-adapter] chat persistence failed", err));

    // CHAT_COMBO_PROPOSED + CHAT_SEARCH_RUN — emitted here (after `result` is
    // built) because they derive from the resolved look/products. The dashboard
    // reads both (combosProposed / topCombos / search coverage); before this
    // they fired ONLY on the demo, so the production tiles were permanently
    // zero. Fire-and-forget, shop-scoped (§3 #1).
    if (shopId) {
      const route = result.decision.route;
      void (async () => {
        try {
          const { analytics } = await import("./shopper-helpers.server");
          if (route === "look" && result.look && result.look.pieces.length) {
            const lookHandles = result.look.pieces.map((p) => p.handle).filter(Boolean);
            const lookProds = lookHandles.length
              ? await prisma.product.findMany({
                  where: { shopId, handle: { in: lookHandles } }, select: { id: true },
                })
              : [];
            if (lookProds.length) {
              await analytics.track({
                shopId, shopperId: shopperSession.row.id, name: "CHAT_COMBO_PROPOSED",
                payload: {
                  comboName: result.look.title || "Complete the look",
                  productIds: lookProds.map((p) => p.id),
                  reasoning: result.look.reasoning || undefined,
                },
              });
            }
          }
          if (route === "search" || route === "reco_filter") {
            const resultCount = result.products?.length ?? 0;
            await analytics.track({
              shopId, shopperId: shopperSession.row.id, name: "CHAT_SEARCH_RUN",
              payload: {
                query: (lastUserMsg || "").slice(0, 200).trim() || "(filter)",
                resultCount,
                gap: resultCount < 2,
              },
            });
          }
        } catch (err) {
          console.error("[mira-adapter] combo/search event emission failed", err);
        }
      })();
    }
    return { result, setCookie: shopperSession.setCookie };
  } catch (err) {
    console.error("[mira-adapter] unified brain forward failed", err);
    if (shopId) void recordConsume({ shopId, metric: "STYLIST_TURN", by: 1 });
    return {
      result: decisionToAdapter(null, "I'm here when you're ready — what are you looking for?"),
      setCookie: shopperSession.setCookie,
    };
  }
}
