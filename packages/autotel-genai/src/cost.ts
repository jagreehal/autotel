/**
 * Per-model LLM cost estimation.
 *
 * Estimate the USD cost of a GenAI call from its token usage and record it as
 * the `gen_ai.usage.cost.usd` span attribute. Pair with the
 * `gen_ai.client.cost.usd` metric-bucket advice in {@link ./metrics}.
 *
 * @example
 * ```typescript
 * import { trace } from 'autotel';
 * import { recordLLMCost } from 'autotel-genai/cost';
 *
 * export const chat = trace((ctx) => async (prompt: string) => {
 *   const res = await client.messages.create({ model, ... });
 *   recordLLMCost(ctx, model, {
 *     inputTokens: res.usage.input_tokens,
 *     outputTokens: res.usage.output_tokens,
 *     cacheReadInputTokens: res.usage.cache_read_input_tokens,
 *   });
 *   return res;
 * });
 * ```
 */

import type { TraceContext } from 'autotel';
import { GEN_AI } from './semconv.js';

/** Span attribute key autotel sets for an estimated call cost. */
export const GEN_AI_COST_ATTRIBUTE = GEN_AI.USAGE_COST_USD;

/** Pricing for a single model, in USD per 1,000,000 tokens. */
export interface ModelPricing {
  /** USD per 1M input (prompt) tokens. */
  inputPer1M: number;
  /** USD per 1M output (completion) tokens, including reasoning tokens. */
  outputPer1M: number;
  /**
   * USD per 1M cache-read input tokens. Defaults to
   * {@link ModelPricing.inputPer1M}. Anthropic prompt caching reads bill at
   * ~0.1× input; OpenAI cached input bills at ~0.25–0.5× input.
   */
  cachedInputPer1M?: number;
  /**
   * USD per 1M cache-write (cache-creation) input tokens. Defaults to
   * {@link ModelPricing.inputPer1M}. Anthropic cache writes bill at ~1.25×
   * input; most other providers do not bill cache writes separately.
   */
  cacheWritePer1M?: number;
}

/**
 * Token counts for a single GenAI call. Field names mirror the canonical
 * `gen_ai.usage.*` attributes.
 *
 * Note on overlap: providers differ on whether `inputTokens` already includes
 * cached tokens. Following OpenAI semantics, {@link estimateLLMCost} treats
 * `cacheReadInputTokens` as a **subset** of `inputTokens` (so cached tokens are
 * re-priced at the cached rate), while `cacheCreationInputTokens` is billed
 * **in addition** at the cache-write rate (Anthropic semantics).
 */
export interface TokenUsage {
  /** `gen_ai.usage.input_tokens` */
  inputTokens?: number;
  /** `gen_ai.usage.output_tokens` (includes reasoning tokens). */
  outputTokens?: number;
  /** `gen_ai.usage.reasoning.output_tokens` — already billed within output. */
  reasoningOutputTokens?: number;
  /** `gen_ai.usage.cache_read.input_tokens` — subset of `inputTokens`. */
  cacheReadInputTokens?: number;
  /** `gen_ai.usage.cache_creation.input_tokens` — billed in addition. */
  cacheCreationInputTokens?: number;
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
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10, cachedInputPer1M: 1.25 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, cachedInputPer1M: 0.075 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8, cachedInputPer1M: 0.5 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6, cachedInputPer1M: 0.1 },
  'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4, cachedInputPer1M: 0.025 },
  'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4, cachedInputPer1M: 0.55 },
  // Anthropic Claude (cache read ~0.1×, cache write ~1.25×)
  'claude-opus-4': {
    inputPer1M: 15,
    outputPer1M: 75,
    cachedInputPer1M: 1.5,
    cacheWritePer1M: 18.75,
  },
  'claude-sonnet-4': {
    inputPer1M: 3,
    outputPer1M: 15,
    cachedInputPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  'claude-3-5-sonnet': {
    inputPer1M: 3,
    outputPer1M: 15,
    cachedInputPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  'claude-3-5-haiku': {
    inputPer1M: 0.8,
    outputPer1M: 4,
    cachedInputPer1M: 0.08,
    cacheWritePer1M: 1,
  },
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
 * Estimate the USD cost of a GenAI call. Returns `undefined` when the model has
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

  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const billedInput = Math.max(0, (usage.inputTokens ?? 0) - cacheRead);
  const output = usage.outputTokens ?? 0;
  const cacheReadRate = price.cachedInputPer1M ?? price.inputPer1M;
  const cacheWriteRate = price.cacheWritePer1M ?? price.inputPer1M;

  const cost =
    (billedInput / 1_000_000) * price.inputPer1M +
    (cacheRead / 1_000_000) * cacheReadRate +
    (cacheWrite / 1_000_000) * cacheWriteRate +
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
