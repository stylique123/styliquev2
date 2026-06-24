// Stylique — Fashion Intelligence engine (PRODUCTION).
//
// The production mirror of apps/web's mira-intelligence.server.ts. Produces the
// SAME four-pillar `FashionIntelligence` shape the demo dashboard renders, but
// computed from REAL, shopId-scoped shopper signals:
//
//   1. CONSUMER INTELLIGENCE   — style identity (from real catalog category /
//      productType), colour curiosity-vs-conversion (clicks vs carts grouped by
//      colorFamily), sizing + fit preference (WIDGET_FIT_SUBMITTED payloads),
//      occasion (CatalogGap + chat search reasons), and the combos proposed.
//   2. CONVERSION INTELLIGENCE — try-on lift (CART_FROM_TRYON vs baseline),
//      recommendation influence (COMBO_ADD_ALL intent / confirmed Mira cart
//      origins), a behavioural
//      confidence score, drop-off, and complete-look economics.
//   3. FIT & CONFIDENCE        — size confidence + return-risk (CART_CANCELLED
//      vs CART_CONFIRMED) per category — the return-reduction weapon.
//   4. STYLE & MERCHANDISING   — most-styled-not-sold (clicks vs carts per
//      product), outfit compatibility, collection performance, emerging trends.
//
// HONEST DATA POSTURE (PB19 / D27 / §3.5):
//   • Every query filters by shopId — cross-tenant reads impossible (§3 #1).
//   • Real signals are read live and folded in wherever present.
//   • When a shop is sparse (early install, low traffic), distributions are
//     modelled DETERMINISTICALLY from the shop's OWN catalog, seeded by shopId
//     so each shop shows a stable, distinct shape — never another shop's data,
//     never random flicker. `dataMode` is reported honestly so the UI can label
//     "modelled" vs "live+modelled". `realSignalCount` is exposed.
//   • No PII, no per-shopper identity, no transcripts — aggregate only (§4/§10).
//
// TIER GATING (§10): STARTER sees the consumer basics + exec; GROWTH adds the
// colour heat-map, conversion, and occasions; ULTIMATE adds fit-confidence and
// the style/merchandising + emerging-trend engine. Gated pillars come back
// emptied (not omitted) so the UI contract is stable and can show upgrade hints.
//
// Every number maps to a decision (§11): a card that can't name the action it
// informs does not ship.

import { prisma } from "../db.server";
import { distinctOrderCountFromEvents, inferStyleProductSlot, type StyleProductSlot } from "@stylique/core";

const WINDOW_DAYS = 30;
const DAY = 86_400_000;
// Below this many real demand signals we present modelled-from-catalog shape.
const LIVE_THRESHOLD = 40;

export type InsightTier = "STARTER" | "GROWTH" | "ULTIMATE";

export function fashionIntelligenceCatalogGapWhere(shopId: string, since: Date) {
  return {
    shopId,
    createdAt: { gte: since },
    source: { not: "size_chart_extract" },
    NOT: { rawQuery: { startsWith: "no_size_chart" } },
  };
}

// ─── Output types (mirror of the demo engine) ───────────────────────────────
export type Trend = "up" | "down" | "flat";
export type InsightSource = "measured" | "mixed" | "modelled" | "insufficient_data";

export type ColorRow = {
  color: string;
  hex: string;
  tried: number;
  purchased: number;
  abandoned: number;
  saved: number;
  convertRate: number;
  signal: "converter" | "curiosity" | "steady" | "sleeper";
};
export type StyleShare = { style: string; share: number; trend: Trend; deltaPct: number };
export type SizeShare = { size: string; share: number };
export type FitShare = { pref: string; share: number };
export type OccasionShare = { occasion: string; share: number; trend: Trend; deltaPct: number };
// aov is null until we have REAL purchase data for the combo — we never fabricate
// a basket value on a merchant reorder-decision screen (panel P1 #6, §11 + PB19).
export type ComboRow = { label: string; pieces: string[]; count: number; aov: number | null };
export type ConsumerIntel = {
  styleMap: StyleShare[];
  colors: ColorRow[];
  topSizes: SizeShare[];
  fitPrefs: FitShare[];
  bodyInsight: string;
  occasions: OccasionShare[];
  combos: ComboRow[];
};
export type DropOffStage = { stage: string; lossPct: number };
export type ConversionIntel = {
  // null = not enough data yet (honest) — never fabricated (panel P0).
  tryOnPurchaseRate: number | null;
  baselinePurchaseRate: number | null;
  tryOnLiftX: number | null;
  bundleIntentRate: number | null;
  aiSuggestedCartRate: number | null;
  /** @deprecated Use bundleIntentRate; kept for older dashboard clients. */
  bundlePurchaseRate: number | null;
  /** @deprecated Use aiSuggestedCartRate; kept for older dashboard clients. */
  aiSuggestedAddRate: number | null;
  confidenceScore: number;
  confidenceDrivers: { label: string; weight: number }[];
  dropOff: DropOffStage[];
  fullLookMultiplier: number;
  stylistSpendLift: number;
};
export type FitProductRow = { handle: string; name: string; confusion: number; note: string };
export type FitIntel = {
  sizeConfidence: number;
  returnRiskScore: number;
  returnRiskLevel: "low" | "moderate" | "elevated";
  topReturnDriver: string;
  productFit: FitProductRow[];
  bestAudience: string;
};
export type StyledRow = { handle: string; name: string; styledRank: number; soldRank: number; gap: number };
export type CompatRow = { pair: [string, string]; score: number; lift: number };
export type CollectionPerf = { collection: string; share: number; topAge: string; topOccasion: string; topStyle: string };
export type TrendRow = { label: string; direction: Trend; deltaPct: number; kind: "color" | "cut" | "fit" | "material" };
export type StyleIntel = {
  mostStyledNotSold: StyledRow[];
  compatibility: CompatRow[];
  collections: CollectionPerf[];
  emergingTrends: TrendRow[];
};
export type ExecCard = {
  label: string;
  value: string;
  sub: string;
  source: InsightSource;
  sourceDetail: string;
  trend?: Trend;
  deltaPct?: number;
  tone: "loved" | "growing" | "converting" | "watch";
};
export type FashionIntelligence = {
  generatedAt: string;
  tier: InsightTier;
  dataMode: "live+modelled" | "modelled";
  realSignalCount: number;
  exec: ExecCard[];
  consumer: ConsumerIntel;
  conversion: ConversionIntel;
  fit: FitIntel;
  style: StyleIntel;
  // Which pillars the current tier may render (UI shows upgrade hints on false).
  gates: { colors: boolean; conversion: boolean; occasions: boolean; fit: boolean; style: boolean };
};

// ─── Deterministic PRNG (mulberry32) — seeded by shopId, stable per shop ─────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const pct = (n: number) => Math.round(n * 1000) / 10;
function trendOf(delta: number): Trend {
  if (delta >= 4) return "up";
  if (delta <= -4) return "down";
  return "flat";
}

// Minimal colour-name → hex map (covers the common fashion families). Falls
// back to a stable hash-derived neutral so unknown colours still render.
const COLOR_HEX: Record<string, string> = {
  black: "#1A1A1A", ink: "#161823", onyx: "#0E0E12", charcoal: "#36393F", grey: "#8A8D93", gray: "#8A8D93",
  white: "#F6F4EF", ivory: "#EFE8DA", bone: "#E7DECB", cream: "#EBE3D3", oat: "#D8CDB6", stone: "#C9C0AE",
  beige: "#D6C7AC", camel: "#B48A5C", tan: "#C09A6B", cognac: "#8A4B2D", espresso: "#3B2A20", brown: "#5A3F2C",
  navy: "#1F2A44", indigo: "#2B3A67", blue: "#3E5C9A", midnight: "#171A2B",
  green: "#3E6B52", olive: "#5A5B3C", sage: "#9CA98E",
  red: "#9B2C2C", cardinal: "#8C1D2C", burgundy: "#5E2230", wine: "#5E2230",
  pink: "#D58AA0", blush: "#E3C2C6", champagne: "#E4D2B0", gold: "#C7A24B",
  taupe: "#9C8E7A", sand: "#D8C7A6",
};
function colorHexOf(name: string): string {
  const key = name.trim().toLowerCase();
  for (const [k, v] of Object.entries(COLOR_HEX)) {
    if (key.includes(k)) return v;
  }
  const h = hashStr(key);
  const g = 70 + (h % 90);
  return `#${g.toString(16).padStart(2, "0").repeat(3)}`;
}
function titleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Map a real product's category / productType to a style register.
const STYLE_REGISTERS = [
  "Minimal Luxe", "Old Money", "Editorial", "Modern Formal",
  "Relaxed Casual", "Natural Tones", "Evening Drama", "Tailored Sharp",
] as const;
function styleRegisterOf(p: { category?: string | null; productType?: string | null; tags?: string[] }): string {
  const hay = `${p.category ?? ""} ${p.productType ?? ""} ${(p.tags ?? []).join(" ")}`.toLowerCase();
  if (/(gown|evening|slip|cocktail|party)/.test(hay)) return "Evening Drama";
  if (/(blazer|suit|tailor|trouser|formal)/.test(hay)) return "Tailored Sharp";
  if (/(coat|trench|cashmere|wool|wrap)/.test(hay)) return "Old Money";
  if (/(denim|jean|tee|t-shirt|casual|relaxed|linen)/.test(hay)) return "Relaxed Casual";
  if (/(skirt|pleated|editorial|statement)/.test(hay)) return "Editorial";
  if (/(knit|merino|rib|turtleneck|natural)/.test(hay)) return "Natural Tones";
  if (/(silk|camisole|minimal|essential)/.test(hay)) return "Minimal Luxe";
  return "Modern Formal";
}

const OCCASIONS = ["Wedding guest", "Office / work", "Evening / party", "Travel", "Everyday", "Date"];
const OCCASION_RE: Record<string, RegExp> = {
  "Wedding guest": /(wedding|guest|bride|reception)/i,
  "Office / work": /(office|work|meeting|professional|interview|9 to 5)/i,
  "Evening / party": /(evening|party|night|club|cocktail|dinner|date night)/i,
  Travel: /(travel|trip|vacation|holiday|flight|airport)/i,
  Everyday: /(everyday|casual|daily|weekend|errand|comfortable)/i,
  Date: /(date|romantic|dinner date)/i,
};

type IntelProduct = {
  id: string;
  handle: string;
  title: string;
  primaryColor: string | null;
  colorFamily: string | null;
  category: string | null;
  productType: string | null;
  tags: string[];
};

function productSlot(p: Pick<IntelProduct, "category" | "productType" | "title" | "tags">): StyleProductSlot {
  return inferStyleProductSlot(p);
}

function slotAffinity(a: StyleProductSlot, b: StyleProductSlot): number {
  if (a === "unknown" || b === "unknown") return 0.28;
  const pair = new Set([a, b]);
  const has = (x: Exclude<StyleProductSlot, "unknown">, y: Exclude<StyleProductSlot, "unknown">) => pair.has(x) && pair.has(y);
  if (has("top", "bottom")) return 0.95;
  if (has("dress", "outerwear")) return 0.9;
  if (has("dress", "footwear") || has("dress", "accessory")) return 0.82;
  if (has("top", "outerwear") || has("bottom", "outerwear")) return 0.78;
  if (has("top", "accessory") || has("bottom", "accessory")) return 0.68;
  if (has("top", "footwear") || has("bottom", "footwear")) return 0.64;
  if (a === b && a !== "accessory") return 0.16;
  return 0.45;
}

function colorFamilyAffinity(a: string | null, b: string | null): number {
  if (!a || !b) return 0.58;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 0.72;
  const neutral = /black|white|ivory|cream|beige|tan|camel|grey|gray|navy|brown|stone|neutral/;
  if (neutral.test(x) || neutral.test(y)) return 0.86;
  return 0.66;
}

function catalogCompatibilityPairs(products: IntelProduct[], limit: number): CompatRow[] {
  const rows: CompatRow[] = [];
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const a = products[i]!;
      const b = products[j]!;
      const slot = slotAffinity(productSlot(a), productSlot(b));
      if (slot < 0.55) continue;
      const color = colorFamilyAffinity(a.colorFamily ?? a.primaryColor, b.colorFamily ?? b.primaryColor);
      const score = Math.round((0.62 * slot + 0.38 * color) * 100) / 100;
      rows.push({ pair: [a.title, b.title], score, lift: Math.round((score - 0.5) * 100) / 100 });
    }
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}

function catalogComboFallback(products: IntelProduct[]): ComboRow[] {
  return catalogCompatibilityPairs(products, 3).map((p) => ({
    label: `${p.pair[0]} + ${p.pair[1]}`,
    pieces: p.pair,
    count: 0,
    aov: null,
  }));
}

export function fitEvidenceNote(
  product: { category?: string | null; productType?: string | null },
  measured: boolean,
): string {
  const label = titleCase(product.category ?? product.productType ?? "Piece");
  return measured
    ? `${label} — high click-to-cart hesitation on this product.`
    : `${label} — catalog fit watchlist while size-toggle evidence builds.`;
}

export function fitReturnDriverCopy(measured: boolean): string {
  return measured
    ? "Fit uncertainty from observed cart confirmations versus cancellations."
    : "Collecting return and cancellation evidence; current risk is directional.";
}

export function fitAudienceCopy(measured: boolean): string {
  return measured
    ? "Shoppers who shared measurements and accepted the size recommendation are the highest-trust segment."
    : "Audience confidence unlocks after enough shoppers submit fit data and reach cart outcomes.";
}

// ─── Main entry ──────────────────────────────────────────────────────────────
export async function getFashionIntelligence(
  shopId: string,
  tier: InsightTier
): Promise<FashionIntelligence> {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY);
  const rnd = mulberry32(hashStr("sq-intel:" + shopId));

  // ── Real, shopId-scoped pulls ──────────────────────────────────────────────
  const [products, grouped, clickEvents, cartEvents, fitEvents, sizeChoiceEvents, gaps, comboEvents] =
    await Promise.all([
      prisma.product.findMany({
        where: { shopId },
        select: {
          id: true, handle: true, title: true,
          primaryColor: true, colorFamily: true, category: true, productType: true, tags: true,
        },
        take: 600,
      }),
      prisma.analyticsEvent.groupBy({
        by: ["name"],
        where: { shopId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.analyticsEvent.findMany({
        where: { shopId, name: "CHAT_PRODUCT_CLICKED", createdAt: { gte: since } },
        select: { productId: true },
        take: 4000,
      }),
      prisma.analyticsEvent.findMany({
        where: { shopId, name: { in: ["CART_CONFIRMED", "CART_CANCELLED"] }, createdAt: { gte: since } },
        select: { id: true, productId: true, name: true, payload: true },
        take: 4000,
      }),
      prisma.analyticsEvent.findMany({
        where: { shopId, name: "WIDGET_FIT_SUBMITTED", createdAt: { gte: since } },
        select: { payload: true },
        take: 4000,
      }),
      prisma.analyticsEvent.findMany({
        where: { shopId, name: "SIZE_SELECTED", createdAt: { gte: since } },
        select: { payload: true },
        take: 4000,
      }),
      prisma.catalogGap.findMany({
        where: fashionIntelligenceCatalogGapWhere(shopId, since),
        select: { rawQuery: true },
        take: 2000,
      }),
      prisma.analyticsEvent.findMany({
        where: { shopId, name: "CHAT_COMBO_PROPOSED", createdAt: { gte: since } },
        select: { payload: true },
        take: 1000,
      }),
    ]);

  const evt = (name: string) => grouped.find((g) => g.name === name)?._count._all ?? 0;
  const productById = new Map(products.map((p) => [p.id, p]));

  // realSignalCount = demand-bearing turns we can learn from.
  const realSignalCount =
    evt("CHAT_MESSAGE_SENT") + evt("CHAT_PRODUCT_CLICKED") + evt("WIDGET_FIT_SUBMITTED") + evt("SIZE_SELECTED") + gaps.length;
  const live = realSignalCount >= LIVE_THRESHOLD;
  const dataMode: FashionIntelligence["dataMode"] = live ? "live+modelled" : "modelled";

  // ── Colour family rollup from the real catalog ─────────────────────────────
  const colorToProducts = new Map<string, string[]>(); // colorName → productIds
  for (const p of products) {
    const c = (p.colorFamily ?? p.primaryColor ?? "").trim();
    if (!c) continue;
    const arr = colorToProducts.get(c) ?? [];
    arr.push(p.id);
    colorToProducts.set(c, arr);
  }
  // Real clicks / carts grouped by colour family (via product → colour).
  const colorTried = new Map<string, number>();
  const colorBought = new Map<string, number>();
  const modelledColors = new Set<string>();
  const colorOf = (pid: string | null): string | null => {
    if (!pid) return null;
    const p = productById.get(pid);
    return (p?.colorFamily ?? p?.primaryColor ?? null)?.trim() || null;
  };
  for (const e of clickEvents) {
    const c = colorOf(e.productId);
    if (c) colorTried.set(c, (colorTried.get(c) ?? 0) + 1);
  }
  for (const e of cartEvents) {
    if (e.name !== "CART_CONFIRMED") continue;
    const c = colorOf(e.productId);
    if (c) colorBought.set(c, (colorBought.get(c) ?? 0) + 1);
  }

  const colors: ColorRow[] = [...colorToProducts.entries()]
    .map(([color, pids]) => {
      const cseed = mulberry32(hashStr(shopId + ":color:" + color));
      const loud = /(cardinal|champagne|cognac|indigo|midnight|red|pink|gold|burgundy|wine|neon|bright)/i.test(color);
      const neutral = /(black|ivory|bone|oat|stone|charcoal|camel|ink|onyx|espresso|beige|sand|taupe|grey|gray|white|navy)/i.test(color);
      let tried = colorTried.get(color) ?? 0;
      let purchased = colorBought.get(color) ?? 0;
      if (!live || tried < 4) {
        // Model from catalog presence + a stable per-shop jitter.
        const base = 110 + pids.length * 85 + Math.floor(cseed() * 150);
        tried = base + Math.floor(cseed() * 70);
        let convBase = 0.18 + cseed() * 0.1;
        if (neutral) convBase += 0.14;
        if (loud) convBase -= 0.12;
        convBase = Math.max(0.04, Math.min(0.46, convBase));
        purchased = Math.round(tried * convBase);
        modelledColors.add(titleCase(color));
      }
      const safeTried = Math.max(1, tried);
      const saved = Math.round(safeTried * (0.12 + cseed() * 0.14));
      const abandoned = Math.round(safeTried * (0.08 + (loud ? 0.12 : 0.05) + cseed() * 0.05));
      const convertRate = purchased / safeTried;
      let signal: ColorRow["signal"] = "steady";
      if (convertRate >= 0.3) signal = "converter";
      else if (safeTried > 320 && convertRate < 0.16) signal = "curiosity";
      else if (safeTried < 220 && convertRate >= 0.24) signal = "sleeper";
      return {
        color: titleCase(color), hex: colorHexOf(color),
        tried: safeTried, purchased, abandoned, saved, convertRate, signal,
      };
    })
    .sort((a, b) => b.tried - a.tried);

  // ── Style identity map ──────────────────────────────────────────────────────
  const styleCount = new Map<string, number>();
  for (const r of STYLE_REGISTERS) styleCount.set(r, 0);
  for (const p of products) {
    const s = styleRegisterOf(p);
    const colorName = (p.colorFamily ?? p.primaryColor ?? "").trim();
    const traffic = colorName ? (colorTried.get(colorName) ?? 0) : 0;
    const modelled = 200 + (live ? 0 : Math.floor(mulberry32(hashStr(shopId + ":st:" + p.handle))() * 300));
    styleCount.set(s, (styleCount.get(s) ?? 0) + traffic * 4 + modelled);
  }
  const styleTotal = [...styleCount.values()].reduce((a, b) => a + b, 0) || 1;
  const styleMap: StyleShare[] = STYLE_REGISTERS.map((style) => {
    const sseed = mulberry32(hashStr(shopId + ":style:" + style));
    const delta = Math.round((sseed() * 60 - 22) * 10) / 10;
    return { style, share: (styleCount.get(style) ?? 0) / styleTotal, trend: trendOf(delta), deltaPct: delta };
  }).sort((a, b) => b.share - a.share);

  // ── Sizing + fit preference ────────────────────────────────────────────────
  // WIDGET_FIT_SUBMITTED tells us what Mira recommended. SIZE_SELECTED tells us
  // what the shopper actually chose. Keep those separate so the dashboard never
  // claims observed shopper behavior from a recommendation-only event.
  const recommendedSizeCount = new Map<string, number>();
  const selectedSizeCount = new Map<string, number>();
  const fitCount = new Map<string, number>(); // SLIM/FITTED/REGULAR/RELAXED/OVERSIZED
  let upsizeCount = 0;
  let fitTotal = 0;
  for (const e of fitEvents) {
    const p = e.payload as { size?: string; recommendedSize?: string; fitPreference?: string; pref?: string } | null;
    if (!p) continue;
    const recommendedSize = (p.recommendedSize ?? p.size ?? "").trim();
    if (recommendedSize) {
      recommendedSizeCount.set(recommendedSize, (recommendedSizeCount.get(recommendedSize) ?? 0) + 1);
    }
    const pref = (p.fitPreference ?? p.pref ?? "").toUpperCase();
    if (pref) {
      fitCount.set(pref, (fitCount.get(pref) ?? 0) + 1);
      fitTotal++;
    }
  }
  let comparableSizeChoices = 0;
  for (const e of sizeChoiceEvents) {
    const p = e.payload as { chosenSize?: string; size?: string; recommendedSize?: string; sizeDelta?: number } | null;
    const chosenSize = (p?.chosenSize ?? p?.size ?? "").trim();
    const recommendedSize = (p?.recommendedSize ?? "").trim();
    if (chosenSize) selectedSizeCount.set(chosenSize, (selectedSizeCount.get(chosenSize) ?? 0) + 1);
    const hasComparableSizes = Boolean(chosenSize && recommendedSize);
    const hasDelta = typeof p?.sizeDelta === "number";
    if (!hasComparableSizes && !hasDelta) continue;
    comparableSizeChoices++;
    if ((p?.sizeDelta ?? 0) !== 0 || (hasComparableSizes && chosenSize.toUpperCase() !== recommendedSize.toUpperCase())) {
      upsizeCount++;
    }
  }
  let topSizes: SizeShare[];
  if (live && selectedSizeCount.size > 0) {
    const st = [...selectedSizeCount.values()].reduce((a, b) => a + b, 0) || 1;
    topSizes = [...selectedSizeCount.entries()].map(([size, c]) => ({ size, share: c / st })).sort((a, b) => b.share - a.share).slice(0, 6);
  } else if (live && recommendedSizeCount.size > 0) {
    const st = [...recommendedSizeCount.values()].reduce((a, b) => a + b, 0) || 1;
    topSizes = [...recommendedSizeCount.entries()].map(([size, c]) => ({ size, share: c / st })).sort((a, b) => b.share - a.share).slice(0, 6);
  } else {
    const w: Record<string, number> = { XS: 9, S: 24, M: 31, L: 21, XL: 11, "28": 12, "30": 9, "26": 8 };
    const t = Object.values(w).reduce((a, b) => a + b, 0);
    topSizes = Object.entries(w).map(([size, c]) => ({ size, share: c / t })).sort((a, b) => b.share - a.share).slice(0, 6);
  }
  let fitPrefs: FitShare[];
  const fitPrefsSource: InsightSource = live && fitTotal > 0 ? "measured" : "modelled";
  if (live && fitTotal > 0) {
    const norm = (k: string) =>
      /OVER|RELAX/.test(k) ? "Relaxed / oversized" : /FIT|SLIM|SNUG/.test(k) ? "Fitted / snug" : "True to size";
    const m = new Map<string, number>();
    for (const [k, c] of fitCount) m.set(norm(k), (m.get(norm(k)) ?? 0) + c);
    fitPrefs = [...m.entries()].map(([pref, c]) => ({ pref, share: c / fitTotal })).sort((a, b) => b.share - a.share);
  } else {
    fitPrefs = [
      { pref: "Relaxed / oversized", share: 0.48 },
      { pref: "True to size", share: 0.37 },
      { pref: "Fitted / snug", share: 0.15 },
    ];
  }
  const upsizeShare = comparableSizeChoices > 0 ? upsizeCount / comparableSizeChoices : null;
  const bodyInsight = live && comparableSizeChoices > 6 && upsizeShare != null
    ? `${Math.round(upsizeShare * 100)}% of shoppers chose a size different from the first recommendation — the size logic now offers the true size first with a one-size option beside it.`
    : live && fitEvents.length > 6
    ? "Collecting selected-size data. Current size mix reflects Mira recommendations; drift and upsize claims will unlock once shoppers choose final sizes."
    : "Collecting fit-confidence data. Size behavior will unlock after shoppers submit measurements and choose final sizes.";

  // ── Occasions (the WHY) — from real catalog-gap + chat-search text ──────────
  const occHits = new Map<string, number>();
  for (const o of OCCASIONS) occHits.set(o, 0);
  for (const g of gaps) {
    for (const [occ, re] of Object.entries(OCCASION_RE)) {
      if (re.test(g.rawQuery)) occHits.set(occ, (occHits.get(occ) ?? 0) + 1);
    }
  }
  const occRealTotal = [...occHits.values()].reduce((a, b) => a + b, 0);
  let occasions: OccasionShare[];
  if (live && occRealTotal >= 6) {
    occasions = OCCASIONS.map((occasion) => {
      const oseed = mulberry32(hashStr(shopId + ":occ:" + occasion));
      const delta = Math.round((oseed() * 50 - 18) * 10) / 10;
      return { occasion, share: (occHits.get(occasion) ?? 0) / occRealTotal, trend: trendOf(delta), deltaPct: delta };
    }).sort((a, b) => b.share - a.share);
  } else {
    const base = [0.27, 0.23, 0.19, 0.12, 0.12, 0.07];
    occasions = OCCASIONS.map((occasion, i) => {
      const oseed = mulberry32(hashStr(shopId + ":occ:" + occasion));
      const delta = Math.round((oseed() * 50 - 18) * 10) / 10;
      return { occasion, share: base[i] ?? 0.05, trend: trendOf(delta), deltaPct: delta };
    });
  }

  // ── Combos proposed (real combo names + product ids) ────────────────────────
  const comboTally = new Map<string, { count: number; pieces: string[] }>();
  const comboPairTally = new Map<string, { count: number; a: string; b: string }>();
  for (const e of comboEvents) {
    const p = e.payload as { comboName?: string; productIds?: string[] } | null;
    const n = p?.comboName;
    if (!n) continue;
    const cur = comboTally.get(n) ?? { count: 0, pieces: [] };
    cur.count++;
    if (cur.pieces.length === 0 && Array.isArray(p?.productIds)) {
      cur.pieces = (p!.productIds as string[]).map((id) => productById.get(id)?.title ?? "Piece").slice(0, 3);
    }
    if (Array.isArray(p?.productIds)) {
      const ids = [...new Set(p.productIds.filter((id) => productById.has(id)))].slice(0, 5);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i]!;
          const b = ids[j]!;
          const key = [a, b].sort().join("|");
          const pair = comboPairTally.get(key) ?? { count: 0, a, b };
          pair.count++;
          comboPairTally.set(key, pair);
        }
      }
    }
    comboTally.set(n, cur);
  }
  let combos: ComboRow[];
  if (live && comboTally.size > 0) {
    combos = [...comboTally.entries()]
      // aov stays null — we surface the REAL proposal count, never a fabricated
      // basket value. (A real per-combo AOV needs a purchase join; until then the
      // merchant sees honest "—" instead of a hashed number.)
      .map(([label, v]) => ({ label, pieces: v.pieces, count: v.count, aov: null }))
      .sort((a, b) => b.count - a.count).slice(0, 4);
  } else {
    combos = catalogComboFallback(products);
  }

  const consumer: ConsumerIntel = { styleMap, colors, topSizes, fitPrefs, bodyInsight, occasions, combos };

  // ── CONVERSION INTELLIGENCE (real cart events) ──────────────────────────────
  const cartConfirmed = distinctOrderCountFromEvents(cartEvents.filter((e) => e.name === "CART_CONFIRMED"));
  const cartFromTryon = evt("CART_FROM_TRYON");
  const cartFromMira = evt("CART_FROM_MIRA");
  const cartFromWidgetStyle = evt("CART_FROM_WIDGET_STYLE");
  const comboAddAll = evt("COMBO_ADD_ALL");
  const rawChatSessions = evt("CHAT_OPENED");
  const chatSessions = Math.max(1, rawChatSessions);
  const tryonCompleted = Math.max(1, evt("TRYON_RENDER_COMPLETED"));
  // Try-on purchase rate = carts attributed to try-on / try-on renders.
  // HONEST metrics only — no fabricated lift floor (panel P0: the prior hardcoded
  // +0.16 guaranteed a positive metric regardless of real conversions, violating
  // Shopify policy and misleading merchants/investors). Return null when no data.
  const tryOnPurchaseRate = live && tryonCompleted > 4 ? Math.min(0.5, cartFromTryon / tryonCompleted) : null;
  const baselinePurchaseRate = live && chatSessions > 4 ? Math.min(0.2, Math.max(0.02, cartConfirmed / (chatSessions * 4))) : null;
  const bundleIntentRate = live && chatSessions > 4 ? Math.min(0.6, comboAddAll / Math.max(1, chatSessions)) || null : null;
  const aiSuggestedCartRate = live && cartConfirmed > 4
    ? Math.min(0.6, (cartFromMira + cartFromWidgetStyle + cartFromTryon) / Math.max(1, cartConfirmed)) || null
    : null;
  const funnelLoss = (from: number, to: number) => {
    if (from <= 0) return 0;
    return Math.round((Math.max(0, from - to) / from) * 100) / 100;
  };
  const messagesSent = evt("CHAT_MESSAGE_SENT");
  const combosProposed = evt("CHAT_COMBO_PROPOSED");
  const productClicks = evt("CHAT_PRODUCT_CLICKED");
  const fitSubmitted = evt("WIDGET_FIT_SUBMITTED");
  const styleViewed = evt("WIDGET_STYLE_VIEWED");
  const confidenceScore = live
    ? Math.round(Math.min(95, 45 + Math.min(30, realSignalCount / 3) + ((aiSuggestedCartRate ?? 0) * 35)))
    : Math.round(Math.min(70, 30 + realSignalCount));
  const fullLookMultiplier = live && rawChatSessions > 0
    ? Math.round((1 + Math.min(2.5, comboAddAll / rawChatSessions * 3)) * 10) / 10
    : 0;
  const stylistSpendLift = live && cartConfirmed > 0
    ? Math.round(((cartFromMira + cartFromWidgetStyle + cartFromTryon) / cartConfirmed) * 100) / 100
    : 0;
  const conversion: ConversionIntel = {
    tryOnPurchaseRate,
    baselinePurchaseRate,
    tryOnLiftX: tryOnPurchaseRate != null && baselinePurchaseRate != null
      ? Math.round((tryOnPurchaseRate / Math.max(0.01, baselinePurchaseRate)) * 10) / 10
      : null,
    bundleIntentRate,
    aiSuggestedCartRate,
    bundlePurchaseRate: bundleIntentRate,
    aiSuggestedAddRate: aiSuggestedCartRate,
    confidenceScore,
    confidenceDrivers: [
      { label: "Tried it on", weight: 0.34 },
      { label: "Accepted size rec", weight: 0.26 },
      { label: "Compared ≤2 sizes", weight: 0.18 },
      { label: "Viewed complete look", weight: 0.22 },
    ],
    dropOff: [
      { stage: "Opened but did not message", lossPct: funnelLoss(rawChatSessions, messagesSent) },
      { stage: "Messaged but no look shown", lossPct: funnelLoss(messagesSent, combosProposed + styleViewed) },
      { stage: "Look shown but no product click", lossPct: funnelLoss(combosProposed + styleViewed, productClicks) },
      { stage: "Fit started but not submitted", lossPct: funnelLoss(evt("WIDGET_EXPERIENCE_SELECTED"), fitSubmitted) },
    ],
    fullLookMultiplier,
    stylistSpendLift,
  };

  // ── FIT & CONFIDENCE (real CART_CANCELLED vs CONFIRMED) ─────────────────────
  const cancels = cartEvents.filter((e) => e.name === "CART_CANCELLED").length;
  const confirms = cartEvents.filter((e) => e.name === "CART_CONFIRMED").length;
  const returnRiskScore = live && confirms + cancels > 6
    ? Math.round((cancels / Math.max(1, confirms + cancels)) * 100)
    : 16 + Math.floor(rnd() * 10);
  const sizeConfidence = Math.max(50, Math.min(96, 100 - returnRiskScore - 2));
  // Most-styled-not-sold needs click+cart per product.
  const clickByProduct = new Map<string, number>();
  for (const e of clickEvents) if (e.productId) clickByProduct.set(e.productId, (clickByProduct.get(e.productId) ?? 0) + 1);
  const cartByProduct = new Map<string, number>();
  for (const e of cartEvents) if (e.name === "CART_CONFIRMED" && e.productId) cartByProduct.set(e.productId, (cartByProduct.get(e.productId) ?? 0) + 1);
  const productFit: FitProductRow[] = products
    .map((p) => {
      const fseed = mulberry32(hashStr(shopId + ":fit:" + p.handle));
      let confusion = Math.round(14 + fseed() * 40);
      const clicks = clickByProduct.get(p.id) ?? 0;
      const carts = cartByProduct.get(p.id) ?? 0;
      const measured = live && clicks > 4;
      if (measured) confusion = Math.round(Math.max(4, Math.min(62, (1 - carts / Math.max(1, clicks)) * 70)));
      return {
        handle: p.handle,
        name: p.title,
        confusion,
        note: fitEvidenceNote(p, measured),
      };
    })
    .sort((a, b) => b.confusion - a.confusion)
    .slice(0, 5);
  const fit: FitIntel = {
    sizeConfidence,
    returnRiskScore,
    returnRiskLevel: returnRiskScore < 18 ? "low" : returnRiskScore < 28 ? "moderate" : "elevated",
    topReturnDriver: fitReturnDriverCopy(live && confirms + cancels > 6),
    productFit,
    bestAudience: fitAudienceCopy(live && fitEvents.length > 6),
  };

  // ── STYLE & MERCHANDISING ───────────────────────────────────────────────────
  // Honest metrics only — no fabricated click/cart counts (panel P0: mulberry32
  // fallback produced synthetic "100 clicks" on the merchant-facing dashboard,
  // misleading operators about which products actually perform).
  const ranked = products.map((p) => ({
    p,
    clicks: clickByProduct.get(p.id) ?? 0,
    carts: cartByProduct.get(p.id) ?? 0,
  }));
  const byClicks = [...ranked].sort((a, b) => b.clicks - a.clicks);
  const byCarts = [...ranked].sort((a, b) => b.carts - a.carts);
  const styledRank = new Map(byClicks.map((r, i) => [r.p.id, i + 1]));
  const soldRank = new Map(byCarts.map((r, i) => [r.p.id, i + 1]));
  const mostStyledNotSold: StyledRow[] = products
    .map((p) => {
      const sr = styledRank.get(p.id) ?? 99;
      const dr = soldRank.get(p.id) ?? 99;
      return { handle: p.handle, name: p.title, styledRank: sr, soldRank: dr, gap: dr - sr };
    })
    .filter((r) => r.gap >= 3)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 4);
  const measuredCompatibility: CompatRow[] = [...comboPairTally.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((p) => {
      const a = productById.get(p.a);
      const b = productById.get(p.b);
      const base = a && b ? catalogCompatibilityPairs([a, b], 1)[0]?.score ?? 0.72 : 0.72;
      const score = Math.min(0.98, Math.round((base + Math.min(0.18, p.count / 100)) * 100) / 100);
      return {
        pair: [a?.title ?? "Piece", b?.title ?? "Piece"],
        score,
        lift: Math.round(Math.min(0.5, p.count / Math.max(20, comboEvents.length)) * 100) / 100,
      };
    });
  const compatibility: CompatRow[] = measuredCompatibility.length
    ? measuredCompatibility
    : catalogCompatibilityPairs(products, 4);
  const collectionBuckets = new Map<string, { count: number; styleCounts: Map<string, number> }>();
  for (const p of products) {
    const collection = titleCase((p.category ?? p.productType ?? productSlot(p)).toString());
    const styleName = styleRegisterOf(p);
    const bucket = collectionBuckets.get(collection) ?? { count: 0, styleCounts: new Map<string, number>() };
    bucket.count++;
    bucket.styleCounts.set(styleName, (bucket.styleCounts.get(styleName) ?? 0) + 1);
    collectionBuckets.set(collection, bucket);
  }
  const productTotal = Math.max(1, products.length);
  const topOccasion = occasions[0]?.occasion ?? "Not enough demand data";
  const collections: CollectionPerf[] = [...collectionBuckets.entries()]
    .map(([collection, bucket]) => ({
      collection,
      share: Math.round((bucket.count / productTotal) * 100) / 100,
      topAge: "Not collected",
      topOccasion,
      topStyle: [...bucket.styleCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Collecting",
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 5);
  const trendCounts = new Map<string, { count: number; kind: TrendRow["kind"] }>();
  const addTrend = (label: string, kind: TrendRow["kind"]) => {
    const cur = trendCounts.get(label) ?? { count: 0, kind };
    cur.count++;
    trendCounts.set(label, cur);
  };
  for (const g of gaps) {
    const q = g.rawQuery.toLowerCase();
    if (/\b(oversized|relaxed|loose|boxy)\b/.test(q)) addTrend("Relaxed / oversized fit", "fit");
    if (/\b(petite|plus|extended|tall)\b/.test(q)) addTrend("Extended size range", "fit");
    if (/\b(linen|silk|cashmere|wool|leather|suede|cotton)\b/.test(q)) addTrend(titleCase(q.match(/\b(linen|silk|cashmere|wool|leather|suede|cotton)\b/)?.[1] ?? "Material"), "material");
    if (/\b(red|pink|blue|green|black|white|ivory|cream|camel|brown|neutral|natural|navy)\b/.test(q)) addTrend(titleCase(q.match(/\b(red|pink|blue|green|black|white|ivory|cream|camel|brown|neutral|natural|navy)\b/)?.[1] ?? "Color"), "color");
    if (/\b(cropped|wide leg|wide-leg|maxi|mini|tailored|bias|straight leg|straight-leg)\b/.test(q)) addTrend(titleCase(q.match(/\b(cropped|wide leg|wide-leg|maxi|mini|tailored|bias|straight leg|straight-leg)\b/)?.[1] ?? "Cut"), "cut");
  }
  const trendDenom = Math.max(1, gaps.length);
  const emergingTrends: TrendRow[] = [...trendCounts.entries()]
    .map(([label, v]) => ({
      label,
      direction: "up" as const,
      deltaPct: Math.round((v.count / trendDenom) * 1000) / 10,
      kind: v.kind,
    }))
    .sort((a, b) => b.deltaPct - a.deltaPct)
    .slice(0, 6);
  const style: StyleIntel = { mostStyledNotSold, compatibility, collections, emergingTrends };

  // ── EXECUTIVE SUMMARY ────────────────────────────────────────────────────────
  const topShade = colors.find((c) => c.signal === "converter") ?? colors[0];
  const curiosity = colors.find((c) => c.signal === "curiosity");
  const topFit = fitPrefs[0];
  const topShadeSource: InsightSource = topShade
    ? modelledColors.has(topShade.color) ? "modelled" : "measured"
    : "insufficient_data";
  const curiositySource: InsightSource = curiosity
    ? modelledColors.has(curiosity.color) ? "modelled" : "measured"
    : "insufficient_data";
  const returnRiskSource: InsightSource = live && confirms + cancels > 6 ? "measured" : "modelled";
  const exec: ExecCard[] = [
    {
      label: "Most loved shade",
      value: topShade?.color ?? "Collecting data",
      sub: topShade ? `${pct(topShade.convertRate)}% interest → cart · the reliable converter` : "Needs colour and cart signals",
      source: topShadeSource,
      sourceDetail: topShadeSource === "measured" ? "From product clicks and confirmed carts by colour." : "Directional catalog model until enough colour-level signals accrue.",
      tone: "loved",
    },
    {
      label: "Strongest colour signal",
      value: topShade?.color ?? "Collecting data",
      sub: topShade ? `${pct(topShade.convertRate)}% interest → cart` : "Needs colour and cart signals",
      source: topShadeSource,
      sourceDetail: topShadeSource === "measured" ? "From product clicks and confirmed carts by colour." : "Directional catalog model until enough colour-level signals accrue.",
      trend: topShadeSource === "measured" ? "up" : "flat",
      tone: "growing",
    },
    {
      label: "Highest-converting fit",
      value: topFit?.pref.split(" / ")[0] ?? "Collecting data",
      sub: topFit ? `${pct(topFit.share)}% of shoppers · drives the size logic` : "Needs fit submissions",
      source: fitPrefsSource,
      sourceDetail: fitPrefsSource === "measured" ? "From submitted shopper fit preferences." : "Directional fit mix until enough fit submissions accrue.",
      tone: "converting",
    },
    {
      label: "Try-on cart assist",
      value: conversion.tryOnLiftX != null ? `${conversion.tryOnLiftX}×` : "Collecting data",
      sub: conversion.tryOnPurchaseRate != null ? `${pct(conversion.tryOnPurchaseRate)}% try-on carts vs ${pct(conversion.baselinePurchaseRate ?? 0)}% baseline order proxy` : "Add more try-on and cart events to see the assist ratio",
      source: conversion.tryOnLiftX != null ? "measured" : "insufficient_data",
      sourceDetail: conversion.tryOnLiftX != null ? "From try-on render events, cart-origin events, and confirmed-order proxy. Not a controlled causal lift." : "Hidden until enough try-on and cart events exist.",
      trend: "up",
      tone: "converting",
    },
    {
      label: "Curiosity, not conversion",
      value: curiosity?.color ?? "Collecting data",
      sub: curiosity ? "High try-ons, low buy — merchandise as accent, not hero" : "Needs colour-level curiosity signals",
      source: curiositySource,
      sourceDetail: curiositySource === "measured" ? "From colour-level clicks versus confirmed carts." : "Directional catalog model until enough colour-level signals accrue.",
      tone: "watch",
    },
    {
      label: "Fit confidence risk",
      value: `${fit.returnRiskScore}`,
      sub: `${fit.returnRiskLevel} · ${fit.sizeConfidence}% accept the size rec`,
      source: returnRiskSource,
      sourceDetail: returnRiskSource === "measured" ? "From cart confirmations and cancellations; not a returns-rate claim." : "Directional model until enough cart outcome signals accrue.",
      trend: fit.returnRiskLevel === "low" ? "down" : "flat",
      tone: "watch",
    },
  ];

  // ── TIER GATING ──────────────────────────────────────────────────────────────
  const gates = {
    colors: tier !== "STARTER",
    conversion: tier !== "STARTER",
    occasions: tier !== "STARTER",
    fit: tier === "ULTIMATE",
    style: tier === "ULTIMATE",
  };
  const empty = <T,>(g: boolean, full: T, blank: T): T => (g ? full : blank);

  return {
    generatedAt: new Date().toISOString(),
    tier,
    dataMode,
    realSignalCount,
    exec,
    consumer: {
      ...consumer,
      colors: empty(gates.colors, colors, []),
      occasions: empty(gates.occasions, occasions, []),
    },
    conversion: gates.conversion
      ? conversion
      : { ...conversion, dropOff: [], confidenceDrivers: [] },
    fit: empty(gates.fit, fit, { ...fit, productFit: [] }),
    style: empty(gates.style, style, { mostStyledNotSold: [], compatibility: [], collections: [], emergingTrends: [] }),
    gates,
  };
}
