// External dashboard auth helpers.
//
// Shared between:
//   - api.external-auth.tsx (token creation)
//   - api.external-token-verify.tsx (token verification)
//   - api.external-overview.tsx (bearer token guard)

import { createHmac } from "node:crypto";
import { prisma } from "../db.server";
import { env } from "../env.server";

export interface VerifiedToken {
  shopId: string;
  shopDomain: string;
}

/**
 * Verify a base64url-encoded external dashboard token.
 * Returns the verified shop info or null if invalid/expired.
 */
export async function verifyExternalToken(
  token: string,
): Promise<VerifiedToken | null> {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url").toString();
    const parts = raw.split(".");
    if (parts.length !== 4) return null;
    const [shopId, shopDomain, expiryStr, sig] = parts;

    // Check expiry
    if (Date.now() > Number(expiryStr)) return null;

    // Verify signature
    const payload = `${shopId}.${shopDomain}.${expiryStr}`;
    const expected = createHmac("sha256", env.SHOPIFY_API_SECRET)
      .update(payload)
      .digest("hex")
      .slice(0, 32);
    if (expected !== sig) return null;

    // Verify shop still exists and hasn't uninstalled
    const shop = await prisma.shop.findFirst({
      where: { id: shopId, shopifyDomain: shopDomain, uninstalledAt: null },
      select: { id: true, shopifyDomain: true },
    });
    if (!shop) return null;

    return { shopId: shop.id, shopDomain: shop.shopifyDomain };
  } catch {
    return null;
  }
}

/**
 * Create a signed external dashboard token for a shop.
 * Token is valid for 30 days.
 */
export function createExternalToken(shopId: string, shopDomain: string): string {
  const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const payload = `${shopId}.${shopDomain}.${expiry}`;
  const sig = createHmac("sha256", env.SHOPIFY_API_SECRET)
    .update(payload)
    .digest("hex")
    .slice(0, 32);
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}
