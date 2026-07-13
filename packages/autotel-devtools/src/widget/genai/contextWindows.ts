// Per-model context-window sizes (total tokens the model can attend to in one
// request). Mirrors the shape and matching strategy of `prices.ts`: a tiny seed
// table keyed `${provider}/${model}` lowercased, matched by longest model
// prefix so versioned suffixes (`-2024-07-18`, `-latest`) resolve to the base
// entry. Intentionally small — PRs welcome to expand.
//
// Used by the GenAI view's context-window gauge to show how full the prompt is
// relative to the model's budget.

import { makeProviderModelLookup } from './providerModel';

const TABLE: Record<string, number> = {
  // OpenAI
  'openai/gpt-4o': 128_000,
  'openai/gpt-4o-mini': 128_000,
  'openai/gpt-4.1': 1_047_576,
  'openai/gpt-4-turbo': 128_000,
  'openai/gpt-4': 8_192,
  'openai/gpt-3.5-turbo': 16_385,
  'openai/o1': 200_000,
  'openai/o3': 200_000,
  // Anthropic
  'anthropic/claude-opus-4': 200_000,
  'anthropic/claude-sonnet-4': 200_000,
  'anthropic/claude-3-5-sonnet': 200_000,
  'anthropic/claude-3-5-haiku': 200_000,
  'anthropic/claude-3-opus': 200_000,
  'anthropic/claude-3-haiku': 200_000,
  // Google
  'google/gemini-2.5-pro': 1_048_576,
  'google/gemini-2.5-flash': 1_048_576,
  'google/gemini-2.0-flash': 1_048_576,
  'google/gemini-1.5-pro': 2_097_152,
  'google/gemini-1.5-flash': 1_048_576,
  // Others
  'mistral/mistral-large': 128_000,
  'mistral/mistral-small': 32_000,
  'groq/llama-3.1-70b': 131_072,
  'deepseek/deepseek-chat': 65_536,
};

/**
 * Look up the total context-window size (in tokens) for a provider/model, or
 * `undefined` when the model isn't in the seed table. Matched by normalized
 * provider + longest model prefix (see `makeProviderModelLookup`).
 */
export const lookupContextWindow: (
  provider: string,
  model: string,
) => number | undefined = makeProviderModelLookup(TABLE);
