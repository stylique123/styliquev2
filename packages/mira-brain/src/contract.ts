// ─── Mira route-by-route conversation contract (Step 2H final hardening) ─────
// Deterministic layer that runs AFTER the LLM route/intent decision and the
// support handoff, BEFORE the voice/chip cap. It enforces the founder's
// conversation contract so Mira behaves like a premium sales associate with
// support awareness — never a chatbot with fashion words. Pure + deterministic.
//
// What it guarantees (from the real-transcript failures):
//  • support / policy turns get SUPPORT chips, never styling chips
//  • "show me similar / alternatives / not this" → product CARDS, not a "why?"
//  • ambiguous "I need help" → a shopping-vs-support split
//  • a casual piece + black-tie occasion → honest reject + formal alternatives
//  • every route gets ONE canonical, de-duplicated chip row (no "Will it fit?"
//    + "Size it for me" + "Is it my size?" together)

import type { MiraDecision } from "./schemas.js";
import { type MiraProduct, isSellable } from "./products.js";

// ── Canonical chip vocabulary ────────────────────────────────────────────────
const C = {
  size: "Find my size",
  tryon: "See it on me",
  look: "Build a look",
  compare: "Compare options",
  cheaper: "Show cheaper",
  support: "Talk to support",
  connect: "Connect me",
  keep: "Keep shopping",
  bag: "View bag",
  track: "Track an order",
  ret: "Start a return",
  shopHelp: "Shopping help",
  formal: "Show formal options",
  casual: "Keep it casual",
  options: "Show me options",
} as const;

const RE_SIMILAR = /\b(similar|something (else|like (this|it|that))|other options?|alternatives?|different (one|style|option)|show me another|not (this|it|for me)|don'?t like (this|it)|something different)\b/i;
const RE_HELP = /\b(i need help|need (some |a little )?help|can you help|help me|i'?m stuck|where do i (start|begin))\b/i;
const RE_BLACKTIE = /\b(black ?tie|gala|red carpet|formal (event|gala))\b/i;

// Categories that cannot serve a formal-event occasion.
const CASUAL_CATS = new Set(["top", "knitwear", "bottom", "accessory"]);

export interface ContractCtx {
  message: string;
  catalog: MiraProduct[];
  currentProduct: MiraProduct | null;
  supportNeedsHandoff: boolean;  // already-classified support intent that hands off
  isPolicyReturns: boolean;      // return/exchange POLICY answer (not a handoff)
  isPolicyShipping: boolean;     // shipping/delivery answer
}

// Split a voice into sentences (keeps the trailing fragment).
function sentences(v: string): string[] {
  return (v.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}
// Keep only the sentences that actually state the policy — drops product praise
// or styling that the model put before/after the policy answer.
function keepPolicySentences(voice: string, re: RegExp): string {
  const kept = sentences(voice).filter((s) => re.test(s));
  return kept.length ? kept.join(" ") : voice.trim();
}
// Drop a trailing follow-up question when the answer was already given.
function dropTrailingQuestion(voice: string): string {
  const s = sentences(voice);
  if (s.length >= 2 && /\?\s*$/.test(s[s.length - 1])) return s.slice(0, -1).join(" ");
  return voice.trim();
}
const SHIP_RE = /\b(ship|shipping|deliver|delivery|duties|business days|worldwide|courier|tracking|track)\b/i;
const RET_RE = /\b(return|unworn|packaging|refund|exchange|14|day window|policy)\b/i;

// Collapse near-duplicate sizing chips, drop empties/dupes, cap at 3.
function dedupeChips(chips: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let sizeUsed = false;
  for (const raw of chips ?? []) {
    const c = (raw ?? "").trim();
    if (!c) continue;
    const isSize = /\b(size|fit|measurements?)\b/i.test(c) || /^(size (me|it)|is it my size|will it fit)/i.test(c);
    if (isSize) { if (sizeUsed) continue; sizeUsed = true; }
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= 3) break;
  }
  return out;
}

// Route-canonical chips for the non-special cases.
function canonicalChips(d: MiraDecision, fallback: string[]): string[] {
  switch (d.route) {
    case "fabric":
    case "suitability":
    case "fit":
    case "size_form":
    case "navigate":
    case "reco_handle":
      return [C.size, C.tryon, C.look];
    case "look":
      return ["Add the look", "Try the look", C.size];
    case "add_to_cart":
      return [C.look, C.tryon, C.bag];
    case "reco_category":
    case "reco_filter":
    case "search":
      return [C.compare, C.cheaper, C.look];
    case "try_on":
      return [C.tryon, C.size, C.look];
    case "talk_only":
      // Occasion turns must stay ACTIONABLE — never only a follow-up question.
      if (d.intent === "occasion") return [C.look, C.options, C.size];
      return dedupeChips(fallback);
    default:
      return dedupeChips(fallback);
  }
}

export function enforceConversationContract(decision: MiraDecision, ctx: ContractCtx): MiraDecision {
  const d: MiraDecision = { ...decision };
  const msg = ctx.message;

  // 1) SUPPORT HANDOFF — support chips only, never styling (brain set the voice).
  if (ctx.supportNeedsHandoff) {
    d.quickReplies = [C.connect, C.keep];
    return d;
  }
  // 2) RETURNS / EXCHANGE POLICY — grounded answer (no styling fluff) + chips.
  if (ctx.isPolicyReturns) {
    d.voice = keepPolicySentences(d.voice, RET_RE);
    d.quickReplies = [C.ret, C.support, C.keep];
    return d;
  }
  // 3) SHIPPING / DELIVERY — grounded answer only (no product praise) + chips.
  if (ctx.isPolicyShipping) {
    d.voice = keepPolicySentences(d.voice, SHIP_RE);
    d.quickReplies = [C.track, C.support, C.keep];
    return d;
  }

  // 4) AMBIGUOUS "I need help" → shopping-vs-support split (never a sales pitch).
  if (RE_HELP.test(msg) && d.intent !== "support") {
    d.route = "talk_only";
    d.voice = ctx.currentProduct
      ? `I can help with the fit or styling on the ${ctx.currentProduct.name}, or connect you to the store team — which way?`
      : `I can help you find the right piece, or connect you to the store team — which way?`;
    d.quickReplies = [C.shopHelp, C.support, C.keep];
    return d;
  }

  // 5) BLACK-TIE on a CASUAL piece → honest reject + formal alternatives.
  if (RE_BLACKTIE.test(msg) && ctx.currentProduct && CASUAL_CATS.has(ctx.currentProduct.category)) {
    const formal = ctx.catalog.filter((p) => isSellable(p) && (p.category === "dress" || p.category === "evening" || p.category === "outerwear"));
    const pick = formal[0];
    if (pick) {
      d.route = "reco_handle";
      d.productHandle = pick.handle;
      d.voice = `The ${ctx.currentProduct.name} is too casual for black tie — I'd put you in the ${pick.name} instead.`;
    } else {
      d.route = "talk_only";
      d.productHandle = undefined;
      d.voice = `The ${ctx.currentProduct.name} is too casual for black tie — that's not the right piece for the occasion.`;
    }
    d.quickReplies = [C.formal, C.look, C.casual];
    return d;
  }

  // 6) "SHOW ME SIMILAR / ALTERNATIVES / NOT THIS" → product CARDS, not a "why?".
  if (RE_SIMILAR.test(msg) && (d.route === "talk_only" || d.route === "suitability")) {
    const cur = ctx.currentProduct;
    const alts = cur ? ctx.catalog.filter((p) => p.handle !== cur.handle && p.category === cur.category && isSellable(p)) : [];
    if (cur && alts.length > 0) {
      d.route = "reco_category";
      // category is one of the CATEGORIES enum the client filters on.
      d.category = cur.category as MiraDecision["category"];
      d.voice = `Here are a few pieces close to the ${cur.name}.`;
      d.quickReplies = [C.compare, C.cheaper, C.look];
      return d;
    }
    // no valid alternatives → leave the talk_only but give honest options.
    d.quickReplies = [C.look, C.size, C.tryon];
    return d;
  }

  // 7) FABRIC — answer the material first, no vague "what are you after?" tail.
  if (d.route === "fabric") {
    d.voice = dropTrailingQuestion(d.voice);
  }

  // 8) Default — route-canonical, de-duplicated chip row.
  d.quickReplies = canonicalChips(d, d.quickReplies ?? []);
  return d;
}
