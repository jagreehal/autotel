import { describe, it, expect, vi, afterEach } from 'vitest';
import { logfireAdapter } from './logfire';
import type { QueryAdapterContext } from './types';

const ctx = (over: Partial<QueryAdapterContext> = {}): QueryAdapterContext => ({
  baseUrl: 'https://logfire-us.pydantic.dev',
  secrets: { get: async () => 'lf-read-token' },
  abortSignal: new AbortController().signal,
  ...over,
});

// Response shape observed against the live Logfire query API (2026-07-27):
// row-oriented `{schema: {fields}, data: [rowdict]}`, NOT `{rows}`. Attribute
// keys are the ones the API actually returned for a Pydantic AI tools trace.
const liveQueryResponse = {
  schema: {
    fields: [
      { name: 'trace_id', datatype: 'Utf8' },
      { name: 'span_id', datatype: 'Utf8' },
      { name: 'parent_span_id', datatype: 'Utf8' },
      { name: 'span_name', datatype: 'Utf8' },
      { name: 'start_timestamp', datatype: 'Utf8' },
      { name: 'end_timestamp', datatype: 'Utf8' },
      { name: 'service_name', datatype: 'Utf8' },
      { name: 'is_exception', datatype: 'Boolean' },
      { name: 'attributes', datatype: 'Utf8' },
    ],
  },
  data: [
    {
      trace_id: '019f8c0bb45ca01755d65cf669e070b9',
      span_id: 'a1b2c3d4e5f60718',
      parent_span_id: null,
      span_name: 'travel-assistant run',
      start_timestamp: '2026-07-27T21:53:20.100000Z',
      end_timestamp: '2026-07-27T21:53:21.350000Z',
      service_name: 'travel-assistant',
      is_exception: false,
      attributes: {
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.request.model': 'claude-opus-5',
      },
    },
    {
      trace_id: '019f8c0bb45ca01755d65cf669e070b9',
      span_id: '00112233445566aa',
      parent_span_id: 'a1b2c3d4e5f60718',
      span_name: 'running tool: get_weather',
      start_timestamp: '2026-07-27T21:53:20.400000Z',
      end_timestamp: '2026-07-27T21:53:20.900000Z',
      service_name: 'travel-assistant',
      is_exception: false,
      attributes: {
        'gen_ai.tool.name': 'get_weather',
        'gen_ai.tool.call.arguments': '{"city":"Lisbon"}',
        'gen_ai.tool.call.result': '{"tempC":29}',
      },
    },
  ],
};

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('logfireAdapter', () => {
  it('refuses to call without a read token', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    await expect(
      logfireAdapter.searchTraces(
        ctx({ secrets: { get: async () => undefined } }),
        {},
      ),
    ).rejects.toThrow(/read token missing/i);
  });

  it('builds traces from the row-oriented query response', async () => {
    globalThis.fetch = okJson(liveQueryResponse) as unknown as typeof fetch;
    const traces = await logfireAdapter.searchTraces(ctx(), { limit: 10 });
    expect(traces).toHaveLength(1);
    expect(traces[0].traceId).toBe('019f8c0bb45ca01755d65cf669e070b9');
    expect(traces[0].service).toBe('travel-assistant');
    expect(traces[0].spans).toHaveLength(2);
    expect(traces[0].rootSpan?.name).toBe('travel-assistant run');
    // gen_ai.* attributes must survive the read path verbatim.
    expect(traces[0].spans[1].attributes['gen_ai.tool.name']).toBe(
      'get_weather',
    );
  });

  it('posts to the v2 query endpoint', async () => {
    const fetchSpy = okJson(liveQueryResponse);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await logfireAdapter.searchTraces(ctx(), {});
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://logfire-us.pydantic.dev/v2/query',
    );
  });

  // Omitting min_timestamp makes the API return 422, so every query must carry
  // one — including queries the caller gave no time range for.
  it('always sends min_timestamp, defaulting when the query has no start', async () => {
    const fetchSpy = okJson(liveQueryResponse);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await logfireAdapter.searchTraces(ctx(), {});
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.min_timestamp).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(body.min_timestamp))).toBe(false);
  });

  it('uses the query start time as min_timestamp when given', async () => {
    const fetchSpy = okJson(liveQueryResponse);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const startMs = Date.parse('2026-07-27T00:00:00.000Z');
    await logfireAdapter.searchTraces(ctx(), { startMs });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.min_timestamp).toBe('2026-07-27T00:00:00.000Z');
  });

  // Logfire enforces a per-minute rate limit (~10 queries) and returns 429.
  // A burst of UI queries must ride it out rather than surfacing an error.
  it('retries a rate-limited query and returns the eventual result', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'Retry-After': '0' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => liveQueryResponse,
      });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const traces = await logfireAdapter.searchTraces(ctx(), {});
    expect(traces).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('gives up on a persistently rate-limited backend', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'Retry-After': '0' }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(logfireAdapter.searchTraces(ctx(), {})).rejects.toThrow(/429/);
  });
});
