// Beauty brand demo seed — Lumière Skin (a fictional clean-beauty brand).
// Idempotent: safe to re-run. Identified by shopifyDomain = "demo-beauty.stylique.local".
//
// Product roster spans 8 replenishment categories (serum, moisturiser, foundation,
// concealer, lip, mascara, setting, treatment) so all three widget steps and
// the Restock tab have real data. Foundation/concealer cover 4 undertones × 5
// depths = 20 shades, giving ShadeMatch a realistic catalog.
//
// Run: pnpm -F @stylique/db tsx src/seed-beauty.ts

import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

import { prisma } from "./index.js";

const DEMO_BEAUTY_DOMAIN = "demo-beauty.stylique.local";
const SHOP_GID_PREFIX = "gid://shopify/demo-beauty";

// ─── Foundation shade grid (20 shades) ───────────────────────────────────────
const FOUNDATION_SHADES = [
  "Warm Light", "Warm Light Medium", "Warm Medium", "Warm Medium Deep", "Warm Deep",
  "Cool Light", "Cool Light Medium", "Cool Medium", "Cool Medium Deep", "Cool Deep",
  "Neutral Light", "Neutral Light Medium", "Neutral Medium", "Neutral Medium Deep", "Neutral Deep",
  "Olive Light", "Olive Light Medium", "Olive Medium", "Olive Medium Deep", "Olive Deep",
].map(color => ({ color, size: "30ml", priceCents: 5400 }));

const CONCEALER_SHADES = [
  "Warm Light", "Warm Medium", "Warm Deep",
  "Cool Light", "Cool Medium", "Cool Deep",
  "Neutral Light", "Neutral Medium", "Neutral Deep",
  "Olive Light", "Olive Medium", "Olive Deep",
].map(color => ({ color, size: "6ml", priceCents: 3800 }));

type BeautyProduct = {
  handle: string; title: string; category: string; tags: string[];
  variants: Array<{ size: string; color: string; priceCents: number }>;
  imageUrl: string;
};

const PRODUCTS: BeautyProduct[] = [
  // Serums
  { handle: "lumiere-vitamin-c-serum",   title: "Vitamin C Brightening Serum",  category: "serum",        tags: ["serum","brightening","vitamin-c","antioxidant","morning"],            variants: [{ size:"30ml", color:"Brightening", priceCents:7800 }],  imageUrl: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400" },
  { handle: "lumiere-retinol-serum",     title: "Retinol 0.3% Night Serum",     category: "serum",        tags: ["serum","retinol","anti-aging","night","fine-lines"],                  variants: [{ size:"30ml", color:"Night",       priceCents:8900 }],  imageUrl: "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400" },
  { handle: "lumiere-ha-serum",          title: "Hyaluronic Acid Serum",         category: "serum",        tags: ["serum","hyaluronic-acid","hydration","plumping","all-skin-types"],    variants: [{ size:"30ml", color:"Original",    priceCents:6400 }, { size:"50ml", color:"Original", priceCents:9200 }], imageUrl: "https://images.unsplash.com/photo-1631390267186-440c97f2e2b6?w=400" },
  { handle: "lumiere-niacinamide-serum", title: "Niacinamide 10% + Zinc Serum", category: "serum",        tags: ["serum","niacinamide","pore-minimizing","oily-skin","acne"],            variants: [{ size:"30ml", color:"Clear",       priceCents:5800 }],  imageUrl: "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400" },
  // Moisturisers
  { handle: "lumiere-barrier-cream",     title: "Barrier Repair Moisturiser",   category: "moisturiser",  tags: ["moisturiser","barrier","ceramides","dry-skin","sensitive"],           variants: [{ size:"50ml", color:"Original",    priceCents:5600 }, { size:"100ml", color:"Original", priceCents:9400 }], imageUrl: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400" },
  { handle: "lumiere-oil-free-gel",      title: "Oil-Free Hydrating Gel",       category: "moisturiser",  tags: ["moisturiser","gel","oily-skin","combination","lightweight"],           variants: [{ size:"50ml", color:"Clear",       priceCents:4800 }],  imageUrl: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=400" },
  { handle: "lumiere-night-cream",       title: "Rich Night Recovery Cream",    category: "moisturiser",  tags: ["moisturiser","night-cream","dry-skin","anti-aging","peptides"],       variants: [{ size:"50ml", color:"Original",    priceCents:7200 }],  imageUrl: "https://images.unsplash.com/photo-1583241475880-083f84372725?w=400" },
  // Foundation
  { handle: "lumiere-skin-tint",              title: "Skin Tint SPF 30",            category: "foundation",   tags: ["foundation","skin-tint","spf","lightweight","natural","buildable"],    variants: FOUNDATION_SHADES, imageUrl: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400" },
  { handle: "lumiere-full-coverage-foundation", title: "Full Coverage Foundation",  category: "foundation",   tags: ["foundation","full-coverage","longwear","matte"],                       variants: FOUNDATION_SHADES, imageUrl: "https://images.unsplash.com/photo-1631390267186-440c97f2e2b6?w=400" },
  // Concealer
  { handle: "lumiere-concealer",         title: "Brightening Concealer",        category: "concealer",    tags: ["concealer","under-eye","brightening","full-coverage"],                 variants: CONCEALER_SHADES,  imageUrl: "https://images.unsplash.com/photo-1599305090598-fe179d501227?w=400" },
  // Lip
  { handle: "lumiere-satin-lip",         title: "Satin Lip Colour",             category: "lip",          tags: ["lip","satin","pigmented","hydrating","longwear"],                      variants: [{ size:"3.5g", color:"Nude Blush", priceCents:3200 }, { size:"3.5g", color:"Berry Mauve", priceCents:3200 }, { size:"3.5g", color:"Classic Red", priceCents:3200 }], imageUrl: "https://images.unsplash.com/photo-1586495777744-4e6232bf2f8b?w=400" },
  { handle: "lumiere-gloss",             title: "Mirror Gloss",                 category: "lip",          tags: ["lip","gloss","plumping","hydrating","shine"],                          variants: [{ size:"5ml", color:"Clear", priceCents:2400 }, { size:"5ml", color:"Pink Nude", priceCents:2400 }], imageUrl: "https://images.unsplash.com/photo-1583241799745-c44d09c5b6ca?w=400" },
  // Mascara
  { handle: "lumiere-mascara",           title: "Volume & Lift Mascara",        category: "mascara",      tags: ["mascara","volume","lengthening","lifting","smudge-proof"],             variants: [{ size:"10ml", color:"Black", priceCents:3600 }, { size:"10ml", color:"Brown Black", priceCents:3600 }], imageUrl: "https://images.unsplash.com/photo-1631390267186-440c97f2e2b6?w=400" },
  // Setting
  { handle: "lumiere-setting-spray",     title: "Dewy Setting Spray",           category: "setting",      tags: ["setting","spray","dewy","longwear","hydrating"],                       variants: [{ size:"100ml", color:"Original", priceCents:2800 }],  imageUrl: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400" },
  // Treatment
  { handle: "lumiere-aha-toner",         title: "AHA/BHA Exfoliating Toner",   category: "treatment",    tags: ["treatment","toner","exfoliant","aha","bha","pore-refining","acne"],   variants: [{ size:"150ml", color:"Original", priceCents:5200 }],  imageUrl: "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400" },
  { handle: "lumiere-eye-cream",         title: "Peptide Eye Cream",            category: "treatment",    tags: ["treatment","eye-cream","peptides","anti-aging","dark-circles"],       variants: [{ size:"15ml",  color:"Original", priceCents:6800 }],  imageUrl: "https://images.unsplash.com/photo-1583241475880-083f84372725?w=400" },
  { handle: "lumiere-spf50",             title: "Invisible SPF 50 Sunscreen",  category: "treatment",    tags: ["treatment","spf","sunscreen","daily","lightweight","invisible"],       variants: [{ size:"50ml",  color:"Original", priceCents:4400 }, { size:"50ml", color:"Tinted", priceCents:4800 }], imageUrl: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=400" },
];

async function seed() {
  console.log("Seeding beauty demo store: Lumière Skin…");

  const shop = await prisma.shop.upsert({
    where: { shopifyDomain: DEMO_BEAUTY_DOMAIN },
    update: {},
    create: {
      shopifyDomain: DEMO_BEAUTY_DOMAIN,
      accessToken: "demo_token_beauty",
      scopes: "read_products,write_products,read_orders",
    },
  });
  console.log(`Shop: ${shop.id}`);

  await prisma.plan.upsert({
    where: { shopId: shop.id },
    update: { planFeaturesJson: { brandMode: "beauty", stylist: { stylistName: "Lumière AI", voice: "warm_friend" } } },
    create: {
      shopId: shop.id, tier: "GROWTH",
      planFeaturesJson: { brandMode: "beauty", stylist: { stylistName: "Lumière AI", voice: "warm_friend" } },
    },
  });

  let productCount = 0, variantCount = 0;

  for (const p of PRODUCTS) {
    const shopifyProductId = `${SHOP_GID_PREFIX}/Product/${p.handle}`;

    const product = await prisma.product.upsert({
      where: { shopId_shopifyId: { shopId: shop.id, shopifyId: shopifyProductId } },
      update: { title: p.title, category: p.category, tags: p.tags },
      create: {
        shopId: shop.id, shopifyId: shopifyProductId,
        handle: p.handle, title: p.title, category: p.category, tags: p.tags,
        tryonReady: false, widgetTier: 2,
      },
    });

    // Upsert primary image (find by position=0 on this product, create if missing)
    const existing = await prisma.productImage.findFirst({ where: { productId: product.id, position: 0 } });
    if (existing) {
      await prisma.productImage.update({ where: { id: existing.id }, data: { url: p.imageUrl } });
    } else {
      await prisma.productImage.create({ data: { productId: product.id, url: p.imageUrl, position: 0 } });
    }

    for (let i = 0; i < p.variants.length; i++) {
      const v = p.variants[i]!;
      const shopifyVariantId = `${SHOP_GID_PREFIX}/ProductVariant/${p.handle}-${i}`;
      await prisma.productVariant.upsert({
        where: { productId_shopifyId: { productId: product.id, shopifyId: shopifyVariantId } },
        update: { size: v.size, color: v.color, priceCents: v.priceCents, availableForSale: true },
        create: {
          productId: product.id, shopifyId: shopifyVariantId,
          size: v.size, color: v.color, priceCents: v.priceCents, availableForSale: true,
        },
      });
      variantCount++;
    }
    productCount++;
  }

  console.log(`Products: ${productCount} (${variantCount} variants)`);
  console.log(`Done. Widget URL: ${DEMO_BEAUTY_DOMAIN}`);
}

seed().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
