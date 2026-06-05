// Stylique — Fashion Intelligence engine (demo).
//
// This is the layer the brand actually buys: not "how many people chatted" but
// four decision-grade intelligence pillars derived from shopper behavior:
//
//   1. CONSUMER INTELLIGENCE      — who is shopping, really. Style identity,
//      colour curiosity-vs-conversion, sizing + fit-preference distribution,
//      occasion (the WHY), and the combinations they actually wear together.
//   2. CONVERSION INTELLIGENCE    — the money. Try-on lift, recommendation
//      influence, a behavioural confidence score, where confidence is lost,
//      and complete-look economics.
//   3. FIT & CONFIDENCE           — the return-reduction weapon. Size confidence,
//      return-risk scoring, and which products cause fit confusion.
//   4. STYLE & MERCHANDISING      — most-styled (not most-sold) winners, outfit
//      compatibility, collection performance, and the emerging-trend engine.
//
// DATA SOURCE — honest demo posture.
//   • Real shopper signals (mira-signals.json: queries, intents, catalog gaps,
//     near-misses, conversions) are read live and folded in where present.
//   • Because a demo store has little organic traffic, engagement distributions
//     (colour try/purchase/abandon/save, size picks, occasions, combos, return
//     risk) are modelled DETERMINISTICALLY from the REAL catalog — real colours,
//     real price points, real fit notes, real keep-rates. The seed is fixed so
//     the dashboard is stable across reloads. This is the demo store showing a
//     brand the SHAPE of intelligence they'd get on their own live data.
//   • No PII, no per-shopper identity — same privacy posture as the learning
//     loop (D23 / PB17 / §3.5). Everything here is aggregate.
//
// Every number maps to a decision (CLAUDE.md §11): a card that can't name the
// action it informs does not ship.

import { products, colorHex, type Product } from "./catalog";
import { aggregateInsights, type InsightSummary } from "./mira-signals.server";

// ─── Deterministic PRNG (mulberry32) — stable demo, no Math.random flicker ───
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

// ─── Style identity registers (the founder's list) ──────────────────────────
// Each catalog piece leans toward a style identity; share is derived from how
// the catalog is weighted plus real demand intents.
const STYLE_REGISTERS = [
  "Minimal Luxe",
  "Old Money",
  "Editorial",
  "Modern Formal",
  "Relaxed Casual",
  "Natural Tones",
  "Evening Drama",
  "Tailored Sharp",
] as const;
type StyleRegister = (typeof STYLE_REGISTERS)[number];

// Map each product to a primary style register (grounded in its real identity).
const STYLE_BY_HANDLE: Record<string, StyleRegister> = {
  "onyx-silk-slip": "Evening Drama",
  "ivory-silk-camisole": "Minimal Luxe",
  "atelier-wide-leg-trouser": "Tailored Sharp",
  "linen-relaxed-shirt": "Relaxed Casual",
  "wrap-coat-camel": "Old Money",
  "cashmere-v-neck": "Minimal Luxe",
  "midnight-silk-gown": "Evening Drama",
  "tailored-blazer-double": "Modern Formal",
  "pleated-midi-skirt": "Editorial",
  "merino-ribbed-turtleneck": "Natural Tones",
  "leather-trench": "Editorial",
  "wide-leg-denim": "Relaxed Casual",
};

const OCCASIONS = [
  "Wedding guest",
  "Office / work",
  "Evening / party",
  "Travel",
  "Everyday",
  "Date",
] as const;

// ─── Output types ────────────────────────────────────────────────────────────
export type Trend = "up" | "down" | "flat";

export type ColorRow = {
  color: string;
  hex: string;
  tried: number; // try-on / preview engagements
  purchased: number;
  abandoned: number; // added-then-dropped
  saved: number;
  convertRate: number; // purchased / tried, 0..1
  signal: "converter" | "curiosity" | "steady" | "sleeper";
};

export type StyleShare = { style: StyleRegister; share: number; trend: Trend; deltaPct: number };
export type SizeShare = { size: string; share: number };
export type FitShare = { pref: string; share: number };
export type OccasionShare = { occasion: string; share: number; trend: Trend; deltaPct: number };
export type ComboRow = { label: string; pieces: string[]; count: number; aov: number };

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
  tryOnPurchaseRate: number; // with try-on
  baselinePurchaseRate: number; // without try-on
  tryOnLiftX: number; // multiple
  bundlePurchaseRate: number; // bought a recommended bundle
  aiSuggestedAddRate: number; // added an AI-suggested item
  confidenceScore: number; // 0..100 composite
  confidenceDrivers: { label: string; weight: number }[];
  dropOff: DropOffStage[];
  fullLookMultiplier: number; // full-look bundles convert Nx better
  stylistSpendLift: number; // stylist users spend +N%
};

export type FitProductRow = { handle: string; name: string; confusion: number; note: string };
export type FitIntel = {
  sizeConfidence: number; // % who accept the recommended size
  returnRiskScore: number; // 0..100, lower is better
  returnRiskLevel: "low" | "moderate" | "elevated";
  topReturnDriver: string;
  productFit: FitProductRow[];
  bestAudience: string;
};

export type StyledRow = { handle: string; name: string; styledRank: number; soldRank: number; gap: number };
export type CompatRow = { pair: [string, string]; score: number; lift: number };
export type CollectionPerf = {
  collection: string;
  share: number;
  topAge: string;
  topOccasion: string;
  topStyle: string;
};
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
  trend?: Trend;
  deltaPct?: number;
  tone: "loved" | "growing" | "converting" | "watch";
};

export type FashionIntelligence = {
  generatedAt: string;
  dataMode: "live+modelled" | "modelled";
  realSignalCount: number;
  exec: ExecCard[];
  consumer: ConsumerIntel;
  conversion: ConversionIntel;
  fit: FitIntel;
  style: StyleIntel;
  learning: InsightSummary; // the existing learning-loop block, carried through
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pct = (n: number) => Math.round(n * 1000) / 10; // 0.283 → 28.3
function trendOf(delta: number): Trend {
  if (delta >= 4) return "up";
  if (delta <= -4) return "down";
  return "flat";
}

// Collect every colour the catalog actually offers, with the products it's on.
function catalogColors(): { color: string; onProducts: Product[] }[] {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    for (const c of p.colors) {
      const arr = map.get(c) ?? [];
      arr.push(p);
      map.set(c, arr);
    }
  }
  return [...map.entries()].map(([color, onProducts]) => ({ color, onProducts }));
}

// ─── The engine ────────────────────────────────────────────────────────────────
export async function buildFashionIntelligence(): Promise<FashionIntelligence> {
  const learning = await aggregateInsights();
  const realSignalCount = learning.totalConversations;
  const rnd = mulberry32(hashStr("stylique-maison-v1"));

  // ── COLOURS — curiosity vs conversion (the heat-map source) ────────────────
  const colors: ColorRow[] = catalogColors()
    .map(({ color, onProducts }) => {
      const cseed = mulberry32(hashStr("color:" + color));
      // Base traffic scales with how many pieces carry the colour + a stable jitter.
      const base = 120 + onProducts.length * 90 + Math.floor(cseed() * 160);
      const tried = base + Math.floor(cseed() * 80);
      // Neutral / classic colours convert; loud colours pull curiosity, not sales.
      const loud = /(cardinal|champagne|cognac|indigo|midnight)/i.test(color);
      const neutral = /(black|ivory|bone|oat|stone|charcoal|camel|ink|onyx|espresso)/i.test(color);
      let convBase = 0.18 + cseed() * 0.1;
      if (neutral) convBase += 0.14;
      if (loud) convBase -= 0.12;
      convBase = Math.max(0.04, Math.min(0.46, convBase));
      const purchased = Math.round(tried * convBase);
      const saved = Math.round(tried * (0.12 + cseed() * 0.14));
      const abandoned = Math.round(tried * (0.08 + (loud ? 0.12 : 0.05) + cseed() * 0.05));
      const convertRate = purchased / tried;
      let signal: ColorRow["signal"] = "steady";
      if (convertRate >= 0.3) signal = "converter";
      else if (tried > 320 && convertRate < 0.16) signal = "curiosity";
      else if (tried < 220 && convertRate >= 0.24) signal = "sleeper";
      return {
        color,
        hex: colorHex(color),
        tried,
        purchased,
        abandoned,
        saved,
        convertRate,
        signal,
      };
    })
    .sort((a, b) => b.tried - a.tried);

  // ── STYLE IDENTITY MAP ─────────────────────────────────────────────────────
  const styleCount = new Map<StyleRegister, number>();
  for (const p of products) {
    const s = STYLE_BY_HANDLE[p.handle] ?? "Minimal Luxe";
    // weight by colour traffic so popular pieces lift their register
    const traffic = colors
      .filter((c) => p.colors.includes(c.color))
      .reduce((sum, c) => sum + c.tried, 0);
    styleCount.set(s, (styleCount.get(s) ?? 0) + traffic + 200);
  }
  const styleTotal = [...styleCount.values()].reduce((a, b) => a + b, 0) || 1;
  const styleMap: StyleShare[] = STYLE_REGISTERS.map((style) => {
    const sseed = mulberry32(hashStr("style:" + style));
    const delta = Math.round((sseed() * 60 - 22) * 10) / 10; // -22..+38
    return {
      style,
      share: pct((styleCount.get(style) ?? 0) / styleTotal) / 100,
      trend: trendOf(delta),
      deltaPct: delta,
    };
  }).sort((a, b) => b.share - a.share);

  // ── SIZING + FIT PREFERENCE ────────────────────────────────────────────────
  // Distribution skews to S/M with a real oversized lean.
  const sizeWeights: Record<string, number> = { XS: 9, S: 24, M: 31, L: 21, XL: 11, "26": 8, "28": 12, "30": 9, "24": 4, "32": 5 };
  const sizeTotal = Object.values(sizeWeights).reduce((a, b) => a + b, 0);
  const topSizes: SizeShare[] = Object.entries(sizeWeights)
    .map(([size, w]) => ({ size, share: w / sizeTotal }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 6);
  const fitPrefs: FitShare[] = [
    { pref: "Relaxed / oversized", share: 0.48 },
    { pref: "True to size", share: 0.37 },
    { pref: "Fitted / snug", share: 0.15 },
  ];
  const bodyInsight =
    "65% of shoppers selecting an oversized fit still size up — the cut reads larger than the label. Recommendation logic now offers the true size first with a one-size-up option, not the reverse.";

  // ── OCCASIONS (the WHY) ────────────────────────────────────────────────────
  const occBase = [0.27, 0.23, 0.19, 0.12, 0.12, 0.07];
  const occasions: OccasionShare[] = OCCASIONS.map((occasion, i) => {
    const oseed = mulberry32(hashStr("occ:" + occasion));
    const delta = Math.round((oseed() * 50 - 18) * 10) / 10;
    return { occasion, share: occBase[i] ?? 0.05, trend: trendOf(delta), deltaPct: delta };
  });

  // ── STYLE COMBINATIONS (what they wear together) ───────────────────────────
  const combos: ComboRow[] = [
    {
      label: "The tailored neutral",
      pieces: ["Tailored Blazer", "Wide-Leg Trouser", "Silk Camisole"],
      count: 184,
      aov: 1750,
    },
    {
      label: "Evening, undone",
      pieces: ["Onyx Silk Slip", "Leather Trench"],
      count: 142,
      aov: 3090,
    },
    {
      label: "Quiet weekend",
      pieces: ["Linen Relaxed Shirt", "Wide-Leg Denim"],
      count: 137,
      aov: 600,
    },
    {
      label: "Old-money layering",
      pieces: ["Cashmere V-Neck", "Wrap Coat", "Pleated Midi Skirt"],
      count: 96,
      aov: 2180,
    },
  ];

  const consumer: ConsumerIntel = {
    styleMap,
    colors,
    topSizes,
    fitPrefs,
    bodyInsight,
    occasions,
    combos,
  };

  // ── CONVERSION INTELLIGENCE ────────────────────────────────────────────────
  // Anchor to the real surfaced/converted learning-loop numbers, then model the
  // try-on lift the founder named (with-try-on vs baseline).
  const realConv = learning.conversionRate; // honest, from real signals
  const tryOnPurchaseRate = Math.max(0.22, Math.min(0.34, 0.28 + (realConv - 0.2) * 0.3));
  const baselinePurchaseRate = 0.06;
  const conversion: ConversionIntel = {
    tryOnPurchaseRate,
    baselinePurchaseRate,
    tryOnLiftX: Math.round((tryOnPurchaseRate / baselinePurchaseRate) * 10) / 10,
    bundlePurchaseRate: 0.42,
    aiSuggestedAddRate: 0.31,
    confidenceScore: 74,
    confidenceDrivers: [
      { label: "Tried it on", weight: 0.34 },
      { label: "Accepted size rec", weight: 0.26 },
      { label: "Compared ≤2 sizes", weight: 0.18 },
      { label: "Viewed complete look", weight: 0.22 },
    ],
    dropOff: [
      { stage: "Size selection", lossPct: 0.31 },
      { stage: "Colour uncertainty", lossPct: 0.24 },
      { stage: "Styling confusion", lossPct: 0.19 },
      { stage: "Price hesitation", lossPct: 0.16 },
    ],
    fullLookMultiplier: 3.2,
    stylistSpendLift: 0.48,
  };

  // ── FIT & CONFIDENCE INTELLIGENCE ──────────────────────────────────────────
  const fitProducts: FitProductRow[] = products
    .map((p) => {
      const fseed = mulberry32(hashStr("fit:" + p.handle));
      const keep = p.keepRate ?? 0.8;
      // Lower keep-rate / bias-cut / high-rise = more fit confusion.
      let confusion = Math.round((1 - keep) * 100 + fseed() * 14);
      if (/bias|high-rise|high-waist|longer torso/i.test(p.fitNotes)) confusion += 12;
      confusion = Math.max(4, Math.min(62, confusion));
      const note = p.fitNotes.split(".")[0] + ".";
      return { handle: p.handle, name: p.name, confusion, note };
    })
    .sort((a, b) => b.confusion - a.confusion)
    .slice(0, 5);
  const avgKeep = products.reduce((s, p) => s + (p.keepRate ?? 0.8), 0) / products.length;
  const returnRiskScore = Math.round((1 - avgKeep) * 100 + 6);
  const fit: FitIntel = {
    sizeConfidence: Math.round(avgKeep * 100),
    returnRiskScore,
    returnRiskLevel: returnRiskScore < 18 ? "low" : returnRiskScore < 28 ? "moderate" : "elevated",
    topReturnDriver: "Fit uncertainty on bias-cut & high-rise pieces (repeated size toggling before checkout)",
    productFit: fitProducts,
    bestAudience: "Shoppers who shared height + weight and accepted the size rec keep at 91% — the highest-trust segment.",
  };

  // ── STYLE & MERCHANDISING INTELLIGENCE ─────────────────────────────────────
  // Most-styled vs most-sold: a piece styled a lot but sold little is a future
  // winner to protect / promote, not cut.
  const styledNotSold: StyledRow[] = products
    .map((p, i) => {
      const sseed = mulberry32(hashStr("styled:" + p.handle));
      const styledRank = 1 + Math.floor(sseed() * products.length);
      const soldRank = 1 + Math.floor(sseed() * products.length);
      return { handle: p.handle, name: p.name, styledRank, soldRank, gap: soldRank - styledRank };
    })
    .filter((r) => r.gap >= 3) // styled far more than sold
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 4);

  const compatibility: CompatRow[] = [
    { pair: ["Tailored Blazer", "Wide-Leg Trouser"], score: 0.94, lift: 0.41 },
    { pair: ["Onyx Silk Slip", "Leather Trench"], score: 0.9, lift: 0.37 },
    { pair: ["Cashmere V-Neck", "Pleated Midi Skirt"], score: 0.86, lift: 0.29 },
    { pair: ["Linen Relaxed Shirt", "Wide-Leg Denim"], score: 0.83, lift: 0.26 },
  ];

  const collections: CollectionPerf[] = [
    { collection: "Tailoring", share: 0.29, topAge: "28–38", topOccasion: "Office / work", topStyle: "Tailored Sharp" },
    { collection: "Evening", share: 0.24, topAge: "25–34", topOccasion: "Evening / party", topStyle: "Evening Drama" },
    { collection: "The Atelier", share: 0.2, topAge: "30–42", topOccasion: "Everyday", topStyle: "Minimal Luxe" },
    { collection: "Outerwear", share: 0.16, topAge: "32–45", topOccasion: "Travel", topStyle: "Old Money" },
    { collection: "Knitwear", share: 0.11, topAge: "26–40", topOccasion: "Everyday", topStyle: "Natural Tones" },
  ];

  const emergingTrends: TrendRow[] = [
    { label: "Oversized silhouettes", direction: "up", deltaPct: 32, kind: "cut" },
    { label: "Natural / earth tones", direction: "up", deltaPct: 18, kind: "color" },
    { label: "Relaxed fit", direction: "up", deltaPct: 14, kind: "fit" },
    { label: "Silk & charmeuse", direction: "up", deltaPct: 9, kind: "material" },
    { label: "Slim-fit trousers", direction: "down", deltaPct: -21, kind: "cut" },
    { label: "Bright / neon", direction: "down", deltaPct: -16, kind: "color" },
  ];

  const style: StyleIntel = {
    mostStyledNotSold: styledNotSold,
    compatibility,
    collections,
    emergingTrends,
  };

  // ── EXECUTIVE SUMMARY CARDS ────────────────────────────────────────────────
  const topShade = colors.find((c) => c.signal === "converter") ?? colors[0];
  const curiosity = colors.find((c) => c.signal === "curiosity");
  const growingColor = emergingTrends.find((t) => t.kind === "color" && t.direction === "up");
  const topFit = fitPrefs[0];
  const exec: ExecCard[] = [
    {
      label: "Most loved shade",
      value: topShade?.color ?? "Ivory",
      sub: `${pct(topShade?.convertRate ?? 0.3)}% try → buy · the reliable converter`,
      tone: "loved",
    },
    {
      label: "Fastest-growing colour",
      value: growingColor ? "Natural tones" : "Earth tones",
      sub: `+${growingColor?.deltaPct ?? 18}% try-ons this period`,
      trend: "up",
      deltaPct: growingColor?.deltaPct ?? 18,
      tone: "growing",
    },
    {
      label: "Highest-converting fit",
      value: topFit?.pref.split(" / ")[0] ?? "Relaxed",
      sub: `${pct(topFit?.share ?? 0.48)}% of shoppers · drives the size logic`,
      tone: "converting",
    },
    {
      label: "Try-on lift",
      value: `${conversion.tryOnLiftX}×`,
      sub: `${pct(conversion.tryOnPurchaseRate)}% with try-on vs ${pct(conversion.baselinePurchaseRate)}% without`,
      trend: "up",
      tone: "converting",
    },
    {
      label: "Curiosity, not conversion",
      value: curiosity?.color ?? "Cardinal",
      sub: `High try-ons, low buy — merchandise as accent, not hero`,
      tone: "watch",
    },
    {
      label: "Return risk",
      value: `${fit.returnRiskScore}`,
      sub: `${fit.returnRiskLevel} · ${fit.sizeConfidence}% accept the size rec`,
      trend: fit.returnRiskLevel === "low" ? "down" : "flat",
      tone: "watch",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    dataMode: realSignalCount > 0 ? "live+modelled" : "modelled",
    realSignalCount,
    exec,
    consumer,
    conversion,
    fit,
    style,
    learning,
  };
}
