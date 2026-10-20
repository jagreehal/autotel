/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-known-value-widening, anti-slop/no-unsafe-dictionary-type -- Test helpers that build a Response from any JSON body the test wants to serve. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevtoolsBackend } from '../src/backends/devtools/index';

const BASE = 'http://localhost:4848';

interface DevtoolsSpanInput {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: string;
  startTime: number;
  endTime?: number;
  duration: number;
  attributes?: Record<string, unknown>;
  status?: { code: 'OK' | 'ERROR' | 'UNSET'; message?: string };
}

interface DevtoolsTraceInput {
  traceId: string;
  service: string;
  spans: DevtoolsSpanInput[];
}

function trace(input: DevtoolsTraceInput) {
  const spans = input.spans.map((s) => ({
    kind: 'INTERNAL' as const,
    endTime: s.startTime + s.duration,
    attributes: {},
    status: { code: 'UNSET' as const },
    ...s,
  }));
  return {
    traceId: input.traceId,
    service: input.service,
    rootSpan: spans[0],
    startTime: Math.min(...input.spans.map((s) => s.startTime)),
    endTime: Math.max(...input.spans.map((s) => s.endTime ?? s.startTime)),
    duration: 0,
    status: 'OK' as const,
    spans,
  };
}

/** Stub `GET /v1/traces` (and `/healthz`) with a fixed devtools payload. */
function stubFetch(traces: ReturnType<typeof trace>[]): string[] {
  const requests: string[] = [];
  // SAFETY: the code under test calls fetch(url) and reads a Response; this
  // returns a real Response, so no other part of the fetch surface is reached.
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (
    input: Parameters<typeof fetch>[0],
  ) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/healthz')) {
      return new Response(
        JSON.stringify({
          ok: true,
          service: 'autotel-devtools',
          version: '6.0.1',
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ traces, count: traces.length }), {
      status: 200,
    });
  }) as typeof fetch);
  return requests;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DevtoolsBackend', () => {
  it('kind is devtools', () => {
    expect(new DevtoolsBackend(BASE).kind).toBe('devtools');
  });

  it('exposes traces, metrics and logs as available', () => {
    expect(new DevtoolsBackend(BASE).capabilities()).toEqual({
      traces: 'available',
      metrics: 'available',
      logs: 'available',
    });
  });

  it('maps devtools traces to TraceRecord (ms timestamps, direct status)', () => {
    const backend = new DevtoolsBackend(BASE);
    const record = backend.toTraceRecord(
      trace({
        traceId: 't1',
        service: 'money-transfer',
        spans: [
          {
            traceId: 't1',
            spanId: 's1',
            name: 'sendMoney',
            startTime: 1700000000000,
            duration: 12.5,
            attributes: { 'transfer.amount': 100 },
            status: { code: 'OK' },
          },
        ],
      }),
    );

    expect(record.traceId).toBe('t1');
    expect(record.spans).toHaveLength(1);
    const span = record.spans[0]!;
    expect(span.operationName).toBe('sendMoney');
    expect(span.serviceName).toBe('money-transfer');
    expect(span.startTimeUnixMs).toBe(1700000000000);
    expect(span.durationMs).toBe(12.5);
    expect(span.statusCode).toBe('OK');
    expect(span.hasError).toBe(false);
    expect(span.tags['transfer.amount']).toBe(100);
  });

  it('sets parentSpanId to null when absent', () => {
    const backend = new DevtoolsBackend(BASE);
    const record = backend.toTraceRecord(
      trace({
        traceId: 't2',
        service: 'api',
        spans: [
          {
            traceId: 't2',
            spanId: 'root',
            name: 'root',
            startTime: 1,
            duration: 1,
          },
          {
            traceId: 't2',
            spanId: 'child',
            parentSpanId: 'root',
            name: 'child',
            startTime: 2,
            duration: 1,
          },
        ],
      }),
    );
    expect(record.spans[0]!.parentSpanId).toBeNull();
    expect(record.spans[1]!.parentSpanId).toBe('root');
  });

  it('honors explicit ERROR status from devtools', () => {
    const backend = new DevtoolsBackend(BASE);
    const record = backend.toTraceRecord(
      trace({
        traceId: 't3',
        service: 'api',
        spans: [
          {
            traceId: 't3',
            spanId: 's1',
            name: 'validate',
            startTime: 1,
            duration: 1,
            status: { code: 'ERROR', message: 'Invalid IBAN format' },
            attributes: {
              'transfer.recipient_iban': 'GB29b00mNWBK000000000001',
            },
          },
        ],
      }),
    );
    expect(record.spans[0]!.statusCode).toBe('ERROR');
    expect(record.spans[0]!.hasError).toBe(true);
  });

  it('infers ERROR from http.status_code when status is UNSET', () => {
    const backend = new DevtoolsBackend(BASE);
    const record = backend.toTraceRecord(
      trace({
        traceId: 't4',
        service: 'api',
        spans: [
          {
            traceId: 't4',
            spanId: 's1',
            name: 'GET /x',
            startTime: 1,
            duration: 1,
            status: { code: 'UNSET' },
            attributes: { 'http.status_code': 503 },
          },
        ],
      }),
    );
    expect(record.spans[0]!.statusCode).toBe('ERROR');
  });

  it('listServices derives services from captured traces', async () => {
    const backend = new DevtoolsBackend(BASE);
    stubFetch([
      trace({
        traceId: 'a',
        service: 'money-transfer',
        spans: [
          { traceId: 'a', spanId: '1', name: 'op', startTime: 1, duration: 1 },
        ],
      }),
      trace({
        traceId: 'b',
        service: 'rates-api',
        spans: [
          { traceId: 'b', spanId: '2', name: 'op', startTime: 1, duration: 1 },
        ],
      }),
    ]);
    const result = await backend.listServices();
    expect(result.services).toEqual(['money-transfer', 'rates-api']);
  });

  it('listOperations returns operation names for a service', async () => {
    const backend = new DevtoolsBackend(BASE);
    stubFetch([
      trace({
        traceId: 'a',
        service: 'money-transfer',
        spans: [
          {
            traceId: 'a',
            spanId: '1',
            name: 'sendMoney',
            startTime: 1,
            duration: 1,
          },
          {
            traceId: 'a',
            spanId: '2',
            name: 'validate',
            startTime: 2,
            duration: 1,
          },
        ],
      }),
    ]);
    const result = await backend.listOperations('money-transfer');
    expect(result.operations).toEqual(['sendMoney', 'validate']);
  });

  it('searchTraces filters by service and hasError', async () => {
    const backend = new DevtoolsBackend(BASE);
    stubFetch([
      trace({
        traceId: 'ok',
        service: 'money-transfer',
        spans: [
          {
            traceId: 'ok',
            spanId: '1',
            name: 'sendMoney',
            startTime: 1,
            duration: 1,
            status: { code: 'OK' },
          },
        ],
      }),
      trace({
        traceId: 'bad',
        service: 'money-transfer',
        spans: [
          {
            traceId: 'bad',
            spanId: '2',
            name: 'validate',
            startTime: 1,
            duration: 1,
            status: { code: 'ERROR' },
          },
        ],
      }),
    ]);
    const result = await backend.searchTraces({
      service: 'money-transfer',
      hasError: true,
    });
    expect(result.items.map((t) => t.traceId)).toEqual(['bad']);
  });

  it('getCorrelatedSignals keeps the trace when the log query fails', async () => {
    const body = trace({
      traceId: 'wanted',
      service: 'api',
      spans: [
        {
          traceId: 'wanted',
          spanId: '1',
          name: 'op',
          startTime: 1,
          duration: 1,
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      input: Parameters<typeof fetch>[0],
    ) =>
      String(input).endsWith('/api/query/logs')
        ? new Response('boom', { status: 500 })
        : Response.json({ traces: [body], count: 1 })) as typeof fetch);
    const signals = await new DevtoolsBackend(BASE).getCorrelatedSignals(
      'wanted',
    );
    expect(signals.trace?.traceId).toBe('wanted');
    expect(signals.logs).toEqual([]);
  });

  it('getTrace returns a single trace by id, null when missing', async () => {
    const backend = new DevtoolsBackend(BASE);
    stubFetch([
      trace({
        traceId: 'wanted',
        service: 'api',
        spans: [
          {
            traceId: 'wanted',
            spanId: '1',
            name: 'op',
            startTime: 1,
            duration: 1,
          },
        ],
      }),
    ]);
    expect((await backend.getTrace('wanted'))?.traceId).toBe('wanted');
    expect(await backend.getTrace('missing')).toBeNull();
  });

  it('healthCheck reports healthy when /healthz identifies autotel-devtools', async () => {
    const backend = new DevtoolsBackend(BASE);
    stubFetch([]);
    const health = await backend.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.message).toContain('autotel-devtools');
  });

  it('healthCheck names the URL it reached', async () => {
    // Two devtools on one machine (a stale one on 4318, the one the app
    // exports to on 4848) both answer "reachable", and a trace count alone
    // cannot say which one this is.
    const backend = new DevtoolsBackend(BASE);
    stubFetch([]);
    const health = await backend.healthCheck();
    expect(health.message).toContain(BASE);
  });

  it('healthCheck rejects a foreign collector squatting on the port', async () => {
    const backend = new DevtoolsBackend(BASE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ service: 'jaeger' }), { status: 200 }),
    );
    const health = await backend.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toContain('not autotel-devtools');
  });

  it('searchLogs pushes filters to the log store and maps records', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        logs: [
          {
            id: 'l1',
            timestamp: 1000,
            body: { msg: 'boom' },
            resourceName: 'checkout',
            severityText: 'ERROR',
            traceId: 't1',
            attributes: { 'order.id': 'o1' },
          },
        ],
        nextCursor: null,
      }),
    );
    const result = await new DevtoolsBackend(BASE).searchLogs({
      serviceName: 'checkout',
      severityText: 'ERROR',
      text: 'boom',
      startTimeUnixMs: 500,
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/api/query/logs`);
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'service = "checkout" AND severity = "ERROR" AND "boom"',
      limit: 100,
      window: { start: 500, end: Number.MAX_SAFE_INTEGER },
    });
    expect(result.items).toEqual([
      {
        timestampUnixMs: 1000,
        severityText: 'ERROR',
        body: '{"msg":"boom"}',
        serviceName: 'checkout',
        traceId: 't1',
        spanId: undefined,
        attributes: { 'order.id': 'o1' },
      },
    ]);
  });

  it('searchLogs and listMetrics report unsupported on a devtools without the APIs', async () => {
    const backend = new DevtoolsBackend(BASE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404 }),
    );
    const logs = await backend.searchLogs({});
    expect(logs.unsupported).toBe(true);
    expect(logs.detail).toContain('autotel-devtools');

    const metrics = await backend.listMetrics({});
    expect(metrics.unsupported).toBe(true);
    expect(metrics.detail).toContain('autotel-devtools');
  });
});

/**
 * Store-backed query API.
 *
 * A devtools with the store answers `POST /api/query/traces` and applies the
 * filter itself, over its whole retained history rather than the live tail.
 * The backend must use that path when it exists, fall back cleanly when it does
 * not, and — the sharp one — never mistake a legacy read-back response for a
 * filtered result, which would present unfiltered traces as query matches.
 */
describe('DevtoolsBackend — store-backed queries', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Stub a devtools that has the query API, recording what it was asked. */
  function stubQueryApi(traces: ReturnType<typeof trace>[]) {
    const bodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith('/healthz')) {
        return new Response(
          JSON.stringify({ ok: true, service: 'autotel-devtools' }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/query/traces')) {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        // The query shape: `nextCursor` present, no `count`.
        return new Response(JSON.stringify({ traces, nextCursor: null }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ traces, count: traces.length }), {
        status: 200,
      });
    }) as typeof fetch);
    return bodies;
  }

  const sample = [
    trace({
      traceId: 'bad',
      service: 'api',
      spans: [
        {
          traceId: 'bad',
          spanId: 's1',
          name: 'POST /orders',
          startTime: 1000,
          duration: 900,
          status: { code: 'ERROR' },
        },
      ],
    }),
  ];

  it('pushes the filter down as query text', async () => {
    const bodies = stubQueryApi(sample);
    await new DevtoolsBackend(BASE).searchTraces({
      service: 'api',
      hasError: true,
    });

    expect(bodies[0].query).toBe('service = "api"');
  });

  it('sends a bounded window when the query has one', async () => {
    const bodies = stubQueryApi(sample);
    await new DevtoolsBackend(BASE).searchTraces({
      startTimeUnixMs: 100,
      endTimeUnixMs: 200,
    });

    expect(bodies[0].window).toEqual({ start: 100, end: 200 });
  });

  it('omits the window when the query is unbounded', async () => {
    const bodies = stubQueryApi(sample);
    await new DevtoolsBackend(BASE).searchTraces({ service: 'api' });
    expect(bodies[0]).not.toHaveProperty('window');
  });

  it('returns candidates that also match canonical trace semantics', async () => {
    stubQueryApi(sample);
    const result = await new DevtoolsBackend(BASE).searchTraces({
      service: 'api',
      hasError: true,
    });
    expect(result.items.map((t) => t.traceId)).toEqual(['bad']);
  });

  it('applies a one-sided time bound after hydrating store candidates', async () => {
    stubQueryApi(sample);

    const result = await new DevtoolsBackend(BASE).searchTraces({
      startTimeUnixMs: 2_000,
    });

    expect(result.items).toEqual([]);
  });

  it('applies span duration bounds to spans rather than their trace', async () => {
    const mixedTrace = trace({
      traceId: 'mixed',
      service: 'api',
      spans: [
        {
          traceId: 'mixed',
          spanId: 'slow-root',
          name: 'request',
          startTime: 1_000,
          duration: 900,
        },
        {
          traceId: 'mixed',
          spanId: 'fast-child',
          parentSpanId: 'slow-root',
          name: 'lookup',
          startTime: 1_100,
          duration: 50,
        },
      ],
    });
    stubQueryApi([mixedTrace]);

    const result = await new DevtoolsBackend(BASE).searchSpans({
      spanMaxDurationMs: 100,
    });

    expect(result.items.map((item) => item.spanId)).toEqual(['fast-child']);
  });

  it('does not return sibling spans that miss a generic span filter', async () => {
    const mixedTrace = trace({
      traceId: 'mixed-tags',
      service: 'api',
      spans: [
        {
          traceId: 'mixed-tags',
          spanId: 'root',
          name: 'request',
          startTime: 1_000,
          duration: 100,
        },
        {
          traceId: 'mixed-tags',
          spanId: 'db',
          parentSpanId: 'root',
          name: 'query',
          startTime: 1_010,
          duration: 20,
          attributes: { 'db.system': 'postgresql' },
        },
      ],
    });
    stubQueryApi([mixedTrace]);

    const result = await new DevtoolsBackend(BASE).searchSpans({
      filters: [
        { field: 'db.system', operator: 'equals', value: 'postgresql' },
      ],
    });

    expect(result.items.map((item) => item.spanId)).toEqual(['db']);
  });

  it('finds an OK span inside a trace that also contains an error', async () => {
    const mixedTrace = trace({
      traceId: 'mixed-status',
      service: 'api',
      spans: [
        {
          traceId: 'mixed-status',
          spanId: 'root',
          name: 'request',
          startTime: 1_000,
          duration: 100,
          status: { code: 'ERROR' },
        },
        {
          traceId: 'mixed-status',
          spanId: 'ok-child',
          parentSpanId: 'root',
          name: 'cleanup',
          startTime: 1_080,
          duration: 10,
          status: { code: 'OK' },
        },
      ],
    });
    stubQueryApi([mixedTrace]);

    const result = await new DevtoolsBackend(BASE).searchSpans({
      statusCode: 'OK',
    });

    expect(result.items.map((item) => item.spanId)).toEqual(['ok-child']);
  });

  it('finds an in-window span when its trace started before the window', async () => {
    const crossingTrace = trace({
      traceId: 'crossing-window',
      service: 'api',
      spans: [
        {
          traceId: 'crossing-window',
          spanId: 'root',
          name: 'long request',
          startTime: 1_000,
          duration: 2_000,
        },
        {
          traceId: 'crossing-window',
          spanId: 'in-window',
          parentSpanId: 'root',
          name: 'late work',
          startTime: 2_500,
          duration: 20,
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        window?: unknown;
      };
      return new Response(
        JSON.stringify({
          traces: body.window ? [] : [crossingTrace],
          nextCursor: null,
        }),
        { status: 200 },
      );
    }) as typeof fetch);

    const result = await new DevtoolsBackend(BASE).searchSpans({
      startTimeUnixMs: 2_000,
      endTimeUnixMs: 2_800,
    });

    expect(result.items.map((item) => item.spanId)).toEqual(['in-window']);
  });

  it('applies minimum duration to the whole trace rather than each span', async () => {
    const longTrace = trace({
      traceId: 'long-trace',
      service: 'api',
      spans: [
        {
          traceId: 'long-trace',
          spanId: 'root',
          name: 'request',
          startTime: 1_000,
          duration: 100,
        },
        {
          traceId: 'long-trace',
          spanId: 'last',
          parentSpanId: 'root',
          name: 'finalize',
          startTime: 1_900,
          duration: 100,
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      const traces = body.query?.includes('duration >= 500') ? [] : [longTrace];
      return new Response(JSON.stringify({ traces, nextCursor: null }), {
        status: 200,
      });
    }) as typeof fetch);

    const result = await new DevtoolsBackend(BASE).searchTraces({
      minDurationMs: 500,
    });

    expect(result.items.map((item) => item.traceId)).toEqual(['long-trace']);
  });

  it('filters trace-level duration after the store returns span-selected candidates', async () => {
    const shortTrace = trace({
      traceId: 'short-trace',
      service: 'api',
      spans: [
        {
          traceId: 'short-trace',
          spanId: 'root',
          name: 'request',
          startTime: 1_000,
          duration: 100,
        },
      ],
    });
    stubQueryApi([shortTrace]);

    const result = await new DevtoolsBackend(BASE).searchTraces({
      minDurationMs: 500,
    });

    expect(result.items).toEqual([]);
  });

  it('continues through store pages when trace-level filters reject a page', async () => {
    const shortTrace = trace({
      traceId: 'short-trace',
      service: 'api',
      spans: [
        {
          traceId: 'short-trace',
          spanId: 'short',
          name: 'request',
          startTime: 1_000,
          duration: 100,
        },
      ],
    });
    const longTrace = trace({
      traceId: 'long-trace',
      service: 'api',
      spans: [
        {
          traceId: 'long-trace',
          spanId: 'root',
          name: 'request',
          startTime: 2_000,
          duration: 100,
        },
        {
          traceId: 'long-trace',
          spanId: 'last',
          parentSpanId: 'root',
          name: 'finalize',
          startTime: 2_900,
          duration: 100,
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        cursor?: string;
      };
      return new Response(
        JSON.stringify(
          body.cursor
            ? { traces: [longTrace], nextCursor: null }
            : { traces: [shortTrace], nextCursor: 'page-2' },
        ),
        { status: 200 },
      );
    }) as typeof fetch);

    const result = await new DevtoolsBackend(BASE).searchTraces({
      minDurationMs: 500,
      limit: 1,
    });

    expect(result.items.map((item) => item.traceId)).toEqual(['long-trace']);
  });

  it('treats a legacy read-back response as "no query API" rather than as results', async () => {
    // The read-back shape has `count` and no `nextCursor`. Accepting it here
    // would report unfiltered traces as query matches.
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      input: Parameters<typeof fetch>[0],
    ) => {
      const url = String(input);
      if (url.endsWith('/healthz')) {
        return new Response(
          JSON.stringify({ ok: true, service: 'autotel-devtools' }),
          { status: 200 },
        );
      }
      // Same body for both paths, as a squatting server or an old build would.
      return new Response(JSON.stringify({ traces: sample, count: 1 }), {
        status: 200,
      });
    }) as typeof fetch);

    const result = await new DevtoolsBackend(BASE).searchTraces({
      service: 'nope',
    });
    // Fell back to client-side filtering, which correctly excludes it.
    expect(result.items).toEqual([]);
  });

  it('stops retrying the query endpoint once it is known to be absent', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      input: Parameters<typeof fetch>[0],
    ) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/api/query/traces')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify({ traces: [], count: 0 }), {
        status: 200,
      });
    }) as typeof fetch);

    const backend = new DevtoolsBackend(BASE);
    await backend.searchTraces({});
    await backend.searchTraces({});

    // One probe, not one per query.
    expect(urls.filter((u) => u.endsWith('/api/query/traces'))).toHaveLength(1);
  });

  it('retries the query endpoint after a transient server failure', async () => {
    let queryAttempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      input: Parameters<typeof fetch>[0],
    ) => {
      const url = String(input);
      if (url.endsWith('/api/query/traces')) {
        queryAttempts++;
        if (queryAttempts === 1) {
          return new Response('temporary failure', { status: 500 });
        }
        return new Response(
          JSON.stringify({ traces: sample, nextCursor: null }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ traces: [], count: 0 }), {
        status: 200,
      });
    }) as typeof fetch);

    const backend = new DevtoolsBackend(BASE);
    await backend.searchTraces({});
    const recovered = await backend.searchTraces({});

    expect(recovered.items.map((item) => item.traceId)).toEqual(['bad']);
  });
});

describe('DevtoolsBackend — metrics', () => {
  afterEach(() => vi.restoreAllMocks());

  function stubMetrics(catalogue: unknown[], series: unknown[]) {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      input: Parameters<typeof fetch>[0],
    ) => {
      const url = String(input);
      if (url.endsWith('/api/metrics')) {
        return new Response(JSON.stringify({ metrics: catalogue }), {
          status: 200,
        });
      }
      if (url.endsWith('/api/query/metrics')) {
        return new Response(JSON.stringify({ series }), { status: 200 });
      }
      return new Response(JSON.stringify({ traces: [], count: 0 }), {
        status: 200,
      });
    }) as typeof fetch);
  }

  it('lists the catalogue as series shells', async () => {
    stubMetrics(
      [{ name: 'http.requests', kind: 'sum', unit: '1', seriesCount: 2 }],
      [],
    );
    const result = await new DevtoolsBackend(BASE).listMetrics();
    expect(result.items[0].metricName).toBe('http.requests');
    expect(result.items[0].points).toEqual([]);
  });

  it('filters the catalogue by name fragment', async () => {
    stubMetrics(
      [
        { name: 'http.requests', kind: 'sum', seriesCount: 1 },
        { name: 'db.queries', kind: 'sum', seriesCount: 1 },
      ],
      [],
    );
    const result = await new DevtoolsBackend(BASE).listMetrics({
      metricName: 'http',
    });
    expect(result.items.map((m) => m.metricName)).toEqual(['http.requests']);
  });

  it('says why rather than reporting an empty catalogue on an old devtools', async () => {
    // An empty list would read as "this service emits no metrics".
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (async () => new Response('not found', { status: 404 })) as typeof fetch,
    );

    const result = await new DevtoolsBackend(BASE).listMetrics();
    expect(result.unsupported).toBe(true);
    expect(result.detail).toMatch(/upgrade/i);
  });

  it('returns series points', async () => {
    stubMetrics(
      [],
      [
        {
          seriesId: 's1',
          name: 'http.requests',
          unit: '1',
          kind: 'sum',
          service: 'api',
          attributes: { 'http.method': 'GET' },
          points: [
            { timestamp: 1000, value: 3 },
            { timestamp: 2000, value: 5 },
          ],
        },
      ],
    );

    const series = await new DevtoolsBackend(BASE).getMetricSeries(
      'http.requests',
    );
    expect(series[0].points).toEqual([
      { timestampUnixMs: 1000, value: 3 },
      { timestampUnixMs: 2000, value: 5 },
    ]);
  });

  it('falls back to a histogram point count, which has no single value', async () => {
    stubMetrics(
      [],
      [
        {
          seriesId: 's1',
          name: 'http.duration',
          kind: 'histogram',
          service: 'api',
          attributes: {},
          points: [{ timestamp: 1000, count: 7, sum: 900 }],
        },
      ],
    );

    const series = await new DevtoolsBackend(BASE).getMetricSeries(
      'http.duration',
    );
    expect(series[0].points[0].value).toBe(7);
  });

  it('filters series by service', async () => {
    stubMetrics(
      [],
      [
        {
          seriesId: 'a',
          name: 'm',
          kind: 'sum',
          service: 'api',
          attributes: {},
          points: [],
        },
        {
          seriesId: 'b',
          name: 'm',
          kind: 'sum',
          service: 'worker',
          attributes: {},
          points: [],
        },
      ],
    );

    const series = await new DevtoolsBackend(BASE).getMetricSeries('m', {
      serviceName: 'worker',
    });
    expect(series).toHaveLength(1);
  });
});

/**
 * Every read goes to the store, not just search.
 *
 * The live tail (`GET /v1/traces`) is only what devtools still holds in
 * memory. A listing or a lookup that reads it disagrees with `searchTraces`,
 * which reads the store: `get_trace` would call a trace missing that the
 * summary tool can describe.
 */
describe('DevtoolsBackend: reads beyond the live tail', () => {
  afterEach(() => vi.restoreAllMocks());

  const stored = trace({
    traceId: 'old',
    service: 'api',
    spans: [
      {
        traceId: 'old',
        spanId: 's1',
        name: 'GET /orders',
        startTime: 1000,
        duration: 10,
      },
    ],
  });

  /** A store that holds `old`, a tail that has already dropped it. */
  function stubStore(routes: Record<string, () => Response> = {}) {
    const bodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      const path = new URL(String(input)).pathname;
      if (routes[path]) return routes[path]();
      if (path === '/api/query/traces') {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        return Response.json({ traces: [stored], nextCursor: null });
      }
      if (path === '/healthz')
        return Response.json({ ok: true, service: 'autotel-devtools' });
      return Response.json({ traces: [], count: 0 });
    }) as typeof fetch);
    return bodies;
  }

  it('getTrace finds a trace that has left the live tail', async () => {
    const bodies = stubStore();
    const found = await new DevtoolsBackend(BASE).getTrace('old');
    expect(found?.traceId).toBe('old');
    expect(bodies[0].query).toBe('trace_id = "old"');
  });

  it('listServices and listOperations read the store', async () => {
    const bodies = stubStore();
    const backend = new DevtoolsBackend(BASE);
    expect((await backend.listServices()).services).toEqual(['api']);
    expect((await backend.listOperations('api')).operations).toEqual([
      'GET /orders',
    ]);
    expect(bodies[1].query).toBe('service = "api"');
  });

  it('serviceMap pushes its lookback down as a window', async () => {
    const bodies = stubStore();
    const before = Date.now();
    await new DevtoolsBackend(BASE).serviceMap(15);
    const window = bodies[0].window as { start: number; end: number };
    expect(window.end - window.start).toBe(15 * 60_000);
    expect(window.end).toBeGreaterThanOrEqual(before);
  });

  it('healthCheck counts retained traces, not the tail', async () => {
    stubStore({ '/api/stats': () => Response.json({ traceCount: 4200 }) });
    const health = await new DevtoolsBackend(BASE).healthCheck();
    expect(health.message).toContain('4200 trace(s)');
  });

  it('a transient issues failure does not switch issue state off', async () => {
    let calls = 0;
    stubStore({
      '/api/issues': () =>
        ++calls === 1
          ? new Response('boom', { status: 500 })
          : Response.json({ issues: [] }),
    });
    const backend = new DevtoolsBackend(BASE);
    const query = { start: 0, end: 1, quietMs: 0 };
    expect(await backend.listIssues(query)).toBeUndefined();
    expect(await backend.listIssues(query)).toEqual([]);
  });

  it('a metrics failure is an error, not an empty answer', async () => {
    stubStore({
      '/api/query/metrics': () => new Response('boom', { status: 500 }),
      '/api/metrics': () => new Response('boom', { status: 500 }),
    });
    const backend = new DevtoolsBackend(BASE);
    await expect(backend.getMetricSeries('m')).rejects.toThrow();
    await expect(backend.listMetrics()).rejects.toThrow();
  });
});
