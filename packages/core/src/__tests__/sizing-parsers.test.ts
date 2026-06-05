// Tests for the multi-source size-chart parsers (D39).
// These parsers are the highest-accuracy input for fit recommendations.
// Previously untested; any regression here silently breaks fit accuracy.

import { describe, it, expect } from "vitest";
import {
  parseJsonSizeChart,
  parseHtmlSizeChart,
  parseVariantMeasurements,
  pickProductSizeChart,
} from "../sizing/metafield.js";

// ─── parseJsonSizeChart ───────────────────────────────────────────────────────

describe("parseJsonSizeChart", () => {
  it("parses { sizes: [...] } shape", () => {
    const result = parseJsonSizeChart({
      sizes: [
        { name: "S", chest: 86, waist: 70, hip: 90 },
        { name: "M", chest: 91, waist: 75, hip: 95 },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.sizes).toHaveLength(2);
    expect(result!.sizes[0].name).toBe("S");
    expect(result!.sizes[0].chest).toBeCloseTo(86, 0);
    expect(result!.unit).toBe("cm");
  });

  it("parses flat array shape", () => {
    const result = parseJsonSizeChart([
      { name: "L", chest: 96, waist: 80 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.sizes[0].name).toBe("L");
  });

  it("converts inches to cm when unit field says 'in'", () => {
    const result = parseJsonSizeChart({
      unit: "in",
      sizes: [{ name: "M", chest: 36, waist: 30 }],
    });
    expect(result).not.toBeNull();
    // 36 inches × 2.54 = 91.44 cm
    expect(result!.sizes[0].chest).toBeCloseTo(91.44, 0);
    expect(result!.unit).toBe("cm");
  });

  it("accepts JSON string input (Shopify metafield text type)", () => {
    const raw = JSON.stringify({
      sizes: [{ name: "XL", chest: 101 }],
    });
    const result = parseJsonSizeChart(raw);
    expect(result).not.toBeNull();
    expect(result!.sizes[0].chest).toBe(101);
  });

  it("returns null for empty or invalid input", () => {
    expect(parseJsonSizeChart(null)).toBeNull();
    expect(parseJsonSizeChart(undefined)).toBeNull();
    expect(parseJsonSizeChart("not-json{")).toBeNull();
    expect(parseJsonSizeChart({ sizes: [] })).toBeNull();
    expect(parseJsonSizeChart(42)).toBeNull();
  });

  it("skips rows missing a name field", () => {
    const result = parseJsonSizeChart([
      { chest: 90 },           // no name — skip
      { name: "M", chest: 91 }, // valid
    ]);
    expect(result!.sizes).toHaveLength(1);
    expect(result!.sizes[0].name).toBe("M");
  });

  it("accepts 'label' as an alias for 'name'", () => {
    const result = parseJsonSizeChart([{ label: "S", waist: 70 }]);
    expect(result!.sizes[0].name).toBe("S");
  });

  it("skips rows with only a name but no measurements", () => {
    const result = parseJsonSizeChart([
      { name: "S" },                     // no measurements — skip
      { name: "M", chest: 90, waist: 75 }, // valid
    ]);
    expect(result!.sizes).toHaveLength(1);
  });
});

// ─── parseHtmlSizeChart ───────────────────────────────────────────────────────

describe("parseHtmlSizeChart", () => {
  const simpleTable = `
    <table>
      <thead><tr><th>Size</th><th>Chest</th><th>Waist</th></tr></thead>
      <tbody>
        <tr><td>S</td><td>86</td><td>70</td></tr>
        <tr><td>M</td><td>91</td><td>75</td></tr>
        <tr><td>L</td><td>96</td><td>80</td></tr>
      </tbody>
    </table>
  `;

  it("parses a simple size table", () => {
    const result = parseHtmlSizeChart(simpleTable);
    expect(result).not.toBeNull();
    expect(result!.sizes.length).toBeGreaterThanOrEqual(2);
    const m = result!.sizes.find((s) => s.name === "M");
    expect(m).toBeDefined();
    expect(m!.chest).toBeCloseTo(91, 0);
  });

  it("returns null for non-table HTML", () => {
    expect(parseHtmlSizeChart("<p>No table here</p>")).toBeNull();
    expect(parseHtmlSizeChart("plain text")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseHtmlSizeChart("")).toBeNull();
  });

  it("handles case-insensitive column headers", () => {
    const html = `
      <table>
        <tr><th>SIZE</th><th>CHEST (CM)</th><th>HIP</th></tr>
        <tr><td>XL</td><td>101</td><td>108</td></tr>
      </table>
    `;
    const result = parseHtmlSizeChart(html);
    expect(result).not.toBeNull();
    const xl = result!.sizes.find((s) => s.name === "XL");
    expect(xl).toBeDefined();
  });
});

// ─── parseVariantMeasurements ────────────────────────────────────────────────
// Accepts Array<{ key: string; value: unknown }> (Shopify metafield array shape)

describe("parseVariantMeasurements", () => {
  it("extracts chest, waist, hip from Shopify metafield array", () => {
    const result = parseVariantMeasurements([
      { key: "chest_cm", value: "92" },
      { key: "waist_cm", value: "76" },
      { key: "hip_cm",   value: "98" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.chest).toBeCloseTo(92, 0);
    expect(result!.waist).toBeCloseTo(76, 0);
    expect(result!.hip).toBeCloseTo(98, 0);
  });

  it("accepts numeric values as well as string values", () => {
    const result = parseVariantMeasurements([
      { key: "chest_cm", value: 90 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.chest).toBeCloseTo(90, 0);
  });

  it("returns null when input is empty/null/undefined", () => {
    // The function signature requires an array; null/undefined/empty = null
    expect(parseVariantMeasurements(null as unknown as [])).toBeNull();
    expect(parseVariantMeasurements([] as unknown as [])).toBeNull();
  });
});

// ─── pickProductSizeChart ────────────────────────────────────────────────────
// Takes raw metafield values, not pre-parsed charts.
// Returns ParsedSizeChart | null directly.

describe("pickProductSizeChart — priority order", () => {
  const jsonValue = { sizes: [{ name: "M", chest: 91 }] };
  const htmlValue = `
    <table>
      <tr><th>Size</th><th>Chest</th></tr>
      <tr><td>M</td><td>89</td></tr>
    </table>
  `;

  it("prefers json metafield over html metafield", () => {
    const result = pickProductSizeChart({
      jsonMetafieldValue: jsonValue,
      htmlMetafieldValue: htmlValue,
    });
    // json chart wins
    expect(result).not.toBeNull();
    const m = result!.sizes.find((s) => s.name === "M");
    expect(m?.chest).toBeCloseTo(91, 0);
    expect(result!.source).toBe("shopify_metafield_json");
  });

  it("falls back to html metafield when json is absent", () => {
    const result = pickProductSizeChart({ htmlMetafieldValue: htmlValue });
    expect(result).not.toBeNull();
    const m = result!.sizes.find((s) => s.name === "M");
    expect(m?.chest).toBeCloseTo(89, 0);
  });

  it("returns null when no sources provided", () => {
    expect(pickProductSizeChart({})).toBeNull();
  });

  it("returns null when json is invalid and html is absent", () => {
    expect(pickProductSizeChart({ jsonMetafieldValue: "not-json{" })).toBeNull();
  });
});
