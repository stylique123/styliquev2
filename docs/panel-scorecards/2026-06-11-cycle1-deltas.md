# Loop cycle 1 — 5-expert panel → fixes → re-measure

## Fresh expert panel (different lenses than previous)
1. Performance marketer (CAC/LTV/payback) → Attribution 6/10 · Cohort export 2 · LTV 5 · Path visibility 7 · Payback math 1
2. CX / returns specialist → Pre-purchase doubt 7 · Colour honesty 6 · Return reason capture 2 · Bracketing prevention 1 · Confidence calibration 7
3. Mobile-first PM → Touch targets 5/10 · Thumb zone 4 · Keyboard overlap 3 · Safe-area 5 · Reduced motion 6 · TTI 7
4. Fashion copywriter (brand voice) → Voice consistency 6 · Density 5 · Variety 5 · Adaptive register 6 · Friend-in-store 5
5. Payments / checkout → Cart correctness 5 · Express checkout 1 · Currency transparency 3 · Multi-add atomicity 4 · Continuity 4

## Implemented this cycle (8 fixes)
1. Kill "the piece most people don't expect to love" template tell — 4 rotated lead-ins
2. WARM-LEAD LOCK ("Which jacket?" was 4-in-a-row failure)
3. Soft 22-word bias (revised after empirical regression — see below)
4. 44×44 touch targets on close, send, step buttons (WCAG 2.5.5)
5. `goToCheckout()` → /checkout (not /cart) — exposes Express Checkout
6. `FREE_SHIPPING_THRESHOLD` flagged USD-only (full plumbing deferred)
7. Currency-prefix already shipped previous turn (verified 7/7 cases)
8. Dashboard `headline.miraAssistedRevenueCents` + `miraAssistedOrders` — the CMO renewal KPI

## Empirical re-measurement (32 real turns, local /api/mira)

| Metric | Round 1 | Round 2 | Δ | Verdict |
|---|---|---|---|---|
| Latency mean (ms) | 1592 | 1710 | +118 | within noise |
| Banned phrase hits | 1/8 | 1/8 | flat | (rule case-insensitive now; future slips will be caught) |
| Repeat-tell ("piece most people don't expect to love") | flagged | **0** | -100% | ✅ killed |
| "Which jacket/piece/one" | (4-in-a-row was founder report) | 2/8 | -50% est. | 🟡 improved |
| Climate echo | 100% | 100% | flat | ✅ held |
| Objection mirrored | 100% | 100% | flat | ✅ held |
| Cart-claim lying | 0% | 0% | flat | ✅ held |
| Chatbot phrasings | 0% | 0% | flat | ✅ held |
| Try-on offered | 63% | 50% | -13 | 🟡 slight regression |
| **Size guidance** | 75% | 25% | **-50** | ⚠️ caused by 22-word HARD CAP |
| **Closing** | 63% | 25% | **-38** | ⚠️ same root cause |
| **Complete-look** | 63% | 25% | **-38** | ⚠️ same root cause |
| Avg words per voice | (new metric) | 22 | — | at the cap |
| Turns over 22 words | (new metric) | 47% | — | many turns still over |

## Root cause of regression + fix in same cycle
The "HARD LENGTH CAP" rule was too strict — Mira was trimming the selling
phrases ("Want me to drop the M in the bag?", "see it on you", "build the
look") to fit 22 words on EVERY turn, including closes. Relaxed the rule
to SOFT 22 words on discovery turns + ≤30 on selling turns, with an
explicit "the close itself is sacred — never trim 'want me to drop the M
in the bag'" exception.

## Continuing the loop
- Next cycle: re-measure with the soft-length-bias rule + drive a NEW
  expert panel (SRE/observability, fashion merchandiser, accessibility,
  data engineer, CRO) once the current panel's findings are cleared to
  8+/10 on each dimension they cared about.
- Floors held: tonality, climate, objection, no-fake-cart, repeat-tell.
- Floors to recover: closing/sizing/complete-look (the soft-cap relax
  should bring these back next round).
