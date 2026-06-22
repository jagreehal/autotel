/**
 * Vercel AI SDK interop.
 *
 * The current Vercel AI SDK (`@ai-sdk/otel`'s `OpenTelemetry` integration,
 * stable since v7) already emits canonical `gen_ai.*` attributes and the
 * `invoke_agent {model}` › `chat {model}` › `execute_tool {tool}` span
 * hierarchy — so for new code there is nothing to map.
 *
 * This module exists for the two cases that still need help:
 *
 *   1. **Legacy `ai.*` attributes** — spans from `LegacyOpenTelemetry` or older
 *      AI SDK versions. {@link mapAiSdkAttributes} rewrites them to `gen_ai.*`.
 *   2. **Cost enrichment** — neither integration emits cost. Pull usage from a
 *      span's attributes (canonical *or* legacy) with {@link extractAiSdkUsage}
 *      and price it, or copy a canonical `gen_ai.usage.cost.usd` onto your own
 *      wrapping span with {@link recordAiSdkCost}.
 *
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry
 */

import type { TraceContext } from 'autotel';
import {
  genAiUsageAttributes,
  type GenAiAttributeMap,
} from './attributes.js';
import {
  estimateLLMCost,
  type EstimateCostOptions,
  type TokenUsage,
} from './cost.js';
import {
  GEN_AI,
  GEN_AI_PROVIDER,
  type GenAiProviderName,
} from './semconv.js';

/** Legacy AI SDK (`LegacyOpenTelemetry`) attribute keys we understand. */
export const AI_SDK_ATTR = {
  MODEL_ID: 'ai.model.id',
  MODEL_PROVIDER: 'ai.model.provider',
  RESPONSE_MODEL: 'ai.response.model',
  RESPONSE_ID: 'ai.response.id',
  RESPONSE_FINISH_REASON: 'ai.response.finishReason',
  USAGE_PROMPT_TOKENS: 'ai.usage.promptTokens',
  USAGE_INPUT_TOKENS: 'ai.usage.inputTokens',
  USAGE_COMPLETION_TOKENS: 'ai.usage.completionTokens',
  USAGE_OUTPUT_TOKENS: 'ai.usage.outputTokens',
  USAGE_CACHED_INPUT_TOKENS: 'ai.usage.cachedInputTokens',
  USAGE_REASONING_TOKENS: 'ai.usage.reasoningTokens',
  SETTINGS_MAX_TOKENS: 'ai.settings.maxOutputTokens',
  TELEMETRY_FUNCTION_ID: 'ai.telemetry.functionId',
} as const;

const PROVIDER_PREFIX_MAP: Record<string, GenAiProviderName> = {
  openai: GEN_AI_PROVIDER.OPENAI,
  azure: GEN_AI_PROVIDER.AZURE_AI_OPENAI,
  anthropic: GEN_AI_PROVIDER.ANTHROPIC,
  google: GEN_AI_PROVIDER.GCP_GEMINI,
  'google-vertex': GEN_AI_PROVIDER.GCP_VERTEX_AI,
  vertex: GEN_AI_PROVIDER.GCP_VERTEX_AI,
  'amazon-bedrock': GEN_AI_PROVIDER.AWS_BEDROCK,
  bedrock: GEN_AI_PROVIDER.AWS_BEDROCK,
  cohere: GEN_AI_PROVIDER.COHERE,
  mistral: GEN_AI_PROVIDER.MISTRAL_AI,
  groq: GEN_AI_PROVIDER.GROQ,
  deepseek: GEN_AI_PROVIDER.DEEPSEEK,
  perplexity: GEN_AI_PROVIDER.PERPLEXITY,
  xai: GEN_AI_PROVIDER.X_AI,
};

/**
 * Normalize an AI SDK provider id (e.g. `openai.chat`, `amazon-bedrock`,
 * `google.generative-ai`) to a canonical `gen_ai.provider.name` value. Returns
 * the original string when it isn't a known provider.
 */
export function normalizeAiSdkProvider(provider: string): GenAiProviderName {
  const head = provider.split('.')[0]?.toLowerCase() ?? provider;
  return PROVIDER_PREFIX_MAP[head] ?? provider;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Extract {@link TokenUsage} from a span's attributes, reading canonical
 * `gen_ai.usage.*` first and falling back to legacy `ai.usage.*`. Returns
 * `undefined` when no token counts are present.
 */
export function extractAiSdkUsage(
  attributes: Record<string, unknown>,
): TokenUsage | undefined {
  const inputTokens =
    num(attributes[GEN_AI.USAGE_INPUT_TOKENS]) ??
    num(attributes[AI_SDK_ATTR.USAGE_INPUT_TOKENS]) ??
    num(attributes[AI_SDK_ATTR.USAGE_PROMPT_TOKENS]);
  const outputTokens =
    num(attributes[GEN_AI.USAGE_OUTPUT_TOKENS]) ??
    num(attributes[AI_SDK_ATTR.USAGE_OUTPUT_TOKENS]) ??
    num(attributes[AI_SDK_ATTR.USAGE_COMPLETION_TOKENS]);
  const cacheReadInputTokens =
    num(attributes[GEN_AI.USAGE_CACHE_READ_INPUT_TOKENS]) ??
    num(attributes[AI_SDK_ATTR.USAGE_CACHED_INPUT_TOKENS]);
  const reasoningOutputTokens =
    num(attributes[GEN_AI.USAGE_REASONING_OUTPUT_TOKENS]) ??
    num(attributes[AI_SDK_ATTR.USAGE_REASONING_TOKENS]);
  const cacheCreationInputTokens = num(
    attributes[GEN_AI.USAGE_CACHE_CREATION_INPUT_TOKENS],
  );

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadInputTokens === undefined &&
    reasoningOutputTokens === undefined &&
    cacheCreationInputTokens === undefined
  ) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
  };
}

/** Read the request model from canonical or legacy attributes. */
export function extractAiSdkModel(
  attributes: Record<string, unknown>,
): string | undefined {
  return (
    str(attributes[GEN_AI.REQUEST_MODEL]) ?? str(attributes[AI_SDK_ATTR.MODEL_ID])
  );
}

/**
 * Rewrite legacy `ai.*` telemetry attributes to canonical `gen_ai.*`. Pass the
 * attributes of an AI SDK span emitted by `LegacyOpenTelemetry` (or an older
 * SDK version); returns a fresh map with the canonical keys. Unknown keys are
 * dropped — this is a focused mapper, not a passthrough.
 */
export function mapAiSdkAttributes(
  attributes: Record<string, unknown>,
): GenAiAttributeMap {
  const out: GenAiAttributeMap = {};

  const model = str(attributes[AI_SDK_ATTR.MODEL_ID]);
  if (model) out[GEN_AI.REQUEST_MODEL] = model;

  const provider = str(attributes[AI_SDK_ATTR.MODEL_PROVIDER]);
  if (provider) out[GEN_AI.PROVIDER_NAME] = normalizeAiSdkProvider(provider);

  const responseModel = str(attributes[AI_SDK_ATTR.RESPONSE_MODEL]);
  if (responseModel) out[GEN_AI.RESPONSE_MODEL] = responseModel;

  const responseId = str(attributes[AI_SDK_ATTR.RESPONSE_ID]);
  if (responseId) out[GEN_AI.RESPONSE_ID] = responseId;

  const finishReason = str(attributes[AI_SDK_ATTR.RESPONSE_FINISH_REASON]);
  if (finishReason) out[GEN_AI.RESPONSE_FINISH_REASONS] = [finishReason];

  const maxTokens = num(attributes[AI_SDK_ATTR.SETTINGS_MAX_TOKENS]);
  if (maxTokens !== undefined) out[GEN_AI.REQUEST_MAX_TOKENS] = maxTokens;

  const functionId = str(attributes[AI_SDK_ATTR.TELEMETRY_FUNCTION_ID]);
  if (functionId) out[GEN_AI.AGENT_NAME] = functionId;

  const usage = extractAiSdkUsage(attributes);
  if (usage) Object.assign(out, genAiUsageAttributes(usage));

  return out;
}

/**
 * Estimate the USD cost of an AI SDK call from a span's attributes (model +
 * usage, canonical or legacy). Returns `undefined` when model or usage is
 * missing, or the model has no known pricing.
 */
export function estimateAiSdkCost(
  attributes: Record<string, unknown>,
  options?: EstimateCostOptions,
): number | undefined {
  const model = extractAiSdkModel(attributes);
  const usage = extractAiSdkUsage(attributes);
  if (!model || !usage) return undefined;
  return estimateLLMCost(model, usage, options);
}

/**
 * Estimate cost from AI SDK span attributes and record it as
 * `gen_ai.usage.cost.usd` on your own wrapping trace context. Useful when you
 * wrap a `generateText`/`streamText` call in an autotel span and want cost on
 * the parent. Returns the estimated cost, or `undefined`.
 */
export function recordAiSdkCost(
  ctx: Pick<TraceContext, 'setAttribute'>,
  attributes: Record<string, unknown>,
  options?: EstimateCostOptions,
): number | undefined {
  const cost = estimateAiSdkCost(attributes, options);
  if (cost !== undefined) ctx.setAttribute(GEN_AI.USAGE_COST_USD, cost);
  return cost;
}

// --- `@ai-sdk/otel` enrichSpan interop -------------------------------------

/** Marks a span as having passed through an autotel-aware `enrichSpan`. */
export const AUTOTEL_ENRICHED_ATTR = 'autotel.enriched';

/** Span kinds the `@ai-sdk/otel` `OpenTelemetry` integration emits. */
export type AiSdkSpanType =
  | 'operation'
  | 'step'
  | 'languageModel'
  | 'tool'
  | 'embedding'
  | 'reranking';

/** The context `@ai-sdk/otel` passes to an `enrichSpan` callback. */
export interface AiSdkEnrichContext {
  spanType: AiSdkSpanType;
  operationId: string;
  callId: string;
  runtimeContext?: Record<string, unknown>;
}

export interface AutotelEnrichOptions {
  /**
   * Map the enrich context to extra span attributes — e.g. promote
   * `runtimeContext` fields (sessionId, tenantId) onto the span. Returns
   * `undefined` to add nothing for that span.
   */
  attributes?: (
    ctx: AiSdkEnrichContext,
  ) => Record<string, string | number | boolean> | undefined;
}

/**
 * Build an `enrichSpan` callback for the `@ai-sdk/otel` `OpenTelemetry`
 * integration. It stamps an autotel provenance marker and merges any attributes
 * your `attributes` mapper returns:
 *
 * ```ts
 * import { registerTelemetry } from 'ai';
 * import { OpenTelemetry } from '@ai-sdk/otel';
 * import { autotelEnrich } from 'autotel-genai/ai-sdk';
 *
 * registerTelemetry(new OpenTelemetry({ enrichSpan: autotelEnrich() }));
 * ```
 *
 * Important: `enrichSpan` **cannot add cost**. The AI SDK only passes
 * `{ spanType, operationId, callId, runtimeContext }` to the callback — no token
 * usage and no resolved model — and its own attributes override custom keys. For
 * `gen_ai.usage.cost.usd` on the model span, use `autotelTelemetry()` from
 * `autotel-genai/observer` (it owns span creation), or price spans after the
 * fact with {@link estimateAiSdkCost}. `autotel-devtools` also prices `gen_ai`
 * spans on render regardless of which integration emitted them.
 */
export function autotelEnrich(
  options: AutotelEnrichOptions = {},
): (ctx: AiSdkEnrichContext) => Record<string, string | number | boolean> {
  return (ctx) => ({
    [AUTOTEL_ENRICHED_ATTR]: true,
    ...options.attributes?.(ctx),
  });
}
