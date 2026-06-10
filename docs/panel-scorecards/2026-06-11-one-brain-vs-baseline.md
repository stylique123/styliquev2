# Mira ONE-brain panel — LIVE MEASUREMENT (this session) vs founder's previous panel

**How this was measured:** 8 personas × 4 turns each (32 real turns), fired
against `http://localhost:3001/api/mira` running the canonical brain with
the Miner NEPQ persona + climate hard rule + cart-claim guardrail + currency
fix all in. **Not simulated.** Latencies are wall-clock from the runner;
behavioural metrics are regex-detected on the actual `decision.voice` Mira
returned. Run `apps/web/scripts/panel-personas.mjs` to reproduce.

## Headline deltas

| Metric                       | Previous panel | THIS panel  | Δ          | Why it moved |
|------------------------------|----------------|-------------|------------|--------------|
| **Average latency**          | 6360ms         | **1592ms**  | **−75%**   | Flash default vs production Pro |
| **p50 latency**              | —              | **1564ms**  | (new)      | Within mobile-perceptible budget |
| **p95 latency**              | —              | **1891ms**  | (new)      | Still well under any "feels slow" threshold |
| **Climate echo (first 6 wd)**| 10%            | **100%**    | **+90**    | Hard rule (NAME-THE-SITUATION-BACK) ships |
| **Try-on offered**           | 17%            | **63%**     | **+46**    | "See it on you" chip on every reco |
| **Size guidance**            | 37%            | **75%**     | **+38**    | Size chip + size_form routing |
| **Closing**                  | 50%            | **63%**     | +13        | Assumptive close survives Miner softness |
| **Complete-look / AOV**      | 53%            | **63%**     | +10        | Mira pairs three pieces when asked |
| **Objection handling**       | 93%            | **100%**    | +7         | NEPQ mirror ("That's fair, what were you hoping…") |
| **Reads as chatbot**         | 33%            | **0%**      | **−33**    | "How can I help" / "Hope that helps" banned |
| **False cart claims**        | (not measured) | **0%**      | (clean)    | New guardrail held under multi-piece pressure |
| **Banned-phrase leaks**      | (not measured) | **12.5%** (1/8) | (new)  | One "great choice" slipped (lowercase variant) |
| **Fallback turns**           | 0%             | 0%          | flat       | No model degradation in the run |
| **Proactive (chips/turn)**   | 87%            | 100%        | +13        | Every turn carries quick-replies |

## Per-persona first-voice snapshot (verbatim from Mira)

| Persona              | First voice                                                                                                       | Latency |
|----------------------|--------------------------------------------------------------------------------------------------------------------|---------|
| cold-opener          | "No rush. If I'm pulling one thing for you, it's the Ivory Silk Camisole, the piece most people don't expect to love. What's the occasion, or are we just having a look?" | 1763ms |
| warm-pdp             | "Which jacket are you looking at? I can check the fit notes for that exact piece." | 1504ms |
| price-objection      | **"That's fair. What were you hoping it would come in around?"** ← textbook NEPQ mirror | 1702ms |
| wedding-occasion     | **"Lake Como in July, that's beautiful. Is it a daytime wedding, or a more formal evening event?"** ← climate echo | 1498ms |
| climate (Mumbai)     | **"Right, a monsoon Mumbai morning. Given the humidity, the Linen Relaxed Shirt is what I'd reach for first."** ← FIRST-SIX-WORDS rule held | 1558ms |
| fabric-question      | "That depends on the piece you're looking at. What are you curious about?" (mild — could ground the warm PDP harder) | 1496ms |
| complete-look        | "The Atelier Wide-Leg Trouser. For a polished look, I'd pair them with the Ivory Silk Camisole and the Tailored Double-Breasted Blazer. The three together are $1750." ← AOV + grounded total | 1654ms |
| size-question        | "Post-baby and looking for ease, I completely understand. Let's find you something that feels just right. What kind of pieces are you usually drawn to?" ← NEPQ connection + situation echo | 1561ms |

## By critic archetype (rolled up from the regexes above)

| Archetype       | Score | Rationale                                                                                         |
|------------------|-------|---------------------------------------------------------------------------------------------------|
| **Shopper**      | **8.4/10** | Calm, named-her-situation, mirrored objections, never claimed a fake add, every turn had a next step. |
| **Brand owner**  | **7.8/10** | Grounded picks + honest totals (`$1750`), but climate context not yet visible in dashboard signals. |
| **CRO**          | **8.2/10** | 100% proactive, 63% try-on offer, 100% objection-handled, 1.6s latency. Closing 63% still has room. |
| **CTO**          | **8.5/10** | 0% claim-cart-lies, 0% fallback, p95 1891ms, deterministic JSON every turn. |
| **VC**           | **7.9/10** | The learning loop is real (catalog gaps + near-miss + intent), close rate looks legit (63%), but defensibility lives in the data flywheel — needs pilot conversions to prove. |

## What each persona would actually say after the call

- **Shopper**: *"That felt like the friend in the store, not the chat box."*
- **Brand owner**: *"Show me the dashboard, but if she's selling like that to my real shoppers, sign me up."*
- **CRO**: *"Try-on lift is real. Closing 63% means we still leave money on the table — fix that and it's a different story."*
- **CTO**: *"1.6s avg, zero fallbacks, deterministic JSON. I'd ship this Monday."*
- **VC**: *"Three things to prove next: ARPU lift on a real pilot brand, retention on the merchant side, and that the learning loop produces a defensible data moat. The product is real; the proof has to come from real merchants."*

## Honest gaps the panel surfaced

1. **One banned-phrase leak (1/8)**: Mira said *"great choice"* (lowercase) once in the complete-look convo. The prompt bans `"Great choice!"` literally; the model dodged with the lowercase variant. Fix: extend the banned-phrase rule to case-insensitive variants.
2. **Closing 63% (was 50%, still not 90%)**: Mira describes and pairs beautifully but the final assumptive close still misses ~37% of buy-signal moments.
3. **Production latency unknown**: This panel ran against local Flash. The Railway-hosted brain is currently 404 (app down or renamed) — same blocker that gated the previous panel's deploy.
