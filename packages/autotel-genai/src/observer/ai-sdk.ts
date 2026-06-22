/**
 * Vercel AI SDK → {@link createGenAiObserver} glue.
 *
 * The AI SDK has no global event stream; its stable surface is the result of a
 * `generateText`/`streamText` call (`steps`, each with `usage`, `toolCalls`,
 * `toolResults`, `response`). {@link observeAiSdkResult} walks that result and
 * emits observer events:
 *
 *   - a trivial single-step call with no tools → one `chat` span;
 *   - a multi-step or tool-using call → an `invoke_agent` wrapper (mirroring the
 *     AI SDK's own `invoke_agent › chat › execute_tool` hierarchy) with a `chat`
 *     per step and an `execute_tool` per tool call.
 *
 * Typed structurally against the AI SDK result shape so it pulls in no
 * dependency and tolerates v4/v5 field differences (`promptTokens` vs
 * `inputTokens`). Cost is left to the observer, which prices `chat` usage.
 *
 * @example
 * ```ts
 * const observe = createGenAiObserver();
 * const result = await generateText({ model: openai('gpt-4o'), prompt });
 * observeAiSdkResult(observe, result, { id: 'gen-1', provider: 'openai', model: 'gpt-4o' });
 * ```
 */

import type { TimeInput } from '@opentelemetry/api';
import { normalizeAiSdkProvider } from '../ai-sdk-bridge.js';
import type { GenAiProviderName } from '../semconv.js';
import { toTokenUsage } from './ai-sdk-shapes.js';
import type { GenAiObserver } from './types.js';

/** AI SDK usage object — canonical (v5) or legacy (v4) field names. */
export interface AiSdkUsage {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface AiSdkToolCall {
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  args?: unknown;
}

export interface AiSdkToolResult {
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
}

/** One AI SDK step (also the shape of a single-call result). */
export interface AiSdkStep {
  usage?: AiSdkUsage;
  finishReason?: string;
  response?: { id?: string; modelId?: string; timestamp?: Date | number };
  toolCalls?: AiSdkToolCall[];
  toolResults?: AiSdkToolResult[];
}

/** An AI SDK `generateText`/`streamText` result. */
export interface AiSdkResult extends AiSdkStep {
  steps?: AiSdkStep[];
}

export interface ObserveAiSdkOptions {
  /** Base span id; per-step and per-tool ids derive from it. */
  id: string;
  parentId?: string;
  /** AI SDK provider id (e.g. `openai`, `amazon-bedrock`); normalized for you. */
  provider?: string;
  /** Request model — used for the span name and as the cost model. */
  model?: string;
}

const AI_SDK_AGENT_NAME = 'ai-sdk';

export function observeAiSdkResult(
  observe: GenAiObserver,
  result: AiSdkResult,
  options: ObserveAiSdkOptions,
): void {
  const provider: GenAiProviderName | undefined = options.provider
    ? normalizeAiSdkProvider(options.provider)
    : undefined;
  const steps = result.steps ?? [result];
  const toolCount = steps.reduce(
    (total, step) => total + (step.toolCalls?.length ?? 0),
    0,
  );

  if (steps.length <= 1 && toolCount === 0) {
    emitChat(observe, steps[0] ?? result, {
      id: options.id,
      parentId: options.parentId,
      provider,
      model: options.model,
    });
    return;
  }

  observe({
    type: 'agent.start',
    id: options.id,
    parentId: options.parentId,
    provider,
    agent: { name: options.model ?? AI_SDK_AGENT_NAME },
  });
  steps.forEach((step, index) => {
    emitChat(observe, step, {
      id: `${options.id}:step:${index}`,
      parentId: options.id,
      provider,
      model: options.model,
    });
    emitTools(observe, step, options.id, index);
  });
  observe({ type: 'agent.end', id: options.id });
}

interface ChatContext {
  id: string;
  parentId?: string;
  provider?: GenAiProviderName;
  model?: string;
}

function emitChat(
  observe: GenAiObserver,
  step: AiSdkStep,
  ctx: ChatContext,
): void {
  observe({
    type: 'chat.start',
    id: ctx.id,
    parentId: ctx.parentId,
    request: { provider: ctx.provider, model: ctx.model },
  });
  const responseModel = step.response?.modelId;
  observe({
    type: 'chat.end',
    id: ctx.id,
    response: {
      model: responseModel,
      id: step.response?.id,
      finishReasons: step.finishReason ? [step.finishReason] : undefined,
    },
    usage: toTokenUsage(step.usage),
    costModel: ctx.model ?? responseModel,
    endTime: asTimeInput(step.response?.timestamp),
  });
}

function emitTools(
  observe: GenAiObserver,
  step: AiSdkStep,
  parentId: string,
  stepIndex: number,
): void {
  const results = step.toolResults ?? [];
  (step.toolCalls ?? []).forEach((call, callIndex) => {
    const id = `${parentId}:tool:${call.toolCallId ?? `${stepIndex}.${callIndex}`}`;
    observe({
      type: 'tool.start',
      id,
      parentId,
      tool: { name: call.toolName, callId: call.toolCallId },
      callArguments: call.input ?? call.args,
    });
    const result = call.toolCallId
      ? results.find((r) => r.toolCallId === call.toolCallId)
      : results[callIndex];
    observe({
      type: 'tool.end',
      id,
      callResult: result?.output ?? result?.result,
    });
  });
}

function asTimeInput(value: Date | number | undefined): TimeInput | undefined {
  return value instanceof Date || typeof value === 'number' ? value : undefined;
}
