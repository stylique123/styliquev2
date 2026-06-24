// Layer 2 — taste vector computation.
//
// Reads recent AnalyticsEvents for one shopper, joins them to the touched
// products, and rolls them up into a five-dimension preference distribution
// the agent can use to re-rank recommendations.
//
// Storage: ShopperSession.tasteVectorJson (Json), tasteComputedAt, signalCount.
//
// Scoring weights — empirically chosen, deliberately small ints so a handful
// of strong signals matter more than a thousand passing impressions:
//
//   PURCHASE                +10   // hardest evidence (will land via Shopify webhook later)
//   COMBO_ADD_ALL          + 8
//   MIRA_OUTFIT_ACCEPTED   + 7
//   CART_CONFIRMED          + 6
//   CART_FROM_MIRA/TRYON    + 6
//   CHAT_PRODUCT_CLICKED    + 3
//   STYLE_PRODUCT_CLICKED   + 3
//   STYLE_VOTED             ±3
//   CHAT_COMBO_PROPOSED     + 1   // agent-side; weak positive
//   WIDGET_STYLE_VIEWED     + 1
//   CART_CANCELLED          - 4
//   SIGNUP_DISMISSED         0    // tracked but not predictive of taste
//
// We don't punish "viewed but didn't click" yet — the dwell signal is too noisy.

import { prisma } from "../db.server";
import { analytics } from "./shopper-helpers.server";

export type TasteVector = {
  colorFamily: Record<string, number>;
  silhouette:  Record<string, number>;   // FITTED / REGULAR / RELAXED / OVERSIZED
  category:    Record<string, number>;
  priceTier:   Record<string, number>;   // budget / mid / premium
  occasion:    Record<string, number>;   // not derivable yet; placeholder for future tagging
  topProducts: string[];                 // descending by score
};

const EMPTY_VECTOR: TasteVector = {
  colorFamily: {}, silhouette: {}, category: {}, priceTier: {}, occasion: {}, topProducts: [],
};

const EVENT_WEIGHTS: Record<string, number> = {
  PURCHASE:              10,
  COMBO_ADD_ALL:          8,
  MIRA_OUTFIT_ACCEPTED:   7,
  CART_CONFIRMED:         6,
  CART_FROM_MIRA:         6,
  CART_FROM_TRYON:        6,
  CHAT_PRODUCT_CLICKED:   3,
  STYLE_PRODUCT_CLICKED:  3,
  STYLE_VOTED:            3,
  MIRA_OUTFIT_REJECTED:  -3,
  STYLE_VIEWED:           2,
  FIT_RECOMMENDED:        1,
  PRODUCT_DWELL_LONG:     1,
  PRODUCT_VIEWED:         1,
  CHAT_COMBO_PROPOSED:    1,
  WIDGET_STYLE_VIEWED:    1,
  CART_CANCELLED:        -4,
};

const LOOKBACK_DAYS = 90;
const MAX_EVENTS = 500;       // hard cap per recompute

export function gapIntensityCatalogGapWhere(shopId: string, normalizedQuery: string, since: Date) {
  return {
    shopId,
    normalizedQuery,
    createdAt: { gte: since },
    source: { not: "size_chart_extract" },
    NOT: { rawQuery: { startsWith: "no_size_chart" } },
  };
}

function bump(map: Record<string, number>, key: string | null | undefined, weight: number) {
  if (!key) return;
  const k = key.toLowerCase();
  map[k] = (map[k] ?? 0) + weight;
}

function priceTier(cents: number | null | undefined): string | null {
  if (cents == null) return null;
  // PKR-tuned defaults; safe enough for first iteration. Later we'll learn
  // these per-shop from the catalog's actual price distribution.
  if (cents < 200_000) return "budget";
  if (cents < 800_000) return "mid";
  return "premium";
}

function normalize(map: Record<string, number>): Record<string, number> {
  const total = Object.values(map).reduce((a, b) => a + Math.max(b, 0), 0);
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v > 0) out[k] = +(v / total).toFixed(3);
  }
  return out;
}

function asPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function eventProductIds(productId: string | null, payload: unknown): string[] {
  const ids = new Set<string>();
  if (productId) ids.add(productId);
  const p = asPayload(payload);
  if (typeof p.productId === "string") ids.add(p.productId);
  if (typeof p.anchorProductId === "string") ids.add(p.anchorProductId);
  if (Array.isArray(p.productIds)) {
    for (const id of p.productIds) if (typeof id === "string") ids.add(id);
  }
  return [...ids];
}

function inferOccasion(payload: unknown): string | null {
  const p = asPayload(payload);
  const direct = [p.occasion, p.shopperIntent, p.intent, p.context]
    .find((v): v is string => typeof v === "string" && v.trim().length > 0);
  const haystack = (direct ?? JSON.stringify(p)).toLowerCase();
  const lanes = [
    "office", "work", "wedding", "brunch", "dinner", "date", "travel",
    "weekend", "vacation", "party", "formal", "casual", "evening",
  ];
  return lanes.find((lane) => haystack.includes(lane)) ?? null;
}

export async function recomputeTasteVector(shopperRowId: string): Promise<TasteVector> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  // Coalesce concurrent triggers (panel P1 — taste-vector write race). A chat turn
  // and an order webhook can fire recompute at the same instant and race the
  // unprotected UPDATE below, silently dropping the loser's result (e.g. the +10
  // PURCHASE signal). If a fresh vector was written in the last 20s, reuse it
  // instead of recomputing — collapses the burst into a single write. 20s staleness
  // is immaterial for a slowly-evolving aggregate.
  const existing = await prisma.shopperSession.findUnique({
    where: { id: shopperRowId },
    select: { tasteComputedAt: true, tasteVectorJson: true },
  }).catch(() => null);
  if (
    existing?.tasteComputedAt &&
    Date.now() - existing.tasteComputedAt.getTime() < 20_000 &&
    existing.tasteVectorJson
  ) {
    return existing.tasteVectorJson as unknown as TasteVector;
  }

  // Pull events with the product they referenced (if any). We hand-craft the
  // include so we only join columns we actually score against.
  const events = await prisma.analyticsEvent.findMany({
    where: { shopperId: shopperRowId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: MAX_EVENTS,
    select: {
      name: true, productId: true, payload: true, shopId: true,
    },
  });

  if (!events.length) {
    return EMPTY_VECTOR;
  }

  const productIds = Array.from(new Set(
    events.flatMap((e) => eventProductIds(e.productId, e.payload)),
  ));

  // Scope the product join to the shop(s) these events belong to — never join
  // another shop's product even if a stale payload carried a foreign productId
  // (§3 / §3.5 invariant #1: cross-shop reads impossible by construction).
  const shopIds = Array.from(new Set(events.map((e) => e.shopId).filter((s): s is string => !!s)));

  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds }, shopId: { in: shopIds } },
        select: {
          id: true, category: true, colorFamily: true,
          variants: { select: { priceCents: true } },
        },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p] as const));

  const v: TasteVector = {
    colorFamily: {}, silhouette: {}, category: {}, priceTier: {}, occasion: {}, topProducts: [],
  };
  const productScores = new Map<string, number>();

  for (const e of events) {
    const payload = asPayload(e.payload);
    let w = EVENT_WEIGHTS[e.name] ?? 0;
    if (e.name === "STYLE_VOTED" || e.name === "CHAT_COMBO_VOTED") {
      w = payload.vote === "down" ? -Math.abs(w || 3) : Math.abs(w || 3);
    }
    if (w === 0) continue;

    // Pull a silhouette hint out of WIDGET_FIT_SUBMITTED payloads.
    if (e.name === "WIDGET_FIT_SUBMITTED" || e.name === "DEMO_FIT_SUBMITTED" || e.name === "CHAT_PROFILE_CAPTURED") {
      const fp = payload.fitPreference;
      if (typeof fp === "string") bump(v.silhouette, fp, 2);
    }

    const occasion = inferOccasion(payload);
    if (occasion) bump(v.occasion, occasion, Math.max(1, Math.abs(w)));

    for (const id of eventProductIds(e.productId, e.payload)) {
      const p = byId.get(id);
      if (!p) continue;
      bump(v.category,    p.category,    w);
      bump(v.colorFamily, p.colorFamily, w);
      const cheapest = p.variants
        .map((x) => x.priceCents)
        .filter((x): x is number => x != null)
        .sort((a, b) => a - b)[0];
      bump(v.priceTier, priceTier(cheapest), w);
      productScores.set(id, (productScores.get(id) ?? 0) + w);
    }
  }

  v.colorFamily = normalize(v.colorFamily);
  v.silhouette  = normalize(v.silhouette);
  v.category    = normalize(v.category);
  v.priceTier   = normalize(v.priceTier);
  v.occasion    = normalize(v.occasion);
  v.topProducts = [...productScores.entries()]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id);

  await prisma.shopperSession.update({
    where: { id: shopperRowId },
    data: {
      tasteVectorJson: v as unknown as object,
      tasteComputedAt: new Date(),
      signalCount: events.length,
    },
  }).catch(() => undefined);

  return v;
}

export async function readTasteVector(shopperRowId: string): Promise<TasteVector | null> {
  const row = await prisma.shopperSession.findUnique({
    where: { id: shopperRowId },
    select: { tasteVectorJson: true, signalCount: true },
  });
  if (!row?.tasteVectorJson) return null;
  return row.tasteVectorJson as unknown as TasteVector;
}

// Pretty-print the dominant lanes for the agent prompt. Keep it human and
// short — the LLM doesn't need numbers, it needs vocabulary it can echo.
export function describeTasteForPrompt(v: TasteVector): string | null {
  const dominant = (m: Record<string, number>, n = 2): string[] =>
    Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

  const lines: string[] = [];
  const colors = dominant(v.colorFamily);
  const sils   = dominant(v.silhouette);
  const cats   = dominant(v.category, 3);
  const tiers  = dominant(v.priceTier, 1);
  const occasions = dominant(v.occasion, 2);

  if (colors.length) lines.push(`- Gravitates toward ${colors.join(" + ")} color families`);
  if (sils.length)   lines.push(`- Prefers ${sils.join(" / ")} fits`);
  if (cats.length)   lines.push(`- Shops mostly: ${cats.join(", ")}`);
  if (tiers.length)  lines.push(`- Price tier: ${tiers[0]}`);
  if (occasions.length) lines.push(`- Common occasions: ${occasions.join(" + ")}`);

  if (!lines.length) return null;
  return lines.join("\n");
}

// ─── Fit-bias correction (OI-3 return feedback loop) ───────────────────
//
// When a shopper returns a product, we look up the variant's recommended
// size and decrement a per-(category, size) `fitBias` counter persisted
// inside ShopperSession.tasteVectorJson. Future size recommendations can
// apply this penalty as a confidence modifier.
//
// fitBias shape (merged into TasteVector.tasteVectorJson):
//   { "dress:M": -1, "top:S": -2, ... }
//
// We keep the magnitude small (-1 per return) and don't let it go below -5
// so one badly-fitting item doesn't permanently poison a size class.

export async function applyReturnBias(args: {
  shopId: string;
  productId: string;
  sessionId: string;
  variantShopifyId: string;
  category: string | null | undefined;
}): Promise<void> {
  // Resolve the returned variant's recommended size from the last FitSession
  // for this (shopper, product). We only apply bias when we have a concrete
  // size recommendation to penalise.
  const lastFit = await prisma.fitSession.findFirst({
    where: { shopId: args.shopId, shopperId: args.sessionId, productId: args.productId },
    orderBy: { createdAt: "desc" },
    select: { recommendedSize: true },
  });

  // Fallback: read size from the ProductVariant record directly.
  const sizeFromVariant = await prisma.productVariant.findFirst({
    where: { product: { shopId: args.shopId }, shopifyId: args.variantShopifyId },
    select: { size: true },
  });

  const size = lastFit?.recommendedSize ?? sizeFromVariant?.size;
  const category = args.category;

  if (!size || !category) return;

  const biasKey = `${category.toLowerCase()}:${size.toUpperCase()}`;

  const row = await prisma.shopperSession.findUnique({
    where: { id: args.sessionId },
    select: { tasteVectorJson: true },
  });
  if (!row) return;

  // Parse existing vector (or start empty).
  const existing = (row.tasteVectorJson as Record<string, unknown> | null) ?? {};
  const fitBias = (existing.fitBias as Record<string, number> | undefined) ?? {};

  // Decrement, floor at -5.
  fitBias[biasKey] = Math.max((fitBias[biasKey] ?? 0) - 1, -5);

  await prisma.shopperSession.update({
    where: { id: args.sessionId },
    data: {
      tasteVectorJson: { ...existing, fitBias } as unknown as object,
    },
  }).catch(() => undefined);
}

// ─── Catalog gap capture ────────────────────────────────────────────────
// Called every time the agent's search returns < 2 results for a non-empty
// query. This table powers the brand-side "shoppers asked for X, you don't
// stock it" report.

export async function logCatalogGap(args: {
  shopId: string;
  shopperRowId: string | null;
  rawQuery: string;
  resultCount: number;
  category?: string;
  colorFamily?: string;
  source: string;
  // Near-miss (D60-style): we served the closest real match but it was one
  // named attribute off. When resultCount is 1–2 AND nearMissProductId is
  // provided, we also emit a CHAT_NEAR_MISS event so the recommendations
  // engine can surface the sharpest reorder hint ("you stock linen shirts,
  // just not cropped").
  nearMissProductId?: string;
  nearMissAttribute?: string;
}): Promise<void> {
  const q = (args.rawQuery ?? "").trim();
  if (!q || q.length < 2) return;

  const normalized = q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .sort()
    .join(" ");

  if (!normalized) return;

  await prisma.catalogGap.create({
    data: {
      shopId: args.shopId,
      shopperId: args.shopperRowId,
      rawQuery: q.slice(0, 280),
      normalizedQuery: normalized.slice(0, 280),
      resultCount: args.resultCount,
      category: args.category,
      colorFamily: args.colorFamily,
      source: args.source,
    },
  }).catch(() => undefined);

  // Near-miss signal: a close-but-not-exact match (1–2 results) where we know
  // which product was the near miss. Fire-and-forget — never blocks the gap log.
  if (
    args.resultCount >= 1 &&
    args.resultCount <= 2 &&
    args.nearMissProductId
  ) {
    void analytics.track({
      shopId: args.shopId,
      shopperId: args.shopperRowId ?? undefined,
      name: "CHAT_NEAR_MISS",
      productId: args.nearMissProductId,
      payload: {
        query: q.slice(0, 280),
        nearMissProductId: args.nearMissProductId,
        nearMissAttribute: args.nearMissAttribute,
        category: args.category,
        resultCount: args.resultCount,
      },
    }).catch(() => undefined);
  }
}

// ─── Gap intensity (recency-weighted) ──────────────────────────────────────
// Reads CatalogGap rows for a normalized query within the window and applies a
// recency weight (7-day half-life) so "4 asks this week" outranks "6 asks last
// month". Powers the dashboard's "what's hot now" gap ranking (D60 analogue).
export async function getGapIntensity(
  shopId: string,
  query: string,
  windowDays = 7,
): Promise<{ count: number; intensity: number; lastSeen: Date | null; isTrending: boolean }> {
  const normalized = (query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .sort()
    .join(" ")
    .slice(0, 280);

  if (!normalized) return { count: 0, intensity: 0, lastSeen: null, isTrending: false };

  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await prisma.catalogGap.findMany({
    where: gapIntensityCatalogGapWhere(shopId, normalized, since),
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  }).catch(() => [] as { createdAt: Date }[]);

  const now = Date.now();
  const HALF_LIFE_DAYS = 7;
  let intensity = 0;
  let lastSeen: Date | null = null;
  for (const r of rows) {
    const ageDays = Math.max(0, (now - r.createdAt.getTime()) / 86_400_000);
    intensity += Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    if (!lastSeen || r.createdAt > lastSeen) lastSeen = r.createdAt;
  }

  // "Trending" = more than half the demand intensity landed in the last 48h.
  const twoDaysAgo = now - 2 * 86_400_000;
  const recentIntensity = rows
    .filter((r) => r.createdAt.getTime() >= twoDaysAgo)
    .reduce((s, r) => {
      const ageDays = Math.max(0, (now - r.createdAt.getTime()) / 86_400_000);
      return s + Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    }, 0);

  return {
    count: rows.length,
    intensity: Math.round(intensity * 100) / 100,
    lastSeen,
    isTrending: intensity > 0 && recentIntensity / intensity > 0.5,
  };
}

// ─── Canonical gap buckets ──────────────────────────────────────────────────
// Folds free-form / synonym gap queries into stable buckets so "sneakers",
// "shoes" and "boots" all roll up to "footwear" in the brand-facing report
// (D60 canonical-category analogue). Anything unmatched keeps its lowercased,
// trimmed form.
export function canonicalizeGapQuery(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().trim();
  if (!s) return "";

  if (/\b(footwear|shoes?|sneakers?|trainers?|boots?|heels?|sandals?|loafers?|flats?)\b/.test(s))
    return "footwear";
  if (/\b(bags?|purses?|totes?|clutch(es)?|handbags?|backpacks?)\b/.test(s))
    return "bags";
  if (/\b(denim|jeans?)\b/.test(s)) return "denim";
  if (/\b(outerwear|coats?|jackets?|blazers?|parkas?)\b/.test(s)) return "outerwear";
  if (/\b(knit|knitwear|sweaters?|cardigans?|jumpers?|pullovers?)\b/.test(s))
    return "knitwear";
  if (/\b(activewear|gym|sport|sports|workout|athleisure)\b/.test(s))
    return "activewear";
  if (/\b(accessor\w*|jewell?ery|jewel\w*|watch(es)?|belts?|scarf|scarves|sunglasses)\b/.test(s))
    return "accessories";
  if (/\b(modest|coverage|hijab|abaya|full[\s-]?cover)\b/.test(s)) return "modest";
  if (/\b(wedding|formal|party|gown|black[\s-]?tie|occasion)\b/.test(s))
    return "occasion";
  if (/\b(cheap|cheaper|under|below|less than|affordable|budget)\b/.test(s) || /[<≤]\s*\$?\d/.test(s))
    return "budget";

  return s.slice(0, 60);
}
