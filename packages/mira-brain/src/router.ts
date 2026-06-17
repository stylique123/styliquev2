// ─── Mira action router (Step 2H Phase 2 / P2-T03) ───────────────────────────
// Every brain decision route maps to exactly one WHITELISTED action. The router
// is fail-closed: an unknown/empty route resolves to `hesitation_capture` (Mira
// speaks + captures the signal, claims nothing). It also produces a structured
// ActionAttempt log entry so we have an audit trail of what was attempted and
// whether it was verified — the LLM never directly "executes"; the router + the
// deterministic services do, and the verify layer gates the success language.

import type { MiraDecision } from "./schemas.js";
import type { WhitelistedAction } from "./planner.js";

// Route (the client builder) → whitelisted action (the sales capability). A route
// not in this map is unknown → fail closed.
const ROUTE_TO_ACTION: Record<string, WhitelistedAction> = {
  reco_category: "product_recommendation",
  reco_handle: "product_recommendation",
  reco_filter: "product_recommendation",
  navigate: "product_recommendation",
  search: "product_recommendation",
  suitability: "product_explanation",
  fabric: "product_explanation",
  compare: "product_comparison",
  fit: "size_help_start",
  size_form: "size_help_start",
  try_on: "tryon_offer",
  look: "outfit_completion",
  add_to_cart: "add_to_cart_assist",
  returns: "policy_answer",
  talk_only: "hesitation_capture",
};

export interface ActionAttempt {
  route: string;
  action: WhitelistedAction;
  failClosed: boolean;     // true when the route was unknown and we downgraded
  verified: boolean | null; // set by the verify layer; null until verified
  notes: string[];
}

// Resolve a decision's route to a whitelisted action. Fail-closed default.
export function routeToAction(decision: MiraDecision): ActionAttempt {
  const route = decision.route;
  const action = ROUTE_TO_ACTION[route];
  if (!action) {
    return {
      route: route ?? "(none)",
      action: "hesitation_capture",
      failClosed: true,
      verified: null,
      notes: [`unknown route "${route}" → failed closed to hesitation_capture`],
    };
  }
  return { route, action, failClosed: false, verified: null, notes: [] };
}

// Is this action one whose success language MUST be verified before Mira claims
// it? (Recommendation/explanation still verify the handle; only pure hesitation
// capture makes no factual claim.)
export function actionRequiresVerification(action: WhitelistedAction): boolean {
  return action !== "hesitation_capture";
}
