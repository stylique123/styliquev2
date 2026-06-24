import { prisma } from "../db.server";

export type CanonicalProductEvidence =
  | { ok: true; productId?: string; payload: unknown }
  | { ok: false };

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>) }
    : {};
}

function payloadProductEvidence(productId: string | undefined, payload: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  if (typeof productId === "string" && productId.length > 0) ids.add(productId);
  if (typeof payload.productId === "string" && payload.productId.length > 0) ids.add(payload.productId);
  if (Array.isArray(payload.productIds)) {
    for (const id of payload.productIds) {
      if (typeof id === "string" && id.length > 0) ids.add(id);
    }
  }
  return [...ids].slice(0, 12);
}

export async function validateShopProductEvidence(args: {
  shopId: string;
  eventName: string;
  productId?: string;
  payload: unknown;
  cartSuccessEvents: ReadonlySet<string>;
}): Promise<CanonicalProductEvidence> {
  const requiresProductEvidence = args.cartSuccessEvents.has(args.eventName);
  const payload = payloadRecord(args.payload);
  const ids = payloadProductEvidence(args.productId, payload);
  if (ids.length === 0) {
    return requiresProductEvidence
      ? { ok: false }
      : { ok: true, productId: undefined, payload: args.payload };
  }

  const rows = await prisma.product.findMany({
    where: { shopId: args.shopId, id: { in: ids } },
    select: { id: true },
  });
  const valid = new Set(rows.map((row) => row.id));
  const validIds = ids.filter((id) => valid.has(id));
  if (validIds.length === 0) return { ok: false };

  const canonicalProductId = args.productId && valid.has(args.productId)
    ? args.productId
    : validIds[0];
  const payloadHadProductId = typeof payload.productId === "string";
  const payloadHadProductIds = Array.isArray(payload.productIds);
  const rawProductIds = payloadHadProductIds ? payload.productIds as unknown[] : [];
  const productIds = payloadHadProductIds
    ? rawProductIds.filter((id): id is string => typeof id === "string" && valid.has(id))
    : validIds;

  return {
    ok: true,
    productId: canonicalProductId,
    payload: {
      ...payload,
      ...(payloadHadProductId || requiresProductEvidence ? { productId: canonicalProductId } : {}),
      ...(payloadHadProductIds || requiresProductEvidence ? { productIds: [...new Set(productIds)] } : {}),
    },
  };
}
