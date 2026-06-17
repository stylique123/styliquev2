// Tenant safety utilities — fashion app.
//
// Three exports that enforce shop-scoped tenancy (§3 invariant #1) at the
// call site rather than relying on every query author to remember the filter.
//
//   requireShopId   — extracts shopId from an authenticated admin request;
//                     throws 401 if the session is missing or the Shop row
//                     cannot be resolved.
//
//   assertShopOwns  — compares a resource's shopId against the caller's shopId;
//                     throws 403 on mismatch. Use before any cross-tenant read.
//
//   scopedPrisma    — returns a thin wrapper whose helpers unconditionally inject
//                     a `shopId` filter. This is a SAFETY LAYER, not a
//                     replacement for the existing queries — it is useful when
//                     you want an explicit compile-time signal that a query is
//                     tenant-scoped without auditing every where clause manually.
//
// Usage (admin action):
//
//   const shopId = await requireShopId(request);
//   const db = scopedPrisma(shopId);
//   const rows = await db.findMany("product", { select: { id: true } });
//
// Usage (shopper API — shop is already resolved from the App Proxy HMAC):
//
//   assertShopOwns(shop.id, resource.shopId);
//

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

// ─── requireShopId ──────────────────────────────────────────────────────────

/**
 * Extracts the `shopId` (Prisma `Shop.id`) from an authenticated Shopify
 * **admin** request. Throws a 401 Response if authentication fails or the
 * Shop row does not exist.
 *
 * Only use this in admin routes (`authenticate.admin`). For App Proxy /
 * shopper routes, shopId is resolved from `resolveShopDomain` + DB lookup
 * in the proxy route itself.
 */
export async function requireShopId(request: Request): Promise<string> {
  let shopDomain: string;
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session.shop;
  } catch {
    throw json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, uninstalledAt: true },
  });

  if (!shop || shop.uninstalledAt) {
    throw json({ ok: false, error: "shop_not_installed" }, { status: 403 });
  }

  return shop.id;
}

// ─── assertShopOwns ─────────────────────────────────────────────────────────

/**
 * Asserts that `resourceShopId` matches the authenticated `shopId`. Throws a
 * 403 Response on mismatch.
 *
 * Use this before returning or mutating any resource that carries a `shopId`
 * field when the resource was looked up by a non-shop-scoped key (e.g. by a
 * bare `id` from a URL parameter).
 *
 * @example
 *   const record = await prisma.product.findUnique({ where: { id } });
 *   if (!record) throw notFound();
 *   assertShopOwns(shopId, record.shopId); // throws 403 if leaked via URL
 */
export function assertShopOwns(shopId: string, resourceShopId: string): void {
  if (shopId !== resourceShopId) {
    throw json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
}

// ─── scopedPrisma ───────────────────────────────────────────────────────────

type WhereInput = Record<string, unknown>;
type SelectInput = Record<string, unknown>;

interface ScopedFindManyOptions {
  where?: WhereInput;
  select?: SelectInput;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  include?: Record<string, unknown>;
}

interface ScopedFindFirstOptions {
  where?: WhereInput;
  select?: SelectInput;
  include?: Record<string, unknown>;
}

interface ScopedUpdateManyOptions {
  where?: WhereInput;
  data: Record<string, unknown>;
}

interface ScopedCountOptions {
  where?: WhereInput;
}

/**
 * Returns a scoped helper object that automatically injects `shopId` into
 * every Prisma query it issues.  This wrapper is intentionally narrow — it
 * covers the most common read/write operations; for complex queries with
 * custom joins, write them directly with an explicit `shopId` filter and add
 * a comment referencing §3 invariant #1.
 *
 * **This is a safety wrapper, not a replacement for the existing queries.**
 * Adopting it at a call site is opt-in; the goal is to make the shopId filter
 * un-forgettable at the call site rather than implicit.
 */
export function scopedPrisma(shopId: string) {
  function mergeWhere(where?: WhereInput): WhereInput {
    return { ...where, shopId };
  }

  return {
    /**
     * `prisma.<model>.findMany` with `shopId` injected into `where`.
     */
    findMany<T = unknown>(
      model: Parameters<typeof prisma.product.findMany>[0] extends infer O ? string : string,
      options: ScopedFindManyOptions = {},
    ): Promise<T[]> {
      const delegate = (prisma as unknown as Record<string, { findMany: (opts: unknown) => Promise<T[]> }>)[model];
      if (!delegate?.findMany) throw new Error(`scopedPrisma: unknown model "${model}"`);
      return delegate.findMany({ ...options, where: mergeWhere(options.where) });
    },

    /**
     * `prisma.<model>.findFirst` with `shopId` injected into `where`.
     */
    findFirst<T = unknown>(
      model: string,
      options: ScopedFindFirstOptions = {},
    ): Promise<T | null> {
      const delegate = (prisma as unknown as Record<string, { findFirst: (opts: unknown) => Promise<T | null> }>)[model];
      if (!delegate?.findFirst) throw new Error(`scopedPrisma: unknown model "${model}"`);
      return delegate.findFirst({ ...options, where: mergeWhere(options.where) });
    },

    /**
     * `prisma.<model>.updateMany` with `shopId` injected into `where`.
     * Prefer `updateMany` over `update` to enforce the shop guard even when
     * the primary key is known — a leaked primary key must not enable a
     * cross-tenant write.
     */
    updateMany<T = unknown>(
      model: string,
      options: ScopedUpdateManyOptions,
    ): Promise<T> {
      const delegate = (prisma as unknown as Record<string, { updateMany: (opts: unknown) => Promise<T> }>)[model];
      if (!delegate?.updateMany) throw new Error(`scopedPrisma: unknown model "${model}"`);
      return delegate.updateMany({ ...options, where: mergeWhere(options.where) });
    },

    /**
     * `prisma.<model>.count` with `shopId` injected into `where`.
     */
    count(
      model: string,
      options: ScopedCountOptions = {},
    ): Promise<number> {
      const delegate = (prisma as unknown as Record<string, { count: (opts: unknown) => Promise<number> }>)[model];
      if (!delegate?.count) throw new Error(`scopedPrisma: unknown model "${model}"`);
      return delegate.count({ ...options, where: mergeWhere(options.where) });
    },

    /** The underlying shopId this wrapper is scoped to. */
    shopId,
  };
}
