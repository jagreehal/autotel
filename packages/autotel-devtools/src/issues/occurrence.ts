// Which telemetry counts as a failure, and what one failure carries.
//
// The input shapes are the smallest common ground between devtools' SpanData
// and autotel-mcp's SpanRecord, so both map in without a lossy detour.

import { culpritOf, fingerprintOf } from './fingerprint';

/** Only strings and numbers are read; anything else an exporter sends is ignored. */
export type Attributes = Readonly<Record<string, unknown>>;

export interface IssueSpanInput {
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  service: string;
  /** Epoch ms. */
  startTime: number;
  status: 'OK' | 'ERROR' | 'UNSET';
  statusMessage?: string;
  attributes: Attributes;
  events?: Array<{ name: string; attributes?: Attributes }>;
}

export interface IssueLogInput {
  id: string;
  traceId?: string;
  service: string;
  severityText?: string;
  severityNumber?: number;
  body: string;
  timestamp: number;
  attributes?: Attributes;
}

/**
 * - `exception`: a span failed (status ERROR) — thrown, or an invocation failure.
 * - `handled_exception`: an exception was recorded on a span that still
 *   succeeded, e.g. `console.error(err)` before a fallback response.
 * - `http_5xx`: a server response in the 5xx range with no exception behind it.
 * - `error_log`: an error-level log outside any trace.
 * - `log_flood` / `runaway_alarm`: autotel's own detectors, reported as
 *   `autotel.LogFlood` / `autotel.RunawayAlarm` exceptions.
 */
export type IssueSource =
  | 'exception'
  | 'handled_exception'
  | 'http_5xx'
  | 'error_log'
  | 'log_flood'
  | 'runaway_alarm';

export interface Occurrence {
  /** Stable per failure: the trace id, or `log:<id>`. Makes ingest idempotent. */
  id: string;
  fingerprint: string;
  service: string;
  source: IssueSource;
  type?: string;
  message: string;
  culprit?: string;
  operation?: string;
  timestamp: number;
  traceId?: string;
  spanId?: string;
  stack?: string;
  version?: string;
  userId?: string;
  accountId?: string;
  sessionId?: string;
}

const DETECTOR_SOURCES: Record<string, IssueSource> = {
  'autotel.LogFlood': 'log_flood',
  'autotel.RunawayAlarm': 'runaway_alarm',
};

function text(
  attributes: Attributes | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attributes?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function identity(attributes: Attributes | undefined) {
  return {
    version: text(
      attributes,
      'service.version',
      'cloudflare.script_version.id',
      'deployment.id',
    ),
    userId: text(attributes, 'user.id', 'enduser.id'),
    accountId: text(attributes, 'account.id', 'tenant.id', 'organization.id'),
    sessionId: text(attributes, 'session.id'),
  };
}

type Identity = ReturnType<typeof identity>;

function merge(own: Identity, trace: Identity): Identity {
  return {
    version: own.version ?? trace.version,
    userId: own.userId ?? trace.userId,
    accountId: own.accountId ?? trace.accountId,
    sessionId: own.sessionId ?? trace.sessionId,
  };
}

/**
 * The exception to report for a span with several: an autotel detector report
 * (log flood, runaway alarm) outranks an ordinary one, else the first recorded.
 */
export function primaryException<
  E extends { name?: string; attributes?: Attributes },
>(events: readonly E[] | undefined): E | undefined {
  const exceptions = (events ?? []).filter((e) => e.name === 'exception');
  return (
    exceptions.find((e) => {
      const type = e.attributes?.['exception.type'];
      return typeof type === 'string' && type in DETECTOR_SOURCES;
    }) ?? exceptions[0]
  );
}

function exceptionOf(span: IssueSpanInput) {
  const event = primaryException(span.events);
  // The chosen event describes the exception. Without one, `exception.*` on
  // the span itself counts: some backends flatten the event into attributes.
  const attrs = event
    ? { ...span.attributes, ...event.attributes }
    : span.attributes;
  const type = text(attrs, 'exception.type', 'error.type');
  const message = text(attrs, 'exception.message', 'error.message');
  const stack = text(
    attrs,
    'exception.stacktrace',
    'exception.stack',
    'error.stack',
  );
  const override = text(attrs, 'exception.fingerprint');
  const hasEvent =
    event !== undefined ||
    text(span.attributes, 'exception.type', 'exception.message') !== undefined;
  return { hasEvent, type, message, stack, override };
}

function statusCodeOf(span: IssueSpanInput): number | undefined {
  const raw =
    span.attributes['http.response.status_code'] ??
    span.attributes['http.status_code'];
  const code = Number(raw);
  return Number.isFinite(code) ? code : undefined;
}

function candidate(
  span: IssueSpanInput,
  traceId: string,
  traceIdentity: Identity,
): Occurrence | undefined {
  const exception = exceptionOf(span);
  const status = statusCodeOf(span);
  // Cloudflare's own export marks a failed invocation by outcome
  // (`exception`, `exceededCpu`, …) rather than always by status.
  const outcome = span.attributes['cloudflare.outcome'];
  const failed =
    span.status === 'ERROR' ||
    (typeof outcome === 'string' && outcome !== 'ok' && outcome !== 'unknown');
  const is5xx = status !== undefined && status >= 500;
  if (!failed && !exception.hasEvent && !is5xx) return undefined;

  let source: IssueSource;
  if (exception.type && DETECTOR_SOURCES[exception.type]) {
    source = DETECTOR_SOURCES[exception.type]!;
  } else if (failed) {
    source = 'exception';
  } else if (exception.hasEvent) {
    source = 'handled_exception';
  } else {
    source = 'http_5xx';
  }

  // A detector's stack is autotel's own frame, whose file name changes with
  // every autotel release: its message (the flooding template, the alarm
  // owner) is what identifies it.
  const stack =
    source === 'log_flood' || source === 'runaway_alarm'
      ? undefined
      : exception.stack;
  const message =
    exception.message ??
    (span.statusMessage || undefined) ??
    (source === 'http_5xx'
      ? `HTTP ${status}`
      : (exception.type ?? `${span.name} failed`));
  return {
    id: traceId,
    fingerprint: fingerprintOf({
      service: span.service,
      type: exception.type,
      message,
      stack,
      operation: span.name,
      override: exception.override,
    }),
    service: span.service,
    source,
    type: exception.type,
    message,
    culprit: culpritOf(stack),
    operation: span.name,
    timestamp: span.startTime,
    traceId,
    spanId: span.spanId,
    stack,
    ...merge(identity(span.attributes), traceIdentity),
  };
}

const PRIORITY: Record<IssueSource, number> = {
  runaway_alarm: 0,
  log_flood: 0,
  exception: 1,
  handled_exception: 2,
  http_5xx: 3,
  error_log: 4,
};

/**
 * One occurrence per trace, so a thrown error, the span it failed and the 500
 * the handler returned are one failure rather than three. Detector reports
 * and real exceptions outrank a bare 5xx; among equals, the deepest span wins
 * (the throw site, not every ancestor it unwound through).
 */
export function occurrenceFromTrace(
  traceId: string,
  spans: IssueSpanInput[],
): Occurrence | undefined {
  // Identity attributes usually sit on the root span; children inherit them.
  const traceIdentity: Identity = {
    version: undefined,
    userId: undefined,
    accountId: undefined,
    sessionId: undefined,
  };
  for (const span of spans) {
    const own = identity(span.attributes);
    traceIdentity.version ??= own.version;
    traceIdentity.userId ??= own.userId;
    traceIdentity.accountId ??= own.accountId;
    traceIdentity.sessionId ??= own.sessionId;
  }
  const candidates = spans
    .map((span) => candidate(span, traceId, traceIdentity))
    .filter((c): c is Occurrence => c !== undefined);
  if (candidates.length === 0) return undefined;

  const best = Math.min(...candidates.map((c) => PRIORITY[c.source]));
  const pool = candidates.filter((c) => PRIORITY[c.source] === best);
  const parents = new Set(
    spans
      .filter((s) => pool.some((c) => c.spanId === s.spanId))
      .map((s) => s.parentSpanId),
  );
  return pool.find((c) => !parents.has(c.spanId)) ?? pool[0];
}

function isErrorLevel(log: IssueLogInput): boolean {
  if (log.severityNumber !== undefined) return log.severityNumber >= 17;
  return /^(error|fatal|critical|emerg|alert)/i.test(log.severityText ?? '');
}

/**
 * An error-level log becomes an occurrence only outside a trace. Inside one,
 * the trace is the failure: autotel records `console.error` as an exception
 * on the active span, so counting the log too would double it.
 */
export function occurrenceFromLog(log: IssueLogInput): Occurrence | undefined {
  if (log.traceId || !isErrorLevel(log)) return undefined;
  const type = text(log.attributes, 'exception.type');
  const message = text(log.attributes, 'exception.message') ?? log.body;
  const stack = text(log.attributes, 'exception.stacktrace');
  return {
    id: `log:${log.id}`,
    fingerprint: fingerprintOf({
      service: log.service,
      type,
      message,
      stack,
      override: text(log.attributes, 'exception.fingerprint'),
    }),
    service: log.service,
    source: 'error_log',
    type,
    message,
    culprit: culpritOf(stack),
    timestamp: log.timestamp,
    stack,
    ...identity(log.attributes),
  };
}
