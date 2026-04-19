import { afterEach, describe, expect, it } from 'vitest';
import { CompositeBackend } from '../src/backends/composite/index';
import type { TelemetryBackend } from '../src/backends/telemetry';
import type {
  BackendCapabilities,
  BackendHealth,
  TraceRecord,
  MetricSeries,
  LogRecord,
} from '../src/types';

function stubBackend(overrides: Partial<TelemetryBackend>): TelemetryBackend {
  const base: Partial<TelemetryBackend> = {
    kind: 'stub',
    healthCheck: async () =>
      ({ healthy: true, message: 'ok' }) as BackendHealth,
    capabilities: () =>
      ({
        traces: 'unsupported',
        metrics: 'unsupported',
        logs: 'unsupported',
      }) as BackendCapabilities,
    listServices: async () => ({ services: [] }),
    listOperations: async () => ({ operations: [] }),
    searchTraces: async () => ({ items: [], totalCount: 0 }),
    searchSpans: async () => ({ items: [], totalCount: 0 }),
    getTrace: async () => null,
    serviceMap: async () => ({ nodes: [], edges: [] }),
    summarizeTrace: async () => null,
    listMetrics: async () => ({ items: [], totalCount: 0 }),
    getMetricSeries: async () => [],
    searchLogs: async () => ({ items: [], totalCount: 0 }),
    getCorrelatedSignals: async () => ({
      trace: null,
      metrics: [],
      logs: [],
    }),
    ...overrides,
  };
  return base as TelemetryBackend;
}

describe('CompositeBackend', () => {
  it('throws when no sub-backend is provided', () => {
    expect(() => new CompositeBackend({})).toThrow();
  });

  it('capabilities reflect the union of sub-backend signals', () => {
    const traces = stubBackend({
      capabilities: () => ({
        traces: 'available',
        metrics: 'unsupported',
        logs: 'unsupported',
      }),
    });
    const metrics = stubBackend({
      capabilities: () => ({
        traces: 'unsupported',
        metrics: 'available',
        logs: 'unsupported',
      }),
    });
    const composite = new CompositeBackend({ traces, metrics });
    expect(composite.capabilities()).toEqual({
      traces: 'available',
      metrics: 'available',
      logs: 'unsupported',
    });
  });

  it('routes getTrace / listMetrics / searchLogs to the matching sub-backend', async () => {
    const trace: TraceRecord = { traceId: 't1', spans: [] };
    const metricSeries: MetricSeries = {
      metricName: 'foo',
      points: [],
    };
    const log: LogRecord = {
      timestampUnixMs: 1,
      severityText: 'ERROR',
      body: 'boom',
    };
    const traces = stubBackend({ getTrace: async () => trace });
    const metrics = stubBackend({
      listMetrics: async () => ({ items: [metricSeries], totalCount: 1 }),
    });
    const logs = stubBackend({
      searchLogs: async () => ({ items: [log], totalCount: 1 }),
    });
    const composite = new CompositeBackend({ traces, metrics, logs });

    expect(await composite.getTrace('t1')).toBe(trace);
    expect((await composite.listMetrics({})).items).toEqual([metricSeries]);
    expect((await composite.searchLogs({})).items).toEqual([log]);
  });

  it('listServices unions services across sub-backends', async () => {
    const traces = stubBackend({
      listServices: async () => ({ services: ['api'] }),
    });
    const logs = stubBackend({
      listServices: async () => ({ services: ['api', 'worker'] }),
    });
    const result = await new CompositeBackend({
      traces,
      logs,
    }).listServices();
    expect(result.services).toEqual(['api', 'worker']);
  });

  it('searchTraces reports unsupported when no traces backend is wired', async () => {
    const metrics = stubBackend({
      capabilities: () => ({
        traces: 'unsupported',
        metrics: 'available',
        logs: 'unsupported',
      }),
    });
    const composite = new CompositeBackend({ metrics });
    const result = await composite.searchTraces({});
    expect(result.unsupported).toBe(true);
    expect(result.detail).toContain('No traces backend');
  });

  it('getCorrelatedSignals gathers trace + logs + per-service metrics', async () => {
    const traceRecord: TraceRecord = {
      traceId: 't1',
      spans: [
        {
          traceId: 't1',
          spanId: 's1',
          parentSpanId: null,
          operationName: 'op',
          serviceName: 'orders',
          startTimeUnixMs: 1,
          durationMs: 1,
          tags: {},
          hasError: false,
          statusCode: 'OK',
        },
      ],
    };
    const traces = stubBackend({ getTrace: async () => traceRecord });
    const metrics = stubBackend({
      listMetrics: async ({ serviceName } = {}) => ({
        items: [{ metricName: `${serviceName ?? 'all'}_requests`, points: [] }],
        totalCount: 1,
      }),
    });
    const logs = stubBackend({
      searchLogs: async () => ({
        items: [
          { timestampUnixMs: 1, severityText: 'INFO', body: 'hi' },
        ] as LogRecord[],
        totalCount: 1,
      }),
    });
    const composite = new CompositeBackend({ traces, metrics, logs });
    const result = await composite.getCorrelatedSignals('t1');

    expect(result.trace).toBe(traceRecord);
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0]?.metricName).toBe('orders_requests');
    expect(result.logs).toHaveLength(1);
  });
});
