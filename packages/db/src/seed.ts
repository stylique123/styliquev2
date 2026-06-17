// Demo shop seed — premium LV-style fashion catalog (20 pieces).
// Idempotent: safe to re-run. Identified by shopifyDomain = "demo.stylique.local".
//
// Roster is intentionally distributed across categories so the smart styling
// engine (packages/core/src/style/service.ts) has rich material to compose
// from: tops, trousers, dresses, outerwear, shoes, and accessories — all in
// a cohesive editorial palette (onyx / cream / champagne / camel / cognac).

import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

import { prisma } from "./index.js";

const DEMO_DOMAIN = "demo.stylique.local";

type Seed = {
  handle: string;
  title: string;
  category: "shirt" | "trouser" | "skirt" | "dress" | "outerwear" | "shoe" | "accessory";
  primaryColor: string;        // hex
  colorFamily: string;
  tags: string[];
  variants: Array<{ size: string; color: string; priceCents: number }>;
};

// ─── Editorial palette (LV / The Row reference) ───────────────────────────
const C = {
  onyx:      "#0B0B0F",
  midnight:  "#1A1A2E",
  charcoal:  "#2A2730",
  ivory:     "#F5EFE0",
  cream:     "#F0E9D8",
  bone:      "#E8E2D6",
  champagne: "#D4C5A0",
  pearl:     "#F4F2EE",
  camel:     "#C8A77E",
  cognac:    "#8B5A3C",
  mocha:     "#6B4F3B",
  gold:      "#C9A24B",
};

// Apparel sizing ladders.
const APPAREL = ["XS", "S", "M", "L", "XL"];
const PANTS   = ["24", "26", "28", "30", "32"];
const SHOES   = ["36", "37", "38", "39", "40"];

const sizes = (sizesArr: string[], colorName: string, cents: number) =>
  sizesArr.map((s) => ({ size: s, color: colorName, priceCents: cents }));

const PRODUCTS: Seed[] = [
  // ── Tops ────────────────────────────────────────────────────────────────
  { handle: "onyx-silk-camisole",      title: "Onyx Silk Camisole",        category: "shirt", primaryColor: C.onyx,      colorFamily: "black",   tags: ["silk", "evening", "minimal"],                  variants: sizes(APPAREL, "Onyx", 38000) },
  { handle: "ivory-cashmere-cardigan", title: "Ivory Cashmere Cardigan",   category: "shirt", primaryColor: C.ivory,     colorFamily: "white",   tags: ["cashmere", "knit", "relaxed"],                 variants: sizes(APPAREL, "Ivory", 64000) },
  { handle: "champagne-satin-blouse",  title: "Champagne Satin Blouse",    category: "shirt", primaryColor: C.champagne, colorFamily: "neutral", tags: ["satin", "evening", "drape"],                   variants: sizes(APPAREL, "Champagne", 52000) },
  { handle: "bone-linen-shirt",        title: "Bone Linen Shirt",          category: "shirt", primaryColor: C.bone,      colorFamily: "white",   tags: ["linen", "summer", "relaxed"],                  variants: sizes(APPAREL, "Bone", 34000) },

  // ── Trousers / Skirts ───────────────────────────────────────────────────
  { handle: "noir-wool-trouser",       title: "Noir Wool Trouser",         category: "trouser", primaryColor: C.onyx,     colorFamily: "black",   tags: ["wool", "tailored", "high-rise"],              variants: sizes(PANTS, "Noir", 68000) },
  { handle: "ecru-tailored-pant",      title: "Ecru Tailored Pant",        category: "trouser", primaryColor: C.cream,    colorFamily: "cream",   tags: ["tailored", "wide", "drape"],                  variants: sizes(PANTS, "Ecru", 58000) },
  { handle: "mocha-suede-skirt",       title: "Mocha Suede Skirt",         category: "skirt",   primaryColor: C.mocha,    colorFamily: "brown",   tags: ["suede", "a-line", "midi"],                    variants: sizes(APPAREL, "Mocha", 72000) },

  // ── Dresses ─────────────────────────────────────────────────────────────
  { handle: "midnight-silk-slip-dress", title: "Midnight Silk Slip Dress", category: "dress", primaryColor: C.midnight, colorFamily: "navy",   tags: ["silk", "slip", "evening", "drape"],            variants: sizes(["XS","S","M","L"], "Midnight", 86000) },
  { handle: "pearl-crepe-midi",         title: "Pearl Crepe Midi",         category: "dress", primaryColor: C.pearl,    colorFamily: "white",  tags: ["crepe", "midi", "drape", "flowy"],             variants: sizes(["XS","S","M","L"], "Pearl", 78000) },

  // ── Outerwear ───────────────────────────────────────────────────────────
  { handle: "camel-cashmere-coat",     title: "Camel Cashmere Coat",       category: "outerwear", primaryColor: C.camel,    colorFamily: "tan",    tags: ["cashmere", "oversized", "longline", "wool"],   variants: sizes(["XS","S","M","L"], "Camel", 184000) },
  { handle: "onyx-trench",              title: "Onyx Trench",              category: "outerwear", primaryColor: C.onyx,     colorFamily: "black",  tags: ["trench", "tailored", "longline"],              variants: sizes(["XS","S","M","L"], "Onyx", 128000) },
  { handle: "ivory-boucle-jacket",      title: "Ivory Bouclé Jacket",      category: "outerwear", primaryColor: C.ivory,    colorFamily: "cream",  tags: ["boucle", "cropped", "tailored"],               variants: sizes(["XS","S","M","L"], "Ivory", 112000) },

  // ── Shoes ───────────────────────────────────────────────────────────────
  { handle: "black-patent-pump",       title: "Black Patent Pump",         category: "shoe", primaryColor: C.onyx,     colorFamily: "black",   tags: ["patent", "heel", "evening"],                   variants: sizes(SHOES, "Black", 64000) },
  { handle: "bone-slingback",          title: "Bone Slingback Heel",       category: "shoe", primaryColor: C.bone,     colorFamily: "cream",   tags: ["slingback", "heel", "leather"],                variants: sizes(SHOES, "Bone", 72000) },
  { handle: "cognac-riding-boot",      title: "Cognac Riding Boot",        category: "shoe", primaryColor: C.cognac,   colorFamily: "brown",   tags: ["leather", "tall", "riding"],                   variants: sizes(SHOES, "Cognac", 124000) },

  // ── Accessories ─────────────────────────────────────────────────────────
  { handle: "gold-drop-earring",       title: "Gold Drop Earring",         category: "accessory", primaryColor: C.gold,     colorFamily: "gold",   tags: ["gold", "drop", "evening"],                     variants: [{ size: "OS", color: "Gold", priceCents: 38000 }] },
  { handle: "onyx-pearl-strand",       title: "Onyx Pearl Strand",         category: "accessory", primaryColor: C.onyx,     colorFamily: "black",  tags: ["pearl", "strand", "evening"],                  variants: [{ size: "OS", color: "Onyx", priceCents: 58000 }] },
  { handle: "champagne-silk-scarf",    title: "Champagne Silk Scarf",      category: "accessory", primaryColor: C.champagne, colorFamily: "neutral",tags: ["silk", "scarf", "drape"],                      variants: [{ size: "OS", color: "Champagne", priceCents: 28000 }] },
  { handle: "cognac-leather-tote",     title: "Cognac Leather Tote",       category: "accessory", primaryColor: C.cognac,   colorFamily: "brown",  tags: ["leather", "tote", "everyday"],                 variants: [{ size: "OS", color: "Cognac", priceCents: 168000 }] },
  { handle: "noir-calfskin-clutch",    title: "Noir Calf-skin Clutch",     category: "accessory", primaryColor: C.onyx,     colorFamily: "black",  tags: ["leather", "clutch", "evening"],                variants: [{ size: "OS", color: "Noir", priceCents: 98000 }] },
];

// Real garment placeholder images from Unsplash (CC0). Mapped by category
// so VTO image-quality scoring has a real JPEG to evaluate rather than an
// SVG data URL, which is rejected by all image-ML pipelines (OI-16).
const GARMENT_IMAGES: Record<string, string> = {
  shirt:     "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800",
  trouser:   "https://images.unsplash.com/photo-1542272604-787c3835535d?w=800",
  skirt:     "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=800",
  dress:     "https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800",
  outerwear: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800",
  shoe:      "https://images.unsplash.com/photo-1542272604-787c3835535d?w=800", // fallback — no shoe placeholder in CC0 set
  accessory: "https://images.unsplash.com/photo-1562157873-818bc0726f68?w=800", // blouse as neutral accessory stand-in
};

function garmentImageUrl(p: Seed): string {
  return GARMENT_IMAGES[p.category] ?? "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800";
}

// Editorial card image — inline SVG data URL (no network, always loads).
// Premium 4:5 ratio, product primary color background, serif typography centered.
// Two-line wrap for longer names. Cream foreground on dark colors, onyx on light.
function imageUrl(p: Seed): string {
  const bg = p.primaryColor;
  const dark = ["black", "navy", "brown", "tan"].includes(p.colorFamily);
  const fg = dark ? "#F5EFE0" : "#0B0B0F";
  const muted = dark ? "rgba(245,239,224,0.55)" : "rgba(11,11,15,0.55)";

  // Split title into max 2 lines: first half / second half of words.
  const words = p.title.split(" ");
  const mid = Math.ceil(words.length / 2);
  const line1 = words.slice(0, mid).join(" ");
  const line2 = words.slice(mid).join(" ");

  // Build SVG. Use Georgia (universal serif fallback) — looks LV-editorial
  // and renders identically across browsers without web-font dependency.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 1000' preserveAspectRatio='xMidYMid slice'>
    <rect width='800' height='1000' fill='${bg}'/>
    <g font-family='Georgia, "Times New Roman", serif' fill='${fg}' text-anchor='middle'>
      <text x='400' y='100' font-size='13' letter-spacing='4' fill='${muted}' style='text-transform:uppercase;font-family:Arial,sans-serif'>Stylique</text>
      <text x='400' y='510' font-size='44' font-style='italic'>${escapeXml(line1)}</text>
      ${line2 ? `<text x='400' y='560' font-size='44' font-style='italic'>${escapeXml(line2)}</text>` : ""}
      <line x1='340' y1='600' x2='460' y2='600' stroke='${muted}' stroke-width='0.5'/>
      <text x='400' y='640' font-size='11' letter-spacing='3' fill='${muted}' style='text-transform:uppercase;font-family:Arial,sans-serif'>${escapeXml(p.category)}</text>
    </g>
  </svg>`;
  // URL-encode (not base64 — smaller and cleaner in DB).
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

async function main() {
  const shop = await prisma.shop.upsert({
    where: { shopifyDomain: DEMO_DOMAIN },
    update: {},
    create: {
      shopifyDomain: DEMO_DOMAIN,
      accessToken: "demo-no-token",
      scopes: "read_products",
    },
  });

  await prisma.plan.upsert({
    where: { shopId: shop.id },
    update: {},
    create: {
      shopId: shop.id,
      tier: "STARTER",
      monthlyTryOnPersonal: 500,
      monthlyTryOnBody: null,
      analyticsLevel: "BASIC",
      supportLevel: "STANDARD",
      fairUseWarnAt: 0.8,
    },
  });

  await prisma.brandSource.upsert({
    where: { id: `${shop.id}-shopify-source` },
    update: {},
    create: {
      id: `${shop.id}-shopify-source`,
      shopId: shop.id,
      kind: "SHOPIFY",
      identifier: DEMO_DOMAIN,
      status: "READY",
      lastSyncedAt: new Date(),
    },
  });

  for (const p of PRODUCTS) {
    const shopifyId = `gid://shopify/Product/demo-${p.handle}`;
    const product = await prisma.product.upsert({
      where: { shopId_shopifyId: { shopId: shop.id, shopifyId } },
      update: {
        title: p.title, handle: p.handle, category: p.category, tags: p.tags,
        primaryColor: p.primaryColor, colorFamily: p.colorFamily,
      },
      create: {
        shopId: shop.id,
        shopifyId,
        handle: p.handle,
        title: p.title,
        category: p.category,
        primaryColor: p.primaryColor,
        colorFamily: p.colorFamily,
        tags: p.tags,
      },
    });

    // OI-16 — use a real Unsplash garment photograph as the primary image so
    // VTO image-quality scoring (D37) and pre-warm renders (OI-34) have a
    // usable JPEG URL instead of an SVG data URL that image-ML pipelines reject.
    const garmentUrl = garmentImageUrl(p);
    await prisma.productImage.upsert({
      where: { id: `${product.id}-img-0` },
      update: { url: garmentUrl },
      create: { id: `${product.id}-img-0`, productId: product.id, url: garmentUrl, position: 0, role: "CATALOG" },
    });

    // Keep the SVG editorial card as a secondary display image (position 1).
    // Dashboard / catalog UI uses this for the editorial look; VTO uses img-0.
    const svgUrl = imageUrl(p);
    await prisma.productImage.upsert({
      where: { id: `${product.id}-img-1` },
      update: { url: svgUrl },
      create: { id: `${product.id}-img-1`, productId: product.id, url: svgUrl, position: 1, role: "CATALOG" },
    });

    for (let i = 0; i < p.variants.length; i++) {
      const v = p.variants[i];
      const vShopifyId = `gid://shopify/ProductVariant/demo-${p.handle}-${i}`;
      await prisma.productVariant.upsert({
        where: { productId_shopifyId: { productId: product.id, shopifyId: vShopifyId } },
        update: { size: v.size, color: v.color, priceCents: v.priceCents },
        create: {
          productId: product.id,
          shopifyId: vShopifyId,
          sku: `${p.handle}-${v.size}`,
          size: v.size,
          color: v.color,
          priceCents: v.priceCents,
        },
      });
    }
  }

  const productCount = await prisma.product.count({ where: { shopId: shop.id } });
  console.log(`✓ Seeded demo shop ${DEMO_DOMAIN} with ${productCount} LV-editorial products`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
