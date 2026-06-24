export type OrderEventRow = {
  id?: string | null;
  payload: unknown;
};

export function orderKeyFromEvent(row: OrderEventRow, fallbackIndex = 0): string {
  const payload = row.payload as { orderId?: string | number | null } | null;
  return payload?.orderId != null ? `o:${payload.orderId}` : `e:${row.id ?? fallbackIndex}`;
}

export function distinctOrderCountFromEvents(rows: OrderEventRow[]): number {
  const orders = new Set<string>();
  rows.forEach((row, index) => orders.add(orderKeyFromEvent(row, index)));
  return orders.size;
}
