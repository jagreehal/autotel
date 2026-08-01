import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DatadogBackend,
  resolveDatadogBaseUrl,
} from '../src/backends/datadog/index';

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

const backend = () =>
  new DatadogBackend({
    baseUrl: 'https://api.datadoghq.com',
    apiKey: 'dd-api',
    appKey: 'dd-app',
  });

const searchResponse = {
  data: [
    {
      id: 'ev-1',
      type: 'spans',
      attributes: {
        trace_id: 'trace-1',
        span_id: 'span-root',
        service: 'checkout',
        resource_name: 'POST /orders',
        start: '1785500000000000000',
        duration: 250_000_000,
        status: 'ok',
        tags: { env: 'prod' },
      },
    },
    {
      id: 'ev-2',
      type: 'spans',
      attributes: {
        trace_id: 'trace-1',
        span_id: 'span-child',
        parent_id: 'span-root',
        service: 'payments',
        resource_name: 'charge',
        start: '1785500000100000000',
        duration: 50_000_000,
        status: 'error',
      },
    },
  ],
};

describe('DatadogBackend', () => {
  it('declares traces available and the other signals unsupported', () => {
    expect(backend().capabilities()).toEqual({
      traces: 'available',
      metrics: 'unsupported',
      logs: 'unsupported',
    });
  });

  it('requires both the API key and the application key', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const missingAppKey = new DatadogBackend({
      baseUrl: 'https://api.datadoghq.com',
      apiKey: 'dd-api',
      appKey: '',
    });
    await expect(missingAppKey.listServices()).rejects.toThrow(
      /application key/i,
    );
  });

  it('sends both Datadog auth headers', async () => {
    const fetchSpy = respond({ data: [] });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await backend().listServices();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'DD-API-KEY': 'dd-api',
      'DD-APPLICATION-KEY': 'dd-app',
    });
  });

  it('groups spans into traces by trace_id', async () => {
    globalThis.fetch = respond(searchResponse) as unknown as typeof fetch;

    const result = await backend().searchTraces({ limit: 10 });

    expect(result.items).toHaveLength(1);
    const trace = result.items[0]!;
    expect(trace.traceId).toBe('trace-1');
    expect(trace.spans).toHaveLength(2);
    expect(trace.spans[0]!.serviceName).toBe('checkout');
    expect(trace.spans[0]!.operationName).toBe('POST /orders');
    expect(trace.spans[0]!.parentSpanId).toBeNull();
    expect(trace.spans[1]!.parentSpanId).toBe('span-root');
  });

  it('converts nanosecond start and duration into ms', async () => {
    globalThis.fetch = respond(searchResponse) as unknown as typeof fetch;

    const trace = (await backend().searchTraces({})).items[0]!;

    expect(trace.spans[0]!.startTimeUnixMs).toBe(1_785_500_000_000);
    expect(trace.spans[0]!.durationMs).toBe(250);
  });

  // Datadog's `start` is documented inconsistently across span shapes; accept
  // an ISO string as well as epoch nanoseconds so timestamps never silently
  // become garbage.
  it('also accepts an ISO start timestamp', async () => {
    globalThis.fetch = respond({
      data: [
        {
          attributes: {
            trace_id: 't',
            span_id: 's',
            service: 'api',
            resource_name: 'GET /',
            start: '2026-07-27T21:53:20.000Z',
            duration: 1_000_000,
          },
        },
      ],
    }) as unknown as typeof fetch;

    const trace = (await backend().searchTraces({})).items[0]!;
    expect(trace.spans[0]!.startTimeUnixMs).toBe(
      Date.parse('2026-07-27T21:53:20.000Z'),
    );
  });

  it('maps the error status onto the span', async () => {
    globalThis.fetch = respond(searchResponse) as unknown as typeof fetch;

    const trace = (await backend().searchTraces({})).items[0]!;

    expect(trace.spans[0]!.hasError).toBe(false);
    expect(trace.spans[0]!.statusCode).toBe('OK');
    expect(trace.spans[1]!.hasError).toBe(true);
    expect(trace.spans[1]!.statusCode).toBe('ERROR');
  });

  it('builds a service and error filter query', async () => {
    const fetchSpy = respond({ data: [] });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await backend().searchTraces({ service: 'checkout', hasError: true });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.data.attributes.filter.query).toBe(
      'service:checkout status:error',
    );
  });

  // A search with no `from`/`to` falls back to Datadog's short default window,
  // so an older trace looked up by id would silently come back empty.
  it('bounds a trace lookup with an explicit time window', async () => {
    const fetchSpy = respond({ data: [] });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await backend().getTrace('trace-1');

    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.data.attributes.filter.query).toBe('trace_id:trace-1');
    expect(Number.isNaN(Date.parse(body.data.attributes.filter.from))).toBe(
      false,
    );
    expect(Number.isNaN(Date.parse(body.data.attributes.filter.to))).toBe(
      false,
    );
  });

  it('reports metrics and logs as unsupported', async () => {
    expect((await backend().listMetrics()).unsupported).toBe(true);
    expect((await backend().searchLogs()).unsupported).toBe(true);
  });

  // A bare site is the natural thing to configure — it is what Datadog's own
  // DD_SITE holds — and feeding it to `new URL()` produced a bare "Invalid URL"
  // that named neither the variable nor the fix.
  it('accepts a bare Datadog site and reaches the API host', async () => {
    const fetchSpy = respond({ data: [] });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await new DatadogBackend({
      baseUrl: 'datadoghq.eu',
      apiKey: 'dd-api',
      appKey: 'dd-app',
    }).listServices();

    expect(fetchSpy.mock.calls[0]![0]).toBe(
      'https://api.datadoghq.eu/api/v2/services',
    );
  });

  // Credentials are checked before the URL is built, so a config with BOTH
  // problems reports the one the user has to fix rather than a URL parse error.
  it('reports the missing application key even when the site is malformed', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    await expect(
      new DatadogBackend({
        baseUrl: 'not a url',
        apiKey: 'dd-api',
        appKey: '',
      }).listServices(),
    ).rejects.toThrow(/application key/i);
  });
});

describe('resolveDatadogBaseUrl', () => {
  it('turns a bare site into its API host', () => {
    expect(resolveDatadogBaseUrl('datadoghq.eu')).toBe(
      'https://api.datadoghq.eu',
    );
    expect(resolveDatadogBaseUrl('us5.datadoghq.com')).toBe(
      'https://api.us5.datadoghq.com',
    );
    expect(resolveDatadogBaseUrl('uk1.datadoghq.com')).toBe(
      'https://api.uk1.datadoghq.com',
    );
  });

  it('leaves a full URL alone', () => {
    expect(resolveDatadogBaseUrl('https://api.datadoghq.com')).toBe(
      'https://api.datadoghq.com',
    );
  });

  it('does not double up an api. prefix someone already added', () => {
    expect(resolveDatadogBaseUrl('api.datadoghq.eu')).toBe(
      'https://api.datadoghq.eu',
    );
  });

  it('falls back to the US site when unset', () => {
    expect(resolveDatadogBaseUrl('')).toBe('https://api.datadoghq.com');
    expect(resolveDatadogBaseUrl(undefined)).toBe('https://api.datadoghq.com');
  });

  it('tolerates a trailing slash', () => {
    expect(resolveDatadogBaseUrl('datadoghq.eu/')).toBe(
      'https://api.datadoghq.eu',
    );
  });
});
