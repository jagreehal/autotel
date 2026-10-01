/**
 * `autotel-cloudflare/tail`: observability for Workers with no SDK in them.
 *
 * A Tail Worker receives every invocation of the Workers that list it in
 * `tail_consumers`: outcome, uncaught exceptions, console output (with the
 * exception behind each `console.error` arg), the fetch request and response
 * status, the version that ran. This turns each invocation into one OTLP span
 * and its console output into OTLP logs, and sends them to any OTLP endpoint
 * (autotel-devtools, the autotel-mcp collector, a vendor). Issues, grouping,
 * source maps and automations then work exactly as for an instrumented app.
 *
 * ```ts
 * // tail-worker/src/index.ts
 * import { createTailHandler } from 'autotel-cloudflare/tail';
 * export default {
 *   tail: createTailHandler({ endpoint: (env) => env.OTLP_ENDPOINT }),
 * };
 * ```
 * ```jsonc
 * // the observed Worker's wrangler.jsonc: no code change
 * { "tail_consumers": [{ "service": "my-tail-worker" }] }
 * ```
 *
 * Dependency-free on purpose: a tail Worker runs for every invocation of
 * everything it watches, so it should be as small as its job.
 */

/** `exception.type` autotel uses for its log-flood and runaway-alarm reports. */
const LOG_FLOOD = 'autotel.LogFlood';
const RUNAWAY_ALARM = 'autotel.RunawayAlarm';

/** The subset of Cloudflare's `TraceItem` this reads. */
export interface TailItem {
  event?: {
    request?: { method: string; url: string; headers?: Record<string, string> };
    response?: { status: number };
    cron?: string;
    scheduledTime?: number | Date;
    queue?: string;
    batchSize?: number;
    rpcMethod?: string;
  } | null;
  eventTimestamp: number | null;
  logs: Array<{
    timestamp: number;
    level: string;
    message: unknown;
    errorInfo?: Array<{ name: string; message: string; stack?: string } | null>;
  }>;
  exceptions: Array<{
    timestamp: number;
    name: string;
    message: string;
    stack?: string;
  }>;
  scriptName: string | null;
  entrypoint?: string;
  scriptVersion?: { id?: string; tag?: string };
  tailAttributes?: Record<string, string | number | boolean>;
  durableObjectId?: string;
  outcome: string;
  truncated?: boolean;
  cpuTime?: number;
  wallTime?: number;
}

export interface TailOptions {
  /**
   * `service.name` when the event has no `scriptName`, as in `wrangler dev`.
   * In production every event names the Worker that produced it.
   */
  serviceName?: string;
  /** Repeats of one log template per invocation before `autotel.LogFlood`. `0` disables. Default 100. */
  logFloodThreshold?: number;
  /** Alarm runs per Durable Object within `windowMs` before `autotel.RunawayAlarm`. `false` disables. */
  runawayAlarm?: { maxRuns: number; windowMs: number } | false;
}

type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };
type KeyValue = { key: string; value: AnyValue };

function anyValue(value: unknown): AnyValue {
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  return {
    stringValue: typeof value === 'string' ? value : JSON.stringify(value),
  };
}

function attrs(record: Record<string, unknown>): KeyValue[] {
  return Object.entries(record)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    )
    .map(([key, value]) => ({ key, value: anyValue(value) }));
}

const nanos = (ms: number) => `${Math.round(ms)}000000`;

function hex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Join the caller's trace when the request carried a W3C `traceparent`. */
function parentOf(headers: Record<string, string> | undefined) {
  const header = headers?.traceparent ?? headers?.Traceparent;
  const match =
    header && /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(header);
  return match ? { traceId: match[1]!, parentSpanId: match[2]! } : undefined;
}

function format(message: unknown): string {
  const parts = Array.isArray(message) ? message : [message];
  return parts
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
    .join(' ')
    .slice(0, 2000);
}

/** Collapse ids and numbers so one loop's lines share a template. */
export function logTemplate(message: unknown): string {
  return format(message)
    .replaceAll(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '<uuid>',
    )
    .replaceAll(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, '<hex>')
    .replaceAll(/\d+/g, '<n>');
}

const SEVERITY: Record<string, [number, string]> = {
  debug: [5, 'DEBUG'],
  log: [9, 'INFO'],
  info: [9, 'INFO'],
  warn: [13, 'WARN'],
  error: [17, 'ERROR'],
};

/**
 * Alarm runs per Durable Object, per isolate: best effort, as long as a tail
 * isolate lives. Keyed by when each alarm *ran* (the invocation's timestamp),
 * never when the tail received it: events arrive batched, late and out of order.
 */
const alarmRuns = new Map<string, { runs: number[]; reportedAt?: number }>();

function alarmTimestamp(item: TailItem, now: number): number {
  const scheduled = item.event?.scheduledTime;
  return (
    item.eventTimestamp ??
    (scheduled instanceof Date ? scheduled.getTime() : scheduled) ??
    now
  );
}

function runawayAlarm(item: TailItem, options: TailOptions, now: number) {
  const limits = options.runawayAlarm ?? { maxRuns: 10, windowMs: 60_000 };
  if (
    !limits ||
    !item.durableObjectId ||
    item.event?.scheduledTime === undefined ||
    item.event.cron !== undefined
  ) {
    return undefined;
  }
  const at = alarmTimestamp(item, now);
  const state = alarmRuns.get(item.durableObjectId) ?? { runs: [] };
  // Keep two windows either side of the newest run: enough for a late arrival
  // to land in any window that could include it.
  const newest = Math.max(at, ...state.runs);
  state.runs = [...state.runs, at]
    .filter((t) => newest - t < 2 * limits.windowMs)
    // eslint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; lib is ES2022
    .sort((a, b) => a - b)
    .slice(-1000);
  if (alarmRuns.size > 1000 && !alarmRuns.has(item.durableObjectId))
    alarmRuns.clear();
  alarmRuns.set(item.durableObjectId, state);

  // The busiest window that contains this run.
  let busiest = 0;
  for (const startAt of state.runs) {
    if (startAt > at || at - startAt >= limits.windowMs) continue;
    const count = state.runs.filter(
      (t) => t >= startAt && t - startAt < limits.windowMs,
    ).length;
    busiest = Math.max(busiest, count);
  }
  if (busiest <= limits.maxRuns) return undefined;
  // Once per window, measured in run time.
  if (
    state.reportedAt !== undefined &&
    Math.abs(at - state.reportedAt) < limits.windowMs
  ) {
    return undefined;
  }
  state.reportedAt = at;
  return `Durable Object ${item.durableObjectId} alarm ran ${busiest} times in ${limits.windowMs / 1000}s`;
}

function spanName(item: TailItem): string {
  const event = item.event;
  if (event?.request) {
    try {
      return `${event.request.method} ${new URL(event.request.url).pathname}`;
    } catch {
      return event.request.method;
    }
  }
  if (event?.cron !== undefined) return `scheduled ${event.cron}`;
  if (event?.queue) return `queue ${event.queue}`;
  if (event?.rpcMethod) return `rpc ${event.rpcMethod}`;
  if (item.durableObjectId && event?.scheduledTime !== undefined)
    return 'alarm';
  return item.entrypoint ?? 'invocation';
}

export interface OtlpPayloads {
  traces: { resourceSpans: unknown[] };
  logs: { resourceLogs: unknown[] };
}

/** Pure conversion: Cloudflare tail events → OTLP/JSON traces and logs. */
export function tailItemsToOtlp(
  items: TailItem[],
  options: TailOptions = {},
  now: number = Date.now(),
): OtlpPayloads {
  const resourceSpans: unknown[] = [];
  const resourceLogs: unknown[] = [];
  const threshold = options.logFloodThreshold ?? 100;

  for (const item of items) {
    const start = item.eventTimestamp ?? item.logs[0]?.timestamp ?? now;
    const end = start + Math.max(item.wallTime ?? 0, 0);
    const parent = parentOf(item.event?.request?.headers);
    const traceId = parent?.traceId ?? hex(16);
    const spanId = hex(8);
    const status = item.event?.response?.status;
    const failed = item.outcome !== 'ok' || item.exceptions.length > 0;

    const exceptionEvent = (
      time: number,
      name: string,
      message: string,
      stack?: string,
    ) => ({
      name: 'exception',
      timeUnixNano: nanos(time),
      attributes: attrs({
        'exception.type': name,
        'exception.message': message,
        'exception.stacktrace': stack,
      }),
    });
    // Uncaught exceptions, then handled ones: what `console.error(err)` logged.
    const events = item.exceptions.map((e) =>
      exceptionEvent(e.timestamp, e.name, e.message, e.stack),
    );
    const templates = new Map<string, number>();
    for (const log of item.logs) {
      if (log.level === 'error') {
        const errors = (log.errorInfo ?? []).filter(
          (e): e is NonNullable<typeof e> => e !== null,
        );
        if (errors.length > 0) {
          for (const e of errors)
            events.push(
              exceptionEvent(log.timestamp, e.name, e.message, e.stack),
            );
        } else {
          events.push(
            exceptionEvent(
              log.timestamp,
              'Error',
              format(log.message).slice(0, 500),
            ),
          );
        }
      }
      if (threshold > 0) {
        const template = logTemplate(log.message);
        const count = (templates.get(template) ?? 0) + 1;
        templates.set(template, count);
        if (count === threshold + 1) {
          events.push(
            exceptionEvent(
              log.timestamp,
              LOG_FLOOD,
              `"${template.slice(0, 120)}" logged ${threshold}+ times in one invocation`,
            ),
          );
        }
      }
    }
    const runaway = runawayAlarm(item, options, now);
    if (runaway) events.push(exceptionEvent(start, RUNAWAY_ALARM, runaway));

    const service = item.scriptName ?? options.serviceName ?? 'worker';
    const resource = {
      attributes: attrs({
        'service.name': service,
        'service.version': item.scriptVersion?.tag ?? item.scriptVersion?.id,
        'cloudflare.script_version.id': item.scriptVersion?.id,
        'cloud.provider': 'cloudflare',
        'cloud.platform': 'cloudflare.workers',
        'telemetry.sdk.name': 'autotel-cloudflare/tail',
      }),
    };
    let url: URL | undefined;
    try {
      url = item.event?.request ? new URL(item.event.request.url) : undefined;
    } catch {
      url = undefined;
    }

    resourceSpans.push({
      resource,
      scopeSpans: [
        {
          scope: { name: 'autotel-cloudflare/tail' },
          spans: [
            {
              traceId,
              spanId,
              ...(parent ? { parentSpanId: parent.parentSpanId } : {}),
              name: spanName(item),
              kind: item.event?.request ? 2 : 1,
              startTimeUnixNano: nanos(start),
              endTimeUnixNano: nanos(end),
              attributes: attrs({
                ...item.tailAttributes,
                'http.request.method': item.event?.request?.method,
                'url.full': item.event?.request?.url,
                'url.path': url?.pathname,
                'http.response.status_code': status,
                'cloudflare.outcome': item.outcome,
                'cloudflare.entrypoint': item.entrypoint,
                'cloudflare.durable_object.id': item.durableObjectId,
                'cloudflare.cpu_time_ms': item.cpuTime,
                'cloudflare.truncated': item.truncated || undefined,
                'faas.trigger': item.event?.request
                  ? 'http'
                  : item.event?.cron === undefined
                    ? item.event?.queue
                      ? 'pubsub'
                      : 'other'
                    : 'timer',
              }),
              events,
              status: failed
                ? {
                    code: 2,
                    message:
                      item.exceptions[0]?.message ?? `outcome: ${item.outcome}`,
                  }
                : { code: 0 },
            },
          ],
        },
      ],
    });

    if (item.logs.length > 0) {
      resourceLogs.push({
        resource,
        scopeLogs: [
          {
            scope: { name: 'autotel-cloudflare/tail' },
            logRecords: item.logs.map((log) => {
              const [severityNumber, severityText] = SEVERITY[log.level] ?? [
                9,
                'INFO',
              ];
              return {
                timeUnixNano: nanos(log.timestamp),
                severityNumber,
                severityText,
                body: { stringValue: format(log.message) },
                traceId,
                spanId,
              };
            }),
          },
        ],
      });
    }
  }

  return { traces: { resourceSpans }, logs: { resourceLogs } };
}

export interface TailHandlerOptions<Env> extends TailOptions {
  /** OTLP/HTTP base URL, e.g. `https://collector.example` (posts to `/v1/traces` and `/v1/logs`). */
  endpoint: string | ((env: Env) => string | undefined);
  headers?:
    Record<string, string> | ((env: Env) => Record<string, string> | undefined);
}

/** A Worker `tail` handler that ships every observed invocation as OTLP. */
export function createTailHandler<Env = Record<string, unknown>>(
  options: TailHandlerOptions<Env>,
) {
  return async (
    events: TailItem[],
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> => {
    const endpoint =
      typeof options.endpoint === 'function'
        ? options.endpoint(env)
        : options.endpoint;
    if (!endpoint || events.length === 0) return;
    const headers = {
      'content-type': 'application/json',
      ...(typeof options.headers === 'function'
        ? options.headers(env)
        : options.headers),
    };
    const { traces, logs } = tailItemsToOtlp(events, options);
    const base = endpoint
      .replace(/\/+$/, '')
      .replace(/\/v1\/(traces|logs)$/, '');
    const send = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }).then((res) => {
        if (!res.ok)
          console.warn(
            `[autotel-cloudflare/tail] ${path} → HTTP ${res.status}`,
          );
      });
    ctx.waitUntil(
      Promise.all([
        send('/v1/traces', traces),
        logs.resourceLogs.length > 0 ? send('/v1/logs', logs) : undefined,
      ]).catch((error: unknown) =>
        console.warn('[autotel-cloudflare/tail] export failed', error),
      ),
    );
  };
}
