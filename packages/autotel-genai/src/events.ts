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
  GEN_AI_EXT_EVENT,
  type GenAiOperationName,
  type GenAiProviderName,
} from './semconv.js';

/** Minimal sink: just what these helpers touch on a trace context. */
export type GenAiContentSink = Pick<TraceContext, 'setAttributes' | 'track'>;

/**
 * Recursively replace binary data with a base64 marker so it survives JSON
 * serialisation. `JSON.stringify(new Uint8Array([1,2]))` yields `{"0":1,"1":2}`
 * — useless and huge for multimodal (image/audio/file) content. This swaps any
 * typed array / `ArrayBuffer` for `{ "__type": "base64", data: "…" }`.
 */
function toBase64(bytes: Uint8Array): string {
  // Runtime-agnostic (Node + edge/Workers expose `btoa`); avoids `Buffer` so
  // the bundle stays edge-safe. Chunked to keep the argument list bounded.
  let binary = '';
  const chunk = 0x80_00;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function replaceBinary(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __type: 'base64', data: toBase64(value) };
  }
  if (value instanceof ArrayBuffer) {
    return { __type: 'base64', data: toBase64(new Uint8Array(value)) };
  }
  if (Array.isArray(value)) return value.map(replaceBinary);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = replaceBinary(v);
    }
    return out;
  }
  return value;
}

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
  if (typeof value === 'string') return value;
  return JSON.stringify(replaceBinary(value));
}

/**
 * Gate for opt-in content capture, mirroring the AI SDK's
 * `experimental_telemetry`. Input and output are gated independently so you can
 * keep prompts out of telemetry while still recording completions, or vice
 * versa. A flag left `undefined` defaults to captured.
 */
export interface ContentCaptureSettings {
  /** Capture input-side content (`gen_ai.input.messages`, system instructions). */
  recordInputs?: boolean;
  /** Capture output-side content (`gen_ai.output.messages`). */
  recordOutputs?: boolean;
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
  settings?: ContentCaptureSettings,
): void {
  const recordInputs = settings?.recordInputs ?? true;
  const recordOutputs = settings?.recordOutputs ?? true;
  const attrs: Record<string, string> = {};
  if (recordInputs && content.inputMessages !== undefined) {
    attrs[GEN_AI.INPUT_MESSAGES] = serialize(content.inputMessages);
  }
  if (recordOutputs && content.outputMessages !== undefined) {
    attrs[GEN_AI.OUTPUT_MESSAGES] = serialize(content.outputMessages);
  }
  if (recordInputs && content.systemInstructions !== undefined) {
    attrs[GEN_AI.SYSTEM_INSTRUCTIONS] = serialize(content.systemInstructions);
  }
  if (recordInputs && content.toolDefinitions !== undefined) {
    attrs[GEN_AI.TOOL_DEFINITIONS] = serialize(content.toolDefinitions);
  }
  if (Object.keys(attrs).length > 0) ctx.setAttributes(attrs);
}

/** A single provider warning. */
export interface GenAiWarning {
  /** Warning kind, e.g. `unsupported-setting`, `unsupported-tool`, `other`. */
  type?: string;
  /** The setting that triggered the warning, when `type` is a setting issue. */
  setting?: string;
  /** Human-readable detail. */
  message?: string;
}

/**
 * Record provider warnings (e.g. an unsupported setting the provider silently
 * dropped) as a `gen_ai.client.warnings` event. Vendors and the AI SDK only
 * _log_ these, so they vanish from traces — recording them keeps the signal
 * where you debug. No-op for an empty list.
 */
export function recordModelWarnings(
  ctx: Pick<TraceContext, 'track'>,
  warnings: readonly GenAiWarning[],
): void {
  if (warnings.length === 0) return;
  ctx.track(GEN_AI_EXT_EVENT.CLIENT_WARNINGS, {
    'gen_ai.warnings.count': warnings.length,
    'gen_ai.warnings': serialize(warnings),
  });
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
