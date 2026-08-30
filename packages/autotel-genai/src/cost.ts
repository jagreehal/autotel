/**
 * Per-model LLM cost estimation.
 *
 * Estimate the USD cost of a GenAI call from its token usage and record it as
 * the `gen_ai.usage.cost.usd` span attribute. Pair with the
 * `gen_ai.client.cost.usd` metric-bucket advice in {@link ./metrics}.
 *
 * @example
 * ```typescript
 * import { withTracing } from 'autotel';
 * import { recordLLMCost } from 'autotel-genai/cost';
 *
 * export const chat = withTracing({ name: 'genai.chat' })((ctx) => async (prompt: string) => {
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
import { recordEvidence } from 'autotel/evidence';
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
  /**
   * USD per 1,000 calls to a server-side tool, keyed by tool name. Overrides
   * {@link SERVER_TOOL_PRICING_PER_1K} for this model.
   */
  serverToolPer1K?: Record<string, number>;
}

/**
 * USD per 1,000 calls for provider-hosted tools **that are billed per call**.
 * Approximate public list prices at the time of writing and, like
 * {@link MODEL_PRICING}, a convenience default rather than a billing source of
 * truth.
 *
 * An agent that searches the web on every step can spend more here than on
 * tokens, and a cost built from token counts alone will never show it.
 *
 * The unit is the entry requirement. A tool billed by container session
 * (OpenAI's code interpreter), by execution time (Anthropic's), or bundled free
 * alongside another tool has no per-call price, and inventing one is worse than
 * having none: 100 calls inside a single session priced per call overstates the
 * bill by two orders of magnitude, and a confident wrong number is harder to
 * catch than a missing one. Such tools stay out of this table and surface
 * through {@link unpricedServerTools} instead — a caller who knows their own
 * contract can still price one via `ModelPricing.serverToolPer1K`.
 */
export const SERVER_TOOL_PRICING_PER_1K: Record<string, number> = {
  web_search: 10,
  file_search: 2.5,
};

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
  /**
   * Whether the provider reports cache tokens *in addition to* `inputTokens`
   * rather than as a subset of it. Defaults to `false` (subset), which is what
   * OpenAI and Anthropic do directly.
   *
   * Gateways and normalised usage objects — Bedrock, the Vercel AI SDK — do not
   * all agree, and getting it backwards subtracts a pool that was never in the
   * input, understating the bill on exactly the calls that cost the most.
   */
  cacheTokensExclusive?: boolean;
  /**
   * Calls to provider-hosted tools, keyed by tool name — `web_search`,
   * `code_interpreter`, `file_search`. Billed per call, priced from
   * {@link SERVER_TOOL_PRICING_PER_1K}.
   */
  serverToolCalls?: Record<string, number>;
  /**
   * Where the token counts came from: `observed` when the provider reported
   * them, `estimated` when they were counted or guessed locally. Recorded as
   * `autotel.evidence.tokens`, because an estimated count and a reported one
   * look identical once they are both just numbers on a span.
   */
  tokenSource?: 'observed' | 'estimated';
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
  'gpt-4o-mini': {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    cachedInputPer1M: 0.075,
  },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8, cachedInputPer1M: 0.5 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6, cachedInputPer1M: 0.1 },
  'gpt-4.1-nano': {
    inputPer1M: 0.1,
    outputPer1M: 0.4,
    cachedInputPer1M: 0.025,
  },
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

/** The table this model's tool prices resolve through, model entry first. */
function serverToolRate(
  price: ModelPricing,
  tool: string,
): number | undefined {
  return price.serverToolPer1K?.[tool] ?? SERVER_TOOL_PRICING_PER_1K[tool];
}

/**
 * Server-side tools in `usage` that no price table covers, so their charge is
 * absent from {@link estimateLLMCost}'s figure. Empty when everything priced —
 * including when the model itself has no pricing, since then there is no cost
 * to be incomplete.
 */
export function unpricedServerTools(
  model: string,
  usage: TokenUsage,
  options?: EstimateCostOptions,
): string[] {
  const calls = usage.serverToolCalls;
  if (!calls) return [];
  const table = options?.pricing
    ? { ...MODEL_PRICING, ...options.pricing }
    : MODEL_PRICING;
  const price = resolvePricing(table, model);
  if (!price) return [];
  return Object.keys(calls).filter(
    (tool) => serverToolRate(price, tool) === undefined,
  );
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
  const input = usage.inputTokens ?? 0;
  // Cache writes are always billed on top; only cache reads are ambiguous.
  const billedInput = usage.cacheTokensExclusive
    ? input
    : Math.max(0, input - cacheRead);
  const output = usage.outputTokens ?? 0;
  const cacheReadRate = price.cachedInputPer1M ?? price.inputPer1M;
  const cacheWriteRate = price.cacheWritePer1M ?? price.inputPer1M;

  let serverToolCost = 0;
  for (const [tool, count] of Object.entries(usage.serverToolCalls ?? {})) {
    const rate = serverToolRate(price, tool);
    // An unpriced tool is left out rather than guessed at zero; the gap is
    // declared through `unpricedServerTools`.
    if (rate !== undefined) serverToolCost += (count / 1000) * rate;
  }

  const cost =
    (billedInput / 1_000_000) * price.inputPer1M +
    (cacheRead / 1_000_000) * cacheReadRate +
    (cacheWrite / 1_000_000) * cacheWriteRate +
    (output / 1_000_000) * price.outputPer1M +
    serverToolCost;

  return round(cost);
}

/**
 * Estimate cost and record it on `ctx` as the `gen_ai.usage.cost.usd` span
 * attribute. Returns the estimated cost, or `undefined` when the model has no
 * known pricing.
 *
 * Either way the span is labelled: `autotel.evidence.cost` is `estimated` when
 * a figure was computed from the price table, and `unobservable` when it could
 * not be. A cost attribute carries no hint of which it is, and an absent one is
 * indistinguishable from a free call — both read as fact to whoever queries it.
 *
 * A provider-reported cost should be set directly and labelled `observed` via
 * `recordEvidence` from `autotel/evidence`.
 */
export function recordLLMCost(
  ctx: Pick<TraceContext, 'setAttribute'>,
  model: string,
  usage: TokenUsage,
  options?: EstimateCostOptions,
): number | undefined {
  if (usage.tokenSource) recordEvidence(ctx, 'tokens', usage.tokenSource);
  const cost = estimateLLMCost(model, usage, options);
  if (cost === undefined) {
    recordEvidence(ctx, 'cost', 'unobservable');
    return undefined;
  }
  const unpriced = unpricedServerTools(model, usage, options);
  if (unpriced.length > 0) {
    ctx.setAttribute(GEN_AI.USAGE_COST_UNPRICED_TOOLS, unpriced);
  }
  ctx.setAttribute(GEN_AI_COST_ATTRIBUTE, cost);
  recordEvidence(ctx, 'cost', 'estimated');
  return cost;
}
