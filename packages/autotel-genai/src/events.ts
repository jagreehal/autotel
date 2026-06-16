/**
 * GenAI content + event helpers, aligned with the OpenTelemetry GenAI
 * semantic conventions.
 *
 * Two kinds of recording, per the spec:
 *
 *   1. **Opt-in content attributes** on the active span —
 *      `gen_ai.input.messages`, `gen_ai.output.messages`,
 *      `gen_ai.system_instructions`. These may carry sensitive data, so they
 *      are opt-in: only call {@link setGenAiContent} when you intend to capture
 *      prompt/response content.
 *
 *   2. **Events** — `gen_ai.client.inference.operation.details` and
 *      `gen_ai.evaluation.result`. Emitted as autotel correlated events via
 *      `ctx.track(...)` (correlated logs, the autotel-blessed replacement for
 *      the deprecated span-event API), so they join the canonical log line.
 *
 * Message values follow the GenAI message JSON schema. Span attributes can't
 * hold nested objects, so structured content is JSON-serialised on the way out.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/
 */

import type { TraceContext } from 'autotel';
import {
  GEN_AI,
  GEN_AI_EVENT,
  type GenAiOperationName,
  type GenAiProviderName,
} from './semconv.js';

/** Minimal sink: just what these helpers touch on a trace context. */
export type GenAiContentSink = Pick<TraceContext, 'setAttributes' | 'track'>;

/** A single content part within a message (text, tool_call, tool_call_response, …). */
export interface GenAiMessagePart {
  type: string;
  [key: string]: unknown;
}

/** A GenAI message following the spec message schema. */
export interface GenAiMessage {
  role: string;
  parts: GenAiMessagePart[];
  [key: string]: unknown;
}

function serialize(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Assign `value` under `key` unless it's absent (undefined or empty array). */
function put(data: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) return;
  if (Array.isArray(value) && value.length === 0) return;
  data[key] = value;
}

/**
 * Set opt-in GenAI **content** attributes on the active span. Each field maps
 * to a `gen_ai.*` attribute and is JSON-serialised. Omit fields you don't want
 * captured — nothing is recorded unless you pass it.
 *
 * ⚠️ Content may contain PII / secrets. Gate calls behind your own capture
 * flag (e.g. `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`).
 */
export function setGenAiContent(
  ctx: GenAiContentSink,
  content: {
    inputMessages?: GenAiMessage[] | string;
    outputMessages?: GenAiMessage[] | string;
    systemInstructions?: GenAiMessagePart[] | string;
    toolDefinitions?: unknown;
  },
): void {
  const attrs: Record<string, string> = {};
  if (content.inputMessages !== undefined) {
    attrs[GEN_AI.INPUT_MESSAGES] = serialize(content.inputMessages);
  }
  if (content.outputMessages !== undefined) {
    attrs[GEN_AI.OUTPUT_MESSAGES] = serialize(content.outputMessages);
  }
  if (content.systemInstructions !== undefined) {
    attrs[GEN_AI.SYSTEM_INSTRUCTIONS] = serialize(content.systemInstructions);
  }
  if (content.toolDefinitions !== undefined) {
    attrs[GEN_AI.TOOL_DEFINITIONS] = serialize(content.toolDefinitions);
  }
  if (Object.keys(attrs).length > 0) ctx.setAttributes(attrs);
}

/** Payload for the `gen_ai.client.inference.operation.details` event. */
export interface InferenceDetailsEvent {
  operation?: GenAiOperationName | (string & {});
  provider?: GenAiProviderName;
  requestModel?: string;
  responseModel?: string;
  responseId?: string;
  conversationId?: string;
  outputType?: string;
  stream?: boolean;
  topK?: number;
  serverAddress?: string;
  serverPort?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  finishReasons?: string[];
  /** Opt-in content — serialised into the event payload. */
  inputMessages?: GenAiMessage[];
  outputMessages?: GenAiMessage[];
  systemInstructions?: GenAiMessagePart[];
}

/**
 * Emit the `gen_ai.client.inference.operation.details` event — a detailed
 * record of an inference call (parameters + optional content) decoupled from
 * the span, so content can be stored/retained independently of traces.
 */
export function recordInferenceDetails(
  ctx: Pick<TraceContext, 'track'>,
  event: InferenceDetailsEvent,
): void {
  const data: Record<string, unknown> = {};
  put(data, GEN_AI.OPERATION_NAME, event.operation);
  put(data, GEN_AI.PROVIDER_NAME, event.provider);
  put(data, GEN_AI.REQUEST_MODEL, event.requestModel);
  put(data, GEN_AI.RESPONSE_MODEL, event.responseModel);
  put(data, GEN_AI.RESPONSE_ID, event.responseId);
  put(data, GEN_AI.CONVERSATION_ID, event.conversationId);
  put(data, GEN_AI.OUTPUT_TYPE, event.outputType);
  put(data, GEN_AI.REQUEST_STREAM, event.stream);
  put(
    data,
    GEN_AI.REQUEST_TOP_K,
    event.topK === undefined ? undefined : Math.trunc(event.topK),
  );
  put(data, GEN_AI.SERVER_ADDRESS, event.serverAddress);
  put(
    data,
    GEN_AI.SERVER_PORT,
    event.serverPort === undefined ? undefined : Math.trunc(event.serverPort),
  );
  put(data, GEN_AI.USAGE_INPUT_TOKENS, event.inputTokens);
  put(data, GEN_AI.USAGE_OUTPUT_TOKENS, event.outputTokens);
  put(data, GEN_AI.USAGE_REASONING_OUTPUT_TOKENS, event.reasoningOutputTokens);
  put(data, GEN_AI.USAGE_CACHE_READ_INPUT_TOKENS, event.cacheReadInputTokens);
  put(
    data,
    GEN_AI.USAGE_CACHE_CREATION_INPUT_TOKENS,
    event.cacheCreationInputTokens,
  );
  put(data, GEN_AI.RESPONSE_FINISH_REASONS, event.finishReasons);
  put(data, GEN_AI.INPUT_MESSAGES, event.inputMessages);
  put(data, GEN_AI.OUTPUT_MESSAGES, event.outputMessages);
  put(data, GEN_AI.SYSTEM_INSTRUCTIONS, event.systemInstructions);
  ctx.track(GEN_AI_EVENT.INFERENCE_OPERATION_DETAILS, data);
}

/** Payload for the `gen_ai.evaluation.result` event. */
export interface EvaluationResultEvent {
  /** Metric name, e.g. `relevance`, `toxicity`. Required by spec. */
  name: string;
  scoreValue?: number;
  /** Low-cardinality label, e.g. `pass` / `fail`. */
  scoreLabel?: string;
  explanation?: string;
  responseId?: string;
}

/**
 * Emit a `gen_ai.evaluation.result` event recording an offline/online quality
 * evaluation of a GenAI output. Parent it to the evaluated operation's span.
 */
export function recordEvaluationResult(
  ctx: Pick<TraceContext, 'track'>,
  event: EvaluationResultEvent,
): void {
  const data: Record<string, unknown> = {
    [GEN_AI.EVALUATION_NAME]: event.name,
  };
  put(data, GEN_AI.EVALUATION_SCORE_VALUE, event.scoreValue);
  put(data, GEN_AI.EVALUATION_SCORE_LABEL, event.scoreLabel);
  put(data, GEN_AI.EVALUATION_EXPLANATION, event.explanation);
  put(data, GEN_AI.RESPONSE_ID, event.responseId);
  ctx.track(GEN_AI_EVENT.EVALUATION_RESULT, data);
}

export interface GenAiOperationExceptionEvent {
  type?: string;
  message?: string;
  stacktrace?: string;
}

/**
 * Emit the `gen_ai.client.operation.exception` event for GenAI client
 * exceptions using the OpenTelemetry exception attribute shape.
 */
export function recordOperationException(
  ctx: Pick<TraceContext, 'track'>,
  event: GenAiOperationExceptionEvent,
): void {
  const data: Record<string, unknown> = {};
  put(data, 'exception.type', event.type);
  put(data, 'exception.message', event.message);
  put(data, 'exception.stacktrace', event.stacktrace);
  ctx.track(GEN_AI_EVENT.CLIENT_OPERATION_EXCEPTION, data);
}
