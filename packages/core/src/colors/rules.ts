// Color rule library — consumed by Stylique Style + Studio.
// Deterministic rules; the AI styling adapter uses these as constraints, not creative freedom.

import type { ColorRule, ColorCombo } from "@stylique/types";

// Canonical color family palettes. Hex picked to be neutral, photographic.
const FAMILY: Record<string, string> = {
  blue: "#1F3A8A",
  navy: "#1E2A52",
  white: "#F8FAFC",
  black: "#0B0B0F",
  grey: "#3B3F45",
  brown: "#6B3F1D",
  tan: "#B07A4A",
  beige: "#D9C7A7",
  cream: "#F0E9D8",
  green: "#556B2F",
  olive: "#6B7236",
  red: "#9B2226",
  silver: "#C0C5CD",
  gold: "#C9A24B",
  neutral: "#D9C7A7",
};

const NEUTRALS = [FAMILY.white, FAMILY.cream, FAMILY.beige, FAMILY.grey, FAMILY.black];

// Hand-curated compatibility table. Family → families it pairs with.
const COMPATIBLE: Record<string, string[]> = {
  blue:    ["white", "beige", "navy", "grey", "brown"],
  navy:    ["white", "cream", "beige", "tan", "silver", "grey"],
  white:   ["blue", "navy", "black", "brown", "green", "tan"],
  black:   ["white", "grey", "silver", "cream"],
  grey:    ["white", "black", "navy", "blue"],
  brown:   ["white", "beige", "cream", "navy", "olive"],
  tan:     ["white", "navy", "olive", "brown"],
  beige:   ["blue", "navy", "brown", "white", "olive"],
  cream:   ["brown", "navy", "olive", "black"],
  green:   ["white", "beige", "tan", "brown"],
  olive:   ["cream", "beige", "tan", "brown"],
  red:     ["white", "navy", "grey", "black"],
  silver:  ["navy", "black", "grey"],
  gold:    ["navy", "cream", "brown"],
  neutral: ["blue", "navy", "brown", "green"],
};

// High-contrast pairings (used to suggest statement combos).
const CONTRAST: Record<string, string[]> = {
  blue:    ["#F5F0E1", "#C9A24B"],
  navy:    ["#F8FAFC", "#C9A24B"],
  white:   ["#0B0B0F", "#1E2A52"],
  black:   ["#F8FAFC", "#C9A24B"],
  brown:   ["#F0E9D8", "#1E2A52"],
  green:   ["#F0E9D8", "#9B2226"],
};

const SEASONAL: Record<string, { SS: string[]; AW: string[] }> = {
  blue:  { SS: ["#F8FAFC", "#F0E9D8"], AW: ["#3B3F45", "#6B3F1D"] },
  navy:  { SS: ["#F8FAFC", "#C8B697"], AW: ["#0B0B0F", "#6B3F1D"] },
  brown: { SS: ["#F0E9D8", "#C8B697"], AW: ["#0B0B0F", "#3B3F45"] },
  white: { SS: ["#1F3A8A", "#556B2F"], AW: ["#1E2A52", "#0B0B0F"] },
  black: { SS: ["#F8FAFC"],            AW: ["#C0C5CD", "#3B3F45"] },
};

export function getColorRule(family: string, anchorHex?: string): ColorRule {
  const key = family.toLowerCase();
  const anchor = anchorHex ?? FAMILY[key] ?? "#000000";
  return {
    anchorColor: anchor,
    compatibleColors: (COMPATIBLE[key] ?? []).map((f) => FAMILY[f]).filter(Boolean),
    contrastColors: CONTRAST[key] ?? [],
    neutralPairings: NEUTRALS.filter((c) => c.toLowerCase() !== anchor.toLowerCase()),
    seasonalPairings: SEASONAL[key],
  };
}

// Turn a color rule into 3-4 named combos with rationale. Style module ships these to the widget.
export function buildColorCombos(family: string, anchorHex?: string): ColorCombo[] {
  const rule = getColorRule(family, anchorHex);
  const combos: ColorCombo[] = [];

  if (rule.compatibleColors.length) {
    combos.push({
      name: "Everyday Pair",
      palette: [rule.anchorColor, ...rule.compatibleColors.slice(0, 2)],
      rationale: "Tonal pairings that flatter without competing — wears anywhere.",
      occasion: "weekend",
    });
  }
  if (rule.neutralPairings.length) {
    combos.push({
      name: "Clean Neutrals",
      palette: [rule.anchorColor, ...rule.neutralPairings.slice(0, 2)],
      rationale: "Anchor color with calm neutrals — sharpest for office and travel.",
      occasion: "office",
    });
  }
  if (rule.contrastColors.length) {
    combos.push({
      name: "Statement Contrast",
      palette: [rule.anchorColor, ...rule.contrastColors.slice(0, 2)],
      rationale: "High-contrast pairing that turns the look into the focal point.",
      occasion: "evening",
    });
  }
  if (rule.seasonalPairings) {
    combos.push({
      name: "In Season",
      palette: [rule.anchorColor, ...rule.seasonalPairings.SS.slice(0, 2)],
      rationale: "Lighter palette tuned to spring/summer light.",
      season: "SS",
    });
  }
  return combos;
}
