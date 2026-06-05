// OpenAI provider — STUB. See anthropic.ts for the same rationale.

import type {
  ModelProvider, ProviderTurnInput, ProviderTurnOutput,
} from "../types.js";

export function createOpenAIProvider(opts: {
  apiKey?: string;
  model?: string;
}): ModelProvider {
  const model = opts.model ?? "gpt-4o";
  return {
    key: "openai",
    defaultModel: model,

    async turn(_input: ProviderTurnInput): Promise<ProviderTurnOutput> {
      if (!opts.apiKey) {
        throw new Error("openai_not_configured: set OPENAI_API_KEY and finish provider implementation");
      }
      // TODO: implement against OpenAI Chat Completions or Responses API.
      // Map function_call → ProviderToolCall; assistant message content → text.
      throw new Error("openai_provider_unimplemented");
    },
  };
}
