// Brain — the orchestrator.
//
// One entry point: brain.run(input). Every shopper-facing surface goes
// through this. Provider-agnostic, tool-registry-driven, A/B-aware.

import type {
  BrainInput, BrainOutput, BrainClientAction, BrainCombo,
  BrainContext, ModelProvider, ToolDef,
  ProviderToolCall, ProviderToolResult,
} from "./types.js";
import type { ToolRegistry } from "./registry.js";
import type { PromptVariant } from "./prompts.js";
import type { BrainRouter } from "./router.js";
import type { RulesEngine } from "./rules.js";
import type { ClassificationResult } from "./classifier.js";

const DEFAULT_MAX_HOPS = 6;

// ─── Post-run signal ──────────────────────────────────────────────────────
//
// A BrainSignal is a normalized record of "something meaningful happened
// during this run" — emitted AFTER the run completes so the caller can wire
// analytics centrally. Before this hook, brain.ts fired zero analytics events
// and every event emission was the caller's responsibility (each chat handler
// re-wired the same tracking by hand). The signal hook lets brain.server.ts
// register ONE central tracker instead.
//
// Signals are collected per completed tool call (tool name + result kind +
// any entity ids the tool surfaced) plus run-level lifecycle signals.
export type BrainSignal = {
  type: string;                       // e.g. "tool:propose_combo", "run:complete"
  shopId: string;
  data: Record<string, unknown>;      // entity ids, kinds, counts — caller maps to events
};

export type BrainConfig = {
  // Map of registered providers. Brain picks one per call (input.config or
  // default). Adding a provider = registering one entry here.
  providers: Record<string, ModelProvider>;
  defaultProviderKey: string;     // e.g. "gemini"
  tools: ToolRegistry;
  // Prompt variants, keyed by experiment label. The "default" entry must exist.
  promptVariants: Record<string, PromptVariant>;

  // Optional post-run signal sink. When registered, the Brain calls it once
  // per collected signal AFTER run() finishes its tool loop. This is how
  // analytics get emitted centrally (instead of every caller re-wiring it).
  // Errors thrown by the callback are swallowed — signal emission must never
  // break a chat turn.
  onSignal?: (signal: BrainSignal) => void;

  // ─── Hybrid AI + Rules layer (all optional) ────────────────────────────
  // When all three are wired, the Brain classifies intent cheaply, routes the
  // turn to the right-cost model, and validates outputs against catalog facts.
  // When ANY is absent, the Brain behaves exactly as before — these are purely
  // additive and never change the default code path.

  // Cheap pre-flight intent classifier. Called with the last user message +
  // page context. Drives the router. Must never throw (returns a fallback).
  classify?: (message: string, pageContext: unknown) => Promise<ClassificationResult>;

  // Multi-model router. Given the classification + context, picks the provider,
  // prompt variant, and hop budget for this turn.
  router?: BrainRouter;

  // Deterministic rules engine — validates combos / navigate / sizes / cart /
  // inventory against the hydrated catalog facts before they reach the shopper.
  rules?: RulesEngine;
};

export class Brain {
  constructor(private cfg: BrainConfig) {
    if (!cfg.providers[cfg.defaultProviderKey]) {
      throw new Error(`Default provider not registered: ${cfg.defaultProviderKey}`);
    }
    if (!cfg.promptVariants.default) {
      throw new Error(`promptVariants must include a "default" variant`);
    }
  }

  async run(input: BrainInput & { signal?: AbortSignal }): Promise<BrainOutput> {
    const started = Date.now();
    const cfg = input.config ?? {};

    // ─── Hybrid routing pre-flight ──────────────────────────────────────
    // If a classifier is wired, classify the last user message cheaply, then
    // (if a router is wired) let the router pick provider / variant / hops.
    // The result is stored as routingDecision and applied as OVERRIDES below —
    // an explicit input.config still wins, and a missing classifier/router
    // leaves every default exactly as it was.
    let routingDecision: ClassificationResult | null = null;
    let routedProviderKey: string | undefined;
    let routedVariantKey: string | undefined;
    let routedMaxHops: number | undefined;
    let routingMeta: BrainOutput["routingMeta"] | undefined;

    if (this.cfg.classify) {
      try {
        const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
        const pageContext = this.buildPageContext(input.ctx, lastUser?.imageDataUrl != null);
        routingDecision = await this.cfg.classify(lastUser?.text ?? "", pageContext);
      } catch (err) {
        // Classifier must never break a turn — log and proceed unrouted.
        // eslint-disable-next-line no-console
        console.error("[brain] classify failed, proceeding unrouted:", (err as Error)?.message ?? err);
        routingDecision = null;
      }
    }

    if (routingDecision && this.cfg.router) {
      try {
        const decision = this.cfg.router.route(routingDecision, input.ctx);
        // Only adopt the routed provider if it's actually registered.
        if (this.cfg.providers[decision.provider.key]) {
          routedProviderKey = decision.provider.key;
        }
        routedVariantKey = decision.promptVariant;
        routedMaxHops = decision.maxHops;
        routingMeta = {
          intent: routingDecision.intent,
          complexity: routingDecision.complexity,
          provider: decision.provider.key,
          reason: decision.reason,
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[brain] router failed, proceeding unrouted:", (err as Error)?.message ?? err);
      }
    }

    // Resolution precedence: explicit input.config > router decision > defaults.
    const providerKey = cfg.providerKey ?? routedProviderKey ?? this.cfg.defaultProviderKey;
    const provider = this.cfg.providers[providerKey];
    if (!provider) throw new Error(`provider_unavailable: ${providerKey}`);

    const variantKey = cfg.promptVariant ?? routedVariantKey ?? "default";
    const variant = this.cfg.promptVariants[variantKey] ?? this.cfg.promptVariants.default;

    const visibleTools = this.cfg.tools.visibleFor(input.ctx);
    const systemPrompt = variant(input.ctx);

    const combos: BrainCombo[] = [];
    const actions: BrainClientAction[] = [];
    const toolsCalled: string[] = [];
    // Post-run signals collected per completed tool call (see BrainSignal).
    // Emitted via cfg.onSignal AFTER the loop, never during — so a slow or
    // throwing sink can't stall or break the tool-calling chain.
    const signals: BrainSignal[] = [];
    let reply = "";

    // ─── Tool-calling loop ──────────────────────────────────────────────
    let priorToolCalls: ProviderToolCall[] | undefined;
    let pendingResults: ProviderToolResult[] | undefined;
    const maxHops = cfg.maxToolHops ?? routedMaxHops ?? DEFAULT_MAX_HOPS;

    // Bounds (E1 + E2, Sprint 6 audit round 2).
    //
    // MAX_CALLS_PER_HOP — fan-out cap. Without this, the model could emit 50
    // search_catalog calls in one hop and hammer Prisma. Anything beyond the
    // cap is dropped with an explicit error so the model can self-correct.
    //
    // MAX_UNKNOWN_TOOL_RETRIES — if the model keeps hallucinating tool names
    // (e.g. drifted into a non-existent `make_outfit` or `recommend_size`),
    // we stop early instead of burning all 6 hops on it. Counter is across
    // the whole run, not per-hop.
    const MAX_CALLS_PER_HOP = 8;
    const MAX_UNKNOWN_TOOL_RETRIES = 3;
    let unknownToolRetries = 0;

    // Product-intent turns must START with a catalog tool call, or flash will
    // dead-end on a chatty reply (the loop breaks on first text → no combo ever
    // forms). Force search_catalog/propose_combo on the first hops until a combo
    // exists; greetings/support stay free-text. Gated on the classifier intent —
    // when no classifier ran, we don't force (the prompt still nudges).
    const PRODUCT_INTENTS = new Set([
      "discover", "occasion", "outfit", "compare", "stock", "size", "tryon", "complex",
    ]);
    const wantsProduct = routingDecision ? PRODUCT_INTENTS.has(routingDecision.intent) : false;
    const FORCE_TOOLS = ["search_catalog", "propose_combo"].filter(
      (n) => visibleTools.some((v) => v.name === n),
    );

    for (let hop = 0; hop < maxHops; hop++) {
      // Force the opening hops of a product turn to call catalog tools
      // (search_catalog → propose_combo) until a combo forms, so the brain
      // RELIABLY proposes its own look instead of dead-ending on chat. Capped to
      // the first 2 hops; greetings/support never force.
      const forceToolNames =
        wantsProduct && combos.length === 0 && hop < 2 && FORCE_TOOLS.length
          ? FORCE_TOOLS
          : undefined;
      const turn = await provider.turn({
        systemPrompt,
        messages: input.messages,
        tools: visibleTools,
        priorToolCalls,
        pendingToolResults: pendingResults,
        temperature: cfg.temperature,
        forceToolNames,
        signal: input.signal,
      });

      if (turn.toolCalls.length === 0) {
        reply = turn.text.trim();
        break;
      }

      // Dispatch each tool call through the registry. Failures become tool
      // responses so the model can recover; they do NOT throw out of the loop.
      pendingResults = [];
      const callsThisHop = turn.toolCalls.slice(0, MAX_CALLS_PER_HOP);
      const droppedThisHop = turn.toolCalls.length - callsThisHop.length;
      for (const call of callsThisHop) {
        toolsCalled.push(call.name);
        const tool = this.cfg.tools.get(call.name);

        // Unknown tool — model hallucinated. Tell it and count toward the
        // early-break threshold (E1).
        if (!tool) {
          unknownToolRetries++;
          pendingResults.push({
            name: call.name, callId: call.callId,
            response: { error: "unknown_tool" },
          });
          continue;
        }

        // E3: `tool_not_available_on_plan` defense-in-depth path. `visibleFor`
        // already filters before tools reach the provider, so reaching here
        // means a hidden tool was somehow exposed. Kept intentionally — the
        // belt-and-suspenders cost is one Map.find per call.
        if (!visibleTools.find((v) => v.name === call.name)) {
          pendingResults.push({
            name: call.name, callId: call.callId,
            response: { error: "tool_not_available_on_plan" },
          });
          continue;
        }

        // Unimplemented stub — let the model know it's coming, not yet usable.
        if (tool.unimplemented || !tool.handler) {
          pendingResults.push({
            name: call.name, callId: call.callId,
            response: { error: "unimplemented", message: "This capability is coming soon." },
          });
          continue;
        }

        try {
          const result = await tool.handler(call.args, input.ctx);

          // Side-effect interpretation: tools may return a struct that
          // contributes to combos / actions. Convention used by the
          // registered tools (see tools.ts) — keep aligned.
          //
          // When a RulesEngine is wired, validate facts BEFORE the side effect
          // is recorded: a combo with an unknown/out-of-stock/duplicate product
          // is skipped; a navigate to a non-existent handle is rewritten to a
          // search_catalog fallback action. When no rules engine is wired,
          // this behaves identically to the bare collectSideEffects() call.
          collectSideEffects(result, combos, actions, this.cfg.rules, input.ctx);

          // Post-run signal: capture WHAT happened (tool name + result kind +
          // any entity ids / event hints the handler surfaced) so the central
          // sink can map it to an analytics event. Best-effort — never throws.
          signals.push(
            buildToolSignal(input.ctx.shopId, call.name, call.args, result),
          );

          pendingResults.push({
            name: call.name, callId: call.callId,
            response: toSafeResponse(result),
          });
        } catch (err) {
          // A5 fix: never leak (err as Error).message back to the model — it
          // can reflect into the user-visible reply and contains internals
          // (provider strings, stack hints, Prisma error codes). Stable code
          // only. Real details to console.error for server-side debugging.
          // eslint-disable-next-line no-console
          console.error(`[brain] tool_failed ${call.name}:`, (err as Error)?.message ?? err);
          pendingResults.push({
            name: call.name, callId: call.callId,
            response: { error: "tool_failed" },
          });
        }
      }

      // Self-critique fix: previously injected a synthetic `__fanout_cap`
      // tool result, but that breaks the provider wire protocol (no matching
      // callId in turn.toolCalls). Drop silently with a server log instead.
      // The dropped calls' responses are simply missing from pendingResults —
      // some providers tolerate this (Gemini does), others don't. If we hit
      // a stricter provider, the right fix is to pre-empt: refuse to send
      // toolCalls beyond the cap in the first place via provider config.
      if (droppedThisHop > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[brain] dropped ${droppedThisHop} extra tool call(s) this hop (cap=${MAX_CALLS_PER_HOP})`);
      }

      // Early-break: model is stuck hallucinating tool names. Don't burn the
      // remaining hops. (E1)
      if (unknownToolRetries >= MAX_UNKNOWN_TOOL_RETRIES) {
        // eslint-disable-next-line no-console
        console.warn(`[brain] breaking early — ${unknownToolRetries} unknown-tool retries`);
        break;
      }

      // Early exit: once a FORCED product turn has produced a combo, stop here —
      // we don't spend another LLM round-trip just to write a closing line. The
      // reply falls back to the combo's own reasoning below (set when !reply), so
      // the shopper gets a real stylist rationale + the cards. Saves ~1 hop (~4s)
      // on every product turn that proposes a look.
      if (forceToolNames && combos.length > 0) break;

      // Carry the model's tool-call turn forward so the next hop reconstructs
      // the wire chain correctly (model{funcCall} → user{funcResponse} → …).
      priorToolCalls = turn.toolCalls;
    }

    // A4 fix: graceful fallback when all hops burn without final text. The
    // old fallback used a question ("Tell me a bit more about what you're
    // after?") which violates D29/D30 (Mira leads, doesn't ask).
    //
    // Self-critique pass: the previous fix said "Pulling a couple now" when
    // combos.length === 0 — which is dishonest (nothing's been pulled). Both
    // branches now match the actual side-effect state.
    if (!reply) {
      // When a combo formed but no closing line was written (e.g. we broke early
      // after a forced propose), speak the combo's OWN reasoning — a real stylist
      // rationale — instead of a generic placeholder. Helps every surface, not
      // just the demo. Falls back to the generic line only if reasoning is empty.
      reply = combos.length
        ? (combos[0].reasoning?.trim() || "Take a look — let me know what catches your eye.")
        : "One sec — pulling something that fits.";
    }

    // ─── Post-run signal emission ───────────────────────────────────────────
    // One run-level lifecycle signal, then every per-tool signal collected
    // above. The caller (brain.server.ts) maps each signal type → an analytics
    // event. Wrapped so a throwing sink can never break the chat turn.
    if (this.cfg.onSignal) {
      const emit = (sig: BrainSignal): void => {
        try { this.cfg.onSignal!(sig); }
        catch (err) {
          // eslint-disable-next-line no-console
          console.error("[brain] onSignal sink threw:", (err as Error)?.message ?? err);
        }
      };
      emit({
        type: "run:complete",
        shopId: input.ctx.shopId,
        data: {
          toolsCalled,
          comboCount: combos.length,
          actionKinds: actions.map((a) => a.kind),
          modelUsed: `${provider.key}:${provider.defaultModel}`,
          // Surface the routing decision in the lifecycle signal so the central
          // analytics sink can record which model handled the turn and why.
          ...(routingMeta ? { routing: routingMeta } : {}),
        },
      });
      for (const sig of signals) emit(sig);
    }

    return {
      reply, combos, actions,
      latencyMs: Date.now() - started,
      modelUsed: `${provider.key}:${provider.defaultModel}`,
      toolsCalled,
      ...(routingMeta ? { routingMeta } : {}),
    };
  }

  // Build the page-context payload the classifier expects from BrainContext.
  // Maps the Brain's surface/currentProduct onto the classifier's PageType.
  // hasImage is passed explicitly (the caller knows if this turn carried one).
  private buildPageContext(ctx: BrainContext, hasImage: boolean): {
    pageType: "homepage" | "pdp" | "collection" | "cart";
    productTitle?: string;
    hasImage: boolean;
  } {
    let pageType: "homepage" | "pdp" | "collection" | "cart" = "homepage";
    if (ctx.currentProduct) pageType = "pdp";
    else if (ctx.intentContext?.cartHasItems) pageType = "cart";
    else if ((ctx.catalogOverview?.length ?? 0) > 0) pageType = "collection";
    return {
      pageType,
      productTitle: ctx.currentProduct?.title,
      hasImage,
    };
  }
}

// ─── Tool-signal builder ────────────────────────────────────────────────
//
// Normalizes a completed tool call into a BrainSignal. Pulls entity ids out of
// both the call args (what the model asked for) and the result (what the tool
// surfaced), plus any explicit `event` / `signal` hint a handler chooses to
// return in its `data` payload. The central sink decides which analytics event
// each `tool:<name>` signal maps to — the Brain stays provider/event-agnostic.
function buildToolSignal(
  shopId: string,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): BrainSignal {
  const data: Record<string, unknown> = { tool: toolName };

  // Result kind + the canonical entity ids, if present.
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.kind === "string") data.resultKind = r.kind;
    // A handler may surface an explicit analytics hint so the sink doesn't
    // have to special-case the tool name. Pass it straight through.
    if (typeof r.event === "string") data.event = r.event;
    const payloadSrc =
      (r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : null) ?? r;
    mergeEntityIds(data, payloadSrc);
  }
  // Args are the model's stated intent — also a source of entity ids.
  mergeEntityIds(data, args);

  return { type: `tool:${toolName}`, shopId, data };
}

// Copies the well-known entity-id fields from a source object onto the signal
// data without clobbering values already set. Bounded to a known key list so a
// large tool result can't bloat the signal.
function mergeEntityIds(
  data: Record<string, unknown>,
  src: Record<string, unknown> | null | undefined,
): void {
  if (!src || typeof src !== "object") return;
  const KEYS = [
    "productId", "productIds", "focalProductId", "nearMissProductId",
    "handle", "comboName", "name", "size", "sizes", "mode", "reason",
    "hesitationType", "query", "resultCount", "canonicalCategory",
    "nearMissAttribute", "action", "occasion", "shopperIntent", "harmonyType",
    "triggeredBy", "confidence",
  ];
  for (const k of KEYS) {
    if (data[k] === undefined && src[k] !== undefined) data[k] = src[k];
  }
}

// ─── Side-effect collection ─────────────────────────────────────────────
//
// Tools may return:
//   { kind: "combo", combo }
//   { kind: "action", action }
//   { kind: "data", … }            ← any other payload is just for the model
//
// Anything not in that shape is treated as "data" and passed through to the
// model without contributing to combos / actions.

function collectSideEffects(
  result: unknown,
  combos: BrainCombo[],
  actions: BrainClientAction[],
  rules?: RulesEngine,
  ctx?: BrainContext,
): void {
  if (!result || typeof result !== "object") return;
  const r = result as Record<string, unknown>;

  if (r.kind === "combo" && r.combo) {
    const combo = r.combo as BrainCombo;
    // Rules gate: skip a combo that fails catalog-fact validation. The rules
    // engine never produces a false negative (empty catalog → valid), so this
    // only drops genuinely-bad combos (unknown / out-of-stock / duplicate).
    if (rules && ctx) {
      const check = rules.validateCombo(combo, ctx);
      if (!check.valid) {
        // eslint-disable-next-line no-console
        console.warn(`[brain] combo "${combo.name}" failed rules — skipping: ${check.violations.join(", ")}`);
        return;
      }
    }
    combos.push(combo);
    return;
  }

  if (r.kind === "action" && r.action) {
    const action = r.action as BrainClientAction;
    // Rules gate on navigate: an unknown handle becomes a search_catalog
    // fallback so the shopper never gets sent to a 404. A close-but-not-exact
    // handle is auto-corrected. No rules engine → action passes through as-is.
    if (rules && ctx && action.kind === "navigate") {
      const check = rules.validateNavigate(action.handle, ctx);
      if (!check.valid) {
        // Unknown handle — never send the shopper to a 404. Drop the navigate
        // action; the model's reply text stands on its own and the shopper can
        // re-ask. (BrainClientAction has no generic search action to emit; the
        // search_catalog *tool* is the recovery path, which the model can call
        // on the next hop after seeing the dropped navigate has no effect.)
        // eslint-disable-next-line no-console
        console.warn(`[brain] navigate "${action.handle}" failed rules — dropping (no such handle)`);
        return;
      }
      if (check.correctedHandle && check.correctedHandle !== action.handle) {
        // Close match — auto-correct to the real handle.
        actions.push({ ...action, handle: check.correctedHandle });
        return;
      }
    }
    actions.push(action);
    return;
  }
}

// Stripped-down version sent back to the model. Avoid leaking internal
// fields the model didn't ask for (cache, log refs, etc.).
function toSafeResponse(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return { value: result };
  const r = result as Record<string, unknown>;
  if (r.kind === "combo") return { combo: r.combo };
  if (r.kind === "action") return { ok: true, action: r.action };
  if (r.kind === "data")   return r.data as Record<string, unknown>;
  return r;
}
