/**
 * Span event helpers for LLM lifecycle, aligned with the OpenTelemetry
 * GenAI semantic conventions.
 *
 * Span events are timestamped points within a span — they render as dots
 * on the trace timeline in Jaeger / Tempo / Langfuse / Arize. Use them
 * to mark lifecycle moments the span attributes alone can't express:
 *
 *   - When the prompt was sent (vs. when the first token arrived)
 *   - When each retry attempt started, and why
 *   - When a streaming response produced its first token (TTFT)
 *   - When a tool was invoked
 *
 * Every helper pins the event name + attribute keys to the published
 * spec so downstream tooling (autotel-mcp, Langfuse, vendor UIs) can
 * render them consistently.
 *
 * @example
 * ```typescript
 * import { trace, recordPromptSent, recordResponseReceived, recordRetry } from 'autotel';
 *
 * export const chat = trace('chat', ctx => async (prompt: string) => {
 *   recordPromptSent(ctx, { model: 'gpt-4o', messageCount: 1 });
 *
 *   for (let attempt = 1; attempt <= 3; attempt++) {
 *     try {
 *       const res = await openai.chat.completions.create({...});
 *       recordResponseReceived(ctx, {
 *         model: res.model,
 *         promptTokens: res.usage?.prompt_tokens,
 *         completionTokens: res.usage?.completion_tokens,
 *         finishReasons: res.choices.map(c => c.finish_reason),
 *       });
 *       return res;
 *     } catch (err) {
 *       recordRetry(ctx, { attempt, reason: 'rate_limit', delayMs: 500 });
 *       await sleep(500 * attempt);
 *     }
 *   }
 * });
 * ```
 */

import type { TraceContext } from './trace-context';

type EventAttrs = Record<string, string | number | boolean>;

/** Attributes expected on a `gen_ai.prompt.sent` event. */
export interface PromptSentEvent {
  /** Model the caller intends to invoke (may differ from response model). */
  model?: string;
  /** Estimated input token count, when known before the call. */
  promptTokens?: number;
  /** Number of messages in a chat request (system + user + assistant). */
  messageCount?: number;
  /** Free-form operation kind — `chat` / `completion` / `embedding`. */
  operation?: string;
}

/** Attributes expected on a `gen_ai.response.received` event. */
export interface ResponseReceivedEvent {
  /** Model the provider actually served (may be more specific than requested). */
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** `stop`, `length`, `content_filter`, `tool_calls`, etc. */
  finishReasons?: string[];
}

/** Attributes expected on a `gen_ai.retry` event. */
export interface RetryEvent {
  attempt: number;
  /** `rate_limit` | `timeout` | `provider_error` | custom label. */
  reason?: string;
  /** How long we'll wait before the next attempt. */
  delayMs?: number;
  /** HTTP status that triggered the retry, when applicable. */
  statusCode?: number;
}

/** Attributes expected on a `gen_ai.tool.call` event. */
export interface ToolCallEvent {
  toolName: string;
  /** Call identifier so responses can be correlated back to calls. */
  toolCallId?: string;
  /** Pre-serialised tool arguments; omit if sensitive. */
  arguments?: string;
}

/** Attributes expected on a `gen_ai.stream.first_token` event. */
export interface StreamFirstTokenEvent {
  /** Tokens streamed so far, if the caller tracks that. */
  tokensSoFar?: number;
}

/**
 * Record that a prompt was dispatched to the provider. Typically called
 * before `await provider.chat.completions.create(...)`.
 */
export function recordPromptSent(
  ctx: TraceContext,
  event: PromptSentEvent = {},
): void {
  ctx.addEvent('gen_ai.prompt.sent', buildPromptSentAttrs(event));
}

/**
 * Record a successful provider response. Call after the response arrives
 * (for non-streaming) or after the stream completes.
 */
export function recordResponseReceived(
  ctx: TraceContext,
  event: ResponseReceivedEvent = {},
): void {
  ctx.addEvent('gen_ai.response.received', buildResponseAttrs(event));
}

/**
 * Record a retry attempt on an LLM call. Call *before* sleeping for
 * `delayMs` so the event timestamp accurately marks when the retry
 * decision was made.
 */
export function recordRetry(ctx: TraceContext, event: RetryEvent): void {
  ctx.addEvent('gen_ai.retry', buildRetryAttrs(event));
}

/**
 * Record a tool / function call made in the course of an agent step.
 * Emits an event rather than a child span because many frameworks fire
 * several tool calls within a single provider response.
 */
export function recordToolCall(ctx: TraceContext, event: ToolCallEvent): void {
  ctx.addEvent('gen_ai.tool.call', buildToolCallAttrs(event));
}

/**
 * Record the time-to-first-token for a streaming response. Pair with
 * `recordResponseReceived` at the end so the span carries both the TTFT
 * marker and the final usage numbers.
 */
export function recordStreamFirstToken(
  ctx: TraceContext,
  event: StreamFirstTokenEvent = {},
): void {
  ctx.addEvent('gen_ai.stream.first_token', buildStreamFirstTokenAttrs(event));
}

// ---- Attribute builders -------------------------------------------------

function buildPromptSentAttrs(event: PromptSentEvent): EventAttrs {
  const attrs: EventAttrs = {};
  if (event.model) attrs['gen_ai.request.model'] = event.model;
  if (event.promptTokens !== undefined)
    attrs['gen_ai.usage.input_tokens'] = event.promptTokens;
  if (event.messageCount !== undefined)
    attrs['gen_ai.request.message_count'] = event.messageCount;
  if (event.operation) attrs['gen_ai.operation.name'] = event.operation;
  return attrs;
}

function buildResponseAttrs(event: ResponseReceivedEvent): EventAttrs {
  const attrs: EventAttrs = {};
  if (event.model) attrs['gen_ai.response.model'] = event.model;
  if (event.promptTokens !== undefined)
    attrs['gen_ai.usage.input_tokens'] = event.promptTokens;
  if (event.completionTokens !== undefined)
    attrs['gen_ai.usage.output_tokens'] = event.completionTokens;
  if (event.totalTokens !== undefined)
    attrs['gen_ai.usage.total_tokens'] = event.totalTokens;
  if (event.finishReasons && event.finishReasons.length > 0) {
    // Arrays aren't primitive AttributeValues on this context, so join.
    attrs['gen_ai.response.finish_reasons'] = event.finishReasons.join(',');
  }
  return attrs;
}

function buildRetryAttrs(event: RetryEvent): EventAttrs {
  const attrs: EventAttrs = { 'retry.attempt': event.attempt };
  if (event.reason) attrs['retry.reason'] = event.reason;
  if (event.delayMs !== undefined) attrs['retry.delay_ms'] = event.delayMs;
  if (event.statusCode !== undefined)
    attrs['http.response.status_code'] = event.statusCode;
  return attrs;
}

function buildToolCallAttrs(event: ToolCallEvent): EventAttrs {
  const attrs: EventAttrs = { 'gen_ai.tool.name': event.toolName };
  if (event.toolCallId) attrs['gen_ai.tool.call.id'] = event.toolCallId;
  if (event.arguments) attrs['gen_ai.tool.arguments'] = event.arguments;
  return attrs;
}

function buildStreamFirstTokenAttrs(event: StreamFirstTokenEvent): EventAttrs {
  const attrs: EventAttrs = {};
  if (event.tokensSoFar !== undefined)
    attrs['gen_ai.stream.tokens_so_far'] = event.tokensSoFar;
  return attrs;
}
