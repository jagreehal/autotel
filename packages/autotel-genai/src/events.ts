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
import { evidenceAttribute } from 'autotel/evidence';
import { redactBinaryContent, serializeWithinBudget } from './redaction.js';
import {
  CONTENT_ORIGINAL_SIZE_SUFFIX,
  GEN_AI,
  GEN_AI_EVENT,
  GEN_AI_EXT_EVENT,
  type GenAiOperationName,
  type GenAiProviderName,
} from './semconv.js';
import type { UnknownRecord } from './values.js';

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

/**
 * Cap on a single content attribute, in UTF-8 bytes. Chosen so a normal
 * conversation always fits and a runaway one is cut here — where the loss can
 * be declared — rather than by a collector, which drops it silently.
 */
export const DEFAULT_MAX_CONTENT_BYTES = 200_000;

interface SerializedContent {
  text: string;
  /** A payload was replaced by a placeholder. */
  redacted: boolean;
  /** The text is a prefix of what was passed in. */
  truncated: boolean;
  /** UTF-8 byte size before truncation. */
  originalBytes: number;
}

function serializeContent(
  value: unknown,
  settings?: ContentCaptureSettings,
): SerializedContent {
  let redactions = 0;
  const source =
    settings?.redactBinary === false
      ? value
      : redactBinaryContent(value, {
          onRedact: () => {
            redactions += 1;
          },
        });
  const fitted = serializeWithinBudget(
    source,
    settings?.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES,
  );
  return { ...fitted, redacted: redactions > 0 };
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
  /**
   * Replace inline binary — buffers, data URLs, bare base64 — with a
   * placeholder naming what was there. Defaults to `true`: one image in a
   * prompt is megabytes of attribute that no backend will keep and no human
   * will read, and the prompt around it is the part worth tracing.
   *
   * Turn it off only when the payload itself is the thing under investigation.
   */
  redactBinary?: boolean;
  /**
   * Cap each content attribute at this many UTF-8 bytes. Defaults to
   * {@link DEFAULT_MAX_CONTENT_BYTES}; zero or less means no cap.
   */
  maxContentBytes?: number;
}

/** Assign `value` under `key` unless it's absent (undefined or empty array). */
function put(data: UnknownRecord, key: string, value: unknown): void {
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
  const attrs: Record<string, string | number> = {};
  // What was lost, per side. Truncation outranks redaction: a placeholder
  // still describes what stood there, a cut end describes nothing.
  const lost: {
    input?: 'redacted' | 'truncated';
    output?: 'redacted' | 'truncated';
  } = {};

  const place = (
    key: string,
    value: unknown,
    side: 'input' | 'output',
  ): void => {
    const result = serializeContent(value, settings);
    attrs[key] = result.text;
    if (result.truncated) {
      attrs[key + CONTENT_ORIGINAL_SIZE_SUFFIX] = result.originalBytes;
      lost[side] = 'truncated';
    } else if (result.redacted && lost[side] === undefined) {
      lost[side] = 'redacted';
    }
  };

  if (recordInputs && content.inputMessages !== undefined) {
    place(GEN_AI.INPUT_MESSAGES, content.inputMessages, 'input');
  }
  if (recordOutputs && content.outputMessages !== undefined) {
    place(GEN_AI.OUTPUT_MESSAGES, content.outputMessages, 'output');
  }
  if (recordInputs && content.systemInstructions !== undefined) {
    place(GEN_AI.SYSTEM_INSTRUCTIONS, content.systemInstructions, 'input');
  }
  if (recordInputs && content.toolDefinitions !== undefined) {
    place(GEN_AI.TOOL_DEFINITIONS, content.toolDefinitions, 'input');
  }
  if (lost.input) attrs[evidenceAttribute('input')] = lost.input;
  if (lost.output) attrs[evidenceAttribute('output')] = lost.output;
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
    'gen_ai.warnings': serializeContent(warnings).text,
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
  const data: UnknownRecord = {};
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
  const data: UnknownRecord = {
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
  const data: UnknownRecord = {};
  put(data, 'exception.type', event.type);
  put(data, 'exception.message', event.message);
  put(data, 'exception.stacktrace', event.stacktrace);
  ctx.track(GEN_AI_EVENT.CLIENT_OPERATION_EXCEPTION, data);
}
