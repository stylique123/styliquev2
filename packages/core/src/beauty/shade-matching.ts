// Stylique Beauty — shade matching engine.
// Maps a shopper's skin hex / undertone / depth to foundation/concealer products
// in the brand's catalog. The foundation return-rate lever: 30% return reduction
// when shoppers buy the right shade (Sephora self-reported benchmark).
//
// Architecture:
//   1. Brand loads product shade data via metafields or tags at catalog sync.
//   2. Each product variant gets a shadeHex + shadeName if the brand provides it.
//   3. At match time: Lab-space Delta-E distance between shopper skin hex and
//      shade hex → score, weighted by undertone compatibility.

import type { SkinUndertone, SkinDepth, ITARange, ShadeMatch } from "./types.js";

// ─── Shade metadata (what we extract from product catalog) ───────────────

export type ProductShadeInfo = {
  productId: string;
  productHandle: string;
  productTitle: string;
  imageUrl: string | null;
  shades: Array<{
    variantId: string;
    shadeName: string;      // "NC25", "W4", "Light Medium", "Fair 02", etc.
    shadeHex?: string;      // #RRGGBB if brand provides it
    undertoneHint?: string; // "warm" | "cool" | "neutral" — from shade name heuristics
    depthHint?: SkinDepth;  // extracted from name like "Light", "Medium Deep"
    inStock: boolean;
  }>;
};

// ─── Lab color math ──────────────────────────────────────────────────────

function hexToLab(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const lin = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const rl = lin(r), gl = lin(g), bl = lin(b);

  const X = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
  const Y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const Z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;

  const f = (t: number) => t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
  const L = 116 * f(Y) - 16;
  const a = 500 * (f(X / 0.9505) - f(Y));
  const bVal = 200 * (f(Y) - f(Z / 1.089));

  return [L, a, bVal];
}

// CIE76 Delta-E — good enough for shade matching (CIE2000 adds 2% improvement)
function deltaE(hex1: string, hex2: string): number {
  const [L1, a1, b1] = hexToLab(hex1);
  const [L2, a2, b2] = hexToLab(hex2);
  return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

// ─── Undertone compatibility ─────────────────────────────────────────────

function undertoneCompatibility(
  shopperUndertone: SkinUndertone,
  shadeUndertone: string | undefined,
): number {
  if (!shadeUndertone) return 0.7;  // neutral bonus when unknown
  const shade = shadeUndertone.toLowerCase();
  if (shopperUndertone === "warm" && (shade.includes("warm") || shade.includes("golden") || shade.includes("peachy") || shade === "w")) return 1.0;
  if (shopperUndertone === "cool" && (shade.includes("cool") || shade.includes("pink") || shade.includes("rosy") || shade === "c")) return 1.0;
  if (shopperUndertone === "neutral" && (shade.includes("neutral") || shade === "n" || shade === "nw" || shade === "nc")) return 1.0;
  if (shopperUndertone === "olive" && (shade.includes("olive") || shade.includes("golden") || shade.includes("warm"))) return 0.9;
  // Wrong undertone — strong penalty (main cause of foundation returns)
  return 0.2;
}

// ─── Extract undertone hint from shade name ───────────────────────────────
// MAC NC/NW, Fenty 1N/1C/1W, Estée Lauder 1W/1C/1N — all follow naming conventions

export function parseShadeUndertone(shadeName: string): string | undefined {
  const n = shadeName.toUpperCase();
  if (/\bNW\b|NW\d/.test(n)) return "warm";
  if (/\bNC\b|NC\d/.test(n)) return "cool-neutral";
  if (/\b[0-9]+W\b|\bW\d/.test(n) || n.includes("WARM") || n.includes("GOLDEN") || n.includes("PEACHY")) return "warm";
  if (/\b[0-9]+C\b|\bC\d/.test(n) || n.includes("COOL") || n.includes("PINK") || n.includes("ROSE")) return "cool";
  if (/\b[0-9]+N\b|\bN\d/.test(n) || n.includes("NEUTRAL")) return "neutral";
  if (n.includes("OLIVE") || n.includes("BEIGE")) return "warm-neutral";
  return undefined;
}

// ─── Extract depth hint from shade name ──────────────────────────────────

export function parseShadeDepth(shadeName: string): SkinDepth | undefined {
  const n = shadeName.toUpperCase();
  if (n.includes("PORCELAIN") || n.includes("IVORY") || n.includes("FAIR") || /\b0[0-9]\b/.test(n)) return "light";
  if (n.includes("LIGHT MEDIUM") || n.includes("LT MEDIUM") || /\b1[0-9]\b/.test(n)) return "light-medium";
  if (n.includes(" MEDIUM") || n.includes("NC30") || n.includes("NC35") || /\b2[0-9]\b/.test(n)) return "medium";
  if (n.includes("MEDIUM DEEP") || n.includes("TAN") || /\b3[0-9]\b/.test(n)) return "medium-deep";
  if (n.includes("DEEP") || n.includes("RICH") || n.includes("ESPRESSO") || /\b[4-9][0-9]\b/.test(n)) return "deep";
  return undefined;
}

// ─── Depth compatibility score (0-1) ─────────────────────────────────────

function depthScore(shopperDepth: SkinDepth, shadeDepth: SkinDepth): number {
  const depthOrder: SkinDepth[] = ["light", "light-medium", "medium", "medium-deep", "deep"];
  const shopperIdx = depthOrder.indexOf(shopperDepth);
  const shadeIdx = depthOrder.indexOf(shadeDepth);
  const diff = Math.abs(shopperIdx - shadeIdx);
  if (diff === 0) return 1.0;
  if (diff === 1) return 0.75;
  if (diff === 2) return 0.45;
  return 0.1;
}

// ─── Normalized Delta-E score (0-1, higher = closer match) ───────────────
// Exposed for external use (e.g. analytics, gap analysis).
// dE < 5 = perceptually identical, < 10 = close, < 20 = acceptable, ≥ 30 = poor.

export function deltaEScore(hex1: string, hex2: string): number {
  return Math.max(0, 1 - deltaE(hex1, hex2) / 30);
}

// ─── Core matching algorithm — multi-factor model ─────────────────────────
//
// Factor weights when all signals are available:
//   undertone match : 40%
//   depth match     : 35%
//   hex Delta-E     : 25%
//
// When shadeHex or skinHex is absent, the 25% hex weight is redistributed
// proportionally: undertone → 53.3%, depth → 46.7%.

export function matchShades(
  products: ProductShadeInfo[],
  shopper: {
    skinHex?: string;
    undertone?: SkinUndertone;
    depth?: SkinDepth;
    itaRange?: ITARange;
  },
  opts: { limit?: number; inStockOnly?: boolean } = {},
): ShadeMatch[] {
  const limit = opts.limit ?? 5;
  const candidates: Array<ShadeMatch & { rawScore: number }> = [];

  const hasHex = !!shopper.skinHex;

  for (const product of products) {
    for (const shade of product.shades) {
      if (opts.inStockOnly && !shade.inStock) continue;

      const shadeUndertone = shade.undertoneHint ?? parseShadeUndertone(shade.shadeName);
      const shadeDepth = shade.depthHint ?? parseShadeDepth(shade.shadeName);
      const hasShadeHex = hasHex && !!shade.shadeHex;

      // ── factor 1: undertone (weight 0.40, or 0.533 without hex) ──────
      let uScore = 0.7; // neutral baseline when undertone unknown
      if (shopper.undertone) {
        uScore = undertoneCompatibility(shopper.undertone, shadeUndertone);
      }

      // ── factor 2: depth (weight 0.35, or 0.467 without hex) ──────────
      let dScore = 0.6; // neutral baseline when depth unknown on either side
      if (shopper.depth && shadeDepth) {
        dScore = depthScore(shopper.depth, shadeDepth);
      }

      // ── factor 3: hex Delta-E (weight 0.25, only when both hexes present)
      let hScore = 0;
      if (hasShadeHex) {
        hScore = deltaEScore(shopper.skinHex!, shade.shadeHex!);
      }

      // ── weighted sum ──────────────────────────────────────────────────
      let score: number;
      if (hasShadeHex) {
        score = uScore * 0.40 + dScore * 0.35 + hScore * 0.25;
      } else {
        // Redistribute hex weight proportionally to undertone + depth
        score = uScore * (0.40 / 0.75) * 0.75 + dScore * (0.35 / 0.75) * 0.75;
        // Simplifies to:
        score = uScore * 0.5333 + dScore * 0.4667;
      }

      const matchReason = whyThisShade(
        shade.shadeName,
        shadeUndertone,
        shadeDepth,
        shopper.undertone,
        shopper.depth,
        score,
      );

      candidates.push({
        productId: product.productId,
        productHandle: product.productHandle,
        productTitle: product.productTitle,
        shadeName: shade.shadeName,
        shadeHex: shade.shadeHex,
        matchScore: Math.min(1, score),
        matchReason,
        isRecommended: false,
        rawScore: score,
      });
    }
  }

  // Sort by score descending, take top N
  candidates.sort((a, b) => b.rawScore - a.rawScore);
  const top = candidates.slice(0, limit);
  if (top.length > 0) top[0].isRecommended = true;

  return top.map(({ rawScore: _, ...rest }) => rest);
}

// ─── "Why this shade" — 1-sentence human explanation ─────────────────────
// Generates a plain-language sentence that names exactly WHY this shade was
// recommended. Designed to read like a friend at a beauty counter, not a
// confidence score.

export function whyThisShade(
  shadeName: string,
  shadeUndertone: string | undefined,
  shadeDepth: SkinDepth | undefined,
  shopperUndertone: SkinUndertone | undefined,
  shopperDepth: SkinDepth | undefined,
  score: number,
): string {
  const undertoneMatch =
    shopperUndertone && shadeUndertone
      ? undertoneCompatibility(shopperUndertone, shadeUndertone) >= 0.9
      : false;

  const depthMatch =
    shopperDepth && shadeDepth
      ? depthScore(shopperDepth, shadeDepth) >= 1.0
      : false;

  // Both factors nail it
  if (undertoneMatch && depthMatch && score > 0.75) {
    return `Your ${shopperUndertone} undertone and ${shopperDepth} depth match perfectly with this shade's ${shadeUndertone ?? "balanced"} base.`;
  }

  // Undertone is the strong signal
  if (undertoneMatch && score > 0.6) {
    const depthNote = shadeDepth ? ` and lands in the ${shadeDepth} range` : "";
    return `Your ${shopperUndertone} undertone is a strong fit for ${shadeName}${depthNote} — the undertone is the hardest thing to get right.`;
  }

  // Depth is the strong signal (undertone unknown or neutral-safe)
  if (depthMatch && score > 0.6) {
    return `${shadeName} sits right in your ${shopperDepth} depth range${shadeUndertone ? ` with a ${shadeUndertone} base` : ""} — the depth should feel seamless.`;
  }

  // Decent match with a qualification
  if (score > 0.45) {
    const qualifier = shopperUndertone && shadeUndertone && !undertoneMatch
      ? ` — undertone is ${shadeUndertone} vs your ${shopperUndertone}, worth testing in natural light`
      : "";
    return `${shadeName} is a reasonable match${qualifier}.`;
  }

  // Weak match — honest callout
  return `${shadeName} may need colour correction — the undertone leans ${shadeUndertone ?? "differently"} from yours.`;
}

// ─── Shade gap analysis ───────────────────────────────────────────────────
// Takes an array of raw queried-but-not-found shade descriptions (e.g. from
// CatalogGap.normalizedQuery where the query contained shade-related terms)
// and returns structured gap objects for the merchant intelligence dashboard.
//
// estimatedDemand is normalised request count (1-10 scale relative to the
// input array size). priority is derived from depth rarity + demand.

export type ShadeGapItem = {
  undertone: SkinUndertone | "unknown";
  depth: SkinDepth | "unknown";
  estimatedDemand: number;  // 1-10
  priority: "high" | "medium" | "low";
  representativeTerms: string[];  // up to 3 sample queries that drove this gap
};

export function shadeGapAnalysis(queriedNotFound: string[]): ShadeGapItem[] {
  if (!queriedNotFound.length) return [];

  // Bucket by (undertone, depth) key
  type BucketKey = `${string}|${string}`;
  const buckets = new Map<BucketKey, { terms: string[]; count: number }>();

  for (const query of queriedNotFound) {
    const undertone = parseShadeUndertone(query) ?? "unknown";
    const depth = parseShadeDepth(query) ?? "unknown";
    const key: BucketKey = `${undertone}|${depth}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      if (existing.terms.length < 3 && !existing.terms.includes(query)) {
        existing.terms.push(query);
      }
    } else {
      buckets.set(key, { terms: [query], count: 1 });
    }
  }

  const total = queriedNotFound.length;

  const gaps: ShadeGapItem[] = [];
  for (const [key, { terms, count }] of buckets) {
    const [undertone, depth] = key.split("|") as [SkinUndertone | "unknown", SkinDepth | "unknown"];

    // Normalise demand to 1-10
    const estimatedDemand = Math.max(1, Math.min(10, Math.round((count / total) * 10 * Math.min(total, 10))));

    // Priority: deep/medium-deep undertone gaps are rarer in most catalogs → high;
    // lighter shades with high demand → medium; catch-all → low.
    let priority: "high" | "medium" | "low";
    if (estimatedDemand >= 7 || depth === "deep" || depth === "medium-deep") {
      priority = "high";
    } else if (estimatedDemand >= 4 || depth === "medium" || depth === "unknown") {
      priority = "medium";
    } else {
      priority = "low";
    }

    gaps.push({ undertone, depth, estimatedDemand, priority, representativeTerms: terms });
  }

  // Sort: high priority first, then by demand desc
  gaps.sort((a, b) => {
    const pOrder = { high: 0, medium: 1, low: 2 };
    const pDiff = pOrder[a.priority] - pOrder[b.priority];
    return pDiff !== 0 ? pDiff : b.estimatedDemand - a.estimatedDemand;
  });

  return gaps;
}

// ─── Shade tags from product metafields / tags ───────────────────────────
// Extracts shade info from Shopify product tags like "shade:nc25:warm" or
// variant metafields. Used in catalog sync to populate ProductShadeInfo.

export function extractShadeFromTags(tags: string[]): Array<{ hex?: string; undertone?: string; depth?: SkinDepth }> {
  return tags
    .filter(t => t.toLowerCase().startsWith("shade:"))
    .map(t => {
      const parts = t.split(":");
      return {
        hex: parts[2]?.startsWith("#") ? parts[2] : undefined,
        undertone: parts[3] ?? undefined,
        depth: (parts[4] as SkinDepth) ?? undefined,
      };
    });
}
