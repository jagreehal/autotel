/**
 * Browser span export over OTLP/JSON, with delivery that survives a bad
 * network.
 *
 * The naive version — post and hope — loses everything on a flaky connection,
 * an offline tab, or a collector that 503s for a minute, and loses it silently:
 * nothing on the page notices, and the backend cannot distinguish spans that
 * were dropped from a user who never showed up. So sends are retried with
 * jittered backoff, held while offline, and bounded so an unreachable collector
 * costs memory but never unbounded memory.
 *
 * The one failure that is *not* retried indefinitely is a request that dies
 * before any HTTP status while the browser reports itself online. That is
 * almost always an ad blocker, an extension, or a CORS misconfiguration —
 * deterministic, not transient — so after a few of them the exporter stops and
 * waits for an `online` event rather than retrying something that will never
 * work.
 *
 * `sendBeacon` is used only on the way out. It cannot report an outcome, so
 * there is nothing to retry against; while the page is alive `fetch` is worth
 * the extra bytes for the status code alone.
 */

import { getSessionAttributes } from './session';
import { otlpEndpointFor, type OtlpSignal } from './otlp-endpoint';
import { sampleByKey } from './sampling';
import { SESSION } from './semconv';

/** Retries for one batch before it is given up on. */
const MAX_RETRIES = 8;
/** Consecutive responseless failures before the exporter stops trying. */
const MAX_BLOCKED_FAILURES = 3;
/** Ceiling on a single backoff step. */
const MAX_BACKOFF_MS = 5 * 60 * 1000;
/** Spans held while delivery is failing. Oldest go first when it overflows. */
const MAX_QUEUED_SPANS = 1000;

/**
 * Per-signal delivery state. Traces and logs queue and retry independently — a
 * collector rejecting one is no reason to stop sending the other — but they
 * share the blocked-request count, because that describes the network rather
 * than the payload.
 */
interface SignalQueue {
  pending: unknown[];
  /**
   * The batch currently being retried, held apart from `pending` so that giving
   * up on it discards exactly it — and not the records queued behind it, which
   * have never been attempted.
   */
  retryBatch?: unknown[];
  retries: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  inFlight: boolean;
}

const SIGNALS: OtlpSignal[] = ['traces', 'logs'];

function emptyQueue(): SignalQueue {
  return { pending: [], retries: 0, inFlight: false };
}

let debug = false;
let serviceName = 'browser';
let exportEndpoint: string | undefined;
let queues: Record<OtlpSignal, SignalQueue> = {
  traces: emptyQueue(),
  logs: emptyQueue(),
};
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let rawFetch: typeof globalThis.fetch | undefined;
/**
 * Which signals this exporter owns. Full mode runs the Web SDK for traces and
 * borrows only the log half, so it enables `logs` alone — otherwise every span
 * would be exported twice.
 */
let enabledSignals: Set<OtlpSignal> = new Set(SIGNALS);
/**
 * Fraction of sessions exported, 0..1. Applied to **every** signal.
 *
 * Sampling only the trace provider would keep a tenth of sessions' spans and
 * all of everyone's events and logs — not sampling, just a surprise bill, and
 * a session whose events survive while its spans do not is unreadable either
 * way. Hashing the session id means one visit is kept or dropped whole, across
 * signals, with no coordination.
 */
let sampleRate = 1;
let blockedFailures = 0;
let detachOnline: (() => void) | undefined;

/**
 * Jittered exponential backoff. Jitter matters more than the curve: without it
 * every tab that failed on the same collector blip retries in the same
 * millisecond and produces a second one.
 */
function backoffMs(attempt: number): number {
  const base = Math.min(MAX_BACKOFF_MS, 3000 * 2 ** attempt);
  return Math.ceil(base * (0.75 + Math.random() * 0.5));
}

function isOffline(): boolean {
  return globalThis.navigator?.onLine === false;
}

/**
 * Provide the unpatched fetch so the exporter bypasses instrumentation.
 * Must be called before init() patches window.fetch.
 */
export function setRawFetch(fn: typeof globalThis.fetch): void {
  rawFetch = fn;
}

export interface ExporterOptions {
  /** Signals this exporter owns. Defaults to both. */
  signals?: OtlpSignal[];
  /** Fraction of sessions to export, 0..1. Defaults to 1. */
  sampleRate?: number;
}

/**
 * Whether this session is in the sample. Falls back to keeping the record when
 * there is no session to hash — dropping telemetry because identity is missing
 * would silently lose the very first records of every visit.
 */
/**
 * A key for this page load, minted once and never exported.
 *
 * With sessions disabled there is no identity to hash, but drawing per record
 * would keep fragments of every page rather than a share of whole ones — which
 * is the failure session-consistent sampling exists to avoid, and a page you
 * only have a tenth of is a page you cannot read. A private key gives the same
 * consistency without putting an identifier on the wire.
 */
let pageKey: string | undefined;

function samplingKey(): string {
  const sessionId = getSessionAttributes()?.[SESSION.ID];
  if (sessionId !== undefined) return sessionId;
  pageKey ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return pageKey;
}

function sampled(): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return sampleByKey(samplingKey(), sampleRate);
}

export function configureExporter(
  service: string,
  endpoint: string,
  enableDebug = false,
  options?: ExporterOptions,
): void {
  debug = enableDebug;
  serviceName = service;
  enabledSignals = new Set(options?.signals ?? SIGNALS);
  sampleRate = options?.sampleRate ?? 1;
  // Stored unresolved; each signal derives its own path.
  exportEndpoint = endpoint;
  if (!flushTimer) {
    flushTimer = setInterval(() => flushSpans(), 2000);
  }
  if (!detachOnline && globalThis.window !== undefined) {
    // Coming back online is the one signal worth clearing the breaker for: the
    // condition that made every send fail may genuinely be gone.
    const onOnline = (): void => {
      blockedFailures = 0;
      for (const signal of SIGNALS) {
        const queue = queues[signal];
        queue.retries = 0;
        if (queue.retryTimer !== undefined) {
          clearTimeout(queue.retryTimer);
          queue.retryTimer = undefined;
        }
      }
      flushSpans();
    };
    window.addEventListener('online', onOnline);
    detachOnline = () => window.removeEventListener('online', onOnline);
  }
}

export function recordSpan(
  traceId: string,
  spanId: string,
  name: string,
  startMs: number,
  endMs: number,
  attrs?: Record<string, string | number>,
): void {
  if (exportEndpoint === undefined || !enabledSignals.has('traces')) return;
  if (!sampled()) return;
  if (debug)
    console.log(`[autotel-web] recordSpan: ${name} (${traceId.slice(0, 8)}…)`);
  // Session attributes ride on the span rather than the resource: the resource
  // identifies the service, and a value that changes every 30 minutes there
  // would fragment it in every backend that keys on resource identity.
  const entries = Object.entries({
    ...attrs,
    ...getSessionAttributes(),
  });
  const attributes =
    entries.length > 0
      ? entries.map(([key, value]) => ({
          key,
          value:
            typeof value === 'number'
              ? { intValue: String(value) }
              : { stringValue: value },
        }))
      : undefined;
  enqueue('traces', {
    traceId,
    spanId,
    name,
    kind: 3, // CLIENT
    startTimeUnixNano: String(Math.round(startMs * 1_000_000)),
    endTimeUnixNano: String(Math.round(endMs * 1_000_000)),
    attributes,
  });
  // Flush immediately — browser spans are infrequent.
  flushSpans();
}

function enqueue(signal: OtlpSignal, record: unknown): void {
  const queue = queues[signal];
  queue.pending.push(record);
  if (queue.pending.length > MAX_QUEUED_SPANS) {
    // Drop the oldest: in a queue that is not draining, the newest records are
    // the ones describing whatever is going wrong now.
    queue.pending = queue.pending.slice(-MAX_QUEUED_SPANS);
  }
}

function resourceAttributes(): { key: string; value: unknown }[] {
  return [{ key: 'service.name', value: { stringValue: serviceName } }];
}

/** OTLP attribute list from a flat record. */
function otlpAttributes(
  values: Record<string, string | number | boolean>,
): { key: string; value: unknown }[] {
  return Object.entries(values).map(([key, value]) => ({
    key,
    value: otlpValue(value),
  }));
}

/** An OTLP `AnyValue`. Numbers keep their type — an int is not a double. */
function otlpValue(value: string | number | boolean): unknown {
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  return { stringValue: value };
}

function payloadFor(signal: OtlpSignal, records: unknown[]): string {
  if (signal === 'logs') {
    // Grouped by scope so console auto-capture is distinguishable from what the
    // application logged deliberately.
    const byScope = new Map<string, unknown[]>();
    for (const record of records) {
      const { scope, ...rest } = record as { scope: string };
      const bucket = byScope.get(scope) ?? [];
      bucket.push(rest);
      byScope.set(scope, bucket);
    }
    return JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: resourceAttributes() },
          scopeLogs: [...byScope].map(([name, logRecords]) => ({
            scope: { name },
            logRecords,
          })),
        },
      ],
    });
  }
  return JSON.stringify({
    resourceSpans: [
      {
        resource: { attributes: resourceAttributes() },
        scopeSpans: [{ scope: { name: 'autotel-web' }, spans: records }],
      },
    ],
  });
}

function scheduleRetry(signal: OtlpSignal, batch: unknown[]): void {
  const queue = queues[signal];
  if (queue.retries >= MAX_RETRIES) {
    // This batch has had its chances. Only this batch: the records queued
    // behind it were never attempted, and dropping them for the sins of the
    // one in front is how a single bad payload takes a whole visit with it.
    if (debug)
      console.warn(
        `[autotel-web] giving up on ${batch.length} ${signal} record(s) after ${queue.retries} retries`,
      );
    queue.retryBatch = undefined;
    queue.retries = 0;
    return;
  }
  queue.retryBatch = batch;
  if (queue.retryTimer !== undefined) return;
  const delay = backoffMs(queue.retries);
  queue.retries += 1;
  queue.retryTimer = setTimeout(() => {
    queue.retryTimer = undefined;
    flushSpans();
  }, delay);
}

export interface FlushOptions {
  /**
   * Send via `sendBeacon`, which survives the page going away but reports no
   * outcome. For unload only.
   */
  beacon?: boolean;
}

export function flushSpans(options?: FlushOptions): void {
  for (const signal of SIGNALS) flushSignal(signal, options);
}

function flushSignal(signal: OtlpSignal, options?: FlushOptions): void {
  if (exportEndpoint === undefined || !enabledSignals.has(signal)) return;
  const queue = queues[signal];
  if (queue.pending.length === 0 && !queue.retryBatch?.length) return;
  const url = otlpEndpointFor(exportEndpoint, signal);

  if (options?.beacon) {
    // Everything still owed, including a batch mid-backoff: unload is the last
    // chance either will get, and the retry timer will never fire again.
    const owed = [...(queue.retryBatch ?? []), ...queue.pending];
    const blob = new Blob([payloadFor(signal, owed)], {
      type: 'application/json',
    });
    // `sendBeacon` refuses a payload over the browser's limit, or when its own
    // queue is full, and says so by returning false. Clearing first would turn
    // that refusal into silent loss at the one moment — unload — with no second
    // chance. Absent entirely (older browsers, some sandboxes) reads the same.
    const accepted = globalThis.navigator?.sendBeacon?.(url, blob) === true;
    if (accepted) {
      queue.pending = [];
      queue.retryBatch = undefined;
    } else if (debug) {
      console.warn(
        `[autotel-web] sendBeacon refused ${owed.length} ${signal} record(s); keeping them queued`,
      );
    }
    return;
  }

  if (queue.inFlight || queue.retryTimer !== undefined) return;
  if (isOffline()) return;
  if (blockedFailures >= MAX_BLOCKED_FAILURES) return;
  if (!rawFetch) return;

  // A batch under retry is sent alone, never merged with what has queued
  // behind it. Merging would make newer records part of a batch that may be
  // given up on, so one bad payload would take every record after it too.
  const retrying = queue.retryBatch;
  const records = retrying ?? queue.pending;
  if (retrying) queue.retryBatch = undefined;
  else queue.pending = [];
  if (debug)
    console.log(
      `[autotel-web] flush: sending ${records.length} ${signal} record(s) to ${url}`,
    );

  queue.inFlight = true;
  rawFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payloadFor(signal, records),
    keepalive: true,
  })
    .then((response) => {
      queue.inFlight = false;
      if (response.ok) {
        queue.retries = 0;
        blockedFailures = 0;
        return;
      }
      // A 4xx that is not 408/429 will fail identically next time; only a
      // server or throttling error is worth repeating.
      const worthRetrying =
        response.status >= 500 ||
        response.status === 408 ||
        response.status === 429;
      if (worthRetrying) {
        scheduleRetry(signal, records);
      } else if (debug) {
        console.warn(
          `[autotel-web] collector rejected ${records.length} ${signal} record(s): ${response.status}`,
        );
      }
    })
    .catch(() => {
      queue.inFlight = false;
      // No response at all. Online, that means blocked rather than broken.
      if (!isOffline()) blockedFailures += 1;
      if (blockedFailures >= MAX_BLOCKED_FAILURES) {
        // Held, not retried: the breaker reopens on `online`.
        queue.retryBatch = records;
        if (debug)
          console.warn(
            '[autotel-web] export blocked (no response); pausing until back online',
          );
        return;
      }
      scheduleRetry(signal, records);
    });
}

/** Severity numbers from the OpenTelemetry logs data model. */
const SEVERITY = {
  debug: { number: 5, text: 'DEBUG' },
  info: { number: 9, text: 'INFO' },
  warn: { number: 13, text: 'WARN' },
  error: { number: 17, text: 'ERROR' },
} as const;

export type LogSeverity = keyof typeof SEVERITY;

/**
 * Record one OTLP log record.
 *
 * Session attributes ride along for the same reason they do on spans: a log
 * line nobody can join to the visit it came from explains very little.
 */
export function recordLog(
  severity: LogSeverity,
  body: string,
  attributes: Record<string, string | number | boolean> = {},
  scope = 'autotel-web',
): void {
  if (exportEndpoint === undefined || !enabledSignals.has('logs') || !sampled())
    return;
  const { number, text } = SEVERITY[severity];
  enqueue('logs', {
    scope,
    timeUnixNano: String(Date.now() * 1_000_000),
    severityNumber: number,
    severityText: text,
    body: { stringValue: body },
    // Ambient enrichment first: it is a default, and an attribute the caller
    // stated outright must win. `session.end` names the session that ended, and
    // stamping the current one over it inverts the record's whole meaning.
    attributes: otlpAttributes({ ...getSessionAttributes(), ...attributes }),
  });
  flushSpans();
}

/**
 * Record an OpenTelemetry **event** — a log record carrying an event name.
 *
 * This is what `app.widget.click`, `browser.web_vital`, `app.jank`,
 * `session.start` and the rest actually are in the data model. The name is set
 * both as the record's `eventName` field and as the `event.name` attribute,
 * because collectors and backends are split on which one they read and an event
 * nobody can find by name is not an event.
 */
export function recordEvent(
  name: string,
  attributes: Record<string, string | number | boolean> = {},
): void {
  if (exportEndpoint === undefined || !enabledSignals.has('logs') || !sampled())
    return;
  enqueue('logs', {
    scope: 'autotel-web',
    timeUnixNano: String(Date.now() * 1_000_000),
    eventName: name,
    severityNumber: SEVERITY.info.number,
    severityText: SEVERITY.info.text,
    attributes: otlpAttributes({
      ...getSessionAttributes(),
      'event.name': name,
      ...attributes,
    }),
  });
  flushSpans();
}

export function isConfigured(): boolean {
  return exportEndpoint !== undefined;
}

/** Spans waiting to be delivered. Exported for tests and health checks. */
export function pendingSpanCount(): number {
  return queued('traces');
}

/** Log records waiting to be delivered. */
export function pendingLogCount(): number {
  return queued('logs');
}

/** @internal The queued log records themselves, for tests. */
export function pendingLogRecordsForTesting(): unknown[] {
  return [...(queues.logs.retryBatch ?? []), ...queues.logs.pending];
}

/** Everything still owed for a signal, including a batch awaiting retry. */
function queued(signal: OtlpSignal): number {
  const queue = queues[signal];
  return queue.pending.length + (queue.retryBatch?.length ?? 0);
}

export function resetForTesting(): void {
  exportEndpoint = undefined;
  blockedFailures = 0;
  enabledSignals = new Set(SIGNALS);
  sampleRate = 1;
  pageKey = undefined;
  for (const signal of SIGNALS) {
    const queue = queues[signal];
    if (queue.retryTimer) clearTimeout(queue.retryTimer);
  }
  queues = { traces: emptyQueue(), logs: emptyQueue() };
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = undefined;
  }
  detachOnline?.();
  detachOnline = undefined;
}
