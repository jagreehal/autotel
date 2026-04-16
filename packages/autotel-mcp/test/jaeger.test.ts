import { describe, expect, it } from 'vitest';
import { JaegerBackend } from '../src/backends/jaeger/index.js';

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
});
