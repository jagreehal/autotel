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
  return {
    traceId: input.traceId,
    service: input.service,
    rootSpan: input.spans[0],
    startTime: Math.min(...input.spans.map((s) => s.startTime)),
    endTime: Math.max(...input.spans.map((s) => s.endTime ?? s.startTime)),
    duration: 0,
    status: 'OK' as const,
    spans: input.spans.map((s) => ({
      kind: 'INTERNAL' as const,
      endTime: s.startTime + s.duration,
      attributes: {},
      status: { code: 'UNSET' as const },
      ...s,
    })),
  };
}

/** Stub `GET /v1/traces` (and `/healthz`) with a fixed devtools payload. */
function stubFetch(traces: ReturnType<typeof trace>[]): string[] {
  const requests: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (
    input: RequestInfo | URL,
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    requests.push(url);
    if (url.endsWith('/healthz')) {
      return new Response(
        JSON.stringify({ ok: true, service: 'autotel-devtools', version: '6.0.1' }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ traces, count: traces.length }),
      { status: 200 },
    );
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

  it('exposes traces available, metrics/logs unsupported', () => {
    const caps = new DevtoolsBackend(BASE).capabilities();
    expect(caps.traces).toBe('available');
    expect(caps.metrics).toBe('unsupported');
    expect(caps.logs).toBe('unsupported');
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
          { traceId: 't2', spanId: 'root', name: 'root', startTime: 1, duration: 1 },
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
            attributes: { 'transfer.recipient_iban': 'GB29b00mNWBK000000000001' },
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
        spans: [{ traceId: 'a', spanId: '1', name: 'op', startTime: 1, duration: 1 }],
      }),
      trace({
        traceId: 'b',
        service: 'rates-api',
        spans: [{ traceId: 'b', spanId: '2', name: 'op', startTime: 1, duration: 1 }],
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
          { traceId: 'a', spanId: '1', name: 'sendMoney', startTime: 1, duration: 1 },
          { traceId: 'a', spanId: '2', name: 'validate', startTime: 2, duration: 1 },
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

  it('getTrace returns a single trace by id, null when missing', async () => {
    const backend = new DevtoolsBackend(BASE);
    stubFetch([
      trace({
        traceId: 'wanted',
        service: 'api',
        spans: [{ traceId: 'wanted', spanId: '1', name: 'op', startTime: 1, duration: 1 }],
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

  it('healthCheck rejects a foreign collector squatting on the port', async () => {
    const backend = new DevtoolsBackend(BASE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ service: 'jaeger' }), { status: 200 }),
    );
    const health = await backend.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toContain('not autotel-devtools');
  });

  it('listMetrics and searchLogs report unsupported', async () => {
    const backend = new DevtoolsBackend(BASE);
    const metrics = await backend.listMetrics({});
    const logs = await backend.searchLogs({});
    expect(metrics.unsupported).toBe(true);
    expect(metrics.detail).toContain('autotel-devtools');
    expect(logs.unsupported).toBe(true);
    expect(logs.detail).toContain('autotel-devtools');
  });
});
