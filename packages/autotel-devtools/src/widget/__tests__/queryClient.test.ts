/**
 * @vitest-environment jsdom
 *
 * Query-client contract.
 *
 * The seam is `queryTraces(args, deps)` — arguments in, a discriminated result
 * out, with `fetch` injected so these tests never touch the network. What they
 * pin is the shape of failure as much as success: a malformed query, an offline
 * server and a 500 are three different things to a user, and collapsing them
 * into one "something went wrong" is how a query bar becomes untrustworthy.
 */

import { describe, it, expect, vi } from 'vitest';
import { queryTraces, queryLogs } from '../query-client';

/** A fetch stub returning one canned response. */
function stubFetch(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

const BASE = 'http://localhost:4318';

/**
 * The arguments of one recorded fetch call.
 *
 * `vi.fn()` over an async arrow infers a zero-arg signature, so the recorded
 * calls type as `[]`; this reads them back through `unknown` in one place
 * rather than casting at every call site.
 */
function callArgs(
  fetchFn: ReturnType<typeof vi.fn>,
  index = 0,
): { url: string; init: RequestInit } {
  const [url, init] = fetchFn.mock.calls[index] as unknown as [
    string,
    RequestInit,
  ];
  return { url, init };
}

/** The parsed JSON body of one recorded fetch call. */
function callBody(
  fetchFn: ReturnType<typeof vi.fn>,
  index = 0,
): Record<string, unknown> {
  return JSON.parse(callArgs(fetchFn, index).init.body as string);
}

describe('queryTraces — success', () => {
  it('returns traces and the cursor', async () => {
    const fetchFn = stubFetch(200, {
      traces: [{ traceId: 't1' }],
      nextCursor: 'abc',
    });

    const result = await queryTraces(
      { query: 'service = api' },
      { fetch: fetchFn, baseUrl: BASE },
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.traces).toHaveLength(1);
    expect(result.nextCursor).toBe('abc');
  });

  it('posts to the query route with the query in the body', async () => {
    const fetchFn = stubFetch(200, { traces: [], nextCursor: null });
    await queryTraces(
      { query: 'duration > 100', limit: 25 },
      { fetch: fetchFn, baseUrl: BASE },
    );

    const { url, init } = callArgs(fetchFn);
    expect(url).toBe(`${BASE}/api/query/traces`);
    expect(init.method).toBe('POST');
    expect(callBody(fetchFn)).toMatchObject({
      query: 'duration > 100',
      limit: 25,
    });
  });

  it('omits an unbounded window rather than sending null bounds', async () => {
    const fetchFn = stubFetch(200, { traces: [], nextCursor: null });
    await queryTraces({ query: '' }, { fetch: fetchFn, baseUrl: BASE });

    expect(callBody(fetchFn)).not.toHaveProperty('window');
  });

  it('sends a bounded window', async () => {
    const fetchFn = stubFetch(200, { traces: [], nextCursor: null });
    await queryTraces(
      { query: '', window: { start: 1, end: 2 } },
      { fetch: fetchFn, baseUrl: BASE },
    );

    expect(callBody(fetchFn).window).toEqual({ start: 1, end: 2 });
  });
});

describe('queryTraces — failure modes stay distinguishable', () => {
  it('surfaces a malformed query as an invalid result with positioned errors', async () => {
    const fetchFn = stubFetch(400, {
      errors: [{ message: 'Expected a value', range: { from: 8, to: 9 } }],
    });

    const result = await queryTraces(
      { query: 'service =' },
      { fetch: fetchFn, baseUrl: BASE },
    );

    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.errors[0].range.from).toBe(8);
  });

  it('surfaces a server fault as an error, not as an invalid query', async () => {
    // These must not be conflated: one means "fix your query", the other means
    // "the query was fine and something else broke".
    const fetchFn = stubFetch(500, { error: 'boom' });
    const result = await queryTraces(
      { query: '' },
      { fetch: fetchFn, baseUrl: BASE },
    );
    expect(result.status).toBe('error');
  });

  it('surfaces a network failure as an error rather than throwing', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await queryTraces(
      { query: '' },
      { fetch: fetchFn as unknown as typeof fetch, baseUrl: BASE },
    );

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toMatch(/fetch|network/i);
  });

  it('surfaces a non-JSON body as an error rather than throwing', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<html>nope</html>', { status: 200 }),
    );
    const result = await queryTraces(
      { query: '' },
      { fetch: fetchFn as unknown as typeof fetch, baseUrl: BASE },
    );
    expect(result.status).toBe('error');
  });

  it('reports a 403 with an actionable message about the origin guard', async () => {
    const fetchFn = stubFetch(403, { error: 'Forbidden' });
    const result = await queryTraces(
      { query: '' },
      { fetch: fetchFn, baseUrl: BASE },
    );
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toMatch(/origin|forbidden/i);
  });
});

describe('queryTraces — cancellation', () => {
  it('passes an abort signal through so a superseded query can be dropped', async () => {
    const fetchFn = stubFetch(200, { traces: [], nextCursor: null });
    const controller = new AbortController();

    await queryTraces(
      { query: 'a' },
      { fetch: fetchFn, baseUrl: BASE, signal: controller.signal },
    );

    expect(callArgs(fetchFn).init.signal).toBe(controller.signal);
  });

  it('reports an aborted request distinctly, so it is not shown as an error', async () => {
    // A superseded keystroke is not a failure — rendering it as one would make
    // the query bar flash errors while someone is simply typing.
    const fetchFn = vi.fn(async () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      throw err;
    });

    const result = await queryTraces(
      { query: 'a' },
      { fetch: fetchFn as unknown as typeof fetch, baseUrl: BASE },
    );
    expect(result.status).toBe('aborted');
  });
});

describe('queryLogs', () => {
  it('posts to the log route and returns rows', async () => {
    const fetchFn = stubFetch(200, {
      logs: [{ id: 'l1', body: 'hello' }],
      nextCursor: 'c1',
    });

    const result = await queryLogs(
      { query: 'severity = ERROR' },
      { fetch: fetchFn, baseUrl: BASE },
    );

    expect(callArgs(fetchFn).url).toBe(`${BASE}/api/query/logs`);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.logs).toHaveLength(1);
    expect(result.nextCursor).toBe('c1');
  });

  it('shares the trace endpoint failure taxonomy', async () => {
    // Both endpoints go through one implementation, so a malformed query is
    // 'invalid' here for the same reason it is there.
    const result = await queryLogs(
      { query: 'severity =' },
      {
        fetch: stubFetch(400, {
          errors: [{ message: 'Expected a value', range: { from: 9, to: 10 } }],
        }),
        baseUrl: BASE,
      },
    );
    expect(result.status).toBe('invalid');
  });

  it('reports an aborted log query as aborted, not as an error', async () => {
    const fetchFn = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof fetch;

    const result = await queryLogs(
      { query: '' },
      { fetch: fetchFn, baseUrl: BASE },
    );
    expect(result.status).toBe('aborted');
  });
});

describe('queryTraces — payload shape', () => {
  it('passes through the complete spans the HTTP API answers with', async () => {
    // The compact wire shape is the WebSocket's business. Everything the HTTP
    // API answers arrives whole, so this client does no decoding.
    const fetchFn = stubFetch(200, {
      traces: [
        {
          traceId: 'a1',
          startTime: 1000,
          endTime: 1040,
          duration: 40,
          spans: [
            { spanId: 'root', startTime: 1000, endTime: 1040, duration: 40 },
          ],
        },
      ],
      nextCursor: null,
    });

    const result = await queryTraces(
      { query: '' },
      { fetch: fetchFn, baseUrl: BASE },
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.traces[0].endTime).toBe(1040);
    expect(result.traces[0].spans[0].endTime).toBe(1040);
  });
});
