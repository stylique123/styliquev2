// ─── Mira brain — Gemini call ────────────────────────────────────────────────
// attemptModel + callGemini, extracted VERBATIM from route.ts. Self-contained:
// reads GEMINI_API_KEY / MIRA_MODEL / MIRA_FALLBACK_MODEL / MIRA_DEBUG from env,
// POSTs to the Gemini REST API, validates with DecisionSchema, grounds handles
// with validateHandle. No demo-module imports; activeCatalog is a required arg
// (the demo-catalog default param dropped — callers always pass it).
import { DecisionSchema, type MiraDecision } from "./schemas.js";
import { validateHandle, type MiraProduct } from "./products.js";

// One attempt against one model. Returns the parsed decision, or null with a
// `retryable` flag so the orchestrator knows whether to back off / fall back.
async function attemptModel(
  model: string,
  prompt: string,
  system: string,
  key: string,
  activeCatalog: MiraProduct[],
): Promise<{ decision: MiraDecision | null; retryable: boolean }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  // Thinking budget is model-specific: flash can disable it (0) for ~1s latency;
  // pro can't go to 0, so we give it a small fixed budget, enough to actually
  // reason about intent without ballooning cost/latency.
  const isPro = /pro/.test(model);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.65,
          thinkingConfig: { thinkingBudget: isPro ? 512 : 0 },
          // Pro spends most of its budget THINKING (≈340 tokens even on a trivial
          // prompt). With the full Mira system prompt the thinking balloons, so a
          // 2048 ceiling risked truncating the JSON answer → invalid → flash. 3072
          // leaves comfortable headroom for thinking + a complete decision.
          maxOutputTokens: isPro ? 3072 : 1024,
          responseMimeType: "application/json",
        },
      }),
      // Pilot diagnosis (33% fallback rate, sticky after first fail): Pro at
      // 22s was eating most of the budget on every cold/complex turn while
      // Flash never got a real shot at recovering. Combined with the new
      // history cap (6 turns × 220 chars), Pro now answers in 8-12s on the
      // tighter prompt — keep its window at 14s (the MIRA-10X-1 historical
      // target) so total chain = 14 + 11 = 25s ≤ 35s client timeout, and
      // Flash genuinely runs when Pro stalls instead of being timed out too.
      signal: AbortSignal.timeout(isPro ? 14000 : 11000),
    });
  } catch (e) {
    // Network error / timeout, treat as retryable (the model may just be slow).
    console.error("[mira] gemini fetch", model, String(e).slice(0, 120));
    return { decision: null, retryable: true };
  }

  if (!res.ok) {
    console.error("[mira] gemini http", model, res.status, (await res.text().catch(() => "")).slice(0, 200));
    // 503 overloaded / 429 quota / 500 internal are transient, worth a retry
    // and a fall-through to a lighter model. 4xx (bad request/auth) are not.
    const retryable = res.status === 503 || res.status === 429 || res.status === 500;
    return { decision: null, retryable };
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { thoughtsTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (process.env.MIRA_DEBUG) {
    console.error("[mira-debug]", JSON.stringify({
      model,
      finish: json.candidates?.[0]?.finishReason,
      think: json.usageMetadata?.thoughtsTokenCount,
      out: json.usageMetadata?.candidatesTokenCount,
      rawLen: raw?.length ?? 0,
      rawHead: raw?.slice(0, 80),
    }));
  }
  // Empty output (e.g. MAX_TOKENS spent on thinking), retry on a faster model.
  if (!raw) return { decision: null, retryable: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // A truncated/edge JSON is usually transient, worth one more try before
      // dropping to regex (non-json used to hard-fail and mute Mira).
      console.error("[mira] gemini non-json", raw.slice(0, 200));
      return { decision: null, retryable: true };
    }
  }

  const decision = DecisionSchema.safeParse(parsed);
  if (!decision.success) {
    console.error("[mira] decision validation", decision.error.flatten());
    return { decision: null, retryable: true };
  }
  // Ground productHandle to a real catalog entry, drop it if hallucinated.
  // validateHandle() is the hard guarantee: the client never routes to a dead page.
  decision.data.productHandle = validateHandle(decision.data.productHandle, activeCatalog);
  // ROUTE INTEGRITY (tester P5): never emit a route that NEEDS a product handle
  // with none resolved, that produced "navigate to nothing". If the handle got
  // dropped (hallucinated/absent), fall back to talking it through with a
  // question instead of a dead card.
  if (
    (decision.data.route === "navigate" || decision.data.route === "reco_handle") &&
    !decision.data.productHandle
  ) {
    decision.data.route = "talk_only";
    if (!decision.data.quickReplies?.length) {
      decision.data.quickReplies = ["For an occasion", "Everyday", "Show me something"];
    }
  }
  // Failsafe (panel P2): a talk_only turn is a QUESTION, it must always offer
  // chips so the shopper can answer in one tap. The model usually includes them,
  // but on drift it can omit them, leaving a chip-less dead-end. Supply defaults.
  if (decision.data.route === "talk_only" && !decision.data.quickReplies?.length) {
    decision.data.quickReplies = ["For an occasion", "Everyday", "Just looking"];
  }
  return { decision: decision.data, retryable: false };
}

export async function callGemini(prompt: string, system: string, activeCatalog: MiraProduct[], opts?: { escalate?: boolean }): Promise<{ decision: MiraDecision | null; model: string | null }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { decision: null, model: null };
  // TIERED MODEL ROUTING. Flash is the reliability default for the live sales
  // surface (Pro as a blanket primary 503-overloaded one-third of pilot turns to
  // blank). But the *hard* turns — suitability, objections, multi-constraint
  // styling — are where understanding actually shows, so those escalate to the
  // stronger model (gemini-2.5-pro) with Flash as the reliable fallback: a Pro
  // 503 falls through to Flash, never to a blank. Simple turns stay on Flash.
  //   • MIRA_MODEL — explicit override; if set, always primary (manual pin).
  //   • MIRA_PRO_MODEL — the escalation model (default gemini-2.5-pro).
  //   • MIRA_TIER_ROUTER=0 — disable escalation (everything on Flash).
  const flashModel = "gemini-2.5-flash";
  const proModel = process.env.MIRA_PRO_MODEL ?? "gemini-2.5-pro";
  const routerOn = process.env.MIRA_TIER_ROUTER !== "0";
  const primary = process.env.MIRA_MODEL ?? ((routerOn && opts?.escalate) ? proModel : flashModel);
  const fallbackModel = process.env.MIRA_FALLBACK_MODEL ?? flashModel;
  const chain = primary === fallbackModel ? [primary] : [primary, fallbackModel];

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    // One try on Pro (its 22s window is already generous, a 2nd try on timeout
    // would mean 44s before flash). A lighter primary keeps its retry-on-503.
    const tries = i === 0 && !/pro/i.test(model) ? 2 : 1;
    for (let t = 0; t < tries; t++) {
      const { decision, retryable } = await attemptModel(model, prompt, system, key, activeCatalog);
      if (decision) return { decision, model };
      if (!retryable) return { decision: null, model: null }; // hard failure (bad JSON / validation), don't thrash
      if (t < tries - 1) await new Promise((r) => setTimeout(r, 400)); // brief backoff before retry
    }
  }
  return { decision: null, model: null };
}
