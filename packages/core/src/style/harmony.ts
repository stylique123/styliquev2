// Color harmony engine (D40) — HSL distance, harmony-type detection, and
// a structured "why it works" output Mira can surface to shoppers.
//
// Pure function, zero deps, zero per-call cost. Input is a list of hex
// colors (one per garment); output names the harmony rule the palette
// obeys, identifies which piece anchors the look + which accents, and
// returns a one-sentence stylist's-rule reasoning that the Brain can
// emit verbatim or paraphrase.
//
// Skin-tone awareness: when ShopperSession.skinTone is known, we tag
// undertone mismatches in the reasoning so Mira can address them.

export type HarmonyType =
  | "monochromatic"          // all hues within ±10° on the wheel
  | "analogous"              // hues within ~30° band
  | "complementary"          // two hues ~180° apart
  | "triadic"                // three hues ~120° apart
  | "split_complementary"    // base + the two hues flanking its complement
  | "neutral_with_accent"    // mostly low-sat + one statement color
  | "tonal"                  // same family, different values (oat/sand/bone)
  | "high_contrast"          // anchor + opposing accent, no formal rule
  | "uncategorized";         // fallback — palette doesn't read as a known rule

export type UndertonePref = "warm" | "cool" | "neutral";

export type ColorHarmonyInput = {
  // One hex per garment in display order (anchor first when known).
  palette: string[];
  // Optional shopper skin undertone — when set, we tag undertone fit.
  shopperUndertone?: UndertonePref | null;
};

export type ColorHarmonyResult = {
  harmonyType: HarmonyType;
  palette: string[];        // normalized lowercase 6-char hex
  anchor: string;           // the dominant / grounding piece's hex
  accent: string | null;    // the statement color, when distinct from anchor
  neutrals: string[];       // pieces that read as neutral (low sat OR very low/high light)
  undertoneFit: "matches" | "neutral" | "mismatches" | "unknown";
  // One sentence Mira can speak. NOT a generated string from an AI —
  // composed from a small set of stylist-grade rule templates so the
  // tone stays consistent across surfaces.
  reasoning: string;
};

// ─── HSL conversion ────────────────────────────────────────────────────

type Hsl = { h: number; s: number; l: number };

function normalizeHex(hex: string): string | null {
  const m = hex.trim().toLowerCase().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const v = m[1]!;
  return v.length === 3
    ? v.split("").map((c) => c + c).join("")
    : v;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  return {
    r: parseInt(norm.slice(0, 2), 16),
    g: parseInt(norm.slice(2, 4), 16),
    b: parseInt(norm.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: (h / 6) * 360, s, l };
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function toHsl(hex: string): Hsl | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

// ─── Classifiers ──────────────────────────────────────────────────────

function isNeutral(c: Hsl): boolean {
  // Low saturation = neutral. Very dark or very light at any sat also reads as neutral.
  return c.s < 0.15 || c.l < 0.12 || c.l > 0.88;
}

function isWarm(h: number): boolean {
  // Reds / oranges / yellows / warm greens
  return (h >= 0 && h < 80) || h >= 330;
}

function isCool(h: number): boolean {
  // Cool greens / blues / purples
  return h >= 150 && h < 290;
}

function paletteUndertone(hsls: Hsl[]): UndertonePref | "mixed" {
  const colored = hsls.filter((c) => !isNeutral(c));
  if (colored.length === 0) return "neutral";
  let warm = 0, cool = 0;
  for (const c of colored) {
    if (isWarm(c.h)) warm++;
    else if (isCool(c.h)) cool++;
  }
  if (warm > 0 && cool === 0) return "warm";
  if (cool > 0 && warm === 0) return "cool";
  if (warm === 0 && cool === 0) return "neutral";
  return "mixed";
}

// ─── Harmony detection ────────────────────────────────────────────────
// Order matters — first matching rule wins, narrower rules first.

function detectHarmony(hsls: Hsl[]): HarmonyType {
  const colored = hsls.filter((c) => !isNeutral(c));
  const neutrals = hsls.length - colored.length;

  // All neutrals + one accent — the most common editorial look.
  if (colored.length === 1 && neutrals >= 1) return "neutral_with_accent";
  // Zero colored = pure tonal/monochromatic neutrals (oat/bone/black).
  if (colored.length === 0) return "tonal";

  const hues = colored.map((c) => c.h).sort((a, b) => a - b);

  if (colored.length >= 2) {
    // Maximum pairwise hue distance bins everything below.
    let maxD = 0;
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const d = hueDistance(hues[i]!, hues[j]!);
        if (d > maxD) maxD = d;
      }
    }
    if (maxD <= 12) return "monochromatic";
    if (maxD <= 35) return "analogous";

    if (colored.length === 2) {
      if (Math.abs(maxD - 180) <= 20) return "complementary";
      return maxD > 60 ? "high_contrast" : "analogous";
    }

    if (colored.length === 3) {
      // Triadic: all three pairwise distances ~120°
      const d01 = hueDistance(hues[0]!, hues[1]!);
      const d12 = hueDistance(hues[1]!, hues[2]!);
      const d02 = hueDistance(hues[0]!, hues[2]!);
      const triadOk =
        Math.abs(d01 - 120) <= 25 &&
        Math.abs(d12 - 120) <= 25 &&
        Math.abs(d02 - 120) <= 25;
      if (triadOk) return "triadic";
      // Split-complementary: one anchor, two hues ~30° around its complement.
      const splitOk =
        Math.abs(d01 - 150) <= 20 &&
        Math.abs(d02 - 150) <= 20;
      if (splitOk) return "split_complementary";
    }
  }

  return "uncategorized";
}

// ─── Reasoning composer — short, original, stylist-grade ──────────────
// One sentence per harmony type. We pick the template + interpolate the
// hex names as needed. NO AI generation — keeps tone consistent.

function reasoningFor(
  harmony: HarmonyType,
  anchorHex: string,
  accentHex: string | null,
  hasNeutrals: boolean,
  undertoneFit: "matches" | "neutral" | "mismatches" | "unknown",
): string {
  const anchor = anchorHex;
  const accent = accentHex ?? anchor;
  let base: string;
  switch (harmony) {
    case "monochromatic":
      base = `Single-hue look — every piece pulls from ${anchor}, so the eye reads silhouette and texture, not color.`;
      break;
    case "analogous":
      base = `Adjacent tones around ${anchor} — they share enough hue to feel unified without going flat.`;
      break;
    case "complementary":
      base = `${anchor} grounded, ${accent} lifts it — opposites on the wheel, balanced by the neutral fabric.`;
      break;
    case "triadic":
      base = `Three colors evenly spaced on the wheel, anchored by ${anchor} — bold but balanced.`;
      break;
    case "split_complementary":
      base = `${anchor} anchors the look, two softer accents flank its opposite — gives the contrast without the clash.`;
      break;
    case "neutral_with_accent":
      base = `Neutral base, ${accent} as the single statement — editorial discipline, lets the cut speak.`;
      break;
    case "tonal":
      base = `Tonal layering — different values of the same family, depth without contrast.`;
      break;
    case "high_contrast":
      base = `${anchor} vs ${accent} — high contrast, no neutral mediator. Wear it when you want the look to be seen.`;
      break;
    default:
      base = hasNeutrals
        ? `Grounded by ${anchor} with quiet supporting pieces.`
        : `Layered build around ${anchor}.`;
  }
  // Undertone callout — only when we have a clear mismatch to flag.
  if (undertoneFit === "mismatches") {
    base += " Note: the warm/cool balance leans against your undertone — consider swapping the accent for a closer match.";
  }
  return base;
}

// ─── Public entry ─────────────────────────────────────────────────────

export function analyzeColorHarmony(input: ColorHarmonyInput): ColorHarmonyResult {
  const hexes = input.palette
    .map((p) => normalizeHex(p))
    .filter((h): h is string => Boolean(h));

  if (hexes.length === 0) {
    return {
      harmonyType: "uncategorized",
      palette: [],
      anchor: "",
      accent: null,
      neutrals: [],
      undertoneFit: "unknown",
      reasoning: "No colors provided.",
    };
  }

  const hsls = hexes.map((h) => toHsl(h)).filter((c): c is Hsl => Boolean(c));
  const neutralsHex = hexes.filter((_, i) => hsls[i] && isNeutral(hsls[i]!));
  const coloredHex = hexes.filter((_, i) => hsls[i] && !isNeutral(hsls[i]!));

  const harmony = detectHarmony(hsls);

  // Anchor pick — prefer the most saturated colored piece, else the
  // largest-area (first-listed) piece as a fallback.
  const anchor =
    coloredHex.length > 0
      ? hexes[hsls.findIndex((c) => !isNeutral(c) && c.s === Math.max(...coloredHex.map((h) => toHsl(h)!.s)))]!
      : hexes[0]!;

  // Accent — the colored piece that's NOT the anchor (when present).
  const accent =
    coloredHex.length > 1
      ? coloredHex.find((h) => h !== anchor) ?? null
      : null;

  // Undertone match against shopper's skin tone, when known.
  const palUndertone = paletteUndertone(hsls);
  let undertoneFit: ColorHarmonyResult["undertoneFit"] = "unknown";
  if (input.shopperUndertone) {
    if (palUndertone === "neutral" || palUndertone === input.shopperUndertone) {
      undertoneFit = "matches";
    } else if (palUndertone === "mixed") {
      undertoneFit = "neutral";
    } else {
      undertoneFit = "mismatches";
    }
  }

  return {
    harmonyType: harmony,
    palette: hexes,
    anchor,
    accent,
    neutrals: neutralsHex,
    undertoneFit,
    reasoning: reasoningFor(
      harmony,
      anchor,
      accent,
      neutralsHex.length > 0,
      undertoneFit,
    ),
  };
}
