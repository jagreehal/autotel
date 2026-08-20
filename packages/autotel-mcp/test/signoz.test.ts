import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignozBackend } from '../src/backends/signoz/index';
import type { UnknownJson } from './helpers/fetch';
import {
  installFetch,
  recordedCall,
  requestBody,
  respondWith,
} from './helpers/fetch';

/** The parts of a SigNoz query-range request these tests assert on. */
interface SignozRequest {
  requestType: string;
  compositeQuery: {
    queries: Array<{
      type: string;
      spec: { signal: string; filter?: { expression?: string } };
    }>;
  };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const respond = (body: UnknownJson) => respondWith(body);

const backend = (apiKey = 'signoz-key') =>
  new SignozBackend({ baseUrl: 'https://signoz.example.com', apiKey });

const traceRows: UnknownJson[] = [
  {
    traceID: 'trace-1',
    spanID: 'span-root',
    name: 'GET /orders',
    serviceName: 'checkout',
    startTime: 1_785_500_000_000_000_000,
    durationNano: 250_000_000,
    statusCode: 0,
    attributes: { 'http.method': 'GET' },
  },
  {
    traceID: 'trace-1',
    spanID: 'span-child',
    parentSpanID: 'span-root',
    name: 'charge',
    serviceName: 'payments',
    startTime: 1_785_500_000_100_000_000,
    durationNano: 50_000_000,
    statusCode: 2,
  },
];

function queryResponse(rows: Array<UnknownJson>): UnknownJson {
  return {
    data: {
      type: 'raw',
      data: {
        results: [
          {
            queryName: 'A',
            rows: rows.map((data) => ({
              timestamp: '2026-07-31T11:33:20.000Z',
              data,
            })),
          },
        ],
      },
      meta: { bytesScanned: 0, durationMs: 1, rowsScanned: rows.length },
    },
  };
}

describe('SignozBackend', () => {
  it('declares traces available and the other signals unsupported', () => {
    expect(backend().capabilities()).toEqual({
      traces: 'available',
      metrics: 'unsupported',
      logs: 'unsupported',
    });
  });

  it('uses the v5 query endpoint with the API key', async () => {
    const fetchSpy = respond(queryResponse([]));
    installFetch(fetchSpy);

    await backend().listServices();

    const call = recordedCall(fetchSpy);
    expect(call.url).toBe('https://signoz.example.com/api/v5/query_range');
    expect(call.init.method).toBe('POST');
    expect(call.headers).toMatchObject({ 'SIGNOZ-API-KEY': 'signoz-key' });
    const body = requestBody<SignozRequest>(fetchSpy);
    expect(body.requestType).toBe('raw');
    expect(body.compositeQuery.queries[0].type).toBe('builder_query');
    expect(body.compositeQuery.queries[0].spec.signal).toBe('traces');
  });

  it('queries without an API key header for self-hosted instances', async () => {
    const fetchSpy = respond(queryResponse([]));
    installFetch(fetchSpy);

    await backend('').listServices();

    expect(recordedCall(fetchSpy).headers).not.toHaveProperty('SIGNOZ-API-KEY');
  });

  it('lists unique service names from v5 raw rows', async () => {
    installFetch(
      respond(
        queryResponse([
          { serviceName: 'checkout' },
          { serviceName: 'payments' },
          { serviceName: 'checkout' },
        ]),
      ),
    );

    await expect(backend().listServices()).resolves.toEqual({
      services: ['checkout', 'payments'],
    });
  });

  it('fetches a complete trace by id through the v5 query endpoint', async () => {
    const fetchSpy = respond(queryResponse(traceRows));
    installFetch(fetchSpy);

    const trace = await backend().getTrace('trace-1');

    expect(trace!.traceId).toBe('trace-1');
    expect(trace!.spans).toHaveLength(2);
    const request = requestBody<SignozRequest>(fetchSpy);
    expect(request.compositeQuery.queries[0]?.spec.filter?.expression).toBe(
      "trace_id = 'trace-1'",
    );
  });

  it('hydrates matching trace ids so service filters retain downstream spans', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => queryResponse([traceRows[0]!]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => queryResponse(traceRows),
      });
    installFetch(fetchSpy);

    const result = await backend().searchTraces({ service: 'checkout' });

    expect(result.items[0]!.spans.map((span) => span.serviceName)).toEqual([
      'checkout',
      'payments',
    ]);
  });

  it('converts nanosecond start and duration into ms', async () => {
    installFetch(respond(queryResponse(traceRows)));

    const trace = (await backend().getTrace('trace-1'))!;

    expect(trace.spans[0]!.startTimeUnixMs).toBe(1_785_500_000_000);
    expect(trace.spans[0]!.durationMs).toBe(250);
    expect(trace.spans[1]!.durationMs).toBe(50);
  });

  it('maps status and parent links', async () => {
    installFetch(respond(queryResponse(traceRows)));

    const trace = (await backend().getTrace('trace-1'))!;

    expect(trace.spans[0]!.parentSpanId).toBeNull();
    expect(trace.spans[1]!.parentSpanId).toBe('span-root');
    expect(trace.spans[0]!.statusCode).toBe('UNSET');
    expect(trace.spans[1]!.statusCode).toBe('ERROR');
  });

  it('returns null for a trace id with no spans', async () => {
    installFetch(respond(queryResponse([])));
    await expect(backend().getTrace('missing')).resolves.toBeNull();
  });

  it('reports metrics and logs as unsupported', async () => {
    expect((await backend().listMetrics()).unsupported).toBe(true);
    expect((await backend().searchLogs()).unsupported).toBe(true);
  });

  it('reports unhealthy instead of throwing when unreachable', async () => {
    installFetch(
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers(),
      }),
    );

    const health = await backend().healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toMatch(/502/);
  });
});
