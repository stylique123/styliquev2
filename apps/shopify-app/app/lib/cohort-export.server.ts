import { MIRA_CART_INTENT_EVENT_NAMES, MIRA_CART_SUCCESS_EVENT_NAMES } from "@stylique/core";

export function cohortCartFlags(events: Set<string>) {
  return {
    hadCart: MIRA_CART_SUCCESS_EVENT_NAMES.some((name) => events.has(name)),
    hadCartIntent: MIRA_CART_INTENT_EVENT_NAMES.some((name) => events.has(name)),
  };
}
