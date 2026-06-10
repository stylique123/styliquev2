// Chat handlers — conversational shopping companion.
// Exported from this module and re-exported via shopper.server.ts barrel.
//
// Exports: runChatTurn, postChat, postChatStream

import { z } from "zod";
import {
  type ChatCombo,
  type ChatMessage,
  type ChatProduct,
  type BrainClientAction,
} from "@stylique/ai";
import { getBrain, buildBrainContext } from "./brain.server";
import { combinedVariantTag, mergeVariantConfigs, resolveCohorts } from "./experiments.server";
import { canConsume, recordConsume } from "./entitlement.server";
import { type ShopperProduct } from "./serialize";
import {
  appendChatTurns,
  buildShopperBrief,
  getOrCreateShopperSession,
  readChatHistory,
} from "./session.server";
import { recomputeTasteVector } from "./taste.server";
import { recomputeBrandSnapshot } from "./network.server";
import { type ApiResponse } from "./shopper-types.server";
import { shopIdFromDomain, rateOk, analytics } from "./shopper-helpers.server";
import { reportError } from "./sentry.server";

// ─── Chat schemas + types ─────────────────────────────────────────────────────

const ChatMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  // Hard cap at 1500 chars (was 4000). Longer than a few sentences is almost
  // certainly an attempted prompt-injection payload — there's no reason a
  // shopper needs 4000 characters in one message.
  text: z.string().max(1500),
  // Image MIME allowlist tightened. Server only accepts JPEG, PNG, WebP, HEIC.
  // Hard cap at 6MB base64 (~4.4MB raw) — keeps body sizes predictable.
  imageDataUrl: z.string()
    .regex(/^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/, "invalid_image")
    .max(6_500_000)
    .optional(),
}).refine((m) => m.text.length > 0 || !!m.imageDataUrl, { message: "empty_message" });

// IntentContext schema — mirrors apps/widget/src/intent.ts IntentContext.
// We accept this from the widget on every chat turn and surface it to Mira
// via buildShopperBrief() as behavioral context.
const IntentContextSchema = z.object({
  state: z.enum(["BROWSING", "DISCOVERING", "CONSIDERING", "DECIDING", "CONVERTING"]),
  confidenceScore: z.number().min(0).max(1),
  // Cap array length + each string length — these are injected verbatim into
  // the Brain system prompt, so unbounded values bypass the 1500-char message
  // guard and create a prompt-injection surface.
  activeSignals: z.array(z.string().max(80)).max(20),
  currentPdpHandle: z.string().max(255).nullable(),
  // Cap dwell/depth seconds to a sane daily ceiling — rejects impossible values
  // (1e308, negative) that would corrupt the intent context in the prompt.
  currentPdpDwellSeconds: z.number().min(0).max(86400),
  viewHistory: z.array(z.string().max(255)).max(10),
  comparedPair: z.tuple([z.string().max(255), z.string().max(255)]).nullable(),
  sessionDepthSeconds: z.number().min(0).max(86400),
  returnVisit: z.boolean(),
  cartHasItems: z.boolean(),
}).optional();

const ChatRequestSchema = z.object({
  // The widget only needs to send the *new* user turn — the server stitches in
  // history from the shopper session. We still accept an array for forward-
  // compat (e.g. tools that resend the full thread).
  messages: z.array(ChatMessageSchema).min(1).max(40),
  // Page context — Shopify product handle + id of the PDP the shopper is viewing.
  // The widget populates these when opened on a product page so Mira can
  // reference the specific product on screen. Both are optional and safe to
  // omit (collection pages, homepages, etc.).
  currentProductHandle: z.string().max(255).optional(),
  currentProductId: z.string().max(50).optional(),
  // Behavioral intent context from IntentEngine — multi-signal behavioral
  // fusion sent with every turn so Mira has page-level behavioral data.
  intentContext: IntentContextSchema,
});

export type ShopperChatProduct = ChatProduct;
export type ShopperChatCombo = ChatCombo;
export type ShopperChatResult = {
  reply: string;
  combos: ChatCombo[];
  actions: BrainClientAction[];
  shopperId: string;            // cookie value — widget echoes it back next turn
  latencyMs: number;
  // Routing metadata from the brain's classifier/router — carries the intent
  // label (occasion/discover/outfit/etc) used to activate the learning loop's
  // discovery hit-rate and intent histogram. Undefined when not routed.
  routingMeta?: { intent?: string; complexity?: string; provider?: string; reason?: string };
};

function toChatProduct(p: ShopperProduct): ChatProduct {
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    imageUrl: p.imageUrl,
    primaryColor: p.primaryColor,
    colorFamily: p.colorFamily,
    category: p.category,
    sizes: p.sizes,
  };
}

// toChatProduct is used internally for context building; suppress unused warning.
void toChatProduct;

// ─── runChatTurn — shared core used by postChat and postChatStream ─────────────
// Extracted to eliminate duplication between both callers. Any fix here
// automatically applies to both callers.

type ChatTurnSuccess = {
  ok: true;
  reply: string;
  combos: ChatCombo[];
  actions: BrainClientAction[];
  shopperId: string;
  latencyMs: number;
  routingMeta?: { intent?: string; complexity?: string; provider?: string; reason?: string };
  setCookie: string | null;
};
type ChatTurnError = { ok: false; error: string };
type ChatTurnResult = ChatTurnSuccess | ChatTurnError;

export async function runChatTurn(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
  acceptLanguage?: string | null;
  signal?: AbortSignal;
}): Promise<ChatTurnResult> {
  if (!await rateOk(args.shopDomain, args.shopperCookieId)) return { ok: false, error: "rate_limited" };
  const shopId = await shopIdFromDomain(args.shopDomain);
  if (!shopId) return { ok: false, error: "shop_not_installed" };

  const parsed = ChatRequestSchema.safeParse(args.body);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const sid: string = shopId;

  // Resolve / mint the shopper session.
  const session = await getOrCreateShopperSession({
    shopifyDomain: args.shopDomain,
    cookieId: args.shopperCookieId,
  });

  // Hydrate persistent state: chat history (DB) + shopper brief.
  const [history, briefData] = await Promise.all([
    readChatHistory(session.row.id),
    buildShopperBrief(session.row.id),
  ]);
  const brief = briefData.brief;
  const accountClaimed = briefData.accountClaimed;
  const signupAlreadyOffered = briefData.signupOffered;

  // The new user turn(s) are appended to history before going to the brain.
  let newTurns = parsed.data.messages as ChatMessage[];

  // Vision-turn gate. Images cost real money per call — Starter brands are
  // capped at 30/month, Growth 500, Ultimate unlimited. If the cap is hit
  // we silently strip the image from the message but keep the text, so the
  // conversation continues without a confusing error.
  const hasImage = newTurns.some((m) => (m as ChatMessage & { imageDataUrl?: string }).imageDataUrl);
  if (hasImage) {
    const gate = await canConsume({ shopId: sid, metric: "VISION_TURN" });
    if (!gate.allowed) {
      newTurns = newTurns.map((m) => {
        const copy = { ...m } as ChatMessage & { imageDataUrl?: string };
        delete copy.imageDataUrl;
        // Append a soft note to the text so Mira knows to acknowledge gracefully.
        if (!copy.text || copy.text.length < 2) copy.text = "(image, but quota reached this month)";
        return copy;
      });
    } else {
      // Record one vision turn per image-bearing turn (we cap at one image per
      // user message at the client). Fire-and-forget — we already counted it.
      void recordConsume({ shopId: sid, metric: "VISION_TURN", by: 1 });
    }
  }

  const fullThread: ChatMessage[] = [...history, ...newTurns];

  // A/B cohort resolution — sticky per shopper, per experiment. Returns one
  // assignment per active experiment that targets this shop.
  const cohorts = await resolveCohorts({ shopId: sid, sessionId: session.row.sessionId });
  const variantConfig = mergeVariantConfigs(cohorts);
  const variantTag = combinedVariantTag(cohorts);

  // Fire-and-forget event tracker — every event now carries the variant tag
  // so the dashboard can compare cohorts later.
  const track = (name: import("@stylique/types").EventName, productId: string | undefined, payload: unknown) => {
    void analytics.track({
      shopId: sid, shopperId: session.row.id, name, productId, payload,
      variantTag,
    }).catch(() => undefined);
  };

  try {
    const brain = getBrain();
    const ctx = await buildBrainContext({
      shopId: sid,
      shopDomain: args.shopDomain,
      shopperRowId: session.row.id,
      shopperSessionId: session.row.sessionId,
      brief, accountClaimed, signupAlreadyOffered,
      recentHistory: fullThread,
      // E5 fix: actually surface the real signalCount from the brief (was
      // hardcoded 0, so Mira's tone-calibration logic in the prompt never
      // engaged). buildShopperBrief now returns this from ShopperSession.
      signalCount: briefData.signalCount,
      surface: "stylist_chat",
      acceptLanguage: args.acceptLanguage,
      // Page context — passed through from the widget so Mira knows what
      // product the shopper is currently looking at. See D_GUIDED_SHOPPING.
      currentProductHandle: parsed.data.currentProductHandle,
      currentProductId: parsed.data.currentProductId,
      // Behavioral intent context from IntentEngine — multi-signal behavioral
      // fusion object. Forwarded to buildBrainContext so it lands in the prompt.
      intentContext: parsed.data.intentContext,
      log: (e) => track(e.name as import("@stylique/types").EventName, e.productId, e.payload ?? {}),
    });

    // Stash the most recent reference image (this turn's) so the
    // match_reference_photo tool handler can find it without re-walking the
    // thread. Server-side only — never persisted, dropped after the turn.
    for (let i = newTurns.length - 1; i >= 0; i--) {
      const m = newTurns[i] as ChatMessage & { imageDataUrl?: string };
      if (m?.imageDataUrl && m.imageDataUrl.startsWith("data:image/")) {
        ctx.cache.set("reference_image", m.imageDataUrl);
        break;
      }
    }

    const result = await brain.run({
      ctx,
      messages: fullThread,
      config: {
        promptVariant: variantConfig.promptVariant,
        providerKey: variantConfig.providerKey,
        temperature: variantConfig.temperature,
      },
      signal: args.signal,
    });

    // Persist this exchange (new user turns + model reply) for next time.
    // SECURITY: strip imageDataUrl from every persisted turn — server-side
    // images are pass-through-only (§3.5 invariant #3, D23, PB17). Without
    // this strip, up to 4.4MB photos per turn × 60-turn cap × every shopper
    // landed in ShopperSession.chatHistoryJson. (A3, fixed Sprint 6 audit.)
    const turnsForHistory: ChatMessage[] = newTurns.map((m) => {
      const { imageDataUrl: _drop, ...rest } = m as ChatMessage & { imageDataUrl?: string };
      return rest;
    });
    await appendChatTurns(session.row.id, [
      ...turnsForHistory,
      { role: "model", text: result.reply, combos: result.combos },
    ]);

    // Turn-level event so we can measure latency, combo yield, action mix
    // — and now also which model + which tools were called (A/B-ready).
    track("CHAT_REPLY_RECEIVED", undefined, {
      latencyMs: result.latencyMs,
      combos: result.combos.length,
      actions: result.actions.length,
      modelUsed: result.modelUsed,
      toolsCalled: result.toolsCalled,
    });

    // Recompute taste vector + brand snapshot (fire-and-forget).
    void recomputeTasteVector(session.row.id).catch(() => undefined);
    void recomputeBrandSnapshot(sid).catch(() => undefined);

    return {
      ok: true,
      reply: result.reply,
      combos: result.combos,
      actions: result.actions,
      shopperId: session.row.sessionId,
      latencyMs: result.latencyMs,
      // Pass routing metadata so the adapter can surface the real intent label
      // for the learning-loop (intent histogram, discovery hit-rate).
      routingMeta: result.routingMeta,
      setCookie: session.setCookie ?? null,
    };
  } catch (err) {
    // SECURITY: never leak provider/error internals to the client. Map known
    // failure modes to a small stable vocabulary; log the real error to the
    // server for debugging.
    const msg = (err as Error).message ?? "chat_failed";
    console.error("[runChatTurn]", msg.slice(0, 500));
    // Report to Sentry for all non-configuration errors (configuration errors are
    // expected in dev; provider throttle / transient errors are worth tracking).
    if (!msg.includes("not_configured") && !msg.includes("brain_no_providers")) {
      reportError(err, { shopId: sid, surface: "chat" });
    }
    // `not_configured` covers the provider-stub throws (anthropic_not_configured,
    // openai_not_configured, embed_no_provider, replicate_not_configured).
    // `brain_no_providers` is the singleton init throw.
    if (msg.includes("not_configured") || msg.includes("brain_no_providers")) {
      return { ok: false, error: "chat_unavailable" };
    }
    if (msg.includes("gemini_http_")) return { ok: false, error: "chat_busy" };
    return { ok: false, error: "chat_failed" };
  }
}

// ─── POST /api/chat ──────────────────────────────────────────────────────────
// Thin wrapper around runChatTurn() — returns the full JSON result in one shot.

export async function postChat(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
  acceptLanguage?: string | null;
  signal?: AbortSignal;
}): Promise<ApiResponse<ShopperChatResult> & { setCookie?: string | null }> {
  const turn = await runChatTurn(args);
  if (!turn.ok) return turn;
  return {
    ok: true,
    data: {
      reply: turn.reply,
      combos: turn.combos,
      actions: turn.actions,
      shopperId: turn.shopperId,
      latencyMs: turn.latencyMs,
    },
    setCookie: turn.setCookie,
  };
}

// ─── POST /api/chat/stream ───────────────────────────────────────────────────
// Streaming variant of postChat — same logic, but returns an SSE ReadableStream
// so the client can remove the typing indicator the moment the reply arrives
// rather than waiting for the full round-trip (~8-15s on cold starts).
//
// SSE event vocabulary:
//   { event: "start",  setCookie: string | null }
//   { event: "reply",  reply, combos, actions, shopperId, latencyMs }
//   { event: "error",  error: string }
//   { event: "done" }
// postChatStream returns { stream, setCookie } so the route handler can attach
// the Set-Cookie header on the HTTP response — SSE body is opaque to the browser's
// cookie jar, so the cookie MUST come as a real HTTP response header.
// setCookie is only non-null on first-visit shoppers (new session creation);
// subsequent visits return null (cheap idempotent upsert, no header written).
export async function postChatStream(args: {
  shopDomain: string;
  body: unknown;
  shopperCookieId: string | null;
  acceptLanguage?: string | null;
}): Promise<{ stream: ReadableStream<Uint8Array>; setCookie: string | null }> {
  const encoder = new TextEncoder();
  const sendEvent = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    data: object,
  ) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  // Run the chat turn EAGERLY (before the stream starts) so we can extract
  // setCookie and return it as part of the HTTP response headers.
  // The stream only begins after runChatTurn completes — this is fine because
  // the actual LLM latency happens inside runChatTurn anyway, so the TTFB
  // for the SSE stream doesn't change. The client still gets a fast spinner-clear
  // from the "start" SSE event.
  let turn: Awaited<ReturnType<typeof runChatTurn>>;
  try {
    turn = await runChatTurn(args);
  } catch (err) {
    const msg = (err as Error).message ?? "chat_failed";
    console.error("[postChatStream] runChatTurn threw", msg.slice(0, 500));
    // Return a minimal error stream with null setCookie (no new session).
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "error", error: "chat_failed" })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "done" })}\n\n`));
        controller.close();
      },
    });
    return { stream, setCookie: null };
  }

  const setCookie = turn.ok ? (turn.setCookie ?? null) : null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Delegate all business logic to the shared helper — this wrapper only
      // translates the result into SSE events. Any bug fix in runChatTurn()
      // automatically applies here too.
      if (!turn.ok) {
        sendEvent(controller, { event: "error", error: turn.error });
        sendEvent(controller, { event: "done" });
        controller.close();
        return;
      }

      // setCookie is now on the HTTP response header (set by the route handler)
      // but we still include it in the start event for clients that may read it
      // from the stream (belt-and-suspenders).
      sendEvent(controller, { event: "start", setCookie });

      sendEvent(controller, {
        event: "reply",
        reply: turn.reply,
        combos: turn.combos,
        actions: turn.actions,
        shopperId: turn.shopperId,
        latencyMs: turn.latencyMs,
      });

      sendEvent(controller, { event: "done" });
      controller.close();
    },
  });

  return { stream, setCookie };
}
