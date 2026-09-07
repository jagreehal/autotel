/**
 * The devtools' WebMCP tools, exercised the way an agent calls them: through
 * `document.modelContext`, not by calling the handlers directly.
 *
 * The double from `webmcpable/testing` reproduces Chrome's measured behaviour —
 * `executeTool` takes a JSON *string*, `inputSchema` comes back as one, results
 * are serialised. Going through it is what makes "the agent gets a sentence it
 * can act on" an assertion rather than a hope.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestModelContext } from 'webmcpable/testing';
import { devtoolsTools } from '../webmcp';
import type { TraceData } from '../types';

const trace: TraceData = {
  traceId: 'abc123',
  correlationId: 'corr-1',
  rootSpan: {
    traceId: 'abc123',
    spanId: 'span-1',
    name: 'POST /checkout',
    kind: 'SERVER',
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_000_120,
    duration: 120,
    attributes: { 'http.route': '/checkout' },
    status: { code: 'ERROR', message: 'card declined' },
  },
  spans: [],
  startTime: 1_700_000_000_000,
  endTime: 1_700_000_000_120,
  duration: 120,
  status: 'ERROR',
  service: 'api',
};
trace.spans = [trace.rootSpan];

/**
 * The double's `document.modelContext`, narrowed to what these tests touch.
 * Stated locally rather than pulling in an ambient types package for one file.
 */
interface TestModelContext {
  executeTool(tool: { name: string }, inputArguments: string): Promise<string>;
  getTools(): Promise<Array<{ name: string; inputSchema: string }>>;
}

const modelContext = () =>
  (document as unknown as { modelContext: TestModelContext }).modelContext;

/** Call a tool the way an agent does: by name, with a JSON string. */
async function callTool(name: string, input: unknown = {}) {
  const registered = await modelContext().getTools();
  const tool = registered.find((t) => t.name === name);
  expect(tool, `${name} is not registered`).toBeDefined();
  return modelContext().executeTool(tool!, JSON.stringify(input));
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}

describe('devtools WebMCP tools', () => {
  let context: ReturnType<typeof installTestModelContext>;

  beforeEach(() => {
    context = installTestModelContext();
    return () => context.uninstall();
  });

  it('offers the read-only telemetry surface once mounted', async () => {
    const registry = devtoolsTools({ fetch: vi.fn(), baseUrl: 'http://x' });
    await registry.mount();

    const names = (await modelContext().getTools()).map((t) => t.name);
    expect(names).toEqual([
      'autotel_get_trace',
      'autotel_list_errors',
      'autotel_query_logs',
      'autotel_query_traces',
      'autotel_webmcp_inventory',
    ]);
  });

  it('declares traceId as required, so an agent sends it', async () => {
    const registry = devtoolsTools({ fetch: vi.fn(), baseUrl: 'http://x' });
    await registry.mount();

    const tools = await modelContext().getTools();
    const get = tools.find((t) => t.name === 'autotel_get_trace')!;
    // Chrome hands back `inputSchema` as a JSON string, and so does the double.
    const schema = JSON.parse(get.inputSchema);
    expect(schema.required).toEqual(['traceId']);
  });

  it('unmount withdraws every tool', async () => {
    const registry = devtoolsTools({ fetch: vi.fn(), baseUrl: 'http://x' });
    await registry.mount();
    registry.unmount();

    expect(await modelContext().getTools()).toEqual([]);
  });

  it('projects traces down to the columns the panel lists', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ traces: [trace] }));
    const registry = devtoolsTools({ fetch, baseUrl: 'http://localhost:4318' });
    await registry.mount();

    const result = JSON.parse(
      await callTool('autotel_query_traces', { query: 'status = ERROR' }),
    );

    expect(result.traces).toEqual([
      {
        traceId: 'abc123',
        name: 'POST /checkout',
        service: 'api',
        status: 'ERROR',
        durationMs: 120,
        spans: 1,
        startedAt: '2023-11-14T22:13:20.000Z',
      },
    ]);
    // The whole span tree stays behind until an agent asks for one trace.
    expect(result.traces[0]).not.toHaveProperty('rootSpan');

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      query: 'status = ERROR',
      limit: 20,
    });
  });

  it('caps the row count an agent can ask for', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ traces: [] }));
    const registry = devtoolsTools({ fetch, baseUrl: 'http://localhost:4318' });
    await registry.mount();

    await callTool('autotel_query_traces', { limit: 5000 });

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init.body).limit).toBe(50);
  });

  it('looks a trace up by id and returns its spans', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ traces: [trace] }));
    const registry = devtoolsTools({ fetch, baseUrl: 'http://localhost:4318' });
    await registry.mount();

    const result = JSON.parse(
      await callTool('autotel_get_trace', { traceId: 'abc123' }),
    );

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init.body).query).toBe('trace_id = "abc123"');
    expect(result.spans).toEqual([
      {
        spanId: 'span-1',
        parentSpanId: undefined,
        name: 'POST /checkout',
        kind: 'SERVER',
        durationMs: 120,
        status: 'ERROR',
        statusMessage: 'card declined',
        attributes: { 'http.route': '/checkout' },
      },
    ]);
  });

  // A JSON Schema is a description, not a validator: nothing in the browser
  // enforces `required`, so the handler owns it.
  it('asks for traceId rather than querying for undefined', async () => {
    const fetch = vi.fn();
    const registry = devtoolsTools({ fetch, baseUrl: 'http://localhost:4318' });
    await registry.mount();

    expect(await callTool('autotel_get_trace', {})).toBe(
      'traceId is required — take one from autotel_query_traces.',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  // The safety net for what the handlers cannot return themselves — a bogus
  // timestamp reaching `toISOString`, say. Chrome would otherwise replace the
  // message with a generic UnknownError.
  it('turns an unexpected throw into text the agent can read', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ traces: [{ ...trace, startTime: Number.NaN }] }),
      );
    const registry = devtoolsTools({ fetch, baseUrl: 'http://localhost:4318' });
    await registry.mount();

    expect(await callTool('autotel_query_traces')).toBe(
      'Error: Invalid time value',
    );
  });

  it('tells an agent a trace is absent instead of returning an empty shell', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ traces: [] }));
    const registry = devtoolsTools({ fetch, baseUrl: 'http://localhost:4318' });
    await registry.mount();

    expect(await callTool('autotel_get_trace', { traceId: 'nope' })).toBe(
      'No stored trace with id nope.',
    );
  });

  // A thrown handler reaches the agent as Chrome's generic `UnknownError` with
  // the message stripped, so a correctable query would read as a broken page.
  it('returns a bad query as correctable text, not a rejection', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ errors: [{ message: 'Unknown operator at 8' }] }, 400),
      );
    const registry = devtoolsTools({ fetch, baseUrl: 'http://localhost:4318' });
    await registry.mount();

    expect(
      await callTool('autotel_query_traces', { query: 'status ~ x' }),
    ).toBe('Invalid query: Unknown operator at 8');
  });

  it('says the receiver is unreachable rather than failing silently', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const registry = devtoolsTools({ fetch, baseUrl: 'http://localhost:4318' });
    await registry.mount();

    expect(await callTool('autotel_list_errors')).toContain(
      'Devtools query failed',
    );
  });
});
