// Normalize a Shopify Admin GraphQL product into our Product/Variant/Image rows.
// Accepts a loosely-typed input so REST and GraphQL payloads can both feed in.

import { extractColor } from "./colors.js";
import { pickProductSizeChart } from "../sizing/index.js";

export type ShopifyProductInput = {
  id: string | number;                          // GID or REST numeric id — normalized below
  handle: string;
  title: string;
  productType?: string | null;
  vendor?: string | null;
  // Shopify body_html — where most brands paste a size-chart table / measurements.
  descriptionHtml?: string | null;
  tags?: string[] | string;                     // GraphQL: string[]; REST: comma-joined string
  status?: "active" | "draft" | "archived";
  options?: Array<{ name: string; values?: string[] }>;
  variants?: Array<{
    id: string | number;
    sku?: string | null;
    title?: string | null;
    price?: string | null;                      // "49.00"
    option1?: string | null; option2?: string | null; option3?: string | null;
    selectedOptions?: Array<{ name: string; value: string }>;
    // Inventory mirror (Request B). GraphQL: inventoryQuantity (Int),
    // availableForSale (Boolean). REST has neither at the variant root, so
    // both are optional and default to unknown when absent.
    inventoryQuantity?: number | null;
    availableForSale?: boolean | null;
  }>;
  images?: Array<{ id?: string | number; src?: string; url?: string; position?: number; altText?: string | null }>;
  // Optional: Shopify metafields for size-chart extraction (D37).
  // Populated by the shopifyClient when it queries metafield identifiers.
  metafields?: Array<{ namespace: string; key: string; value: unknown }>;
};

export type NormalizedProduct = {
  shopifyId: string;
  handle: string;
  title: string;
  productType: string | null;
  vendor: string | null;
  descriptionHtml: string | null;
  tags: string[];
  category: string | null;
  primaryColor: string | null;
  colorFamily: string | null;
  isActive: boolean;
  // D37 — size-chart extracted from product metafields. Null when no
  // recognisable metafield was found; FitAdapter then uses the category
  // default chart.
  sizeChartJson: object | null;
  sizeChartSource: string | null;
  variants: Array<{
    shopifyId: string;
    sku: string | null;
    size: string | null;
    color: string | null;
    priceCents: number | null;
    inventoryQuantity: number | null;
    availableForSale: boolean | null;
  }>;
  images: Array<{
    shopifyId: string | null;
    url: string;
    altText: string | null;
    position: number;
  }>;
};

function gid(kind: "Product" | "ProductVariant" | "ProductImage", id: string | number): string {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/${kind}/${s}`;
}

function parseTags(tags: ShopifyProductInput["tags"]): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => t.trim()).filter(Boolean);
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

function priceToCents(price?: string | null): number | null {
  if (!price) return null;
  const n = Number.parseFloat(price);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

// Heuristic: derive a category from productType, title or tags. Falls back to
// null; CatalogService can override with a more sophisticated classifier later.
// ORDER MATTERS — first match wins, so the more-specific / less-ambiguous
// categories (outerwear, knitwear) come before the broad "shirt/top" bucket so a
// "knit top" reads as knitwear, not a shirt. Every category lists its OWN NAME as
// a keyword so a merchant tag/productType like "Accessory" or "Dress" self-matches
// (this was the bug: an "Accessory"-tagged product matched nothing because the
// accessory list had belt/watch/… but not the word "accessory").
const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ["outerwear", ["outerwear", "jacket", "coat", "blazer", "trench", "parka", "overcoat", "puffer", "anorak"]],
  ["knitwear",  ["knitwear", "knit", "sweater", "jumper", "cardigan", "cashmere", "merino", "pullover", "turtleneck", "v-neck", "vneck", "polo neck", "roll neck"]],
  ["dress",     ["dress", "gown", "frock"]],
  ["skirt",     ["skirt", "midi skirt", "maxi skirt", "mini skirt"]],
  ["trouser",   ["trouser", "trousers", "pant", "pants", "chino", "jean", "jeans", "denim", "slack", "legging", "culotte"]],
  ["shoe",      ["shoe", "shoes", "sneaker", "loafer", "boot", "derby", "chukka", "heel", "sandal", "flat", "mule", "pump"]],
  ["accessory", ["accessory", "accessories", "belt", "watch", "tie", "scarf", "hat", "cap", "bag", "handbag", "tote", "clutch", "pocket square", "jewelry", "jewellery", "necklace", "earring", "bracelet", "ring", "sunglass", "glove", "wallet"]],
  ["shirt",     ["shirt", "tee", "t-shirt", "polo", "top", "blouse", "camisole", "cami", "tank", "bodysuit"]],
];

function inferCategory(input: ShopifyProductInput, tags: string[]): string | null {
  const haystack = [input.productType ?? "", input.title, ...tags].join(" ").toLowerCase();
  for (const [cat, kws] of CATEGORY_KEYWORDS) {
    // Word-ish match: substring is fine for multi-word keywords, but guard the
    // short ones with boundaries so "top" doesn't match "laptop" or "stop".
    if (kws.some((k) => (k.length <= 4 ? new RegExp(`\\b${k}\\b`).test(haystack) : haystack.includes(k)))) {
      return cat;
    }
  }
  return null;
}

function variantSize(v: NonNullable<ShopifyProductInput["variants"]>[number]): string | null {
  if (v.selectedOptions) {
    const sizeOpt = v.selectedOptions.find((o) => /size/i.test(o.name));
    if (sizeOpt?.value) return sizeOpt.value;
  }
  // Fall back to option1 (Shopify convention for the first option).
  return v.option1 ?? null;
}

function variantColor(v: NonNullable<ShopifyProductInput["variants"]>[number]): string | null {
  if (v.selectedOptions) {
    const c = v.selectedOptions.find((o) => /colou?r/i.test(o.name));
    if (c?.value) return c.value;
  }
  return v.option2 ?? null;
}

export function normalizeProduct(input: ShopifyProductInput): NormalizedProduct {
  const tags = parseTags(input.tags);

  const variants = (input.variants ?? []).map((v) => ({
    shopifyId: gid("ProductVariant", v.id),
    sku: v.sku ?? null,
    size: variantSize(v),
    color: variantColor(v),
    priceCents: priceToCents(v.price),
    inventoryQuantity: v.inventoryQuantity ?? null,
    availableForSale: v.availableForSale ?? null,
  }));

  const images = (input.images ?? []).map((img, i) => ({
    shopifyId: img.id != null ? gid("ProductImage", img.id) : null,
    url: img.url ?? img.src ?? "",
    altText: img.altText ?? null,
    position: img.position ?? i,
  })).filter((i) => i.url);

  const color = extractColor({
    title: input.title,
    tags,
    variantOptions: (input.variants ?? []).flatMap((v) => v.selectedOptions ?? []),
  });

  // D37 — size-chart extraction. Try all known metafield candidates in
  // priority order: JSON first (most structured), HTML second (older themes).
  // Normalise the result to plain JSON for Prisma's Json field.
  const mfs = input.metafields ?? [];
  const findMf = (keys: string[]) =>
    mfs.find((m) => keys.includes(m.key))?.value ?? null;
  const jsonMf  = findMf(["size_chart", "size_chart_json", "sizing_chart"]);
  const htmlMf  = findMf(["size_chart_html", "size_chart_table"]);
  const sizeChart = pickProductSizeChart({
    jsonMetafieldValue: jsonMf,
    htmlMetafieldValue: typeof htmlMf === "string" ? htmlMf : null,
  });

  return {
    shopifyId: gid("Product", input.id),
    handle: input.handle,
    title: input.title,
    productType: input.productType ?? null,
    vendor: input.vendor ?? null,
    descriptionHtml: input.descriptionHtml ?? null,
    tags,
    category: inferCategory(input, tags),
    primaryColor: color.primaryColor,
    colorFamily: color.colorFamily,
    isActive: (input.status ?? "active") === "active",
    sizeChartJson: sizeChart ? (sizeChart as unknown as object) : null,
    sizeChartSource: sizeChart?.source ?? null,
    variants,
    images,
  };
}
