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
 * Native span surfaces are deliberately minimal (Cloudflare's `Span` exposes
 * only `setAttribute` + `isTraced`), so the adapters below degrade autotel's
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
} from '@opentelemetry/api';
import type { TraceContext } from './trace-context';

/**
 * The minimal span surface every native runtime is expected to provide.
 * Modelled on Cloudflare Workers' custom-span `Span`.
 */
export interface NativeSpanHandle {
  /** Whether this invocation is actually being recorded (head sampling). */
  readonly isTraced: boolean;
  /** Set a single primitive attribute. `undefined` is a no-op. */
  setAttribute(key: string, value: string | number | boolean | undefined): void;
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
  /**
   * Optional per-request correlation id surfaced as `ctx.correlationId` (and a
   * `correlation.id` span attribute) when the platform does not yet expose
   * span ids. On Cloudflare this is the `cf-ray` id, so logs, custom spans, and
   * the dashboard all share one queryable key today.
   */
  readonly correlationId?: string;
}

const INVALID_TRACE_ID = INVALID_SPAN_CONTEXT.traceId;

/**
 * Resolve trace ids for a native span. Prefers real ids from a (future)
 * `spanContext()`; otherwise falls back to the supplied correlation id.
 */
function resolveSpanIds(
  span: NativeSpanHandle,
  fallbackCorrelationId?: string,
): { traceId: string; spanId: string; correlationId: string } {
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

/**
 * Read the native tracer from the active context, if one was installed.
 * Returns `null` when running without a native tracer (other edge runtimes,
 * native tracing disabled, local dev) — callers then fall back to the OTel path.
 */
export function getActiveNativeTracer(): NativeTracer | null {
  const value = api_context.active().getValue(NATIVE_TRACER_KEY) as
    | NativeTracer
    | undefined;
  return value ?? null;
}

/**
 * Coerce an arbitrary attribute value to the primitive subset native spans
 * accept. Arrays/objects are JSON-stringified; `undefined`/`null` are dropped.
 */
function coerceAttribute(
  value: unknown,
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

function applyAttributes(
  span: NativeSpanHandle,
  attributes: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, coerceAttribute(value));
  }
}

// Degradation primitives shared by the TraceContext and OTel-Span adapters,
// so both surfaces map onto the thin native span identically.

function nativeSetErrorStatus(span: NativeSpanHandle, message?: string): void {
  span.setAttribute('otel.status_code', 'ERROR');
  span.setAttribute('error', true);
  if (message) {
    span.setAttribute('otel.status_description', message);
  }
}

function nativeRecordException(span: NativeSpanHandle, exception: unknown): void {
  const error =
    exception instanceof Error ? exception : new Error(String(exception));
  span.setAttribute('exception.type', error.name);
  span.setAttribute('exception.message', error.message);
  // Platform attributes console output to the active native span.
  console.error(error);
}

function nativeAddEvent(
  eventName: string,
  attributesOrStartTime?: unknown,
): void {
  if (
    attributesOrStartTime &&
    typeof attributesOrStartTime === 'object' &&
    !Array.isArray(attributesOrStartTime)
  ) {
    console.log(eventName, attributesOrStartTime);
  } else {
    console.log(eventName);
  }
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
 * - `setStatus(ERROR)` → records `otel.status_code` + `error` attributes.
 * - `recordException` → attributes + `console.error` (attributed to the span).
 * - `addEvent` → `console.log(name, attrs)` (attributed to the span).
 * - `addLink`/`addLinks`/`updateName` → no-ops.
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
    setAttributes: (attrs) =>
      applyAttributes(span, attrs as Record<string, unknown>),
    setStatus: (status) => {
      if (status.code === SpanStatusCode.ERROR) {
        nativeSetErrorStatus(span, status.message);
      }
    },
    recordException: (exception) => nativeRecordException(span, exception),
    addEvent: (eventName, attributesOrStartTime) =>
      nativeAddEvent(eventName, attributesOrStartTime),
    addLink: () => {},
    addLinks: () => {},
    updateName: () => {},
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
  const shim: Partial<Span> = {
    spanContext: () => spanContext,
    setAttribute(key: string, value: AttributeValue) {
      span.setAttribute(key, coerceAttribute(value));
      return shim as Span;
    },
    setAttributes(attributes) {
      applyAttributes(span, attributes as Record<string, unknown>);
      return shim as Span;
    },
    addEvent(eventName, attributesOrStartTime) {
      nativeAddEvent(eventName, attributesOrStartTime);
      return shim as Span;
    },
    addLink: () => shim as Span,
    addLinks: () => shim as Span,
    setStatus(status) {
      if (status.code === SpanStatusCode.ERROR) {
        nativeSetErrorStatus(span, status.message);
      }
      return shim as Span;
    },
    updateName: () => shim as Span,
    end: () => {},
    isRecording: () => span.isTraced,
    recordException: (exception) => nativeRecordException(span, exception),
  };
  return shim as Span;
}
