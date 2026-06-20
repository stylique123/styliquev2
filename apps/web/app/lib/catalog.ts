// Stylique Maison, editorial fashion catalog.
//
// All product names, copy, and price points are original to Stylique. Imagery
// is sourced from Unsplash's free commercial library (swappable in one place
// when Higgsfield-rendered hero stills are wired in).
//
// All image IDs below are visually verified: correct 200 status + fashion-appropriate.

export type Product = {
  /** Tenant-scoped database id. Present only for products returned by Shopify. */
  productId?: string;
  handle: string;
  name: string;
  collection: CollectionSlug;
  category: "outerwear" | "dress" | "top" | "bottom" | "knitwear" | "accessory" | "unknown";
  priceUsd: number;
  description: string;
  images: string[]; // first image is the primary
  colors: string[];
  sizes: string[];

  // ── Per-product intelligence fields ────────────────────────────────────────
  // Populated from review mining + brand fit notes.
  // Used by Mira for fit Q&A, hesitation nudges, and fabric conversations.

  /** How this piece actually fits, honest, review-grounded, brand-specific. */
  fitNotes: string;
  /** Proactive message that fires when a shopper hesitates on this PDP. Addresses
   *  the most common objection for this specific product. */
  hesitationHint: string;
  /** Full fabric composition, used for fabric/care Q&A with decision framing. */
  fabricComposition: string;
  /** Care instructions, surfaces when asked. */
  careInstructions: string;
  /** Percentage of shoppers (by measurement) who kept their recommended size.
   *  Used for social proof in size conversations. */
  keepRate?: number; // e.g. 0.82 = "82% of shoppers kept the M"
  /** Whether this is currently low stock (triggers honest urgency). */
  lowStock?: boolean;

  /** Brand-specific size chart. Sizes here ALWAYS match `sizes` above, some
   *  pieces offer XS, L, some XS, XL, denim runs 24, 32. The recommender only ever
   *  returns a size that exists in this chart. Measurements are the body
   *  measurements each size is cut for (cm), so fit math is brand-exact. */
  sizeChart?: SizeChart;
};

export type SizeChart = {
  unit: "cm";
  /** Which body measurement drives the size decision for this garment. */
  primary: "bust" | "waist" | "hip";
  /** Ordered measurement labels shown to the shopper. */
  measures: string[];
  /** size label → body measurements (cm) the size is cut for, aligned to `measures`. */
  rows: Record<string, number[]>;
  /** How much ease the cut adds over the body measurement (cm). Negative = bodycon. */
  ease: number;
  /** Free-text source label, mirrors the production multi-source extractor. */
  source: string;
};

export type CollectionSlug =
  | "the-atelier"
  | "evening"
  | "tailoring"
  | "knitwear"
  | "outerwear"
  | "south-asian"
  | "bridal"
  | "accessories"
  | "streetwear"
  | "active"
  | "modest";

export type Collection = {
  slug: CollectionSlug;
  name: string;
  tagline: string;
  cover: string;
};

const u = (id: string, w = 1600) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

export const collections: Collection[] = [
  {
    slug: "the-atelier",
    name: "The Atelier",
    tagline: "Hand-finished pieces from the studio floor",
    cover: u("1490481651871-ab68de25d43d", 1200), // elegant wardrobe, 200 ✓
  },
  {
    slug: "evening",
    name: "Evening",
    tagline: "Silks, slips, and the quiet drama of night",
    cover: u("1595777457583-95e059d581b8", 1200), // woman in red flowing gown, 200 ✓
  },
  {
    slug: "tailoring",
    name: "Tailoring",
    tagline: "Cut close, worn loose, the new structure",
    cover: u("1594938298603-c8148c4dae35", 1200), // blue windowpane suit, 200 ✓
  },
  {
    slug: "knitwear",
    name: "Knitwear",
    tagline: "Cashmere, merino, and the long winter",
    cover: u("1504703395950-b89145a5425b", 1200), // woman in grey knit, 200 ✓
  },
  {
    slug: "outerwear",
    name: "Outerwear",
    tagline: "Coats that carry a room",
    cover: u("1539109136881-3be0616acf4b", 1200), // dark editorial, 200 ✓
  },
];

// Asset base for product images. Injected at BUILD time so this ONE catalog
// serves both surfaces: the storefront widget bundle defines __SQ_ASSET_BASE__
// to the backend origin (images MUST be absolute on the Shopify domain), while
// the demo app leaves it undefined → relative, same-origin. `typeof` guard is
// ReferenceError-safe when the define is absent.
declare const __SQ_ASSET_BASE__: string;
// The backend origin (assets AND the /api/* endpoints live here). Set at BUILD
// time by the widget's esbuild define; empty on the same-origin demo. Exported so
// MiraWidget/TryOnPanel use it for fetch + nav too, a build-time constant has no
// module-load-ordering hazard (a runtime window global read at module-init would
// evaluate BEFORE the entry sets it → "" → storefront fetches hit the shop domain
// → 404 → silent regex fallback; that was the bug).
export const ASSET_BASE = typeof __SQ_ASSET_BASE__ !== "undefined" ? __SQ_ASSET_BASE__ : "";
export function resolveAsset(path: string): string {
  return path.startsWith("/") ? `${ASSET_BASE}${path}` : path;
}

export const products: Product[] = [
  {
    handle: "onyx-silk-slip",
    name: "Onyx Silk Slip",
    collection: "evening",
    category: "dress",
    priceUsd: 690,
    description:
      "Bias-cut mulberry silk slip with a hand-rolled hem. Cut to skim, not cling.",
    images: ["/products/onyx-silk-slip-1.png", "/products/onyx-silk-slip-2.png"],
    colors: ["Onyx", "Ivory"],
    sizes: ["XS", "S", "M", "L"],
    fitNotes: "Bias cut is unforgiving in the wrong size. Most customers size up one from their usual, the S is genuinely small. If you're between sizes, the M is the safer call.",
    hesitationHint: "The bias cut is the hardest thing to judge in photos. It skims without clinging, people are always surprised by how it actually feels on.",
    fabricComposition: "100% mulberry silk, 19 momme weight. Hand-rolled hem.",
    careInstructions: "Dry clean recommended. Can be hand-washed cold on a delicate cycle, lay flat to dry.",
    keepRate: 0.79,
    lowStock: true,
  },
  {
    handle: "ivory-silk-camisole",
    name: "Ivory Silk Camisole",
    collection: "evening",
    category: "top",
    priceUsd: 320,
    description:
      "Featherweight charmeuse with a deep V and adjustable straps. Layer or wear alone.",
    images: ["/products/ivory-silk-camisole-1.png", "/products/ivory-silk-camisole-2.png"],
    colors: ["Ivory", "Onyx"],
    sizes: ["XS", "S", "M", "L"],
    fitNotes: "True to size. The fully adjustable straps give about 5cm of range so it works across a range of heights. Deep V is exactly as shown, it's not subtle.",
    hesitationHint: "A lot of people ask whether the straps stay in place. They do, they're not decorative, they're load-bearing.",
    fabricComposition: "100% charmeuse silk. Featherweight, approx 12 momme.",
    careInstructions: "Hand wash cold or dry clean. Iron on lowest setting with a press cloth.",
    keepRate: 0.88,
  },
  {
    handle: "atelier-wide-leg-trouser",
    name: "Atelier Wide-Leg Trouser",
    collection: "tailoring",
    category: "bottom",
    priceUsd: 540,
    description:
      "High-waisted wool blend with a fluid drape. Designed to fall, not break.",
    images: ["/products/atelier-wide-leg-trouser-1.png", "/products/atelier-wide-leg-trouser-2.png"],
    colors: ["Charcoal", "Camel", "Ink"],
    sizes: ["XS", "S", "M", "L", "XL"],
    fitNotes: "High-rise runs true in the waist but is cut for a longer torso. Petite customers (under 5'4\") typically need a 3, 4cm hem taken up. True to size in the waist.",
    hesitationHint: "The high waist is the detail people ask about most, it reads more flattering than it looks on the hanger. It's designed to sit at your natural waist, not your hips.",
    fabricComposition: "72% wool, 24% viscose, 4% elastane. Fluid-drape construction.",
    careInstructions: "Dry clean only. Steam to refresh between wears.",
    keepRate: 0.85,
  },
  {
    handle: "linen-relaxed-shirt",
    name: "Linen Relaxed Shirt",
    collection: "the-atelier",
    category: "top",
    priceUsd: 280,
    description:
      "Belgian linen with a sand-washed finish. Oversized through the shoulder.",
    images: ["/products/linen-relaxed-shirt-1.png", "/products/linen-relaxed-shirt-2.png"],
    colors: ["Bone", "Stone", "Black"],
    sizes: ["XS", "S", "M", "L", "XL"],
    fitNotes: "Intentionally oversized through the shoulder, even the XS is roomy. If you want a more fitted look, size down one. If you want the relaxed/tucked-out look, go true to size.",
    hesitationHint: "The oversized shoulder is a deliberate cut, same drop-shoulder detail you're seeing in every atelier collection this season. It's not a sizing issue, it's the silhouette.",
    fabricComposition: "100% Belgian linen, sand-washed for softness. Gets better with every wash.",
    careInstructions: "Machine wash cold, hang to dry. Do not tumble dry, it will shrink. Linen wrinkles naturally; embrace it or iron damp.",
    keepRate: 0.91,
  },
  {
    handle: "wrap-coat-camel",
    name: "Camel Wrap Coat",
    collection: "outerwear",
    category: "outerwear",
    priceUsd: 1280,
    description:
      "Double-faced cashmere wool, belted at the waist. Half-canvas construction, fully unlined.",
    images: ["/products/wrap-coat-camel-1.png", "/products/wrap-coat-camel-2.png"],
    colors: ["Camel", "Charcoal"],
    sizes: ["XS", "S", "M", "L"],
    fitNotes: "Generous through the shoulder and body, designed to wear over a blazer. Belts at a natural waist. Runs slightly long in the sleeve on petite frames (under 5'4\"). True to size for most.",
    hesitationHint: "The double-faced cashmere-wool face is genuinely different from anything synthetic at a lower price point, it has a body and warmth that photographs can't capture.",
    fabricComposition: "80% cashmere, 20% wool. Double-faced construction. Half-canvas chest piece. Fully unlined.",
    careInstructions: "Dry clean only. Store folded, not hung, to preserve the shoulder shape. Cashmere pilling is normal in high-friction areas, remove with a fabric comb.",
    keepRate: 0.87,
    lowStock: true,
  },
  {
    handle: "cashmere-v-neck",
    name: "Cashmere V-Neck",
    collection: "knitwear",
    category: "knitwear",
    priceUsd: 420,
    description:
      "12-gauge Mongolian cashmere, knit in Scotland. Ribbed cuffs, fine gauge throughout.",
    images: ["/products/cashmere-v-neck-1.png", "/products/cashmere-v-neck-2.png"],
    colors: ["Oat", "Black", "Cardinal"],
    sizes: ["XS", "S", "M", "L"],
    fitNotes: "Knits relax 3, 4cm in length and slightly in width after a few wears. We recommend your true size. If you wear your knitwear oversized, go up one.",
    hesitationHint: "12-gauge is the detail that separates this from thinner knits, it's substantial enough to wear alone in cold weather, fine enough to layer under a coat without bulk.",
    fabricComposition: "100% Grade-A Mongolian cashmere, 12-gauge. Knit in Scotland.",
    careInstructions: "Hand wash cold or dry clean. Lay flat to dry, never hang a cashmere knit. Fold, don't hang, for storage.",
    keepRate: 0.93,
  },
  {
    handle: "midnight-silk-gown",
    name: "Midnight Silk Gown",
    collection: "evening",
    category: "dress",
    priceUsd: 1450,
    description:
      "Floor-grazing crepe-back satin with a cowl neck. The dress for the long table.",
    images: ["/products/midnight-silk-gown-1.png", "/products/midnight-silk-gown-2.png"],
    colors: ["Midnight"],
    sizes: ["XS", "S", "M", "L"],
    fitNotes: "The cowl neck adds visual length to the torso. Go true to size for a fitted silhouette, or size up for more drape through the body. Works well on heights from 5'4\" upward without alterations.",
    hesitationHint: "The cowl neck is the hardest detail to visualise before you try it. It frames the collarbone in a way that most necklines don't.",
    fabricComposition: "100% crepe-back satin silk, 21 momme. The heavier weight prevents it from clinging in the wrong places.",
    careInstructions: "Dry clean only. Do not machine wash, the weight and drape will be permanently affected.",
    keepRate: 0.82,
    lowStock: true,
  },
  {
    handle: "tailored-blazer-double",
    name: "Tailored Double-Breasted Blazer",
    collection: "tailoring",
    category: "outerwear",
    priceUsd: 890,
    description:
      "Italian virgin wool, peak lapels, half-lined. A blazer that sits like a coat.",
    images: ["/products/tailored-blazer-double-1.png", "/products/tailored-blazer-double-2.png"],
    colors: ["Charcoal", "Ink"],
    sizes: ["XS", "S", "M", "L", "XL"],
    fitNotes: "Peak lapels require shoulder room, if you're between sizes and broader through the shoulder, go up one. The body runs slim by design. Sleeve length is generous.",
    hesitationHint: "The half-lining is the construction detail that separates this from fast-fashion suiting, it lets the Italian wool breathe and move with you instead of being stiff.",
    fabricComposition: "100% Italian virgin wool, 280g/m². Half-lined in Bemberg cupro. Peak lapels with functioning button cuffs.",
    careInstructions: "Dry clean only. Hang on a wide shoulder hanger to preserve shape. Steam between wears, do not press with direct iron.",
    keepRate: 0.86,
  },
  {
    handle: "pleated-midi-skirt",
    name: "Pleated Satin Midi Skirt",
    collection: "the-atelier",
    category: "bottom",
    priceUsd: 480,
    description:
      "Knife-pleated satin that catches every shift of light. Hidden side zip.",
    images: ["/products/pleated-midi-skirt-1.png", "/products/pleated-midi-skirt-2.png"],
    colors: ["Champagne", "Black"],
    sizes: ["XS", "S", "M", "L"],
    fitNotes: "The knife pleats add some volume at the hip, customers who prefer a more streamlined silhouette often size down one. True to size gives the full pleated effect as designed.",
    hesitationHint: "The pleats in photos look static, in person they catch and release light when you move. It's the detail that makes this worth the price.",
    fabricComposition: "100% duchess satin, 100% silk. Knife pleats. Hidden side zip. Fully lined in silk charmeuse.",
    careInstructions: "Dry clean only. The knife pleats should be pressed flat from the waistband. Never machine wash.",
    keepRate: 0.84,
  },
  {
    handle: "merino-ribbed-turtleneck",
    name: "Merino Ribbed Turtleneck",
    collection: "knitwear",
    category: "knitwear",
    priceUsd: 290,
    description:
      "Extra-fine 18.5 micron merino with a fitted body and an extended neck.",
    images: ["/products/merino-ribbed-turtleneck-1.png", "/products/merino-ribbed-turtleneck-2.png"],
    colors: ["Bone", "Black", "Espresso"],
    sizes: ["XS", "S", "M", "L"],
    fitNotes: "Fitted cut, this is a bodycon silhouette. True to size. The extended neck can be worn folded or full-height. 18.5 micron means no itch even directly on skin.",
    hesitationHint: "18.5 micron is the threshold where merino stops being scratchy. This sits directly on skin without irritation, most people are surprised by that.",
    fabricComposition: "100% extra-fine merino wool, 18.5 micron. Fine-gauge rib knit. Does not pill.",
    careInstructions: "Machine wash cold on wool cycle. Lay flat to dry. No tumble drying.",
    keepRate: 0.90,
  },
  {
    handle: "leather-trench",
    name: "Leather Trench",
    collection: "outerwear",
    category: "outerwear",
    priceUsd: 2400,
    description:
      "Soft Italian nappa, hand-finished seams, raglan sleeves. Built to outlast the season.",
    images: ["/products/leather-trench-1.png", "/products/leather-trench-2.png"],
    colors: ["Cognac", "Black"],
    sizes: ["XS", "S", "M", "L"],
    fitNotes: "Runs slightly narrow through the shoulder, if you're broader in the shoulder, go up one. The raglan sleeve construction means the armhole is generous. Italian nappa softens and moulds with wear.",
    hesitationHint: "The break-in on Italian nappa is real, it's slightly stiff the first 2, 3 wears, then it becomes exactly what you want. Every crease it develops is specific to how you wear it.",
    fabricComposition: "100% Italian nappa leather. Hand-finished seams. Raglan sleeve construction. Fully lined in viscose.",
    careInstructions: "Professional leather cleaning only. Condition with leather conditioner twice yearly. Store on a padded hanger, away from direct light.",
    keepRate: 0.88,
    lowStock: true,
  },
  {
    handle: "wide-leg-denim",
    name: "Wide-Leg Heritage Denim",
    collection: "the-atelier",
    category: "bottom",
    priceUsd: 320,
    description:
      "Selvedge denim woven in Okayama, washed soft, cut clean through the leg.",
    images: ["/products/wide-leg-denim-1.png", "/products/wide-leg-denim-2.png"],
    colors: ["Indigo", "Black"],
    sizes: ["24", "26", "28", "30", "32"],
    fitNotes: "Selvedge denim has minimal stretch. Size up one from your usual stretch denim size, if you normally wear a 28 in stretch denim, go to a 29 or 30 here. They will loosen slightly with wear but not significantly.",
    hesitationHint: "Selvedge denim develops a fade pattern unique to how you specifically wear and wash it. The longer you go between washes, the better the fade. These are meant to last 10+ years.",
    fabricComposition: "100% cotton, selvedge woven in Okayama Japan. 13.5oz weight. Sand-washed for softness. No stretch.",
    careInstructions: "Machine wash cold inside-out. Or better: hand wash every 5, 6 wears and wash infrequently to preserve the fade. Do not tumble dry, hang or lay flat.",
    keepRate: 0.83,
  },

  // ── Accessories (founder #11 — recommended, rated, and try-on-able in the
  //    ONE flow; the accent slot in completeLookFor + accessoryClause in the
  //    try-on render pick these up with zero special-casing) ────────────────
  {
    handle: "saddle-leather-belt",
    name: "Saddle Leather Belt",
    collection: "accessories",
    category: "accessory",
    priceUsd: 180,
    description:
      "Full-grain vegetable-tanned leather with a polished antique-brass buckle. Cut at 3.5cm to sit cleanly at the waist of a trouser or over knitwear.",
    images: ["/products/saddle-leather-belt-1.png", "/products/saddle-leather-belt-2.png"],
    colors: ["Cognac"],
    sizes: ["S", "M", "L"],
    fitNotes: "Sized by waist: S fits 66-72cm, M fits 74-80cm, L fits 82-90cm, measured where you actually wear it (over trousers sits ~3cm larger than bare waist). Worn over knitwear or a coat, size up one.",
    hesitationHint: "Vegetable-tanned leather starts stiff and breaks in to follow your waist within a couple of weeks, then holds that shape for years. The patina it develops is the point.",
    fabricComposition: "Full-grain vegetable-tanned leather, solid antique-brass buckle. No bonded or split leather anywhere.",
    careInstructions: "Wipe with a dry cloth. Condition with leather balm twice a year. Keep away from prolonged direct sun.",
    keepRate: 0.94,
    sizeChart: {
      unit: "cm",
      primary: "waist",
      measures: ["waist"],
      rows: { S: [69], M: [77], L: [86] },
      ease: 2,
      source: "brand size guide",
    },
  },
  {
    handle: "structured-leather-tote",
    name: "Structured Leather Tote",
    collection: "accessories",
    category: "accessory",
    priceUsd: 640,
    description:
      "An architectural everyday tote in grained calf leather. Holds a 14-inch laptop flat; stands upright on its own.",
    images: ["/products/structured-leather-tote-1.png", "/products/structured-leather-tote-2.png"],
    colors: ["Black"],
    sizes: ["One Size"],
    fitNotes: "One size. The top handles clear a coat sleeve comfortably on the shoulder; carried in hand it sits at mid-thigh on most frames.",
    hesitationHint: "The structure is the feature: grained calf holds the architectural shape instead of slouching, so it reads polished with a coat at work and just as right over knitwear on the weekend.",
    fabricComposition: "Grained calf leather, subtle gold-tone hardware. Unlined interior with a single flat pocket.",
    careInstructions: "Wipe with a soft dry cloth. Stuff and store upright. Professional leather cleaning for marks.",
    keepRate: 0.92,
  },
];

// Make every product image absolute when a build-time asset base is set (the
// storefront widget); a no-op (relative) on the demo. One source, both surfaces.
for (const p of products) p.images = p.images.map(resolveAsset);

// ── Brand-exact size charts ──────────────────────────────────────────────────
// Each piece carries its OWN chart. The size set differs by product on purpose:
// alpha XS, L, alpha XS, XL, and numeric denim 24, 32. The recommender below never
// returns a size that isn't in the product's chart, so "brand sizing" is real,
// not a generic XS, XL guess.

// Body measurements (cm) each ALPHA size is cut for. measures = [bust, waist, hip].
const ALPHA_BASE: Record<string, number[]> = {
  XS: [82, 64, 89],
  S:  [87, 69, 94],
  M:  [92, 74, 99],
  L:  [97, 79, 104],
  XL: [104, 86, 111],
};
// Bottoms: measures = [waist, hip, inseam].
const BOTTOM_BASE: Record<string, number[]> = {
  XS: [64, 89, 78],
  S:  [69, 94, 79],
  M:  [74, 99, 80],
  L:  [79, 104, 81],
  XL: [86, 111, 82],
};
// Numeric denim (label = waist in inches): measures = [waist, hip, inseam] cm.
const DENIM_BASE: Record<string, number[]> = {
  "24": [61, 86, 76],
  "26": [66, 91, 76],
  "28": [71, 96, 76],
  "30": [76, 101, 76],
  "32": [81, 106, 76],
};

function chartFrom(
  base: Record<string, number[]>,
  sizes: string[],
  measures: string[],
  primary: SizeChart["primary"],
  ease: number,
  source: string,
  bustWaistHipDelta: [number, number, number] = [0, 0, 0],
): SizeChart {
  const rows: Record<string, number[]> = {};
  for (const s of sizes) {
    const row = base[s];
    if (!row) continue;
    rows[s] = row.map((v, i) => v + (bustWaistHipDelta[i] ?? 0));
  }
  return { unit: "cm", primary, measures, rows, ease, source };
}

const ALPHA_M = ["Bust", "Waist", "Hip"];
const BOTTOM_M = ["Waist", "Hip", "Inseam"];

// Per-product charts, brand-specific deviations baked in to match each fitNote.
const SIZE_CHARTS: Record<string, SizeChart> = {
  // Bias silk runs small → chart shifted DOWN 3cm so the recommender sizes up.
  "onyx-silk-slip":           chartFrom(ALPHA_BASE, ["XS","S","M","L"],         ALPHA_M, "bust", 2, "brand fit notes", [-3,-3,-3]),
  "ivory-silk-camisole":      chartFrom(ALPHA_BASE, ["XS","S","M","L"],         ALPHA_M, "bust", 3, "brand size guide"),
  // High-rise tailored trouser, true in waist, full size run.
  "atelier-wide-leg-trouser": chartFrom(BOTTOM_BASE, ["XS","S","M","L","XL"],    BOTTOM_M, "waist", 4, "brand size guide"),
  // Oversized linen, chart shifted UP 6cm bust so even XS reads roomy.
  "linen-relaxed-shirt":      chartFrom(ALPHA_BASE, ["XS","S","M","L","XL"],    ALPHA_M, "bust", 14, "brand fit notes", [6,4,4]),
  "wrap-coat-camel":          chartFrom(ALPHA_BASE, ["XS","S","M","L"],         ALPHA_M, "bust", 12, "size chart image (OCR)"),
  "cashmere-v-neck":          chartFrom(ALPHA_BASE, ["XS","S","M","L"],         ALPHA_M, "bust", 6, "brand size guide"),
  "midnight-silk-gown":       chartFrom(ALPHA_BASE, ["XS","S","M","L"],         ALPHA_M, "bust", 3, "brand fit notes"),
  "tailored-blazer-double":   chartFrom(ALPHA_BASE, ["XS","S","M","L","XL"],    ALPHA_M, "bust", 5, "size chart image (OCR)"),
  "pleated-midi-skirt":       chartFrom(BOTTOM_BASE, ["XS","S","M","L"],         BOTTOM_M, "waist", 5, "brand size guide"),
  // Bodycon merino, negative ease, true to size.
  "merino-ribbed-turtleneck": chartFrom(ALPHA_BASE, ["XS","S","M","L"],         ALPHA_M, "bust", -4, "brand fit notes"),
  "leather-trench":           chartFrom(ALPHA_BASE, ["XS","S","M","L"],         ALPHA_M, "bust", 8, "size chart image (OCR)"),
  // Selvedge denim, numeric waist sizing, runs small → recommender sizes up.
  "wide-leg-denim":           chartFrom(DENIM_BASE, ["24","26","28","30","32"], BOTTOM_M, "waist", 1, "brand fit notes"),
};

for (const p of products) {
  if (SIZE_CHARTS[p.handle]) p.sizeChart = SIZE_CHARTS[p.handle];
}

// ── Shared brand-exact size recommender ──────────────────────────────────────
// Single source of truth used by BOTH the chat widget and the Try-On panel.
// Estimates the shopper's body measurements, then picks the size from THIS
// product's chart whose cut best fits, respecting the shopper's fit preference.
// Only ever returns a size that exists in the product's `sizes` array.

export type FitPref = "snug" | "true" | "relaxed";

export type SizeRec = {
  size: string;
  confidence: number;          // 0, 100
  reasoning: string;           // one human sentence
  primaryLabel: string;        // e.g. "Bust"
  bodyValue: number;           // shopper's estimated measurement (cm)
  garmentValue: number;        // the chosen size's cut measurement (cm)
  alt?: { size: string; note: string }; // a size-up/down nudge when relevant
};

/** Rough anthropometric estimate of bust/waist/hip (cm) from height+weight.
 *  Demo-grade but monotonic, clamped and sane, drives chart matching. Both
 *  inputs move the result: weight (via BMI) sets girth, height adds frame.
 *  Inputs are clamped so absurd values (35kg @ 200cm) still map to the
 *  smallest sane body rather than negative circumferences. */
function estimateBody(heightCm: number, weightKg: number) {
  const h = Math.min(210, Math.max(140, heightCm));
  const w = Math.min(180, Math.max(35, weightKg));
  // Effective BMI clamped to a realistic band so the estimate stays monotonic
  // and never produces impossible measurements at the extremes.
  const rawBmi = w / Math.pow(h / 100, 2);
  const bmi = Math.min(42, Math.max(14, rawBmi));
  // Circumferences scale with BMI; hips slightly fuller than bust on average.
  // A small direct weight term keeps the result responsive even inside one
  // BMI band, and the height term widens the frame for taller shoppers.
  const bust = Math.round(74 + (bmi - 21) * 2.7 + (h - 166) * 0.12 + (w - 62) * 0.06);
  const waist = Math.round(63 + (bmi - 21) * 3.0 + (h - 166) * 0.06 + (w - 62) * 0.05);
  const hip = Math.round(82 + (bmi - 21) * 2.8 + (h - 166) * 0.14 + (w - 62) * 0.06);
  return {
    bust: Math.max(72, bust),
    waist: Math.max(55, waist),
    hip: Math.max(80, hip),
  };
}

export type StretchLevel = "none" | "low" | "mid" | "high";

/**
 * Infer how much a garment gives, from its fabric composition + fit notes.
 * This is the deciding factor for BOTTOMS: a rigid 26 will NOT close on a 28
 * waist (you must size true or up), but a stretch 28 waist can drop to a 26
 * because the fabric gives. Founder rule: for pants, stretch governs the size.
 */
export function fabricStretchLevel(product: Product): StretchLevel {
  const t = `${product.fabricComposition ?? ""} ${product.fitNotes ?? ""} ${product.description ?? ""}`.toLowerCase();
  // Explicit "no give" language always wins.
  if (/\b(no stretch|non-?stretch|rigid|minimal stretch|selvedge)\b/.test(t)) return "none";
  // Four-way stretch / spandex / lycra = high give.
  if (/four-?way stretch|spandex|lycra/.test(t)) return "high";
  // Quantified elastane: ≥8% reads as high, 2, 7% as mid.
  const ela = t.match(/(\d{1,2})\s*%\s*(elastane|spandex|lycra)/);
  if (ela) {
    const pct = parseInt(ela[1]!, 10);
    if (pct >= 8) return "high";
    if (pct >= 2) return "mid";
  }
  if (/elastane|four-?way|\bstretch\b/.test(t)) return "mid";
  return "low"; // rigid naturals (100% cotton/wool/linen/silk) with no stretch mention
}

/** Age-related body composition shift.
 *  After 30, fat redistributes toward the waist (~0.7cm per decade, capped at +2.8cm at 70).
 *  All other measurements stay stable. Age outside 18-80 is clamped; 0 = not provided. */
function applyAgeCorrection(
  body: { bust: number; waist: number; hip: number },
  age: number,
): { bust: number; waist: number; hip: number } {
  if (!age || age <= 30) return body;
  const decades = Math.min(4, (Math.min(70, age) - 30) / 10);
  const waistAdj = Math.round(decades * 0.7 * 10) / 10; // 0 at 30, +0.7 at 40, +1.4 at 50, +2.1 at 60, +2.8 at 70
  return { ...body, waist: Math.round((body.waist + waistAdj) * 10) / 10 };
}

/** BoldMatrix-style confidence breakdown — surfaces exactly which signals are driving
 *  the score and what would improve it. Mirrors the progressive-disclosure UI. */
export type ConfidenceBreakdown = {
  score: number;          // 0–100 (capped at 93 — "perfect" needs real return data)
  signals: string[];      // e.g. "Height & weight · 60%", "Age calibration · +8%"
  upgradeMessage: string; // one sentence on how to reach higher confidence
};

export function confidenceBreakdown(input: {
  heightCm: number;
  weightKg: number;
  age?: number;
  usualBrandSize?: string;
  bust?: number;
  waist?: number;
  hip?: number;
}): ConfidenceBreakdown {
  const signals: string[] = [];
  let score = 60;
  signals.push(`Height & weight · ${score}%`);

  if (input.age && input.age > 0) {
    score += 8;
    signals.push("Age calibration · +8%");
  }
  if (input.usualBrandSize && input.usualBrandSize !== "none") {
    score += 10;
    signals.push("Usual brand size · +10%");
  }
  if (input.bust || input.waist || input.hip) {
    score += 15;
    signals.push("Your measurements · +15%");
  }
  score = Math.min(93, score);

  const upgradeMessage =
    score >= 93 ? "All signals provided — sizing is as accurate as it can be." :
    score >= 78 ? "Add your measurements (bust/waist/hip) to reach ~93% confidence." :
    score >= 68 ? "Add a usual brand size (+10%) or measurements (+15%) to sharpen this further." :
    "Add your age (+8%), a usual brand size (+10%), and measurements (+15%) to reach ~93%.";

  return { score, signals, upgradeMessage };
}

export function recommendSizeForProduct(
  product: Product,
  input: {
    heightCm: number;
    weightKg: number;
    bust?: number;
    waist?: number;
    hip?: number;
    fitPref?: FitPref;
    /** Age in years (optional). Improves body-composition accuracy after 30. */
    age?: number;
    /** The size the shopper usually wears in a similar brand (e.g. "M").
     *  Strongest pre-measurement predictor — biases the recommendation when
     *  it agrees with or is within one step of the chart-math result. */
    usualBrandSize?: string;
  },
): SizeRec {
  const chart = product.sizeChart;
  const fitPref = input.fitPref ?? "true";

  // Available sizes = intersection of declared sizes and chart rows.
  const sizes = product.sizes.filter((s) => !chart || chart.rows[s]);

  const rawEst = estimateBody(input.heightCm, input.weightKg);
  const est = input.age ? applyAgeCorrection(rawEst, input.age) : rawEst;
  const body = {
    bust: input.bust ?? est.bust,
    waist: input.waist ?? est.waist,
    hip: input.hip ?? est.hip,
  };

  // Fallback when a product has no size chart yet — body-driven, NEVER "middle size".
  // Maps the shopper's body to an industry-default S–XXL anchor table, picks the
  // closest. The moment a real chart is extracted for this product, the exact
  // math above takes over and this branch is never hit.
  if (!chart) {
    const sizeList = product.sizes.length ? product.sizes : ["XS", "S", "M", "L", "XL"];

    // Primary circumference: bottoms are waist-sized, everything else (tops,
    // dresses, outerwear, abayas, gowns, knitwear) is bust-sized.
    const cat = (product.category ?? "").toLowerCase();
    const nm = (product.name ?? "").toLowerCase();
    const isBottom = /trouser|jean|skirt|short|pant|legging|gharara|sharara|palazzo/.test(cat + " " + nm);
    const primary: "waist" | "bust" = isBottom ? "waist" : "bust";
    const bodyValue = primary === "waist" ? body.waist : body.bust;

    // Industry-average womenswear anchors (cm). Calibrated against the
    // 14–42 BMI band that estimateBody produces, so 172/35 lands on XS
    // and 175/85 lands on L — not L for everyone.
    const bustAnchors: Record<string, number> = { XS: 80, S: 84, M: 88, L: 94, XL: 100, XXL: 106 };
    const waistAnchors: Record<string, number> = { XS: 62, S: 66, M: 70, L: 76, XL: 82, XXL: 88 };
    const anchors = primary === "waist" ? waistAnchors : bustAnchors;

    // Only consider sizes the product offers AND we have an anchor for.
    const usable = sizeList.filter((s) => s.toUpperCase() in anchors);

    // One-Size / Free-Size / non-standard labels (One Size, OS, Free): single choice.
    if (usable.length === 0) {
      const size = sizeList[0] ?? "M";
      return {
        size, confidence: 60,
        reasoning: `${product.name} comes in ${size} only — fits a broad range of frames.`,
        primaryLabel: primary === "waist" ? "Waist" : "Bust",
        bodyValue: Math.round(bodyValue), garmentValue: 0,
      };
    }

    // Pick the size whose anchor is closest to the shopper's body measurement.
    // Honors fit preference (snug pulls down, relaxed pulls up).
    const prefShift = fitPref === "snug" ? -3 : fitPref === "relaxed" ? +5 : 0;
    const target = bodyValue + prefShift;
    let best = usable[0]!;
    let bestDist = Infinity;
    for (const s of usable) {
      const anchor = anchors[s.toUpperCase()]!;
      const dist = Math.abs(anchor - target);
      if (dist < bestDist) { bestDist = dist; best = s; }
    }

    // Brand-anchor pull (same logic as the chart path).
    const anchor = input.usualBrandSize && input.usualBrandSize !== "none" ? input.usualBrandSize : null;
    if (anchor && usable.includes(anchor)) {
      const aIdx = usable.indexOf(anchor);
      const bIdx = usable.indexOf(best);
      if (Math.abs(aIdx - bIdx) <= 1) best = anchor;
    }

    // Confidence: honest about being an estimate. Tops out at 78 (chart path can hit 97).
    const inputBonus = (input.bust || input.waist || input.hip) ? 10 : 0;
    const ageBonus = input.age && input.age > 0 ? 5 : 0;
    const brandBonus = anchor && usable.includes(anchor) ? 6 : 0;
    const confidence = Math.max(45, Math.min(78, Math.round(72 - bestDist * 2.2 + inputBonus + ageBonus + brandBonus)));

    const primaryLabel = primary === "waist" ? "Waist" : "Bust";
    const garmentValue = anchors[best.toUpperCase()]!;
    return {
      size: best, confidence,
      reasoning:
        `Your ${primary} runs around ${Math.round(bodyValue)}cm; the ${best} is cut for that frame. ` +
        `Sizing is estimated from category averages — the exact chart for this piece isn't on file yet.`,
      primaryLabel, bodyValue: Math.round(bodyValue), garmentValue,
    };
  }

  const primary = chart.primary;
  const measureIdx = chart.measures.findIndex((m) => m.toLowerCase() === primary);
  const idx = measureIdx >= 0 ? measureIdx : 0;
  const bodyValue = (body as Record<string, number>)[primary] ?? body.bust;

  // Stretch governs bottoms. When the size is decided by the WAIST (trousers,
  // jeans, skirts), a rigid fabric must be sized true-or-up (it won't give), and
  // a high-stretch fabric can sit snugger (it will). We nudge the target larger
  // for rigid waists and smaller for stretchy ones.
  const stretch = fabricStretchLevel(product);
  const isWaistSized = primary === "waist";
  const stretchAdj = !isWaistSized ? 0
    : stretch === "none" ? 2.5   // rigid → never under-size; lean to true/up
    : stretch === "low"  ? 1.2
    : stretch === "high" ? -2.0  // real give → can size down
    : 0;                          // mid → neutral

  // Target garment measurement = body + the cut's ease, adjusted by preference + stretch.
  const prefEase = fitPref === "snug" ? -3 : fitPref === "relaxed" ? +5 : 0;
  const target = bodyValue + chart.ease + prefEase + stretchAdj;

  // Pick the size whose cut measurement is closest to the target.
  let best = sizes[0];
  let bestDist = Infinity;
  for (const s of sizes) {
    const g = chart.rows[s][idx];
    const dist = Math.abs(g - target);
    if (dist < bestDist) { bestDist = dist; best = s; }
  }

  // Brand-anchor pull: the shopper's usual brand size is the strongest pre-measurement
  // predictor (Bold Metrics research). When it is within 1 step of the chart-math pick,
  // the anchor wins — different brands cut differently by 1 step routinely. When it is
  // 2+ steps away, the chart math takes precedence (the cut is genuinely different).
  const anchor = input.usualBrandSize && input.usualBrandSize !== "none" ? input.usualBrandSize : null;
  if (anchor && sizes.includes(anchor)) {
    const anchorIdx = sizes.indexOf(anchor);
    const bestIdx  = sizes.indexOf(best);
    if (Math.abs(anchorIdx - bestIdx) <= 1) {
      best = anchor; // anchor is within tolerance — use it as the recommendation
    }
  }

  const garmentValue = chart.rows[best][idx];
  // Confidence: closer match + more inputs = higher. ~6cm off ≈ tipping point.
  const inputBonus = (input.bust || input.waist || input.hip) ? 14 : 0;
  const ageBonus = input.age && input.age > 0 ? 8 : 0;
  const brandSizeBonus = anchor && sizes.includes(anchor)
    ? (anchor === best ? 10 : 5) // full bonus when it matches, partial when it's close
    : 0;
  const confidence = Math.max(48, Math.min(97, Math.round(92 - bestDist * 3.2 + inputBonus + ageBonus + brandSizeBonus)));

  // Alt nudge: if the shopper sits between two sizes (within 3cm of the next).
  const order = sizes;
  const bi = order.indexOf(best);
  let alt: SizeRec["alt"];
  const up = order[bi + 1];
  const down = order[bi - 1];
  // On rigid waist-sized bottoms, NEVER offer "size down", the fabric has no
  // give, so a smaller waist physically won't close. Only "size up" is honest.
  const allowDown = !(isWaistSized && (stretch === "none" || stretch === "low"));
  if (up && Math.abs(chart.rows[up][idx] - target) - bestDist < 2.5) {
    alt = { size: up, note: `size up to ${up} for more room` };
  } else if (allowDown && down && Math.abs(chart.rows[down][idx] - target) - bestDist < 2.5) {
    alt = { size: down, note: `size down to ${down} for a closer fit` };
  }

  const label = chart.measures[idx];
  const stretchNote = !isWaistSized ? "" :
    stretch === "none" ? " This fabric has no give, so it's sized to sit at your true waist, a smaller size won't close." :
    stretch === "high" ? " It has real stretch, so this sits snug and gives as you move." :
    "";
  const ageNote = input.age && input.age > 30 && isWaistSized
    ? ` Age calibration applied — waist estimate adjusted for your body composition.` : "";
  const anchorNote = anchor && anchor === best
    ? ` Matches your usual ${anchor} in similar brands.`
    : anchor && anchor !== best && sizes.includes(anchor)
    ? ` (Your usual ${anchor} is close; this cut runs slightly different.)`
    : "";
  const reasoning =
    `Your ${label.toLowerCase()} runs around ${bodyValue}cm; the ${best} in this piece is cut for that` +
    (chart.ease < 0 ? " with a body-skimming finish." :
     chart.ease >= 10 ? " with the relaxed ease this cut is designed for." : ".") +
    stretchNote + ageNote + anchorNote;

  return {
    size: best, confidence, reasoning,
    primaryLabel: label, bodyValue, garmentValue, alt,
  };
}

// ── Per-region fit breakdown ──────────────────────────────────────────────────
// Compares the shopper's estimated body against a SPECIFIC size's cut, region by
// region, so the result screen can show WHY a size fits, and how a different
// size would feel. Drives the elaborate size result + the size-reflective render.
// `tightness` is a normalized −1..+1 (negative = tight, positive = loose) used to
// visually scale the garment on the avatar.

export type FitRegion = {
  label: string;        // "Bust" | "Waist" | "Hip" | "Inseam"
  bodyCm: number;       // shopper's estimated measurement
  garmentCm: number;    // this size's cut measurement
  easeCm: number;       // garmentCm − bodyCm (signed)
  tag: "tight" | "true" | "relaxed" | "loose";
  tightness: number;    // −1 (very tight) … 0 (true) … +1 (very loose)
};

export type SizeFit = {
  size: string;
  regions: FitRegion[];
  overallEaseCm: number;   // mean ease across regions (signed)
  overallTightness: number;// −1..+1, mean, drives the avatar garment scale
  headline: string;        // one human line summarising the feel
};

function tagFor(ease: number, primary: boolean): FitRegion["tag"] {
  // Tighter thresholds on the primary (size-driving) region.
  const t = primary ? 1 : 1.5;
  if (ease <= -4 * t) return "tight";
  if (ease < 4 * t) return "true";
  if (ease < 10 * t) return "relaxed";
  return "loose";
}

/** Build a region-by-region fit map for a GIVEN size of a product. */
export function fitBreakdown(
  product: Product,
  size: string,
  heightCm: number,
  weightKg: number,
  measured?: { bust?: number; waist?: number; hip?: number },
): SizeFit {
  const chart = product.sizeChart;
  const est = estimateBody(heightCm, weightKg);
  // A curated muse supplies real circumferences; a photo upload supplies none,
  // so we fall back to the height+weight estimate. Either way the per-region
  // map reflects the body the garment is actually being shown on.
  const body = {
    bust: measured?.bust ?? est.bust,
    waist: measured?.waist ?? est.waist,
    hip: measured?.hip ?? est.hip,
  };
  const bodyByKey: Record<string, number> = {
    bust: body.bust, waist: body.waist, hip: body.hip, inseam: 80,
  };

  if (!chart || !chart.rows[size]) {
    // GRACEFUL FALLBACK (no measured size chart yet). The bars must NEVER be dead, 
    // a shopper still needs to SEE that a smaller size reads tighter and a larger
    // size reads roomier. We model an honest size-RELATIVE scale: the middle size
    // sits true (a touch of ease), and every step down/up shifts the ease by ~4cm.
    // The moment real measurements are synced into the catalog, the exact chart
    // above takes over and these estimates are never used.
    const sizes = product.sizes.length ? product.sizes : ["XS", "S", "M", "L", "XL"];
    const idx = sizes.indexOf(size);
    const mid = (sizes.length - 1) / 2;
    const step = idx < 0 ? 0 : idx - mid;          // − = smaller cut, + = larger cut
    const regionDefs: Array<["Bust" | "Waist" | "Hip", number]> = [
      ["Bust", body.bust], ["Waist", body.waist], ["Hip", body.hip],
    ];
    const regions: FitRegion[] = regionDefs.map(([label, bodyCm], i) => {
      const easeCm = Math.round((2 + step * 4) * 10) / 10;   // mid size ≈ +2cm (true)
      const tag = tagFor(easeCm, i === 0);
      const tightness = Math.max(-1, Math.min(1, easeCm / 12));
      return { label, bodyCm, garmentCm: Math.round((bodyCm + easeCm) * 10) / 10, easeCm, tag, tightness };
    });
    const overallEaseCm = Math.round((2 + step * 4) * 10) / 10;
    const overallTightness = Math.max(-1, Math.min(1, overallEaseCm / 12));
    const headline =
      step <= -2 ? "Runs tight at this size, expect a close, fitted feel."
      : step === -1 ? "A little snug at this size, close to the body."
      : step === 0 ? "Sits true to size, clean and body-skimming."
      : step === 1 ? "Relaxed at this size, with easy room through the body."
      : "Oversized at this size, loose and roomy with extra drape.";
    return { size, regions, overallEaseCm, overallTightness, headline };
  }

  const regions: FitRegion[] = chart.measures.map((label, i) => {
    const key = label.toLowerCase();
    const isPrimary = key === chart.primary;
    const bodyCm = bodyByKey[key] ?? body.bust;
    const garmentCm = chart.rows[size][i];
    const easeCm = Math.round((garmentCm - bodyCm) * 10) / 10;
    // Inseam is a length, not a circumference, never "tight/loose", just shown.
    const tag = key === "inseam" ? "true" : tagFor(easeCm, isPrimary);
    const tightness = key === "inseam"
      ? 0
      : Math.max(-1, Math.min(1, easeCm / 12));
    return { label, bodyCm, garmentCm, easeCm, tag, tightness };
  });

  const circ = regions.filter((r) => r.label.toLowerCase() !== "inseam");
  const overallEaseCm = circ.length
    ? Math.round((circ.reduce((s, r) => s + r.easeCm, 0) / circ.length) * 10) / 10
    : 0;
  const overallTightness = circ.length
    ? circ.reduce((s, r) => s + r.tightness, 0) / circ.length
    : 0;

  const headline =
    overallTightness <= -0.35 ? "Sits close to the body, a defined silhouette."
    : overallTightness < 0.18 ? "True to your measurements, balanced drape."
    : overallTightness < 0.55 ? "An easy, relaxed fit with room to move."
    : "Generous and oversized, drapes well away from the body.";

  return { size, regions, overallEaseCm, overallTightness, headline };
}

// ── Render-driving ease ───────────────────────────────────────────────────────
// The signed ease (cm) that should DRIVE the visual try-on render, the BINDING
// region, not the average. A garment tight at the waist but roomy at the hip
// still reads TIGHT (the waist pulls and won't sit), so tightness wins; otherwise
// the roomiest region drives the oversized drape. Averaging hides a tight fit and
// makes size-down look "true", this never does. (Founder: "when they reduce size
// it turns into a tighter article and let them see that it is tighter … don't tuck
// it in … otherwise the whole concept of size up and down finishes.")
export function renderEaseOf(fit: SizeFit): { easeCm: number; tightness: number; bindLabel: string | null } {
  const circ = fit.regions.filter((r) => r.label.toLowerCase() !== "inseam");
  if (!circ.length) {
    return { easeCm: fit.overallEaseCm, tightness: fit.overallTightness, bindLabel: null };
  }
  const tightest = circ.reduce((a, b) => (b.easeCm < a.easeCm ? b : a));
  const loosest = circ.reduce((a, b) => (b.easeCm > a.easeCm ? b : a));
  // Tightness wins ties: if any region genuinely binds (≤ −3cm), show the pull.
  const bind =
    tightest.easeCm <= -3 ? tightest
    : loosest.easeCm >= 4 ? loosest
    : null;
  if (!bind) {
    return { easeCm: Math.round(fit.overallEaseCm), tightness: fit.overallTightness, bindLabel: null };
  }
  const easeCm = Math.round(bind.easeCm);
  return {
    easeCm,
    tightness: Math.max(-1, Math.min(1, easeCm / 12)),
    bindLabel: bind.label,
  };
}

export function getProduct(handle: string) {
  return products.find((p) => p.handle === handle);
}
export function byCollection(slug: CollectionSlug) {
  return products.filter((p) => p.collection === slug);
}

// ── Shared color → hex map ───────────────────────────────────────────────────
// Single source of truth for every swatch + tint in the store. Used by the PDP
// color picker (tint preview), the gallery, and the complete-the-look grid.
export function colorHex(name: string): string {
  const n = name.toLowerCase();
  if (/onyx|black|ink|midnight/.test(n)) return "#0E0B14";
  if (/ivory|bone|oat/.test(n))          return "#EBE5D8";
  if (/camel/.test(n))                   return "#B08A5C";
  if (/stone/.test(n))                   return "#9A958A";
  if (/charcoal/.test(n))                return "#3A3A40";
  if (/champagne/.test(n))               return "#D4BE94";
  if (/cognac/.test(n))                  return "#7C4A2C";
  if (/indigo/.test(n))                  return "#1F2D52";
  if (/espresso/.test(n))                return "#3A2418";
  if (/cardinal/.test(n))                return "#8B1E2C";
  return "#888";
}

/** Warm/cool undertone of a named color.
 *  Returns  1 = warm undertone (camel, champagne, cognac, espresso, cream, etc.)
 *           -1 = cool undertone (stone, charcoal, ink, slate, ash)
 *            0 = truly neutral / pure (onyx, black, bone, oat, white, grey/gray)
 */
function warmth(name: string): -1 | 0 | 1 {
  const n = name.toLowerCase();
  if (/camel|champagne|cognac|espresso|ivory|cream|sand|tan|nude|blush|rust|terracotta|copper/.test(n)) return 1;
  if (/stone|charcoal|ink|slate|ash/.test(n)) return -1;
  // onyx, black, bone, oat, white, grey, gray, pure neutral
  return 0;
}

/** Warmth-adjustment for a pair of color names.
 *  Only applies when BOTH colors are neutrals (low-saturation / extreme lightness).
 *  A warm+cool clash between two neutrals should score LOWER than a tonal warm+warm pairing.
 */
function warmthScore(nameA: string, nameB: string): number {
  const hslA = hexToHsl(colorHex(nameA));
  const hslB = hexToHsl(colorHex(nameB));
  if (!isNeutral(hslA) || !isNeutral(hslB)) return 0; // only affects neutral pairings
  const wA = warmth(nameA);
  const wB = warmth(nameB);
  if (wA === 1 && wB === 1) return 0.04;  // warm + warm tonal bonus
  if (wA === -1 && wB === -1) return 0.02; // cool + cool tonal bonus (slightly less cohesive)
  if ((wA === 1 && wB === -1) || (wA === -1 && wB === 1)) return -0.06; // warm/cool clash penalty
  // one pure + one warm/cool → slight bonus (clean pairing)
  if (wA === 0 || wB === 0) return 0.02;
  return 0;
}

// ── Per-colorway product imagery ─────────────────────────────────────────────
// Each product is photographed in its first (index 0) color. Alternate colors
// are real AI-recolored renders of the SAME shot, same model, pose, lighting,
// background; only the garment color changes (no blend-mode tint). Files live at
// /products/<handle>-<colorslug>.png. This set is the source of truth so the
// gallery never points at a render that doesn't exist.
const COLORWAY_IMAGES = new Set<string>([
  "onyx-silk-slip-ivory",
  "ivory-silk-camisole-onyx",
  "atelier-wide-leg-trouser-camel",
  "atelier-wide-leg-trouser-ink",
  "linen-relaxed-shirt-stone",
  "linen-relaxed-shirt-black",
  "wrap-coat-camel-charcoal",
  "cashmere-v-neck-black",
  "cashmere-v-neck-cardinal",
  "tailored-blazer-double-ink",
  "pleated-midi-skirt-black",
  "merino-ribbed-turtleneck-black",
  "merino-ribbed-turtleneck-espresso",
  "leather-trench-black",
  "wide-leg-denim-black",
]);

export function colorSlug(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, "-");
}

/**
 * The image stack to show for a given product + selected color.
 * - index 0 (photographed color) → the two base frames.
 * - an alternate color with a real recolor render → that single recolored frame.
 * - anything without a render → falls back to the base frames (never 404s).
 */
export function colorwayImages(
  product: Product,
  colorIndex: number,
  colorName?: string,
): string[] {
  if (colorIndex <= 0) return product.images;
  const name = colorName ?? product.colors[colorIndex];
  if (!name) return product.images;
  const key = `${product.handle}-${colorSlug(name)}`;
  if (COLORWAY_IMAGES.has(key)) return [resolveAsset(`/products/${key}.png`)];
  return product.images;
}

// ── Intelligent outfit-styling engine ────────────────────────────────────────
// One algorithm, four signals, shared by the Try-On "complete the look" grid
// AND by Mira's recommendations. NOT random: it scores every candidate piece on
// (1) real color harmony (HSL), (2) what category actually completes the look,
// (3) matching formality / dress-code, (4) matching season. The blend is tuned
// so the top picks genuinely *go together* and *suit the occasion*, not just
// share a color family.

//, 1. Color harmony (HSL-based), , , , , , , , , , , , , , , , , , , , , , , 

type Hsl = { h: number; s: number; l: number };

function hexToHsl(hex: string): Hsl {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s, l };
}

/** A color reads as "neutral" (goes with everything) when it's barely saturated,
 *  or very dark/very light, i.e. the blacks, ivories, stones, charcoals. */
function isNeutral(c: Hsl): boolean {
  return c.s < 0.18 || c.l < 0.12 || c.l > 0.86;
}

export type HarmonyType =
  | "monochromatic"
  | "analogous"
  | "complementary"
  | "triadic"
  | "neutral"
  | "accent"
  | "contrast";

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Score a single pair of resolved colors + name the harmony relationship.
 *
 * Real colour theory, tuned for CONVERSION, the combinations a stylist reaches
 * for because they sell, not just because they're "fine". The old version scored
 * EVERY neutral pairing a flat 0.9, so in a neutral-heavy catalogue colour theory
 * never differentiated anything. Now the scale separates the boring-but-safe from
 * the genuinely impulse-triggering:
 *   • two neutrals        → safe, sophisticated, but the LEAST exciting (0.78, 0.84)
 *   • neutral + a colour  → the "pop of colour on a neutral base": the single most
 *                           stylist-approved, highest-converting combo (0.90, 0.98),
 *                           scaled by how vividly the accent pops
 *   • complementary       → high-impact, eye-catching → drives impulse (0.93)
 *   • monochromatic       → tonal, refined (0.95)
 *   • analogous           → harmonious, easy to wear (0.90)
 *   • triadic / contrast   → considered / clashing (0.72 / 0.48)
 */
function pairColorHarmony(a: Hsl, b: Hsl): { score: number; type: HarmonyType } {
  const aN = isNeutral(a);
  const bN = isNeutral(b);
  // BOTH neutral, the connective tissue of a wardrobe: safe and refined, but the
  // least impulse-driving. Tonal neutrals (close in lightness) read more intentional
  // than a hard light/dark split, so reward the tonal pairing slightly more.
  if (aN && bN) {
    const lGap = Math.abs(a.l - b.l);
    return { score: lGap < 0.45 ? 0.84 : 0.79, type: "neutral" };
  }
  // ONE neutral + ONE saturated colour, the classic "pop of colour on a neutral
  // base". The highest-converting, most impulse-triggering pairing there is; the
  // more vivid the accent, the harder it pops, so scale 0.90 → 0.98 by saturation.
  if (aN || bN) {
    const accent = aN ? b : a;
    const pop = Math.max(0, Math.min(1, (accent.s - 0.18) / 0.62));
    return { score: 0.9 + 0.08 * pop, type: "accent" };
  }
  // TWO saturated colours, classic colour-wheel relationships, scored by IMPACT.
  const gap = hueGap(a.h, b.h);
  if (gap <= 18) return { score: 0.95, type: "monochromatic" };
  if (gap <= 50) return { score: 0.9, type: "analogous" };
  if (gap >= 150 && gap <= 210) return { score: 0.93, type: "complementary" };
  if (gap >= 100 && gap < 150) return { score: 0.72, type: "triadic" };
  return { score: 0.48, type: "contrast" };
}

/** Best color relationship between two products across their colorways, the
 *  shopper can always pick the matching colorway, so the best pairing wins. */
export function analyzeColorHarmony(
  colorsA: string[],
  colorsB: string[],
): { score: number; type: HarmonyType } {
  // No colour data on one side (the norm on a real storefront — single-colour
  // products carry no "Color" option) → return a neutral baseline, NOT 0. A 0
  // here collapsed the whole "% match" badge to nothing (the recurring card bug);
  // a neutral floor keeps the blended look-score meaningful without faking a clash.
  if (colorsA.length === 0 || colorsB.length === 0) return { score: 0.6, type: "neutral" };
  let best = { score: 0, type: "contrast" as HarmonyType };
  for (const a of colorsA) {
    for (const b of colorsB) {
      const r = pairColorHarmony(hexToHsl(colorHex(a)), hexToHsl(colorHex(b)));
      r.score = Math.min(1, Math.max(0, r.score + warmthScore(a, b)));
      if (r.score > best.score) best = r;
    }
  }
  return best;
}

//, 2/3/4. What-suits-what: category complement, formality, season, , , , , , 

type BodyZone = "upper" | "lower" | "full" | "layer" | "accent";

function bodyZone(cat: Product["category"]): BodyZone {
  switch (cat) {
    case "top":
    case "knitwear":   return "upper";
    case "bottom":     return "lower";
    case "dress":      return "full";
    case "outerwear":  return "layer";
    case "accessory":  return "accent";
    case "unknown":    return "accent";
  }
}

/** How naturally two garments combine into one worn outfit (0, 1). */
function categoryAffinity(a: Product, b: Product): number {
  const za = bodyZone(a.category);
  const zb = bodyZone(b.category);
  const pair = new Set([za, zb]);
  const has = (x: BodyZone, y: BodyZone) => pair.has(x) && pair.has(y);

  if (has("upper", "lower")) return 1.0;          // top + bottom = the core outfit
  if (has("full", "layer")) return 0.96;          // dress + coat/blazer
  if (has("full", "accent")) return 0.84;         // dress + accessory
  if (has("lower", "layer")) return 0.9;          // trouser + coat
  if (has("upper", "layer")) return 0.88;         // knit/top + coat
  if (has("lower", "accent")) return 0.7;
  if (has("upper", "accent")) return 0.7;
  if (has("full", "upper") || has("full", "lower")) return 0.25; // dress doesn't need either
  if (za === "layer" && zb === "layer") return 0.3;  // two coats compete
  if (za === "upper" && zb === "upper") return 0.4;  // two tops, layerable but rarely
  if (za === "lower" && zb === "lower") return 0.15; // two bottoms, never
  if (za === "full" && zb === "full") return 0.12;   // two dresses, never
  return 0.5;
}

/** Dress-code reading per piece (0 casual → 1 black-tie), from fabric + collection. */
function formalityOf(p: Product): number {
  const f = p.fabricComposition.toLowerCase();
  if (p.collection === "evening") return 0.92;
  if (/linen/.test(f)) return 0.32;
  if (/denim|selvedge/.test(f)) return 0.28;
  if (/leather/.test(f)) return 0.62;
  if (p.collection === "tailoring") return 0.72;
  if (/satin|charmeuse|silk/.test(f)) return 0.7;
  if (p.collection === "knitwear") return 0.5;
  if (p.collection === "outerwear") return 0.6;
  return 0.5;
}

/** Seasonal warmth per piece (0 high-summer → 1 deep-winter), from fabric. */
function seasonOf(p: Product): number {
  const f = p.fabricComposition.toLowerCase();
  if (/linen/.test(f)) return 0.12;
  if (/cashmere|merino|virgin wool|wool/.test(f)) return 0.85;
  if (/leather/.test(f)) return 0.7;
  if (/denim|cotton/.test(f)) return 0.45;
  if (/satin|charmeuse|silk|crepe/.test(f)) return 0.42;
  return 0.5;
}

//, 5. Silhouette / proportion, , , , , , , , , , , , , , , , , , , , , , , , 
// The oldest rule in styling: balance volume with closeness. A wide-leg trouser
// wants a fitted top; an oversized coat wants a slim base. Infer each piece's
// silhouette from its fit notes + name + description: −1 = close/fitted,
// +1 = voluminous/relaxed, 0 = regular.
const VOLUMINOUS = /\b(relaxed|oversize|oversized|wide|wide-leg|wide leg|boxy|loose|fluid|draped|drape|voluminous|slouch|slouchy|billow|a-line|flowy|flowing|generous|baggy|full)\b/;
const FITTED = /\b(fitted|slim|tailored|bias|bias-cut|skinny|cropped|close|body-?con|sleek|narrow|tapered|structured|sharp)\b/;
function silhouetteOf(p: Product): number {
  const t = `${p.fitNotes} ${p.name} ${p.description}`.toLowerCase();
  let v = 0;
  if (VOLUMINOUS.test(t)) v += 1;
  if (FITTED.test(t)) v -= 1;
  // accessories are silhouette-neutral
  if (p.category === "accessory") return 0;
  return Math.max(-1, Math.min(1, v));
}

/** How well two pieces balance in proportion (0, 1). Volume + fit = textbook;
 *  two voluminous (or two very fitted) pieces fight each other. */
function proportionScore(a: Product, b: Product): number {
  const sa = silhouetteOf(a);
  const sb = silhouetteOf(b);
  const prod = sa * sb;
  if (prod < -0.15) return 1.0;                                   // fitted + relaxed = textbook balance (the ideal)
  if (Math.abs(sa) < 0.2 && Math.abs(sb) < 0.2) return 0.74;      // both regular = safe but flat, no movement
  if (Math.abs(sa) < 0.2 || Math.abs(sb) < 0.2) return 0.85;      // one regular anchoring a shaped piece = good
  if (prod > 0.25) return 0.4;                                    // both voluminous / both tight = clash
  return 0.7;
}

//, 6. Desirability (real signal, never invented), , , , , , , , , , , , , , , 
// keepRate = % of shoppers who kept their recommended size = a real proxy for
// "this piece delivers / people want it". Used as a gentle tie-breaker so the
// top pick is also something shoppers actually love, not just a color match.
function desirabilityOf(p: Product): number {
  return typeof p.keepRate === "number" ? Math.max(0, Math.min(1, p.keepRate)) : 0.7;
}

//, 6b. Impulse-add likelihood (the conversion math), , , , , , , , , , , , , 
// A recommendation only converts on impulse if adding it feels frictionless. A
// complementary piece priced at or below the anchor is an easy "yes, add it"; a
// piece far pricier is a separate, deliberated purchase, not an impulse add. This
// is the price-elasticity half of "most likely to be bought TOGETHER", paired with
// keepRate (do people love it) and colour impact (does the combo catch the eye).
function impulseAddScore(anchor: Product, cand: Product): number {
  const ratio = cand.priceUsd / Math.max(1, anchor.priceUsd);
  if (ratio <= 1) return 1.0;     // same or cheaper, frictionless add-on
  if (ratio <= 1.4) return 0.85;  // a little more, still an easy yes
  if (ratio <= 2) return 0.6;     // noticeably pricier, some hesitation
  return 0.42;                    // a major second purchase, rarely impulse
}

//, 7. Palette coherence across a whole worn set, , , , , , , , , , , , , , , 
// A great outfit reads as a neutral base + AT MOST one hero colour. Count the
// saturated (non-neutral) pieces the set would have with `cand` added: 0, 1
// accents is clean, 2 is okay only if they harmonise, 3+ is busy.
function paletteCoherence(worn: Product[], cand: Product): number {
  const all = [...worn, cand];
  const accents = all.filter((p) => {
    const c = hexToHsl(colorHex(p.colors[0] ?? "#808080"));
    return !isNeutral(c);
  });
  if (accents.length <= 1) return 1.0;
  if (accents.length === 2) {
    const h = analyzeColorHarmony(accents[0].colors, accents[1].colors);
    return h.type === "monochromatic" || h.type === "analogous" || h.type === "complementary" ? 0.78 : 0.42;
  }
  return 0.3; // three+ competing colours, busy
}

export type LookEntry = {
  product: Product;
  score: number;        // 0, 1 overall
  harmonyType: HarmonyType;
  reason: string;       // one honest human sentence (no invented facts)
};

const HARMONY_PHRASE: Record<HarmonyType, string> = {
  monochromatic: "tonal with",
  analogous:     "sits in the same palette as",
  complementary: "plays off",
  triadic:       "adds a considered contrast to",
  neutral:       "is a clean neutral against",
  accent:        "brings a pop of colour to",
  contrast:      "is a bold contrast to",
};

function zoneVerb(a: Product, b: Product): string {
  const af = categoryAffinity(a, b);
  const za = bodyZone(a.category);
  const zb = bodyZone(b.category);
  if (af >= 0.95) return "completes the outfit";
  if (zb === "layer" || za === "layer") return "layers over it cleanly";
  if (zb === "accent") return "finishes the look";
  if (af >= 0.8) return "pairs naturally";
  return "works alongside it";
}

function lookReason(anchor: Product, cand: Product, h: HarmonyType): string {
  return `The ${cand.name.toLowerCase()} ${HARMONY_PHRASE[h]} the ${anchor.name.toLowerCase()} and ${zoneVerb(anchor, cand)}.`;
}

/**
 * The shared styling brain. Scores every other piece in the catalog against
 * `current` on color harmony + category complement + formality + season, and
 * returns them ranked with a human reason. Used by Mira AND the Try-On grid.
 */
export function buildLook(
  current: Product,
  all: Product[] = products,
  limit = 8,
): LookEntry[] {
  const others = all.filter((p) => p.handle !== current.handle);
  const fCur = formalityOf(current);
  const sCur = seasonOf(current);

  return others
    .map((p) => {
      const color = analyzeColorHarmony(current.colors, p.colors);
      const cat = categoryAffinity(current, p);
      const formality = 1 - Math.abs(fCur - formalityOf(p));        // close dress-code = good
      const season = 1 - Math.abs(sCur - seasonOf(p)) * 0.8;        // tolerate some spread
      const proportion = proportionScore(current, p);              // balance volume with fit
      const desire = desirabilityOf(p);                            // real keepRate signal
      const impulse = impulseAddScore(current, p);                 // easy-add conversion math
      const score =
        0.30 * color.score +
        0.22 * cat +
        0.11 * formality +
        0.08 * season +
        0.11 * proportion +
        0.10 * desire +
        0.08 * impulse;
      return {
        product: p,
        score,
        harmonyType: color.type,
        reason: lookReason(current, p, color.type),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Back-compat wrapper, same signature/return as before (Product[]), now backed
 * by the intelligent `buildLook` engine. Existing callers (Try-On grid, Mira)
 * keep working; richer reasons are available via `buildLook`.
 */
export function buildOutfit(
  current: Product,
  all: Product[] = products,
  limit = 8,
): Product[] {
  return buildLook(current, all, limit).map((e) => e.product);
}

// ── Slot-aware, dynamic complete-the-look ─────────────────────────────────────
// Founder P3a/P3b/P3c: suggestions must be the natural matches that genuinely
// complete the CURRENT selection (no camisole-with-a-gown), one item per worn
// slot (no two jackets), and must re-rank as the shopper adds/removes pieces so
// the recommendations feel smart and alive.

/** The exclusive worn slots. `accent` is the only multi-fill slot. */
const EXCLUSIVE_ZONES: BodyZone[] = ["upper", "lower", "full", "layer"];

/** Zones already occupied by the worn set, expanding `full` to block upper+lower. */
function occupiedZones(worn: Product[]): Set<BodyZone> {
  const set = new Set<BodyZone>();
  for (const p of worn) set.add(bodyZone(p.category));
  return set;
}

/**
 * Can `cand` be ADDED to a set that already occupies `filled`? Encodes how
 * clothes are actually worn: a dress is a complete lower+upper garment, so it
 * never combines with a top, a bottom, or another dress; you wear at most one
 * outer layer, one top, one bottom. Accessories are always welcome.
 */
export function canAddToLook(cand: Product, worn: Product[]): boolean {
  const filled = occupiedZones(worn);
  const z = bodyZone(cand.category);
  if (cand.category === "accessory") return true; // accent, unlimited
  // A dress can't join anything that dresses the torso or legs, and vice-versa.
  if (z === "full") return !(filled.has("full") || filled.has("upper") || filled.has("lower"));
  // Already wearing a dress → only an outer layer may go over it (coat over a
  // slip is elegant); accessories handled above. A top/bottom/2nd dress can't join.
  if (filled.has("full")) return z === "layer" && !filled.has("layer");
  // One item per exclusive slot (no two jackets, no two bottoms, no two tops).
  if (EXCLUSIVE_ZONES.includes(z) && filled.has(z)) return false;
  return true;
}

/**
 * Rank the pieces that genuinely COMPLETE the current worn set. Re-runs every
 * time the set changes (P3c). Only returns slot-valid candidates (P3a/P3b),
 * scored on harmony with the WHOLE set + a bonus for filling a still-open core
 * slot, so adding a top makes trousers/skirts surface, adding a bottom makes
 * tops surface, etc.
 */
export function completeLookFor(
  worn: Product[],
  all: Product[] = products,
  limit = 8,
): LookEntry[] {
  if (!worn.length) return [];
  const anchor = worn[0];
  const wornHandles = new Set(worn.map((p) => p.handle));
  const filled = occupiedZones(worn);

  // Which core slots are still open? Drives the "make it a full outfit" bonus.
  const wearingDress = filled.has("full");
  const needsUpper = !wearingDress && !filled.has("upper");
  const needsLower = !wearingDress && !filled.has("lower");

  const fAnchor = formalityOf(anchor);
  const sAnchor = seasonOf(anchor);

  const ranked = all
    .filter((p) => !wornHandles.has(p.handle) && canAddToLook(p, worn))
    .map((p) => {
      // Harmony is averaged across the whole worn set so a 3rd piece must agree
      // with everything already chosen, not just the focus.
      const colorScores = worn.map((w) => analyzeColorHarmony(w.colors, p.colors));
      const colorAvg = colorScores.reduce((s, c) => s + c.score, 0) / colorScores.length;
      const harmonyType = analyzeColorHarmony(anchor.colors, p.colors).type;
      const catAvg =
        worn.reduce((s, w) => s + categoryAffinity(w, p), 0) / worn.length;
      const formality = 1 - Math.abs(fAnchor - formalityOf(p));
      const season = 1 - Math.abs(sAnchor - seasonOf(p)) * 0.8;
      // Proportion balance against the whole worn set + palette coherence of the
      // resulting outfit + real desirability. These are what make the picks feel
      // styled, not just color-matched.
      const proportionAvg =
        worn.reduce((s, w) => s + proportionScore(w, p), 0) / worn.length;
      const palette = paletteCoherence(worn, p);
      const desire = desirabilityOf(p);
      // Conversion math: how likely is this piece bought TOGETHER with the anchor
      // on impulse, priced as an easy add-on, averaged against the worn set.
      const impulse =
        worn.reduce((s, w) => s + impulseAddScore(w, p), 0) / worn.length;
      const z = bodyZone(p.category);
      // Bonus for completing the outfit's missing core slot, GATED on the piece
      // actually being a good match (panel rank 3). A reduced 0.12 (was 0.25) that
      // only applies when colour + proportion are coherent, so "you need a bottom"
      // can never promote a colour-clashing piece over a piece that actually works.
      const slotFills = (needsLower && z === "lower") || (needsUpper && z === "upper");
      const slotQualityOk = colorAvg > 0.72 && proportionAvg > 0.6;
      const slotBonus =
        slotFills && slotQualityOk ? 0.12
        : z === "layer" ? 0.06
        : z === "accent" ? 0.04
        : 0;
      // Weighted for CONVERSION, not just aesthetics: colour theory (0.26) +
      // palette discipline (0.10) lead, then how the piece is loved (desire 0.10)
      // and how easily it's added on impulse (0.08), so the top picks are the
      // ones most likely to be bought together, not merely colour-matched.
      const score =
        0.26 * colorAvg +
        0.20 * catAvg +
        0.10 * formality +
        0.06 * season +
        0.10 * proportionAvg +
        0.10 * palette +
        0.10 * desire +
        0.08 * impulse +
        slotBonus;
      return { product: p, score, harmonyType, reason: lookReason(anchor, p, harmonyType) };
    })
    .sort((a, b) => b.score - a.score);

  // ── Slot DIVERSITY (founder: "when wearing a shirt, don't show more shirts, 
  // show what completes it; once they add a bottom, show a jacket/accessory").
  // The raw score can rank 3 bottoms first for a single top. Instead, round-robin
  // across body zones so the shopper sees VARIETY (a bottom, a layer, an
  // accessory), prioritizing the still-open core slot first. As pieces are added
  // a filled slot drops out (canAddToLook), so the options auto-shift to what's
  // still needed (top+bottom → layers/accessories surface).
  const byZone = new Map<BodyZone, LookEntry[]>();
  for (const e of ranked) {
    const z = bodyZone(e.product.category);
    (byZone.get(z) ?? (byZone.set(z, []), byZone.get(z)!)).push(e);
  }
  const zoneOrder: BodyZone[] = [];
  if (needsLower) zoneOrder.push("lower");
  if (needsUpper) zoneOrder.push("upper");
  zoneOrder.push("layer", "full", "accent");
  for (const z of byZone.keys()) if (!zoneOrder.includes(z)) zoneOrder.push(z);
  const out: LookEntry[] = [];
  const idx = new Map<BodyZone, number>();
  let advanced = true;
  while (out.length < limit && advanced) {
    advanced = false;
    for (const z of zoneOrder) {
      if (out.length >= limit) break;
      const list = byZone.get(z);
      if (!list) continue;
      const i = idx.get(z) ?? 0;
      if (i < list.length) { out.push(list[i]); idx.set(z, i + 1); advanced = true; }
    }
  }
  return out;
}
