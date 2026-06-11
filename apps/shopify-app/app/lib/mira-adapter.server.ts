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

import { postChat } from "./chat.server";
import { prisma } from "../db.server";
import type { BrainClientAction, BrainCombo, BrainProduct } from "@stylique/ai";
import { canConsume, recordConsume } from "./entitlement.server";

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
  | "reco_handle" | "navigate" | "look" | "size_form" | "try_on"
  | "add_to_cart" | "studio" | "compare" | "talk_only";

export type AdaptedProduct = {
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
    "https://stylique-web.up.railway.app";
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

function decisionToAdapter(
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
): MiraAdapterResult {
  if (!decision) {
    return {
      source: "brain",
      decision: { voice: fallbackVoice, route: "talk_only", productHandle: null, quickReplies: ["Show me one", "Build a look", "Size me"], intent: "other" },
      products: [],
      look: null,
    };
  }
  // P4-comparison resolution: when the brain emitted route=compare with
  // compareHandles, resolve each against the merchant's catalog (already loaded
  // for THIS turn) in the named order, dropping handles we can't verify so we
  // never show a phantom card.
  let products: AdaptedProduct[] = [];
  const route = (decision.route as MiraRoute) ?? "talk_only";
  if (route === "compare" && decision.compareHandles?.length && activeCatalog.length) {
    products = decision.compareHandles
      .map((h) => activeCatalog.find((p) => p.handle === h))
      .filter((p): p is AdaptedProduct => p != null)
      .slice(0, 3);
  }
  return {
    source: "brain",
    decision: {
      voice: decision.voice ?? fallbackVoice,
      route,
      productHandle: decision.productHandle ?? null,
      quickReplies: decision.quickReplies ?? [],
      intent: decision.intent ?? "other",
      compareHandles: decision.compareHandles,
    },
    products,
    look: null,
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
  const [{ catalog: injectedCatalog, currency }, brandRaw] = await Promise.all([
    loadMerchantCatalog(args.shopDomain),
    loadMerchantBrand(args.shopDomain),
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
      setCookie: null,
    };
  }

  try {
    const res = await fetch(UNIFIED_BRAIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(35_000),
    });
    const payload = (await res.json()) as { source?: string; decision?: Parameters<typeof decisionToAdapter>[0] };
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
    if (shopId && args.shopperCookieId) {
      void (async () => {
        try {
          const { analytics } = await import("./shopper-helpers.server");
          const shopper = await prisma.shopperSession.findFirst({
            where: { shopifyDomain: args.shopDomain, sessionId: args.shopperCookieId! },
            select: { id: true },
          });
          if (!shopper) return;
          const isFirstTurn = (b.history?.length ?? 0) === 0;
          if (isFirstTurn) {
            await analytics.track({ shopId, shopperId: shopper.id, name: "CHAT_OPENED", payload: { source: "mira_proxy" } });
          }
          await analytics.track({
            shopId, shopperId: shopper.id, name: "CHAT_MESSAGE_SENT",
            payload: { route: payload.decision?.route ?? "talk_only" },
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
                shopId, shopperId: shopper.id, name: "CHAT_PRODUCT_CLICKED",
                productId: prod.id, payload: { handle, route },
              });
            }
          }
          if (route === "add_to_cart") {
            const prod = handle ? await prisma.product.findFirst({
              where: { shopId, handle }, select: { id: true },
            }) : null;
            await analytics.track({
              shopId, shopperId: shopper.id, name: "CHAT_CART_REQUESTED",
              productId: prod?.id, payload: { handle: handle ?? null },
            });
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
                shopId, shopperRowId: shopper.id, rawQuery: askedText,
                resultCount: 0, category: dec.unmetCategory, source: "mira_proxy",
              });
            } else if (dec.nearMiss && handle) {
              const np = await prisma.product.findFirst({
                where: { shopId, handle }, select: { id: true },
              });
              await logCatalogGap({
                shopId, shopperRowId: shopper.id, rawQuery: askedText,
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
      handle?: string; name?: string; category?: string | null;
      priceUsd?: number | null;
      images?: string[]; sizes?: string[]; colors?: string[];
    }>;
    const compareCatalog: AdaptedProduct[] = cat
      .filter((p) => typeof p?.handle === "string")
      .map((p) => ({
        handle: p.handle!,
        name: p.name ?? p.handle!,
        category: p.category ?? null,
        priceUsd: p.priceUsd ?? null,
        image: Array.isArray(p.images) && p.images[0] ? p.images[0] : null,
        sizes: Array.isArray(p.sizes) ? p.sizes : [],
        colors: Array.isArray(p.colors) ? p.colors : [],
      }));
    return { result: decisionToAdapter(payload.decision ?? null, "Tell me what you're after and I'll pull one piece, not a wall.", compareCatalog), setCookie: null };
  } catch (err) {
    console.error("[mira-adapter] unified brain forward failed", err);
    if (shopId) void recordConsume({ shopId, metric: "STYLIST_TURN", by: 1 });
    return {
      result: decisionToAdapter(null, "I'm here when you're ready — what are you looking for?"),
      setCookie: null,
    };
  }
}

// ── LEGACY function below kept for reference / non-Mira callers (graceful
// rollback path if needed). Not invoked by the unified runMiraAdapter above.
async function _legacyRunMiraAdapter(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
  acceptLanguage: string | null;
}): Promise<{ result: MiraAdapterResult; setCookie?: string | null }> {
  // ─── Shared helpers + the shopper's words (computed BEFORE the brain call so
  //     every failure/empty path can fall back to the same catalog net) ───────
  const msgs = args.body as { messages?: Array<{ role?: string; text?: string }>; currentProductHandle?: string | null } | undefined;
  const lastUser = [...(msgs?.messages ?? [])].reverse().find((m) => m?.role === "user")?.text ?? "";
  const isChitChat = /^\s*(hi|hey|hello|thanks|thank you|ok|okay|bye|cool|great)\b/i.test(lastUser) && lastUser.length < 25;

  // The store's own currency — Mira formats every price in it (panel P0). One
  // cheap lookup; defaults to USD if the shop row is missing.
  const shopRow = await prisma.shop.findFirst({ where: { shopifyDomain: args.shopDomain }, select: { currencyCode: true } }).catch(() => null);
  const currency = shopRow?.currencyCode ?? "USD";

  // brain.ts emits two hardcoded placeholders when the LLM dead-ends without a
  // final reply. Those are NOT Mira's voice — treat them as empty so a productful
  // turn speaks like a stylist, not a spinner.
  const BRAIN_PLACEHOLDERS = new Set([
    "one sec — pulling something that fits.",
    "take a look — let me know what catches your eye.",
  ]);
  // Coherent sales line (panel P1 #4): the old version blindly paired ps[0]+ps[1]
  // regardless of slot — producing "Linen Shirt + Silk Slip Dress" (two
  // mutually-exclusive garments). Delegate to the slot-aware, season-filtered
  // buildStyledLook; only when NO coherent ≥2-piece look exists do we fall back
  // to ONE hero piece (never a fake incoherent pairing).
  const salesLineFor = (ps: AdaptedProduct[]): string => {
    const styled = buildStyledLook(ps, lastUser);
    if (styled) return styled.reasoning;
    const lead = ps[0];
    if (!lead) return "Tell me the occasion and I'll pull the right piece.";
    const m = money(lead.priceUsd, currency);
    const priced = m ? `${lead.name} (${m})` : lead.name;
    return `The ${priced} is the one I'd reach for here. Want me to size it to you, or show it on?`;
  };

  // Deterministic route override (panel rec #6): the highest-intent shopper
  // signals — "see it on me" / "add to cart" — must FIRE the fitting room / cart,
  // not return a passive look card. Detect them from the shopper's words and
  // override the brain/net route. Try-on needs a product to render on.
  const overrideRoute = (base: MiraRoute, handle: string | null): MiraRoute => {
    const lu = lastUser.toLowerCase();
    const curHandle = handle ?? msgs?.currentProductHandle ?? null;
    if (/\b(see it on|on me|try (it |this |them )?on|on a model|fitting room|how (it|this|they) look)/.test(lu) && curHandle) return "try_on";
    if (/\b(add to (cart|bag|basket)|i'?ll (take|buy)|buy it|bag it|let'?s do it|check ?out|purchase|i want it)/.test(lu) || /(ok add it|add it\b|i'?ll take it|yes please\b|let'?s do it|sold\b|done\b|i want it|add (to|the) (cart|bag))/i.test(lu)) return "add_to_cart";
    // Size/fit is the #1 pre-purchase anxiety (panel rec #8). When the shopper
    // asks about size or fit, open the fit/size flow rather than a passive card.
    if (/\b(what size|my size|will (it|this|they) fit|fit me|size (up|down)|runs? (small|large|big)|true to size|between sizes|am i an? )/.test(lu)) return "size_form";
    return base;
  };
  // Is the shopper REQUESTING a specific garment category (vs pairing/occasion
  // styling)? A request for a category we don't stock should honor the gap, not
  // paper over it (panel P0 #2). Pairing turns ("goes with these trousers") and
  // occasion turns ("for a wedding") stay loose so styling still fills.
  const lu0 = lastUser.toLowerCase();
  const isRequest = /\b(do you (have|carry|sell|stock)|got any|looking for|i (need|want)|i'?m after|any\b.*\?|show me (a|some|any))\b/.test(lu0);
  const isPairing = /\b(goes? with|pairs? with|complete|completes|match|with (these|this|my|the)|what (else|to wear)|style (this|it|these))\b/.test(lu0);
  const namesGarment = /\b(shoe|sneaker|trainer|boot|heel|sandal|loafer|pump|bag|handbag|purse|clutch|tote|backpack|jewel|jewellery|necklace|earring|bracelet|ring|watch|belt|scarf|hat|cap|sunglass|glove|dress|gown|shirt|blouse|top|tee|t-shirt|sweater|jumper|knit|cardigan|coat|jacket|blazer|trench|trouser|pant|jean|denim|skirt|short|legging|suit|jumpsuit)s?\b/.test(lu0);
  const strictRequest = isRequest && !isPairing && namesGarment;

  // The catalog net: real products for this shop from the shopper's words. Used
  // whenever the brain fails OR produces no products — so the shopper is NEVER
  // shown a blank turn, even on a brain error / rate-limit / timeout.
  const catalogNet = async (): Promise<AdaptedProduct[]> =>
    lastUser.trim() && !isChitChat
      ? await searchShopCatalog(args.shopDomain, lastUser, msgs?.currentProductHandle, strictRequest).catch(() => [])
      : [];

  // LATENCY CAP + ABORT (panel P0 #2): race the brain against a timeout AND
  // abort the underlying Gemini fetch when we time out — preventing dangling
  // fetch handles from accumulating under multi-user load on Railway.
  const BRAIN_TIMEOUT_MS = Number(process.env.BRAIN_TIMEOUT_MS ?? 10000);
  const netPromise = catalogNet();
  type ChatResult = Awaited<ReturnType<typeof postChat>>;
  const TIMEOUT = Symbol("brain_timeout");
  const ac = new AbortController();
  const raced = await Promise.race([
    postChat({ ...args, signal: ac.signal } as Parameters<typeof postChat>[0]),
    new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => { ac.abort(); resolve(TIMEOUT); }, BRAIN_TIMEOUT_MS)),
  ]);
  const timedOut = raced === TIMEOUT;
  const chat: ChatResult | null = timedOut ? null : (raced as ChatResult);
  const data = chat && chat.ok ? chat.data : null;
  if (timedOut) console.error(`[mira-adapter] brain TIMEOUT after ${BRAIN_TIMEOUT_MS}ms — serving styled net`);
  else if (chat && !chat.ok) console.error("[mira-adapter] brain not ok:", (chat as { error?: string }).error);
  else if (!data?.reply && !(data?.combos?.length) && !(data?.actions?.length)) console.error("[mira-adapter] brain ok but EMPTY turn (no reply/combos/actions)");

  // BRAIN FAILED or TIMED OUT. Don't go blank — serve the (already-computing)
  // catalog net so the shopper still gets a real styled look + stylist line.
  if (!data) {
    // Season-filter the flat product set too (panel P1 #4) — not just the look —
    // so no wool/cashmere card surfaces on a summer turn.
    const netProducts = (await netPromise).filter((p) => seasonOk(p, lastUser));
    const netLook = buildStyledLook(netProducts, lastUser);
    // On a PDP, product actions target the on-screen piece (panel P0 #1); else the
    // look anchor.
    const onScreen = msgs?.currentProductHandle ?? null;
    const anchorHandle = netLook?.pieces?.[0]?.handle ?? netProducts[0]?.handle ?? null;
    const preRoute = overrideRoute(netProducts.length ? "look" : "talk_only", onScreen ?? anchorHandle);
    const isAction = preRoute === "try_on" || preRoute === "size_form" || preRoute === "add_to_cart";
    const netHandle = isAction && onScreen ? onScreen : (anchorHandle ?? onScreen);
    const netRoute = preRoute;
    return {
      result: {
        source: "brain",
        decision: {
          // Prefer the styled-look rationale over the flat sales line so even a
          // brain-failure turn reads as a stylist, not a spinner. On a strict
          // category request that found nothing, be HONEST about the gap (panel #2).
          voice: netLook?.reasoning
            ?? (netProducts.length
              ? salesLineFor(netProducts)
              : strictRequest
                ? "We don't carry that just yet — but tell me the occasion and I'll style you with what we do have."
                : "Tell me the occasion and I'll pull the right piece."),
          route: netRoute,
          productHandle: netHandle,
          quickReplies: chipsFor(netRoute),
          intent: "other",
        },
        products: netProducts,
        look: netLook,
      },
      setCookie: chat?.setCookie,
    };
  }

  const combo: BrainCombo | undefined = data.combos[0];
  let products = (combo?.products ?? []).map(toProduct);

  // Honest-absence gated on CATALOG TRUTH, not on the brain's words (panel P0 #2).
  // The brain sometimes falsely claims "we don't carry X" when X is in stock —
  // verify against the catalog: only honor the claim when the net genuinely finds
  // nothing. Otherwise the brain was wrong → net-fill (don't lose the sale).
  const brainSaidAbsence = /\b(don'?t (carry|have|stock)|not (in stock|available|something we)|we don'?t (carry|have|stock|offer)|no longer (carry|stock)|isn'?t something we)\b/i.test(data.reply ?? "");
  const netForFill = !products.length ? await netPromise : [];
  const honestAbsence = brainSaidAbsence && netForFill.length === 0;
  if (!products.length && !honestAbsence) {
    products = netForFill.filter((p) => seasonOk(p, lastUser));
  }

  // When the brain proposed a combo, use it. When it didn't (net-filled products),
  // build a slot-aware styled look so the shopper still gets a real "look", not a
  // grab-bag (panel rec #4 at the floor).
  const netLook = combo ? null : buildStyledLook(products, lastUser);

  // Slot-dedup look pieces (panel P1 #4 completion): even when the BRAIN proposes
  // a combo, it sometimes includes all search results without caring about slots
  // (4 tops, 1 bottom → incoherent). Keep the FIRST/best piece per slot, max 4.
  const deDupBySlot = (pieces: AdaptedProduct[]): AdaptedProduct[] => {
    const seen = new Set<string>();
    return pieces.filter((p) => {
      const sl = slotOf(p);
      if (seen.has(sl)) return false;
      seen.add(sl);
      return true;
    }).slice(0, 4);
  };

  // Look reasoning (panel P1 #8): prefer the Brain combo's OWN reasoning (color
  // harmony + proportion logic it computed), fall back to buildStyledLook template
  // only when the brain didn't propose. Also prefer the brain's final text reply
  // as the look reasoning if the combo reasoning is absent (the brain sometimes
  // writes the rationale in the reply rather than the combo.reasoning field).
  const brainReasoning = combo?.reasoning?.trim() || data.reply?.trim() || "";
  const look = combo
    ? { title: combo.name, reasoning: brainReasoning || (netLook?.reasoning ?? ""), pieces: deDupBySlot(products) }
    : netLook;
  const { route, handle } = routeFromActions(data.actions, !!combo);
  const baseRoute = !combo && netLook ? "look" : route;

  // HANDLE RESOLUTION (panel P0 #1 + #8): the net EXCLUDES the on-screen product,
  // so products[0] is a DIFFERENT item — using it for try_on/size/cart fired the
  // action on the WRONG product (silk-slip PDP + "see it on me" opened a tee).
  // Single-source the anchor from look.pieces[0]; and for product ACTIONS on a PDP,
  // target the ON-SCREEN piece (what the shopper is actually looking at).
  const onScreen = msgs?.currentProductHandle ?? null;
  const anchorHandle = handle ?? look?.pieces?.[0]?.handle ?? products[0]?.handle ?? null;
  const finalRoute = overrideRoute(baseRoute, onScreen ?? anchorHandle);
  const isProductAction = finalRoute === "try_on" || finalRoute === "size_form" || finalRoute === "add_to_cart";
  // When the final route is add_to_cart but no explicit handle was returned by the
  // brain (multi-turn "ok add it" after anchoring on a product), fall back to the
  // on-screen product handle that persists across the conversation.
  const productHandle =
    handle ??
    (isProductAction && onScreen
      ? onScreen
      : (anchorHandle ?? onScreen)) ??
    (finalRoute === "add_to_cart" ? (msgs?.currentProductHandle ?? null) : null);

  // Voice: the brain's real reply, then the combo's reasoning, then a REAL
  // salesperson line over the products, then a safe prompt — always present.
  // Also purge FLUSTERED replies (panel rec #17): "my apologies / I'm having
  // trouble / let me try again" reads as a broken bot — when we have a styled
  // look or products to show, the look rationale speaks instead.
  const replyText = (data.reply ?? "").trim();
  const flustered = /\b(my apolog|i'?m having trouble|having trouble finding|let me try (again|that again)|something went wrong|i couldn'?t (find|pull)|trouble pulling)\b/i.test(replyText);
  const realReply =
    replyText && !BRAIN_PLACEHOLDERS.has(replyText.toLowerCase()) && !(flustered && (netLook || products.length))
      ? replyText
      : "";
  const voice = realReply
    ? realReply
    : combo?.reasoning?.trim()
      ? combo.reasoning
      : netLook?.reasoning
        ? netLook.reasoning
        : products.length
          ? salesLineFor(products)
          : "Tell me the occasion and I'll pull the right piece.";

  // Coherence (panel rec, minor): when the brain asks a pure CLARIFYING question
  // (qualify-first, no combo), don't attach a net look under it — let the question
  // stand alone so the voice and cards never contradict ("what's it for?" + a look).
  const qualifying =
    !combo &&
    /\?\s*$/.test(replyText) &&
    /(what'?s it for|what.?s the occasion|the occasion\??$|tell me (a bit )?more|what are you (after|looking)|which one|when is it|who'?s it for)/i.test(replyText);

  return {
    result: {
      source: "brain",
      decision: {
        voice,
        route: qualifying ? "talk_only" : finalRoute,
        productHandle,
        quickReplies: chipsFor(finalRoute),
        // Pass the real intent from the classifier/router so the learning loop's
        // discovery hit-rate, intent histogram, and near-miss signals are grounded
        // in real data (panel P0: intent:'other' hardcode made all metrics garbage).
        intent: (data.routingMeta?.intent ?? "other") as string,
      },
      products: qualifying ? [] : products,
      look: qualifying ? null : look,
    },
    setCookie: chat?.setCookie,
  };
}
