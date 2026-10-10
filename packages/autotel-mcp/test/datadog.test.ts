/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-known-value-widening -- Test helpers that build a Response from any JSON body the test wants to serve. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DatadogBackend,
  resolveDatadogBaseUrl,
} from '../src/backends/datadog/index';
import { installFetch, recordedCall, requestBody } from './helpers/fetch';

/** The search request body the Datadog backend builds. */
type DatadogSearchRequest = {
  data: { attributes: { filter: { query: string; from: string; to: string } } };
};

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
        start_timestamp: '2026-07-31T11:33:20.000Z',
        end_timestamp: '2026-07-31T11:33:20.250Z',
        status: 'ok',
        tags: ['env:prod'],
        attributes: { 'gen_ai.request.model': 'gpt-5' },
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
        start_timestamp: '2026-07-31T11:33:20.100Z',
        end_timestamp: '2026-07-31T11:33:20.150Z',
        status: 'error',
      },
    },
  ],
};

describe('DatadogBackend', () => {
  it('declares every signal available', () => {
    expect(backend().capabilities()).toEqual({
      traces: 'available',
      metrics: 'available',
      logs: 'available',
    });
  });

  it('requires both the API key and the application key', async () => {
    installFetch(vi.fn());
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
    const fetchSpy = respond({
      data: {
        attributes: { services: [] },
        id: 'services',
        type: 'services_list',
      },
    });
    installFetch(fetchSpy);

    await backend().listServices();

    const { headers } = recordedCall(fetchSpy);
    expect(headers).toMatchObject({
      'DD-API-KEY': 'dd-api',
      'DD-APPLICATION-KEY': 'dd-app',
    });
  });

  it('uses the APM service-list endpoint and response shape', async () => {
    const fetchSpy = respond({
      data: {
        attributes: { services: ['checkout', 'payments'] },
        id: 'services',
        type: 'services_list',
      },
    });
    installFetch(fetchSpy);

    await expect(backend().listServices()).resolves.toEqual({
      services: ['checkout', 'payments'],
    });
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      'https://api.datadoghq.com/api/v2/apm/services?filter%5Benv%5D=*',
    );
  });

  it('groups spans into traces by trace_id and preserves span attributes', async () => {
    installFetch(respond(searchResponse));

    const result = await backend().searchTraces({ limit: 10 });

    expect(result.items).toHaveLength(1);
    const trace = result.items[0]!;
    expect(trace.traceId).toBe('trace-1');
    expect(trace.spans).toHaveLength(2);
    expect(trace.spans[0]!.serviceName).toBe('checkout');
    expect(trace.spans[0]!.operationName).toBe('POST /orders');
    expect(trace.spans[0]!.parentSpanId).toBeNull();
    expect(trace.spans[1]!.parentSpanId).toBe('span-root');
    expect(trace.spans[0]!.tags['gen_ai.request.model']).toBe('gpt-5');
    expect(trace.spans[0]!.tags.env).toBe('prod');
  });

  it('converts nanosecond start and duration into ms', async () => {
    installFetch(respond(searchResponse));

    const trace = (await backend().searchTraces({})).items[0]!;

    expect(trace.spans[0]!.startTimeUnixMs).toBe(
      Date.parse('2026-07-31T11:33:20.000Z'),
    );
    expect(trace.spans[0]!.durationMs).toBe(250);
  });

  // Datadog's `start` is documented inconsistently across span shapes; accept
  // an ISO string as well as epoch nanoseconds so timestamps never silently
  // become garbage.
  it('also accepts an ISO start timestamp', async () => {
    installFetch(
      respond({
        data: [
          {
            attributes: {
              trace_id: 't',
              span_id: 's',
              service: 'api',
              resource_name: 'GET /',
              start_timestamp: '2026-07-27T21:53:20.000Z',
              end_timestamp: '2026-07-27T21:53:20.001Z',
            },
          },
        ],
      }),
    );

    const trace = (await backend().searchTraces({})).items[0]!;
    expect(trace.spans[0]!.startTimeUnixMs).toBe(
      Date.parse('2026-07-27T21:53:20.000Z'),
    );
  });

  it('maps the error status onto the span', async () => {
    installFetch(respond(searchResponse));

    const trace = (await backend().searchTraces({})).items[0]!;

    expect(trace.spans[0]!.hasError).toBe(false);
    expect(trace.spans[0]!.statusCode).toBe('OK');
    expect(trace.spans[1]!.hasError).toBe(true);
    expect(trace.spans[1]!.statusCode).toBe('ERROR');
  });

  it('builds a service and error filter query', async () => {
    const fetchSpy = respond({ data: [] });
    installFetch(fetchSpy);

    await backend().searchTraces({ service: 'checkout', hasError: true });

    const body = requestBody<DatadogSearchRequest>(fetchSpy);
    expect(body.data.attributes.filter.query).toBe(
      'service:checkout status:error',
    );
  });

  it('hydrates every matching trace in one request so service filters retain downstream spans', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [searchResponse.data[0]] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => searchResponse,
      });
    installFetch(fetchSpy);

    const result = await backend().searchTraces({ service: 'checkout' });

    expect(result.items[0]!.spans.map((span) => span.serviceName)).toEqual([
      'checkout',
      'payments',
    ]);
    const hydrationBody = requestBody<DatadogSearchRequest>(fetchSpy, 1);
    expect(hydrationBody.data.attributes.filter.query).toBe(
      'trace_id:(trace-1)',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // A search with no `from`/`to` falls back to Datadog's short default window,
  // so an older trace looked up by id would silently come back empty.
  it('bounds a trace lookup with an explicit time window', async () => {
    const fetchSpy = respond({ data: [] });
    installFetch(fetchSpy);

    await backend().getTrace('trace-1');

    const body = requestBody<DatadogSearchRequest>(fetchSpy);
    expect(body.data.attributes.filter.query).toBe('trace_id:trace-1');
    expect(Number.isNaN(Date.parse(body.data.attributes.filter.from))).toBe(
      false,
    );
    expect(Number.isNaN(Date.parse(body.data.attributes.filter.to))).toBe(
      false,
    );
  });

  it('reads a metric as one series per service', async () => {
    const fetchSpy = respond({
      series: [
        {
          metric: 'trace.http.server.request.hits',
          scope: 'service:dev-api',
          pointlist: [
            [1791619860000, 1],
            [1791619880000, null],
          ],
          unit: [{ name: 'hit' }, null],
        },
      ],
    });
    installFetch(fetchSpy);

    const [series] = await backend().getMetricSeries(
      'trace.http.server.request.hits',
      { serviceName: 'dev-api' },
    );

    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.pathname).toBe('/api/v1/query');
    expect(url.searchParams.get('query')).toBe(
      'avg:trace.http.server.request.hits{service:dev-api} by {service}',
    );
    expect(series).toEqual({
      metricName: 'trace.http.server.request.hits',
      unit: 'hit',
      points: [{ timestampUnixMs: 1791619860000, value: 1 }],
      attributes: { service: 'dev-api' },
    });
  });

  it('aggregates spans server-side with exact counts and an error request', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          data: [
            {
              attributes: {
                by: { service: 'dev-api', resource_name: 'GET /ping' },
                compute: {
                  c0: 1831,
                  c1: 2_000_000,
                  c2: 1_000_000,
                  c3: 22_087_307,
                  c4: 50_000_000,
                  c5: 90_000_000,
                },
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          data: [
            {
              attributes: {
                by: { service: 'dev-api', resource_name: 'GET /ping' },
                compute: { c0: 18 },
              },
            },
          ],
        }),
      });
    installFetch(fetchSpy);

    const [row] = (await backend().aggregateSpans({
      groupBy: ['service', 'operation'],
    }))!;

    expect(row).toMatchObject({
      group: { service: 'dev-api', operation: 'GET /ping' },
      count: 1831,
      errorCount: 18,
      errorRate: 0.01,
      p95Ms: 22.087,
    });
    type AggregateBody = {
      data: {
        attributes: {
          compute: { aggregation: string }[];
          filter: { query: string };
          group_by: { facet: string; limit: number }[];
        };
      };
    };
    // Datadog names the 50th percentile `median`.
    expect(
      requestBody<AggregateBody>(fetchSpy, 0).data.attributes.compute.map(
        (c) => c.aggregation,
      ),
    ).toEqual(['count', 'avg', 'median', 'pc95', 'pc99', 'max']);
    // Errors are counted for exactly the groups the totals chose.
    const errorsBody = requestBody<AggregateBody>(fetchSpy, 1);
    expect(errorsBody.data.attributes.filter.query).toBe(
      'status:error service:(dev-api) resource_name:("GET /ping")',
    );
    // Every level sorts by count so the limit keeps the busiest groups.
    const byCount = {
      sort: { aggregation: 'count', order: 'desc', type: 'measure' },
    };
    expect(
      requestBody<AggregateBody>(fetchSpy, 0).data.attributes.group_by,
    ).toEqual([
      { facet: 'service', limit: 20, ...byCount },
      { facet: 'resource_name', limit: 20, ...byCount },
    ]);
    expect(errorsBody.data.attributes.group_by).toEqual([
      { facet: 'service', limit: 1, ...byCount },
      { facet: 'resource_name', limit: 1, ...byCount },
    ]);
  });

  // Tag filters run after the fetch; truncation follows the page size.
  it('reports a full span page as truncated even after local filtering', async () => {
    const page = Array.from({ length: 10 }, (_, i) => ({
      attributes: {
        trace_id: `t${i}`,
        span_id: `s${i}`,
        service: 'api',
        custom: { http: { route: i === 0 ? '/a' : '/b' } },
      },
    }));
    installFetch(respond({ data: page }));

    const result = await backend().searchSpans({
      limit: 10,
      tags: { 'http.route': '/a' },
    });

    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  // Service, operation and the error flag compile to Datadog's query; other
  // filters go to the sample path.
  it('declines to aggregate server-side a filter it cannot compile', async () => {
    const fetchSpy = vi.fn();
    installFetch(fetchSpy);

    for (const query of [
      { tags: { 'gen_ai.system': 'openai' } },
      { minDurationMs: 100 },
      { spanMinDurationMs: 100 },
      { statusCode: 'ERROR' as const },
      {
        filters: [
          { field: 'http.route', operator: 'equals' as const, value: '/a' },
        ],
      },
    ]) {
      await expect(backend().aggregateSpans(query)).resolves.toBeUndefined();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('links a trace to the regional UI host', () => {
    expect(backend().traceUrl('abc')).toBe(
      'https://app.datadoghq.com/apm/trace/abc',
    );
    expect(
      new DatadogBackend({
        baseUrl: 'us5.datadoghq.com',
        apiKey: 'a',
        appKey: 'b',
      }).traceUrl('abc'),
    ).toBe('https://us5.datadoghq.com/apm/trace/abc');
  });

  it('flattens nested custom attributes, reads ns duration, treats parent "0" as root', async () => {
    installFetch(
      respond({
        data: [
          {
            attributes: {
              trace_id: 't',
              span_id: 's',
              parent_id: '0',
              service: 'api',
              resource_name: 'GET /ping',
              start_timestamp: '2026-10-10T08:45:15.535Z',
              end_timestamp: '2026-10-10T08:45:15.536Z',
              status: 'error',
              error: { message: 'boom', type: 'Error' },
              custom: {
                duration: 1015173,
                http: { method: 'GET', response: { status_code: 200 } },
                span: { kind: 'server' },
              },
            },
          },
        ],
      }),
    );

    const span = (await backend().getTrace('t'))!.spans[0]!;
    expect(span.parentSpanId).toBeNull();
    expect(span.durationMs).toBeCloseTo(1.015173);
    expect(span.tags['http.method']).toBe('GET');
    expect(span.tags['http.response.status_code']).toBe(200);
    expect(span.tags['span.kind']).toBe('server');
    expect(span.tags['error.message']).toBe('boom');
    expect(span.tags.http).toBeUndefined();
  });

  it('flags a trace whose spans filled the page as truncated', async () => {
    const spans = Array.from({ length: 1000 }, (_, i) => ({
      attributes: { trace_id: 't', span_id: `s${i}`, service: 'api' },
    }));
    installFetch(respond({ data: spans }));

    const trace = (await backend().getTrace('t'))!;
    expect(trace.truncated).toBe(true);
    expect((await backend().summarizeTrace('t'))!.truncated).toBe(true);
  });

  it('keeps a trace crowded out of a full hydration page', async () => {
    const big = Array.from({ length: 1000 }, (_, i) => ({
      attributes: { trace_id: 'big', span_id: `s${i}`, service: 'api' },
    }));
    const small = {
      attributes: { trace_id: 'small', span_id: 'x', service: 'api' },
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [big[0], small] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: big }),
      });
    installFetch(fetchSpy);

    const result = await backend().searchTraces({ limit: 5 });
    expect(result.items.map((t) => t.traceId)).toEqual(['big', 'small']);
    expect(result.items.every((t) => t.truncated)).toBe(true);
  });

  it('searches logs and maps OTLP trace correlation', async () => {
    const fetchSpy = respond({
      data: [
        {
          attributes: {
            timestamp: '2026-10-08T15:42:54.830Z',
            status: 'info',
            message: 'Found credentials',
            service: 'parser',
            tags: ['env:beta2'],
            attributes: { otel: { trace_id: 'abc', span_id: 'def' } },
          },
        },
      ],
    });
    installFetch(fetchSpy);

    const result = await backend().searchLogs({
      serviceName: 'parser',
      traceId: 'abc',
      text: 'Found credentials',
    });

    expect(fetchSpy.mock.calls[0]![0]).toBe(
      'https://api.datadoghq.com/api/v2/logs/events/search',
    );
    const body = requestBody<{ filter: { query: string } }>(fetchSpy);
    expect(body.filter.query).toBe(
      'service:parser trace_id:abc "Found credentials"',
    );
    expect(result.items[0]).toMatchObject({
      severityText: 'INFO',
      body: 'Found credentials',
      serviceName: 'parser',
      traceId: 'abc',
      spanId: 'def',
    });
    expect(result.items[0]!.attributes?.env).toBe('beta2');
  });

  it('turns a 429 into advice to wait instead of retrying in a loop', async () => {
    installFetch(
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => 'Too many requests',
      }),
    );

    await expect(backend().getTrace('t')).rejects.toThrow(
      /Wait about a minute/,
    );
  });

  // A bare site is the natural thing to configure — it is what Datadog's own
  // DD_SITE holds — and feeding it to `new URL()` produced a bare "Invalid URL"
  // that named neither the variable nor the fix.
  it('accepts a bare Datadog site and reaches the API host', async () => {
    const fetchSpy = respond({ data: [] });
    installFetch(fetchSpy);

    await new DatadogBackend({
      baseUrl: 'datadoghq.eu',
      apiKey: 'dd-api',
      appKey: 'dd-app',
    }).listServices();

    expect(fetchSpy.mock.calls[0]![0]).toBe(
      'https://api.datadoghq.eu/api/v2/apm/services?filter%5Benv%5D=*',
    );
  });

  // Credentials are checked before the URL is built, so a config with BOTH
  // problems reports the one the user has to fix rather than a URL parse error.
  it('reports the missing application key even when the site is malformed', async () => {
    installFetch(vi.fn());

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
