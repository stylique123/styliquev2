export type AssistEvidenceEvent = {
  productId?: string | null;
  payload?: unknown;
};

function payloadProductIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];

  const record = payload as { productId?: unknown; productIds?: unknown };
  const ids: string[] = [];

  if (typeof record.productId === "string") ids.push(record.productId);
  if (Array.isArray(record.productIds)) {
    ids.push(...record.productIds.filter((id): id is string => typeof id === "string"));
  }

  return ids;
}

export function assistedProductIdsForOrder(orderProductIds: string[], events: AssistEvidenceEvent[]): string[] {
  const orderSet = new Set(orderProductIds);
  const assisted = new Set<string>();

  for (const event of events) {
    const ids = [
      event.productId,
      ...payloadProductIds(event.payload),
    ];

    for (const id of ids) {
      if (id && orderSet.has(id)) assisted.add(id);
    }
  }

  return [...assisted];
}
