/**
 * `autotelTelemetry` — a Vercel AI SDK telemetry integration.
 *
 * Implements the AI SDK's `Telemetry` lifecycle interface (stable since ai v7)
 * so you register it once and every `generateText` / `streamText` /
 * `generateObject` / `streamObject` / `embed` call streams a canonical
 * `gen_ai.*` span tree — live, as the operation runs, not reconstructed after
 * the fact:
 *
 * ```ts
 * import { registerTelemetry } from 'ai';
 * import { autotelTelemetry } from 'autotel-genai/observer';
 *
 * registerTelemetry(autotelTelemetry());
 * ```
 *
 * Where the built-in `@ai-sdk/otel` `OpenTelemetry` integration emits the same
 * `gen_ai.*` spans, this one additionally:
 *
 *   - prices every model call (`gen_ai.usage.cost.usd`) from {@link MODEL_PRICING};
 *   - records streaming throughput (`time_to_first_chunk`, `time_to_finish`,
 *     `output_tokens_per_second`) on each `chat` span;
 *   - keeps token usage on leaf `chat` spans only, so the `invoke_agent` root
 *     never double-counts.
 *
 * It is push-based and concurrency-safe: every lifecycle event carries the
 * AI SDK `callId`, so interleaved concurrent generations never cross wires. It
 * is the live counterpart to {@link observeAiSdkResult}, which walks a finished
 * result instead.
 *
 * Typed structurally against the AI SDK event shapes — it pulls in **no**
 * dependency on `ai` / `@ai-sdk/*`. The returned object satisfies the AI SDK
 * `Telemetry` interface by structural compatibility (every event the SDK passes
 * is a superset of the fields read here), so `registerTelemetry(autotelTelemetry())`
 * type-checks without importing the interface.
 *
 * Scope: `generateText` / `streamText` (incl. tool loops and `output`),
 * `generateObject` / `streamObject`, and `embed` / `embedMany`. Embeddings
 * open on `onEmbedStart` so duration is real. `userId` / `sessionId` on
 * `runtimeContext` become `user.id` / `gen_ai.conversation.id`; leftover
 * keys are dropped. A tool's nested `generateText` and the provider's own
 * HTTP spans parent correctly via the `executeTool` / `executeLanguageModelCall`
 * context runners. `rerank` has no canonical `gen_ai` operation in the v1.42.0
 * registry and is intentionally not mapped.
 *
 * Message content (prompts, responses, tool arguments/results) is **off by
 * default**; enable it with `captureContent`, gated by the SDK's `recordInputs`
 * / `recordOutputs` and the optional `exportContent` privacy callback.
 */

import {
  context as otelContext,
  trace as otelTrace,
  type Context,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import {
  GEN_AI,
  GEN_AI_OPERATION,
  GEN_AI_OUTPUT_TYPE,
  GEN_AI_TOOL_TYPE,
} from '../semconv.js';
import {
  contentToGenAiMessage,
  promptToGenAiMessages,
  type ContentPartView,
  type ModelMessageView,
} from './ai-sdk-messages.js';
import {
  normalizeProvider,
  toChatRequest,
  toTokenUsage,
  type AiSdkUsageFields,
} from './ai-sdk-fields.js';
import { createGenAiObserver } from './observer.js';
import type {
  ChatStreamTiming,
  GenAiObserverEvent,
  GenAiObserver,
} from './types.js';
import { asString, readProperty } from '../values.js';

// --- Structural views of the AI SDK telemetry event shapes -----------------
// Only the fields this integration reads. The real events are supersets, so a
// callback typed against these is assignable to the AI SDK `Telemetry` methods.

interface OperationStartEvent {
  callId: string;
  /** e.g. `'ai.generateText'`, `'ai.streamText'`, `'ai.embed'`. */
  operationId?: string;
  provider?: string;
  modelId?: string;
  /** From telemetry settings — used as the agent name. */
  functionId?: string;
  /**
   * Call-level context already filtered by the SDK. Only `userId` and
   * `sessionId` are recorded (`user.id`, `gen_ai.conversation.id`).
   */
  runtimeContext?: Record<string, unknown>;
}

interface LanguageModelCallStartEventView {
  callId: string;
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
  /** Standardized prompt messages (when content capture is on). */
  messages?: readonly ModelMessageView[];
  /** Whether the SDK call permits recording inputs (default true). */
  recordInputs?: boolean;
}

interface LanguageModelCallEndEventView {
  callId: string;
  modelId?: string;
  responseId?: string;
  finishReason?: string;
  usage?: AiSdkUsageFields;
  /** Output content parts (when content capture is on). */
  content?: readonly ContentPartView[];
  /** Whether the SDK call permits recording outputs (default true). */
  recordOutputs?: boolean;
  performance?: {
    responseTimeMs?: number;
    effectiveOutputTokensPerSecond?: number;
    timeToFirstOutputMs?: number;
  };
}

interface ToolCallView {
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
}

interface ToolExecutionStartEventView {
  callId: string;
  toolCall: ToolCallView;
  recordInputs?: boolean;
}

interface ToolOutputView {
  type?: string;
  output?: unknown;
  error?: unknown;
}

interface ToolExecutionEndEventView {
  callId: string;
  toolCall: ToolCallView;
  toolOutput: ToolOutputView;
  recordOutputs?: boolean;
}

interface ObjectStepStartEventView {
  callId: string;
  provider?: string;
  modelId?: string;
}

interface ObjectStepEndEventView {
  callId: string;
  finishReason?: string;
  response?: { id?: string; modelId?: string };
  usage?: AiSdkUsageFields;
  objectText?: string;
  /** Whether the SDK call permits recording outputs (default true). */
  recordOutputs?: boolean;
  msToFirstChunk?: number;
}

interface OperationEndEventView {
  callId: string;
}

interface AbortEventView {
  callId: string;
  reason?: unknown;
}

interface EmbeddingModelCallStartEventView {
  callId: string;
  embedCallId?: string;
  provider?: string;
  modelId?: string;
}

interface EmbeddingModelCallEndEventView {
  callId: string;
  embedCallId?: string;
  provider?: string;
  modelId?: string;
  usage?: { tokens?: number };
}

/**
 * The subset of the AI SDK `Telemetry` interface this integration implements.
 * The returned object is assignable to the SDK's `Telemetry` type.
 */
export interface AutotelTelemetryIntegration {
  onStart(event: OperationStartEvent): void;
  onLanguageModelCallStart(event: LanguageModelCallStartEventView): void;
  onLanguageModelCallEnd(event: LanguageModelCallEndEventView): void;
  onToolExecutionStart(event: ToolExecutionStartEventView): void;
  onToolExecutionEnd(event: ToolExecutionEndEventView): void;
  onObjectStepStart(event: ObjectStepStartEventView): void;
  onObjectStepEnd(event: ObjectStepEndEventView): void;
  onEmbedStart(event: EmbeddingModelCallStartEventView): void;
  onEmbedEnd(event: EmbeddingModelCallEndEventView): void;
  onEnd(event: OperationEndEventView): void;
  onAbort(event: AbortEventView): void;
  onError(event: unknown): void;
  executeLanguageModelCall<T>(options: {
    callId: string;
    execute: () => PromiseLike<T>;
  }): PromiseLike<T>;
  executeTool<T>(options: {
    callId: string;
    toolCallId: string;
    execute: () => PromiseLike<T>;
  }): PromiseLike<T>;
}

export interface AutotelTelemetryOptions {
  /**
   * Tracer to emit spans on. Defaults to the global `autotel-genai/observer`
   * tracer. Pass an application-owned tracer to share one configuration.
   */
  tracer?: Tracer;
  /**
   * Privacy gate applied to all captured content (prompts, responses, tool
   * arguments/results) before it is written to a span. Receives each
   * content-bearing observer event; return it (optionally redacted) to keep its
   * content, or `undefined` to drop that event's content. Only consulted when
   * {@link AutotelTelemetryOptions.captureContent} is enabled.
   */
  exportContent?: (event: GenAiObserverEvent) => GenAiObserverEvent | undefined;
  /**
   * Capture prompt/response message content (`gen_ai.input.messages`,
   * `gen_ai.output.messages`, `gen_ai.system_instructions`) and tool
   * arguments/results. **Off by default** for privacy. When `true`, content is
   * still filtered through {@link AutotelTelemetryOptions.exportContent} if you
   * provide one (redact there); with no `exportContent`, all approved content is
   * written. The AI SDK's per-call `recordInputs` / `recordOutputs` are still
   * honored — either being `false` suppresses that side.
   */
  captureContent?: boolean;
  /**
   * Resolve an OpenTelemetry parent context for an operation that has no
   * tracked parent — e.g. attach the `invoke_agent` root to the incoming
   * request span. Return `undefined` to keep it a root.
   */
  resolveParentContext?: (event: GenAiObserverEvent) => Context | undefined;
}

/** Per-call correlation state, keyed by the AI SDK `callId`. */
interface CallState {
  /** Whether an `invoke_agent` root span was opened for this call. */
  hasAgent: boolean;
  /** Whether the root operation is streaming (`streamText`) or not. */
  stream?: boolean;
  /** Stack of open `chat` span ids (one per in-flight model call). */
  openLm: string[];
  /** Monotonic counter for unique model-call span ids within the call. */
  lmSeq: number;
  /** FIFO of anonymous tool span ids when the SDK omits `toolCallId`. */
  anonymousToolIds: string[];
  /** Monotonic counter for unique anonymous tool span ids within the call. */
  toolSeq: number;
  /** Open embedding attempt span ids, started and not yet ended. */
  openEmbed: string[];
  /**
   * Whether this operation embeds in parallel (`embedMany`).
   *
   * Two open embeds at once means a failed attempt being retried for `embed()`
   * and ordinary concurrency for `embedMany()`, and the events are identical.
   * The operation is the only thing that says which.
   */
  parallelEmbeds?: boolean;
  /** `user.id` from `runtimeContext.userId`. */
  userId?: string;
  /** `gen_ai.conversation.id` from `runtimeContext.sessionId`. */
  conversationId?: string;
}

const AI_SDK_AGENT_NAME = 'ai-sdk';

/**
 * Create an AI SDK telemetry integration that streams canonical `gen_ai.*`
 * spans (with cost + streaming timing) for every AI SDK operation.
 *
 * @example
 * ```ts
 * import { registerTelemetry } from 'ai';
 * import { autotelTelemetry } from 'autotel-genai/observer';
 *
 * registerTelemetry(autotelTelemetry());
 * ```
 */
export function autotelTelemetry(
  options: AutotelTelemetryOptions = {},
): AutotelTelemetryIntegration {
  const captureContent = options.captureContent ?? false;
  // When content capture is on with no explicit gate, allow all approved
  // content; an `exportContent` callback (redaction) always wins if provided.
  const exportContent =
    options.exportContent ??
    (captureContent ? (event: GenAiObserverEvent) => event : undefined);

  // Live spans by observer id, so the context runners can re-enter a span's
  // OTel context to nest provider HTTP calls / a tool's inner `generateText`.
  const spans = new Map<string, Span>();

  const observe: GenAiObserver = createGenAiObserver({
    tracer: options.tracer,
    exportContent,
    resolveParentContext: options.resolveParentContext,
    onSpanStart: (id, span) => spans.set(id, span),
  });
  const calls = new Map<string, CallState>();

  function startToolSpanId(
    callId: string,
    state: CallState | undefined,
    call: { toolCallId?: string },
  ): string {
    if (call.toolCallId) return `${callId}:tool:${call.toolCallId}`;
    const seq = state?.toolSeq ?? 0;
    if (state) state.toolSeq += 1;
    const id = `${callId}:tool:anon:${seq}`;
    state?.anonymousToolIds.push(id);
    return id;
  }

  function endToolSpanId(
    callId: string,
    state: CallState | undefined,
    call: { toolCallId?: string },
  ): string {
    if (call.toolCallId) return `${callId}:tool:${call.toolCallId}`;
    return state?.anonymousToolIds.shift() ?? `${callId}:tool:anon:0`;
  }

  /** Run `execute` within `span`'s OTel context so nested work parents to it. */
  function runInSpan<T>(
    span: Span | undefined,
    execute: () => PromiseLike<T>,
  ): PromiseLike<T> {
    if (!span) return execute();
    return otelContext.with(
      otelTrace.setSpan(otelContext.active(), span),
      execute,
    );
  }

  function applyRuntimeContext(
    state: CallState,
    runtimeContext: Record<string, unknown> | undefined,
  ): void {
    if (!runtimeContext) return;
    const userId = readContextId(runtimeContext.userId);
    const conversationId = readContextId(runtimeContext.sessionId);
    if (userId !== undefined) state.userId = userId;
    if (conversationId !== undefined) state.conversationId = conversationId;
  }

  function stampIdentity(id: string, state: CallState | undefined): void {
    if (!state) return;
    const span = spans.get(id);
    if (!span) return;
    if (state.userId !== undefined) span.setAttribute('user.id', state.userId);
    if (state.conversationId !== undefined) {
      span.setAttribute(GEN_AI.CONVERSATION_ID, state.conversationId);
    }
  }

  /**
   * The AI SDK reports an embedding attempt that succeeded and says nothing
   * about one that threw — the retry just starts a new attempt. A span still
   * open when the call is over therefore never completed, whatever ended the
   * call, so closing it clean turns an abandoned attempt into a healthy span
   * as long as everything that followed it.
   */
  const ABANDONED_EMBED = 'embedding attempt did not complete';

  /**
   * Duration here is an upper bound, not a measurement.
   *
   * Nothing says when an abandoned attempt stopped running, and for a parallel
   * operation nothing says which later attempt replaced it — a second batch
   * starting looks exactly like a retry starting. Guessing "the next start"
   * truncates a real concurrent batch to the moment an unrelated one began,
   * which reads as a fast failure and is worse than an honest overestimate.
   * The ERROR status is what marks these spans as unusable for latency.
   */
  function closeOpenEmbeds(state: CallState, error?: unknown): void {
    for (const id of state.openEmbed) {
      observe({ type: 'chat.end', id, error: error ?? ABANDONED_EMBED });
      spans.delete(id);
    }
    state.openEmbed = [];
  }

  /**
   * Close the attempt a retry has just replaced.
   *
   * Waiting until the call ends would stretch the failed attempt's duration
   * across the backoff and every later attempt, which is the opposite of the
   * real model-call duration these spans are for. The next attempt starting is
   * the tightest upper bound the SDK gives us.
   */
  function failPreviousEmbedAttempt(
    state: CallState,
    startingId: string,
  ): void {
    state.openEmbed = state.openEmbed.filter((id) => {
      // Two concurrent embeds cannot share a span id, so a repeat is a retry
      // whatever the operation. Otherwise only a non-parallel one can be sure:
      // `embed()` is never concurrent with itself, `embedMany()` usually is —
      // and there a new attempt is as likely to be the next batch as a retry.
      // The events carry no batch identity to tell them apart, so anything
      // else is left for the end of the call rather than guessed at.
      const isRetry = id === startingId || !state.parallelEmbeds;
      if (!isRetry) return true;
      observe({ type: 'chat.end', id, error: ABANDONED_EMBED });
      spans.delete(id);
      return false;
    });
  }

  return {
    onStart(event) {
      // Embedding / rerank operations are not `invoke_agent` roots; they are
      // handled as leaf spans by `onEmbedStart` / `onEmbedEnd` (rerank is
      // unsupported).
      const hasAgent = !isNonAgentOperation(event.operationId);
      const state: CallState = {
        hasAgent,
        stream: event.operationId?.includes('stream'),
        parallelEmbeds: event.operationId?.includes('embedMany'),
        openLm: [],
        lmSeq: 0,
        anonymousToolIds: [],
        toolSeq: 0,
        openEmbed: [],
      };
      calls.set(event.callId, state);
      applyRuntimeContext(state, event.runtimeContext);
      if (!hasAgent) return;
      observe({
        type: 'agent.start',
        id: event.callId,
        provider: normalizeProvider(event.provider),
        agent: { name: event.functionId ?? event.modelId ?? AI_SDK_AGENT_NAME },
      });
      stampIdentity(event.callId, state);
    },

    onLanguageModelCallStart(event) {
      const state = calls.get(event.callId);
      const id = `${event.callId}:lm:${state ? state.lmSeq++ : 0}`;
      if (state) state.openLm.push(id);
      const content =
        captureContent && event.recordInputs !== false
          ? promptToGenAiMessages(event.messages)
          : undefined;
      observe({
        type: 'chat.start',
        id,
        parentId: state?.hasAgent ? event.callId : undefined,
        request: {
          ...toChatRequest(event),
          stream: state?.stream,
          conversationId: state?.conversationId,
        },
        inputMessages: content?.messages,
        systemInstructions: content?.systemInstructions,
      });
      stampIdentity(id, state);
    },

    onLanguageModelCallEnd(event) {
      const state = calls.get(event.callId);
      const id = state?.openLm.pop() ?? `${event.callId}:lm:0`;
      const outputMessage =
        captureContent && event.recordOutputs !== false
          ? contentToGenAiMessage(event.content, event.finishReason)
          : undefined;
      observe({
        type: 'chat.end',
        id,
        response: {
          model: event.modelId,
          id: event.responseId,
          finishReasons: event.finishReason ? [event.finishReason] : undefined,
          timeToFirstChunk: msToSeconds(event.performance?.timeToFirstOutputMs),
        },
        usage: toTokenUsage(event.usage),
        costModel: event.modelId,
        streaming: mapStreaming(event.performance),
        outputMessages: outputMessage ? [outputMessage] : undefined,
      });
      spans.delete(id);
    },

    onToolExecutionStart(event) {
      const state = calls.get(event.callId);
      const id = startToolSpanId(event.callId, state, event.toolCall);
      observe({
        type: 'tool.start',
        id,
        parentId: state?.hasAgent ? event.callId : undefined,
        tool: {
          name: event.toolCall.toolName,
          callId: event.toolCall.toolCallId,
          type: GEN_AI_TOOL_TYPE.FUNCTION,
        },
        callArguments:
          captureContent && event.recordInputs !== false
            ? event.toolCall.input
            : undefined,
      });
    },

    onToolExecutionEnd(event) {
      const state = calls.get(event.callId);
      const id = endToolSpanId(event.callId, state, event.toolCall);
      const isError = event.toolOutput.type === 'tool-error';
      observe({
        type: 'tool.end',
        id,
        error: isError ? event.toolOutput.error : undefined,
        callResult:
          !isError && captureContent && event.recordOutputs !== false
            ? event.toolOutput.output
            : undefined,
      });
      spans.delete(id);
    },

    onObjectStepStart(event) {
      const state = calls.get(event.callId);
      const id = `${event.callId}:object`;
      observe({
        type: 'chat.start',
        id,
        parentId: state?.hasAgent ? event.callId : undefined,
        request: {
          operation: GEN_AI_OPERATION.CHAT,
          provider: normalizeProvider(event.provider),
          model: event.modelId,
          outputType: GEN_AI_OUTPUT_TYPE.JSON,
          conversationId: state?.conversationId,
        },
      });
      stampIdentity(id, state);
    },

    onObjectStepEnd(event) {
      const id = `${event.callId}:object`;
      // `captureContent` is the global permission and `recordOutputs` is the
      // caller's decision for this call — the same order the language-model and
      // tool handlers apply. Structured output is where the sensitive fields
      // are, so this is the last place to skip the per-call check.
      const outputMessage =
        captureContent &&
        event.recordOutputs !== false &&
        event.objectText !== undefined
          ? contentToGenAiMessage(
              [{ type: 'text', text: event.objectText }],
              event.finishReason,
            )
          : undefined;
      observe({
        type: 'chat.end',
        id,
        response: {
          model: event.response?.modelId,
          id: event.response?.id,
          finishReasons: event.finishReason ? [event.finishReason] : undefined,
          timeToFirstChunk: msToSeconds(event.msToFirstChunk),
        },
        usage: toTokenUsage(event.usage),
        costModel: event.response?.modelId,
        outputMessages: outputMessage ? [outputMessage] : undefined,
      });
      spans.delete(id);
    },

    onEmbedStart(event) {
      const id = embedSpanId(event);
      const state = calls.get(event.callId);
      if (state) {
        // A single embed() is never concurrent with itself, so anything still
        // open here is the attempt this one is retrying. Ids collide when the
        // SDK omits `embedCallId`, which without this would silently reuse the
        // failed attempt's span and lose it entirely.
        failPreviousEmbedAttempt(state, id);
        state.openEmbed.push(id);
      }
      observe({
        type: 'chat.start',
        id,
        request: {
          operation: GEN_AI_OPERATION.EMBEDDINGS,
          provider: normalizeProvider(event.provider),
          model: event.modelId,
        },
      });
    },

    onEmbedEnd(event) {
      const id = embedSpanId(event);
      const state = calls.get(event.callId);
      if (state) {
        const index = state.openEmbed.indexOf(id);
        if (index !== -1) state.openEmbed.splice(index, 1);
      }
      if (!spans.has(id)) {
        observe({
          type: 'chat.start',
          id,
          request: {
            operation: GEN_AI_OPERATION.EMBEDDINGS,
            provider: normalizeProvider(event.provider),
            model: event.modelId,
          },
        });
      }
      observe({
        type: 'chat.end',
        id,
        response: { model: event.modelId },
        usage:
          event.usage?.tokens === undefined
            ? undefined
            : { inputTokens: event.usage.tokens },
        costModel: event.modelId,
      });
      spans.delete(id);
    },

    onEnd(event) {
      const state = calls.get(event.callId);
      if (!state) return;
      calls.delete(event.callId);
      closeOpenEmbeds(state);
      if (!state.hasAgent) return;
      observe({ type: 'agent.end', id: event.callId });
      spans.delete(event.callId);
    },

    onAbort(event) {
      const state = calls.get(event.callId);
      if (!state) return;
      calls.delete(event.callId);
      const error = event.reason ?? 'aborted';
      closeOpenEmbeds(state, error);
      if (!state.hasAgent) return;
      observe({
        type: 'agent.end',
        id: event.callId,
        error,
      });
      spans.delete(event.callId);
    },

    onError(event) {
      // The dispatcher invokes `onError` with `{ callId, error }`. Close the
      // matching `invoke_agent` root when we can correlate it; otherwise leave
      // it for `onEnd`/`onAbort` (the observer reaps any open children on close).
      const callId = errorCallId(event);
      if (callId === undefined) return;
      const state = calls.get(callId);
      if (!state) return;
      calls.delete(callId);
      const error = errorValue(event) ?? event;
      closeOpenEmbeds(state, error);
      if (!state.hasAgent) return;
      observe({
        type: 'agent.end',
        id: callId,
        error,
      });
      spans.delete(callId);
    },

    executeLanguageModelCall(options) {
      // `onLanguageModelCallStart` already opened this call's `chat` span (it is
      // the top of the stack). Run the provider call inside it so any
      // auto-instrumented HTTP spans become its children.
      const state = calls.get(options.callId);
      const id = state?.openLm.at(-1);
      return runInSpan(id ? spans.get(id) : undefined, options.execute);
    },

    executeTool(options) {
      // `onToolExecutionStart` already opened the tool span; run the tool's
      // `execute` inside it so a nested `generateText` nests under the tool.
      const id = `${options.callId}:tool:${options.toolCallId}`;
      return runInSpan(spans.get(id), options.execute);
    },
  };
}

function readContextId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function embedSpanId(event: { callId: string; embedCallId?: string }): string {
  return `${event.callId}:embed:${event.embedCallId ?? '0'}`;
}

/** Operations that are not `invoke_agent` roots (embeddings, rerank). */
function isNonAgentOperation(operationId: string | undefined): boolean {
  if (!operationId) return false;
  return operationId.includes('embed') || operationId.includes('rerank');
}

function mapStreaming(
  performance: LanguageModelCallEndEventView['performance'],
): ChatStreamTiming | undefined {
  if (!performance) return undefined;
  const timing: ChatStreamTiming = {
    timeToFinish: msToSeconds(performance.responseTimeMs),
    outputTokensPerSecond: performance.effectiveOutputTokensPerSecond,
  };
  return timing.timeToFinish !== undefined ||
    timing.outputTokensPerSecond !== undefined
    ? timing
    : undefined;
}

function msToSeconds(ms: number | undefined): number | undefined {
  return ms === undefined ? undefined : ms / 1000;
}

function errorCallId(event: unknown): string | undefined {
  return asString(readProperty(event, 'callId'));
}

function errorValue(event: unknown): unknown {
  return readProperty(event, 'error');
}
