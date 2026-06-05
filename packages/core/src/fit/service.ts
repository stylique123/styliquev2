// Deterministic fit service. No AI. Used by demo and by the production /api/shopper/fit later.
// Inputs: shopper body data + product category + available sizes (from variants).
// Outputs: recommended size, confidence, rationale, and adjacent-size guidance.

// ─── Zone-specific fit types ──────────────────────────────────────────────────
export type FitZone = "tight" | "snug" | "fitted" | "comfortable" | "roomy" | "oversized";

export type ZoneFitResult = {
  chest?: FitZone;
  waist?: FitZone;
  hip?: FitZone;
  length?: FitZone;
  shoulder?: FitZone;
};

export type SizeChartEntry = {
  size: string;
  chestCm?: number;
  waistCm?: number;
  hipCm?: number;
  lengthCm?: number;
  shoulderCm?: number;
  inseamCm?: number;
};

// ─── D38 — per-SKU measurements shape (mirrors ProductVariant.measurementsJson) ─
// All values in centimetres, matching the normalised schema columns.
export type SkuMeasurements = {
  chest?: number;
  waist?: number;
  hip?: number;
  length?: number;
  sleeve?: number;
};

export type FitInput = {
  heightCm: number;
  weightKg: number;
  fitPreference: "SLIM" | "REGULAR" | "RELAXED" | "OVERSIZED" | "FITTED";
  bodyType?: "PETITE" | "SLIM" | "REGULAR" | "CURVY" | "PLUS" | "TALL";
  category: string | null;          // shirt / trouser / shoe / accessory / outerwear / null
  availableSizes: string[];          // distinct sizes from product variants
  // ─── D38 fit-accuracy signals ────────────────────────────────────────────
  // Shopper body measurements in centimetres. When present, preferred over
  // BMI-derived defaults for much higher-fidelity recommendations.
  chest?: number;
  waist?: number;
  hip?: number;
  // Per-SKU garment measurements from ProductVariant.measurementsJson.
  // Keyed by size label (e.g. "M"). When provided, we can score each size
  // against the shopper's actual measurements instead of using category
  // defaults — dramatically improves confidence for well-measured catalogs.
  skuMeasurements?: Record<string, SkuMeasurements>;
  // How many past fit sessions the shopper has with this brand. Used for the
  // "brand bias" confidence boost — the engine learns brand-specific fit bias
  // over time (e.g. "this brand runs small").
  brandBiasCount?: number;
  // Whether the shopper has a previous purchase from this brand/product with
  // a known chosen size. Highest-quality signal available.
  hasPastPurchase?: boolean;
};

export type FitResult = {
  recommendedSize: string;
  confidence: number;               // 0..1
  rationale: string;
  sizeUpAdvice?: string;
  sizeDownAdvice?: string;
  alternativeSize?: string;
  // ─── D38 — human-readable trust line for the widget ─────────────────────
  // Short sentence like "Based on your profile: M — high confidence."
  // Always present. Shown beneath the recommended size in the widget.
  trustLine: string;
};

// Letter ladder used when product has S/M/L sizing.
const LETTER_LADDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

// Cutoffs by BMI for letter sizes. Tuned for unisex tops.
function letterFromBMI(bmi: number): string {
  if (bmi < 18) return "XS";
  if (bmi < 21) return "S";
  if (bmi < 25) return "M";
  if (bmi < 28) return "L";
  if (bmi < 32) return "XL";
  if (bmi < 36) return "XXL";
  return "XXXL";
}

function bmi(heightCm: number, weightKg: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

function pickClosestLetter(target: string, available: string[]): string | null {
  const idx = LETTER_LADDER.indexOf(target);
  if (idx === -1) return null;
  // Walk outward from idx looking for an available size.
  for (let off = 0; off < LETTER_LADDER.length; off++) {
    const up = LETTER_LADDER[idx + off];
    const dn = LETTER_LADDER[idx - off];
    if (up && available.includes(up)) return up;
    if (dn && available.includes(dn)) return dn;
  }
  return available[0] ?? null;
}

function pickNumericTrouser(waistInchesEst: number, available: string[]): string | null {
  const numeric = available
    .map((s) => ({ raw: s, n: Number.parseInt(s, 10) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n);
  if (!numeric.length) return null;
  let best = numeric[0];
  let bestDelta = Math.abs(numeric[0].n - waistInchesEst);
  for (const c of numeric) {
    const d = Math.abs(c.n - waistInchesEst);
    if (d < bestDelta) { best = c; bestDelta = d; }
  }
  return best.raw;
}

function applyFitPreference(target: string, pref: FitInput["fitPreference"]): string {
  const idx = LETTER_LADDER.indexOf(target);
  if (idx === -1) return target;
  if (pref === "FITTED" || pref === "SLIM") return LETTER_LADDER[Math.max(0, idx - 1)];
  if (pref === "RELAXED") return LETTER_LADDER[Math.min(LETTER_LADDER.length - 1, idx + 1)];
  if (pref === "OVERSIZED") return LETTER_LADDER[Math.min(LETTER_LADDER.length - 1, idx + 2)];
  return target;
}

function adjacent(size: string, available: string[]): { up?: string; down?: string } {
  const numeric = Number.parseInt(size, 10);
  if (Number.isFinite(numeric)) {
    const nums = available.map((s) => Number.parseInt(s, 10)).filter(Number.isFinite).sort((a, b) => a - b);
    const up = nums.find((n) => n > numeric);
    const down = [...nums].reverse().find((n) => n < numeric);
    return { up: up != null ? String(up) : undefined, down: down != null ? String(down) : undefined };
  }
  const idx = LETTER_LADDER.indexOf(size);
  if (idx === -1) return {};
  // Walk for available adjacent.
  let up: string | undefined;
  let down: string | undefined;
  for (let i = idx + 1; i < LETTER_LADDER.length; i++) if (available.includes(LETTER_LADDER[i])) { up = LETTER_LADDER[i]; break; }
  for (let i = idx - 1; i >= 0; i--) if (available.includes(LETTER_LADDER[i])) { down = LETTER_LADDER[i]; break; }
  return { up, down };
}

// ─── D38 — Honest confidence calculator ───────────────────────────────────
// Starts at 40 (base: we have the product catalog but nothing else) and
// accumulates evidence points for each data signal present. Never exceeds 92
// (we leave headroom for brand-level learning that requires >10 sessions).
// Returns a 0..1 float to keep the existing FitResult.confidence contract.
function computeConfidence(input: FitInput, hasMeasurementMatch: boolean): number {
  const brandBiasCount = input.brandBiasCount ?? 0;
  const hasPastPurchase = input.hasPastPurchase ?? false;

  let pts = 40;
  if (input.heightCm) pts += 8;
  if (input.weightKg) pts += 8;
  if (input.chest || input.waist || input.hip) pts += 12;
  if (input.bodyType) pts += 5;
  if (brandBiasCount > 10) pts += 8;
  if (hasPastPurchase) pts += 10;
  // Bonus when we matched against actual SKU measurements rather than defaults.
  if (hasMeasurementMatch) pts += 6;

  return Math.min(pts, 92) / 100;
}

// ─── D38 — Per-SKU measurement matching ───────────────────────────────────
// Given a map of size → SkuMeasurements and the shopper's own body
// measurements, score each available size by absolute-centimetre delta and
// return the best match. Falls back to null when insufficient data.
function pickBySkuMeasurements(
  shopperChest: number | undefined,
  shopperWaist: number | undefined,
  shopperHip: number | undefined,
  availableSizes: string[],
  skuMeasurements: Record<string, SkuMeasurements>,
  fitPref: FitInput["fitPreference"],
): string | null {
  // Build preference offset: FITTED/SLIM → slightly smaller garment (negative
  // ease), RELAXED → more ease, OVERSIZED → even more. Values in cm.
  const easeOffset =
    fitPref === "FITTED" ? -4 :
    fitPref === "SLIM" ? -2 :
    fitPref === "RELAXED" ? 4 :
    fitPref === "OVERSIZED" ? 8 :
    0; // REGULAR

  let bestSize: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const size of availableSizes) {
    const sku = skuMeasurements[size];
    if (!sku) continue;

    let totalDelta = 0;
    let measurements = 0;

    if (shopperChest != null && sku.chest != null) {
      // Add garment ease (~8cm for a normal-fit top) and preference offset.
      const targetGarment = shopperChest + 8 + easeOffset;
      totalDelta += Math.abs(sku.chest - targetGarment);
      measurements++;
    }
    if (shopperWaist != null && sku.waist != null) {
      const targetGarment = shopperWaist + 4 + easeOffset;
      totalDelta += Math.abs(sku.waist - targetGarment);
      measurements++;
    }
    if (shopperHip != null && sku.hip != null) {
      const targetGarment = shopperHip + 6 + easeOffset;
      totalDelta += Math.abs(sku.hip - targetGarment);
      measurements++;
    }

    if (measurements === 0) continue;
    const avgDelta = totalDelta / measurements;
    if (avgDelta < bestScore) {
      bestScore = avgDelta;
      bestSize = size;
    }
  }

  return bestSize;
}

export function recommendFit(input: FitInput): FitResult {
  const sizes = input.availableSizes.filter(Boolean);
  if (!sizes.length) {
    return {
      recommendedSize: "—",
      confidence: 0,
      rationale: "Product has no published sizes — Fit cannot recommend.",
      trustLine: "No sizes available for this product.",
    };
  }

  // ─── D38: Try per-SKU measurement matching first ─────────────────────────
  // If the caller provides skuMeasurements AND the shopper has at least one
  // body measurement, we can score each size directly rather than relying on
  // category defaults. Higher accuracy, higher confidence.
  const hasMeasurements = Boolean(
    input.skuMeasurements &&
    Object.keys(input.skuMeasurements).length > 0 &&
    (input.chest || input.waist || input.hip),
  );

  if (hasMeasurements && input.skuMeasurements) {
    const skuPick = pickBySkuMeasurements(
      input.chest,
      input.waist,
      input.hip,
      sizes,
      input.skuMeasurements,
      input.fitPreference,
    );
    if (skuPick) {
      const adj = adjacent(skuPick, sizes);
      const confidence = computeConfidence(input, true);
      const trustLine = buildTrustLine(skuPick, confidence);
      return {
        recommendedSize: skuPick,
        confidence,
        rationale: `Matched against garment measurements (chest/waist/hip) for ${input.fitPreference.toLowerCase()} fit.`,
        sizeUpAdvice: adj.up ? `Size ${adj.up} for more room.` : undefined,
        sizeDownAdvice: adj.down ? `Size ${adj.down} for a closer fit.` : undefined,
        alternativeSize: adj.up,
        trustLine,
      };
    }
  }

  // Trousers / numeric jeans size.
  if (input.category === "trouser" || sizes.every((s) => Number.isFinite(Number.parseInt(s, 10)))) {
    const b = bmi(input.heightCm, input.weightKg);
    // Use shopper's explicit waist measurement when available, fall back to BMI estimate.
    const waistCm = input.waist ?? Math.round(66 + (b - 22) * 2.3); // ~cm
    const waistIn = Math.round(waistCm / 2.54);
    const chosen = pickNumericTrouser(waistIn, sizes) ?? sizes[0];
    const adj = adjacent(chosen, sizes);
    const confidence = computeConfidence(input, hasMeasurements);
    const trustLine = buildTrustLine(chosen, confidence);
    return {
      recommendedSize: chosen,
      confidence,
      rationale: `${input.waist ? `Your waist measurement (${input.waist}cm → ${waistIn}")` : `Estimated waist ${waistIn}" from your BMI (${b.toFixed(1)})`}. ${input.fitPreference === "RELAXED" ? "Adjusted up for relaxed fit." : input.fitPreference === "SLIM" || input.fitPreference === "FITTED" ? "Closest slim fit picked." : "Standard fit."}`,
      sizeUpAdvice: adj.up ? `Size ${adj.up} for more room through the hips.` : undefined,
      sizeDownAdvice: adj.down ? `Size ${adj.down} for a closer cut — may feel snug at the waist.` : undefined,
      alternativeSize: adj.up,
      trustLine,
    };
  }

  // Default: letter sizing.
  const b = bmi(input.heightCm, input.weightKg);
  let letter = letterFromBMI(b);
  letter = applyFitPreference(letter, input.fitPreference);
  if (input.bodyType === "TALL") letter = LETTER_LADDER[Math.min(LETTER_LADDER.length - 1, LETTER_LADDER.indexOf(letter) + 1)];
  if (input.bodyType === "PETITE") letter = LETTER_LADDER[Math.max(0, LETTER_LADDER.indexOf(letter) - 1)];

  const chosen = pickClosestLetter(letter, sizes) ?? sizes[0];
  const adj = adjacent(chosen, sizes);

  const reasonBits: string[] = [];
  reasonBits.push(`BMI ${b.toFixed(1)} → base ${letterFromBMI(b)}`);
  if (input.fitPreference !== "REGULAR") reasonBits.push(`adjusted for ${input.fitPreference.toLowerCase()} fit`);
  if (input.bodyType === "TALL" || input.bodyType === "PETITE") reasonBits.push(`adjusted for ${input.bodyType.toLowerCase()} body type`);

  const confidence = computeConfidence(input, hasMeasurements);
  const trustLine = buildTrustLine(chosen, confidence);

  return {
    recommendedSize: chosen,
    confidence,
    rationale: reasonBits.join(", ") + ".",
    sizeUpAdvice: adj.up ? `Size ${adj.up} drapes looser through the shoulders.` : undefined,
    sizeDownAdvice: adj.down ? `Size ${adj.down} sits closer to the body — best for layering under outerwear.` : undefined,
    alternativeSize: adj.up,
    trustLine,
  };
}

// ─── D38 — Trust line builder ──────────────────────────────────────────────
function buildTrustLine(size: string, confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (pct >= 75) {
    return `Based on your profile: ${size} — high confidence.`;
  }
  return `Based on your profile: ${size}.`;
}

// ─── Zone-fit calculator ───────────────────────────────────────────────────
// Ease constants (cm) per fit preference.
// "Ease" is how much extra room you need beyond body measurement for comfortable wear.
const EASE: Record<string, Record<string, number>> = {
  chest:  { FITTED: 4, REGULAR: 8, RELAXED: 12, OVERSIZED: 18 },
  waist:  { FITTED: 2, REGULAR: 4, RELAXED: 8,  OVERSIZED: 14 },
  hip:    { FITTED: 4, REGULAR: 6, RELAXED: 10, OVERSIZED: 16 },
};

export function calculateZoneFit(
  bodyMeasurements: { chestCm?: number; waistCm?: number; hipCm?: number },
  garmentMeasurements: SizeChartEntry,
  fitPreference: string = "REGULAR"
): ZoneFitResult {
  const result: ZoneFitResult = {};
  const pref = ["FITTED","REGULAR","RELAXED","OVERSIZED"].includes(fitPreference) ? fitPreference : "REGULAR";

  const classifyZone = (bodyCm: number, garmentCm: number, zone: string): FitZone => {
    const ease = EASE[zone]?.[pref] ?? 8;
    const wearCm = garmentCm - bodyCm; // how much room after wearing
    if (wearCm < 0)              return "tight";
    if (wearCm < 2)              return "snug";
    if (wearCm < ease)           return "fitted";
    if (wearCm < ease * 1.5)     return "comfortable";
    if (wearCm < ease * 2.5)     return "roomy";
    return "oversized";
  };

  if (bodyMeasurements.chestCm && garmentMeasurements.chestCm) {
    result.chest = classifyZone(bodyMeasurements.chestCm, garmentMeasurements.chestCm, "chest");
  }
  if (bodyMeasurements.waistCm && garmentMeasurements.waistCm) {
    result.waist = classifyZone(bodyMeasurements.waistCm, garmentMeasurements.waistCm, "waist");
  }
  if (bodyMeasurements.hipCm && garmentMeasurements.hipCm) {
    result.hip = classifyZone(bodyMeasurements.hipCm, garmentMeasurements.hipCm, "hip");
  }
  return result;
}
