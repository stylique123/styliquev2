// ─── Mira verification layer (Step 2H Phase 2 / P2-T04) ──────────────────────
// THE "no fake success" guarantee. After the brain produces a decision (and the
// existing name/colour/eligibility guards run), this layer makes the LAST check:
// Mira may only CLAIM something that is verifiably true.
//
//   • product handle exists + belongs to the active (shop-scoped) catalog
//   • the piece is sellable (photographed + in stock) for visual/cart routes
//   • a CART add is NEVER claimed complete here — the client does the real
//     /cart/add.js and shows the toast; brain voice must be intent, not "done"
//   • a TRY-ON is NEVER claimed rendered — it's an offer to open the fitting room
//   • a POLICY answer must come from a real source, else refuse + offer handoff
//   • a HANDOFF never claims a ticket was created or a human has replied
//   • support never claims an order/return/exchange was processed
//
// Unverifiable claims are DOWNGRADED (route and/or voice rewritten) rather than
// shipped. Returns the safe decision + a structured report for the audit log.

import type { MiraDecision } from "./schemas.js";
import type { MiraProduct } from "./products.js";
import { validateHandle, isSellable } from "./products.js";
import type { WhitelistedAction } from "./planner.js";
import { classifySupportIntent, groundPolicyAnswer, buildSafeHandoff } from "./support.js";
import type { BrandIdentity } from "./system.js";

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}
export interface VerificationReport {
  ok: boolean;                 // false when any claim had to be downgraded
  checks: VerificationCheck[];
  downgraded: boolean;
}

// Past-tense / completion claims that would be a FAKE success before the client
// confirms the real cart add. Downgraded to intent phrasing.
const FAKE_CART_DONE = /\b(it.?s (in|added to) your (bag|cart)|added (it|to your (bag|cart))|i.?ve added|i added|in your (bag|cart) now|done,? it.?s in|that.?s in your (bag|cart))\b/i;
// Claims the render already happened (it has not — try-on is an offer here).
const FAKE_TRYON_DONE = /\b(here.?s how it looks on you|you.?re wearing|this is you in|as you can see on you|the render shows|see yourself in)\b/i;
// Fake ticket / SLA / human-replied claims on a handoff.
const FAKE_HANDOFF = /\b(i.?ve (created|opened|raised) a (ticket|case)|a human will (reply|respond) (in|within)|someone will (get back|reply) (in|within)|ticket #?\d|i.?ve contacted (them|the team))\b/i;
// Order/return mutation claims — never automated in V1.
const FAKE_ORDER_MUTATION = /\b(i.?ve (processed|started|created|initiated) (your|the) (return|exchange|refund)|your (return|exchange|refund) (is|has been) (processed|started|created)|i.?ve cancelled your order|order (cancelled|updated))\b/i;

function softenCartVoice(voice: string): string {
  // Keep it short + honest: an offer, not a completion claim.
  return "I'll add it to your bag now — want the full look too, or straight to checkout?";
}
function softenTryonVoice(voice: string, productName?: string): string {
  return productName
    ? `Let's put the ${productName} in the fitting room so you can see it on.`
    : "Let's open the fitting room so you can see it on.";
}

export interface VerifyOpts {
  action: WhitelistedAction;
  brand?: BrandIdentity;
  isDemo: boolean;
  message: string;
  currentProductHandle?: string | null;
}

export function verifyDecision(
  decision: MiraDecision,
  activeCatalog: MiraProduct[],
  opts: VerifyOpts,
): { decision: MiraDecision; report: VerificationReport } {
  const checks: VerificationCheck[] = [];
  let d: MiraDecision = { ...decision };
  let downgraded = false;

  const productRoutes = new Set(["reco_handle", "reco_category", "reco_filter", "navigate", "search", "suitability", "fabric", "fit", "size_form", "try_on", "look", "add_to_cart", "compare"]);

  // 1. Product handle exists + belongs to the (shop-scoped) catalog.
  if (d.productHandle) {
    const valid = validateHandle(d.productHandle, activeCatalog);
    if (!valid) {
      checks.push({ name: "handle_exists", passed: false, detail: `dropped phantom handle "${d.productHandle}"` });
      d = { ...d, productHandle: undefined };
      // A product route with no real handle can't make a product claim → talk_only.
      if (productRoutes.has(d.route)) { d = { ...d, route: "talk_only" }; }
      downgraded = true;
    } else {
      checks.push({ name: "handle_exists", passed: true });
      // 2. Sellable for visual/cart routes (photographed + in stock).
      if (["try_on", "add_to_cart", "navigate", "look"].includes(d.route)) {
        const p = activeCatalog.find((x) => x.handle === valid);
        if (p && !isSellable(p)) {
          checks.push({ name: "sellable", passed: false, detail: `${valid} not sellable (no photo or out of stock)` });
          d = { ...d, route: "talk_only", productHandle: undefined };
          downgraded = true;
        } else {
          checks.push({ name: "sellable", passed: true });
        }
      }
    }
  }

  // 3. compareHandles all exist.
  if (d.compareHandles?.length) {
    const before = d.compareHandles.length;
    const kept = d.compareHandles.filter((h) => validateHandle(h, activeCatalog));
    if (kept.length !== before) {
      checks.push({ name: "compare_handles_exist", passed: false, detail: `dropped ${before - kept.length} phantom compare handle(s)` });
      d = { ...d, compareHandles: kept.length ? kept : undefined };
      downgraded = true;
    } else {
      checks.push({ name: "compare_handles_exist", passed: true });
    }
  }

  // 4. No fake CART success — the client does the real add + toast.
  if (FAKE_CART_DONE.test(d.voice)) {
    checks.push({ name: "no_fake_cart_success", passed: false, detail: "rewrote past-tense cart claim to intent" });
    d = { ...d, voice: softenCartVoice(d.voice) };
    downgraded = true;
  } else {
    checks.push({ name: "no_fake_cart_success", passed: true });
  }

  // 5. No fake TRY-ON render claim.
  if (FAKE_TRYON_DONE.test(d.voice)) {
    const p = d.productHandle ? activeCatalog.find((x) => x.handle === d.productHandle) : undefined;
    checks.push({ name: "no_fake_tryon_render", passed: false, detail: "rewrote render-complete claim to fitting-room offer" });
    d = { ...d, voice: softenTryonVoice(d.voice, p?.name) };
    downgraded = true;
  } else {
    checks.push({ name: "no_fake_tryon_render", passed: true });
  }

  // 6. No fake handoff / order mutation in the voice.
  if (FAKE_HANDOFF.test(d.voice) || FAKE_ORDER_MUTATION.test(d.voice)) {
    checks.push({ name: "no_fake_handoff_or_mutation", passed: false, detail: "stripped fake ticket/SLA/order-mutation claim" });
    const si = classifySupportIntent(opts.message) ?? "human_handoff";
    const ho = buildSafeHandoff(si, opts.message, opts.currentProductHandle ?? null);
    d = { ...d, voice: ho.voice, route: "talk_only" };
    downgraded = true;
  } else {
    checks.push({ name: "no_fake_handoff_or_mutation", passed: true });
  }

  // 7. POLICY answers must be sourced. If the action is policy_answer (or the
  //    route is `returns`), require a real policy source; else refuse + handoff.
  if (opts.action === "policy_answer" || d.route === "returns") {
    const si = classifySupportIntent(opts.message);
    const policyIntent = si ?? "return_policy";
    const grounded = groundPolicyAnswer(policyIntent, opts.brand, opts.isDemo);
    if (grounded) {
      checks.push({ name: "policy_has_source", passed: true, detail: grounded.source });
      // Ensure the voice carries the grounded policy text (not an invented one).
      if (!d.voice || d.voice.length < 8) d = { ...d, voice: grounded.text };
    } else {
      checks.push({ name: "policy_has_source", passed: false, detail: "no policy source → refuse + handoff" });
      const ho = buildSafeHandoff(policyIntent, opts.message, opts.currentProductHandle ?? null);
      d = {
        ...d,
        route: "talk_only",
        voice: `I don't want to guess the policy and get it wrong. ${ho.voice}`,
        quickReplies: ["Connect me", "Keep shopping"],
      };
      downgraded = true;
    }
  }

  const ok = checks.every((c) => c.passed);
  return { decision: d, report: { ok, checks, downgraded } };
}
