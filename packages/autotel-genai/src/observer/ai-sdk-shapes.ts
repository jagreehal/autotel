/**
 * Shared structural converters from Vercel AI SDK shapes to autotel inputs.
 *
 * The AI SDK reports the same data three ways — the lifecycle `Telemetry`
 * events ({@link autotelTelemetry}), the `ai:telemetry` channel messages
 * ({@link subscribeAiTelemetry}), and a finished call result
 * ({@link observeAiSdkResult}) — and across v4/v5 with differing field names
 * (`promptTokens` vs `inputTokens`, flat vs nested token details). These helpers
 * are the single place that normalizes those shapes, so the three entry points
 * stay consistent and none of them re-derive the mapping.
 */

import { normalizeAiSdkProvider } from '../ai-sdk-bridge.js';
import type { GenAiRequestInput } from '../attributes.js';
import type { TokenUsage } from '../cost.js';
import { GEN_AI_OPERATION } from '../semconv.js';

/** Every AI SDK token-usage field name we understand (v4 + v5, flat + nested). */
export interface AiSdkUsageShape {
  inputTokens?: number;
  outputTokens?: number;
  /** v4 aliases. */
  promptTokens?: number;
  completionTokens?: number;
  /** Embedding usage. */
  tokens?: number;
  /** Flat v5 detail fields. */
  reasoningTokens?: number;
  cachedInputTokens?: number;
  /** Nested v5 detail fields. */
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
}

/** Map any AI SDK usage shape to {@link TokenUsage}; `undefined` if all empty. */
export function toTokenUsage(
  usage: AiSdkUsageShape | undefined,
): TokenUsage | undefined {
  if (!usage) return undefined;
  const tokenUsage: TokenUsage = {
    inputTokens: usage.inputTokens ?? usage.promptTokens ?? usage.tokens,
    outputTokens: usage.outputTokens ?? usage.completionTokens,
    reasoningOutputTokens:
      usage.reasoningTokens ?? usage.outputTokenDetails?.reasoningTokens,
    cacheReadInputTokens:
      usage.cachedInputTokens ?? usage.inputTokenDetails?.cacheReadTokens,
    cacheCreationInputTokens: usage.inputTokenDetails?.cacheWriteTokens,
  };
  return Object.values(tokenUsage).some((v) => v !== undefined)
    ? tokenUsage
    : undefined;
}

/** Normalize an optional AI SDK provider id to a canonical `gen_ai` provider. */
export function normalizeProvider(provider: string | undefined) {
  return provider ? normalizeAiSdkProvider(provider) : undefined;
}

/** Request-side fields shared by the lifecycle and channel model-call events. */
export interface AiSdkRequestShape {
  provider?: string;
  modelId?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  seed?: number;
}

/** Build the `chat` request attributes from a model-call start event. */
export function toChatRequest(event: AiSdkRequestShape): GenAiRequestInput {
  return {
    operation: GEN_AI_OPERATION.CHAT,
    provider: normalizeProvider(event.provider),
    model: event.modelId,
    temperature: event.temperature,
    maxTokens: event.maxOutputTokens,
    topP: event.topP,
    topK: event.topK,
    frequencyPenalty: event.frequencyPenalty,
    presencePenalty: event.presencePenalty,
    stopSequences: event.stopSequences,
    seed: event.seed,
  };
}
