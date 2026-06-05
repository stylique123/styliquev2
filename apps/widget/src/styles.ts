// Stylique design tokens + widget styles.
// Derived from /tmp/stylique-design/stylique-tokens.jsx — single source of truth.
// All rules scoped inside Shadow DOM, so nothing leaks to the storefront.

export const TOKENS = {
  bgBlack:       "#08070A",
  surfaceChar:   "#14111A",
  surfaceGlass:  "rgba(20,18,24,0.62)",
  coolGrey:      "#8E8A99",
  coolGreyDim:   "#5A5663",
  electric:      "#8B5CF6",
  purpleDeep:    "#6D3DEE",
  purplePink:    "#E879C8",
  textPrimary:   "#F4F2EE",
  textSecondary: "#8E8A99",
  textMuted:     "#C9B5FF",
  borderSubtle:  "rgba(255,255,255,0.08)",
  borderStrong:  "rgba(255,255,255,0.14)",
  borderAccent:  "rgba(201,181,255,0.35)",
  gradient:      "linear-gradient(135deg, #8B5CF6 0%, #C26BE6 55%, #E879C8 100%)",
  gradientSoft:  "linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(232,121,200,0.12) 100%)",
  violetGlow:    "radial-gradient(60% 60% at 50% 50%, rgba(139,92,246,0.55) 0%, rgba(232,121,200,0.18) 45%, rgba(0,0,0,0) 70%)",
  easeSpring:    "cubic-bezier(.2,.8,.2,1)",
  easeFade:      "cubic-bezier(.4,0,.2,1)",
} as const;

export const CSS = /* css */`
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
* { font-family: var(--sq-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, sans-serif); -webkit-font-smoothing: antialiased; }

.serif { font-family: "Instrument Serif", "Cormorant Garamond", Georgia, serif; font-weight: 400; }
.mono  { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }

/* ─── Entry card (the floating intelligence popup) ────────────────────── */
.sq-entry {
  position: fixed; right: 16px; bottom: 16px; z-index: 99998;
  width: min(320px, calc(100vw - 32px));
  background: rgba(8,7,10,0.78); backdrop-filter: saturate(140%) blur(16px); -webkit-backdrop-filter: saturate(140%) blur(16px);
  border: 1px solid ${TOKENS.borderAccent};
  border-radius: 18px;
  padding: 16px 18px 14px;
  color: ${TOKENS.textPrimary};
  box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(139,92,246,.06), 0 0 40px rgba(139,92,246,.18);
  transform: translateY(20px) scale(.97); opacity: 0;
  transition: transform .5s ${TOKENS.easeSpring}, opacity .35s ${TOKENS.easeFade};
}
.sq-entry[data-open="true"] { transform: translateY(0) scale(1); opacity: 1; }
.sq-entry__glow {
  position: absolute; inset: -40px; background: ${TOKENS.violetGlow}; opacity: .35; pointer-events: none; z-index: -1;
  animation: sq-pulse 1.8s ${TOKENS.easeFade} infinite;
  will-change: opacity;
}
@keyframes sq-pulse { 0%,100% { opacity: .25 } 50% { opacity: .55 } }

.sq-entry__eyebrow {
  font-size: 9.5px; letter-spacing: 1.4px; text-transform: uppercase; color: ${TOKENS.coolGrey}; margin-bottom: 6px;
  display: flex; align-items: center; gap: 6px;
}
.sq-entry__dot { width: 6px; height: 6px; border-radius: 999px; background: ${TOKENS.electric}; box-shadow: 0 0 8px ${TOKENS.electric}; }
.sq-entry__title { font-size: 18px; line-height: 1.2; margin: 2px 0 8px; }
.sq-entry__title em { font-style: italic; color: ${TOKENS.textMuted}; }
.sq-entry__sub { font-size: 12.5px; color: ${TOKENS.coolGrey}; margin-bottom: 12px; }
.sq-entry__row { display: flex; gap: 8px; align-items: center; }
.sq-entry__cta {
  flex: 1; padding: 10px 16px; border-radius: 999px; border: 0; cursor: pointer;
  background: ${TOKENS.gradient}; color: ${TOKENS.textPrimary};
  font-size: 13.5px; font-weight: 600; letter-spacing: .2px;
  box-shadow: 0 6px 18px rgba(139,92,246,.45), inset 0 1px 0 rgba(255,255,255,.18);
  transition: transform .18s ${TOKENS.easeFade}, filter .18s;
}
.sq-entry__cta:hover { transform: translateY(-1px); filter: brightness(1.08); }
.sq-entry__dismiss {
  background: transparent; border: 0; color: ${TOKENS.coolGreyDim}; cursor: pointer;
  font-size: 18px; line-height: 1; padding: 6px 8px; border-radius: 999px;
}
.sq-entry__dismiss:hover { color: ${TOKENS.textPrimary}; background: rgba(255,255,255,.06); }
.sq-entry__footer { margin-top: 10px; font-size: 9.5px; letter-spacing: 1.2px; color: ${TOKENS.coolGreyDim}; text-transform: uppercase; }

/* Minimized chip (after dismiss) */
.sq-min {
  position: fixed; right: 16px; bottom: 16px; z-index: 99998;
  padding: 8px 14px; border-radius: 999px; cursor: pointer; border: 1px solid ${TOKENS.borderAccent};
  background: ${TOKENS.surfaceGlass}; color: ${TOKENS.textPrimary};
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  font-size: 12px; letter-spacing: .3px; display: inline-flex; align-items: center; gap: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,.4);
}
.sq-min__dot { width: 7px; height: 7px; border-radius: 999px; background: ${TOKENS.gradient}; box-shadow: 0 0 8px ${TOKENS.electric}; }

/* ─── Overlay + Sheet (modal/bottom-sheet) ────────────────────────────── */
.sq-overlay {
  position: fixed; inset: 0; z-index: 99999;
  background: radial-gradient(120% 80% at 50% 0%, rgba(20,16,28,.6) 0%, rgba(0,0,0,.78) 60%);
  display: flex; align-items: flex-end; justify-content: center;
  opacity: 0; transition: opacity .3s ${TOKENS.easeFade};
}
.sq-overlay[data-open="true"] { opacity: 1; }
@media (min-width: 900px) { .sq-overlay { align-items: center; padding: 32px; } }

.sq-sheet {
  width: 100%; max-width: 480px; max-height: 85vh;
  background: ${TOKENS.bgBlack}; color: ${TOKENS.textPrimary};
  border-radius: 28px 28px 0 0;
  display: flex; flex-direction: column; overflow: hidden;
  transform: translateY(30px); transition: transform .55s ${TOKENS.easeSpring};
  border-top: 1px solid ${TOKENS.borderSubtle};
}
.sq-overlay[data-open="true"] .sq-sheet { transform: translateY(0); }

/* Desktop: split overlay — visual canvas left, stylist panel right */
@media (min-width: 900px) {
  .sq-sheet {
    max-width: 1180px; width: 92vw; max-height: 86vh;
    border-radius: 24px;
    flex-direction: row;
    box-shadow: 0 40px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04);
    border: 1px solid ${TOKENS.borderSubtle};
  }
}

/* Header (mobile drag handle + brand + close) */
.sq-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px 8px;
  position: relative;
}
.sq-handle { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); width: 38px; height: 4px; border-radius: 999px; background: rgba(255,255,255,.14); }
@media (min-width: 900px) { .sq-handle { display: none; } }
.sq-brand { font-size: 17px; }
.sq-brand b { font-weight: 400; }
.sq-saved-chip {
  display: inline-flex; align-items: center; gap: 6px;
  margin-left: 10px; padding: 4px 10px; border-radius: 999px;
  font-size: 10.5px; letter-spacing: .4px; color: ${TOKENS.textMuted};
  background: rgba(139,92,246,.12); border: 1px solid ${TOKENS.borderAccent};
}
.sq-saved-chip[hidden] { display: none; }
.sq-brand em { font-style: italic; background: ${TOKENS.gradient}; -webkit-background-clip: text; background-clip: text; color: transparent; }
.sq-close {
  background: transparent; border: 0; color: ${TOKENS.coolGrey}; cursor: pointer;
  font-size: 22px; line-height: 1; padding: 6px 10px; border-radius: 999px;
}
.sq-close:hover { color: ${TOKENS.textPrimary}; background: rgba(255,255,255,.06); }

/* ─── Visual canvas (desktop left side) ──────────────────────────────── */
.sq-canvas {
  display: none;
}
@media (min-width: 900px) {
  .sq-canvas {
    display: block;
    flex: 0 0 52%; position: relative; overflow: hidden;
    background: linear-gradient(160deg, #1A1426 0%, #08070A 100%);
    border-right: 1px solid ${TOKENS.borderSubtle};
  }
  .sq-canvas__glow {
    position: absolute; inset: -10%; background: ${TOKENS.violetGlow}; opacity: .55; pointer-events: none;
  }
  .sq-canvas__inner { position: absolute; inset: 32px; display: flex; flex-direction: column; }
  .sq-canvas__model {
    flex: 1; position: relative; border-radius: 18px; overflow: hidden;
    background: linear-gradient(180deg, rgba(255,255,255,.04) 0%, rgba(0,0,0,.4) 100%);
    border: 1px solid ${TOKENS.borderSubtle};
    display: flex; align-items: flex-end; justify-content: center;
  }
  .sq-canvas__silhouette { width: 60%; max-width: 320px; opacity: .9; }
  .sq-canvas__overlay-img {
    position: absolute; top: 22%; left: 50%; transform: translateX(-50%);
    width: 36%; max-width: 220px; border-radius: 8px;
    box-shadow: 0 18px 40px rgba(0,0,0,.55), 0 0 0 1px ${TOKENS.borderSubtle};
  }
  .sq-canvas__meta {
    margin-top: 18px; display: flex; justify-content: space-between; align-items: flex-end;
    font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; color: ${TOKENS.coolGrey};
  }
  .sq-canvas__meta b { color: ${TOKENS.textPrimary}; font-weight: 500; }
}

.sq-stylist {
  flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0;
}

/* ─── Step indicator ─────────────────────────────────────────────────── */
.sq-steps {
  display: flex; gap: 6px; padding: 10px 22px 12px;
  border-bottom: 1px solid ${TOKENS.borderSubtle};
}
.sq-step {
  flex: 1; border: 0; cursor: pointer; padding: 8px 6px; border-radius: 10px;
  background: transparent; color: ${TOKENS.coolGrey};
  font-size: 11.5px; letter-spacing: .2px; font-weight: 500; text-align: left;
  display: flex; flex-direction: column; gap: 2px;
  position: relative; transition: color .2s;
}
.sq-step__n { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 9px; letter-spacing: 1.2px; color: ${TOKENS.coolGreyDim}; }
.sq-step[aria-selected="true"] { color: ${TOKENS.textPrimary}; }
.sq-step[aria-selected="true"]::after {
  content: ""; position: absolute; left: 6px; right: 6px; bottom: -1px; height: 2px;
  background: ${TOKENS.gradient}; border-radius: 999px;
}
.sq-step[aria-disabled="true"] { opacity: .35; cursor: not-allowed; pointer-events: none; }

/* ─── Body / panels ──────────────────────────────────────────────────── */
.sq-body { flex: 1; overflow-y: auto; padding: 18px 22px 28px; }
.sq-h2 { font-size: 22px; margin: 0 0 4px; }
.sq-h2 em { font-style: italic; color: ${TOKENS.textMuted}; }
.sq-h3 { font-size: 16px; margin: 14px 0 8px; }
.sq-sub { font-size: 12.5px; color: ${TOKENS.coolGrey}; margin-bottom: 14px; }
.sq-prefilled {
  display: inline-block; padding: 6px 12px; margin: 0 0 14px;
  font-size: 10.5px; letter-spacing: .4px; color: ${TOKENS.textMuted};
  background: ${TOKENS.gradientSoft}; border: 1px solid ${TOKENS.borderAccent};
  border-radius: 999px;
}
.sq-eyebrow { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 9.5px; letter-spacing: 1.4px; text-transform: uppercase; color: ${TOKENS.coolGrey}; }

.sq-mute { color: ${TOKENS.coolGrey}; font-size: 12.5px; }
.sq-loading, .sq-empty, .sq-error {
  padding: 28px 16px; text-align: center; font-size: 13px;
}
.sq-loading { color: ${TOKENS.textMuted}; }
.sq-empty   { color: ${TOKENS.coolGrey}; }
.sq-error   { color: #FCA5A5; background: rgba(239,68,68,.06); border-radius: 10px; }

/* ─── Try It On: segmented toggle ────────────────────────────────────── */
.sq-seg {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px;
  border: 1px solid ${TOKENS.borderSubtle}; border-radius: 999px; background: rgba(255,255,255,.02);
  margin: 4px 0 14px;
}
.sq-seg__btn {
  padding: 8px 14px; border-radius: 999px; border: 0; background: transparent;
  color: ${TOKENS.coolGrey}; font-size: 12.5px; font-weight: 500; cursor: pointer; transition: all .25s;
}
.sq-seg__btn[aria-selected="true"] { background: ${TOKENS.gradient}; color: ${TOKENS.textPrimary}; box-shadow: 0 4px 12px rgba(139,92,246,.35), inset 0 1px 0 rgba(255,255,255,.18); }

/* Model cards */
.sq-models { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
@media (min-width: 900px) { .sq-models { grid-template-columns: repeat(3, 1fr); } }
.sq-model {
  position: relative; padding: 14px 12px 12px; cursor: pointer; text-align: left;
  background: rgba(255,255,255,.025); border: 1px solid ${TOKENS.borderSubtle}; border-radius: 14px; color: inherit;
  transition: border-color .2s, transform .15s, background .2s;
}
.sq-model:hover { transform: translateY(-1px); border-color: ${TOKENS.borderStrong}; }
.sq-model[aria-pressed="true"] {
  background: ${TOKENS.gradientSoft}; border-color: ${TOKENS.borderAccent};
  box-shadow: 0 0 0 1px rgba(139,92,246,.25), 0 10px 24px rgba(139,92,246,.18);
}
.sq-model__name { font-family: "Instrument Serif", serif; font-size: 17px; line-height: 1.1; }
.sq-model__row { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
.sq-model__tone { width: 18px; height: 18px; border-radius: 999px; border: 1px solid ${TOKENS.borderStrong}; }
.sq-model__meta { font-size: 10.5px; color: ${TOKENS.coolGrey}; letter-spacing: .2px; }
.sq-model__note { font-size: 11px; color: ${TOKENS.textMuted}; margin-top: 6px; font-style: italic; }
.sq-model__chip {
  position: absolute; top: 10px; right: 10px;
  font-family: "JetBrains Mono", monospace; font-size: 8.5px; letter-spacing: 1.2px;
  color: ${TOKENS.electric}; text-transform: uppercase;
}

/* Upload (locked, premium "Coming Soon") */
.sq-upload {
  position: relative; padding: 22px 18px; text-align: center;
  background: rgba(255,255,255,.02); border: 1px dashed ${TOKENS.borderSubtle}; border-radius: 16px; overflow: hidden;
}
.sq-upload__glow { position: absolute; inset: -30%; background: ${TOKENS.violetGlow}; opacity: .4; pointer-events: none; }
.sq-upload__icon { width: 38px; height: 38px; margin: 0 auto 10px; border-radius: 999px; background: ${TOKENS.gradientSoft}; display: flex; align-items: center; justify-content: center; color: ${TOKENS.textMuted}; font-size: 18px; position: relative; }
.sq-upload__title { font-family: "Instrument Serif", serif; font-size: 18px; }
.sq-upload__sub { font-size: 12px; color: ${TOKENS.coolGrey}; margin-top: 4px; }
.sq-upload__chip {
  display: inline-block; margin-top: 10px; padding: 4px 10px; border-radius: 999px;
  background: rgba(139,92,246,.14); border: 1px solid ${TOKENS.borderAccent};
  font-family: "JetBrains Mono", monospace; font-size: 9.5px; letter-spacing: 1.4px; color: ${TOKENS.textMuted}; text-transform: uppercase;
  position: relative;
}

/* ─── Find Your Fit ──────────────────────────────────────────────────── */
.sq-field { display: block; }
.sq-field__label { font-family: "JetBrains Mono", monospace; font-size: 9.5px; letter-spacing: 1.2px; text-transform: uppercase; color: ${TOKENS.coolGrey}; margin-bottom: 6px; }
.sq-input {
  width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid ${TOKENS.borderSubtle};
  background: rgba(255,255,255,.02); color: ${TOKENS.textPrimary}; font-size: 14px;
}
.sq-input:focus { outline: 0; border-color: ${TOKENS.borderAccent}; box-shadow: 0 0 0 3px rgba(139,92,246,.18); }
.sq-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.sq-fit-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.sq-fit-grid .sq-seg__btn { width: 100%; }

.sq-btn-primary {
  width: 100%; margin-top: 14px; padding: 13px 18px; border-radius: 999px; border: 0;
  background: ${TOKENS.gradient}; color: ${TOKENS.textPrimary};
  font-size: 14px; font-weight: 600; cursor: pointer;
  box-shadow: 0 8px 24px rgba(139,92,246,.42), inset 0 1px 0 rgba(255,255,255,.2);
  transition: transform .18s ${TOKENS.easeFade};
}
.sq-btn-primary:hover { transform: translateY(-1px); filter: brightness(1.06); }
.sq-btn-primary:disabled { opacity: .6; cursor: progress; }

.sq-result {
  margin-top: 16px; padding: 18px; border-radius: 16px;
  background: linear-gradient(160deg, rgba(139,92,246,.10) 0%, rgba(255,255,255,.02) 100%);
  border: 1px solid ${TOKENS.borderAccent};
}
.sq-result__row { display: flex; align-items: baseline; gap: 14px; }
.sq-result__size { font-family: "Instrument Serif", serif; font-size: 56px; line-height: 1; background: ${TOKENS.gradient}; -webkit-background-clip: text; background-clip: text; color: transparent; }
.sq-result__conf { font-family: "JetBrains Mono", monospace; font-size: 10.5px; letter-spacing: 1.4px; text-transform: uppercase; color: ${TOKENS.textMuted}; }
.sq-result__bar { height: 4px; margin-top: 12px; background: rgba(255,255,255,.06); border-radius: 999px; overflow: hidden; }
.sq-result__bar > span { display: block; height: 100%; background: ${TOKENS.gradient}; transition: width .8s ${TOKENS.easeSpring}; }
.sq-result__why { margin-top: 12px; font-size: 13px; color: ${TOKENS.textPrimary}; line-height: 1.5; }
.sq-fit-trust { font-size: 0.75rem; color: var(--sq-muted, #888); margin: 4px 0 0; }
.sq-advice { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.sq-advice__cell { padding: 10px 12px; border: 1px solid ${TOKENS.borderSubtle}; border-radius: 10px; background: rgba(255,255,255,.02); font-size: 11.5px; color: ${TOKENS.coolGrey}; }
.sq-advice__cell b { color: ${TOKENS.textPrimary}; font-weight: 500; }

/* ─── Complete The Look ──────────────────────────────────────────────── */
.sq-moods {
  display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px;
  scrollbar-width: none;
}
.sq-moods::-webkit-scrollbar { display: none; }
.sq-mood {
  flex-shrink: 0; padding: 8px 14px; border-radius: 999px; border: 1px solid ${TOKENS.borderSubtle};
  background: rgba(255,255,255,.02); color: ${TOKENS.coolGrey}; cursor: pointer; font-size: 12px; font-weight: 500; white-space: nowrap;
  transition: background .25s, color .25s, border-color .25s;
}
.sq-mood[aria-pressed="true"] {
  background: ${TOKENS.gradient}; color: ${TOKENS.textPrimary}; border-color: transparent;
  box-shadow: 0 6px 16px rgba(139,92,246,.35), inset 0 1px 0 rgba(255,255,255,.2);
}

.sq-palette { display: flex; gap: 6px; margin: 12px 0 6px; align-items: center; }
.sq-palette__sw { width: 28px; height: 28px; border-radius: 8px; border: 1px solid ${TOKENS.borderStrong}; }
.sq-palette__why { flex: 1; font-size: 12.5px; color: ${TOKENS.coolGrey}; line-height: 1.45; margin-left: 4px; }

.sq-look { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 14px; }
@media (min-width: 900px) { .sq-look { grid-template-columns: repeat(2, 1fr); } }
.sq-look__item {
  display: flex; gap: 10px; padding: 10px; border: 1px solid ${TOKENS.borderSubtle}; border-radius: 12px; background: rgba(255,255,255,.025);
}
.sq-look__sw { flex-shrink: 0; width: 56px; height: 64px; border-radius: 8px; background-size: cover; background-position: center; border: 1px solid ${TOKENS.borderSubtle}; }
.sq-look__body { min-width: 0; }
.sq-look__role { font-family: "JetBrains Mono", monospace; font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: ${TOKENS.coolGreyDim}; }
.sq-look__name { font-family: "Instrument Serif", serif; font-size: 14px; line-height: 1.2; margin-top: 2px; color: ${TOKENS.textPrimary}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sq-look__why  { font-size: 11px; color: ${TOKENS.coolGrey}; margin-top: 4px; }
.sq-look__anchor { color: ${TOKENS.textMuted} !important; }

/* ─── Cinematic loading sequence ─────────────────────────────────────── */
.sq-cinema {
  position: relative; padding: 40px 22px; min-height: 220px; overflow: hidden;
  border-radius: 18px;
  background: linear-gradient(160deg, rgba(139,92,246,.10) 0%, rgba(0,0,0,.4) 100%);
  border: 1px solid ${TOKENS.borderSubtle};
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.sq-cinema__glow { position: absolute; inset: -30%; background: ${TOKENS.violetGlow}; opacity: .55; animation: sq-pulse 2.2s ${TOKENS.easeFade} infinite; will-change: opacity; }
.sq-cinema__line {
  position: relative; font-family: "Instrument Serif", serif; font-size: 22px; line-height: 1.2; text-align: center;
  background: ${TOKENS.gradient}; -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: sq-cinema-in .55s ${TOKENS.easeSpring} both;
}
.sq-cinema__line em { font-style: italic; }
.sq-cinema__steps { position: relative; margin-top: 18px; display: flex; gap: 4px; }
.sq-cinema__dot { width: 28px; height: 2px; border-radius: 999px; background: rgba(255,255,255,.1); }
.sq-cinema__dot.is-active { background: ${TOKENS.gradient}; box-shadow: 0 0 8px rgba(139,92,246,.5); }
@keyframes sq-cinema-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }

/* Compatibility score chip */
.sq-score {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px; background: rgba(139,92,246,.14); border: 1px solid ${TOKENS.borderAccent};
  font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: 1px; color: ${TOKENS.textMuted}; text-transform: uppercase;
}

.sq-footer { padding: 12px 22px; border-top: 1px solid ${TOKENS.borderSubtle}; font-family: "JetBrains Mono", monospace; font-size: 9px; letter-spacing: 1.2px; color: ${TOKENS.coolGreyDim}; text-transform: uppercase; text-align: center; }

/* ─── iPhone SE / very small screens (<380px) ───────────────────────── */
@media (max-width: 379px) {
  .sq-body { padding: 14px 14px 24px; }
  .sq-h2 { font-size: 18px; }
  /* Fit preference: collapse 4-col to 2×2 grid so buttons aren't microscopic. */
  .sq-fit-grid { grid-template-columns: repeat(2, 1fr); gap: 6px; }
  /* Model cards: force 2-col instead of responsive auto-fill. */
  .sq-models { grid-template-columns: repeat(2, 1fr); }
  /* Look items: single column on very small screens. */
  .sq-look { grid-template-columns: 1fr; }
  /* Steps: tighten text to avoid overflow. */
  .sq-step { font-size: 10px; padding: 6px 4px; }
  /* Sheet: take full height on tiny phones. */
  .sq-sheet { max-height: 92vh; }
  /* Upload area: reduce padding. */
  .sq-upload { padding: 16px 12px; }
  /* iOS safe area for the footer. */
  .sq-footer { padding-bottom: max(12px, env(safe-area-inset-bottom, 12px)); }
}

/* ─── VTO render (Sprint 6 / D34) ─────────────────────────────────────── */
.sq-canvas__rendering { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 360px; }
.sq-render-spinner { width: 38px; height: 38px; border-radius: 999px; border: 2px solid rgba(255,255,255,.08); border-top-color: #8B5CF6; animation: sq-spin 900ms linear infinite; will-change: transform; }
@keyframes sq-spin { to { transform: rotate(360deg) } }
.sq-canvas__rendered { position: relative; }
.sq-canvas__rendered-img { width: 100%; height: 100%; object-fit: cover; border-radius: 12px; }
.sq-render-chip { position: absolute; top: 10px; left: 10px; padding: 4px 8px; border-radius: 999px; background: rgba(8,7,10,.7); backdrop-filter: blur(8px); border: 1px solid ${TOKENS.borderSubtle}; font-size: 9.5px; letter-spacing: 1.4px; color: ${TOKENS.textMuted}; text-transform: uppercase; }
.sq-upload__preview { width: 96px; height: 96px; object-fit: cover; border-radius: 12px; margin: 0 auto 10px; display: block; border: 1px solid ${TOKENS.borderSubtle}; }
.sq-upload__pick { display: inline-block; margin-top: 12px; padding: 8px 14px; border-radius: 999px; background: ${TOKENS.gradientSoft}; border: 1px solid ${TOKENS.borderAccent}; font-size: 10px; letter-spacing: 1.4px; color: #F4F2EE; text-transform: uppercase; cursor: pointer; transition: opacity .2s; }
.sq-upload__pick:hover { opacity: .85; }
.sq-tryon-error { margin-top: 10px; padding: 8px 12px; border-radius: 8px; background: rgba(231,82,82,.08); border: 1px solid rgba(231,82,82,.2); font-size: 11px; color: rgba(255,180,180,.9); text-align: center; }
.sq-tryon-cta { margin-top: 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.sq-render-btn { padding: 12px 28px; border-radius: 999px; background: ${TOKENS.gradient}; border: none; color: #fff; font-family: "Instrument Serif", serif; font-size: 16px; letter-spacing: .3px; cursor: pointer; transition: transform .15s, opacity .2s; }
.sq-render-btn:hover:not(:disabled) { transform: translateY(-1px); }
.sq-render-btn:disabled { opacity: .55; cursor: wait; }
.sq-render-meta { font-size: 9px; letter-spacing: 1.4px; color: ${TOKENS.coolGreyDim}; text-transform: uppercase; }
/* D37 — tier-based messaging */
.sq-tryon-tier2-note { margin: 8px 0 0; font-size: 9.5px; letter-spacing: 1.2px; color: ${TOKENS.coolGreyDim}; text-transform: uppercase; text-align: center; }
.sq-tryon-tier3 { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 24px 0; }

/* ─── D38a: 3D visual tricks for VTO panel ──────────────────────────────── */

/* 1. CSS drop-shadow + glow — garment floats off the background. */
.sq-tryon-output-wrap {
  perspective: 800px;
  perspective-origin: center center;
  position: relative;
  overflow: visible;
}
.sq-tryon-output {
  filter: drop-shadow(0 12px 32px rgba(0,0,0,0.22)) drop-shadow(0 2px 6px rgba(0,0,0,0.12));
  transition: filter 0.3s ease, transform 0.3s ease;
  transform-style: preserve-3d;
  will-change: transform;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 12px;
  display: block;
}
.sq-tryon-output:hover {
  filter: drop-shadow(0 16px 40px rgba(0,0,0,0.28)) drop-shadow(0 4px 10px rgba(0,0,0,0.14));
}

/* 2. Ken Burns — subtle idle zoom + drift. */
@keyframes sq-ken-burns {
  0%   { transform: scale(1.00) translate(0, 0); }
  33%  { transform: scale(1.018) translate(-0.5%, 0.3%); }
  66%  { transform: scale(1.022) translate(0.4%, -0.4%); }
  100% { transform: scale(1.010) translate(0.2%, 0.5%); }
}

/* 4. Mirror / flip state. */
.sq-tryon-output.sq-flipped {
  transform: scaleX(-1);
}

/* 4. Flip button. */
.sq-tryon-flip {
  background: none;
  border: 1px solid rgba(255,255,255,0.25);
  color: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 12px;
  cursor: pointer;
  margin-top: 6px;
  opacity: 0.6;
  transition: opacity 0.2s;
  font-family: inherit;
  display: block;
  margin-left: auto;
  margin-right: auto;
}
.sq-tryon-flip:hover { opacity: 1; }

/* 5. Loading shimmer skeleton — replaces old spinner in PENDING state. */
.sq-tryon-skeleton {
  width: 100%;
  aspect-ratio: 3/4;
  border-radius: 8px;
  background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
  background-size: 200% 100%;
  animation: sq-shimmer 1.4s ease-in-out infinite;
  will-change: background-position;
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
@keyframes sq-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.sq-tryon-skeleton::after {
  content: "Rendering...";
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 12px;
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-family: "JetBrains Mono", ui-monospace, monospace;
}

/* ─── Expanded dock split-pane (VTO inside Mira) ─────────────────────────── */

/* Auth overlay bottom sheet */
.sq-auth-overlay {
  position: fixed; inset: 0; z-index: 100002;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: flex-end; justify-content: center;
  opacity: 0; transition: opacity .25s ease;
}
.sq-auth-overlay[data-open="true"] { opacity: 1; }
.sq-auth-sheet {
  width: 100%; max-width: 480px;
  background: #fff; color: #111;
  border-radius: 16px 16px 0 0;
  padding: 28px 24px 36px;
  transform: translateY(30px);
  transition: transform .35s cubic-bezier(.2,.8,.2,1);
  box-shadow: 0 -8px 40px rgba(0,0,0,0.18);
  font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
}
.sq-auth-overlay[data-open="true"] .sq-auth-sheet { transform: translateY(0); }
@media (min-width: 600px) {
  .sq-auth-sheet { border-radius: 16px; margin-bottom: 32px; }
}
.sq-auth-title {
  font-family: "Montserrat", "Manrope", ui-sans-serif, sans-serif;
  font-size: 20px; font-weight: 700; color: #111; margin: 0 0 6px;
}
.sq-auth-sub {
  font-size: 13px; color: #666; margin: 0 0 20px; line-height: 1.5;
}
.sq-auth-email {
  width: 100%; padding: 12px 14px; border-radius: 10px;
  border: 1px solid #e0e0e0; font-size: 14px; color: #111;
  outline: none; transition: border-color .15s;
  font-family: inherit; margin-bottom: 10px;
}
.sq-auth-email:focus { border-color: #8B5CF6; box-shadow: 0 0 0 3px rgba(139,92,246,.12); }
.sq-auth-continue {
  width: 100%; padding: 13px; border-radius: 999px; border: 0; cursor: pointer;
  background: linear-gradient(135deg, #8B5CF6 0%, #C26BE6 55%, #E879C8 100%);
  color: #fff; font-size: 14px; font-weight: 600;
  font-family: "Montserrat", "Manrope", sans-serif;
  box-shadow: 0 6px 18px rgba(139,92,246,.35);
  transition: filter .15s, transform .15s; margin-bottom: 14px;
}
.sq-auth-continue:hover { filter: brightness(1.06); transform: translateY(-1px); }
.sq-auth-divider {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; color: #999; margin-bottom: 14px;
}
.sq-auth-divider::before, .sq-auth-divider::after {
  content: ""; flex: 1; height: 1px; background: #e0e0e0;
}
.sq-auth-social { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
.sq-auth-google, .sq-auth-apple {
  padding: 11px 14px; border-radius: 10px; border: 0; cursor: pointer;
  font-size: 13px; font-weight: 600; font-family: inherit;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: opacity .15s, transform .15s;
}
.sq-auth-google {
  background: #fff; color: #333;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.08);
}
.sq-auth-google:hover { transform: translateY(-1px); opacity: .92; }
.sq-auth-apple {
  background: #000; color: #fff;
}
.sq-auth-apple:hover { transform: translateY(-1px); opacity: .88; }
.sq-auth-skip {
  display: block; text-align: center; background: none; border: 0;
  font-size: 12.5px; color: #888; cursor: pointer; font-family: inherit;
  text-decoration: underline; padding: 4px;
}
.sq-auth-skip:hover { color: #555; }

/* ─── Size comparison row (VTO step) ─────────────────────────────────────── */
.sq-size-row { display:flex; align-items:center; gap:8px; margin-top:12px; padding:0 4px; flex-wrap:wrap; }
.sq-size-row__label { font-size:10px; letter-spacing:1.2px; color:var(--sq-mute,#9ca3af); }
.sq-size-row__chips { display:flex; gap:6px; flex-wrap:wrap; }
.sq-size-chip { background:transparent; border:1px solid rgba(255,255,255,0.2); color:#e5e7eb; border-radius:4px; padding:4px 10px; font-size:11px; font-family:inherit; cursor:pointer; transition:all .15s; }
.sq-size-chip:hover { border-color:var(--sq-electric,#7c3aed); color:#fff; }
.sq-size-chip--active { border-color:var(--sq-electric,#7c3aed); background:rgba(124,58,237,0.15); color:#fff; }
.sq-fit-annotation { margin-top:6px; }
.sq-fit-note { font-size:10px; letter-spacing:0.8px; color:var(--sq-mute,#9ca3af); padding:4px 4px 0; }

/* ─── Zone-specific fit feedback ─────────────────────────────────────────── */
.sq-fit-zones { margin-top:14px; border-top:1px solid rgba(255,255,255,0.08); padding-top:12px; }
.sq-fit-zones__label { font-size:9px; letter-spacing:1.5px; color:var(--sq-mute,#6b7280); margin-bottom:8px; }
.sq-fit-zones__grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.sq-fit-zone { display:flex; justify-content:space-between; align-items:center; }
.sq-fit-zone__name { font-size:12px; color:#d1d5db; }
.sq-fit-zone__val { font-size:10px; letter-spacing:0.8px; }
.sq-fit-zone--tight, .sq-fit-zone--snug { color:#f87171; }
.sq-fit-zone--fitted, .sq-fit-zone--comfortable { color:#6ee7b7; }
.sq-fit-zone--roomy, .sq-fit-zone--oversized { color:#93c5fd; }

/* ─── Upload ready / loading states ──────────────────────────────────────── */
.sq-upload--ready { border-color: rgba(110,231,183,0.4); }
.sq-upload--ready .sq-upload__glow { background: radial-gradient(ellipse 60% 40% at 50% 100%, rgba(110,231,183,0.12), transparent); }
.sq-upload--loading { opacity: .6; pointer-events: none; }
.sq-upload__ready-badge { display:inline-flex; align-items:center; gap:5px; font-size:10px; letter-spacing:1.2px; color:#6EE7B7; margin-top:6px; }
.sq-upload__privacy { font-size:10px; letter-spacing:0.8px; color:#6EE7B7; opacity:0.7; margin-top:3px; }
.sq-upload__error { font-size:11px; letter-spacing:0.8px; margin-top:6px; }
.sq-render-btn--secondary { background: transparent; border: 1px solid rgba(255,255,255,0.18); color: ${TOKENS.coolGrey}; opacity: .7; cursor: not-allowed; }
.sq-render-btn--secondary:hover:not(:disabled) { transform: none; }

/* ─── Beauty mode styles ──────────────────────────────────────────────────── */
.sq-beauty-profile, .sq-beauty-shades, .sq-beauty-routine { padding: 0 2px; }
.sq-chip-row { display:flex; flex-wrap:wrap; gap:6px; }
.sq-chip {
  padding: 5px 12px; border-radius:20px; font-size:11px; letter-spacing:0.8px;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
  color: ${TOKENS.coolGrey}; cursor: pointer; transition: all 0.15s;
}
.sq-chip:hover { background: rgba(255,255,255,0.1); }
.sq-chip--on {
  background: rgba(var(--sq-accent-rgb, 139,92,246), 0.2);
  border-color: rgba(var(--sq-accent-rgb, 139,92,246), 0.6);
  color: #fff;
}
.sq-label { font-size:10px; letter-spacing:1.4px; text-transform:uppercase; color:${TOKENS.coolGrey}; margin-bottom:8px; display:block; }
.sq-shade-card {
  display:flex; align-items:flex-start; gap:12px;
  padding: 12px; border-radius:10px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  margin-bottom:10px;
}
.sq-routine-steps { display:flex; flex-direction:column; gap:10px; }
.sq-routine-step {
  display:flex; align-items:flex-start; gap:12px;
  padding: 10px; border-radius:8px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
}
.sq-routine-step--oos { opacity: 0.5; }
.sq-btn-secondary {
  padding: 12px; border-radius:10px; font-size:12px; letter-spacing:1px;
  background: transparent; border: 1px solid rgba(255,255,255,0.2);
  color: #fff; cursor: pointer; transition: all 0.15s;
}
.sq-btn-secondary:hover { background: rgba(255,255,255,0.06); }
.sq-badge {
  display:inline-flex; align-items:center; justify-content:center;
  min-width:16px; height:16px; padding:0 4px; border-radius:8px;
  background: #ef4444; color:#fff; font-size:10px; font-weight:700;
  vertical-align:middle; margin-left:4px;
}

/* ─── Skin tone swatch picker (beauty Step 1) ─────────────────────────────── */
.sq-skin-swatches {
  display: grid;
  grid-template-columns: repeat(6, 32px);
  gap: 6px;
  margin-bottom: 8px;
}
.sq-skin-swatch {
  position: relative;
  width: 32px; height: 32px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.sq-skin-swatch:hover {
  transform: scale(1.12);
  border-color: rgba(255,255,255,0.45);
  box-shadow: 0 0 0 2px rgba(255,255,255,0.12);
}
.sq-skin-swatch--selected {
  border-color: rgba(255,255,255,0.85);
  box-shadow: 0 0 0 3px rgba(139,92,246,0.55), 0 0 0 5px rgba(139,92,246,0.18);
  transform: scale(1.1);
}
.sq-skin-swatch--selected:hover {
  transform: scale(1.1);
}
.sq-skin-swatch__check {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; line-height: 1;
  color: rgba(255,255,255,0.92);
  text-shadow: 0 1px 3px rgba(0,0,0,0.65);
  pointer-events: none;
}
/* Indicator row — shows selected family label */
.sq-skin-selected-row {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 4px; min-height: 20px;
}
.sq-skin-selected-dot {
  width: 14px; height: 14px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.2);
  flex-shrink: 0;
  transition: background 0.15s;
}
.sq-skin-selected-label {
  font-size: 9.5px; letter-spacing: 1.2px; text-transform: uppercase;
  color: ${TOKENS.textMuted};
}
`;


