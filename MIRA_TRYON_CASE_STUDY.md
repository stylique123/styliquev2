# Stylique — Mira AI Stylist + Virtual Try-On: Production Case Study

**Date:** 2026-06-04
**Status:** Live (Railway production deploy)
**Test type:** Live end-to-end simulation — real Mira conversation API + real try-on render API
**Sample:** N=2 demographically-diverse simulated buyers, each running 1 full styling conversation + 1 try-on render

---

## 1. Executive Summary

Two diverse simulated buyers ran complete, live sessions against the production Stylique stack: a multi-turn conversation with **Mira** (the AI fashion stylist) followed by a **virtual try-on** render. Both buyers were warm, occasion-driven shoppers with a clearly and repeatedly stated budget of ~$300 for a wedding outfit.

**The headline: 0% conversion (0 of 2), with 0 items added to basket — despite the AI assistant performing well on craft.** Mira was honest (avg honesty **0.925**), reasonably good on sizing reassurance (avg sizing **0.685**), and competent at multi-item styling (avg multiItem **0.65**). The try-on engine rendered successfully **100%** of the time (2/2) with **0% lost-image failures**.

The conversion failure is **not an AI-quality failure — it is a structural catalog/assortment failure.** Every wedding-appropriate item Mira could surface was 1.6x–5x over the shopper's stated budget. The only in-budget piece in the catalog (a ~$290 merino turtleneck) is wrong for the occasion, and Mira honestly said so. Both judges independently identified the **identical root cause**: the catalog has no affordable, occasion-appropriate entry point for a budget-conscious formalwear buyer. The assistant's honesty and care could not overcome a missing product.

**Highest-leverage fix:** Close the price/occasion gap in the assortment — either by ingesting/merchandising sub-$300 wedding-appropriate inventory, or by giving Mira a hard budget-respecting retrieval filter plus an explicit "nothing in your budget fits this occasion" honest off-ramp (rent/save/alternative-occasion paths) instead of repeatedly promising "an amazing look within your budget" she cannot deliver.

**Production-ready verdict: NO — not for budget-segment conversion.** The assistant layer is close to production quality; the catalog/retrieval layer has a structural conversion blocker that must be fixed before this funnel can convert price-sensitive occasion shoppers.

---

## 2. Method

### Sample (N = 2)
Two simulated buyers, each demographically distinct, each completing the **full** funnel: a live multi-turn Mira conversation **and** a live try-on render.

| # | Shopper type | Gender | Region | Occasion | Stated budget |
|---|--------------|--------|--------|----------|---------------|
| 1 | occasion-fit-anxious | Woman | United States | Wedding | ~$300 |
| 2 | size-anxious | Woman | South Korea | Wedding | ~$300 |

### Live APIs exercised
- **Mira conversation API** — multi-turn AI stylist dialogue (relevance, closing, multi-item styling, sizing guidance, honesty, navigation).
- **Virtual try-on render API** — generates and serves the rendered try-on image.

### Scoring dimensions (0.0–1.0, per judge verdict)
`relevance`, `closing`, `multiItem`, `sizing`, `honesty`, `navigation`, plus booleans `tryonWorked`, `wouldConvert`, and integer `basketItems`.

### Note on sample size
N=2 is a qualitative depth probe, not a statistically powered test. Its value is that **two independently-generated, demographically-different buyers converged on the exact same fatal failure mode** — strong signal that the blocker is structural, not noise.

---

## 3. Baseline Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Avg relevance | **0.55** | Recommendations on-occasion but off-budget |
| Avg closing | **0.225** | Lowest score — cannot close with no affordable item |
| Avg multi-item styling | **0.65** | Builds coherent looks (top+bottom, dress+layer) |
| Avg sizing | **0.685** | Solid fit reassurance, esp. for size-anxious buyer |
| Avg honesty | **0.925** | Strongest dimension — flags off-occasion/off-budget items candidly |
| Avg navigation | **0.525** | Moderate; weaker when steering a stuck budget shopper |
| **Conversion rate (wouldConvert)** | **0.0%** | 0 of 2 |
| **Avg basket size** | **0.0 items** | 0 + 0 |
| **Try-on success rate** | **100.0%** | 2 of 2 rendered |
| **Try-on lost-image (serve) failure rate** | **0.0%** | No rendered-but-failed-to-serve incidents |

### Dimension ranking (strongest → weakest)
1. Honesty — 0.925
2. Sizing — 0.685
3. Multi-item — 0.65
4. Relevance — 0.55
5. Navigation — 0.525
6. **Closing — 0.225 (critical weak point)**

The shape of this profile is diagnostic: **high honesty + high sizing + rock-bottom closing** is the signature of a capable assistant trapped by an inventory it cannot honestly sell into.

---

## 4. Per-Segment Breakdown

### Segment A — occasion-fit-anxious / Woman / United States
| Dim | Score |
|-----|-------|
| relevance | 0.55 |
| closing | 0.30 |
| multiItem | 0.60 |
| sizing | 0.62 |
| honesty | 0.90 |
| navigation | 0.60 |
| tryonWorked | true |
| wouldConvert | **false** |
| basketItems | 0 |

**Biggest failure:** Catalog/budget mismatch. Despite the shopper stating ~$300 four times, the only occasion-appropriate items Mira could surface were 1.6x–2.9x over budget ($690 dress, $860 trouser+cami, $480 skirt). The sole sub-$300 item (merino turtleneck) was one Mira herself flagged as a "creative choice" for a wedding. She repeatedly promised "an amazing look within your budget" but never delivered one — leaving a tight-budget occasion shopper with no affordable, wedding-suitable piece to buy.

### Segment B — size-anxious / Woman / South Korea
| Dim | Score |
|-----|-------|
| relevance | 0.55 |
| closing | 0.15 |
| multiItem | 0.70 |
| sizing | 0.75 |
| honesty | 0.95 |
| navigation | 0.45 |
| tryonWorked | true |
| wouldConvert | **false** |
| basketItems | 0 |

**Biggest failure:** Fatal price/assortment mismatch. Every wedding-appropriate option ($690 slip, $800 camisole+skirt, $1450 gown) is 2x–5x the stated ~$300 budget; the only in-budget piece ($290 merino turtleneck) is wrong for the occasion (Mira honestly admitted it's underdressed). The shopper leaves guided, respected, and well-reassured on sizing — but with literally nothing she can both afford and wear. The assistant performed well; the catalog has no entry point for a budget-conscious formalwear buyer, so honesty and strong sizing support could not overcome a structural conversion blocker.

### Cross-segment pattern
| Axis | Observation |
|------|-------------|
| Shopper type | Both anxiety-driven (fit-anxious, size-anxious) — Mira handles reassurance well (sizing/honesty high in both) |
| Gender | Both women; no gender-differentiated signal available |
| Region | US vs South Korea — **no regional difference in outcome**; the budget/catalog wall is region-agnostic |
| Budget | Both ~$300; both hit the identical price ceiling. The blocker is **100% reproducible** across diverse buyers |

The South Korea buyer scored *worse* on closing (0.15 vs 0.30) and navigation (0.45 vs 0.60), suggesting the dead-end gets even harder to navigate gracefully the more the shopper leans on the assistant — Mira's honesty surfaces the no-win sooner, tanking closeability.

---

## 5. Try-On Reliability Findings

| Metric | Result |
|--------|--------|
| Try-on attempts | 2 |
| Renders succeeded | 2 |
| **Try-on success rate** | **100%** |
| Rendered-but-failed-to-serve ("lost-image" bug) | 0 |
| **Lost-image serve failure rate** | **0.0%** |

**The try-on engine is the most production-ready part of the stack in this run.** Both renders generated and served correctly; no instances of the lost-image bug (image rendered server-side but failed to serve to the client) were observed. This is a genuine strength.

**Caveat:** N=2 successes is encouraging but not proof of robustness. The lost-image failure mode is a known historical risk (it is why we measure serve-failure separately from render-success). Continue tracking serve-failure as a distinct metric at scale; a 0% rate at N=2 should not be read as "solved."

---

## 6. Top Failure Modes, Ranked by Revenue Impact

### #1 — Catalog has no affordable, occasion-appropriate entry point (CRITICAL)
- **Impact:** Directly responsible for **100% of lost conversions** in this run. Every budget-conscious occasion shopper hits a hard wall: on-occasion items are 1.6x–5x over budget; the only in-budget item is off-occasion. Revenue impact = the entire budget-occasion segment, which for weddings/events is a large, high-intent slice of demand.
- **Fix:** Merchandise/ingest sub-$300 occasion-appropriate inventory (formalwear, event dresses) so retrieval has *something* to return. If inventory genuinely doesn't exist, integrate **rental or "complete-the-look on a budget"** partner SKUs, or surface a save-for-later / price-drop-alert path. The funnel cannot convert a segment for which it stocks nothing sellable.

### #2 — Mira promises a budget outcome she cannot deliver (HIGH)
- **Impact:** Erodes trust at the moment of truth. Repeatedly saying "an amazing look within your budget" and never producing one converts a *soft* no into a *frustrated* no, and tanks closing (0.225 avg). This actively damages brand perception even when honesty elsewhere is high.
- **Fix:** Hard guard in the conversation policy: Mira may **only** promise an in-budget look if budget-passing inventory was actually retrieved. If retrieval returns nothing under budget for the occasion, Mira must pivot to an honest, helpful off-ramp ("Here's the truth — nothing in our wedding range fits $300 right now; here are 3 ways forward: stretch slightly, rent, or get notified on sales") rather than re-promising.

### #3 — Budget filter not enforced in retrieval (HIGH)
- **Impact:** Mira surfaces $690–$1450 items to a shopper who said "~$300" four times. Even with perfect copy, showing 5x-over-budget items as the primary recommendation signals the system isn't listening, depressing relevance (0.55) and navigation.
- **Fix:** Apply a **hard budget ceiling (with a small, disclosed stretch band, e.g. +15%)** as a retrieval filter, ranked occasion-first. Separate "in-budget" from "stretch/aspirational" lanes in the UI so over-budget items are clearly opt-in, never the default answer.

### #4 — Closing / navigation collapse in dead-end states (MEDIUM)
- **Impact:** When no good option exists, closing drops to 0.15–0.30 and navigation to 0.45. The assistant has no graceful "no-win" playbook, so the session simply peters out with an empty basket.
- **Fix:** Build an explicit **dead-end recovery flow**: capture the email for restock/price alerts, offer adjacent in-budget occasions, or hand off to a human stylist. Convert a lost sale into a captured lead instead of a silent bounce.

---

## 7. What Genuinely Works

- **Honesty is excellent (0.925).** Mira does not oversell. She explicitly flags when an in-budget item is wrong for the occasion (the turtleneck) rather than tricking the shopper into a bad purchase. This is rare and valuable — it preserves long-term trust.
- **Sizing / fit reassurance is solid (0.685), and strongest for the size-anxious buyer (0.75).** Anxiety-driven shoppers are exactly who an AI stylist should serve best, and Mira delivers comfort and respect here.
- **Multi-item styling works (0.65).** Mira composes coherent looks (dress + layer, top + bottom) rather than dumping single SKUs — the core stylist value prop is intact.
- **Try-on is reliable (100% success, 0% lost-image).** The render-and-serve pipeline performed flawlessly in this run.
- **The shoppers leave "guided, respected, and well-reassured."** The experience quality is high; only the buyable-outcome is missing. That's a fixable gap, not a broken product.

---

## 8. Roadmap

### Phase 0 — Stop the bleeding (days)
1. Enforce a **hard budget filter** in retrieval with a disclosed stretch band; default to in-budget, occasion-first results.
2. Add the **conversation guard**: no "within your budget" promises unless budget-passing inventory was retrieved.
3. Ship the **honest dead-end off-ramp** + email capture for restock/price alerts.

### Phase 1 — Close the assortment gap (weeks)
4. Merchandise/ingest **sub-$300 occasion-appropriate inventory**; audit catalog coverage by (occasion × price band) and fill the wedding/event < $300 hole.
5. Integrate **rental / budget-look partner SKUs** where owned inventory can't reach the price point.
6. Add explicit **"in-budget" vs "stretch/aspirational"** UI lanes.

### Phase 2 — Recover lost demand (weeks)
7. **Dead-end recovery flow**: adjacent-occasion suggestions, human-stylist handoff, price-drop notifications.
8. Instrument **(occasion × budget × convert)** analytics so assortment holes surface automatically before shoppers hit them.

### Phase 3 — Scale & harden (ongoing)
9. Re-run this simulation at **N ≥ 30** across more segments (men, non-event occasions, wider budget bands) to validate fixes and catch regressions.
10. Keep **try-on serve-failure ("lost-image")** as a first-class SLO; a 0% rate at N=2 is not proof — watch it at volume.

---

## 9. Production-Ready Verdict

**Not production-ready for budget-segment conversion.**

The **assistant layer** (honesty, sizing, multi-item styling) and the **try-on engine** (100% render+serve) are at or near production quality. But the end-to-end funnel has a **structural conversion blocker**: for a budget-conscious occasion shopper, the catalog offers nothing both affordable and appropriate, and Mira compounds the damage by promising an outcome she cannot deliver. Result: **0% conversion, 0-item baskets, fully reproducible across two diverse buyers.**

**Single highest-leverage fix:** Close the price/occasion assortment gap — stock (or partner/rent into) sub-$300 occasion-appropriate inventory — and pair it with a hard budget-respecting retrieval filter plus an honest off-ramp that replaces empty "within your budget" promises. This one change converts the most common, most reproducible failure in the entire run.
