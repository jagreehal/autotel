/**
 * Native span bridge
 *
 * A runtime-agnostic seam that lets autotel's `span()` / `trace()` functional
 * API transparently emit *platform-native* spans when one is available, instead
 * of going through autotel's own OpenTelemetry tracer + OTLP exporter.
 *
 * The concrete native tracer is supplied by a runtime adapter package (e.g.
 * `autotel-cloudflare`, which wraps Cloudflare's `tracing.enterSpan()` /
 * `ctx.tracing`). autotel-edge itself never imports any runtime module — the
 * adapter installs a {@link NativeTracer} into the active OpenTelemetry context
 * with {@link withNativeTracer}, and the functional API reads it back with
 * {@link getActiveNativeTracer}.
 *
 * Native span surfaces are thinner than OTel (no span ids, events or links on
 * Cloudflare), so the adapters below degrade autotel's
 * richer `TraceContext` / OTel `Span` API gracefully. See the degradation map
 * in `docs/CLOUDFLARE-NATIVE-TRACING.md`.
 */

import {
  context as api_context,
  createContextKey,
  INVALID_SPAN_CONTEXT,
  SpanStatusCode,
  type AttributeValue,
  type Context,
  type Span,
  type SpanContext,
  type SpanStatus,
} from '@opentelemetry/api';
import type { Attributes, Exception, TimeInput } from '@opentelemetry/api';
import type { TraceContext } from './trace-context';
import { runInternal } from './console-signals';
import { ensureGlobalContextManager } from './context';

/**
 * The minimal span surface every native runtime is expected to provide.
 * Modelled on Cloudflare Workers' custom-span `Span`.
 */
export interface NativeSpanHandle {
  /** Whether this invocation is actually being recorded (head sampling). */
  readonly isTraced: boolean;
  /** Set a single primitive attribute. `undefined` is a no-op. */
  setAttribute(key: string, value: string | number | boolean | undefined): void;
  // Optional: present on newer Cloudflare runtimes only, and `setStatus` /
  // `updateName` are not in Cloudflare's documented custom-span API at all.
  // Every adapter below checks before calling and degrades to attributes, so
  // a missing method can never turn a successful span into a TypeError.
  setAttributes?(
    attributes: Record<string, string | number | boolean | undefined>,
  ): void;
  setStatus?(status: {
    code: 'unset' | 'ok' | 'error';
    message?: string;
  }): void;
  recordException?(exception: {
    name?: string;
    message?: string;
    stack?: string;
  }): void;
  updateName?(name: string): void;
  /**
   * End the span. Only spans from {@link NativeTracer.startSpan} /
   * {@link NativeTracer.startActiveSpan} need it; `enterSpan` ends its own.
   */
  end?(): void;
  /**
   * Optional — not provided by Cloudflare today, but reserved so autotel
   * auto-upgrades to real trace/span ids the moment the platform exposes them,
   * with no API change. When present and valid, its ids take precedence over
   * the fallback correlation id.
   */
  spanContext?(): SpanContext;
}

/**
 * A native tracer creates spans scoped to a callback, auto-nesting by async
 * context. Modelled on Cloudflare's `tracing.enterSpan(name, callback)`.
 */
export interface NativeTracer {
  enterSpan<T>(name: string, callback: (span: NativeSpanHandle) => T): T;
  /** The currently active span; outside custom spans, the invocation root. */
  getActiveSpan?(): NativeSpanHandle | undefined;
  /**
   * Start a span the caller ends, without making it active. Backs OpenTelemetry
   * `tracer.startSpan()`. Cloudflare: `tracing.startSpan(name)` (Sept 2026+).
   */
  startSpan?(name: string): NativeSpanHandle;
  /**
   * Start a span, make it active for the callback, and leave ending it to the
   * caller: OpenTelemetry's `startActiveSpan` contract. Cloudflare:
   * `tracing.startActiveSpan(name, callback)` (Sept 2026+).
   */
  startActiveSpan?<T>(name: string, callback: (span: NativeSpanHandle) => T): T;
  /**
   * Optional per-request correlation id surfaced as `ctx.correlationId` (and a
   * `correlation.id` span attribute) when the platform does not yet expose
   * span ids. On Cloudflare this is the `cf-ray` id, so logs, custom spans, and
   * the dashboard all share one queryable key today.
   */
  readonly correlationId?: string;
}

const INVALID_TRACE_ID = INVALID_SPAN_CONTEXT.traceId;

/** What resolveSpanIds() answers with. */
interface ResolveSpanIdsResult {
  traceId: string;
  spanId: string;
  correlationId: string;
}

/**
 * Resolve trace ids for a native span. Prefers real ids from a (future)
 * `spanContext()`; otherwise falls back to the supplied correlation id.
 */
function resolveSpanIds(
  span: NativeSpanHandle,
  fallbackCorrelationId?: string,
): ResolveSpanIdsResult {
  const sc = span.spanContext?.();
  if (sc && sc.traceId && sc.traceId !== INVALID_TRACE_ID) {
    return {
      traceId: sc.traceId,
      spanId: sc.spanId,
      correlationId: sc.traceId.slice(0, 16),
    };
  }
  return {
    traceId: '',
    spanId: '',
    correlationId: fallbackCorrelationId ?? '',
  };
}

const NATIVE_TRACER_KEY = createContextKey('autotel-native-tracer');
const NATIVE_TRACE_CONTEXT_KEY = createContextKey(
  'autotel-native-trace-context',
);

/**
 * Return a context with the given native tracer installed. Runtime adapters
 * call this once per request and run the handler inside it so that nested
 * `span()` / `trace()` calls route to the native tracer.
 */
export function withNativeTracer(
  tracer: NativeTracer,
  context: Context = api_context.active(),
): Context {
  return context.setValue(NATIVE_TRACER_KEY, tracer);
}

const NATIVE_DISABLED = Symbol('autotel-native-disabled');
let defaultNativeTracer: NativeTracer | null = null;

/**
 * Register a process-wide native tracer used when no wrapper installed one:
 * code outside any autotel handler wrapper (Durable Object RPC methods,
 * entrypoints, module helpers) still nests in the platform waterfall.
 */
export function setDefaultNativeTracer(tracer: NativeTracer | null): void {
  defaultNativeTracer = tracer;
  // Code reaching the default tracer never passed through a handler wrapper,
  // the usual place a context manager is registered (Durable Objects and
  // Workflows under native tracing, RPC entrypoints). Without one, ambient
  // ctx and the request logger see nothing inside trace()/span().
  if (tracer) ensureGlobalContextManager();
}

/**
 * Return a context that opts out of native routing (including the default
 * tracer). OTLP-mode wrappers run handlers in it so their spans stay on
 * autotel's own pipeline.
 */
export function withoutNativeTracer(
  context: Context = api_context.active(),
): Context {
  return context.setValue(NATIVE_TRACER_KEY, NATIVE_DISABLED);
}

/**
 * Read the native tracer from the active context, falling back to the default
 * one. Returns `null` when running without a native tracer (other edge
 * runtimes, native tracing disabled, OTLP mode) — callers then use OTel.
 */
export function getActiveNativeTracer(): NativeTracer | null {
  // SAFETY: this key is written only by withNativeTracer/withoutNativeTracer.
  const value = api_context.active().getValue(NATIVE_TRACER_KEY) as
    NativeTracer | typeof NATIVE_DISABLED | undefined;
  if (value === NATIVE_DISABLED) {
    return null;
  }
  return value ?? defaultNativeTracer;
}

/**
 * Return the TraceContext backed by the currently active native span.
 *
 * Native spans do not appear in OpenTelemetry's active-span API, so the
 * functional API stores this value separately while a native callback runs.
 */
export function getActiveNativeTraceContext(): TraceContext | undefined {
  // SAFETY: as above - autotel's own context key.
  return api_context.active().getValue(NATIVE_TRACE_CONTEXT_KEY) as
    TraceContext | undefined;
}

/**
 * Run a callback with a native-backed TraceContext available to ambient
 * accessors such as `getActiveTraceContext()`.
 */
export function runWithNativeTraceContext<T>(
  traceContext: TraceContext,
  callback: () => T,
): T {
  const active = api_context
    .active()
    .setValue(NATIVE_TRACE_CONTEXT_KEY, traceContext);
  return api_context.with(active, callback);
}

/**
 * Coerce an arbitrary attribute value to the primitive subset native spans
 * accept. Arrays/objects are JSON-stringified; `undefined`/`null` are dropped.
 */
function coerceAttribute(
  value: AttributeValue | undefined,
): string | number | boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function applyNativeAttributes(
  span: NativeSpanHandle,
  attributes: Attributes,
): void {
  const coerced: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(attributes)) {
    coerced[key] = coerceAttribute(value);
  }
  if (typeof span.setAttributes === 'function') {
    span.setAttributes(coerced);
    return;
  }
  for (const [key, value] of Object.entries(coerced)) {
    span.setAttribute(key, value);
  }
}

// Primitives shared by the TraceContext and OTel-Span adapters, so both
// surfaces map onto the native span identically.

function nativeSetStatus(span: NativeSpanHandle, status: SpanStatus): void {
  if (typeof span.setStatus !== 'function') {
    // The platform marks success itself; only an error needs recording.
    if (status.code === SpanStatusCode.ERROR) {
      span.setAttribute('otel.status_code', 'ERROR');
      span.setAttribute('error', true);
      if (status.message) {
        span.setAttribute('otel.status_description', status.message);
      }
    }
    return;
  }
  span.setStatus({
    code:
      status.code === SpanStatusCode.ERROR
        ? 'error'
        : status.code === SpanStatusCode.OK
          ? 'ok'
          : 'unset',
    message: status.message,
  });
}

/**
 * Record an exception on a native span, degrading to `exception.*` attributes
 * where the runtime has no `recordException`.
 */
export function nativeRecordException(
  span: NativeSpanHandle,
  exception: Exception,
): void {
  const error =
    exception instanceof Error ? exception : new Error(String(exception));
  if (typeof span.recordException !== 'function') {
    span.setAttribute('exception.type', error.name);
    span.setAttribute('exception.message', error.message);
    span.setAttribute('exception.stacktrace', error.stack);
    return;
  }
  span.recordException({
    name: error.name,
    message: error.message,
    stack: error.stack,
  });
}

function nativeUpdateName(span: NativeSpanHandle, name: string): void {
  if (typeof span.updateName === 'function') span.updateName(name);
}

function nativeAddEvent(
  eventName: string,
  attributesOrStartTime?: Attributes | TimeInput,
): void {
  // Not app logging: keep it out of log-flood counting.
  runInternal(() => {
    if (
      attributesOrStartTime &&
      typeof attributesOrStartTime === 'object' &&
      !Array.isArray(attributesOrStartTime)
    ) {
      console.log(eventName, attributesOrStartTime);
    } else {
      console.log(eventName);
    }
  });
}

/**
 * Build an autotel {@link TraceContext} backed by a native span.
 *
 * Degradation (native surface is thinner than OTel):
 * - `traceId`/`spanId` → real ids when the platform exposes `spanContext()`
 *   (auto-upgrades in future), otherwise `''`.
 * - `correlationId` → real-id-derived when available, else the supplied
 *   `correlationId` (e.g. Cloudflare `cf-ray`). Also written as a
 *   `correlation.id` span attribute so it is queryable in the backend.
 * - `setStatus` / `recordException` / `updateName` → native span methods.
 * - `addEvent` → `console.log(name, attrs)` (attributed to the span).
 * - `addLink`/`addLinks` → no-ops.
 */
export function createNativeTraceContext(
  span: NativeSpanHandle,
  name: string,
  correlationId?: string,
): TraceContext {
  const ids = resolveSpanIds(span, correlationId);
  if (ids.correlationId) {
    span.setAttribute('correlation.id', ids.correlationId);
  }
  return {
    traceId: ids.traceId,
    spanId: ids.spanId,
    correlationId: ids.correlationId,
    'code.function': name,
    setAttribute: (key, value) =>
      span.setAttribute(key, coerceAttribute(value)),
    setAttributes: (attrs) => applyNativeAttributes(span, attrs),
    setStatus: (status) => nativeSetStatus(span, status),
    recordException: (exception) => nativeRecordException(span, exception),
    addEvent: (eventName, attributesOrStartTime) =>
      nativeAddEvent(eventName, attributesOrStartTime),
    addLink: () => {},
    addLinks: () => {},
    updateName: (newName) => nativeUpdateName(span, newName),
    isRecording: () => span.isTraced,
  };
}

/**
 * Build a minimal OpenTelemetry {@link Span} backed by a native span, for the
 * `span(name, (span) => ...)` callback whose argument is typed as an OTel Span.
 * Unsupported operations degrade exactly as in {@link createNativeTraceContext}.
 */
export function createNativeSpanShim(
  span: NativeSpanHandle,
  correlationId?: string,
  /** The caller owns the span's lifetime, so `end()` ends the native span. */
  owned = false,
): Span {
  // Surface the correlation id as a queryable attribute (parity with
  // createNativeTraceContext), preferring real ids when the platform has them.
  const ids = resolveSpanIds(span, correlationId);
  if (ids.correlationId) {
    span.setAttribute('correlation.id', ids.correlationId);
  }
  // Prefer the platform's real span context when it becomes available;
  // otherwise expose an invalid context (Cloudflare has no spanContext yet).
  const spanContext: SpanContext = span.spanContext?.() ?? INVALID_SPAN_CONTEXT;
  // SAFETY: the one assertion for this shim. Every method OpenTelemetry's Span
  // declares is implemented below, forwarding to the platform's native span;
  // the assertion is needed because each of them returns the shim itself, which
  // TypeScript cannot infer while the object is still being built.
  const shim: Span = {
    spanContext: () => spanContext,
    setAttribute(key: string, value: AttributeValue) {
      span.setAttribute(key, coerceAttribute(value));
      return shim;
    },
    setAttributes(attributes) {
      applyNativeAttributes(span, attributes);
      return shim;
    },
    addEvent(eventName, attributesOrStartTime) {
      nativeAddEvent(eventName, attributesOrStartTime);
      return shim;
    },
    addLink: () => shim,
    addLinks: () => shim,
    setStatus(status) {
      nativeSetStatus(span, status);
      return shim;
    },
    updateName(newName) {
      nativeUpdateName(span, newName);
      return shim;
    },
    end: () => {
      if (owned) span.end?.();
    },
    isRecording: () => span.isTraced,
    recordException: (exception) => nativeRecordException(span, exception),
  } as Span;
  return shim;
}
