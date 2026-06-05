// Anthropic (Claude) provider — implements ModelProvider against the Anthropic
// Messages API (https://api.anthropic.com/v1/messages).
//
// Wire-format translation:
//   ProviderTurnInput.messages  → Anthropic `messages` array (role: user/assistant)
//   ProviderTurnInput.tools     → Anthropic `tools` array with `input_schema`
//   priorToolCalls              → assistant message containing `tool_use` blocks
//   pendingToolResults          → user message containing `tool_result` blocks
//   stop_reason: "tool_use"     → ProviderTurnOutput { toolCalls: [...], text: "" }
//   stop_reason: "end_turn"     → ProviderTurnOutput { toolCalls: [], text: <text> }

import type {
  ModelProvider, ProviderTurnInput, ProviderTurnOutput,
  ProviderToolCall, ToolDef,
} from "../types.js";

// ─── Anthropic wire types (minimal — only what we need) ─────────────────

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};
type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

type AnthropicResponse = {
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | string;
  model: string;
};

// ─── Helper — map a ToolDef to Anthropic tool shape ─────────────────────

function toolToAnthropic(t: ToolDef): AnthropicTool {
  return {
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      properties: t.schema.properties as Record<string, unknown>,
      required: t.schema.required,
    },
  };
}

// ─── Provider factory ────────────────────────────────────────────────────

export function createAnthropicProvider(opts: {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): ModelProvider {
  const model = opts.model ?? "claude-sonnet-4-5";
  const f = opts.fetchImpl ?? fetch;
  const endpoint = "https://api.anthropic.com/v1/messages";

  return {
    key: "anthropic",
    defaultModel: model,

    async turn(input: ProviderTurnInput): Promise<ProviderTurnOutput> {
      if (!opts.apiKey) {
        throw new Error("anthropic_not_configured: set ANTHROPIC_API_KEY");
      }

      // ── Build the messages array ─────────────────────────────────────
      // Anthropic requires strictly alternating user/assistant messages.
      // BrainMessage roles are "user" | "model"; map "model" → "assistant".
      const messages: AnthropicMessage[] = input.messages.map((m) => ({
        role: m.role === "model" ? "assistant" : "user",
        // Anthropic accepts a plain string for simple text messages.
        content: m.text || "",
      }));

      // Append prior tool-call + result blocks so the conversation chain is
      // valid. Anthropic needs:
      //   assistant: [tool_use blocks]  ← priorToolCalls
      //   user:      [tool_result blocks] ← pendingToolResults
      if (input.priorToolCalls?.length) {
        messages.push({
          role: "assistant",
          content: input.priorToolCalls.map((c): AnthropicToolUseBlock => ({
            type: "tool_use",
            id: c.callId ?? `call_${c.name}_${Date.now()}`,
            name: c.name,
            input: c.args,
          })),
        });
      }
      if (input.pendingToolResults?.length) {
        messages.push({
          role: "user",
          content: input.pendingToolResults.map((r): AnthropicToolResultBlock => ({
            type: "tool_result",
            tool_use_id: r.callId ?? `call_${r.name}_${Date.now()}`,
            content: JSON.stringify(r.response),
          })),
        });
      }

      // ── HTTP request ─────────────────────────────────────────────────
      const res = await f(endpoint, {
        method: "POST",
        headers: {
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          system: input.systemPrompt,
          messages,
          tools: input.tools.map(toolToAnthropic),
          max_tokens: 1024,
          temperature: input.temperature ?? 0.85,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`anthropic_http_${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as AnthropicResponse;
      const blocks = data.content ?? [];

      // ── Map response → ProviderTurnOutput ────────────────────────────
      if (data.stop_reason === "tool_use") {
        // Model wants to call tools.
        const toolCalls: ProviderToolCall[] = blocks
          .filter((b): b is AnthropicToolUseBlock => b.type === "tool_use")
          .map((b) => ({
            name: b.name,
            args: b.input,
            callId: b.id,
          }));
        return { toolCalls, text: "" };
      }

      // stop_reason === "end_turn" (or max_tokens) — extract text.
      const text = blocks
        .filter((b): b is AnthropicTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      return { toolCalls: [], text };
    },
  };
}
