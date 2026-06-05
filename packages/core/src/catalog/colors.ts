// Color extraction fallback. Reads from product title/tags/variant options.
// Replace later with a vision-based extractor; the interface stays the same.

export type ColorExtractionInput = {
  title: string;
  tags?: string[];
  variantOptions?: Array<{ name?: string; value?: string }>;
};

export type ColorExtractionResult = {
  primaryColor: string | null;   // hex
  colorFamily: string | null;
  source: "tag" | "title" | "variant" | "none";
};

// Family → canonical hex. Same dictionary used by Style color rules so output stays consistent.
const FAMILY_HEX: Record<string, string> = {
  blue: "#1F3A8A", navy: "#1E2A52", white: "#F8FAFC", black: "#0B0B0F",
  grey: "#3B3F45", gray: "#3B3F45", brown: "#6B3F1D", tan: "#B07A4A",
  beige: "#D9C7A7", cream: "#F0E9D8", green: "#556B2F", olive: "#6B7236",
  red: "#9B2226", silver: "#C0C5CD", gold: "#C9A24B", pink: "#E8B4C8",
  yellow: "#F4C95D", purple: "#5B3A78", orange: "#D87C3A", charcoal: "#3B3F45",
  indigo: "#1B2A49", khaki: "#B5A26A", maroon: "#6B1F2A", burgundy: "#6B1F2A",
};

// Synonyms collapse to canonical family.
const SYNONYM: Record<string, string> = {
  gray: "grey",
  charcoal: "grey",
  burgundy: "maroon",
  ivory: "cream",
  ecru: "cream",
  ebony: "black",
  jet: "black",
};

function canonical(family: string): string {
  const lower = family.toLowerCase();
  return SYNONYM[lower] ?? lower;
}

// Specificity tiebreaker: when two families have the same length, the more specific
// shade wins. "Navy Blue" → navy. "Olive Green" → olive. "Tan Brown" → tan.
const SPECIFICITY: Record<string, number> = {
  navy: 10, indigo: 10, charcoal: 10, olive: 9, khaki: 9, tan: 9,
  cream: 8, beige: 8, maroon: 8, burgundy: 8, silver: 7, gold: 7,
  blue: 1, green: 1, brown: 1, white: 1, black: 1, grey: 1, gray: 1, red: 1,
};

function scan(text: string): string | null {
  const lower = text.toLowerCase();
  // Sort by length desc, then specificity desc — guarantees "navy" beats "blue" on a tie.
  const families = Object.keys(FAMILY_HEX).sort((a, b) => {
    const byLen = b.length - a.length;
    if (byLen !== 0) return byLen;
    return (SPECIFICITY[b] ?? 0) - (SPECIFICITY[a] ?? 0);
  });
  // Pick the first match in priority order, regardless of where it appears in the text.
  for (const f of families) {
    const re = new RegExp(`\\b${f}\\b`, "i");
    if (re.test(lower)) return canonical(f);
  }
  return null;
}

export function extractColor(input: ColorExtractionInput): ColorExtractionResult {
  // 1. Tag wins — most reliable.
  for (const t of input.tags ?? []) {
    const hit = scan(t);
    if (hit) return { primaryColor: FAMILY_HEX[hit] ?? null, colorFamily: hit, source: "tag" };
  }
  // 2. Variant option named "Color" / "Colour".
  for (const opt of input.variantOptions ?? []) {
    if (!opt.value) continue;
    if (opt.name && !/colou?r/i.test(opt.name)) continue;
    const hit = scan(opt.value);
    if (hit) return { primaryColor: FAMILY_HEX[hit] ?? null, colorFamily: hit, source: "variant" };
  }
  // 3. Title last.
  const titleHit = scan(input.title);
  if (titleHit) return { primaryColor: FAMILY_HEX[titleHit] ?? null, colorFamily: titleHit, source: "title" };

  return { primaryColor: null, colorFamily: null, source: "none" };
}

export const COLOR_FAMILY_HEX = FAMILY_HEX;
