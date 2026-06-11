// One-shot diagnostic: is the stored Shopify access token live or dead (401)?
// Run with the service env injected: railway run --service stylique-app -- npx tsx scripts/probe-token.ts
import { PrismaClient } from "@stylique/db";
import { decryptField } from "../app/lib/crypto.server";

const prisma = new PrismaClient();
const shops = await prisma.shop.findMany({
  where: { uninstalledAt: null },
  select: { shopifyDomain: true, accessToken: true, installedAt: true },
});
console.log(`installed shops: ${shops.length}`);
for (const s of shops) {
  const token = decryptField(s.accessToken);
  const res = await fetch(`https://${s.shopifyDomain}/admin/api/2025-01/shop.json`, {
    headers: { "X-Shopify-Access-Token": token ?? "" },
  });
  console.log(`  ${s.shopifyDomain} (installed ${s.installedAt?.toISOString?.()?.slice(0,10)}): Shopify Admin API → HTTP ${res.status}`);
}
await prisma.$disconnect();
