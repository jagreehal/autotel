/**
 * Stand-ins for the OpenTelemetry objects these tests hand the instrumentation.
 *
 * A span processor is called with an active Context, a tracer with a span, a
 * meter with instruments - and each of those interfaces describes far more than
 * any single test needs. Building them here means the assertion that makes a
 * partial double possible is stated once, next to what it knows.
 */
import { vi } from 'vitest';
import type { Context, Meter, Span, Tracer } from '@opentelemetry/api';
import type { Logger as OTelLogger } from '@opentelemetry/api-logs';
import type {
  ReadableSpan,
  Span as SdkSpan,
} from '@opentelemetry/sdk-trace-base';
import type { SdkLogRecord } from '@opentelemetry/sdk-logs';
import type { Logger } from '../logger';
import type { UnknownRecord } from '../values';

/** The active context a span processor's onStart receives. */
export function emptyContext(): Context {
  // SAFETY: the processors under test read no values off the parent context;
  // they inspect the span. A Context with no entries is what a root span gets.
  return {} as Context;
}

/** A tracer double: the instrumentation only ever starts spans on one. */
export function tracerDouble(tracer: object): Tracer {
  // SAFETY: startSpan and startActiveSpan are the whole of what the wrappers
  // call on a tracer, and a double supplies whichever the path under test uses;
  // their overload sets are why this cannot be a Partial<Tracer>.
  return tracer as Tracer;
}

/** A meter double: the instrumentation creates counters and histograms on one. */
export function meterDouble(meter: object): Meter {
  // SAFETY: as above - only the create* methods a wrapper uses are reached.
  return meter as Meter;
}

/** A span double, for asserting on what was recorded. */
export function spanDouble(span: object = {}): Span {
  const double: object = {
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
    ...span,
  };
  // SAFETY: a test provides the members the path under test touches; anything
  // else on Span is unreachable from it.
  return double as Span;
}

/** The SDK an init test hands back from its factory. */
export function sdkDouble(sdk: object): never {
  // SAFETY: init() calls start() and shutdown() on what the factory returns.
  // The parameter is typed `never` on the option itself, because the SDK type
  // lives behind an optional peer dependency.
  return sdk as never;
}

/** A trace context double, for the helpers that only read ids off one. */
export function traceContextDouble(ctx: object = {}): never {
  // SAFETY: the paths under test read ids and set attributes; a test that needs
  // either supplies it, and the rest of TraceContext is never reached. The
  // return is `never` because each caller's context type is its own - the
  // public TraceContext, or a local widening of it.
  return ctx as never;
}

/** The attributes a spy recorded on its Nth call. */
export function recordedAttributes(
  spy: { mock: { calls: unknown[][] } },
  index = 0,
): UnknownRecord {
  // SAFETY: the spy stands in for `setAttributes`, whose only parameter is an
  // attribute bag; the tests then assert on the keys they expect in it.
  return (spy.mock.calls[index]?.[0] ?? {}) as UnknownRecord;
}

/** A finished span, as a processor or an exporter under test receives one. */
export function readableSpanDouble(span: object): ReadableSpan {
  // SAFETY: a processor reads the handful of fields the test sets - name,
  // attributes, status, times. The rest of ReadableSpan describes machinery an
  // exporter never reaches from these paths.
  return span as ReadableSpan;
}

/** A live span, as a span processor's onStart receives one. */
export function sdkSpanDouble(span: object): SdkSpan {
  // SAFETY: a processor renames the span, reads its attributes, or forwards it
  // whole; the SDK's own bookkeeping on Span is never reached from there.
  return span as SdkSpan;
}

/** A log record, as a log record processor receives one. */
export function logRecordDouble(record: object): SdkLogRecord {
  // SAFETY: a processor reads body, severity and attributes off a record. The
  // rest of SdkLogRecord is the SDK's own emission bookkeeping.
  return record as SdkLogRecord;
}

/** A `fetch` stand-in: the tests only ever call it the one way. */
export function fetchDouble(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  // SAFETY: fetch is declared over `RequestInfo | URL` and carries a
  // `preconnect` member; the code under test calls it with a URL string and
  // an init, which is the whole of what a double has to answer.
  return handler as unknown as typeof fetch;
}

/**
 * An optional module, as `safeRequire` hands one back. The loader is generic
 * in what a module id resolves to; a fixed stub cannot be.
 */
export function moduleDouble(module: object): never {
  // SAFETY: the caller under test reaches for the members it knows this
  // module by, and this double supplies exactly those.
  return module as never;
}

/** The application logger the instrumentation writes canonical lines through. */
export function loggerDouble(logger: object): Logger {
  // SAFETY: a test supplies the levels the path under test calls; the Logger
  // surface mirrors Pino's, and nothing here calls the rest of it.
  return logger as Logger;
}

/** The OpenTelemetry logger a log-emitting processor holds. */
export function otelLoggerDouble(logger: object): OTelLogger {
  // SAFETY: emit() is the whole of what a processor calls on an OTel logger.
  return logger as OTelLogger;
}

/**
 * A stand-in for a call that never returns - `process.exit`, say. A test that
 * replaces one needs an implementation that *does* return, so the code under
 * test keeps running and the assertion can see what it did.
 */
export function returnsInstead(): never {
  // SAFETY: the declared `never` is the real function's promise, not this
  // one's; a test replaces it precisely to break that promise.
  return undefined as never;
}

/** The log record a spy standing in for an OTel logger's `emit` recorded. */
export function recordedEmit(
  spy: { mock: { calls: unknown[][] } },
  index = 0,
): UnknownRecord {
  // SAFETY: the spy stands in for `emit`, whose only parameter is a log
  // record; the test then asserts on the fields it expects on that record.
  return (spy.mock.calls[index]?.[0] ?? {}) as UnknownRecord;
}

/**
 * A value of the wrong type, handed over on purpose so that the runtime
 * validation under test has something to reject. This is what a caller in
 * plain JavaScript, or one who ignored the declared type, actually passes.
 */
export function invalidValue<TDeclared>(
  value:
    NoInfer<TDeclared> | object | string | number | boolean | null | undefined,
): TDeclared {
  // SAFETY: the point of the call is that the value is *not* a TDeclared. The
  // assertion is the test saying so.
  return value as TDeclared;
}
