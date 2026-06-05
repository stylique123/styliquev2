// Shared types used across shopper API modules.
// Kept in a separate file to avoid circular imports between
// chat.server.ts / account.server.ts / shopper-events.server.ts
// and the shopper.server.ts barrel.

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string };

export type ShopperOutfitItem = {
  product: import("./serialize").ShopperProduct;
  role: string;
  colorNote: string;
};

export type ShopperEntitlement = {
  personalPhotoAllowed: boolean;
  bodyModelAllowed: true;            // always true — body model preview is always on
};

export type ShopperFit = {
  recommendedSize: string;
  confidence: number;
  rationale: string;
  sizeUpAdvice?: string;
  sizeDownAdvice?: string;
};
