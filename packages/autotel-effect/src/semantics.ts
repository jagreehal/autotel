/* oxlint-disable anti-slop/no-unknown-parameters -- An Effect failure can be any value (E is unconstrained); these functions inspect it to classify the span's exit, and isAnticipatedError is public API typed on that value. */
import {
  context as otelContext,
  SpanStatusCode,
  trace as otelTrace,
  TraceFlags,
  type HrTime,
  type Span as OtelApiSpan,
  type SpanContext,
  type TraceState,
} from '@opentelemetry/api';
import {
  getStructuredErrorAttributes,
  type SpanFilterPredicate,
} from 'autotel';
import * as Cause from 'effect/Cause';
import * as ErrorReporter from 'effect/ErrorReporter';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';
import * as Tracer from 'effect/Tracer';

/** How Effect span exits are classified, and which subtrees are never recorded. */
export interface EffectSpanOptions {
  /**
   * Span name prefixes whose span and every descendant are not recorded. The
   * span starts unsampled and its children inherit that, Effect or not (a
   * database query, an outgoing fetch). Outgoing calls under it send
   * `traceparent` with the sampled flag off, and errors inside it are not
   * recorded either, so keep real work out of a dropped span.
   */
  readonly dropSpanSubtrees?: ReadonlyArray<string>;
  /**
   * `_tag` (else `Error.name`) of expected failures: not found, validation,
   * a duplicate. A span failing only with these is OK with no exception event.
   * A server span that answered 5xx stays an error regardless.
   */
  readonly anticipatedErrorIdentifiers?: ReadonlyArray<string>;
  /** Predicate form, for a failure a tag cannot single out. */
  readonly isAnticipatedError?: (error: unknown) => boolean;
}

/** The parts of `@effect/opentelemetry`'s OtelSpan this module relies on. */
interface BridgedSpan extends Tracer.Span {
  readonly span: OtelApiSpan;
  readonly attributes: Map<string, unknown>;
  // OtelSpan keeps its status as a plain field and sets it in end().
  status: Tracer.SpanStatus;
}

const isBridgedSpan = (span: Tracer.Span): span is BridgedSpan =>
  Predicate.hasProperty(span, 'span') && span.attributes instanceof Map;

/**
 * Wraps the Effect tracer `@effect/opentelemetry` builds, so every span still
 * goes to autotel's global provider (and joins whatever trace is active) while
 * its exit is classified: expected failures, server 5xx rendered as a response,
 * client 4xx and structured errors.
 */
export function withEffectSemantics(
  inner: Tracer.Tracer,
  options: EffectSpanOptions = {},
): Tracer.Tracer {
  const dropSubtree = prefixMatcher(options.dropSpanSubtrees);
  const isAnticipated = anticipatedMatcher(options);
  const span: Tracer.Tracer['span'] = (spanOptions) => {
    // @effect/opentelemetry ignores `sampled`, which Effect turns off below MinimumTraceLevel.
    const started =
      !spanOptions.sampled || dropSubtree?.(spanOptions.name)
        ? startUnsampled(inner, spanOptions)
        : inner.span(spanOptions);
    if (isBridgedSpan(started)) classifyEnd(started, isAnticipated);
    return started;
  };
  // Keep the inner tracer's context hook, which makes the Effect span OTel's active span.
  return inner.context
    ? Tracer.make({ span, context: inner.context })
    : Tracer.make({ span });
}

/**
 * A filter for `init({ spanFilter })` that drops Effect spans by name prefix or
 * predicate. Dropping one span is the export pipeline's job, which `init()`
 * builds: autotel then gives the dropped span's children its nearest kept
 * ancestor as their parent, so the trace stays connected. Spans from other
 * instrumentation are never matched.
 */
export function effectSpanFilter(options: {
  readonly dropSpanNames?: ReadonlyArray<string>;
  readonly dropSpan?: SpanFilterPredicate;
}): SpanFilterPredicate {
  const dropName = prefixMatcher(options.dropSpanNames);
  return (span) =>
    span.instrumentationScope.name !== 'effect' ||
    !(dropName?.(span.name) || options.dropSpan?.(span));
}

function prefixMatcher(prefixes: ReadonlyArray<string> | undefined) {
  return prefixes && prefixes.length > 0
    ? (name: string) => prefixes.some((prefix) => name.startsWith(prefix))
    : undefined;
}

function failureIdentifier(error: unknown): string | undefined {
  if (Predicate.hasProperty(error, '_tag') && Predicate.isString(error._tag)) {
    return error._tag;
  }
  if (Predicate.hasProperty(error, 'name') && Predicate.isString(error.name)) {
    return error.name;
  }
  // An error decoded from an HTTP body arrives wrapped as { error: { _tag } }.
  const body = Predicate.hasProperty(error, 'error') ? error.error : undefined;
  if (Predicate.hasProperty(body, '_tag') && Predicate.isString(body._tag)) {
    return body._tag;
  }
  return undefined;
}

function anticipatedMatcher(options: EffectSpanOptions) {
  const identifiers = new Set(options.anticipatedErrorIdentifiers ?? []);
  const predicate = options.isAnticipatedError;
  return (error: unknown): boolean => {
    const identifier = failureIdentifier(error);
    if (identifier !== undefined && identifiers.has(identifier)) return true;
    try {
      return predicate?.(error) ?? false;
    } catch {
      return false; // a throwing predicate leaves the failure an error
    }
  };
}

/**
 * Start the span under a local parent that is not sampled: autotel's sampler
 * keeps a local parent's decision, so the span and everything started under it
 * are not recorded. The parent keeps the real trace and span ids.
 */
function startUnsampled(
  inner: Tracer.Tracer,
  spanOptions: Parameters<Tracer.Tracer['span']>[0],
): Tracer.Span {
  const active = otelContext.active();
  const parent = spanOptions.root
    ? undefined
    : Option.isSome(spanOptions.parent)
      ? spanOptions.parent.value
      : otelTrace.getSpanContext(active);
  const stand: SpanContext = {
    traceId: parent?.traceId ?? randomHex(32),
    spanId: parent?.spanId ?? randomHex(16),
    traceFlags: TraceFlags.NONE,
    isRemote: false,
  };
  // Keep the parent's tracestate, so calls under a dropped span still carry it.
  const activeContext = otelTrace.getSpanContext(active);
  const traceState =
    traceStateOf(parent) ??
    (activeContext?.traceId === stand.traceId
      ? activeContext.traceState
      : undefined);
  if (traceState) stand.traceState = traceState;
  const unsampled = otelTrace.wrapSpanContext(stand);
  return otelContext.with(otelTrace.setSpan(active, unsampled), () =>
    inner.span({ ...spanOptions, parent: Option.none(), root: false }),
  );
}

/** The W3C tracestate of a span `@effect/opentelemetry` bridged to OTel. */
function traceStateOf(
  span: Tracer.AnySpan | SpanContext | undefined,
): TraceState | undefined {
  if (!span || !('_tag' in span) || span._tag !== 'Span') return undefined;
  return isBridgedSpan(span) ? span.span.spanContext().traceState : undefined;
}

function randomHex(length: number): string {
  let id = '';
  while (id.length < length) id += Math.floor(Math.random() * 16).toString(16);
  // An all-zero id is invalid and would be ignored as a parent.
  return id.replace(/^0/, '1');
}

const HTTP_STATUS = 'http.response.status_code';

function statusCodeOf(span: BridgedSpan): number | undefined {
  const raw = span.attributes.get(HTTP_STATUS);
  const code = Predicate.isNumber(raw) ? raw : Number(raw);
  return Number.isInteger(code) ? code : undefined;
}

/** A server span that answered 5xx, which Effect's HTTP boundaries render as a plain response. */
function renderedServerError(span: BridgedSpan): number | undefined {
  const code = span.kind === 'server' ? statusCodeOf(span) : undefined;
  return code !== undefined && code >= 500 ? code : undefined;
}

// Effect 4.0.2+ fails a 5xx server span itself with HttpServerError { reason:
// ResponseError }. Without a cause or description it says nothing the status
// code does not, so it is treated as the rendered 5xx.
function isStatusOnlyResponseFailure(
  exit: Exit.Exit<unknown, unknown>,
): boolean {
  if (exit._tag === 'Success') return false;
  const [reason, ...rest] = exit.cause.reasons;
  if (rest.length > 0 || reason === undefined || !Cause.isFailReason(reason)) {
    return false;
  }
  const error = reason.error;
  if (!Predicate.isTagged(error, 'HttpServerError')) return false;
  const inner = Predicate.hasProperty(error, 'reason')
    ? error.reason
    : undefined;
  return (
    Predicate.isTagged(inner, 'ResponseError') &&
    (!Predicate.hasProperty(inner, 'cause') || inner.cause === undefined) &&
    (!Predicate.hasProperty(inner, 'description') ||
      inner.description === undefined)
  );
}

/** Effect fails every 4xx client span with a StatusCodeError before the caller has seen it. */
function clientStatus4xx(
  span: BridgedSpan,
  exit: Exit.Exit<unknown, unknown>,
): number | undefined {
  if (span.kind !== 'client' || exit._tag === 'Success') return undefined;
  const [reason, ...rest] = exit.cause.reasons;
  if (rest.length > 0 || reason === undefined || !Cause.isFailReason(reason)) {
    return undefined;
  }
  const error = reason.error;
  if (!Predicate.isTagged(error, 'HttpClientError')) return undefined;
  const inner = Predicate.hasProperty(error, 'reason')
    ? error.reason
    : undefined;
  if (!Predicate.isTagged(inner, 'StatusCodeError')) return undefined;
  const response = Predicate.hasProperty(inner, 'response')
    ? inner.response
    : undefined;
  const status = Predicate.hasProperty(response, 'status')
    ? response.status
    : undefined;
  return Predicate.isNumber(status) && status >= 400 && status < 500
    ? status
    : undefined;
}

/** The reason an HttpClientError failed with (TransportError, ...), a more useful error.type than its tag. */
function httpClientReasonTag(
  exit: Exit.Exit<unknown, unknown>,
): string | undefined {
  if (exit._tag === 'Success') return undefined;
  const reason = exit.cause.reasons.find(Cause.isFailReason);
  const error = reason?.error;
  if (!Predicate.isTagged(error, 'HttpClientError')) return undefined;
  const inner = Predicate.hasProperty(error, 'reason')
    ? error.reason
    : undefined;
  return Predicate.hasProperty(inner, '_tag') && Predicate.isString(inner._tag)
    ? inner._tag
    : undefined;
}

function isExpectedFailure(
  cause: Cause.Cause<unknown>,
  isAnticipated: (error: unknown) => boolean,
): boolean {
  if (cause.reasons.some(Cause.isDieReason)) return false;
  const failures = cause.reasons.filter(Cause.isFailReason);
  return (
    failures.length > 0 &&
    failures.every(
      (reason) =>
        isAnticipated(reason.error) || ErrorReporter.isIgnored(reason.error),
    )
  );
}

function serverErrorResponse(span: BridgedSpan, code: number): Error {
  const method = span.attributes.get('http.request.method');
  const path = span.attributes.get('url.path');
  const message =
    Predicate.isString(method) && Predicate.isString(path)
      ? `HTTP ${code} (${method} ${path})`
      : `HTTP ${code}`;
  const error = new Error(message);
  error.name = 'HttpServerErrorResponse';
  error.stack = `${error.name}: ${message}`; // synthetic: its own frames are noise
  return error;
}

function nanosToHrTime(nanos: bigint): HrTime {
  return [Number(nanos / 1_000_000_000n), Number(nanos % 1_000_000_000n)];
}

/** Structured fields (why, fix, link, code, status) a failure carries, as error.* attributes. */
function stampStructuredError(span: BridgedSpan, cause: Cause.Cause<unknown>) {
  for (const reason of cause.reasons) {
    const value = Cause.isFailReason(reason)
      ? reason.error
      : Cause.isDieReason(reason)
        ? reason.defect
        : undefined;
    if (!(value instanceof Error)) continue;
    for (const [key, attribute] of Object.entries(
      getStructuredErrorAttributes(value),
    )) {
      // exception.* already carries the message and stack; error.type is set below.
      if (
        key === 'error.message' ||
        key === 'error.stack' ||
        key === 'error.type'
      ) {
        continue;
      }
      if (attribute !== undefined) span.span.setAttribute(key, attribute);
    }
    return;
  }
}

function classifyEnd(
  span: BridgedSpan,
  isAnticipated: (error: unknown) => boolean,
): void {
  const end = span.end.bind(span);
  const setErrorType = (value: string) => {
    if (!span.attributes.has('error.type')) span.attribute('error.type', value);
  };
  let recordedException = false;
  const event = span.event.bind(span);
  span.event = (name, startTime, attributes) => {
    if (name === 'exception') recordedException = true;
    event(name, startTime, attributes);
  };
  const endWithError = (
    endTime: bigint,
    exit: Exit.Exit<unknown, unknown>,
    message: string,
  ) => {
    span.span.setStatus({ code: SpanStatusCode.ERROR, message });
    span.status = {
      _tag: 'Ended',
      startTime: span.status.startTime,
      endTime,
      exit,
    };
    span.span.end(nanosToHrTime(endTime));
  };

  span.end = (endTime, exit) => {
    const serverError = renderedServerError(span);
    if (
      serverError !== undefined &&
      (exit._tag === 'Success' || isStatusOnlyResponseFailure(exit))
    ) {
      setErrorType(String(serverError));
      const response = serverErrorResponse(span, serverError);
      // Relabelling an exception the handler recorded would merge every such 5xx into one group.
      if (recordedException) endWithError(endTime, exit, response.message);
      else end(endTime, Exit.die(response));
      return;
    }
    if (exit._tag === 'Success' || Cause.hasInterruptsOnly(exit.cause)) {
      end(endTime, exit);
      return;
    }
    if (
      serverError === undefined &&
      isExpectedFailure(exit.cause, isAnticipated)
    ) {
      end(endTime, Exit.void);
      return;
    }
    const clientStatus = clientStatus4xx(span, exit);
    if (clientStatus !== undefined) {
      // Error by the HTTP conventions, but no exception: whether the 4xx is a
      // fault is the caller's to say, and an unhandled one fails its span too.
      setErrorType(String(clientStatus));
      endWithError(endTime, exit, `HTTP ${clientStatus}`);
      return;
    }
    stampStructuredError(span, exit.cause);
    const code = statusCodeOf(span);
    setErrorType(
      code !== undefined && code >= 400
        ? String(code)
        : (httpClientReasonTag(exit) ??
            Cause.prettyErrors(exit.cause)[0]?.name ??
            '_OTHER'),
    );
    end(endTime, exit);
  };
}
