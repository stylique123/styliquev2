// Gemini provider — implements ModelProvider against Google AI Studio REST API.
//
// Translates Brain types ↔ Gemini wire format. No SDK dependency.

import type {
  ModelProvider, ProviderTurnInput, ProviderTurnOutput,
  ProviderToolCall, ToolDef,
} from "../types.js";

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

// Split a data URL into { mimeType, base64 }. Returns null if invalid.
function splitDataUrl(url: string): { mimeType: string; data: string } | null {
  const m = /^data:([\w./+-]+);base64,(.+)$/.exec(url);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

export function createGeminiProvider(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): ModelProvider {
  const model = opts.model ?? "gemini-2.5-flash";
  const f = opts.fetchImpl ?? fetch;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  return {
    key: "gemini",
    defaultModel: model,

    async turn(input: ProviderTurnInput): Promise<ProviderTurnOutput> {
      const contents: GeminiContent[] = input.messages.map((m) => {
        const parts: GeminiPart[] = [];
        // Attach image first (Gemini convention) when present.
        if (m.imageDataUrl) {
          const img = splitDataUrl(m.imageDataUrl);
          if (img) parts.push({ inlineData: img });
        }
        // Always include the text (even if empty — Gemini accepts it).
        parts.push({ text: m.text || "" });
        return { role: m.role, parts };
      });

      // If we have prior tool calls + pending results from the previous hop,
      // append them so Gemini's content chain is valid:
      //   ... → model{functionCall} → user{functionResponse} → model(next)
      if (input.priorToolCalls?.length) {
        contents.push({
          role: "model",
          parts: input.priorToolCalls.map((c) => ({
            functionCall: { name: c.name, args: c.args },
          })),
        });
      }
      if (input.pendingToolResults?.length) {
        contents.push({
          role: "user",
          parts: input.pendingToolResults.map((r) => ({
            functionResponse: { name: r.name, response: r.response },
          })),
        });
      }

      const res = await f(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { role: "user", parts: [{ text: input.systemPrompt }] },
          contents,
          tools: [{ functionDeclarations: input.tools.map(toolToGemini) }],
          generationConfig: {
            temperature: input.temperature ?? 0.85,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`gemini_http_${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> };
      const parts = data.candidates?.[0]?.content?.parts ?? [];

      const toolCalls: ProviderToolCall[] = [];
      let text = "";
      for (const p of parts) {
        if ("functionCall" in p) {
          toolCalls.push({ name: p.functionCall.name, args: p.functionCall.args ?? {} });
        } else if ("text" in p) {
          text += p.text;
        }
      }
      return { toolCalls, text };
    },
  };
}

function toolToGemini(t: ToolDef): {
  name: string; description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
} {
  return {
    name: t.name,
    description: t.description,
    parameters: {
      type: "object",
      properties: t.schema.properties as Record<string, unknown>,
      required: t.schema.required,
    },
  };
}
