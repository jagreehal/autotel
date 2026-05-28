/**
 * Per-model LLM cost estimation.
 *
 * Estimate the USD cost of an LLM call from its token usage and record it as a
 * span attribute (`gen_ai.usage.cost.usd`). Pair with the
 * `gen_ai.client.cost.usd` metric bucket advice in `gen-ai-metrics`.
 *
 * @example
 * ```typescript
 * import { trace, recordLLMCost } from 'autotel';
 *
 * export const chat = trace((ctx) => async (prompt: string) => {
 *   const res = await client.messages.create({ model, ... });
 *   recordLLMCost(ctx, model, {
 *     inputTokens: res.usage.input_tokens,
 *     outputTokens: res.usage.output_tokens,
 *   });
 *   return res;
 * });
 * ```
 */

import type { TraceContext } from './trace-context';

/** Span attribute key autotel sets for an estimated call cost. */
export const GEN_AI_COST_ATTRIBUTE = 'gen_ai.usage.cost.usd';

/** Pricing for a single model, in USD per 1,000,000 tokens. */
export interface ModelPricing {
  /** USD per 1M input (prompt) tokens. */
  inputPer1M: number;
  /** USD per 1M output (completion) tokens. */
  outputPer1M: number;
  /** USD per 1M cached input tokens. Defaults to {@link ModelPricing.inputPer1M}. */
  cachedInputPer1M?: number;
}

/** Token counts for a single LLM call. */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Cached input tokens, billed at {@link ModelPricing.cachedInputPer1M}. */
  cachedInputTokens?: number;
}

export interface EstimateCostOptions {
  /** Override or extend {@link MODEL_PRICING}. Keys are matched first. */
  pricing?: Record<string, ModelPricing>;
}

/**
 * Approximate public list prices (USD per 1M tokens) at the time of writing.
 * Prices change; treat these as convenience defaults, not a billing source of
 * truth. Override per call via `options.pricing` or mutate this table at init.
 * Matching is exact first, then by longest key prefix, so versioned model ids
 * (`claude-sonnet-4-6-20251101`) resolve to a base entry (`claude-sonnet-4-6`).
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  // Anthropic Claude
  'claude-opus-4': { inputPer1M: 15, outputPer1M: 75 },
  'claude-sonnet-4': { inputPer1M: 3, outputPer1M: 15 },
  'claude-3-5-sonnet': { inputPer1M: 3, outputPer1M: 15 },
  'claude-3-5-haiku': { inputPer1M: 0.8, outputPer1M: 4 },
  'claude-3-opus': { inputPer1M: 15, outputPer1M: 75 },
  'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
  // Google Gemini
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
};

function resolvePricing(
  table: Record<string, ModelPricing>,
  model: string,
): ModelPricing | undefined {
  const exact = table[model];
  if (exact) return exact;

  let best: ModelPricing | undefined;
  let bestLength = 0;
  for (const key of Object.keys(table)) {
    if (model.startsWith(key) && key.length > bestLength) {
      best = table[key];
      bestLength = key.length;
    }
  }
  return best;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Estimate the USD cost of an LLM call. Returns `undefined` when the model has
 * no known pricing (supply one via `options.pricing`).
 */
export function estimateLLMCost(
  model: string,
  usage: TokenUsage,
  options?: EstimateCostOptions,
): number | undefined {
  const table = options?.pricing
    ? { ...MODEL_PRICING, ...options.pricing }
    : MODEL_PRICING;
  const price = resolvePricing(table, model);
  if (!price) return undefined;

  const cachedInput = usage.cachedInputTokens ?? 0;
  const billedInput = Math.max(0, (usage.inputTokens ?? 0) - cachedInput);
  const output = usage.outputTokens ?? 0;
  const cachedRate = price.cachedInputPer1M ?? price.inputPer1M;

  const cost =
    (billedInput / 1_000_000) * price.inputPer1M +
    (cachedInput / 1_000_000) * cachedRate +
    (output / 1_000_000) * price.outputPer1M;

  return round(cost);
}

/**
 * Estimate cost and record it on `ctx` as the `gen_ai.usage.cost.usd` span
 * attribute. Returns the estimated cost, or `undefined` when the model is
 * unknown (in which case no attribute is set).
 */
export function recordLLMCost(
  ctx: Pick<TraceContext, 'setAttribute'>,
  model: string,
  usage: TokenUsage,
  options?: EstimateCostOptions,
): number | undefined {
  const cost = estimateLLMCost(model, usage, options);
  if (cost !== undefined) {
    ctx.setAttribute(GEN_AI_COST_ATTRIBUTE, cost);
  }
  return cost;
}
