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
   * USD per 1,000 calls to a server-side tool, keyed by tool name. Price only
   * tools billed per call: a tool billed by session or execution time has no
   * per-call price, and stays in {@link unpricedServerTools}.
   */
  serverToolPer1K?: Record<string, number>;
  /**
   * The date these prices were read (`YYYY-MM-DD`). Recorded on the span as
   * `gen_ai.usage.cost.price_as_of`, so a cost says which prices produced it
   * and a stale price shows up.
   */
  asOf?: string;
  /** Where the prices came from: a price page, a contract, a region. */
  source?: string;
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
  /** `gen_ai.usage.cache_write.input_tokens` — billed in addition. */
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
   * `code_interpreter`, `file_search`. Billed per call, priced from the
   * model's {@link ModelPricing.serverToolPer1K}.
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

/**
 * Model id → price: exact match first,
 * then longest matching prefix after any vendor namespace is stripped.
 *
 * Key by **family**, not by deployed id. One `claude-3-5-haiku` entry covers
 * `anthropic.claude-3-5-haiku-20241022-v1:0`, the `eu.`/`us.` inference
 * profiles, the Vertex `publishers/...` path, and every later date-version.
 */
export type ModelPricingTable = Record<string, ModelPricing>;

export interface EstimateCostOptions {
  /**
   * Prices for this call only, merged over the registered prices: an entry
   * here both fills in a model they lack and overrides one they have.
   *
   * For prices that apply to the whole process, prefer
   * {@link registerModelPricing} so every entry point sees them without an
   * option threaded through each call.
   */
  pricing?: ModelPricingTable;
}

/**
 * The prices registered with {@link registerModelPricing}. autotel ships no
 * prices: they change, differ by region and contract, and a stale built-in
 * figure reads as fact. A model nobody priced is reported as unpriced.
 */
const registeredPricing: ModelPricingTable = {};

/** The prices in effect for the process, for inspection. */
export function registeredModelPricing(): Readonly<ModelPricingTable> {
  return { ...registeredPricing };
}

/**
 * Strip one leading vendor segment from a hosted model id, or return
 * `undefined` when there is nothing left to strip.
 *
 * Bedrock, Vertex and the cross-region inference profiles all namespace the
 * model rather than rename it: `anthropic.claude-3-5-haiku-20241022-v1:0`,
 * `eu.anthropic.claude-...`, `publishers/anthropic/models/claude-...`. The
 * price table is keyed on the model itself, so the prefix has to come off
 * before a lookup can hit.
 *
 * A segment containing a digit is left alone. Model families carry their
 * version in the name — `gpt-4.1-mini`, `gemini-1.5-pro`, `claude-3-opus` —
 * and stripping `gpt-4` off `gpt-4.1-mini` would turn a real key into `1-mini`.
 */
function stripVendorPrefix(model: string): string | undefined {
  const slash = model.lastIndexOf('/');
  if (slash !== -1) return model.slice(slash + 1);

  const dot = model.indexOf('.');
  if (dot === -1) return undefined;
  const head = model.slice(0, dot);
  if (head.length === 0 || /\d/.test(head)) return undefined;
  return model.slice(dot + 1);
}

// A linear scan of every key on a non-exact match, run once per strip level —
// and a namespaced id (every Bedrock one) never hits the exact-match fast path.
// Fine at table sizes in the tens; index by first segment if a large registered
// table ever shows up in a profile.
function matchPricing(
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

/**
 * Register prices for the whole process, so every cost
 * site sees them — {@link estimateLLMCost}, {@link recordLLMCost},
 * `recordGenAiUsage`, `autotelTelemetry()`, and the agent runtime — with no
 * option threaded through each call.
 *
 * This is the one to reach for with more than a couple of models: prices are a
 * property of the deployment, not of the call. Later registrations win, so a
 * base table can be layered over.
 *
 * Returns a function that restores the previous prices, useful in tests.
 *
 * @example
 * ```ts
 * import { registerModelPricing } from 'autotel-genai/cost';
 *
 * // Once at startup, from your own price list. Key by family, not by
 * // deployed model id.
 * registerModelPricing({
 *   'gpt-oss-120b': { inputPer1M: 0.18, outputPer1M: 0.7, asOf: '2026-11-14', source: 'Bedrock eu-west-1' },
 *   'acme-ft-7b': { inputPer1M: 0.1, outputPer1M: 0.1 },
 * });
 * ```
 */
/**
 * Registrations in the order they were made, so a model's price is whatever the
 * last live layer says and restoring one never disturbs another. Without the
 * stack, tearing a base table down while a per-tenant override is still live
 * would leave the override's price behind, or the base's - depending only on
 * the order the restores happened to run in.
 */
const pricingLayers: Array<{ table: ModelPricingTable; live: boolean }> = [];
/** Each model's price before any layer touched it. */
const unlayeredPricing = new Map<string, ModelPricing | undefined>();

function applyPricingLayers(models: readonly string[]): void {
  for (const model of models) {
    let price: ModelPricing | undefined;
    for (const layer of pricingLayers) {
      if (layer.live && layer.table[model]) price = layer.table[model];
    }
    price ??= unlayeredPricing.get(model);
    if (price === undefined) delete registeredPricing[model];
    else registeredPricing[model] = price;
  }
}

export function registerModelPricing(pricing: ModelPricingTable): () => void {
  const models = Object.keys(pricing);
  for (const model of models) {
    if (!unlayeredPricing.has(model)) {
      unlayeredPricing.set(model, registeredPricing[model]);
    }
  }

  const layer = { table: pricing, live: true };
  pricingLayers.push(layer);
  applyPricingLayers(models);

  return () => {
    if (!layer.live) return;
    layer.live = false;
    applyPricingLayers(models);
  };
}

function resolvePricing(
  table: Record<string, ModelPricing>,
  model: string,
): ModelPricing | undefined {
  // Least-stripped match wins, so an id the table already knows is never
  // reinterpreted by peeling a segment off it.
  let candidate: string | undefined = model;
  while (candidate !== undefined) {
    const price = matchPricing(table, candidate);
    if (price) return price;
    candidate = stripVendorPrefix(candidate);
  }
  return undefined;
}

/** The model's per-call price for a server-side tool, if it has one. */
function serverToolRate(price: ModelPricing, tool: string): number | undefined {
  return price.serverToolPer1K?.[tool];
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
    ? { ...registeredPricing, ...options.pricing }
    : registeredPricing;
  const price = resolvePricing(table, model);
  if (!price) return [];
  return Object.keys(calls).filter(
    (tool) => serverToolRate(price, tool) === undefined,
  );
}

/**
 * The `asOf` date of the price a model resolves to, for
 * `gen_ai.usage.cost.price_as_of` beside its cost. Undefined when the price
 * carries no date or the model has no price.
 */
export function priceAsOf(
  model: string,
  options?: EstimateCostOptions,
): string | undefined {
  return resolvePricing({ ...registeredPricing, ...options?.pricing }, model)
    ?.asOf;
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
    ? { ...registeredPricing, ...options.pricing }
    : registeredPricing;
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
  const asOf = priceAsOf(model, options);
  if (asOf) ctx.setAttribute(GEN_AI.USAGE_COST_PRICE_AS_OF, asOf);
  recordEvidence(ctx, 'cost', 'estimated');
  return cost;
}
