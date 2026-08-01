import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignozBackend } from '../src/backends/signoz/index';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const respond = (body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  });

const backend = (apiKey = 'signoz-key') =>
  new SignozBackend({ baseUrl: 'https://signoz.example.com', apiKey });

const traceResponse = {
  data: [
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
  ],
};

describe('SignozBackend', () => {
  it('declares traces available and the other signals unsupported', () => {
    expect(backend().capabilities()).toEqual({
      traces: 'available',
      metrics: 'unsupported',
      logs: 'unsupported',
    });
  });

  it('sends the SigNoz API key header when one is configured', async () => {
    const fetchSpy = respond({ data: [] });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await backend().listServices();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'SIGNOZ-API-KEY': 'signoz-key' });
  });

  // Self-hosted SigNoz commonly runs unauthenticated on a private network, so
  // an absent key must not be treated as a configuration error.
  it('queries without an API key header when none is configured', async () => {
    const fetchSpy = respond({ data: [] });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await backend('').listServices();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('SIGNOZ-API-KEY');
  });

  it('lists service names', async () => {
    globalThis.fetch = respond({
      data: [{ serviceName: 'checkout' }, { serviceName: 'payments' }],
    }) as unknown as typeof fetch;

    await expect(backend().listServices()).resolves.toEqual({
      services: ['checkout', 'payments'],
    });
  });

  it('fetches a trace by id and groups its spans', async () => {
    const fetchSpy = respond(traceResponse);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const trace = await backend().getTrace('trace-1');

    expect(fetchSpy.mock.calls[0]![0]).toBe(
      'https://signoz.example.com/api/v1/traces/trace-1',
    );
    expect(trace!.traceId).toBe('trace-1');
    expect(trace!.spans).toHaveLength(2);
    expect(trace!.spans[0]!.serviceName).toBe('checkout');
    expect(trace!.spans[0]!.operationName).toBe('GET /orders');
  });

  it('converts nanosecond start and duration into ms', async () => {
    globalThis.fetch = respond(traceResponse) as unknown as typeof fetch;

    const trace = (await backend().getTrace('trace-1'))!;

    expect(trace.spans[0]!.startTimeUnixMs).toBe(1_785_500_000_000);
    expect(trace.spans[0]!.durationMs).toBe(250);
    expect(trace.spans[1]!.durationMs).toBe(50);
  });

  // SigNoz uses the OTLP numeric status: 0 unset, 1 ok, 2 error.
  it('maps the numeric OTLP status code onto span status', async () => {
    globalThis.fetch = respond(traceResponse) as unknown as typeof fetch;

    const trace = (await backend().getTrace('trace-1'))!;

    expect(trace.spans[0]!.statusCode).toBe('UNSET');
    expect(trace.spans[0]!.hasError).toBe(false);
    expect(trace.spans[1]!.statusCode).toBe('ERROR');
    expect(trace.spans[1]!.hasError).toBe(true);
  });

  it('maps parent links, leaving the root parent null', async () => {
    globalThis.fetch = respond(traceResponse) as unknown as typeof fetch;

    const trace = (await backend().getTrace('trace-1'))!;

    expect(trace.spans[0]!.parentSpanId).toBeNull();
    expect(trace.spans[1]!.parentSpanId).toBe('span-root');
  });

  it('returns null for a trace id with no spans', async () => {
    globalThis.fetch = respond({ data: [] }) as unknown as typeof fetch;
    await expect(backend().getTrace('missing')).resolves.toBeNull();
  });

  it('reports metrics and logs as unsupported', async () => {
    expect((await backend().listMetrics()).unsupported).toBe(true);
    expect((await backend().searchLogs()).unsupported).toBe(true);
  });

  it('reports unhealthy instead of throwing when unreachable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: new Headers(),
    }) as unknown as typeof fetch;

    const health = await backend().healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toMatch(/502/);
  });
});
