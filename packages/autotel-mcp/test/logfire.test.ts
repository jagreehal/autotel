import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogfireBackend } from '../src/backends/logfire/index';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Row-oriented `{schema, data}` payload, as the live `/v2/query` API returns it
 * (it is NOT `{rows}`), with the `gen_ai.*` attribute keys it hands back
 * verbatim for a Pydantic AI tools trace.
 */
const queryResponse = {
  schema: { fields: [{ name: 'trace_id', datatype: 'Utf8' }] },
  data: [
    {
      trace_id: '019f8c0bb45ca01755d65cf669e070b9',
      span_id: 'a1b2c3d4e5f60718',
      parent_span_id: null,
      span_name: 'chat claude-opus-5',
      start_timestamp: '2026-07-27T21:53:20.100000Z',
      end_timestamp: '2026-07-27T21:53:21.350000Z',
      service_name: 'travel-assistant',
      is_exception: false,
      attributes: {
        'gen_ai.request.model': 'claude-opus-5',
        'gen_ai.usage.input_tokens': 981,
      },
    },
    {
      trace_id: '019f8c0bb45ca01755d65cf669e070b9',
      span_id: '00112233445566aa',
      parent_span_id: 'a1b2c3d4e5f60718',
      span_name: 'execute_tool get_weather',
      start_timestamp: '2026-07-27T21:53:20.400000Z',
      end_timestamp: '2026-07-27T21:53:20.900000Z',
      service_name: 'travel-assistant',
      is_exception: true,
      attributes: { 'gen_ai.tool.name': 'get_weather' },
    },
  ],
};

const respond = (body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  });

const backend = () =>
  new LogfireBackend({
    baseUrl: 'https://logfire-us.pydantic.dev',
    readToken: 'lf-read-token',
  });

describe('LogfireBackend', () => {
  it('declares traces available and the other signals unsupported', () => {
    expect(backend().capabilities()).toEqual({
      traces: 'available',
      metrics: 'unsupported',
      logs: 'unsupported',
    });
  });

  it('refuses to query without a read token', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const noToken = new LogfireBackend({
      baseUrl: 'https://logfire-us.pydantic.dev',
      readToken: '',
    });
    await expect(noToken.listServices()).rejects.toThrow(/read token/i);
  });

  it('posts to /v2/query with a bearer token and a min_timestamp', async () => {
    const fetchSpy = respond(queryResponse);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await backend().searchTraces({ limit: 5 });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://logfire-us.pydantic.dev/v2/query');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer lf-read-token',
    });
    // Omitting min_timestamp is a 422 from the live API.
    const body = JSON.parse(init.body as string);
    expect(Number.isNaN(Date.parse(body.min_timestamp))).toBe(false);
    expect(body.sql).toMatch(/FROM records/i);
  });

  it('groups rows into traces and preserves gen_ai attributes', async () => {
    globalThis.fetch = respond(queryResponse) as unknown as typeof fetch;

    const result = await backend().searchTraces({ limit: 5 });

    expect(result.items).toHaveLength(1);
    const trace = result.items[0]!;
    expect(trace.traceId).toBe('019f8c0bb45ca01755d65cf669e070b9');
    expect(trace.spans).toHaveLength(2);
    expect(trace.spans[0]!.serviceName).toBe('travel-assistant');
    expect(trace.spans[0]!.operationName).toBe('chat claude-opus-5');
    expect(trace.spans[0]!.tags['gen_ai.request.model']).toBe('claude-opus-5');
  });

  it('hydrates matching trace ids so service filters retain downstream spans', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          data: [{ trace_id: queryResponse.data[0]!.trace_id }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => queryResponse,
      });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await backend().searchTraces({
      service: 'travel-assistant',
    });

    expect(result.items[0]!.spans).toHaveLength(2);
    const hydration = JSON.parse(
      (fetchSpy.mock.calls[1]![1] as RequestInit).body as string,
    );
    expect(hydration.sql).toContain('WHERE trace_id IN');
    expect(hydration.sql).not.toContain("service_name = 'travel-assistant'");
  });

  it('converts timestamps to epoch ms and durations to ms', async () => {
    globalThis.fetch = respond(queryResponse) as unknown as typeof fetch;

    const trace = (await backend().searchTraces({})).items[0]!;

    expect(trace.spans[0]!.startTimeUnixMs).toBe(
      Date.parse('2026-07-27T21:53:20.100000Z'),
    );
    expect(trace.spans[0]!.durationMs).toBe(1250);
    expect(trace.spans[1]!.durationMs).toBe(500);
  });

  it('maps parent links and the exception flag onto span status', async () => {
    globalThis.fetch = respond(queryResponse) as unknown as typeof fetch;

    const trace = (await backend().searchTraces({})).items[0]!;

    expect(trace.spans[0]!.parentSpanId).toBeNull();
    expect(trace.spans[1]!.parentSpanId).toBe('a1b2c3d4e5f60718');
    expect(trace.spans[0]!.hasError).toBe(false);
    expect(trace.spans[1]!.hasError).toBe(true);
    expect(trace.spans[1]!.statusCode).toBe('ERROR');
  });

  it('escapes quotes in a service filter rather than breaking the SQL', async () => {
    const fetchSpy = respond({ schema: {}, data: [] });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await backend().searchTraces({ service: "o'brien" });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.sql).toContain("service_name = 'o''brien'");
  });

  it('narrows min_timestamp to the requested window', async () => {
    const fetchSpy = respond({ schema: {}, data: [] });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const startTimeUnixMs = Date.parse('2026-07-27T00:00:00.000Z');
    await backend().searchTraces({ startTimeUnixMs });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.min_timestamp).toBe('2026-07-27T00:00:00.000Z');
  });

  it('lists distinct service names', async () => {
    globalThis.fetch = respond({
      schema: {},
      data: [{ service_name: 'api' }, { service_name: 'worker' }],
    }) as unknown as typeof fetch;

    await expect(backend().listServices()).resolves.toEqual({
      services: ['api', 'worker'],
    });
  });

  it('returns null for a trace id with no rows', async () => {
    globalThis.fetch = respond({
      schema: {},
      data: [],
    }) as unknown as typeof fetch;
    await expect(backend().getTrace('missing')).resolves.toBeNull();
  });

  it('reports metrics and logs as unsupported rather than empty', async () => {
    const metrics = await backend().listMetrics();
    const logs = await backend().searchLogs();
    expect(metrics.unsupported).toBe(true);
    expect(logs.unsupported).toBe(true);
  });

  // Both Logfire misconfigurations — a token for the other data region, and a
  // write token used for reads — come back as a bare 401. Naming both saves the
  // reader from guessing which one they hit.
  it('turns a 401 into advice naming both the region and the token scope', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
    }) as unknown as typeof fetch;

    const health = await backend().healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toMatch(/logfire-eu/);
    expect(health.message).toMatch(/read/i);
    // The originating URL still has to be visible for debugging.
    expect(health.message).toMatch(/logfire-us\.pydantic\.dev/);
  });

  it('does not add auth advice to unrelated failures', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      headers: new Headers(),
    }) as unknown as typeof fetch;

    const health = await backend().healthCheck();
    expect(health.message).toMatch(/500/);
    expect(health.message).not.toMatch(/read-scope/i);
  });

  it('reports unhealthy instead of throwing when the API is unreachable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
    }) as unknown as typeof fetch;

    const health = await backend().healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toMatch(/401/);
  });
});
