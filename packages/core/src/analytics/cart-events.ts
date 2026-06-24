// Canonical cart-assist event groups.
//
// Keep intent and confirmed cart-origin separate. Attribution can read the
// union, because revenue is only written after a fulfilled order, but funnel
// reports must not treat CTA clicks as successful cart mutations.

export const MIRA_CART_INTENT_EVENT_NAMES = [
  "CHAT_CART_REQUESTED",
  "MIRA_ADD_TO_CART_ASSIST",
  "COMBO_ADD_ALL",
] as const;

export const MIRA_CART_SUCCESS_EVENT_NAMES = [
  "CART_FROM_MIRA",
  "CART_FROM_TRYON",
  "CART_FROM_WIDGET_STYLE",
] as const;

export const MIRA_CART_ASSIST_EVENT_NAMES = [
  ...MIRA_CART_INTENT_EVENT_NAMES,
  ...MIRA_CART_SUCCESS_EVENT_NAMES,
] as const;

export type MiraCartIntentEventName = typeof MIRA_CART_INTENT_EVENT_NAMES[number];
export type MiraCartSuccessEventName = typeof MIRA_CART_SUCCESS_EVENT_NAMES[number];
export type MiraCartAssistEventName = typeof MIRA_CART_ASSIST_EVENT_NAMES[number];

export const LEGACY_EVENT_ALIASES: Record<string, readonly string[]> = {
  CHAT_OPENED: ["MIRA_OPENED"],
  CHAT_PRODUCT_CLICKED: ["MIRA_PRODUCT_RECOMMENDED"],
  CHAT_CART_REQUESTED: MIRA_CART_ASSIST_EVENT_NAMES.filter((name) => name !== "CHAT_CART_REQUESTED"),
  CHAT_NEAR_MISS: ["MIRA_NEAR_MISS"],
};
