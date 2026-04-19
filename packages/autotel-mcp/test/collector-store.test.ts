import { describe, it, expect, beforeEach } from 'vitest';
import { CollectorStore } from '../src/backends/collector/store';

describe('CollectorStore', () => {
  let store: CollectorStore;

  beforeEach(async () => {
    store = new CollectorStore({ maxTraces: 100, retentionMs: 3_600_000 });
    await store.init();
  });

  it('inserts and retrieves a span', async () => {
    await store.insertSpans([
      {
        traceId: 't1',
        spanId: 's1',
        parentSpanId: null,
        operationName: 'GET /api',
        serviceName: 'web',
        startTimeUnixMs: Date.now(),
        durationMs: 100,
        statusCode: 'OK',
        tags: { 'http.method': 'GET' },
        hasError: false,
      },
    ]);
    const trace = await store.getTrace('t1');
    expect(trace).not.toBeNull();
    expect(trace!.spans).toHaveLength(1);
    expect(trace!.spans[0].operationName).toBe('GET /api');
  });

  it('lists discovered services', async () => {
    await store.insertSpans([
      {
        traceId: 't1',
        spanId: 's1',
        parentSpanId: null,
        operationName: 'op',
        serviceName: 'svc-a',
        startTimeUnixMs: Date.now(),
        durationMs: 50,
        statusCode: 'OK',
        tags: {},
        hasError: false,
      },
      {
        traceId: 't2',
        spanId: 's2',
        parentSpanId: null,
        operationName: 'op',
        serviceName: 'svc-b',
        startTimeUnixMs: Date.now(),
        durationMs: 50,
        statusCode: 'OK',
        tags: {},
        hasError: false,
      },
    ]);
    const result = await store.listServices();
    expect(result.services).toContain('svc-a');
    expect(result.services).toContain('svc-b');
  });

  it('inserts and retrieves metrics', async () => {
    await store.insertMetrics([
      {
        metricName: 'http.duration',
        unit: 'ms',
        points: [{ timestampUnixMs: Date.now(), value: 150 }],
        attributes: { 'service.name': 'web' },
      },
    ]);
    const result = await store.listMetrics({});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].metricName).toBe('http.duration');
  });

  it('inserts and retrieves logs', async () => {
    await store.insertLogs([
      {
        timestampUnixMs: Date.now(),
        severityText: 'ERROR',
        body: 'connection refused',
        serviceName: 'web',
        traceId: 't1',
      },
    ]);
    const result = await store.searchLogs({ traceId: 't1' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].body).toBe('connection refused');
  });

  it('evicts oldest traces when at capacity', async () => {
    const smallStore = new CollectorStore({
      maxTraces: 2,
      retentionMs: 3_600_000,
    });
    await smallStore.init();
    for (let i = 0; i < 3; i++) {
      await smallStore.insertSpans([
        {
          traceId: `t${i}`,
          spanId: `s${i}`,
          parentSpanId: null,
          operationName: 'op',
          serviceName: 'svc',
          startTimeUnixMs: Date.now() + i * 1000,
          durationMs: 50,
          statusCode: 'OK',
          tags: {},
          hasError: false,
        },
      ]);
    }
    expect(await smallStore.getTrace('t0')).toBeNull();
    expect(await smallStore.getTrace('t2')).not.toBeNull();
  });
});
