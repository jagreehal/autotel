/**
 * Assert on spans a service in another process sent to the devtools receiver.
 *
 * `autotel/testing` collects spans in the test's own process. A test that drives
 * a service running elsewhere (a container, a dev server, a worker) cannot see
 * that service's spans that way, but the receiver can: the service exports to
 * it, and `GET /v1/traces` reads back what actually arrived. These helpers poll
 * that readback, so a test can say "the order service ran this query, under my
 * trace" and fail with what was received instead of a timeout.
 *
 * Plain `fetch`, no OTel dependency, so it runs in any test runner.
 *
 * @example
 * ```ts
 * import { clearTraces, waitForSpan } from 'autotel-devtools/testing';
 *
 * beforeEach(() => clearTraces());
 *
 * it('stores the order', async () => {
 *   await fetch(`${API}/orders`, { method: 'POST', headers: traceHeaders() });
 *   const span = await waitForSpan({ traceId, service: 'orders', name: /INSERT/ });
 *   expect(span.attributes['db.statement']).toContain('INSERT INTO orders');
 * });
 * ```
 */

import type { SpanData, TraceData } from '../server/types';

export type { SpanData, TraceData };

/** Where the receiver listens. Defaults to the devtools CLI's OTLP/HTTP port. */
export interface ReadbackOptions {
  /** Base URL of the receiver. Default `http://127.0.0.1:4318`. */
  endpoint?: string;
  /** Injected for tests; defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Aborts the request and the read of its body. */
  signal?: AbortSignal;
}

export interface SpanQuery {
  /** Only spans of this trace: the test's own trace id, to ignore other tests' traffic. */
  traceId?: string;
  /** Exact name, or a pattern. */
  name?: string | RegExp;
  /** `service.name` of the process that emitted the span. */
  service?: string;
  /** Every listed attribute must equal the span's value. */
  attributes?: Record<string, unknown>;
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:4318';

function base(options: ReadbackOptions | undefined): string {
  return (options?.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
}

/** Every span the receiver holds, across traces. */
export async function fetchSpans(
  options?: ReadbackOptions,
): Promise<SpanData[]> {
  const doFetch = options?.fetch ?? fetch;
  const res = await doFetch(`${base(options)}/v1/traces`, {
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!res.ok) {
    throw new Error(`GET ${base(options)}/v1/traces answered ${res.status}`);
  }
  const body = (await res.json()) as { traces?: TraceData[] };
  return (body.traces ?? []).flatMap((t) => t.spans);
}

/** Empty the receiver, so one test's spans never satisfy the next test's query. */
export async function clearTraces(options?: ReadbackOptions): Promise<void> {
  const doFetch = options?.fetch ?? fetch;
  const res = await doFetch(`${base(options)}/v1/traces`, {
    method: 'DELETE',
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!res.ok) {
    throw new Error(`DELETE ${base(options)}/v1/traces answered ${res.status}`);
  }
}

/** Equal scalars, or arrays with equal entries in order: decoded arrays are never the same object. */
function sameValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return (
      actual.length === expected.length &&
      actual.every((item, i) => item === expected[i])
    );
  }
  return actual === expected;
}

export function matchesSpan(span: SpanData, query: SpanQuery): boolean {
  if (query.traceId && span.traceId !== query.traceId.toLowerCase())
    return false;
  if (query.name !== undefined) {
    // A copy without the g and y flags: their lastIndex would make test() alternate.
    const ok =
      typeof query.name === 'string'
        ? span.name === query.name
        : new RegExp(
            query.name.source,
            query.name.flags.replace(/[gy]/g, ''),
          ).test(span.name);
    if (!ok) return false;
  }
  if (query.service && span.attributes['service.name'] !== query.service) {
    return false;
  }
  for (const [key, value] of Object.entries(query.attributes ?? {})) {
    if (!sameValue(span.attributes[key], value)) return false;
  }
  return true;
}

/** Spans the receiver holds now that match `query`. */
export async function findSpans(
  query: SpanQuery,
  options?: ReadbackOptions,
): Promise<SpanData[]> {
  return (await fetchSpans(options)).filter((span) => matchesSpan(span, query));
}

/**
 * Poll until a span matching `query` arrives, and return it.
 *
 * Exporters batch, so a span lands some time after the request that caused it
 * returned; polling is the honest wait. On timeout the error lists what the
 * trace did receive, which is usually the answer (a renamed span, a missing
 * attribute, a service that started its own trace).
 */
export async function waitForSpan(
  query: SpanQuery,
  options?: ReadbackOptions & { timeoutMs?: number; intervalMs?: number },
): Promise<SpanData> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const intervalMs = options?.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let spans: SpanData[] = [];
  let stalled = false;
  const caller = options?.signal;
  for (;;) {
    caller?.throwIfAborted();
    // The deadline bounds each request and the read of its body; the caller's signal still cancels.
    const deadlineSignal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
    try {
      spans = await fetchSpans({
        ...options,
        signal: caller ? AbortSignal.any([caller, deadlineSignal]) : deadlineSignal,
      });
    } catch (error) {
      if (caller?.aborted) throw caller.reason;
      if (!deadlineSignal.aborted) throw error;
      stalled = true;
      break;
    }
    const found = spans.find((span) => matchesSpan(span, query));
    if (found) return found;
    if (Date.now() >= deadline) break;
    await pause(Math.min(intervalMs, deadline - Date.now()), caller);
  }
  const miss = describeMiss(query, spans, timeoutMs);
  throw new Error(
    stalled
      ? `${miss}\nThe receiver at ${base(options)} did not answer within the deadline.`
      : miss,
  );
}

/** Wait `ms`, or reject with the caller's reason as soon as `signal` aborts. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function describeMiss(
  query: SpanQuery,
  spans: SpanData[],
  timeoutMs: number,
): string {
  const wanted = JSON.stringify(query, (_k, v) =>
    v instanceof RegExp ? v.toString() : v,
  );
  const inTrace = query.traceId
    ? spans.filter((s) => s.traceId === query.traceId!.toLowerCase())
    : spans;
  const seen = inTrace
    .slice(0, 20)
    .map((s) => `  ${s.attributes['service.name'] ?? '?'}: ${s.name}`);
  const scope = query.traceId ? `trace ${query.traceId}` : 'the receiver';
  const tail =
    inTrace.length === 0
      ? query.traceId && spans.length > 0
        ? `\n${scope} received nothing, but ${spans.length} span(s) arrived in other traces: did a hop drop traceparent?`
        : `\n${scope} received nothing.`
      : `\n${scope} received ${inTrace.length} span(s):\n${seen.join('\n')}${inTrace.length > 20 ? '\n  ...' : ''}`;
  return `No span matched ${wanted} within ${timeoutMs}ms.${tail}`;
}
