// Shopify size-chart metafield extractor (D37).
//
// Brands store size charts in Shopify in three common ways. We accept all
// three and normalize into the same `ParsedSizeChart` shape:
//
//   1. JSON metafield  — namespace e.g. "stylique" or "custom", key like
//      "size_chart". Either an array of size rows or {sizes: [...]}.
//
//   2. HTML/table metafield — namespace "custom" or theme-specific,
//      key like "size_chart_html". A <table> with thead + tbody we can
//      parse for chest/waist/hip/etc. columns. Common in older themes.
//
//   3. Variant-level metafields — per-variant chest/waist/etc. as
//      individual number-typed metafields. Handled by parseVariantMeasurements.
//
// All measurements are normalized to centimetres. Inch inputs are detected
// by the unit metafield (or column header) and converted with 2.54x.
//
// Output:
//   { unit: "cm", sizes: [{ name: "M", chest: 95, waist: 78, hip: 102 }] }
//
// We intentionally do NOT do best-effort scraping of theme HTML (a brand
// might display a size chart in their PDP description). That's a different,
// noisier path tracked separately as OI-37.

export type Measurement = "chest" | "waist" | "hip" | "length" | "sleeve" | "shoulder" | "inseam";

export type SizeRow = Partial<Record<Measurement, number>> & { name: string };

export type ParsedSizeChart = {
  unit: "cm";
  sizes: SizeRow[];
  // Where it came from — used as Product.sizeChartSource.
  source: "shopify_metafield_json" | "shopify_metafield_html" | "shopify_variant_metafield" | "unknown";
};

// Synonyms — Shopify field naming varies wildly. Map column header /
// metafield key to the canonical Measurement.
const SYNONYMS: Record<string, Measurement> = {
  chest: "chest", bust: "chest", "chest_cm": "chest", "chest_in": "chest", chest_size: "chest",
  waist: "waist", "waist_cm": "waist", "waist_in": "waist", waist_size: "waist",
  hip: "hip", hips: "hip", "hip_cm": "hip", "hip_in": "hip",
  length: "length", "length_cm": "length", "length_in": "length", "garment_length": "length",
  sleeve: "sleeve", "sleeve_cm": "sleeve", "sleeve_length": "sleeve", "sleeve_in": "sleeve",
  shoulder: "shoulder", shoulders: "shoulder", "shoulder_cm": "shoulder", "shoulder_width": "shoulder",
  inseam: "inseam", "inseam_cm": "inseam", "inseam_in": "inseam",
};

function canonicalMeasurement(rawKey: string): Measurement | null {
  // Collapse ANY run of non-alphanumerics to a single underscore so real-world
  // headers like "Chest (cm)", "Waist - inches", "Hip/Seat" normalize cleanly.
  // The old single-char replace produced "chest__cm" and silently dropped the
  // column → the whole text/HTML chart failed to parse (the #1 reason text size
  // charts weren't extracted).
  const k = rawKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (SYNONYMS[k]) return SYNONYMS[k];
  // Strip a trailing unit token ("chest_inches", "waist_cms").
  const noUnit = k.replace(/_(cm|cms|centimet(?:er|re)s?|in|ins|inch|inches)$/i, "");
  if (SYNONYMS[noUnit]) return SYNONYMS[noUnit];
  // Fall back to the first token: "chest_width", "bust_measurement" → chest.
  return SYNONYMS[noUnit.split("_")[0]] ?? null;
}

function inchesToCm(v: number): number {
  return Math.round(v * 2.54 * 10) / 10;
}

function looksLikeInches(rawKey: string, value: number): boolean {
  const k = rawKey.toLowerCase();
  if (k.includes("_in") || k.endsWith("_inch") || k.includes("inches")) return true;
  // Heuristic — a 36-inch chest is realistic; 36cm isn't.
  if (k.includes("chest") || k.includes("bust") || k.includes("hip")) {
    return value > 5 && value < 80; // ambiguous mid-range stays as-is
  }
  // Waist (audit fix): a bare US-inch waist chart (28/30/32) was previously
  // stored as cm, so recommendFit read a ~30cm garment waist and sized every
  // shopper far too large on trousers/jeans/skirts (where inch labelling is
  // most common). Inch waists run ~22–46; cm waists run ~58+, so a tighter
  // upper bound than chest cleanly separates them without false positives.
  if (k.includes("waist")) {
    return value > 12 && value < 55;
  }
  return false;
}

// ───────────────────────────────────────────────────────────────────────
// Parser #1 — JSON metafield value
// ───────────────────────────────────────────────────────────────────────

export function parseJsonSizeChart(raw: unknown): ParsedSizeChart | null {
  if (raw == null) return null;
  // String → JSON parse (Shopify metafield value may arrive as text).
  if (typeof raw === "string") {
    try { return parseJsonSizeChart(JSON.parse(raw)); } catch { return null; }
  }
  if (typeof raw !== "object") return null;

  // Two shapes accepted:
  //   { sizes: [{ name: "M", chest: 95 }, ...] }
  //   [{ name: "M", chest: 95 }, ...]
  const arr: unknown =
    Array.isArray(raw) ? raw :
    Array.isArray((raw as Record<string, unknown>).sizes) ? (raw as Record<string, unknown>).sizes :
    null;
  if (!Array.isArray(arr)) return null;

  const unitHint =
    (raw as Record<string, unknown>).unit ??
    (raw as Record<string, unknown>).measurement_unit;
  const wholeChartIsInches = typeof unitHint === "string" && /in/i.test(unitHint);

  const sizes: SizeRow[] = [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name =
      typeof r.name === "string" ? r.name :
      typeof r.size === "string" ? r.size :
      typeof r.label === "string" ? r.label : null;
    if (!name) continue;
    const measured: SizeRow = { name };
    for (const [key, val] of Object.entries(r)) {
      if (typeof val !== "number" || !Number.isFinite(val)) continue;
      const canon = canonicalMeasurement(key);
      if (!canon) continue;
      const isInches = wholeChartIsInches || looksLikeInches(key, val);
      measured[canon] = isInches ? inchesToCm(val) : val;
    }
    if (Object.keys(measured).length > 1) sizes.push(measured);
  }
  if (sizes.length === 0) return null;
  return { unit: "cm", sizes, source: "shopify_metafield_json" };
}

// ───────────────────────────────────────────────────────────────────────
// Parser #2 — HTML <table> metafield value
// ───────────────────────────────────────────────────────────────────────
// Lightweight HTML scan, no DOM dependency. We tolerate sloppy markup
// (missing thead, mixed casing, decorative spans) by regex-extracting
// <tr> blocks and per-cell text.

export function parseHtmlSizeChart(html: string): ParsedSizeChart | null {
  if (typeof html !== "string" || !/[<>]/.test(html)) return null;
  const tableMatch = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;
  const inner = tableMatch[1];

  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(inner))) {
    const cells: string[] = [];
    const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(trMatch[1]))) {
      cells.push(stripTags(cellMatch[1]).trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length < 2) return null;

  // First row = headers; first column = size name.
  const headers = rows[0].map((h) => h.toLowerCase());
  const colMap: Array<{ measure: Measurement; idx: number; inches: boolean }> = [];
  for (let i = 1; i < headers.length; i++) {
    const canon = canonicalMeasurement(headers[i]);
    if (!canon) continue;
    colMap.push({
      measure: canon,
      idx: i,
      inches: /in\b|inch/i.test(headers[i]),
    });
  }
  if (colMap.length === 0) return null;

  const sizes: SizeRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = row[0]?.trim();
    if (!name) continue;
    const out: SizeRow = { name };
    for (const c of colMap) {
      const raw = row[c.idx];
      const n = parseFloat(raw?.replace(/[^\d.]/g, "") ?? "");
      if (!Number.isFinite(n)) continue;
      out[c.measure] = c.inches ? inchesToCm(n) : n;
    }
    if (Object.keys(out).length > 1) sizes.push(out);
  }
  if (sizes.length === 0) return null;
  return { unit: "cm", sizes, source: "shopify_metafield_html" };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

// ───────────────────────────────────────────────────────────────────────
// Parser #3 — per-variant metafields → measurementsJson
// ───────────────────────────────────────────────────────────────────────
// Brands sometimes attach chest_cm / waist_cm / etc. directly to each
// variant. This produces the `ProductVariant.measurementsJson` shape.

export type VariantMeasurements = Partial<Record<Measurement, number>>;

export function parseVariantMeasurements(
  metafields: Array<{ namespace?: string | null; key: string; value: unknown }>,
): VariantMeasurements | null {
  if (!Array.isArray(metafields) || metafields.length === 0) return null;
  const out: VariantMeasurements = {};
  for (const mf of metafields) {
    const canon = canonicalMeasurement(mf.key);
    if (!canon) continue;
    const num =
      typeof mf.value === "number" ? mf.value :
      typeof mf.value === "string" ? parseFloat(mf.value.replace(/[^\d.]/g, "")) :
      NaN;
    if (!Number.isFinite(num)) continue;
    out[canon] = looksLikeInches(mf.key, num) ? inchesToCm(num) : num;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ───────────────────────────────────────────────────────────────────────
// Orchestrator — pick the best available source.
// ───────────────────────────────────────────────────────────────────────
// Given everything Shopify returned for a product, try JSON first (most
// structured), then HTML (older themes), then null (FitAdapter falls back
// to the category default).

export function pickProductSizeChart(args: {
  jsonMetafieldValue?: unknown | null;
  htmlMetafieldValue?: string | null;
}): ParsedSizeChart | null {
  if (args.jsonMetafieldValue != null) {
    const parsed = parseJsonSizeChart(args.jsonMetafieldValue);
    if (parsed) return parsed;
  }
  if (args.htmlMetafieldValue) {
    const parsed = parseHtmlSizeChart(args.htmlMetafieldValue);
    if (parsed) return parsed;
  }
  return null;
}
