// ─── Mira rejection handling (Step 2H Phase 2 / P2-T06) ──────────────────────
// A real sales associate reads a "no" and changes the pitch — she does not show
// the same piece again. This module detects rejection in the shopper's message
// and classifies WHY, so the brain can (a) avoid re-recommending the rejected
// piece and (b) steer the next pick (cheaper on "too expensive", softer on "too
// formal", etc.). Pure + deterministic.

export type RejectionReason = "price" | "style" | "fit" | "color" | "generic" | null;

export interface RejectionSignal {
  rejected: boolean;
  reason: RejectionReason;
  // A short directive the brain/planner can act on for the NEXT recommendation.
  steer: string | null;
}

const PRICE_RX = /\b(too expensive|too much|too pricey|can.?t afford|out of (my )?budget|cheaper|less expensive|lower price|too dear|too costly)\b/i;
const STYLE_TOO_FORMAL_RX = /\b(too formal|too dressy|too fancy|too much|too smart|too business)\b/i;
const STYLE_TOO_CASUAL_RX = /\b(too casual|too plain|too basic|too boring|too sporty|not dressy enough|need something dressier)\b/i;
const FIT_RX = /\b(too (tight|loose|baggy|fitted|small|big|short|long|cropped)|doesn.?t fit|won.?t fit|wrong fit)\b/i;
const COLOR_RX = /\b(don.?t (like|want) the colou?r|wrong colou?r|not (in )?(black|white|beige|blue|red|green|pink|navy|cream|ivory)|different colou?r|another colou?r|too (dark|bright|pale))\b/i;
// Generic "not this" rejection — kept narrow so a genuine question isn't misread.
const GENERIC_RX = /\b(no,? not (this|that|it)|not (this|that) one|don.?t like (this|that|it)|not for me|not really|not feeling (this|it)|show me (another|something else|different)|i.?ll pass|next|something else)\b/i;

export function detectRejection(message: string): RejectionSignal {
  const m = message.toLowerCase().trim();

  if (PRICE_RX.test(m)) {
    return { rejected: true, reason: "price", steer: "Recommend a lower-priced piece in the same direction; lead with the price relief." };
  }
  if (FIT_RX.test(m)) {
    return { rejected: true, reason: "fit", steer: "Recommend a different cut/fit; offer to size the piece properly." };
  }
  if (COLOR_RX.test(m)) {
    return { rejected: true, reason: "color", steer: "Recommend a piece in a different colourway or a different piece in the wanted colour." };
  }
  if (STYLE_TOO_FORMAL_RX.test(m)) {
    return { rejected: true, reason: "style", steer: "Recommend a more relaxed / casual piece." };
  }
  if (STYLE_TOO_CASUAL_RX.test(m)) {
    return { rejected: true, reason: "style", steer: "Recommend a dressier / more elevated piece." };
  }
  if (GENERIC_RX.test(m)) {
    return { rejected: true, reason: "generic", steer: "Show a genuinely different piece — change category or silhouette, not a near-duplicate." };
  }
  return { rejected: false, reason: null, steer: null };
}
