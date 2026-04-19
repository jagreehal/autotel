import { describe, expect, it } from 'vitest';
import { JaegerBackend } from '../src/backends/jaeger/index';

describe('JaegerBackend', () => {
  it('normalizes trace records from Jaeger payloads', () => {
    const backend = new JaegerBackend('http://localhost:16686');
    const trace = backend.toTraceRecord({
      traceID: 'trace-1',
      processes: {
        p1: { serviceName: 'checkout' },
      },
      spans: [
        {
          traceID: 'trace-1',
          spanID: 'span-1',
          parentSpanID: undefined,
          operationName: 'GET /checkout',
          processID: 'p1',
          startTime: 1_000_000,
          duration: 250_000,
          tags: [
            { key: 'error', type: 'bool', value: true },
            { key: 'status.code', type: 'string', value: 'ERROR' },
          ],
        },
      ],
    });

    expect(trace.traceId).toBe('trace-1');
    expect(trace.spans[0]?.serviceName).toBe('checkout');
    expect(trace.spans[0]?.statusCode).toBe('ERROR');
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0]?.durationMs).toBe(250);
  });

  it('sets parentSpanId to null when not present', () => {
    const backend = new JaegerBackend('http://localhost:16686');
    const trace = backend.toTraceRecord({
      traceID: 'trace-2',
      processes: { p1: { serviceName: 'api' } },
      spans: [
        {
          traceID: 'trace-2',
          spanID: 'root-span',
          operationName: 'root',
          processID: 'p1',
          startTime: 1_000_000,
          duration: 100_000,
        },
      ],
    });

    expect(trace.spans[0]?.parentSpanId).toBeNull();
  });

  it('infers error status from http.status_code tag', () => {
    const backend = new JaegerBackend('http://localhost:16686');
    const trace = backend.toTraceRecord({
      traceID: 'trace-3',
      processes: { p1: { serviceName: 'web' } },
      spans: [
        {
          traceID: 'trace-3',
          spanID: 'span-3',
          operationName: 'GET /error',
          processID: 'p1',
          startTime: 1_000_000,
          duration: 50_000,
          tags: [{ key: 'http.status_code', type: 'int', value: 500 }],
        },
      ],
    });

    expect(trace.spans[0]?.statusCode).toBe('ERROR');
    expect(trace.spans[0]?.hasError).toBe(true); // inferred from statusCode === ERROR
  });

  it('exposes backend capabilities with traces available', () => {
    const backend = new JaegerBackend('http://localhost:16686');
    const capabilities = backend.capabilities();
    expect(capabilities.traces).toBe('available');
    expect(capabilities.metrics).toBe('unsupported');
    expect(capabilities.logs).toBe('unsupported');
  });

  it('listMetrics returns unsupported result', async () => {
    const backend = new JaegerBackend('http://localhost:16686');
    const metrics = await backend.listMetrics({});
    expect(metrics.unsupported).toBe(true);
    expect(metrics.items).toHaveLength(0);
    expect(metrics.totalCount).toBe(0);
    expect(metrics.detail).toContain('Jaeger');
  });

  it('searchLogs returns unsupported result', async () => {
    const backend = new JaegerBackend('http://localhost:16686');
    const logs = await backend.searchLogs({});
    expect(logs.unsupported).toBe(true);
    expect(logs.items).toHaveLength(0);
    expect(logs.totalCount).toBe(0);
    expect(logs.detail).toContain('Jaeger');
  });

  it('getMetricSeries returns empty array', async () => {
    const backend = new JaegerBackend('http://localhost:16686');
    const series = await backend.getMetricSeries('some.metric');
    expect(series).toEqual([]);
  });

  it('serviceMap respects the requested limit', async () => {
    const backend = new JaegerBackend('http://localhost:16686');
    (backend as any).searchTraces = async () => ({
      items: [
        {
          traceId: 'trace-1',
          spans: [
            {
              traceId: 'trace-1',
              spanId: 'root',
              parentSpanId: null,
              operationName: 'checkout.request',
              serviceName: 'checkout',
              startTimeUnixMs: 1,
              durationMs: 100,
              statusCode: 'OK',
              tags: {},
              hasError: false,
            },
            {
              traceId: 'trace-1',
              spanId: 'child',
              parentSpanId: 'root',
              operationName: 'payments.charge',
              serviceName: 'payments',
              startTimeUnixMs: 5,
              durationMs: 50,
              statusCode: 'OK',
              tags: {},
              hasError: false,
            },
          ],
        },
      ],
      totalCount: 1,
    });

    const map = await backend.serviceMap(60, 1);
    expect(map.nodes.length).toBeLessThanOrEqual(1);
  });

  it('searchSpans supports aggregate trace filters', async () => {
    const backend = new JaegerBackend('http://localhost:16686');
    (backend as any).searchTraces = async () => ({
      items: [
        {
          traceId: 'trace-1',
          spans: [
            {
              traceId: 'trace-1',
              spanId: 'root',
              parentSpanId: null,
              operationName: 'checkout.request',
              serviceName: 'checkout',
              startTimeUnixMs: 1,
              durationMs: 100,
              statusCode: 'OK',
              tags: {},
              hasError: false,
            },
            {
              traceId: 'trace-1',
              spanId: 'child',
              parentSpanId: 'root',
              operationName: 'payments.charge',
              serviceName: 'payments',
              startTimeUnixMs: 5,
              durationMs: 50,
              statusCode: 'OK',
              tags: {},
              hasError: false,
            },
          ],
        },
      ],
      totalCount: 1,
    });

    const result = await backend.searchSpans({
      service: 'checkout',
      filters: [
        {
          field: 'span_count',
          operator: 'equals',
          valueType: 'number',
          value: 2,
        },
      ],
    });

    expect(result.items.length).toBeGreaterThan(0);
  });

  it('kind is jaeger', () => {
    const backend = new JaegerBackend('http://localhost:16686');
    expect(backend.kind).toBe('jaeger');
  });

  it('searchTraces with hasError over-fetches without sending tags (Jaeger cannot index bool error tag)', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      requests.push(url);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const backend = new JaegerBackend('http://localhost:16686');
      await backend.searchTraces({ service: 'api', hasError: true, limit: 5 });
      expect(requests).toHaveLength(1);
      const url = new URL(requests[0]!);
      // No `tags` param — bool error tags aren't searchable in Jaeger.
      expect(url.searchParams.get('tags')).toBeNull();
      // Over-fetch: client asked for 5, server should be asked for 50.
      expect(url.searchParams.get('limit')).toBe('50');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('searchTraces forwards explicit time window as Jaeger start/end (μs)', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(typeof input === 'string' ? input : input.toString());
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const backend = new JaegerBackend('http://localhost:16686');
      await backend.searchTraces({
        service: 'api',
        startTimeUnixMs: 1_700_000_000_000,
        endTimeUnixMs: 1_700_000_300_000,
      });
      const url = new URL(requests[0]!);
      expect(url.searchParams.get('lookback')).toBeNull();
      expect(url.searchParams.get('start')).toBe('1700000000000000');
      expect(url.searchParams.get('end')).toBe('1700000300000000');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('searchTraces defaults to 60m lookback when no time window is given', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(typeof input === 'string' ? input : input.toString());
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const backend = new JaegerBackend('http://localhost:16686');
      await backend.searchTraces({ service: 'api' });
      const url = new URL(requests[0]!);
      expect(url.searchParams.get('lookback')).toBe('60m');
      expect(url.searchParams.get('start')).toBeNull();
      expect(url.searchParams.get('end')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('searchTraces forwards min/max duration as Jaeger ms strings', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(typeof input === 'string' ? input : input.toString());
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const backend = new JaegerBackend('http://localhost:16686');
      await backend.searchTraces({
        service: 'api',
        minDurationMs: 100,
        maxDurationMs: 2000,
      });
      const url = new URL(requests[0]!);
      expect(url.searchParams.get('minDuration')).toBe('100ms');
      expect(url.searchParams.get('maxDuration')).toBe('2000ms');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('searchTraces filters hasError client-side from inferred error spans', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              traceID: 'ok-trace',
              processes: { p1: { serviceName: 'api' } },
              spans: [
                {
                  traceID: 'ok-trace',
                  spanID: 's1',
                  operationName: 'GET /',
                  processID: 'p1',
                  startTime: 1_000_000,
                  duration: 1_000,
                  tags: [{ key: 'http.status_code', type: 'int', value: 200 }],
                },
              ],
            },
            {
              traceID: 'err-trace',
              processes: { p1: { serviceName: 'api' } },
              spans: [
                {
                  traceID: 'err-trace',
                  spanID: 's2',
                  operationName: 'POST /x',
                  processID: 'p1',
                  startTime: 1_000_000,
                  duration: 2_000,
                  tags: [{ key: 'error', type: 'bool', value: true }],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;

    try {
      const backend = new JaegerBackend('http://localhost:16686');
      const result = await backend.searchTraces({
        service: 'api',
        hasError: true,
      });
      expect(result.items.map((t) => t.traceId)).toEqual(['err-trace']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('serviceMap fans out per-service so every service contributes traces', async () => {
    const backend = new JaegerBackend('http://localhost:16686');
    (backend as any).listServices = async () => ({
      services: ['chatty', 'quiet'],
    });
    (backend as any).searchTraces = async ({
      service,
    }: {
      service: string;
    }) => {
      if (service === 'chatty') {
        return {
          items: Array.from({ length: 25 }, (_, i) => ({
            traceId: `chatty-${i}`,
            spans: [
              {
                traceId: `chatty-${i}`,
                spanId: `cs-${i}`,
                parentSpanId: null,
                operationName: 'op',
                serviceName: 'chatty',
                startTimeUnixMs: 1,
                durationMs: 1,
                statusCode: 'OK' as const,
                tags: {},
                hasError: false,
              },
            ],
          })),
          totalCount: 25,
        };
      }
      return {
        items: [
          {
            traceId: 'quiet-1',
            spans: [
              {
                traceId: 'quiet-1',
                spanId: 'qs-1',
                parentSpanId: null,
                operationName: 'op',
                serviceName: 'quiet',
                startTimeUnixMs: 1,
                durationMs: 1,
                statusCode: 'OK' as const,
                tags: {},
                hasError: false,
              },
            ],
          },
        ],
        totalCount: 1,
      };
    };

    const map = await backend.serviceMap(60, 20);
    const services = map.nodes.map((n) => n.service).sort();
    expect(services).toEqual(['chatty', 'quiet']);
  });
});
