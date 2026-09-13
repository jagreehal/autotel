import type { HttpInit, HttpResponse, TimerCall } from 'claude-code';

import type { AttributeValue, Attributes, Span } from '../types';

/**
 * Spans out of the plugin sandbox as OTLP/JSON, over the two nouns it has:
 * `$.http.fetch` to send and `$.clock.after` to batch.
 *
 * Nothing ambient is reached for. There is no OpenTelemetry SDK here because
 * the sandbox has no `node:` modules and a hook is budgeted in microseconds;
 * a span is a plain record until the batch timer posts it.
 */

/** Spans ended within this window go out as one request. */
const FLUSH_MS = 1_000;
/** Spans held while the endpoint is unreachable; the oldest go first. */
const MAX_QUEUED = 1_000;
const TRACES_PATH = '/v1/traces';

export type ExporterDeps = {
  fetch: (url: string, init: HttpInit) => Promise<HttpResponse>;
  after: TimerCall;
  /** `OTEL_EXPORTER_OTLP_ENDPOINT`: a base URL, or one already ending in `/v1/traces`. */
  endpoint: string;
  /** `OTEL_EXPORTER_OTLP_HEADERS`, parsed. */
  headers: NonNullable<HttpInit['headers']>;
  resource: Attributes;
};

/** Where a new span sits: its trace and, inside a turn, the turn's root span. */
export type SpanContext = {
  traceId: string;
  parentSpanId?: string;
};

export type SpanEnd = {
  /** The failure's message; absent when the span succeeded. */
  error?: string;
};

/** A span the mod holds open: the caller-facing `Span` plus its identity and `end`. */
export type OpenSpan = Span & {
  readonly spanId: string;
  readonly traceId: string;
  end: (outcome?: SpanEnd) => void;
};

export type Exporter = {
  start: (
    name: string,
    context: SpanContext,
    attributes?: Attributes,
  ) => OpenSpan;
  /** Posts everything queued now; resolves once the request settled either way. */
  flush: () => Promise<void>;
};

type OtlpAnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

type OtlpKeyValue = { key: string; value: OtlpAnyValue };

type OtlpEvent = {
  name: string;
  timeUnixNano: string;
  attributes: OtlpKeyValue[];
};

export type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** INTERNAL: a hook dispatch is neither a server nor a client. */
  kind: 1;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpKeyValue[];
  events: OtlpEvent[];
  status: { code: 1 } | { code: 2; message: string };
};

const HEX = '0123456789abcdef';

/** `bytes` random bytes as lowercase hex: 16 for a trace id, 8 for a span id. */
export function newId(bytes: 16 | 8): string {
  let id = '';
  for (let i = 0; i < bytes * 2; i++) id += HEX[Math.floor(Math.random() * 16)];
  return id;
}

function nanos(ms: number): string {
  return (BigInt(Math.round(ms)) * 1_000_000n).toString();
}

function anyValue(value: AttributeValue): OtlpAnyValue {
  if (value === true || value === false) return { boolValue: value };
  if (Number.isFinite(value)) {
    // SAFETY: Number.isFinite is true only for a number primitive.
    const n = value as number;
    return Number.isInteger(n) ? { intValue: String(n) } : { doubleValue: n };
  }
  return { stringValue: String(value) };
}

export function keyValues(attributes: Attributes): OtlpKeyValue[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: anyValue(value),
  }));
}

/** `OTEL_EXPORTER_OTLP_HEADERS` (`a=b,c=d`) as the headers `$.http.fetch` takes. */
export function parseHeaders(
  raw: string | undefined,
): NonNullable<HttpInit['headers']> {
  const headers: NonNullable<HttpInit['headers']> = {};
  for (const pair of (raw ?? '').split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    headers[pair.slice(0, eq).trim()] = decodeURIComponent(
      pair.slice(eq + 1).trim(),
    );
  }
  return headers;
}

export function tracesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith(TRACES_PATH) ? trimmed : `${trimmed}${TRACES_PATH}`;
}

export function createExporter(deps: ExporterDeps): Exporter {
  const url = tracesUrl(deps.endpoint);
  const headers = { 'content-type': 'application/json', ...deps.headers };
  const resource = keyValues(deps.resource);
  const queue: OtlpSpan[] = [];
  let scheduled = false;

  async function flush(): Promise<void> {
    scheduled = false;
    if (queue.length === 0) return;
    const spans = queue.splice(0, queue.length);
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: resource },
          scopeSpans: [{ scope: { name: 'autotel-claude-code' }, spans }],
        },
      ],
    });
    // One attempt per batch: devtools is loopback. Add retry with backoff if
    // a flaky collector shows up in practice.
    await deps
      .fetch(url, { method: 'POST', headers, body })
      .catch(() => undefined);
  }

  function enqueue(span: OtlpSpan): void {
    if (queue.length >= MAX_QUEUED) queue.shift();
    queue.push(span);
    if (scheduled) return;
    scheduled = true;
    deps.after(FLUSH_MS, () => void flush());
  }

  function start(
    name: string,
    context: SpanContext,
    attributes: Attributes = {},
  ): OpenSpan {
    const startMs = Date.now();
    const own = new Map<string, AttributeValue>(Object.entries(attributes));
    const events: OtlpEvent[] = [];
    let ended = false;
    const spanId = newId(8);

    return {
      spanId,
      traceId: context.traceId,
      setAttribute: (key, value) => void own.set(key, value),
      setAttributes: (more) => {
        for (const [key, value] of Object.entries(more)) own.set(key, value);
      },
      addEvent: (eventName, eventAttributes = {}) =>
        void events.push({
          name: eventName,
          timeUnixNano: nanos(Date.now()),
          attributes: keyValues(eventAttributes),
        }),
      end: (outcome = {}) => {
        if (ended) return;
        ended = true;
        const record: OtlpSpan = {
          traceId: context.traceId,
          spanId,
          name,
          kind: 1,
          startTimeUnixNano: nanos(startMs),
          endTimeUnixNano: nanos(Date.now()),
          attributes: keyValues(Object.fromEntries(own)),
          events,
          status:
            outcome.error === undefined
              ? { code: 1 }
              : { code: 2, message: outcome.error },
        };
        if (context.parentSpanId !== undefined)
          record.parentSpanId = context.parentSpanId;
        enqueue(record);
      },
    };
  }

  return { start, flush };
}
