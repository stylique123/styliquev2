// Stylique Stylist — site-wide conversational AI dock.
//
// Lives alongside (NOT inside) the 3-step widget. Mounts on every page. Reads
// + writes the sq_shopper_id cookie via /apps/stylique/api/chat, so when the
// shopper picks a body type in the widget the stylist already knows about it
// on the next message.
//
// Surfaces:
//   • Floating bubble bottom-right (offset above the widget's own launcher).
//   • Click → side panel (desktop) / bottom sheet (mobile).
//   • Chat thread with model + user bubbles, typing dots.
//   • Combo cards under model bubbles → click navigates to PDP.
//   • Confirm-card UI for `add_to_cart_request` with size selector + qty.
//
// All API contracts mirror apps/shopify-app/app/lib/shopper.server.ts.

export {};                      // make this a module so `declare global` works
import { renderAuthOverlay } from "./auth";
import { IntentEngine, type IntentContext } from "./intent.js";
import { ProactiveCoordinator, type ProactiveTrigger, dispatchProactiveTrigger } from "./proactive.js";

declare global {
  interface Window {
    Shopify?: { shop?: string };
  }
}

// ─── Brand tokens (mirrored from styles.ts) ─────────────────────────────
const T = {
  bg:        "#08070A",
  surface:   "#14111A",
  glass:     "rgba(20,18,24,0.78)",
  cool:      "#8E8A99",
  text:      "#F4F2EE",
  fg:        "#F4F2EE",
  muted:     "#C9B5FF",
  border:    "rgba(255,255,255,0.10)",
  borderAcc: "rgba(201,181,255,0.35)",
  electric:  "#8B5CF6",
  pink:      "#E879C8",
  grad:      "linear-gradient(135deg, #8B5CF6 0%, #C26BE6 55%, #E879C8 100%)",
  glow:      "radial-gradient(60% 60% at 50% 50%, rgba(139,92,246,.55) 0%, rgba(232,121,200,.18) 45%, rgba(0,0,0,0) 70%)",
  spring:    "cubic-bezier(.2,.8,.2,1)",
};

// ─── API contracts ──────────────────────────────────────────────────────
type ApiResp<T> = { ok: true; data: T } | { ok: false; error: string };

type ChatProduct = {
  id: string; handle: string; title: string;
  imageUrl: string | null; primaryColor: string | null; colorFamily: string | null;
  category: string | null; sizes: string[];
};
type ChatCombo = { name: string; reasoning: string; products: ChatProduct[] };
// WalkthroughStep: a single piece in a combo walkthrough guided tour.
type WalkthroughStep = {
  productId: string;
  handle: string;
  title: string;
  imageUrl?: string;
  whyItWorksForYou: string;
};

type SizeRecommendation = {
  recommendedSize: string;
  confidence: number;       // 0–1
  trustLine: string;
  alternativeSizes: string[];
};

type ChatAction =
  | { kind: "navigate"; handle: string }
  | { kind: "add_to_cart_request"; productId: string; suggestedSize?: string }
  | { kind: "show_signup_card"; reason: string }
  | { kind: "open_tryon"; mode: "model" | "photo"; productIds: string[]; comboName?: string; modelHint?: string; autoRender?: boolean }
  // open_studio emitted by request_creative_set in brain.server.ts — must be
  // present here or Studio cross-launch actions from Mira are silently dropped.
  | { kind: "open_studio"; sourceComboName: string; productIds: string[] }
  // Guided-browse: preview card then navigate.
  | { kind: "lead_browse"; handle: string; title: string; imageUrl?: string; productId?: string; arrivalFocus?: string }
  // Combo walkthrough: step-through tour.
  | { kind: "guide_combo_walkthrough"; comboName: string; steps: WalkthroughStep[] }
  // PDP product-detail highlight.
  | { kind: "highlight_product_detail"; detail: string; imageZone?: "full" | "top" | "bottom" | "left" | "right" }
  // Size recommendation card.
  | { kind: "show_size_recommendation"; productId: string; productTitle: string; recommendation: SizeRecommendation }
  // Inline fit collection form.
  | { kind: "collect_fit_for_sizing"; productId: string; productTitle: string }
  // Multi-item outfit add — all pieces at once.
  | { kind: "add_outfit_to_cart"; items: Array<{ productId: string; suggestedSize?: string }>; comboName?: string };
type ChatReply = {
  reply: string;
  combos: ChatCombo[];
  actions: ChatAction[];
  shopperId: string;
  latencyMs: number;
};
type ChatMsg = {
  role: "user" | "model"; text: string;
  combos?: ChatCombo[];
  pendingCart?: PendingCart;
  pendingSignup?: PendingSignup;
  imageDataUrl?: string;        // shopper-attached image (selfie / reference)
};
type PendingCart = { product: ChatProduct; suggestedSize?: string; qty: number; status: "open" | "adding" | "added" | "cancelled" | "failed" };
// OI-8: added "verify" status for OTP step, plus stored email/displayName for the verify call.
type PendingSignup = { reason: string; status: "open" | "saving" | "verify" | "verifying" | "saved" | "dismissed" | "failed"; pendingEmail?: string; pendingDisplayName?: string };
type ShopperMe = {
  accountClaimed: boolean;
  displayName: string | null;
  emailMasked: string | null;
  bodyType?: string | null;
  stylist?: { name: string; avatarUrl: string | null };
};

// ─── Styles (scoped inside Shadow DOM) ──────────────────────────────────
const STL_CSS = /* css */ `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
* { font-family: "Manrope", ui-sans-serif, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
.serif { font-family: "Instrument Serif", "Cormorant Garamond", Georgia, serif; }

/* Floating bubble — default bottom-right. When the 3-step widget is mounted
   on the same page (PDPs), the host element flips to bottom-left via the
   data-corner="left" attribute we set in JS, so the two surfaces never crash. */
:host([data-corner="left"]) .sq-stl-bubble { right: auto; left: 16px; }
/* Standing-avatar launcher — a tall portrait card greeting the shopper like a
   stylist on the floor (matches the demo store's MiraLauncher), not a bare bubble. */
.sq-stl-bubble {
  position: fixed; right: 16px; bottom: 16px; z-index: 99997;
  width: 124px; padding: 0; border: 0; cursor: pointer; overflow: hidden;
  border-radius: 18px; text-align: left;
  background: linear-gradient(180deg, rgba(20,17,26,0) 0%, ${T.surface} 62%);
  box-shadow: 0 18px 48px rgba(0,0,0,.55);
  transition: transform .25s ${T.spring}, filter .2s;
  animation: sq-stl-launch-in .42s ${T.spring} both;
}
.sq-stl-bubble:hover { transform: translateY(-3px); filter: brightness(1.04); }
.sq-stl-bubble[data-pulse="true"] { animation: sq-stl-launch-float 2.8s ease-in-out infinite; }
.sq-stl-bubble__frame {
  position: absolute; inset: 0; border-radius: 18px; padding: 1.5px;
  background: ${T.grad}; opacity: .5; z-index: 3; pointer-events: none;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}
.sq-stl-bubble__portrait { position: relative; width: 100%; aspect-ratio: 3 / 4; overflow: hidden; }
.sq-stl-bubble__portrait img { width: 100%; height: 100%; object-fit: cover; object-position: center top; display: block; }
.sq-stl-bubble__portrait::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(20,17,26,0) 40%, rgba(20,17,26,.92) 100%); }
.sq-stl-bubble__cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 11px 11px; z-index: 4; }
.sq-stl-bubble__eyebrow { display: flex; align-items: center; gap: 5px; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 8px; letter-spacing: .2em; text-transform: uppercase; color: rgba(244,242,238,.72); }
.sq-stl-bubble__dot { width: 7px; height: 7px; border-radius: 50%; background: #4EC49E; box-shadow: 0 0 8px #4EC49E; animation: sq-stl-online 2s ease-in-out infinite; }
.sq-stl-bubble__name { font-family: "Instrument Serif", Georgia, serif; font-style: italic; font-size: 22px; line-height: 1; color: ${T.text}; margin-top: 2px; }
/* Glyph fallback when no portrait is available */
.sq-stl-bubble--glyph { width: 56px; height: 56px; aspect-ratio: auto; border-radius: 999px; background: ${T.grad}; display: flex; align-items: center; justify-content: center; box-shadow: 0 14px 30px rgba(139,92,246,.45); }
.sq-stl-bubble__glyph { font-family: "Instrument Serif", Georgia, serif; font-size: 22px; font-style: italic; color: ${T.text}; }
@keyframes sq-stl-online { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
@keyframes sq-stl-launch-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes sq-stl-launch-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

/* Tiny badge for unread / proactive. */
.sq-stl-badge {
  position: absolute; top: -2px; right: -2px;
  width: 18px; height: 18px; border-radius: 999px; background: ${T.pink}; color: #1F0A19;
  font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center;
  border: 2px solid ${T.bg};
}

/* Backdrop on mobile (none on desktop — it's a side dock, not a modal). */
.sq-stl-back {
  position: fixed; inset: 0; z-index: 99998;
  background: rgba(0,0,0,.55); opacity: 0; pointer-events: none;
  transition: opacity .25s ease;
}
.sq-stl-back[data-open="true"] { opacity: 1; pointer-events: auto; }
@media (min-width: 900px) { .sq-stl-back { display: none; } }

/* The dock. Desktop: 380px side panel from the right. Mobile: bottom sheet 85vh. */
.sq-stl-dock {
  position: fixed; z-index: 99999; color: ${T.text};
  background: ${T.bg}; border: 1px solid ${T.border};
  display: flex; flex-direction: column; overflow: hidden;
  transition: transform .4s ${T.spring}, opacity .25s ease;
  opacity: 0; pointer-events: none;
}
.sq-stl-dock[data-open="true"] { opacity: 1; pointer-events: auto; }

/* Mobile */
.sq-stl-dock {
  left: 0; right: 0; bottom: 0; height: 85vh;
  border-radius: 24px 24px 0 0;
  transform: translateY(40px);
  /* iOS: dock bottom anchors above home indicator bar. */
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.sq-stl-dock[data-open="true"] { transform: translateY(0); }

/* Very small phones: take more vertical space. */
@media (max-height: 600px) {
  .sq-stl-dock { height: 95vh; }
}
/* iPhone SE width: tighten horizontal padding in chat bubbles. */
@media (max-width: 379px) {
  .sq-stl-scroll { padding: 12px 10px; }
  .sq-stl-bub { font-size: 13px; padding: 9px 12px; }
  .sq-stl-head { padding: 12px 14px; }
  .sq-stl-compose { padding: 10px 10px max(10px, env(safe-area-inset-bottom, 10px)); }
}

/* Desktop */
@media (min-width: 900px) {
  .sq-stl-dock {
    left: auto; right: 16px; bottom: 16px; top: 16px;
    width: 400px; height: auto; max-height: calc(100vh - 32px);
    border-radius: 22px; transform: translateX(20px);
    box-shadow: 0 30px 60px rgba(0,0,0,.5), 0 0 0 1px rgba(139,92,246,.08), 0 0 40px rgba(139,92,246,.12);
  }
  .sq-stl-dock[data-open="true"] { transform: translateX(0); }
}

.sq-stl-glow { position: absolute; inset: -40px -40px auto -40px; height: 200px; background: ${T.glow}; opacity: .22; pointer-events: none; }

.sq-stl-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px; border-bottom: 1px solid ${T.border}; position: relative;
}
.sq-stl-head { gap: 11px; }
.sq-stl-head__meta { flex: 1; min-width: 0; }
.sq-stl-head__title { font-size: 16px; }
.sq-stl-head__title em { font-style: italic; background: ${T.grad}; -webkit-background-clip: text; background-clip: text; color: transparent; }
.sq-stl-head__name { font-family: "Instrument Serif", Georgia, serif; font-style: italic; font-size: 19px; line-height: 1.05; color: ${T.text}; }
.sq-stl-head__sub { font-size: 11px; color: ${T.cool}; letter-spacing: .2px; margin-top: 2px; }
/* Mira's face — circular crop of the portrait with an online dot (demo parity) */
.sq-stl-face { position: relative; width: 40px; height: 40px; flex-shrink: 0; }
.sq-stl-face img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; object-position: center top; border: 1.5px solid rgba(255,255,255,.18); box-shadow: 0 2px 10px rgba(0,0,0,.4); }
.sq-stl-face__dot { position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; border-radius: 50%; background: #4EC49E; border: 2px solid ${T.surface}; }
.sq-stl-close {
  background: transparent; border: 0; color: ${T.cool}; cursor: pointer;
  font-size: 22px; line-height: 1; padding: 4px 8px; border-radius: 999px;
}
.sq-stl-close:hover { color: ${T.text}; background: rgba(255,255,255,.06); }

.sq-stl-scroll { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; scroll-behavior: smooth; }
.sq-stl-greet { padding: 14px 16px; background: rgba(139,92,246,.10); border: 1px solid ${T.borderAcc}; border-radius: 16px; align-self: flex-start; max-width: 92%; }
.sq-stl-greet h4 { margin: 0 0 4px; font-family: "Instrument Serif", Georgia, serif; font-size: 18px; font-weight: 400; }
.sq-stl-greet h4 em { font-style: italic; color: ${T.muted}; }
.sq-stl-greet p { margin: 0; font-size: 12.5px; color: ${T.cool}; line-height: 1.45; }

.sq-stl-bub { padding: 10px 14px; border-radius: 14px; font-size: 13.5px; line-height: 1.5; max-width: 92%; white-space: pre-wrap; word-wrap: break-word; }
.sq-stl-bub--user { background: ${T.grad}; color: ${T.text}; align-self: flex-end; border-bottom-right-radius: 4px; }
.sq-stl-bub-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; max-width: 80%; align-self: flex-end; }
.sq-stl-bub__img { max-width: 220px; max-height: 280px; border-radius: 12px; border: 1px solid ${T.border}; object-fit: cover; }
.sq-stl-attach {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 999px;
  color: ${T.cool}; cursor: pointer;
  transition: color .15s, background .15s;
}
.sq-stl-attach:hover { color: ${T.text}; background: rgba(255,255,255,.06); }
.sq-stl-pending {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  margin: 0 4px 8px; border-radius: 12px; background: rgba(139,92,246,.08);
  border: 1px solid ${T.borderAcc};
}
.sq-stl-pending__thumb { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; }
.sq-stl-pending__hint { font-size: 11.5px; color: ${T.muted}; flex: 1; }
.sq-stl-pending__x {
  background: transparent; border: 0; color: ${T.cool}; cursor: pointer;
  font-size: 16px; line-height: 1; padding: 4px 8px; border-radius: 999px;
}
.sq-stl-pending__x:hover { color: ${T.text}; background: rgba(255,255,255,.06); }
.sq-stl-bub--model { background: ${T.surface}; color: ${T.text}; align-self: flex-start; border: 1px solid ${T.border}; border-bottom-left-radius: 4px; }

.sq-stl-typing { display: flex; gap: 4px; align-self: flex-start; padding: 12px 14px; background: ${T.surface}; border-radius: 14px; border: 1px solid ${T.border}; }
.sq-stl-typing span { width: 6px; height: 6px; border-radius: 50%; background: ${T.muted}; animation: sq-stl-typing 1.2s infinite ease-in-out; }
.sq-stl-typing span:nth-child(2) { animation-delay: .15s; }
.sq-stl-typing span:nth-child(3) { animation-delay: .3s; }
@keyframes sq-stl-typing { 0%,60%,100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

/* Combo card */
.sq-stl-combo { align-self: stretch; padding: 12px; background: ${T.surface}; border: 1px solid ${T.border}; border-radius: 14px; }
.sq-stl-combo__name { font-family: "Instrument Serif", Georgia, serif; font-size: 16px; }
.sq-stl-combo__why { font-size: 11.5px; color: ${T.cool}; margin: 2px 0 10px; }
.sq-stl-combo__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; }
.sq-stl-card { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 6px; padding: 6px; border-radius: 10px; transition: background .15s; }
.sq-stl-card:hover { background: rgba(255,255,255,.04); }
.sq-stl-card img, .sq-stl-card__noimg { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; background: #222; }
.sq-stl-card__title { font-size: 11px; color: ${T.text}; line-height: 1.3; }

/* Confirm-cart card */
.sq-stl-cart { align-self: stretch; padding: 12px; background: rgba(139,92,246,.08); border: 1px solid ${T.borderAcc}; border-radius: 14px; }
.sq-stl-cart__row { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
.sq-stl-cart__img { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; background: #222; }
.sq-stl-cart__title { font-size: 13px; line-height: 1.3; }
.sq-stl-cart__sub { font-size: 11px; color: ${T.cool}; margin-top: 2px; }
.sq-stl-cart__controls { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.sq-stl-select, .sq-stl-qty {
  background: ${T.surface}; color: ${T.text}; border: 1px solid ${T.border}; border-radius: 8px;
  padding: 6px 10px; font-size: 12px; font-family: inherit;
}
.sq-stl-qty { width: 56px; }
.sq-stl-cart__btns { display: flex; gap: 8px; }
.sq-stl-btn { flex: 1; padding: 9px 12px; border-radius: 999px; border: 0; cursor: pointer; font-size: 12.5px; font-weight: 600; font-family: inherit; transition: filter .15s, transform .15s; }
.sq-stl-btn--primary { background: ${T.grad}; color: ${T.text}; box-shadow: 0 6px 14px rgba(139,92,246,.35), inset 0 1px 0 rgba(255,255,255,.18); }
.sq-stl-btn--primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
.sq-stl-btn--ghost { background: transparent; color: ${T.cool}; border: 1px solid ${T.border}; }
.sq-stl-btn--ghost:hover { color: ${T.text}; border-color: ${T.borderAcc}; }
.sq-stl-btn:disabled { opacity: .5; cursor: not-allowed; }
.sq-stl-cart__status { font-size: 12px; color: ${T.muted}; }

/* Soft signup card */
.sq-stl-signup { align-self: stretch; padding: 14px; background: linear-gradient(135deg, rgba(139,92,246,.12) 0%, rgba(232,121,200,.08) 100%); border: 1px solid ${T.borderAcc}; border-radius: 14px; margin-top: 6px; }
.sq-stl-signup__head { margin-bottom: 10px; }
.sq-stl-signup__title { font-size: 16px; line-height: 1.25; }
.sq-stl-signup__title em { font-style: italic; background: ${T.grad}; -webkit-background-clip: text; background-clip: text; color: transparent; }
.sq-stl-signup__sub { font-size: 11.5px; color: ${T.cool}; margin-top: 4px; line-height: 1.4; }
.sq-stl-signup__row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
@media (max-width: 480px) { .sq-stl-signup__row { grid-template-columns: 1fr; } }
.sq-stl-signup__input {
  background: ${T.surface}; color: ${T.text}; border: 1px solid ${T.border};
  border-radius: 10px; padding: 9px 12px; font-size: 13px; font-family: inherit; outline: none;
  transition: border-color .15s;
}
.sq-stl-signup__input:focus { border-color: ${T.borderAcc}; }
.sq-stl-signup__input:disabled { opacity: .6; }
.sq-stl-signup__opt { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: ${T.cool}; margin-bottom: 10px; cursor: pointer; }
.sq-stl-signup__opt input { accent-color: #8B5CF6; }
.sq-stl-signup__btns { display: flex; gap: 8px; }
.sq-stl-signup--done { padding: 10px 14px; font-size: 12.5px; color: ${T.muted}; background: rgba(139,92,246,.08); border: 1px solid ${T.border}; border-radius: 12px; }

/* OI-8: OTP verify step */
.sq-stl-verify { align-self: stretch; padding: 14px; background: rgba(139,92,246,.08); border: 1px solid ${T.borderAcc}; border-radius: 14px; margin-top: 6px; }
.sq-stl-verify-msg { font-size: 12.5px; color: ${T.cool}; margin: 0 0 10px; }
.sq-stl-verify-input {
  background: ${T.surface}; color: ${T.text}; border: 1px solid ${T.border};
  border-radius: 10px; padding: 9px 12px; font-size: 20px; letter-spacing: 6px;
  font-family: inherit; outline: none; width: 100%; text-align: center; margin-bottom: 8px;
  transition: border-color .15s;
}
.sq-stl-verify-input:focus { border-color: ${T.borderAcc}; }
.sq-stl-verify-btn { width: 100%; padding: 9px 12px; border-radius: 999px; border: 0; cursor: pointer; font-size: 12.5px; font-weight: 600; font-family: inherit; background: ${T.grad}; color: ${T.text}; }

/* Social proof chip (OI-24) */
.sq-stl-social { font-size: 10px; letter-spacing: 1.6px; text-transform: uppercase; color: ${T.cool}; text-align: center; padding: 4px 0 0; opacity: 0.65; }

/* Combo vote micro-actions (OI-23) */
.sq-stl-combo-votes { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
.sq-stl-vote { background: none; border: 1px solid ${T.border}; border-radius: 20px; padding: 3px 10px; font-size: 11px; color: ${T.cool}; cursor: pointer; transition: all 0.15s; }
.sq-stl-vote:hover, .sq-stl-vote.active { background: ${T.surface}; color: ${T.fg}; border-color: ${T.fg}; }
.sq-stl-vote-up.active { color: #6EE7B7; border-color: #6EE7B7; }
.sq-stl-vote-dn.active { color: #94A3B8; border-color: #94A3B8; }

/* D40 — combo try-on + add-all CTA buttons */
.sq-stl-combo-actions { display: flex; gap: 8px; margin-top: 10px; }
.sq-stl-combo-tryon {
  flex: 1; padding: 8px 12px; border-radius: 999px; border: 1px solid ${T.borderAcc};
  background: rgba(139,92,246,.10); color: ${T.muted}; font-size: 11.5px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: filter .15s, transform .15s;
}
.sq-stl-combo-tryon:hover { filter: brightness(1.12); transform: translateY(-1px); }
.sq-stl-combo-add-all {
  flex: 1; padding: 8px 12px; border-radius: 999px; border: 0;
  background: ${T.grad}; color: ${T.text}; font-size: 11.5px; font-weight: 600;
  font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 12px rgba(139,92,246,.30), inset 0 1px 0 rgba(255,255,255,.15);
  transition: filter .15s, transform .15s;
}
.sq-stl-combo-add-all:hover { filter: brightness(1.08); transform: translateY(-1px); }
.sq-stl-combo-add-all:disabled, .sq-stl-combo-tryon:disabled { opacity: .5; cursor: not-allowed; transform: none; }

/* Compose */
.sq-stl-compose {
  display: flex; gap: 8px; padding: 12px; border-top: 1px solid ${T.border};
  background: linear-gradient(0deg, ${T.bg} 0%, rgba(8,7,10,.6) 100%);
  /* iOS safe-area: keeps compose above the home indicator on notched iPhones. */
  padding-bottom: max(12px, env(safe-area-inset-bottom, 12px));
}
.sq-stl-input {
  flex: 1; padding: 11px 14px; border-radius: 999px;
  background: ${T.surface}; color: ${T.text}; border: 1px solid ${T.border};
  font-size: 13.5px; outline: none; transition: border-color .15s;
}
.sq-stl-input:focus { border-color: ${T.borderAcc}; }
.sq-stl-input:disabled { opacity: .6; }
.sq-stl-send {
  width: 40px; height: 40px; border-radius: 50%; border: 0; cursor: pointer;
  background: ${T.grad}; color: ${T.text}; font-size: 18px;
  box-shadow: 0 6px 14px rgba(139,92,246,.35);
}
.sq-stl-send:disabled { opacity: .4; cursor: not-allowed; }

/* Toast */
.sq-stl-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  z-index: 100000; padding: 10px 16px; border-radius: 999px;
  background: ${T.bg}; color: ${T.text}; border: 1px solid ${T.borderAcc};
  font-size: 12.5px; box-shadow: 0 10px 30px rgba(0,0,0,.5);
  opacity: 0; transition: opacity .25s ease;
}
.sq-stl-toast[data-show="true"] { opacity: 1; }

/* ─── Expanded split-pane dock (VTO canvas on the right) ─────────────────── */

/* Base dock (unchanged defaults — expanded state is additive). */

/* Expanded: desktop splits into grid. */
@media (min-width: 900px) {
  .sq-stl-dock.sq-expanded {
    width: min(720px, 90vw);
    display: grid;
    grid-template-columns: 1fr 1.6fr;
    transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity .25s ease, transform .4s ${T.spring};
    overflow: visible;
  }
  /* Chat pane — left column: contains glow, head, scroll, pending, social, compose. */
  .sq-stl-pane-chat {
    display: contents; /* chat children keep their existing layout positions */
  }
  /* Canvas pane — right column: border-left, rounded top-right only. */
  .sq-stl-pane-canvas {
    display: flex; flex-direction: column; overflow: hidden;
    border-left: 1px solid ${T.border};
    border-radius: 0 22px 22px 0;
    background: linear-gradient(160deg, #1A1426 0%, ${T.bg} 100%);
    min-height: 0;
  }
}

/* Mobile: expanded dock goes full-screen; canvas stacks below chat thread. */
@media (max-width: 899px) {
  .sq-stl-dock.sq-expanded {
    height: 100vh; max-height: 100vh;
    border-radius: 0;
    display: flex; flex-direction: column;
    transition: opacity .25s ease, transform .4s ${T.spring};
  }
  .sq-stl-pane-canvas {
    flex-shrink: 0;
    border-top: 1px solid ${T.border};
    background: linear-gradient(160deg, #1A1426 0%, ${T.bg} 100%);
    max-height: 55vh;
    overflow-y: auto;
  }
}

/* Canvas header */
.sq-stl-canvas-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid ${T.border};
  flex-shrink: 0;
}
.sq-stl-canvas-title {
  font-family: "Instrument Serif", Georgia, serif;
  font-size: 15px; font-weight: 400; color: ${T.text};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: calc(100% - 40px);
}
.sq-stl-canvas-close {
  background: transparent; border: 0; color: ${T.cool}; cursor: pointer;
  font-size: 20px; line-height: 1; padding: 4px 8px; border-radius: 999px;
  flex-shrink: 0;
}
.sq-stl-canvas-close:hover { color: ${T.text}; background: rgba(255,255,255,.06); }

/* Canvas body — the VTO render area */
.sq-stl-canvas-body {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
}

/* Muse chip grid */
.sq-stl-muse-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
}
.sq-muse-chip {
  all: unset; cursor: pointer; display: flex; flex-direction: column;
  align-items: center; gap: 4px; padding: 6px 4px; border-radius: 10px;
  border: 1px solid ${T.border};
  transition: border-color .15s, background .15s;
}
.sq-muse-chip:hover { background: rgba(255,255,255,.04); border-color: ${T.borderAcc}; }
.sq-muse-chip[aria-pressed="true"] {
  background: rgba(139,92,246,.12); border-color: ${T.borderAcc};
  box-shadow: 0 0 0 1px rgba(139,92,246,.25);
}
.sq-muse-chip img {
  width: 40px; height: 40px; border-radius: 50%; object-fit: cover;
  border: 1px solid ${T.border};
}
.sq-muse-chip span {
  font-size: 9px; letter-spacing: .5px; text-transform: uppercase;
  color: ${T.cool}; text-align: center; line-height: 1.2;
}

/* VTO render area inside canvas pane */
.sq-stl-vto-render {
  position: relative; border-radius: 12px; overflow: hidden;
  background: #1A1A1A; min-height: 200px;
  display: flex; align-items: center; justify-content: center;
}
.sq-stl-vto-img {
  width: 100%; height: 100%; object-fit: cover; border-radius: 12px;
  display: block;
  filter: drop-shadow(0 12px 32px rgba(0,0,0,.22));
  transition: filter .3s ease, transform .3s ease;
  transform-style: preserve-3d;
  will-change: transform;
}
.sq-stl-vto-img:hover {
  filter: drop-shadow(0 16px 40px rgba(0,0,0,.28));
}
.sq-stl-vto-skeleton {
  width: 100%; aspect-ratio: 3/4; border-radius: 12px;
  background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
  background-size: 200% 100%;
  animation: sq-shimmer-inner 1.4s ease-in-out infinite;
}
@keyframes sq-shimmer-inner {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ─── Combo image thumbnails (Part 1c) ───────────────────────────────────── */
.sq-combo-images {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.sq-combo-images::-webkit-scrollbar { display: none; }
.sq-combo-thumb {
  width: 72px;
  height: 90px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
  background: #2a2a2a;
}

/* "See it on me" + "Add all" CTAs in canvas pane */
.sq-stl-canvas-ctas {
  display: flex; flex-direction: column; gap: 8px; margin-top: 8px;
}
.sq-stl-vto-me-btn {
  padding: 11px 14px; border-radius: 999px; border: 1px solid ${T.borderAcc};
  background: rgba(139,92,246,.10); color: ${T.muted}; font-size: 12px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: filter .15s, transform .15s; text-align: center;
}
.sq-stl-vto-me-btn:hover { filter: brightness(1.12); transform: translateY(-1px); }
.sq-stl-vto-add-all {
  padding: 11px 14px; border-radius: 999px; border: 0;
  background: ${T.grad}; color: ${T.text}; font-size: 12px; font-weight: 600;
  font-family: inherit; cursor: pointer; text-align: center;
  box-shadow: 0 4px 12px rgba(139,92,246,.30), inset 0 1px 0 rgba(255,255,255,.15);
  transition: filter .15s, transform .15s;
}
.sq-stl-vto-add-all:hover { filter: brightness(1.08); transform: translateY(-1px); }
.sq-stl-vto-add-all:disabled, .sq-stl-vto-me-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }

/* ─── VTO Popup — compact floating overlay above the Mira dock ─────────── */
.sq-vto-popup {
  position: fixed;
  bottom: calc(var(--sq-dock-height, 80px) + 16px);
  right: 20px;
  width: 380px;
  height: 520px;
  background: ${T.bg};
  border: 1px solid ${T.border};
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0,0,0,.35), 0 0 0 1px rgba(139,92,246,.08), 0 0 32px rgba(139,92,246,.10);
  z-index: 100002;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sq-popup-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes sq-popup-in {
  from { opacity: 0; transform: translateY(20px) scale(0.95); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}
@media (max-width: 768px) {
  .sq-vto-popup {
    width: 100%;
    right: 0;
    bottom: 0;
    border-radius: 16px 16px 0 0;
    height: 85vh;
  }
}
.sq-vto-popup__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 10px; border-bottom: 1px solid ${T.border}; flex-shrink: 0;
}
.sq-vto-popup__title {
  font-family: "Instrument Serif", Georgia, serif;
  font-size: 15px; font-weight: 400; color: ${T.text};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: calc(100% - 40px);
}
.sq-vto-popup__close {
  background: transparent; border: 0; color: ${T.cool}; cursor: pointer;
  font-size: 20px; line-height: 1; padding: 4px 8px; border-radius: 999px; flex-shrink: 0;
}
.sq-vto-popup__close:hover { color: ${T.text}; background: rgba(255,255,255,.06); }
.sq-vto-popup__body {
  flex: 1; overflow-y: auto; padding: 14px;
  display: flex; flex-direction: column; gap: 12px;
}
.sq-vto-popup__muse-label {
  font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: ${T.cool};
}
.sq-vto-popup__muse-row {
  display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px;
  scrollbar-width: none;
}
.sq-vto-popup__muse-row::-webkit-scrollbar { display: none; }
.sq-vto-popup__muse-chip {
  all: unset; cursor: pointer; flex-shrink: 0;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 5px 6px; border-radius: 10px; border: 1px solid ${T.border};
  transition: border-color .15s, background .15s;
}
.sq-vto-popup__muse-chip:hover { background: rgba(255,255,255,.04); border-color: ${T.borderAcc}; }
.sq-vto-popup__muse-chip[aria-pressed="true"] {
  background: rgba(139,92,246,.12); border-color: ${T.borderAcc};
  box-shadow: 0 0 0 1px rgba(139,92,246,.25);
}
.sq-vto-popup__muse-chip img {
  width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 1px solid ${T.border};
}
.sq-vto-popup__muse-chip span {
  font-size: 8px; letter-spacing: .4px; text-transform: uppercase;
  color: ${T.cool}; text-align: center; line-height: 1.15;
}
.sq-vto-popup__render-area {
  position: relative; border-radius: 12px; overflow: hidden;
  background: #1A1A1A; flex: 1; min-height: 160px;
  display: flex; align-items: center; justify-content: center;
}
.sq-vto-popup__render-img {
  width: 100%; height: 100%; object-fit: cover; border-radius: 12px;
  display: block;
  filter: drop-shadow(0 10px 28px rgba(0,0,0,.22));
  transition: filter .3s ease, transform .3s ease;
  transform-style: preserve-3d; will-change: transform;
}
.sq-vto-popup__render-img:hover { filter: drop-shadow(0 14px 36px rgba(0,0,0,.28)); }
.sq-vto-popup__skeleton {
  width: 100%; aspect-ratio: 3/4; border-radius: 12px;
  background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
  background-size: 200% 100%;
  animation: sq-shimmer-popup 1.4s ease-in-out infinite;
}
@keyframes sq-shimmer-popup {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.sq-vto-popup__render-empty {
  padding: 20px 14px; text-align: center; font-size: 12px; color: ${T.cool};
}
.sq-vto-popup__footer {
  padding: 10px 14px 14px; border-top: 1px solid ${T.border};
  display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;
}
.sq-vto-popup__render-btn {
  width: 100%; padding: 10px 14px; border-radius: 999px; border: 0;
  background: ${T.grad}; color: ${T.text}; font-size: 12.5px; font-weight: 600;
  font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 12px rgba(139,92,246,.30), inset 0 1px 0 rgba(255,255,255,.15);
  transition: filter .15s, transform .15s;
}
.sq-vto-popup__render-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
.sq-vto-popup__render-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.sq-vto-popup__full-link {
  text-align: center; font-size: 11px; color: ${T.cool}; cursor: pointer;
  background: none; border: 0; font-family: inherit; padding: 2px;
  text-decoration: underline; text-underline-offset: 2px; transition: color .15s;
}
.sq-vto-popup__full-link:hover { color: ${T.text}; }

/* ─── VTO Tabs (model / upload) ───────────────────────────────────────── */
.sq-vto-tabs {
  display: flex;
  border-bottom: 1px solid ${T.border};
  background: rgba(255,255,255,.03);
  flex-shrink: 0;
}
.sq-vto-tab {
  flex: 1; padding: 10px; font-size: 13px; font-weight: 500;
  text-align: center; cursor: pointer; border: none;
  background: transparent; color: #888; transition: color .2s;
  font-family: inherit;
  border-bottom: 2px solid transparent;
}
.sq-vto-tab.active { color: ${T.text}; border-bottom-color: ${T.text}; }
.sq-vto-tab:hover:not(.active) { color: ${T.cool}; }

/* Upload drop zone */
.sq-vto-drop-zone {
  border: 2px dashed ${T.border}; border-radius: 12px;
  padding: 28px 16px; text-align: center; cursor: pointer;
  transition: border-color .2s, background .2s;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.sq-vto-drop-zone:hover, .sq-vto-drop-zone.drag-over {
  border-color: ${T.borderAcc}; background: rgba(139,92,246,.06);
}
.sq-vto-drop-icon { font-size: 28px; line-height: 1; }
.sq-vto-drop-label { font-size: 13px; color: ${T.text}; font-weight: 500; }
.sq-vto-drop-sub { font-size: 11px; color: ${T.cool}; }
.sq-vto-drop-privacy {
  font-size: 10px; color: ${T.cool}; opacity: 0.7;
  line-height: 1.4; margin-top: 4px;
}
.sq-vto-photo-preview { width: 100%; border-radius: 10px; object-fit: cover; max-height: 180px; display: block; }

/* ─── Walkthrough bar ─────────────────────────────────────────────────── */
.sq-walkthrough-bar {
  background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
  color: white;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.sq-walkthrough-progress { display: flex; gap: 4px; align-items: center; }
.sq-walkthrough-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(255,255,255,0.3);
  transition: background .2s;
}
.sq-walkthrough-dot.active { background: white; }
.sq-walkthrough-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 8px; }
.sq-walkthrough-skip {
  background: none; border: none; color: rgba(255,255,255,.5);
  cursor: pointer; font-size: 13px; padding: 0 4px; font-family: inherit;
  flex-shrink: 0;
}
.sq-walkthrough-skip:hover { color: white; }

/* Walkthrough step card */
.sq-walkthrough-step {
  background: ${T.surface}; border: 1px solid ${T.border}; border-radius: 14px;
  padding: 14px; display: flex; flex-direction: column; gap: 10px;
  align-self: stretch;
}
.sq-walkthrough-step__img {
  width: 100%; height: 180px; object-fit: cover; border-radius: 10px;
  background: #222; display: block;
}
.sq-walkthrough-step__img-placeholder {
  width: 100%; height: 180px; background: #222; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; font-size: 32px;
}
.sq-walkthrough-step__title { font-size: 15px; font-weight: 600; color: ${T.text}; }
.sq-walkthrough-step__why {
  font-size: 12.5px; color: ${T.cool}; line-height: 1.5;
  background: rgba(139,92,246,.08); border: 1px solid ${T.borderAcc};
  border-radius: 10px; padding: 8px 12px;
}
.sq-walkthrough-next {
  padding: 10px 16px; border-radius: 999px; border: 0;
  background: ${T.grad}; color: ${T.text}; font-size: 12.5px; font-weight: 600;
  font-family: inherit; cursor: pointer; text-align: center;
  box-shadow: 0 4px 12px rgba(139,92,246,.30);
  transition: filter .15s, transform .15s;
}
.sq-walkthrough-next:hover { filter: brightness(1.08); transform: translateY(-1px); }

/* Walkthrough summary */
.sq-walkthrough-summary {
  background: ${T.surface}; border: 1px solid ${T.borderAcc}; border-radius: 14px;
  padding: 14px; align-self: stretch;
}
.sq-walkthrough-summary__title {
  font-family: "Instrument Serif", Georgia, serif; font-size: 16px;
  margin: 0 0 10px; color: ${T.text};
}
.sq-walkthrough-summary__grid {
  display: flex; gap: 8px; margin-bottom: 12px; overflow-x: auto;
  scrollbar-width: none;
}
.sq-walkthrough-summary__grid::-webkit-scrollbar { display: none; }
.sq-walkthrough-summary__thumb {
  width: 72px; height: 90px; object-fit: cover; border-radius: 8px;
  flex-shrink: 0; background: #222;
}
.sq-walkthrough-summary__actions { display: flex; flex-direction: column; gap: 8px; }

/* ─── Size recommendation card ──────────────────────────────────────── */
.sq-size-rec-card {
  background: ${T.surface}; border: 1px solid ${T.borderAcc};
  border-radius: 14px; padding: 14px; align-self: stretch;
  display: flex; flex-direction: column; gap: 10px;
}
.sq-size-rec-card__title { font-size: 13px; color: ${T.cool}; }
.sq-size-rec-badge {
  display: flex; align-items: center; gap: 10px;
}
.sq-size-rec-badge__size {
  font-family: "Instrument Serif", Georgia, serif; font-size: 36px; font-weight: 400;
  color: ${T.text}; line-height: 1;
}
.sq-size-rec-badge__label {
  font-size: 12px; color: ${T.muted}; font-weight: 500;
  letter-spacing: .3px;
}
.sq-size-rec-confidence {
  display: flex; gap: 3px; align-items: center;
}
.sq-size-rec-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: rgba(255,255,255,.2);
  transition: background .2s;
}
.sq-size-rec-dot.filled { background: ${T.electric}; }
.sq-size-rec-trust {
  font-size: 11.5px; color: ${T.cool}; line-height: 1.4;
}
.sq-size-rec-alts { display: flex; gap: 6px; flex-wrap: wrap; }
.sq-size-rec-alt {
  padding: 5px 12px; border-radius: 999px;
  border: 1px solid ${T.border}; background: transparent;
  color: ${T.cool}; font-size: 12px; font-family: inherit;
  cursor: pointer; transition: all .15s;
}
.sq-size-rec-alt:hover, .sq-size-rec-alt.selected {
  border-color: ${T.borderAcc}; color: ${T.text};
  background: rgba(139,92,246,.10);
}
.sq-size-rec-actions { display: flex; gap: 8px; }

/* ─── Fit collection form (inline) ──────────────────────────────────── */
.sq-fit-collect-card {
  background: rgba(139,92,246,.08); border: 1px solid ${T.borderAcc};
  border-radius: 14px; padding: 14px; align-self: stretch;
}
.sq-fit-collect-card__title {
  font-size: 14px; font-weight: 600; color: ${T.text}; margin-bottom: 4px;
}
.sq-fit-collect-card__sub {
  font-size: 11.5px; color: ${T.cool}; margin-bottom: 12px; line-height: 1.4;
}
.sq-fit-collect-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;
}
.sq-fit-collect-input {
  background: ${T.surface}; color: ${T.text}; border: 1px solid ${T.border};
  border-radius: 10px; padding: 9px 12px; font-size: 13px;
  font-family: inherit; outline: none; transition: border-color .15s;
}
.sq-fit-collect-input:focus { border-color: ${T.borderAcc}; }
.sq-fit-collect-label {
  font-size: 11px; color: ${T.cool}; margin-bottom: 4px; display: block;
}
.sq-fit-collect-prefs {
  display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;
}
.sq-fit-collect-pref {
  padding: 5px 12px; border-radius: 999px; border: 1px solid ${T.border};
  background: transparent; color: ${T.cool}; font-size: 12px; font-family: inherit;
  cursor: pointer; transition: all .15s;
}
.sq-fit-collect-pref:hover, .sq-fit-collect-pref.selected {
  border-color: ${T.borderAcc}; color: ${T.text}; background: rgba(139,92,246,.10);
}

/* ─── PDP highlight annotation (injected into main doc, outside shadow) ─ */
/* Declared here for reference only — actual styles injected into document.head */

/* ─── Cart summary bottom sheet ──────────────────────────────────────── */
/* Injected into document.body (outside shadow), similar to product preview card */
`;

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]!);

// ─── Muse definitions (12 muses: 4 shapes × 3 skin tones) ───────────────
// Images served from VERTEX_MUSE_BASE_URL or Unsplash CC0 placeholders.
const MUSES = [
  { id: "petite-light",   label: "Petite",   shape: "petite",  skin: "light",  imgUrl: "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=80&h=80&fit=crop&crop=face" },
  { id: "petite-medium",  label: "Petite",   shape: "petite",  skin: "medium", imgUrl: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=80&h=80&fit=crop&crop=face" },
  { id: "petite-deep",    label: "Petite",   shape: "petite",  skin: "deep",   imgUrl: "https://images.unsplash.com/photo-1588702547923-7093a6c3ba33?w=80&h=80&fit=crop&crop=face" },
  { id: "average-light",  label: "Average",  shape: "average", skin: "light",  imgUrl: "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=80&h=80&fit=crop&crop=face" },
  { id: "average-medium", label: "Average",  shape: "average", skin: "medium", imgUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=face" },
  { id: "average-deep",   label: "Average",  shape: "average", skin: "deep",   imgUrl: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=80&h=80&fit=crop&crop=face" },
  { id: "curvy-light",    label: "Curvy",    shape: "curvy",   skin: "light",  imgUrl: "https://images.unsplash.com/photo-1548142813-c348350df52b?w=80&h=80&fit=crop&crop=face" },
  { id: "curvy-medium",   label: "Curvy",    shape: "curvy",   skin: "medium", imgUrl: "https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=80&h=80&fit=crop&crop=face" },
  { id: "curvy-deep",     label: "Curvy",    shape: "curvy",   skin: "deep",   imgUrl: "https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=80&h=80&fit=crop&crop=face" },
  { id: "tall-light",     label: "Tall",     shape: "tall",    skin: "light",  imgUrl: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=80&h=80&fit=crop&crop=face" },
  { id: "tall-medium",    label: "Tall",     shape: "tall",    skin: "medium", imgUrl: "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=80&h=80&fit=crop&crop=face" },
  { id: "tall-deep",      label: "Tall",     shape: "tall",    skin: "deep",   imgUrl: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=80&h=80&fit=crop&crop=face" },
] as const;
type MuseDef = typeof MUSES[number];

// ─── Custom element ─────────────────────────────────────────────────────
// ─── Cross-surface trigger coordinator ────────────────────────────────
// The Widget and the Stylist both want to react to shopper intent. Without
// a referee, they'd double-fire on signals like "shopper paused on a PDP".
//
// Hard semantic split:
//   • WIDGET owns PRODUCT-SPECIFIC intent — size-chart hover, image zoom,
//     add-to-cart hesitation. "This product, this shopper, fit me."
//   • STYLIST owns DISCOVERY + DECISION intent — collection scroll, multi-
//     item compare, exit-intent on a non-PDP, return visit, vague intent
//     ("Saturday outfit"). "I don't know what I want yet."
//
// The arbiter sits in this module and routes the `stylique:intent` event to
// the right surface. Both bundles listen for it, but only one (or neither)
// surfaces a UI. Hard ceiling of 2 fires per session.

type IntentKind =
  | "pdp.size_hover"          // → widget
  | "pdp.image_zoom"          // → widget
  | "pdp.dwell_30s"           // → widget
  | "pdp.dwell_45s"           // → widget (GROWTH+: dwell without add-to-cart)
  | "collection.scroll"       // → stylist
  | "collection.exit_scroll"  // → stylist (ULTIMATE: back-scroll from >50% depth after 30s)
  | "multi_item_compare"      // → stylist
  | "exit_intent"             // → stylist (non-PDP) / widget (PDP)
  | "return_visit"            // → stylist
  | "return_visit_24h"        // → stylist (STARTER+: sq_shopper_id cookie + >24h since last visit)
  | "search_no_results";      // → stylist

type IntentDetail = { kind: IntentKind; productHandle?: string };
type SurfaceOwner = "widget" | "stylist" | "none";

const INTENT_OWNER: Record<IntentKind, SurfaceOwner> = {
  "pdp.size_hover":          "widget",
  "pdp.image_zoom":          "widget",
  "pdp.dwell_30s":           "widget",
  "pdp.dwell_45s":           "widget",
  "collection.scroll":       "stylist",
  "collection.exit_scroll":  "stylist",
  "multi_item_compare":      "stylist",
  "exit_intent":             "none",     // resolved at runtime (PDP → widget else stylist)
  "return_visit":            "stylist",
  "return_visit_24h":        "stylist",
  "search_no_results":       "stylist",
};

const SESSION_TRIGGER_CAP = 2;
const TRIGGER_STORAGE_KEY = "stylique:trigger-count";
const SUPPRESS_STORAGE_KEY = "stylique:trigger-suppress";   // shopper dismissed → never again

function triggerCount(): number {
  try { return Number(sessionStorage.getItem(TRIGGER_STORAGE_KEY) ?? "0") || 0; }
  catch { return 0; }
}
function bumpTriggerCount(): void {
  try { sessionStorage.setItem(TRIGGER_STORAGE_KEY, String(triggerCount() + 1)); }
  catch { /* private mode */ }
}
function isSuppressed(): boolean {
  try { return localStorage.getItem(SUPPRESS_STORAGE_KEY) === "1"; }
  catch { return false; }
}

/**
 * Both surfaces call this when they detect an intent signal. The arbiter
 * decides who handles it (or nobody) and dispatches a `stylique:trigger-fire`
 * event with the owning surface tagged. Idempotent: same kind within 30s
 * is dropped to avoid trigger-spam.
 */
const recentFires = new Map<string, number>();
function fireIntent(detail: IntentDetail): void {
  if (isSuppressed()) return;
  if (triggerCount() >= SESSION_TRIGGER_CAP) return;
  const now = Date.now();
  const last = recentFires.get(detail.kind) ?? 0;
  if (now - last < 30_000) return;
  recentFires.set(detail.kind, now);

  let owner = INTENT_OWNER[detail.kind];
  if (owner === "none") {
    // exit_intent: PDP = widget, else stylist.
    owner = /\/products\//.test(location.pathname) ? "widget" : "stylist";
  }
  bumpTriggerCount();
  document.dispatchEvent(new CustomEvent("stylique:trigger-fire", {
    detail: { ...detail, owner },
  }));
}

// Expose on window so the (separately bundled) widget can call into the same
// arbiter. The widget can fire its own intents the same way.
(window as unknown as { __styliqueArbiter?: typeof fireIntent }).__styliqueArbiter = fireIntent;

// Read a File into a data URL string. Returns "" on failure.
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : "");
    fr.onerror = () => reject(fr.error ?? new Error("read_failed"));
    fr.readAsDataURL(file);
  });
}

// ─── SSE parser ──────────────────────────────────────────────────────────────
// Yields one parsed JSON object per `data: {...}` SSE line.
async function* parseSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (dataLine) {
        try {
          yield JSON.parse(dataLine.slice(6));
        } catch {
          /* skip malformed lines */
        }
      }
    }
  }
}

// Default Mira portrait — the full-figure editorial avatar, served by the app
// (Railway). Brands can override per-shop via me.stylist.avatarUrl. Matches the
// demo store's standing-avatar launcher so the live store reads identically.
const DEFAULT_MIRA_AVATAR = "https://stylique-app-production.up.railway.app/mira/avatar.png";

class StyliqueStylist extends HTMLElement {
  private shadow!: ShadowRoot;
  private apiBase = "/apps/stylique";
  private open = false;
  private me: ShopperMe | null = null;
  private openedAt = 0;
  // Pending image staged for the next send. Survives re-renders.
  private pendingImage: string | null = null;
  private state: {
    messages: ChatMsg[];
    sending: boolean;
    socialProof: string | null;
    walkthrough: { steps: WalkthroughStep[]; currentIndex: number; comboName: string } | null;
    pendingArrivalFocus: string | null;
  } = { messages: [], sending: false, socialProof: null, walkthrough: null, pendingArrivalFocus: null };

  // VTO canvas pane state (split-pane when dock is expanded)
  private vtoState: {
    open: boolean;
    productIds: string[];
    comboName: string;
    selectedMuseId: string;
    renderImage: string | null;
    renderPending: boolean;
    renderError: string | null;
    /** Which tab is active: "model" (muse grid) or "photo" (upload). */
    activeTab: "model" | "photo";
    /** Data URL for the uploaded selfie — pass-through only, never persisted. */
    photoDataUrl: string | null;
    /** Display name for the photo thumbnail. */
    photoFileName: string | null;
  } = {
    open: false,
    productIds: [],
    comboName: "",
    selectedMuseId: "average-medium",
    renderImage: null,
    renderPending: false,
    renderError: null,
    activeTab: "model",
    photoDataUrl: null,
    photoFileName: null,
  };

  // ─── Intent engine + proactive coordinator ─────────────────────────────
  // Initialized lazily on requestIdleCallback (or setTimeout 100ms fallback)
  // so they never block the critical path.
  private intentEngine: IntentEngine | null = null;
  private proactiveCoordinator: ProactiveCoordinator | null = null;

  /** AbortController used to remove all document/window-level listeners on disconnect. */
  private _listenerAbort: AbortController | null = null;

  /** Stored IntersectionObserver for combo dwell so it can be disconnected before recreation. */
  private _comboObserver: IntersectionObserver | null = null;

  // Fire-and-forget analytics. Same shape as the widget's track helper so the
  // backend dedupes / aggregates uniformly. Failures are swallowed.
  private track(name: string, payload: Record<string, unknown>, productId?: string) {
    void fetch(`${this.apiBase}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, productId, payload }),
      credentials: "include", keepalive: true,
    }).catch(() => undefined);
  }

  // Shopify customer id (when logged in on the storefront). Forwarded to the
  // backend so we can link the cookie-based ShopperSession to the actual
  // Shopify customer for cross-device continuity.
  private shopifyCustomerId: string | null = null;

  connectedCallback() {
    this.apiBase = this.getAttribute("data-api-base") || "/apps/stylique";
    this.shopifyCustomerId = this.getAttribute("data-shopify-customer-id") || null;
    this.shadow = this.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `<style>${STL_CSS}</style><div id="root"></div>`;

    // On PDPs the widget already lives bottom-right (entry card + chip).
    // Flip ourselves to bottom-left so we never overlap. Re-check after a
    // short delay in case the widget mounts after us.
    const decideCorner = () => {
      if (document.querySelector("stylique-widget")) this.setAttribute("data-corner", "left");
      else this.removeAttribute("data-corner");
    };
    decideCorner();
    setTimeout(decideCorner, 400);

    this.renderClosed();

    // Create a single AbortController for all document/window-level listeners
    // so that disconnectedCallback can tear them all down with one abort() call.
    this._listenerAbort = new AbortController();
    const { signal } = this._listenerAbort;

    // Hydrate the soft-account state from /api/shopper/me so the dock header
    // can greet a returning shopper by name.
    void this.hydrateMe();

    // Cross-surface coordination: if the 3-step widget opens, close this dock.
    // Both surfaces live inside the same Shopify app and share the App Proxy
    // for permissions — they just shouldn't visually fight each other.
    document.addEventListener("stylique:surface-open", (e) => {
      const ce = e as CustomEvent<{ source: string }>;
      if (ce.detail?.source !== "stylist" && this.open) this.toggle(false);
    }, { signal });

    // If the widget claimed an account during this page life, refresh here too.
    document.addEventListener("stylique:account-claimed", (e) => {
      const ce = e as CustomEvent<{ displayName: string | null }>;
      this.me = { accountClaimed: true, displayName: ce.detail?.displayName ?? null, emailMasked: null };
      if (this.open) this.renderOpen();
    }, { signal });

    // PDP-inline entry — Liquid renders an "Ask the stylist" button under
    // the price; clicking dispatches stylique:open-stylist with productHandle.
    document.addEventListener("stylique:open-stylist", (e) => {
      const ce = e as CustomEvent<{ reason?: string; productHandle?: string }>;
      this.triggerOpenerKind = "pdp_inline";
      if (!this.open) this.toggle(true);
      this.track("CHAT_OPENED", { surface: "pdp_inline", productHandle: ce.detail?.productHandle });
    }, { signal });

    // Intent triggers — react when the arbiter routes one to us. Open the
    // dock with a context-appropriate opener line.
    document.addEventListener("stylique:trigger-fire", (e) => {
      const ce = e as CustomEvent<{ kind: string; owner: string; productHandle?: string }>;
      if (ce.detail?.owner !== "stylist") return;
      if (this.open) return;        // already open — do nothing
      this.triggerOpenerKind = ce.detail.kind;
      this.toggle(true);
    }, { signal });

    // Listen for proactive trigger events dispatched by ProactiveCoordinator.
    document.addEventListener("stylique:proactive-trigger", (e) => {
      const ce = e as CustomEvent<{ message: string; triggerId: string; intentContext: IntentContext }>;
      if (!ce.detail) return;
      const trigger: ProactiveTrigger = {
        id: ce.detail.triggerId,
        message: ce.detail.message,
        intentRequired: "BROWSING",   // already evaluated before dispatch
        confidenceRequired: 0,
        maxPerSession: 1,
        cooldownMs: 0,
      };
      this.handleProactiveTrigger(trigger, ce.detail.intentContext);
    }, { signal });

    // Initialize the intent engine + proactive coordinator lazily so they
    // never block the critical rendering path.
    const initIntent = () => {
      try {
        this.intentEngine = new IntentEngine();
        this.proactiveCoordinator = new ProactiveCoordinator(
          this.intentEngine,
          (trigger, context) => {
            // Dispatch the event — the listener above handles it.
            dispatchProactiveTrigger(trigger, context);
          },
        );
        this.wireIntentSignals();
      } catch { /* intent engine init failure is non-fatal */ }
    };

    if (typeof (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback === "function") {
      (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(initIntent);
    } else {
      setTimeout(initIntent, 100);
    }

    // Keep the old wire for legacy cross-surface arbiter signals (return_visit_24h,
    // collection.exit_scroll, pdp.dwell_45s, exit_intent, collection.scroll).
    this.wireIntentEmitters();
  }

  disconnectedCallback() {
    // Abort all document/window-level event listeners registered in connectedCallback
    // and wireIntentEmitters so the element leaves no trace after removal.
    this._listenerAbort?.abort();
    this._listenerAbort = null;
    // Disconnect combo dwell observer.
    if (this._comboObserver) {
      this._comboObserver.disconnect();
      this._comboObserver = null;
    }
    // Dismiss any pending product preview card.
    if (this._previewCard) {
      clearTimeout(this._previewCard.timer);
      this._previewCard.el.remove();
      this._previewCard = null;
    }
  }

  private triggerOpenerKind: string | null = null;

  // Helper: read the sq_shopper_id cookie value (set by the proxy on first visit).
  private readShopperId(): string | null {
    try {
      const m = document.cookie.match(/(?:^|;\s*)sq_shopper_id=([^;]+)/);
      return m ? decodeURIComponent(m[1]!) : null;
    } catch { return null; }
  }

  // Helper: load entitlements from window cache or /api/entitlement, return
  // proactiveTriggers flag. Falls back to false on error.
  private async loadProactiveEntitlement(): Promise<boolean> {
    const w = window as unknown as {
      __styliqueEntitlements?: { proactiveTriggers?: boolean };
      __styliquePlan?: { proactiveTriggers?: boolean };
    };
    if (w.__styliqueEntitlements?.proactiveTriggers !== undefined) {
      return Boolean(w.__styliqueEntitlements.proactiveTriggers);
    }
    if (w.__styliquePlan?.proactiveTriggers !== undefined) {
      return Boolean(w.__styliquePlan.proactiveTriggers);
    }
    try {
      const res = await fetch(`${this.apiBase}/api/entitlement`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json() as { ok?: boolean; data?: { proactiveTriggers?: boolean } };
        const pt = json?.data?.proactiveTriggers ?? false;
        // Cache on window for this page lifecycle.
        w.__styliqueEntitlements = { ...(w.__styliqueEntitlements ?? {}), proactiveTriggers: pt };
        return pt;
      }
    } catch { /* network error — degrade gracefully */ }
    return false;
  }

  private wireIntentEmitters() {
    const fire = (window as unknown as { __styliqueArbiter?: (d: { kind: string; productHandle?: string }) => void }).__styliqueArbiter;
    if (!fire) return;
    const signal = this._listenerAbort?.signal;

    // ── (1) Return-visit greeting (STARTER+) ───────────────────────────
    // If sq_shopper_id cookie exists AND sq_last_visit was >24h ago, fire
    // after 2s. Uses cookie presence as the lightweight "known shopper" signal
    // so we don't need to wait for hydrateMe to complete.
    const SQ_LAST_VISIT_KEY = "sq_last_visit";
    const MS_24H = 24 * 60 * 60 * 1000;
    const shopperId = this.readShopperId();
    // H-1: hoisted so block (2) can check without re-reading storage.
    let isReturn = false;
    if (shopperId) {
      const lastVisitStr = (() => { try { return localStorage.getItem(SQ_LAST_VISIT_KEY); } catch { return null; } })();
      const lastVisit = lastVisitStr ? Number(lastVisitStr) : 0;
      const now = Date.now();
      isReturn = lastVisit > 0 && now - lastVisit > MS_24H;
      // Always update last-visit timestamp regardless of trigger.
      try { localStorage.setItem(SQ_LAST_VISIT_KEY, String(now)); } catch { /* private mode */ }
      if (isReturn) {
        // STARTER+ gate: proactiveTriggers must be enabled.
        // H-1 fix: return_visit_24h takes precedence over return_visit for the
        // same shopper — firing both simultaneously burns both cap slots (cap=2).
        // We suppress return_visit when return_visit_24h is about to fire.
        setTimeout(() => {
          void this.loadProactiveEntitlement().then((allowed) => {
            if (allowed) fire({ kind: "return_visit_24h" });
            // Even when proactiveEntitlement is false, suppress the cookie-based
            // return_visit so the two triggers never co-fire. The account-based
            // opener below guards its own soft-account check via this.me.
          });
        }, 2000);
        // Do NOT fall through to (2) for returning visitors — skip return_visit.
      } else {
        // Not a 24h return — allow the account-based opener in (2) below.
        // First-visit case handled in the else-branch below.
      }
    } else {
      // First visit — record timestamp for future return detection.
      try { localStorage.setItem(SQ_LAST_VISIT_KEY, String(Date.now())); } catch { /* private mode */ }
    }

    // ── (2) Return visit (existing — soft-account based) ───────────────
    // Fires when hydrateMe has populated this.me (soft-account holder).
    // H-1 fix: `isReturn` captured before the timestamp update in (1).
    // When isReturn is true, return_visit_24h already fired (or will fire after
    // the entitlement check), so skip return_visit to avoid burning 2 cap slots.
    // When isReturn is false (fresh visit or first visit), allow it.
    if (!isReturn) {
      setTimeout(() => {
        if (this.me?.accountClaimed || this.me?.displayName) fire({ kind: "return_visit" });
      }, 800);
    }

    // ── (3) Collection scroll ──────────────────────────────────────────
    if (/\/collections\//.test(location.pathname)) {
      let firedScroll = false;
      window.addEventListener("scroll", () => {
        if (firedScroll) return;
        if (window.scrollY > 800) { firedScroll = true; fire({ kind: "collection.scroll" }); }
      }, { passive: true, signal });

      // ── (4) Exit-intent on collection back-scroll (ULTIMATE) ──────────
      // Fires when: shopper has been on the page 30s+, has scrolled past 50%
      // of document height, then scrolls back up — debounced 500ms.
      const PAGE_LOAD_TIME = Date.now();
      let maxScrollDepth = 0;
      let exitScrollDebounce: ReturnType<typeof setTimeout> | null = null;
      let firedExitScroll = false;
      window.addEventListener("scroll", () => {
        const docH = Math.max(document.body.scrollHeight, 1);
        const depth = (window.scrollY + window.innerHeight) / docH;
        if (depth > maxScrollDepth) maxScrollDepth = depth;

        const scrolledBackUp =
          maxScrollDepth > 0.5 &&
          window.scrollY < (maxScrollDepth * docH - window.innerHeight) * 0.8;

        if (!firedExitScroll && scrolledBackUp && Date.now() - PAGE_LOAD_TIME > 30_000) {
          if (exitScrollDebounce) clearTimeout(exitScrollDebounce);
          exitScrollDebounce = setTimeout(() => {
            if (firedExitScroll) return;
            firedExitScroll = true;
            void this.loadProactiveEntitlement().then((allowed) => {
              if (allowed) fire({ kind: "collection.exit_scroll" });
            });
          }, 500);
        }
      }, { passive: true, signal });
    }

    // ── (5) PDP dwell trigger (GROWTH+) ────────────────────────────────
    // On a PDP: if shopper dwells 45s without clicking Add to Cart, fire.
    if (/\/products\//.test(location.pathname)) {
      let dwellFired = false;
      let atcClicked = false;
      document.addEventListener("click", (e) => {
        const el = e.target as Element | null;
        if (!el) return;
        if (el.closest("[name='add'], [data-action='add-to-cart'], .product-form__submit, #AddToCart, .add-to-cart-button")) {
          atcClicked = true;
        }
      }, { signal });
      setTimeout(() => {
        if (dwellFired || atcClicked) return;
        dwellFired = true;
        void this.loadProactiveEntitlement().then((allowed) => {
          if (allowed && !atcClicked) {
            // pdp.dwell_45s → widget (arbiter routes it there).
            const arb = (window as unknown as { __styliqueArbiter?: (d: { kind: string }) => void }).__styliqueArbiter;
            if (arb) arb({ kind: "pdp.dwell_45s" });
          }
        });
      }, 45_000);
    }

    // ── (6) Exit intent (existing) ─────────────────────────────────────
    let lastY = 0; let lastT = 0;
    document.addEventListener("mousemove", (e) => {
      const now = Date.now();
      const dy = lastY - e.clientY;
      const dt = now - lastT;
      lastY = e.clientY; lastT = now;
      if (e.clientY < 40 && dy > 0 && dt > 0 && dy / dt > 0.2) {
        fire({ kind: "exit_intent" });
      }
    }, { signal });
  }

  // ─── Intent signal wiring ──────────────────────────────────────────────
  // Connects DOM events to IntentEngine.fire(). Called after the engine is
  // initialized on requestIdleCallback — never blocks the critical path.
  // All DOM queries wrapped in try/catch.
  private wireIntentSignals(): void {
    const engine = this.intentEngine;
    const coordinator = this.proactiveCoordinator;
    if (!engine || !coordinator) return;

    const fire = (sig: Parameters<IntentEngine["fire"]>[0]) => {
      try {
        engine.fire(sig);
        coordinator.evaluate();
      } catch { /* never throw from a signal handler */ }
    };

    // ── Dwell timers — 30s and 90s on PDP ─────────────────────────────
    if (/\/products\//.test(location.pathname)) {
      let dwell30Fired = false;
      let dwell90Fired = false;
      let atcClicked = false;

      // Watch for ATC (so dwell_30s doesn't fire when the shopper has already
      // committed — that would be a false "hesitation" signal).
      const onAtcClick = (e: MouseEvent) => {
        try {
          const el = e.target as Element | null;
          if (el?.closest("[name='add'], [data-action='add-to-cart'], .product-form__submit, #AddToCart, .add-to-cart-button")) {
            atcClicked = true;
            engine.recordAtc();
          }
        } catch { /* ignore */ }
      };
      document.addEventListener("click", onAtcClick);

      // Observe the main product image for sustained visibility.
      try {
        const mainImg = document.querySelector<HTMLElement>(
          ".product__media img, .product-photo-cdn, [data-product-image], .product-featured-image, .product-single__photo img",
        );
        if (mainImg && typeof IntersectionObserver !== "undefined") {
          let entryTs = 0;
          const obs = new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                entryTs = Date.now();
              } else if (entryTs > 0) {
                const elapsed = Date.now() - entryTs;
                if (elapsed >= 30_000 && !dwell30Fired) { dwell30Fired = true; fire("dwell_30s"); }
                if (elapsed >= 90_000 && !dwell90Fired) { dwell90Fired = true; fire("dwell_90s"); }
              }
            }
          }, { threshold: 0.8 });
          obs.observe(mainImg);
        }
      } catch { /* ignore */ }

      // Fallback timers — fire if the shopper is still on the page.
      setTimeout(() => {
        if (!dwell30Fired && !atcClicked) { dwell30Fired = true; fire("dwell_30s"); }
      }, 30_000);
      setTimeout(() => {
        if (!dwell90Fired && !atcClicked) { dwell90Fired = true; fire("dwell_90s"); }
      }, 90_000);
    }

    // ── Click signals ──────────────────────────────────────────────────
    document.addEventListener("click", (e) => {
      try {
        const target = e.target as Element | null;
        if (!target) return;
        // Size guide click.
        if (target.closest('.size-guide, [href*="size"], [href*="guide"], [data-size-chart]')) {
          fire("size_guide_click");
        }
        // Image zoom / gallery click.
        if (target.closest(".product__media, .product-photo-zoom, [data-zoom], .product-single__thumbnail, .fotorama__thumb")) {
          fire("image_zoom");
        }
        // Variant selector (size/color).
        if (target.closest("[data-option], .variant-input, .swatch, .product-form__option")) {
          fire("variant_switch");
        }
      } catch { /* ignore */ }
    });

    // ── Price inspect — hover > 3s ─────────────────────────────────────
    try {
      const priceEl = document.querySelector<HTMLElement>(".price, .product__price, [data-price], .price__regular");
      if (priceEl) {
        let hoverStart = 0;
        let priceFired = false;
        priceEl.addEventListener("mouseenter", () => { hoverStart = Date.now(); }, { passive: true });
        priceEl.addEventListener("mouseleave", () => {
          if (!priceFired && hoverStart > 0 && Date.now() - hoverStart >= 3000) {
            priceFired = true;
            fire("price_inspect");
          }
          hoverStart = 0;
        }, { passive: true });
      }
    } catch { /* ignore */ }

    // ── Scroll signals — batched, passive ─────────────────────────────
    {
      let maxScrollY = 0;
      let lastScrollY = 0;
      let lastScrollDir: "down" | "up" = "down";
      let scrollBackFired = false;
      let scrollDeepFired = false;
      let batchTimer: ReturnType<typeof setTimeout> | null = null;

      const processScroll = () => {
        try {
          const y = window.scrollY;
          const docH = Math.max(document.body.scrollHeight, 1);
          const depth = (y + window.innerHeight) / docH;

          if (y > maxScrollY) maxScrollY = y;
          if (!scrollDeepFired && depth > 0.8) { scrollDeepFired = true; fire("scroll_deep"); }

          const dir = y < lastScrollY ? "up" : "down";
          if (dir === "up" && lastScrollDir === "down" && maxScrollY > window.innerHeight * 0.5) {
            if (!scrollBackFired) { scrollBackFired = true; fire("scroll_back_up"); }
          }
          lastScrollDir = dir;
          lastScrollY = y;
        } catch { /* ignore */ }
      };

      window.addEventListener("scroll", () => {
        if (batchTimer) return;
        batchTimer = setTimeout(() => {
          batchTimer = null;
          processScroll();
        }, 500);
      }, { passive: true });
    }

    // ── Compare back — navigating away from a PDP to return ───────────
    {
      const currentHandle = engine.getContext().currentPdpHandle;
      if (currentHandle) {
        const onNav = () => {
          try {
            const ctx = engine.getContext();
            // If the shopper has seen this handle before (bounce pattern), fire.
            if (ctx.viewHistory.filter((h) => h === currentHandle).length >= 2) {
              engine.fire("compare_back");
              coordinator.evaluate();
            }
          } catch { /* ignore */ }
        };
        window.addEventListener("popstate", onNav, { passive: true });
        window.addEventListener("beforeunload", onNav, { passive: true });
      }
    }
  }

  // ─── Proactive trigger handler ─────────────────────────────────────────
  private handleProactiveTrigger(trigger: ProactiveTrigger, context: IntentContext): void {
    if (!this.open) {
      // Open the dock with the proactive message as opener.
      this.toggle(true);
      setTimeout(() => { this.injectProactiveMessage(trigger.message, trigger.id, context); }, 400);
    } else {
      // Dock already open — inject as a new Mira message in the thread.
      this.injectProactiveMessage(trigger.message, trigger.id, context);
    }
  }

  /**
   * Inject a proactive opening line as a system-initiated turn.
   *
   * Strategy: append the proactive message as an assistant message visible to
   * the shopper, then immediately fire a follow-up sendMessage with an
   * invisible [PROACTIVE:<id>] prefix. The Brain sees the prefix, treats it
   * as context, and generates the natural continuation. The prefix is stripped
   * before display.
   */
  private injectProactiveMessage(message: string, triggerId: string, _context: IntentContext): void {
    // Push a model message so the shopper sees Mira's proactive opener.
    this.state.messages.push({ role: "model", text: message });
    this.renderThread();

    // Track the proactive fire.
    this.track("CHAT_OPENED", { surface: "proactive", triggerId });

    // No hidden follow-up turn: the proactive opener stands on its own.
    // The Brain will continue naturally when the shopper replies.
    // (Sending a hidden [PROACTIVE:...] turn caused it to appear as a
    // visible user bubble in the thread AND burned the per-shopper rate
    // limit bucket — both fixed by removing this call.)
  }

  // Returns "?shop=…" query string when window.Shopify.shop is available.
  private shopParam(): string {
    const shop = window.Shopify?.shop;
    return shop ? `?shop=${encodeURIComponent(shop)}` : "";
  }

  private async hydrateMe() {
    try {
      // Forward Shopify customer-id when logged in (OI-22). Server persists it
      // to ShopperSession.shopifyCustomerId for cross-device identity recovery.
      const url = new URL(`${this.apiBase}/api/shopper/me`, location.origin);
      if (this.shopifyCustomerId) url.searchParams.set("customerId", this.shopifyCustomerId);
      const res = await fetch(url.toString(), { method: "GET", credentials: "include" });
      const json = await res.json();
      if (json?.ok && json.data) this.me = json.data as ShopperMe;
    } catch { /* offline / not installed — silent */ }

    // OI-24: fetch social-proof chip after me (fire-and-forget; re-renders when it lands).
    try {
      const spRes = await fetch(`${this.apiBase}/api/shopper/social-proof${this.shopParam()}`, { credentials: "include" });
      if (spRes.ok) {
        const spData = await spRes.json();
        if (spData?.data?.label) {
          this.state.socialProof = spData.data.label as string;
          if (this.open) this.renderThread();
        }
      }
    } catch { /* offline — silent */ }
  }

  // OI-24: re-expose renderThread as renderMessages alias so callers are clear.
  private renderMessages(): void { this.renderThread(); }

  // OI-23 / dwell signal: fire-and-forget event helper.
  private async trackEvent(name: string, productId?: string, payload?: Record<string, unknown>): Promise<void> {
    try {
      await fetch(`${this.apiBase}/api/events${this.shopParam()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, productId, payload }),
      });
    } catch { /* fire and forget */ }
  }

  // D40: add-all-to-bag — POST variant ids to Shopify /cart/add.js.
  // Handles partial unavailability: if the bulk add fails (e.g. 422 from Shopify
  // because one or more variants are out of stock), fall back to adding each
  // variant individually and report how many were actually added.
  // Returns { added } — the count of variants successfully added to the cart.
  // Throws only when zero variants could be added.
  private async addResolvedVariantsToShopifyCart(variantIds: string[]): Promise<{ added: number; partial: boolean }> {
    // Skip bundle cart if the theme/merchant has explicitly disabled it.
    const bundleCartEnabled = (window as unknown as Record<string, unknown>)["ENABLE_BUNDLE_CART"] !== "false";
    if (!bundleCartEnabled) throw new Error("bundle_cart_disabled");

    const numericIds = variantIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!numericIds.length) throw new Error("no_available_variants");

    // Attempt to add all items in one request first (fast path).
    const addRes = await fetch("/cart/add.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: numericIds.map((id) => ({ id, quantity: 1 })) }),
    });

    if (addRes.ok) return { added: numericIds.length, partial: false };

    // Bulk add failed — try each variant individually to recover partial success.
    // This handles the common case where one item is out of stock but the rest are available.
    let added = 0;
    for (const id of numericIds) {
      try {
        const res = await fetch("/cart/add.js", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ id, quantity: 1 }] }),
        });
        if (res.ok) added++;
      } catch { /* individual item failed — skip */ }
    }

    if (added === 0) throw new Error(`cart_add_failed_${addRes.status}`);
    return { added, partial: added < numericIds.length };
  }

  private async performComboAddAll(
    btn: HTMLButtonElement,
    comboName: string,
    productIds: string[],
  ): Promise<void> {
    btn.disabled = true;
    const original = btn.textContent ?? "Add all to bag";
    btn.textContent = "Adding…";
    // Read per-product first-available-size from the data-sizes attribute that
    // was encoded when the combo card was rendered (productId → first size string).
    let sizes: Record<string, string> = {};
    try { sizes = JSON.parse(btn.dataset.sizes ?? "{}"); } catch { /* use empty */ }
    try {
      const r = await fetch(`${this.apiBase}/api/shopper/combo/add-all`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, comboName, sizes }),
      });
      const json = await r.json().catch(() => null) as { ok?: boolean; data?: { shopifyVariantIds?: string[] } } | null;
      const variantIds = json?.data?.shopifyVariantIds ?? [];
      if (r.ok && json?.ok && variantIds.length) {
        const cart = await this.addResolvedVariantsToShopifyCart(variantIds);
        btn.textContent = "Added ✓";
        // Tell the storefront cart drawer to refresh.
        document.dispatchEvent(new CustomEvent("cart:updated"));
        if (cart.partial) {
          this.toast(`Added ${cart.added} of ${variantIds.length} pieces — some items were unavailable`);
        } else {
          this.toast(`Added ${cart.added} piece${cart.added !== 1 ? "s" : ""} to your bag`);
        }
        // Emit analytics only after successful cart mutation.
        this.track("COMBO_ADD_ALL", { comboName, itemCount: cart.added, productIds });
        this.track("CART_FROM_MIRA", { productIds, comboName, source: "mira_recommendation", itemCount: cart.added });
        setTimeout(() => {
          btn.textContent = original;
          btn.disabled = false;
        }, 2500);
      } else {
        this.toast("Could not add all items. Please try adding individually.");
        btn.textContent = "Try again";
        btn.disabled = false;
      }
    } catch {
      this.toast("Could not add all items. Please try adding individually.");
      btn.textContent = "Try again";
      btn.disabled = false;
    }
  }

  // add_outfit_to_cart — add a full outfit from an AI action, using the
  // existing /api/shopper/combo/add-all endpoint with product ids + sizes.
  private async performOutfitAddAll(
    items: Array<{ productId: string; suggestedSize?: string }>,
    comboName: string,
  ): Promise<void> {
    if (!items.length) return;
    const productIds = items.map(i => i.productId);
    const sizes: Record<string, string> = {};
    for (const item of items) {
      if (item.suggestedSize) sizes[item.productId] = item.suggestedSize;
    }
    try {
      const r = await fetch(`${this.apiBase}/api/shopper/combo/add-all`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, comboName, sizes }),
      });
      const json = await r.json().catch(() => null) as { ok?: boolean; data?: { shopifyVariantIds?: string[] } } | null;
      const variantIds = json?.data?.shopifyVariantIds ?? [];
      if (r.ok && json?.ok && variantIds.length) {
        const cart = await this.addResolvedVariantsToShopifyCart(variantIds);
        document.dispatchEvent(new CustomEvent("cart:updated"));
        if (cart.partial) {
          this.toast(`Added ${cart.added} of ${variantIds.length} pieces — some items were unavailable`);
        } else {
          this.toast(`Added ${cart.added} piece${cart.added !== 1 ? "s" : ""} to your bag`);
        }
        // Emit analytics only after successful cart mutation.
        this.track("COMBO_ADD_ALL", { comboName, itemCount: cart.added, productIds });
        // Attribution: outfit add was driven by Mira's recommendation.
        this.track("CART_FROM_MIRA", { productIds, comboName, source: "mira_recommendation", itemCount: cart.added });
      } else {
        this.toast("Could not add all items. Please try adding individually.");
      }
    } catch (e) {
      console.error("[stylique:stylist] performOutfitAddAll error:", e);
      this.toast("Could not add all items. Please try adding individually.");
    }
  }

  // OI-23: send combo vote to server.
  private async sendComboVote(vote: "up" | "down", comboName: string): Promise<void> {
    try {
      await fetch(`${this.apiBase}/api/shopper/combo-feedback${this.shopParam()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ comboName, vote }),
      });
    } catch { /* fire and forget */ }
  }

  // ─── Render orchestrator ──────────────────────────────────────────────
  private root(): HTMLElement { return this.shadow.getElementById("root")!; }

  private renderClosed() {
    const stylistName = this.me?.stylist?.name ?? "Mira";
    const avatar = this.me?.stylist?.avatarUrl ?? DEFAULT_MIRA_AVATAR;
    const pulse = this.state.messages.length === 0 ? "true" : "false";
    if (avatar) {
      // Standing-avatar launcher (demo parity): portrait + eyebrow + name + online dot.
      this.root().innerHTML = `
        <button class="sq-stl-bubble" data-pulse="${pulse}" aria-label="Chat with ${esc(stylistName)}, your stylist">
          <span class="sq-stl-bubble__frame"></span>
          <span class="sq-stl-bubble__portrait"><img src="${esc(avatar)}" alt="${esc(stylistName)} — your stylist"></span>
          <span class="sq-stl-bubble__cap">
            <span class="sq-stl-bubble__eyebrow"><span class="sq-stl-bubble__dot"></span>Your stylist</span>
            <span class="sq-stl-bubble__name">${esc(stylistName)}</span>
          </span>
        </button>`;
    } else {
      this.root().innerHTML = `
        <button class="sq-stl-bubble sq-stl-bubble--glyph" data-pulse="${pulse}" aria-label="Open ${esc(stylistName)}">
          <span class="sq-stl-bubble__glyph">${esc(stylistName.charAt(0).toUpperCase())}</span>
        </button>`;
    }
    const btn = this.root().querySelector<HTMLButtonElement>(".sq-stl-bubble")!;
    btn.addEventListener("click", () => this.toggle(true));
  }

  private renderOpen() {
    const stylistName = this.me?.stylist?.name ?? "Mira";
    const avatar = this.me?.stylist?.avatarUrl ?? DEFAULT_MIRA_AVATAR;
    const faceHtml = avatar
      ? `<span class="sq-stl-face"><img src="${esc(avatar)}" alt="${esc(stylistName)}"><span class="sq-stl-face__dot"></span></span>`
      : "";
    this.root().innerHTML = `
      <div class="sq-stl-back" data-open="false"></div>
      <div class="sq-stl-dock" data-open="false" role="dialog" aria-label="Stylique Stylist">
        <div class="sq-stl-glow"></div>
        <div class="sq-stl-head">
          ${faceHtml}
          <div class="sq-stl-head__meta">
            <div class="sq-stl-head__name">${this.me?.displayName ? `Hi, ${esc(this.me.displayName)}` : esc(stylistName)}</div>
            <div class="sq-stl-head__sub">${this.me?.accountClaimed ? `Saved · I remember your taste` : `Your stylist · knows the catalog`}</div>
          </div>
          <button class="sq-stl-close" aria-label="Close">×</button>
        </div>
        <div class="sq-stl-scroll" id="sq-stl-scroll"></div>
        <div class="sq-stl-pending" id="sq-stl-pending" hidden></div>
        ${this.state.socialProof ? `<div class="sq-stl-social">${esc(this.state.socialProof)}</div>` : ""}
        <form class="sq-stl-compose" id="sq-stl-compose">
          <label class="sq-stl-attach" title="Send a photo">
            <input type="file" accept="image/jpeg,image/png,image/webp" id="sq-stl-file" hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.5l-8 8a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/></svg>
          </label>
          <input class="sq-stl-input" name="msg" placeholder="What's the vibe? (or send a pic)" autocomplete="off">
          <button class="sq-stl-send" type="submit" aria-label="Send">→</button>
        </form>
        <div class="sq-stl-pane-canvas" id="sq-stl-pane-canvas" style="display:none"></div>
      </div>`;

    const dock = this.root().querySelector<HTMLElement>(".sq-stl-dock")!;
    const back = this.root().querySelector<HTMLElement>(".sq-stl-back")!;
    requestAnimationFrame(() => {
      dock.setAttribute("data-open", "true");
      back.setAttribute("data-open", "true");
    });

    this.root().querySelector(".sq-stl-close")!.addEventListener("click", () => this.toggle(false));
    back.addEventListener("click", () => this.toggle(false));

    this.renderThread();

    const form = this.root().querySelector<HTMLFormElement>("#sq-stl-compose")!;
    const fileInput = this.root().querySelector<HTMLInputElement>("#sq-stl-file")!;
    const pending = this.root().querySelector<HTMLElement>("#sq-stl-pending")!;

    // Pending image staged for the next send. We keep it in instance state
    // so it survives a re-render if one happens between pick and submit.
    let pendingImageDataUrl: string | null = this.pendingImage ?? null;
    const renderPending = () => {
      if (!pendingImageDataUrl) {
        pending.hidden = true; pending.innerHTML = "";
        return;
      }
      pending.hidden = false;
      pending.innerHTML = `
        <img class="sq-stl-pending__thumb" src="${pendingImageDataUrl}" alt="">
        <span class="sq-stl-pending__hint">Mira will see this with your next message.</span>
        <button class="sq-stl-pending__x" type="button" aria-label="Remove">×</button>`;
      pending.querySelector(".sq-stl-pending__x")!.addEventListener("click", () => {
        pendingImageDataUrl = null; this.pendingImage = null; renderPending();
      });
    };
    renderPending();

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";    // allow re-picking the same file
      if (!file) return;
      // Soft cap at 5MB pre-base64 (becomes ~6.7MB encoded — under our 8.5MB server cap).
      if (file.size > 5_000_000) {
        this.toast("Image too large. Try one under 5MB.");
        return;
      }
      try {
        pendingImageDataUrl = await fileToDataUrl(file);
        this.pendingImage = pendingImageDataUrl;
        this.track("CHAT_MESSAGE_SENT", { kind: "image_staged" });
        renderPending();
      } catch {
        this.toast("Couldn't read that image.");
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector<HTMLInputElement>(".sq-stl-input")!;
      const text = input.value.trim();
      // Allow image-only sends (e.g. "[photo] does this work?").
      if ((!text && !pendingImageDataUrl) || this.state.sending) return;
      input.value = "";
      const img = pendingImageDataUrl;
      pendingImageDataUrl = null; this.pendingImage = null; renderPending();
      void this.sendMessage(text || "what do you think?", img ?? undefined);
    });
  }

  private renderThread() {
    const scroll = this.root().querySelector<HTMLElement>("#sq-stl-scroll");
    if (!scroll) return;

    if (!this.state.messages.length) {
      scroll.innerHTML = this.greetHtml();
    } else {
      scroll.innerHTML = this.state.messages.map((m, i) => this.bubbleHtml(m, i)).join("");
    }

    if (this.state.sending) {
      scroll.insertAdjacentHTML("beforeend", `<div class="sq-stl-typing"><span></span><span></span><span></span></div>`);
    }
    scroll.scrollTop = scroll.scrollHeight;

    // Bind combo vote buttons (OI-23).
    scroll.querySelectorAll<HTMLElement>("[data-vote]").forEach((voteEl) => {
      voteEl.addEventListener("click", (e) => {
        e.stopPropagation();
        const vote = voteEl.getAttribute("data-vote") as "up" | "down";
        const comboName = voteEl.getAttribute("data-combo") ?? "";
        voteEl.closest(".sq-stl-combo-votes")?.querySelectorAll("[data-vote]").forEach(b => b.classList.remove("active"));
        voteEl.classList.add("active");
        void this.sendComboVote(vote, comboName);
      });
    });

    // D40 — "Try this look" button: open widget VTO with all combo pieces.
    scroll.querySelectorAll<HTMLButtonElement>(".sq-stl-combo-tryon").forEach((btn) => {
      btn.addEventListener("click", () => {
        const comboName = btn.dataset.comboName ?? "";
        const productIds = (btn.dataset.productIds ?? "").split(",").filter(Boolean);
        void this.trackEvent("COMBO_TRYON_REQUESTED", undefined, { comboName, productIds });
        // Must match the widget's event listener (stylique:request-tryon).
        // Using stylique:request-combo-tryon was a typo — the widget only
        // listens for stylique:request-tryon (index.ts:373).
        document.dispatchEvent(new CustomEvent("stylique:request-tryon", {
          detail: { productIds, comboName, mode: "model", autoRender: true },
        }));
        this.toggle(false);
      });
    });

    // D40 — "Add all to bag" button: fire the combo/add-all endpoint.
    scroll.querySelectorAll<HTMLButtonElement>(".sq-stl-combo-add-all").forEach((btn) => {
      btn.addEventListener("click", () => {
        const comboName = btn.dataset.comboName ?? "";
        const productIds = (btn.dataset.productIds ?? "").split(",").filter(Boolean);
        void this.performComboAddAll(btn, comboName, productIds);
      });
    });

    // Bind PDP navigations.
    scroll.querySelectorAll<HTMLElement>("[data-pdp]").forEach((el) =>
      el.addEventListener("click", () => {
        const handle = el.dataset.pdp!;
        this.track("CHAT_PRODUCT_CLICKED", { productHandle: handle });
        location.href = `/products/${handle}`;
      }));

    // Bind confirm-cart controls.
    scroll.querySelectorAll<HTMLElement>("[data-cart-msg]").forEach((el) => {
      const msgIdx = Number(el.dataset.cartMsg);
      const confirm = el.querySelector<HTMLButtonElement>("[data-cart-confirm]");
      const cancel = el.querySelector<HTMLButtonElement>("[data-cart-cancel]");
      const sizeSel = el.querySelector<HTMLSelectElement>(".sq-stl-select");
      const qtyInp = el.querySelector<HTMLInputElement>(".sq-stl-qty");
      confirm?.addEventListener("click", () => {
        const m = this.state.messages[msgIdx];
        if (!m?.pendingCart) return;
        m.pendingCart.suggestedSize = sizeSel?.value ?? m.pendingCart.suggestedSize;
        m.pendingCart.qty = Math.max(1, Math.min(10, Number(qtyInp?.value ?? 1)));
        void this.performAddToCart(msgIdx);
      });
      cancel?.addEventListener("click", () => {
        const m = this.state.messages[msgIdx];
        if (!m?.pendingCart) return;
        this.track("CART_CANCELLED", { productId: m.pendingCart.product.id }, m.pendingCart.product.id);
        m.pendingCart.status = "cancelled";
        this.renderThread();
      });
    });

    // Track signup card impressions (once per render of an open card).
    scroll.querySelectorAll<HTMLElement>("[data-signup-msg]").forEach((el) => {
      if (el.dataset.shown !== "true") {
        el.dataset.shown = "true";
        this.track("SIGNUP_CARD_SHOWN", {});
      }
    });

    // Bind signup card controls.
    scroll.querySelectorAll<HTMLElement>("[data-signup-msg]").forEach((el) => {
      const msgIdx = Number(el.dataset.signupMsg);
      const save = el.querySelector<HTMLButtonElement>("[data-su-save]");
      const skip = el.querySelector<HTMLButtonElement>("[data-su-skip]");
      const emailInp = el.querySelector<HTMLInputElement>("[data-su-email]");
      const nameInp = el.querySelector<HTMLInputElement>("[data-su-name]");
      const optInp = el.querySelector<HTMLInputElement>("[data-su-opt]");
      save?.addEventListener("click", () => {
        const email = (emailInp?.value ?? "").trim();
        if (!/.+@.+\..+/.test(email)) {
          emailInp?.focus();
          emailInp?.setAttribute("style", "border-color:#E879C8");
          return;
        }
        void this.performSignup(msgIdx, {
          email,
          displayName: nameInp?.value?.trim() || undefined,
          marketingOptIn: !!optInp?.checked,
        });
      });
      skip?.addEventListener("click", () => {
        const m = this.state.messages[msgIdx];
        if (!m?.pendingSignup) return;
        m.pendingSignup.status = "dismissed";
        this.track("SIGNUP_DISMISSED", {});
        this.renderThread();
      });
    });

    // OI-8: Bind OTP verify card controls.
    scroll.querySelectorAll<HTMLElement>("[data-verify-msg]").forEach((el) => {
      const msgIdx = Number(el.dataset.verifyMsg);
      const tokenInp = el.querySelector<HTMLInputElement>(".sq-stl-verify-input");
      const verifyBtn = el.querySelector<HTMLButtonElement>(".sq-stl-verify-btn");
      verifyBtn?.addEventListener("click", () => {
        const token = (tokenInp?.value ?? "").replace(/\D/g, "").slice(0, 6);
        if (token.length !== 6) {
          tokenInp?.focus();
          return;
        }
        void this.performVerify(msgIdx, token);
      });
    });

    // Combo dwell signal — observe combos for ≥3s visibility.
    this.observeCombos();
  }

  // OI-24 / dwell: sets up IntersectionObserver on combo cards.
  // Fires WIDGET_COMBO_VIEWED after the card has been visible for 3s.
  // Disconnects the previous observer before creating a new one so that
  // repeated renderThread() calls don't accumulate orphaned observers.
  private observeCombos(): void {
    // Tear down the previous observer (created on the last renderThread call).
    if (this._comboObserver) {
      this._comboObserver.disconnect();
      this._comboObserver = null;
    }
    const scroll = this.root().querySelector<HTMLElement>("#sq-stl-scroll");
    if (!scroll) return;
    const combos = scroll.querySelectorAll<HTMLElement>("[data-combo-name]");
    if (!combos.length) return;   // no combos visible — skip creating the observer
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const name = (entry.target as HTMLElement).dataset.comboName;
          if (!name) return;
          timers.set(entry.target, setTimeout(() => {
            void this.trackEvent("WIDGET_COMBO_VIEWED", undefined, { comboName: name });
          }, 3000));
        } else {
          const t = timers.get(entry.target);
          if (t) { clearTimeout(t); timers.delete(entry.target); }
        }
      });
    }, { threshold: 0.6 });
    combos.forEach(el => obs.observe(el));
    this._comboObserver = obs;
  }

  private async performSignup(msgIdx: number, payload: { email: string; displayName?: string; marketingOptIn?: boolean }) {
    const m = this.state.messages[msgIdx];
    if (!m?.pendingSignup) return;
    m.pendingSignup.status = "saving";
    this.renderThread();
    try {
      const res = await fetch(`${this.apiBase}/api/shopper/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const json = await res.json();
      if (!json?.ok) throw new Error("save_failed");
      // OI-8: server now sends an OTP — show the verify step instead of "saved".
      if (json.data?.status === "verify_sent") {
        m.pendingSignup.status = "verify";
        m.pendingSignup.pendingEmail = payload.email;
        m.pendingSignup.pendingDisplayName = payload.displayName;
        this.renderThread();
        return;
      }
      // Legacy / fallback path (if server skips OTP).
      m.pendingSignup.status = "saved";
      this.me = {
        accountClaimed: true,
        displayName: payload.displayName ?? null,
        emailMasked: `${payload.email[0]}***@${payload.email.split("@")[1] ?? ""}`,
      };
      this.renderThread();
      this.toast("Saved to your Stylique");
      document.dispatchEvent(new CustomEvent("stylique:account-claimed", {
        detail: { displayName: payload.displayName ?? null },
      }));
    } catch {
      if (m.pendingSignup) m.pendingSignup.status = "failed";
      this.renderThread();
    }
  }

  // OI-8: Submit the 6-digit OTP to complete account verification.
  private async performVerify(msgIdx: number, token: string) {
    const m = this.state.messages[msgIdx];
    if (!m?.pendingSignup) return;
    m.pendingSignup.status = "verifying";
    this.renderThread();
    try {
      const res = await fetch(`${this.apiBase}/api/shopper/account/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        credentials: "include",
      });
      const json = await res.json();
      if (!json?.ok) throw new Error("verify_failed");
      m.pendingSignup.status = "saved";
      this.me = {
        accountClaimed: true,
        displayName: m.pendingSignup.pendingDisplayName ?? null,
        emailMasked: m.pendingSignup.pendingEmail
          ? `${m.pendingSignup.pendingEmail[0]}***@${m.pendingSignup.pendingEmail.split("@")[1] ?? ""}`
          : null,
      };
      this.renderThread();
      this.toast("Saved to your Stylique");
      document.dispatchEvent(new CustomEvent("stylique:account-claimed", {
        detail: { displayName: m.pendingSignup.pendingDisplayName ?? null },
      }));
    } catch {
      if (m.pendingSignup) m.pendingSignup.status = "failed";
      this.renderThread();
    }
  }

  // Opener line resolved from server (returning-shopper recall) or trigger.
  private serverOpener: string | null = null;

  private greetHtml(): string {
    const name = this.me?.displayName ? esc(this.me.displayName) : "";
    // Priority: server opener (returning-shopper recall) > trigger-kind > default.
    if (this.serverOpener) {
      return `<div class="sq-stl-greet"><p>${esc(this.serverOpener)}</p></div>`;
    }
    const byKind: Record<string, { h: string; p: string }> = {
      return_visit: {
        h: name ? `Welcome back, <em>${name}</em>.` : `Welcome back.`,
        p: `Same vibe as last time, or trying something new?`,
      },
      return_visit_24h: {
        h: name ? `Good to see you again, <em>${name}</em>.` : `Good to see you again.`,
        p: `Want to pick up where we left off?`,
      },
      "collection.scroll": {
        h: `Looking for <em>something specific</em>?`,
        p: `Tell me the occasion or the piece. I'll pull a few that fit.`,
      },
      "collection.exit_scroll": {
        h: `Before you scroll away —`,
        p: `I spotted a few pieces that might be exactly what you're after. Want a quick look?`,
      },
      exit_intent: {
        h: `Before you go —`,
        p: `One look I think you'd like, if you have 10 seconds?`,
      },
      "pdp.dwell_45s": {
        h: `Still thinking about this one?`,
        p: `Ask me about the fit, how to style it, or what else works with your wardrobe.`,
      },
      pdp_inline: {
        h: `What works with <em>this piece</em>?`,
        p: `Ask me how to wear it, what shoes go, or if the size is right.`,
      },
    };
    const kind = this.triggerOpenerKind ?? "";
    const opener = byKind[kind];
    if (opener) {
      return `<div class="sq-stl-greet"><h4>${opener.h}</h4><p>${opener.p}</p></div>`;
    }
    return `<div class="sq-stl-greet">
        <h4>Hi — I'm your <em>stylist</em>.</h4>
        <p>Tell me the vibe, the occasion, or a piece you're after. I'll pull from this brand's actual catalog and put together looks for you.</p>
      </div>`;
  }

  private bubbleHtml(m: ChatMsg, idx: number): string {
    if (m.role === "user") {
      const img = m.imageDataUrl
        ? `<img class="sq-stl-bub__img" src="${esc(m.imageDataUrl)}" alt="">`
        : "";
      const text = m.text ? `<div class="sq-stl-bub sq-stl-bub--user">${esc(m.text)}</div>` : "";
      return `<div class="sq-stl-bub-wrap">${img}${text}</div>`;
    }
    const text = `<div class="sq-stl-bub sq-stl-bub--model">${esc(m.text)}</div>`;
    const combos = (m.combos ?? []).map((c, comboIndex) => {
      const productIdsCsv = esc(c.products.map((p) => p.id).join(","));
      const comboNameEsc = esc(c.name);
      const thumbsHtml = c.products.some((p) => p.imageUrl)
        ? `<div class="sq-combo-images">${c.products.map((p) =>
            p.imageUrl
              ? `<img class="sq-combo-thumb" src="${esc(p.imageUrl)}" alt="${esc(p.title)}" loading="lazy">`
              : ""
          ).join("")}</div>`
        : "";
      return `
      <div class="sq-stl-combo" data-combo-name="${comboNameEsc}">
        ${thumbsHtml}
        <div class="sq-stl-combo__name">${comboNameEsc}</div>
        <div class="sq-stl-combo__why">${esc(c.reasoning)}</div>
        <div class="sq-stl-combo__grid">
          ${c.products.map((p) => `
            <button class="sq-stl-card" data-pdp="${esc(p.handle)}" type="button">
              ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.title)}">` : `<div class="sq-stl-card__noimg"></div>`}
              <div class="sq-stl-card__title">${esc(p.title)}</div>
            </button>`).join("")}
        </div>
        <div class="sq-stl-combo-actions">
          <button class="sq-stl-combo-tryon" type="button" data-combo-name="${comboNameEsc}" data-product-ids="${productIdsCsv}">Try this look →</button>
          <button class="sq-stl-combo-add-all" type="button" data-combo-name="${comboNameEsc}" data-product-ids="${productIdsCsv}" data-sizes="${esc(JSON.stringify(Object.fromEntries(c.products.map(p => [p.id, p.sizes[0] ?? ""]))))}">Add all to bag</button>
        </div>
        <div class="sq-stl-combo-votes" data-combo-idx="${comboIndex}">
          <button class="sq-stl-vote sq-stl-vote-up" data-vote="up" data-combo="${comboNameEsc}" title="Love this" type="button">♡</button>
          <button class="sq-stl-vote sq-stl-vote-dn" data-vote="down" data-combo="${comboNameEsc}" title="Not for me" type="button">✕</button>
        </div>
      </div>`;
    }).join("");
    const cart = m.pendingCart ? this.cartCardHtml(m.pendingCart, idx) : "";
    const signup = m.pendingSignup ? this.signupCardHtml(m.pendingSignup, idx) : "";
    return text + combos + cart + signup;
  }

  private signupCardHtml(ps: PendingSignup, idx: number): string {
    if (ps.status === "saved") {
      return `<div class="sq-stl-signup sq-stl-signup--done">✓ Saved · I'll remember you next time.</div>`;
    }
    if (ps.status === "dismissed") return "";
    if (ps.status === "failed") {
      return `<div class="sq-stl-signup sq-stl-signup--done" style="color:#E879C8">Couldn't save — try again in a sec.</div>`;
    }
    // OI-8: OTP verify step — show code entry form.
    if (ps.status === "verify" || ps.status === "verifying") {
      const verifying = ps.status === "verifying";
      return `
        <div class="sq-stl-verify" data-verify-msg="${idx}">
          <p class="sq-stl-verify-msg">Check your inbox for a 6-digit code</p>
          <input class="sq-stl-verify-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="000000" ${verifying ? "disabled" : ""} />
          <button class="sq-stl-verify-btn" type="button" ${verifying ? "disabled" : ""}>${verifying ? "Verifying…" : "Verify"}</button>
        </div>`;
    }
    const disabled = ps.status === "saving";
    return `
      <div class="sq-stl-signup" data-signup-msg="${idx}">
        <div class="sq-stl-signup__head">
          <div class="sq-stl-signup__title serif">Save your taste</div>
          <div class="sq-stl-signup__sub">So I remember you across this store — and the try-on, fit, recs all stay personal.</div>
        </div>
        <div class="sq-stl-signup__row">
          <input class="sq-stl-signup__input" data-su-name placeholder="Your name (optional)" maxlength="80" ${disabled ? "disabled" : ""}>
          <input class="sq-stl-signup__input" data-su-email type="email" placeholder="Email" maxlength="200" ${disabled ? "disabled" : ""} required>
        </div>
        <label class="sq-stl-signup__opt">
          <input type="checkbox" data-su-opt> <span>Send me occasional style picks</span>
        </label>
        <div class="sq-stl-signup__btns">
          <button class="sq-stl-btn sq-stl-btn--primary" data-su-save type="button" ${disabled ? "disabled" : ""}>${disabled ? "Saving…" : "Save"}</button>
          <button class="sq-stl-btn sq-stl-btn--ghost" data-su-skip type="button">Not now</button>
        </div>
      </div>`;
  }

  private cartCardHtml(pc: PendingCart, idx: number): string {
    const sizes = pc.product.sizes;
    const sel = pc.suggestedSize && sizes.includes(pc.suggestedSize) ? pc.suggestedSize : sizes[0];
    const status =
      pc.status === "added"     ? `<div class="sq-stl-cart__status">✓ Added to your bag</div>` :
      pc.status === "cancelled" ? `<div class="sq-stl-cart__status" style="color:${T.cool}">Cancelled</div>` :
      pc.status === "failed"    ? `<div class="sq-stl-cart__status" style="color:#E879C8">Couldn't add — try again on the product page</div>` :
      "";
    const controlsEnabled = pc.status === "open";
    return `
      <div class="sq-stl-cart" data-cart-msg="${idx}">
        <div class="sq-stl-cart__row">
          ${pc.product.imageUrl ? `<img class="sq-stl-cart__img" src="${esc(pc.product.imageUrl)}" alt="">` : `<div class="sq-stl-cart__img"></div>`}
          <div>
            <div class="sq-stl-cart__title">${esc(pc.product.title)}</div>
            <div class="sq-stl-cart__sub">Want me to add it?</div>
          </div>
        </div>
        ${controlsEnabled ? `
          <div class="sq-stl-cart__controls">
            ${sizes.length ? `
              <select class="sq-stl-select" aria-label="Size">
                ${sizes.map((s) => `<option value="${esc(s)}" ${s === sel ? "selected" : ""}>${esc(s)}</option>`).join("")}
              </select>` : ""}
            <input class="sq-stl-qty" type="number" min="1" max="10" value="${pc.qty}" aria-label="Quantity">
          </div>
          <div class="sq-stl-cart__btns">
            <button class="sq-stl-btn sq-stl-btn--primary" data-cart-confirm type="button" ${(pc.status as string) === "adding" ? "disabled" : ""}>${(pc.status as string) === "adding" ? "Adding…" : "Add to bag"}</button>
            <button class="sq-stl-btn sq-stl-btn--ghost" data-cart-cancel type="button">Not now</button>
          </div>` : status}
      </div>`;
  }

  // ─── VTO popup (compact floating overlay above the Mira dock) ───────────

  // Holds a reference to the currently visible product preview card (if any)
  // so we can replace it without stacking multiples.
  private _previewCard: { el: HTMLDivElement; timer: ReturnType<typeof setTimeout> } | null = null;

  /**
   * Show a floating product preview card to the left of the dock.
   * Replaces any existing card. Auto-dismisses after 8 seconds.
   * On navigate action: shows a rich card with image + "View product" / "Try On" buttons.
   */
  showProductPreview(product: {
    id: string;
    title: string;
    imageUrl: string | null;
    price: string;
    handle: string;
  }): void {
    // Dismiss any existing card first.
    if (this._previewCard) {
      clearTimeout(this._previewCard.timer);
      this._previewCard.el.remove();
      this._previewCard = null;
    }

    const card = document.createElement("div");
    card.className = "sq-product-preview";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `Product preview: ${product.title}`);

    const imgHtml = product.imageUrl
      ? `<img class="sq-preview-img" src="${esc(product.imageUrl)}" alt="${esc(product.title)}" loading="lazy">`
      : `<div class="sq-preview-img-placeholder">🧥</div>`;

    // Inject the card's CSS into the main document (outside Shadow DOM) because
    // the preview card is appended to document.body for correct z-index stacking.
    if (!document.getElementById("sq-preview-card-style")) {
      const styleEl = document.createElement("style");
      styleEl.id = "sq-preview-card-style";
      styleEl.textContent = `
        .sq-product-preview {
          position: fixed; bottom: 120px; right: 440px; width: 260px;
          background: white; border-radius: 14px;
          box-shadow: 0 6px 30px rgba(0,0,0,0.15); z-index: 9999;
          overflow: hidden; animation: sq-preview-in 0.25s ease;
          font-family: "Manrope", ui-sans-serif, system-ui, -apple-system, sans-serif;
        }
        @keyframes sq-preview-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
        .sq-preview-img { width: 100%; height: 200px; object-fit: cover; display: block; }
        .sq-preview-img-placeholder { width: 100%; height: 200px; background: #f0eef5; display: flex; align-items: center; justify-content: center; font-size: 32px; }
        .sq-preview-body { padding: 12px 14px; }
        .sq-preview-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; line-height: 1.3; }
        .sq-preview-price { font-size: 13px; color: #666; margin-bottom: 10px; }
        .sq-preview-actions { display: flex; gap: 8px; }
        .sq-preview-btn { flex: 1; padding: 7px 0; border-radius: 8px; font-size: 12px; font-weight: 500; cursor: pointer; border: none; font-family: inherit; }
        .sq-preview-btn-primary { background: #1a1a1a; color: white; }
        .sq-preview-btn-primary:hover { opacity: 0.88; }
        .sq-preview-btn-secondary { background: #f5f5f5; color: #1a1a1a; }
        .sq-preview-btn-secondary:hover { background: #ebebeb; }
        .sq-preview-close { position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,0.45); border: 0; color: white; font-size: 14px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; font-family: inherit; padding: 0; }
        .sq-preview-close:hover { background: rgba(0,0,0,0.65); }
        @media (max-width: 768px) { .sq-product-preview { right: 0; left: 0; bottom: 80px; width: 100%; border-radius: 14px 14px 0 0; } }
        @keyframes sq-preview-out { to { opacity: 0; transform: translateX(12px); } }
        .sq-product-preview.sq-preview-hiding { animation: sq-preview-out 0.2s ease forwards; }
      `;
      document.head.appendChild(styleEl);
    }

    card.innerHTML = `
      ${imgHtml}
      <div class="sq-preview-body">
        <div class="sq-preview-title">${esc(product.title)}</div>
        ${product.price ? `<div class="sq-preview-price">${esc(product.price)}</div>` : ""}
        <div class="sq-preview-actions">
          <button class="sq-preview-btn sq-preview-btn-primary" id="sq-prev-view" type="button">View product</button>
          <button class="sq-preview-btn sq-preview-btn-secondary" id="sq-prev-tryon" type="button">Try On</button>
        </div>
      </div>
      <button class="sq-preview-close" id="sq-prev-close" type="button" aria-label="Close preview">×</button>`;

    document.body.appendChild(card);

    const dismiss = () => {
      if (this._previewCard?.el !== card) return;
      card.classList.add("sq-preview-hiding");
      setTimeout(() => { card.remove(); }, 220);
      if (this._previewCard) { clearTimeout(this._previewCard.timer); }
      this._previewCard = null;
    };

    card.querySelector("#sq-prev-close")?.addEventListener("click", dismiss);

    card.querySelector("#sq-prev-view")?.addEventListener("click", () => {
      dismiss();
      window.location.href = `/products/${product.handle}`;
    });

    card.querySelector("#sq-prev-tryon")?.addEventListener("click", () => {
      dismiss();
      document.dispatchEvent(new CustomEvent("stylique:request-tryon", {
        detail: { mode: "model", productIds: [product.id], autoRender: true },
      }));
    });

    const timer = setTimeout(dismiss, 8000);
    this._previewCard = { el: card, timer };
  }

  /**
   * Open a compact VTO popup positioned above the Mira dock.
   * The dock stays visible and compact — NO split-pane expansion.
   * Also dispatches stylique:request-tryon for standalone widget users on PDPs.
   */
  /** Map shopper bodyType → best-matched default muse id. */
  private bodyTypeToMuseId(bodyType: string | null | undefined): string {
    switch (bodyType) {
      case "PETITE": return "ava";
      case "SLIM":   return "lina";
      case "TALL":   return "noor";
      case "CURVY":
      case "PLUS":   return "elena";
      case "REGULAR":
      default:       return "average-medium";
    }
  }

  openVTOPopup(productIds: string[], comboName = "", preferPhotoTab = false): void {
    this.vtoState.open = true;
    this.vtoState.productIds = productIds;
    this.vtoState.comboName = comboName;
    this.vtoState.renderImage = null;
    this.vtoState.renderPending = false;
    this.vtoState.renderError = null;
    this.vtoState.activeTab = preferPhotoTab ? "photo" : "model";
    this.vtoState.photoDataUrl = null;
    this.vtoState.photoFileName = null;
    // Pre-select muse from shopper's body type when known. Personalized at zero cost.
    this.vtoState.selectedMuseId = this.bodyTypeToMuseId(this.me?.bodyType ?? null);

    // Secondary cross-surface event: if there's a standalone <stylique-widget>
    // mounted on this PDP, it will intercept this and open at Step 1.
    document.dispatchEvent(new CustomEvent("stylique:request-tryon", {
      detail: { mode: "model", productIds, comboName, autoRender: true },
    }));

    this.renderVTOPopup();
  }

  private closeVTOPopup(): void {
    this.vtoState.open = false;
    const popup = this.shadow.getElementById("sq-vto-popup");
    if (popup) popup.remove();
  }

  private renderVTOPopup(): void {
    // Remove any existing popup first.
    this.shadow.getElementById("sq-vto-popup")?.remove();

    const { productIds, comboName, selectedMuseId, renderImage, renderPending, renderError,
            activeTab, photoDataUrl, photoFileName } = this.vtoState;
    const titleText = comboName || (productIds.length > 1 ? `${productIds.length} pieces` : "Try it on");

    const renderAreaHtml = renderPending
      ? `<div class="sq-vto-popup__skeleton" aria-label="Rendering…"></div>`
      : renderImage
        ? `<img class="sq-vto-popup__render-img" id="sq-vto-popup-img" src="${esc(renderImage)}" alt="Try-on preview">`
        : activeTab === "photo"
          ? ""
          : `<div class="sq-vto-popup__render-empty">Pick a muse and tap Render</div>`;

    // ── Model tab body ────────────────────────────────────────────────────
    const modelTabBody = `
      <div class="sq-vto-popup__muse-label">Choose a muse</div>
      <div class="sq-vto-popup__muse-row" id="sq-vto-popup-muse-row">
        ${(MUSES as readonly MuseDef[]).map((m) => `
          <button class="sq-vto-popup__muse-chip" data-muse-id="${esc(m.id)}" aria-pressed="${m.id === selectedMuseId}" type="button">
            <img src="${esc(m.imgUrl)}" alt="${esc(m.label)}" loading="lazy">
            <span>${esc(m.label)}</span>
          </button>`).join("")}
      </div>
      <div class="sq-vto-popup__render-area" id="sq-vto-popup-render">
        ${renderAreaHtml}
      </div>
      ${renderError && activeTab === "model" ? `<div style="font-size:11px;color:#FCA5A5;text-align:center;padding:2px 0">${esc(renderError)}</div>` : ""}`;

    const modelTabFooter = `
      <button class="sq-vto-popup__render-btn" id="sq-vto-popup-render-btn" type="button" ${renderPending ? "disabled" : ""}>
        ${renderPending ? "Rendering…" : "Render on this muse →"}
      </button>
      <button class="sq-vto-popup__full-link" id="sq-vto-popup-full-link" type="button">
        See full Try-On experience →
      </button>`;

    // ── Photo tab body ────────────────────────────────────────────────────
    const photoTabBody = photoDataUrl
      ? `
        <img class="sq-vto-photo-preview" src="${esc(photoDataUrl)}" alt="${esc(photoFileName ?? "Your photo")}">
        <div class="sq-vto-drop-privacy">Your photo is used only for this preview and never saved.</div>
        <div class="sq-vto-popup__render-area" id="sq-vto-popup-render" style="margin-top:8px">
          ${renderAreaHtml || ""}
        </div>
        ${renderError && activeTab === "photo" ? `<div style="font-size:11px;color:#FCA5A5;text-align:center;padding:2px 0">${esc(renderError)}</div>` : ""}`
      : `
        <div class="sq-vto-drop-zone" id="sq-vto-drop-zone" tabindex="0" role="button" aria-label="Upload your photo">
          <div class="sq-vto-drop-icon">📷</div>
          <div class="sq-vto-drop-label">Drop your photo here or tap to upload</div>
          <div class="sq-vto-drop-sub">JPEG · PNG · WebP · up to 6MB</div>
          <input type="file" id="sq-vto-photo-input" accept="image/jpeg,image/png,image/webp" style="display:none">
        </div>
        <div class="sq-vto-drop-privacy">Your photo is used only for this preview and never saved.</div>`;

    const photoTabFooter = photoDataUrl
      ? `
        <button class="sq-vto-popup__render-btn" id="sq-vto-photo-render-btn" type="button" ${renderPending ? "disabled" : ""}>
          ${renderPending ? "Rendering…" : "Render Try-On →"}
        </button>
        <button class="sq-vto-popup__full-link" id="sq-vto-photo-change-btn" type="button">
          Change photo
        </button>`
      : `
        <button class="sq-vto-popup__render-btn" id="sq-vto-photo-upload-btn" type="button">
          Select photo
        </button>`;

    const popup = document.createElement("div");
    popup.id = "sq-vto-popup";
    popup.className = "sq-vto-popup";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "Try it on");
    popup.innerHTML = `
      <div class="sq-vto-popup__header">
        <div class="sq-vto-popup__title">${esc(titleText)}</div>
        <button class="sq-vto-popup__close" id="sq-vto-popup-close" aria-label="Close" type="button">×</button>
      </div>
      <div class="sq-vto-tabs">
        <button class="sq-vto-tab${activeTab === "model" ? " active" : ""}" id="sq-vto-tab-model" type="button">See on a model</button>
        <button class="sq-vto-tab${activeTab === "photo" ? " active" : ""}" id="sq-vto-tab-photo" type="button">See on me</button>
      </div>
      <div class="sq-vto-popup__body" id="sq-vto-popup-body">
        ${activeTab === "model" ? modelTabBody : photoTabBody}
      </div>
      <div class="sq-vto-popup__footer" id="sq-vto-popup-footer">
        ${activeTab === "model" ? modelTabFooter : photoTabFooter}
      </div>`;

    // Attach into the shadow root directly (sits above the dock).
    this.shadow.appendChild(popup);

    // Close on × click.
    popup.querySelector("#sq-vto-popup-close")?.addEventListener("click", () => this.closeVTOPopup());

    // Close on ESC key (attached to document — removed on close).
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { this.closeVTOPopup(); document.removeEventListener("keydown", onEsc); }
    };
    document.addEventListener("keydown", onEsc);

    // Tab switching.
    popup.querySelector("#sq-vto-tab-model")?.addEventListener("click", () => {
      if (this.vtoState.activeTab !== "model") {
        this.vtoState.activeTab = "model";
        this.vtoState.renderImage = null;
        this.vtoState.renderError = null;
        this.renderVTOPopup();
      }
    });
    popup.querySelector("#sq-vto-tab-photo")?.addEventListener("click", () => {
      if (this.vtoState.activeTab !== "photo") {
        this.vtoState.activeTab = "photo";
        this.vtoState.renderImage = null;
        this.vtoState.renderError = null;
        this.renderVTOPopup();
      }
    });

    if (activeTab === "model") {
      // Muse chip selection.
      popup.querySelectorAll<HTMLButtonElement>(".sq-vto-popup__muse-chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.vtoState.selectedMuseId = btn.dataset.museId ?? this.vtoState.selectedMuseId;
          popup.querySelectorAll<HTMLButtonElement>(".sq-vto-popup__muse-chip").forEach((b) =>
            b.setAttribute("aria-pressed", String(b.dataset.museId === this.vtoState.selectedMuseId)));
          this.vtoState.renderImage = null;
        });
      });

      // Render button.
      popup.querySelector("#sq-vto-popup-render-btn")?.addEventListener("click", () => {
        void this.runPopupRender();
      });

      // "See full widget" link — dispatches cross-surface request-tryon.
      popup.querySelector("#sq-vto-popup-full-link")?.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("stylique:request-tryon", {
          detail: { mode: "model", productIds, comboName, autoRender: false },
        }));
        this.closeVTOPopup();
      });

      // Ken Burns + tilt on a rendered image.
      if (renderImage) {
        const img = popup.querySelector<HTMLImageElement>("#sq-vto-popup-img");
        if (img) {
          img.style.animation = "sq-ken-burns 12s ease-in-out infinite alternate";
          const area = popup.querySelector<HTMLElement>(".sq-vto-popup__render-area");
          if (area) {
            area.addEventListener("mousemove", (e) => {
              const rect = area.getBoundingClientRect();
              const dx = ((e.clientX - rect.left) / rect.width - 0.5) * 10;
              const dy = ((e.clientY - rect.top) / rect.height - 0.5) * -10;
              img.style.animation = "none";
              img.style.transform = `rotateX(${dy}deg) rotateY(${dx}deg) scale(1.01)`;
            });
            area.addEventListener("mouseleave", () => {
              img.style.transform = "";
              img.style.animation = "sq-ken-burns 12s ease-in-out infinite alternate";
            });
          }
        }
      }
    } else {
      // ── Photo tab wiring ────────────────────────────────────────────────
      const attachFileHandlers = (triggerEl: HTMLElement | null) => {
        if (!triggerEl) return;
        const input = popup.querySelector<HTMLInputElement>("#sq-vto-photo-input");
        triggerEl.addEventListener("click", () => input?.click());
        if (input) {
          input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (!file) return;
            void this.handlePhotoFileSelected(file);
          });
        }
      };

      if (!photoDataUrl) {
        // Drop zone: click to open file picker.
        const dropZone = popup.querySelector<HTMLElement>("#sq-vto-drop-zone");
        const input = popup.querySelector<HTMLInputElement>("#sq-vto-photo-input");
        if (dropZone && input) {
          dropZone.addEventListener("click", () => input.click());
          dropZone.addEventListener("keydown", (e) => {
            if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") input.click();
          });
          // Drag-and-drop.
          dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZone.classList.add("drag-over");
          });
          dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
          dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZone.classList.remove("drag-over");
            const file = (e as DragEvent).dataTransfer?.files?.[0];
            if (file) void this.handlePhotoFileSelected(file);
          });
          input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (file) void this.handlePhotoFileSelected(file);
          });
        }
        // "Select photo" button in footer.
        attachFileHandlers(popup.querySelector<HTMLElement>("#sq-vto-photo-upload-btn"));
      } else {
        // Photo already chosen — "Render Try-On" button.
        popup.querySelector("#sq-vto-photo-render-btn")?.addEventListener("click", () => {
          void this.runPhotoRender();
        });
        // "Change photo" resets.
        popup.querySelector("#sq-vto-photo-change-btn")?.addEventListener("click", () => {
          this.vtoState.photoDataUrl = null;
          this.vtoState.photoFileName = null;
          this.vtoState.renderImage = null;
          this.vtoState.renderError = null;
          this.renderVTOPopup();
        });
        // Ken Burns on rendered photo result.
        if (renderImage) {
          const img = popup.querySelector<HTMLImageElement>("#sq-vto-popup-img");
          if (img) {
            img.style.animation = "sq-ken-burns 12s ease-in-out infinite alternate";
          }
        }
      }
    }
  }

  /** Render the selected muse + products via /api/tryon/render. Polls async. */
  private async runPopupRender(): Promise<void> {
    const { productIds, selectedMuseId } = this.vtoState;
    if (!productIds.length || this.vtoState.renderPending) return;

    this.vtoState.renderPending = true;
    this.vtoState.renderError = null;
    this.vtoState.renderImage = null;
    this.renderVTOPopup();

    const effectiveProductId = productIds[0];
    const body: Record<string, unknown> = {
      productId: effectiveProductId,
      mode: "BODY_MODEL",
      modelHint: selectedMuseId,
    };
    if (productIds.length > 1) body.productIds = productIds;

    try {
      const res = await fetch(`${this.apiBase}/api/tryon/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const json = await res.json() as { ok: boolean; data?: { renderId?: string; imageUrl?: string; status?: string; providerKey?: string }; error?: string };

      if (!json.ok || !json.data) {
        this.vtoState.renderPending = false;
        this.vtoState.renderError = "Couldn't render — try again.";
        this.renderVTOPopup();
        return;
      }

      // Sync path — image ready immediately.
      if (json.data.status !== "PENDING" && json.data.imageUrl) {
        this.vtoState.renderPending = false;
        this.vtoState.renderImage = json.data.imageUrl;
        this.renderVTOPopup();
        return;
      }

      // Async path — poll.
      const renderId = json.data.renderId ?? "";
      const POLL_MS = 2000;
      const deadline = Date.now() + 45_000;

      const poll = async (): Promise<void> => {
        if (!this.vtoState.renderPending) return;
        if (Date.now() > deadline) {
          this.vtoState.renderPending = false;
          this.vtoState.renderError = "Render timed out — try again.";
          this.renderVTOPopup();
          return;
        }
        const sr = await fetch(`${this.apiBase}/api/tryon/render/status?renderId=${encodeURIComponent(renderId)}`, { credentials: "include" });
        const sj = await sr.json() as { ok: boolean; data?: { status: string; imageUrl?: string | null } };
        if (sj.ok && sj.data?.status === "SUCCEEDED" && sj.data.imageUrl) {
          this.vtoState.renderPending = false;
          this.vtoState.renderImage = sj.data.imageUrl;
          this.renderVTOPopup();
          return;
        }
        if (sj.ok && sj.data?.status === "FAILED") {
          this.vtoState.renderPending = false;
          this.vtoState.renderError = "Couldn't render — try again.";
          this.renderVTOPopup();
          return;
        }
        window.setTimeout(() => { void poll(); }, POLL_MS);
      };
      window.setTimeout(() => { void poll(); }, POLL_MS);
    } catch {
      this.vtoState.renderPending = false;
      this.vtoState.renderError = "Network error — try again.";
      this.renderVTOPopup();
    }
  }

  /**
   * Handle a File object chosen by the shopper from the "See on me" tab.
   * Validates MIME type (JPEG/PNG/WebP) and size (≤6MB) client-side.
   * Converts to base64 data URL and stores in vtoState — pass-through only,
   * never persisted server-side (D23 / PB17 invariant).
   */
  private async handlePhotoFileSelected(file: File): Promise<void> {
    // Client-side validation — MIME type allowlist.
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      this.vtoState.renderError = "Please upload a JPEG, PNG, or WebP photo.";
      this.renderVTOPopup();
      return;
    }
    // Client-side validation — size cap (6MB).
    if (file.size > 6 * 1024 * 1024) {
      this.vtoState.renderError = "Photo must be under 6MB.";
      this.renderVTOPopup();
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      this.vtoState.photoDataUrl = dataUrl;
      this.vtoState.photoFileName = file.name;
      this.vtoState.renderImage = null;
      this.vtoState.renderError = null;
      this.renderVTOPopup();
    } catch {
      this.vtoState.renderError = "Could not read photo — try again.";
      this.renderVTOPopup();
    }
  }

  /**
   * Fire the render for the "See on me" (personal photo) path.
   * Sends photoDataUrl to /api/tryon/render with mode: "PERSONAL_PHOTO".
   * Same polling loop as model render.
   */
  private async runPhotoRender(): Promise<void> {
    const { productIds, photoDataUrl } = this.vtoState;
    if (!productIds.length || !photoDataUrl || this.vtoState.renderPending) return;

    this.vtoState.renderPending = true;
    this.vtoState.renderError = null;
    this.vtoState.renderImage = null;
    this.renderVTOPopup();

    const effectiveProductId = productIds[0];
    const body: Record<string, unknown> = {
      productId: effectiveProductId,
      mode: "PERSONAL_PHOTO",
      photoDataUrl,
    };
    if (productIds.length > 1) body.productIds = productIds;

    try {
      const res = await fetch(`${this.apiBase}/api/tryon/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const json = await res.json() as { ok: boolean; data?: { renderId?: string; imageUrl?: string; status?: string }; error?: string };

      if (!json.ok || !json.data) {
        this.vtoState.renderPending = false;
        this.vtoState.renderError = "Couldn't render — try again.";
        this.renderVTOPopup();
        return;
      }

      // Sync path — image ready immediately.
      if (json.data.status !== "PENDING" && json.data.imageUrl) {
        this.vtoState.renderPending = false;
        this.vtoState.renderImage = json.data.imageUrl;
        this.renderVTOPopup();
        return;
      }

      // Async path — poll.
      const renderId = json.data.renderId ?? "";
      const POLL_MS = 2000;
      const deadline = Date.now() + 45_000;

      const poll = async (): Promise<void> => {
        if (!this.vtoState.renderPending) return;
        if (Date.now() > deadline) {
          this.vtoState.renderPending = false;
          this.vtoState.renderError = "Render timed out — try again.";
          this.renderVTOPopup();
          return;
        }
        const sr = await fetch(`${this.apiBase}/api/tryon/render/status?renderId=${encodeURIComponent(renderId)}`, { credentials: "include" });
        const sj = await sr.json() as { ok: boolean; data?: { status: string; imageUrl?: string | null } };
        if (sj.ok && sj.data?.status === "SUCCEEDED" && sj.data.imageUrl) {
          this.vtoState.renderPending = false;
          this.vtoState.renderImage = sj.data.imageUrl;
          this.renderVTOPopup();
          return;
        }
        if (sj.ok && sj.data?.status === "FAILED") {
          this.vtoState.renderPending = false;
          this.vtoState.renderError = "Couldn't render — try again.";
          this.renderVTOPopup();
          return;
        }
        window.setTimeout(() => { void poll(); }, POLL_MS);
      };
      window.setTimeout(() => { void poll(); }, POLL_MS);
    } catch {
      this.vtoState.renderPending = false;
      this.vtoState.renderError = "Network error — try again.";
      this.renderVTOPopup();
    }
  }

  // ─── Open / close ─────────────────────────────────────────────────────
  private toggle(open: boolean) {
    if (open && !this.open) {
      this.openedAt = Date.now();
      this.track("CHAT_OPENED", { surface: "dock" });
      // Fetch the personalised opener (returning-shopper recall) the first
      // time the dock opens this page life. Fire-and-forget; the greeting
      // re-renders when the response lands.
      if (this.serverOpener === null) void this.hydrateOpener();
    } else if (!open && this.open) {
      this.track("CHAT_CLOSED", {
        dwellMs: Date.now() - this.openedAt,
        turns: this.state.messages.length,
      });
    }
    this.open = open;
    if (open) {
      // Yield to any other Stylique surface that was already showing a modal.
      document.dispatchEvent(new CustomEvent("stylique:surface-open", { detail: { source: "stylist" } }));
      this.renderOpen();
    } else {
      this.renderClosed();
    }
  }

  private async hydrateOpener() {
    try {
      const handle = (/\/products\/([^/?#]+)/.exec(location.pathname) || [])[1];
      const url = handle ? `${this.apiBase}/api/shopper/opener?handle=${encodeURIComponent(handle)}` : `${this.apiBase}/api/shopper/opener`;
      const res = await fetch(url, { credentials: "include" });
      const json = await res.json();
      if (json?.ok && json.data?.opener) {
        this.serverOpener = json.data.opener as string;
        // Only re-render the greeting bubble if no messages have been sent yet.
        if (!this.state.messages.length && this.open) this.renderThread();
      }
    } catch { /* offline */ }
  }

  // Detect the product handle of the PDP the shopper is currently on.
  private detectCurrentPDP(): string | null {
    try {
      const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
      if (ogUrl) {
        const m = ogUrl.match(/\/products\/([^/?#]+)/);
        if (m) return m[1]!;
      }
    } catch { /* ignore */ }
    try {
      const pathMatch = window.location.pathname.match(/\/products\/([^/?#]+)/);
      if (pathMatch) return pathMatch[1]!;
    } catch { /* ignore */ }
    try {
      const sa = (window as unknown as Record<string, unknown>)?.ShopifyAnalytics as Record<string, unknown> | undefined;
      const handle = (sa?.meta as Record<string, unknown> | undefined)?.product as Record<string, unknown> | undefined;
      if (handle?.handle && typeof handle.handle === "string") return handle.handle;
    } catch { /* ignore */ }
    return null;
  }

  // ─── Send a message + handle the response (combos + actions) ──────────
  private async sendMessage(text: string, imageDataUrl?: string) {
    this.state.messages.push({ role: "user", text, imageDataUrl });
    this.state.sending = true;
    this.track("CHAT_MESSAGE_SENT", {
      length: text.length,
      hasImage: !!imageDataUrl,
    });
    this.renderThread();

    const pdpHandle = this.detectCurrentPDP();
    const requestBody = JSON.stringify({
      messages: [{ role: "user", text, ...(imageDataUrl ? { imageDataUrl } : {}) }],
      ...(pdpHandle ? { currentProductHandle: pdpHandle } : {}),
      ...(this.intentEngine ? { intentContext: this.intentEngine.getContext() } : {}),
    });

    // Try the streaming endpoint first; fall back to the non-streaming path if
    // the stream cannot be established (e.g. older proxy, network error).
    let usedStream = false;
    try {
      const res = await fetch(`${this.apiBase}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        credentials: "include",
      });

      if (res.ok && res.body) {
        usedStream = true;
        const reader = res.body.getReader();
        let gotReply = false;

        for await (const evt of parseSSE(reader)) {
          const e = evt as Record<string, unknown>;
          if (e.event === "error") {
            this.state.sending = false;
            this.state.messages.push({
              role: "model",
              text: "Sorry — I had trouble connecting. Try that again?",
            });
            this.renderThread();
            return;
          }

          if (e.event === "reply") {
            gotReply = true;
            this.state.sending = false;
            const data = e as unknown as ChatReply & { event: string };

            // Inject combos.
            const modelMsg: ChatMsg = {
              role: "model",
              text: data.reply,
              combos: data.combos,
            };

            // If the agent asked for an add-to-cart, attach a pending-cart
            // object so we render the confirm card under this message.
            const cartReq = data.actions.find(
              (a) => a.kind === "add_to_cart_request",
            );
            if (
              cartReq &&
              cartReq.kind === "add_to_cart_request" &&
              cartReq.productId
            ) {
              const product = this.findProductInCombos(
                cartReq.productId,
                data.combos,
              );
              if (product) {
                modelMsg.pendingCart = {
                  product,
                  suggestedSize: cartReq.suggestedSize,
                  qty: 1,
                  status: "open",
                };
              }
            }

            // Soft account offer.
            const signup = data.actions.find(
              (a) => a.kind === "show_signup_card",
            );
            if (
              signup &&
              signup.kind === "show_signup_card" &&
              !this.me?.accountClaimed
            ) {
              modelMsg.pendingSignup = {
                reason: signup.reason,
                status: "open",
              };
            }

            this.state.messages.push(modelMsg);
            this.renderThread();

            // Auth overlay: show after profile capture if shopper hasn't dismissed 2× yet.
            if (signup && signup.kind === "show_signup_card" && !this.me?.accountClaimed) {
              const dismissCount = parseInt(
                (typeof localStorage !== "undefined" && localStorage.getItem("sq_auth_dismissed_count")) || "0",
                10,
              );
              if (dismissCount < 2) {
                setTimeout(() => {
                  renderAuthOverlay(document.body, {
                    apiBase: this.apiBase,
                    context: "save_sizes",
                    onSuccess: () => { void this.hydrateMe(); },
                  });
                }, 800);
              }
            }

            // Navigation actions — show a preview card first, navigate after dismiss or 8s.
            const nav = data.actions.find((a) => a.kind === "navigate");
            if (nav && nav.kind === "navigate" && nav.handle) {
              // Try to find the product in the combo data so we can show a rich preview.
              const navProduct = data.combos.flatMap((c) => c.products).find(
                (p) => p.handle === nav.handle || p.id === nav.handle,
              ) ?? null;
              if (navProduct) {
                this.showProductPreview({
                  id: navProduct.id,
                  title: navProduct.title,
                  imageUrl: navProduct.imageUrl,
                  price: "",
                  handle: nav.handle,
                });
              } else {
                // No product data available — navigate directly.
                setTimeout(() => { location.href = `/products/${nav.handle}`; }, 700);
              }
            }

            // Try-on cross-surface trigger.
            // NOTE: do NOT track an event here — the actual TRYON_RENDER_REQUESTED
            // event fires inside index.ts runTryOnRender() once the render call
            // succeeds. Emitting CHAT_NAV_REQUESTED here was incorrect (wrong name
            // and wrong payload shape vs EventNameSchema).
            const tryon = data.actions.find((a) => a.kind === "open_tryon");
            if (tryon && tryon.kind === "open_tryon" && tryon.productIds.length) {
              setTimeout(() => {
                // Open compact VTO popup above the dock. Dock stays visible and compact.
                // openVTOPopup() also dispatches stylique:request-tryon as a
                // secondary fallback so standalone widget users on PDPs still work.
                this.openVTOPopup(tryon.productIds, tryon.comboName ?? "", tryon.mode === "photo");
              }, 600);
            }

            // Studio cross-surface trigger — open Creative Studio when Mira
            // emits open_studio (fired by the request_creative_set tool handler).
            const studio = data.actions.find((a) => a.kind === "open_studio");
            if (studio && studio.kind === "open_studio") {
              setTimeout(() => {
                document.dispatchEvent(new CustomEvent("stylique:open-studio", {
                  detail: { sourceComboName: studio.sourceComboName, productIds: studio.productIds },
                  bubbles: true,
                }));
              }, 600);
            }

            // lead_browse — show preview card then navigate.
            const lb = data.actions.find((a) => a.kind === "lead_browse");
            if (lb && lb.kind === "lead_browse") {
              this.showProductPreview({
                id: lb.productId ?? "",
                title: lb.title,
                imageUrl: lb.imageUrl ?? null,
                price: "",
                handle: lb.handle,
              });
              if (lb.arrivalFocus) this.state.pendingArrivalFocus = lb.arrivalFocus;
              setTimeout(() => { window.location.href = `/products/${lb.handle}`; }, 1400);
            }

            // guide_combo_walkthrough — start stepped combo tour.
            const wt = data.actions.find((a) => a.kind === "guide_combo_walkthrough");
            if (wt && wt.kind === "guide_combo_walkthrough") {
              setTimeout(() => { this.startComboWalkthrough(wt.comboName, wt.steps); }, 400);
            }

            // highlight_product_detail — annotate a garment zone on PDP.
            const hl = data.actions.find((a) => a.kind === "highlight_product_detail");
            if (hl && hl.kind === "highlight_product_detail") {
              setTimeout(() => { this.highlightProductDetail(hl.detail, hl.imageZone ?? "full"); }, 500);
            }

            // show_size_recommendation — floating size card.
            const srec = data.actions.find((a) => a.kind === "show_size_recommendation");
            if (srec && srec.kind === "show_size_recommendation") {
              setTimeout(() => { this.showSizeRecommendationCard(srec.productId, srec.productTitle, srec.recommendation); }, 400);
            }

            // collect_fit_for_sizing — inline fit form.
            const cf = data.actions.find((a) => a.kind === "collect_fit_for_sizing");
            if (cf && cf.kind === "collect_fit_for_sizing") {
              setTimeout(() => { this.showFitCollectionCard(cf.productId, cf.productTitle); }, 400);
            }
          }

          if (e.event === "done") {
            if (!gotReply) {
              // done arrived without a reply — treat as an error
              this.state.sending = false;
              this.state.messages.push({
                role: "model",
                text: "Sorry — I had trouble connecting. Try that again?",
              });
              this.renderThread();
            }
            return;
          }
        }

        // Reader exhausted without a done event — still clean up.
        if (!gotReply) {
          this.state.sending = false;
          this.state.messages.push({
            role: "model",
            text: "Network hiccup — try again?",
          });
          this.renderThread();
        }
        return;
      }
    } catch {
      // Stream failed — fall through to non-streaming path.
    }

    // ── Non-streaming fallback (original api/chat path) ───────────────────
    if (usedStream) return; // only reach here if fetch itself threw
    try {
      const res = await fetch(`${this.apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        credentials: "include",
      });
      const json = (await res.json()) as ApiResp<ChatReply>;
      this.state.sending = false;
      if (!json.ok) {
        this.state.messages.push({
          role: "model",
          text: "Sorry — I had trouble connecting. Try that again?",
        });
        this.renderThread();
        return;
      }
      const data = json.data;

      // Inject combos.
      const modelMsg: ChatMsg = {
        role: "model",
        text: data.reply,
        combos: data.combos,
      };

      // If the agent asked for an add-to-cart, attach a pending-cart object so
      // we render the confirm card under this message.
      const cartReq = data.actions.find((a) => a.kind === "add_to_cart_request");
      if (cartReq && cartReq.kind === "add_to_cart_request" && cartReq.productId) {
        const product = this.findProductInCombos(cartReq.productId, data.combos);
        if (product) {
          modelMsg.pendingCart = {
            product,
            suggestedSize: cartReq.suggestedSize,
            qty: 1,
            status: "open",
          };
        }
      }

      // Multi-item outfit add — fired by add_outfit_to_cart tool.
      const outfitReq = data.actions.find((a) => a.kind === "add_outfit_to_cart");
      if (outfitReq && outfitReq.kind === "add_outfit_to_cart" && outfitReq.items?.length) {
        void this.performOutfitAddAll(outfitReq.items, outfitReq.comboName ?? "mira_outfit");
      }

      // Soft account offer.
      const signup = data.actions.find((a) => a.kind === "show_signup_card");
      if (signup && signup.kind === "show_signup_card" && !this.me?.accountClaimed) {
        modelMsg.pendingSignup = { reason: signup.reason, status: "open" };
      }

      this.state.messages.push(modelMsg);
      this.renderThread();

      // Auth overlay: show after profile capture if shopper hasn't dismissed 2× yet.
      const signupNS = data.actions.find((a) => a.kind === "show_signup_card");
      if (signupNS && signupNS.kind === "show_signup_card" && !this.me?.accountClaimed) {
        const dismissCount = parseInt(
          (typeof localStorage !== "undefined" && localStorage.getItem("sq_auth_dismissed_count")) || "0",
          10,
        );
        if (dismissCount < 2) {
          setTimeout(() => {
            renderAuthOverlay(document.body, {
              apiBase: this.apiBase,
              context: "save_sizes",
              onSuccess: () => { void this.hydrateMe(); },
            });
          }, 800);
        }
      }

      // Navigation actions — show a preview card first, navigate after dismiss or 8s.
      const nav = data.actions.find((a) => a.kind === "navigate");
      if (nav && nav.kind === "navigate" && nav.handle) {
        const navProduct = data.combos.flatMap((c) => c.products).find(
          (p) => p.handle === nav.handle || p.id === nav.handle,
        ) ?? null;
        if (navProduct) {
          this.showProductPreview({
            id: navProduct.id,
            title: navProduct.title,
            imageUrl: navProduct.imageUrl,
            price: "",
            handle: nav.handle,
          });
        } else {
          setTimeout(() => { location.href = `/products/${nav.handle}`; }, 700);
        }
      }

      // Try-on cross-surface trigger. No track call here — see comment in the
      // JSON path above. TRYON_RENDER_REQUESTED fires inside runTryOnRender().
      const tryon = data.actions.find((a) => a.kind === "open_tryon");
      if (tryon && tryon.kind === "open_tryon" && tryon.productIds.length) {
        setTimeout(() => {
          // Open the compact VTO popup above the Mira dock.
          // openVTOPopup() also dispatches stylique:request-tryon as a
          // secondary fallback so standalone widget users on PDPs still work.
          this.openVTOPopup(tryon.productIds, tryon.comboName ?? "", tryon.mode === "photo");
        }, 600);
      }

      // Studio cross-surface trigger (JSON/non-streaming path).
      const studio = data.actions.find((a) => a.kind === "open_studio");
      if (studio && studio.kind === "open_studio") {
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent("stylique:open-studio", {
            detail: { sourceComboName: studio.sourceComboName, productIds: studio.productIds },
            bubbles: true,
          }));
        }, 600);
      }

      // lead_browse (non-streaming path).
      const lb = data.actions.find((a) => a.kind === "lead_browse");
      if (lb && lb.kind === "lead_browse") {
        this.showProductPreview({
          id: lb.productId ?? "",
          title: lb.title,
          imageUrl: lb.imageUrl ?? null,
          price: "",
          handle: lb.handle,
        });
        if (lb.arrivalFocus) this.state.pendingArrivalFocus = lb.arrivalFocus;
        setTimeout(() => { window.location.href = `/products/${lb.handle}`; }, 1400);
      }

      // guide_combo_walkthrough (non-streaming path).
      const wt = data.actions.find((a) => a.kind === "guide_combo_walkthrough");
      if (wt && wt.kind === "guide_combo_walkthrough") {
        setTimeout(() => { this.startComboWalkthrough(wt.comboName, wt.steps); }, 400);
      }

      // highlight_product_detail (non-streaming path).
      const hl = data.actions.find((a) => a.kind === "highlight_product_detail");
      if (hl && hl.kind === "highlight_product_detail") {
        setTimeout(() => { this.highlightProductDetail(hl.detail, hl.imageZone ?? "full"); }, 500);
      }

      // show_size_recommendation (non-streaming path).
      const srec = data.actions.find((a) => a.kind === "show_size_recommendation");
      if (srec && srec.kind === "show_size_recommendation") {
        setTimeout(() => { this.showSizeRecommendationCard(srec.productId, srec.productTitle, srec.recommendation); }, 400);
      }

      // collect_fit_for_sizing (non-streaming path).
      const cf = data.actions.find((a) => a.kind === "collect_fit_for_sizing");
      if (cf && cf.kind === "collect_fit_for_sizing") {
        setTimeout(() => { this.showFitCollectionCard(cf.productId, cf.productTitle); }, 400);
      }
    } catch {
      this.state.sending = false;
      this.state.messages.push({ role: "model", text: "Network hiccup — try again?" });
      this.renderThread();
    }
  }

  private findProductInCombos(productId: string, combos: ChatCombo[]): ChatProduct | null {
    for (const c of combos) for (const p of c.products) if (p.id === productId) return p;
    return null;
  }

  // ─── Combo Walkthrough ──────────────────────────────────────────────────
  /**
   * Start a step-by-step guided tour through a combo.
   * Shows a walkthrough bar at the top of the scroll area + the first step's
   * product card with Mira's "why it works for you" commentary.
   */
  private startComboWalkthrough(comboName: string, steps: WalkthroughStep[]): void {
    if (!steps.length) return;
    this.state.walkthrough = { steps, currentIndex: 0, comboName };
    this.renderThread();
    this.renderWalkthroughStep();
  }

  private renderWalkthroughStep(): void {
    const wt = this.state.walkthrough;
    if (!wt) return;
    const scroll = this.root().querySelector<HTMLElement>("#sq-stl-scroll");
    if (!scroll) return;

    // Remove any existing walkthrough bar + step.
    this.root().querySelector(".sq-walkthrough-bar")?.remove();

    // Insert the walkthrough bar right above the scroll area.
    const dock = this.root().querySelector<HTMLElement>(".sq-stl-dock");
    const barEl = document.createElement("div");
    barEl.className = "sq-walkthrough-bar";
    barEl.innerHTML = `
      <span class="sq-walkthrough-label">Exploring: ${esc(wt.comboName)} — Step ${wt.currentIndex + 1}/${wt.steps.length}</span>
      <div class="sq-walkthrough-progress">
        ${wt.steps.map((_, i) => `<div class="sq-walkthrough-dot${i === wt.currentIndex ? " active" : ""}"></div>`).join("")}
      </div>
      <button class="sq-walkthrough-skip" type="button" aria-label="Skip walkthrough">×</button>`;
    if (dock && scroll) {
      dock.insertBefore(barEl, scroll);
    }
    barEl.querySelector(".sq-walkthrough-skip")?.addEventListener("click", () => {
      this.state.walkthrough = null;
      barEl.remove();
      const stepEl = scroll?.querySelector(".sq-walkthrough-step");
      stepEl?.remove();
      const summaryEl = scroll?.querySelector(".sq-walkthrough-summary");
      summaryEl?.remove();
    });

    // Remove any existing step card from the scroll area.
    scroll.querySelectorAll(".sq-walkthrough-step, .sq-walkthrough-summary").forEach(el => el.remove());

    if (wt.currentIndex >= wt.steps.length) {
      // Show final summary card.
      this.renderWalkthroughSummary(scroll, wt, barEl);
      return;
    }

    const step = wt.steps[wt.currentIndex]!;
    const stepEl = document.createElement("div");
    stepEl.className = "sq-walkthrough-step";

    const imgHtml = step.imageUrl
      ? `<img class="sq-walkthrough-step__img" src="${esc(step.imageUrl)}" alt="${esc(step.title)}" loading="lazy">`
      : `<div class="sq-walkthrough-step__img-placeholder">🧥</div>`;

    const isLast = wt.currentIndex === wt.steps.length - 1;
    stepEl.innerHTML = `
      ${imgHtml}
      <div class="sq-walkthrough-step__title">${esc(step.title)}</div>
      <div class="sq-walkthrough-step__why">${esc(step.whyItWorksForYou)}</div>
      <button class="sq-walkthrough-next" type="button">
        ${isLast ? "See the full look →" : "Next piece →"}
      </button>`;
    scroll.appendChild(stepEl);
    scroll.scrollTop = scroll.scrollHeight;

    stepEl.querySelector(".sq-walkthrough-next")?.addEventListener("click", () => {
      wt.currentIndex += 1;
      this.renderWalkthroughStep();
    });

    // Navigate to PDP on image/title click.
    stepEl.querySelector(".sq-walkthrough-step__img, .sq-walkthrough-step__img-placeholder")?.addEventListener("click", () => {
      window.location.href = `/products/${step.handle}`;
    });
  }

  private renderWalkthroughSummary(
    scroll: HTMLElement,
    wt: NonNullable<typeof this.state.walkthrough>,
    barEl: HTMLElement,
  ): void {
    const summaryEl = document.createElement("div");
    summaryEl.className = "sq-walkthrough-summary";

    const thumbsHtml = wt.steps.map(s =>
      s.imageUrl ? `<img class="sq-walkthrough-summary__thumb" src="${esc(s.imageUrl)}" alt="${esc(s.title)}" loading="lazy">` : ""
    ).join("");

    const productIds = wt.steps.map(s => s.productId).join(",");

    summaryEl.innerHTML = `
      <div class="sq-walkthrough-summary__title">The full look: ${esc(wt.comboName)}</div>
      <div class="sq-walkthrough-summary__grid">${thumbsHtml}</div>
      <div class="sq-walkthrough-summary__actions">
        <button class="sq-walkthrough-next" id="sq-wt-tryon" type="button" style="text-align:center">Try the whole look →</button>
        <button class="sq-stl-btn sq-stl-btn--ghost" id="sq-wt-addall" type="button">Add all to bag</button>
      </div>`;
    scroll.appendChild(summaryEl);
    scroll.scrollTop = scroll.scrollHeight;

    summaryEl.querySelector("#sq-wt-tryon")?.addEventListener("click", () => {
      void this.trackEvent("COMBO_TRYON_REQUESTED", undefined, { comboName: wt.comboName });
      this.openVTOPopup(wt.steps.map(s => s.productId), wt.comboName);
      this.state.walkthrough = null;
      barEl.remove();
    });

    const addAllBtn = summaryEl.querySelector<HTMLButtonElement>("#sq-wt-addall")!;
    addAllBtn.addEventListener("click", () => {
      const ids = wt.steps.map(s => s.productId);
      if (ids.length >= 2) {
        this.showCartSummary(
          wt.steps.map(s => ({ title: s.title, size: "M", imageUrl: s.imageUrl ?? "", price: "" })),
          () => { void this.performComboAddAll(addAllBtn, wt.comboName, ids); },
          () => { /* dismissed — no-op */ },
        );
      } else {
        void this.performComboAddAll(addAllBtn, wt.comboName, ids);
      }
      this.state.walkthrough = null;
      barEl.remove();
    });
  }

  // ─── Highlight Product Detail ──────────────────────────────────────────
  /**
   * Draw a floating annotation card pointing at the main product image on the
   * current PDP. Wraps all DOM queries in try/catch — the selectors may not
   * match every Shopify theme.
   */
  private highlightProductDetail(detail: string, zone: string): void {
    // Ensure styles are injected into the main document.
    if (!document.getElementById("sq-highlight-style")) {
      const styleEl = document.createElement("style");
      styleEl.id = "sq-highlight-style";
      styleEl.textContent = `
        .sq-highlight-annotation {
          position: fixed;
          background: white;
          border: 2px solid #1a1a1a;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 13px;
          max-width: 220px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          z-index: 10002;
          animation: sq-annotation-in 0.3s ease;
          font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;
          color: #1a1a1a;
          line-height: 1.45;
        }
        @keyframes sq-annotation-in {
          from { opacity: 0; transform: scale(0.9); }
          to   { opacity: 1; transform: scale(1); }
        }
        .sq-highlight-annotation__close {
          position: absolute; top: 6px; right: 8px;
          background: none; border: none; cursor: pointer;
          font-size: 16px; color: #888; padding: 0; line-height: 1;
        }
        .sq-highlight-overlay-ring {
          position: fixed; pointer-events: none; z-index: 10001;
          border: 2px solid rgba(139,92,246,0.6);
          border-radius: 8px;
          box-shadow: 0 0 0 4px rgba(139,92,246,0.15);
          animation: sq-ring-pulse 1.5s ease-in-out infinite;
        }
        @keyframes sq-ring-pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(139,92,246,0.15); }
          50%  { box-shadow: 0 0 0 8px rgba(139,92,246,0.08); }
        }
        .sq-highlight-zoom {
          transform: scale(1.03);
          transition: transform 0.4s ease;
        }
      `;
      document.head.appendChild(styleEl);
    }

    try {
      // Find the main product image using common Shopify theme selectors.
      const img = document.querySelector<HTMLImageElement>(
        '.product__media img, .product-media img, [data-product-media] img, .product-single__photo img, .product-featured-img, [class*="product"] [class*="media"] img'
      );
      if (!img) return;

      const rect = img.getBoundingClientRect();

      // Add zoom effect.
      img.classList.add("sq-highlight-zoom");

      // Overlay ring positioned on the image.
      let ringTop = rect.top;
      let ringLeft = rect.left;
      let ringWidth = rect.width;
      let ringHeight = rect.height;

      // Adjust ring to the specified zone.
      if (zone === "top") { ringHeight = rect.height * 0.45; }
      else if (zone === "bottom") { ringTop += rect.height * 0.55; ringHeight = rect.height * 0.45; }
      else if (zone === "left") { ringWidth = rect.width * 0.45; }
      else if (zone === "right") { ringLeft += rect.width * 0.55; ringWidth = rect.width * 0.45; }

      const ring = document.createElement("div");
      ring.className = "sq-highlight-overlay-ring";
      ring.style.cssText = `top:${ringTop}px;left:${ringLeft}px;width:${ringWidth}px;height:${ringHeight}px;`;
      document.body.appendChild(ring);

      // Position annotation card.
      const card = document.createElement("div");
      card.className = "sq-highlight-annotation";

      const isMobile = window.innerWidth <= 768;
      let cardTop: number;
      let cardLeft: number;

      if (isMobile) {
        // Below the image on mobile.
        cardTop = Math.min(rect.bottom + 10, window.innerHeight - 140);
        cardLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 236));
      } else {
        // Left of the image on desktop.
        cardTop = Math.max(20, rect.top + rect.height / 2 - 60);
        cardLeft = Math.max(8, rect.left - 240);
        // If not enough space on the left, go right.
        if (rect.left < 250) cardLeft = rect.right + 16;
      }

      card.style.cssText = `top:${cardTop}px;left:${cardLeft}px;`;
      card.innerHTML = `
        <button class="sq-highlight-annotation__close" type="button" aria-label="Dismiss">×</button>
        ${esc(detail)}`;
      document.body.appendChild(card);

      const cleanup = () => {
        try { ring.remove(); } catch { /* ignore */ }
        try { card.remove(); } catch { /* ignore */ }
        try { img.classList.remove("sq-highlight-zoom"); } catch { /* ignore */ }
      };

      card.querySelector(".sq-highlight-annotation__close")?.addEventListener("click", cleanup);
      const timer = setTimeout(cleanup, 6000);
      card.addEventListener("click", () => { clearTimeout(timer); cleanup(); });

    } catch {
      // No product image found on this page — silently no-op.
    }
  }

  // ─── Size Recommendation Card ─────────────────────────────────────────
  /**
   * Show a floating size recommendation card — similar to productPreview card
   * but with size badge, confidence dots, trust line, and alternative sizes.
   */
  private showSizeRecommendationCard(
    _productId: string,
    productTitle: string,
    recommendation: SizeRecommendation,
  ): void {
    // Ensure styles are in the main document.
    if (!document.getElementById("sq-size-rec-style")) {
      const styleEl = document.createElement("style");
      styleEl.id = "sq-size-rec-style";
      styleEl.textContent = `
        .sq-size-rec-popup {
          position: fixed; bottom: 120px; right: 440px; width: 280px;
          background: white; border-radius: 14px;
          box-shadow: 0 6px 30px rgba(0,0,0,0.15); z-index: 9999;
          overflow: hidden; animation: sq-preview-in 0.25s ease;
          font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;
          padding: 16px 18px;
        }
        .sq-size-rec-popup__title { font-size: 12px; color: #888; margin-bottom: 10px; }
        .sq-size-rec-popup__badge { display: flex; align-items: flex-end; gap: 10px; margin-bottom: 8px; }
        .sq-size-rec-popup__size { font-size: 44px; font-weight: 700; color: #1a1a1a; line-height: 1; }
        .sq-size-rec-popup__rec-label { font-size: 12px; color: #6B46C1; font-weight: 500; padding-bottom: 6px; }
        .sq-size-rec-popup__confidence { display: flex; gap: 3px; margin-bottom: 8px; }
        .sq-size-rec-popup__dot { width: 8px; height: 8px; border-radius: 50%; background: #e5e7eb; }
        .sq-size-rec-popup__dot.filled { background: #8B5CF6; }
        .sq-size-rec-popup__trust { font-size: 11.5px; color: #666; line-height: 1.5; margin-bottom: 12px; }
        .sq-size-rec-popup__alts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
        .sq-size-rec-popup__alt {
          padding: 4px 12px; border-radius: 999px;
          border: 1px solid #e5e7eb; background: white;
          font-size: 12px; color: #666; cursor: pointer; font-family: inherit;
          transition: all .15s;
        }
        .sq-size-rec-popup__alt:hover, .sq-size-rec-popup__alt.selected {
          border-color: #8B5CF6; color: #8B5CF6;
        }
        .sq-size-rec-popup__actions { display: flex; gap: 8px; }
        .sq-size-rec-popup__btn {
          flex: 1; padding: 8px 0; border-radius: 8px; font-size: 12px;
          font-weight: 500; cursor: pointer; border: none; font-family: inherit; text-align: center;
        }
        .sq-size-rec-popup__btn--primary { background: #1a1a1a; color: white; }
        .sq-size-rec-popup__btn--primary:hover { opacity: .88; }
        .sq-size-rec-popup__btn--secondary { background: #f5f5f5; color: #1a1a1a; }
        .sq-size-rec-popup__btn--secondary:hover { background: #ebebeb; }
        .sq-size-rec-popup__close {
          position: absolute; top: 8px; right: 10px; background: none;
          border: none; font-size: 18px; color: #aaa; cursor: pointer; font-family: inherit;
        }
        @media (max-width: 768px) {
          .sq-size-rec-popup { right: 0; left: 0; bottom: 80px; width: 100%; border-radius: 14px 14px 0 0; }
        }
      `;
      document.head.appendChild(styleEl);
    }

    // Dismiss any existing size-rec popup.
    document.getElementById("sq-size-rec-popup")?.remove();

    const { recommendedSize, confidence, trustLine, alternativeSizes } = recommendation;
    const filledDots = Math.round(confidence * 5);

    const popup = document.createElement("div");
    popup.id = "sq-size-rec-popup";
    popup.className = "sq-size-rec-popup";

    const dotsHtml = Array.from({ length: 5 }, (_, i) =>
      `<div class="sq-size-rec-popup__dot${i < filledDots ? " filled" : ""}"></div>`
    ).join("");

    const altsHtml = alternativeSizes.map(s =>
      `<button class="sq-size-rec-popup__alt${s === recommendedSize ? " selected" : ""}" data-size="${esc(s)}" type="button">${esc(s)}</button>`
    ).join("");

    popup.innerHTML = `
      <button class="sq-size-rec-popup__close" type="button" aria-label="Close">×</button>
      <div class="sq-size-rec-popup__title">${esc(productTitle)}</div>
      <div class="sq-size-rec-popup__badge">
        <div class="sq-size-rec-popup__size">${esc(recommendedSize)}</div>
        <div class="sq-size-rec-popup__rec-label">Recommended for you</div>
      </div>
      <div class="sq-size-rec-popup__confidence">${dotsHtml}</div>
      <div class="sq-size-rec-popup__trust">${esc(trustLine)}</div>
      <div class="sq-size-rec-popup__alts">${altsHtml}</div>
      <div class="sq-size-rec-popup__actions">
        <button class="sq-size-rec-popup__btn sq-size-rec-popup__btn--secondary" id="sq-srec-tryon" type="button">Try on →</button>
        <button class="sq-size-rec-popup__btn sq-size-rec-popup__btn--primary" id="sq-srec-addcart" type="button">Add in ${esc(recommendedSize)}</button>
      </div>`;

    document.body.appendChild(popup);

    let selectedSize = recommendedSize;

    popup.querySelector(".sq-size-rec-popup__close")?.addEventListener("click", () => popup.remove());

    popup.querySelectorAll<HTMLButtonElement>(".sq-size-rec-popup__alt").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedSize = btn.dataset.size ?? selectedSize;
        popup.querySelectorAll(".sq-size-rec-popup__alt").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        const addBtn = popup.querySelector<HTMLButtonElement>("#sq-srec-addcart");
        if (addBtn) addBtn.textContent = `Add in ${selectedSize}`;
      });
    });

    popup.querySelector("#sq-srec-tryon")?.addEventListener("click", () => {
      popup.remove();
      this.openVTOPopup([_productId], productTitle);
    });

    popup.querySelector("#sq-srec-addcart")?.addEventListener("click", () => {
      popup.remove();
      // Dispatch a cart-add for this product at the selected size.
      document.dispatchEvent(new CustomEvent("stylique:add-size", {
        detail: { productId: _productId, size: selectedSize },
      }));
      this.toast(`Adding ${esc(selectedSize)} to your bag…`);
    });
  }

  // ─── Fit Collection Card ─────────────────────────────────────────────
  /**
   * Show an inline fit-collection card inside the chat scroll area so Mira
   * can gather height/weight/pref before giving a size recommendation.
   * On submit, POSTs to /api/shopper/fit and shows a "Getting your size…" message.
   */
  private showFitCollectionCard(productId: string, productTitle: string): void {
    const scroll = this.root().querySelector<HTMLElement>("#sq-stl-scroll");
    if (!scroll) return;

    const card = document.createElement("div");
    card.className = "sq-fit-collect-card";
    card.innerHTML = `
      <div class="sq-fit-collect-card__title">Quick fit check for ${esc(productTitle)}</div>
      <div class="sq-fit-collect-card__sub">Takes 10 seconds. Mira uses this to find your exact size.</div>
      <div class="sq-fit-collect-row">
        <div>
          <label class="sq-fit-collect-label">Height (cm or ft/in)</label>
          <input class="sq-fit-collect-input" id="sq-fc-height" type="text" placeholder='e.g. 165 or 5\'5"' maxlength="20">
        </div>
        <div>
          <label class="sq-fit-collect-label">Weight (kg or lbs)</label>
          <input class="sq-fit-collect-input" id="sq-fc-weight" type="text" placeholder="e.g. 65kg or 143lbs" maxlength="20">
        </div>
      </div>
      <div style="margin-bottom:6px"><span class="sq-fit-collect-label">Fit preference</span></div>
      <div class="sq-fit-collect-prefs" id="sq-fc-prefs">
        <button class="sq-fit-collect-pref" data-pref="SLIM" type="button">Slim</button>
        <button class="sq-fit-collect-pref" data-pref="TRUE_TO_SIZE" type="button">True to size</button>
        <button class="sq-fit-collect-pref" data-pref="RELAXED" type="button">Relaxed</button>
        <button class="sq-fit-collect-pref" data-pref="OVERSIZED" type="button">Oversized</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="sq-stl-btn sq-stl-btn--primary" id="sq-fc-submit" type="button" style="flex:1">Get my size →</button>
        <button class="sq-stl-btn sq-stl-btn--ghost" id="sq-fc-skip" type="button">Skip</button>
      </div>`;

    scroll.appendChild(card);
    scroll.scrollTop = scroll.scrollHeight;

    let selectedPref = "TRUE_TO_SIZE";
    card.querySelectorAll<HTMLButtonElement>(".sq-fit-collect-pref").forEach(btn => {
      if (btn.dataset.pref === selectedPref) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        selectedPref = btn.dataset.pref ?? selectedPref;
        card.querySelectorAll(".sq-fit-collect-pref").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
    });

    card.querySelector("#sq-fc-skip")?.addEventListener("click", () => { card.remove(); });

    card.querySelector("#sq-fc-submit")?.addEventListener("click", async () => {
      const heightEl = card.querySelector<HTMLInputElement>("#sq-fc-height");
      const weightEl = card.querySelector<HTMLInputElement>("#sq-fc-weight");
      const height = heightEl?.value.trim() ?? "";
      const weight = weightEl?.value.trim() ?? "";
      if (!height && !weight) {
        if (heightEl) { heightEl.style.borderColor = "#E879C8"; heightEl.focus(); }
        return;
      }
      card.remove();
      void this.sendMessage(
        `I'm ${height || "not sure of my height"}, ${weight || "not sure of my weight"}, and prefer ${selectedPref.toLowerCase().replace(/_/g, " ")} fit. What size should I get for ${productTitle}?`,
      );
      try {
        await fetch(`${this.apiBase}/api/shopper/fit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            productId,
            heightRaw: height,
            weightRaw: weight,
            fitPreference: selectedPref,
          }),
        });
      } catch { /* fire-and-forget */ }
    });
  }

  // ─── Cart Summary Bottom Sheet ───────────────────────────────────────
  /**
   * Show a bottom-sheet confirmation before adding 2+ products to the cart.
   * Only shown when adding multiple items.
   */
  private showCartSummary(
    products: Array<{ title: string; size: string; imageUrl: string; price: string }>,
    onConfirm: () => void,
    onCancel: () => void,
  ): void {
    if (!document.getElementById("sq-cart-summary-style")) {
      const styleEl = document.createElement("style");
      styleEl.id = "sq-cart-summary-style";
      styleEl.textContent = `
        .sq-cart-summary {
          position: fixed; bottom: 0; left: 0; right: 0;
          background: white; border-radius: 18px 18px 0 0;
          box-shadow: 0 -6px 40px rgba(0,0,0,0.18); z-index: 10003;
          padding: 20px 18px 28px;
          font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;
          animation: sq-sheet-up 0.3s ease;
        }
        @keyframes sq-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .sq-cart-summary__header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 16px;
        }
        .sq-cart-summary__heading { font-size: 16px; font-weight: 700; color: #1a1a1a; }
        .sq-cart-summary__close { background: none; border: none; font-size: 20px; color: #aaa; cursor: pointer; }
        .sq-cart-summary__item {
          display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
        }
        .sq-cart-summary__img {
          width: 48px; height: 60px; object-fit: cover; border-radius: 8px; background: #f0f0f0; flex-shrink: 0;
        }
        .sq-cart-summary__img-ph { width: 48px; height: 60px; border-radius: 8px; background: #f0eef5; flex-shrink: 0; }
        .sq-cart-summary__info { flex: 1; }
        .sq-cart-summary__title { font-size: 13px; font-weight: 500; color: #1a1a1a; margin-bottom: 2px; }
        .sq-cart-summary__size {
          display: inline-block; padding: 2px 8px; border-radius: 6px;
          background: #f5f5f5; font-size: 11px; color: #666; margin-top: 2px;
        }
        .sq-cart-summary__price { font-size: 13px; color: #333; font-weight: 500; }
        .sq-cart-summary__total {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 0; border-top: 1px solid #f0f0f0; margin: 8px 0 16px;
          font-size: 14px; font-weight: 600; color: #1a1a1a;
        }
        .sq-cart-summary__actions { display: flex; flex-direction: column; gap: 10px; }
        .sq-cart-summary__btn {
          width: 100%; padding: 14px; border-radius: 999px; border: none;
          font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; text-align: center;
        }
        .sq-cart-summary__btn--primary { background: #1a1a1a; color: white; }
        .sq-cart-summary__btn--primary:hover { opacity: .88; }
        .sq-cart-summary__edit { background: none; border: none; color: #8B5CF6; font-size: 13px; cursor: pointer; text-align: center; font-family: inherit; }
        .sq-cart-summary-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 10002;
          animation: sq-overlay-in .2s ease;
        }
        @keyframes sq-overlay-in { from { opacity: 0; } to { opacity: 1; } }
      `;
      document.head.appendChild(styleEl);
    }

    const overlay = document.createElement("div");
    overlay.className = "sq-cart-summary-overlay";
    document.body.appendChild(overlay);

    const sheet = document.createElement("div");
    sheet.className = "sq-cart-summary";

    // Calculate total if prices are numeric.
    let totalHtml = "";
    const nums = products.map(p => parseFloat(p.price.replace(/[^0-9.]/g, ""))).filter(n => !isNaN(n));
    if (nums.length === products.length) {
      const total = nums.reduce((a, b) => a + b, 0).toFixed(2);
      totalHtml = `<div class="sq-cart-summary__total"><span>Total</span><span>${total}</span></div>`;
    }

    const itemsHtml = products.map(p => {
      const imgHtml = p.imageUrl
        ? `<img class="sq-cart-summary__img" src="${esc(p.imageUrl)}" alt="${esc(p.title)}" loading="lazy">`
        : `<div class="sq-cart-summary__img-ph"></div>`;
      return `
        <div class="sq-cart-summary__item">
          ${imgHtml}
          <div class="sq-cart-summary__info">
            <div class="sq-cart-summary__title">${esc(p.title)}</div>
            <span class="sq-cart-summary__size">Size: ${esc(p.size)}</span>
          </div>
          ${p.price ? `<div class="sq-cart-summary__price">${esc(p.price)}</div>` : ""}
        </div>`;
    }).join("");

    sheet.innerHTML = `
      <div class="sq-cart-summary__header">
        <div class="sq-cart-summary__heading">Adding to your bag</div>
        <button class="sq-cart-summary__close" type="button" aria-label="Close">×</button>
      </div>
      ${itemsHtml}
      ${totalHtml}
      <div class="sq-cart-summary__actions">
        <button class="sq-cart-summary__btn sq-cart-summary__btn--primary" id="sq-cs-confirm" type="button">Add all</button>
        <button class="sq-cart-summary__edit" id="sq-cs-edit" type="button">Edit sizes</button>
      </div>`;

    document.body.appendChild(sheet);

    const dismiss = () => {
      sheet.remove();
      overlay.remove();
    };

    overlay.addEventListener("click", () => { dismiss(); onCancel(); });
    sheet.querySelector(".sq-cart-summary__close")?.addEventListener("click", () => { dismiss(); onCancel(); });

    sheet.querySelector("#sq-cs-confirm")?.addEventListener("click", () => {
      dismiss();
      onConfirm();
    });

    sheet.querySelector("#sq-cs-edit")?.addEventListener("click", () => {
      // Just dismiss and let the shopper interact with walkthrough.
      dismiss();
    });
  }

  // ─── Add to cart against Shopify storefront ───────────────────────────
  private async performAddToCart(msgIdx: number) {
    const m = this.state.messages[msgIdx];
    if (!m?.pendingCart) return;
    const pc = m.pendingCart;

    pc.status = "adding";
    this.renderThread();

    // Shopify storefront Cart API works against /cart/add.js but requires a
    // VARIANT id, not a product id. The product detail page exposes variants
    // via /products/<handle>.js. We fetch that to find the variant matching
    // the chosen size.
    try {
      const detail = await (await fetch(`/products/${pc.product.handle}.js`, { credentials: "same-origin" })).json() as {
        variants: Array<{ id: number; option1: string | null; option2: string | null; option3: string | null; available: boolean; title: string }>;
      };

      const want = (pc.suggestedSize || "").toLowerCase();
      const variant =
        detail.variants.find((v) => v.available && [v.option1, v.option2, v.option3, v.title].some((x) => (x || "").toLowerCase() === want)) ??
        detail.variants.find((v) => v.available) ??
        detail.variants[0];

      if (!variant) throw new Error("no_variant");

      const addRes = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ id: variant.id, quantity: pc.qty }] }),
        credentials: "same-origin",
      });
      if (!addRes.ok) throw new Error("cart_add_failed");

      pc.status = "added";
      this.track("CART_CONFIRMED", {
        productId: pc.product.id,
        size: pc.suggestedSize,
        qty: pc.qty,
      }, pc.product.id);
      // Attribution: this add was driven by Mira's recommendation.
      this.track("CART_FROM_MIRA", {
        productId: pc.product.id,
        source: "mira_recommendation",
        size: pc.suggestedSize,
      }, pc.product.id);
      this.renderThread();
      this.toast(`Added to your bag · ${pc.product.title}`);

      // Tell the storefront (most themes listen for this) that the cart changed.
      document.dispatchEvent(new CustomEvent("cart:updated"));
    } catch (err) {
      pc.status = "failed";
      this.track("CART_FAILED", {
        productId: pc.product.id,
        reason: (err as Error)?.message ?? "unknown",
      }, pc.product.id);
      this.renderThread();
    }
  }

  // ─── Toast ────────────────────────────────────────────────────────────
  private toast(text: string) {
    const old = this.root().querySelector(".sq-stl-toast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.className = "sq-stl-toast";
    t.textContent = text;
    this.root().appendChild(t);
    requestAnimationFrame(() => t.setAttribute("data-show", "true"));
    setTimeout(() => {
      t.setAttribute("data-show", "false");
      setTimeout(() => t.remove(), 300);
    }, 3000);
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────
if (!customElements.get("stylique-stylist")) {
  customElements.define("stylique-stylist", StyliqueStylist);
}

function autoMount() {
  if (document.querySelector("stylique-stylist")) return;
  const el = document.createElement("stylique-stylist");
  document.body.appendChild(el);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoMount);
} else {
  autoMount();
}
