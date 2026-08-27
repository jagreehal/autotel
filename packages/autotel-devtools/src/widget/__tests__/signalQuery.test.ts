/**
 * @vitest-environment jsdom
 *
 * Trace query controller contract.
 *
 * Driven with a stubbed fetch and a fixed clock. The two behaviours worth the
 * most here are the ones a refactor would silently break: a superseded response
 * must never land, and a failed query must never blank the list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTraceQuery, createLogQuery } from '../signalQuery.svelte';
import { timeWindowSignal } from '../store.svelte';
import { DEFAULT_SELECTION } from '../timeWindow';
import type { TraceData } from '../types';

const NOW = 1_700_000_000_000;

// The window is global by design, so it has to be reset between tests or one
// test's range leaks into the next.
beforeEach(() => {
  timeWindowSignal.value = DEFAULT_SELECTION;
});

function trace(id: string): Partial<TraceData> {
  return { traceId: id, service: 'api', startTime: NOW, duration: 10 };
}

/** A fetch stub whose response is chosen per call. */
function scriptedFetch(
  responses: Array<{ status?: number; body: unknown; delayMs?: number }>,
) {
  let call = 0;
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    const spec = responses[Math.min(call, responses.length - 1)];
    call++;
    if (spec.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
    }
    if (init?.signal?.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    return new Response(JSON.stringify(spec.body), {
      status: spec.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return fn as unknown as typeof fetch;
}

function make(
  responses: Array<{ status?: number; body: unknown; delayMs?: number }>,
) {
  const fetchFn = scriptedFetch(responses);
  return {
    fetchFn,
    controller: createTraceQuery({
      client: { fetch: fetchFn, baseUrl: 'http://localhost:4318' },
      now: () => NOW,
      debounceMs: 0,
      pageSize: 2,
    }),
  };
}

/** Let pending promises settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('running queries', () => {
  it('starts empty and live', () => {
    const { controller } = make([{ body: { traces: [], nextCursor: null } }]);
    expect(controller.results.value).toEqual([]);
    expect(controller.live).toBe(true);
    expect(controller.ready.value).toBe(false);
  });

  it('marks a successful empty response as ready', async () => {
    const { controller } = make([{ body: { traces: [], nextCursor: null } }]);

    await controller.refresh();

    expect(controller.results.value).toEqual([]);
    expect(controller.ready.value).toBe(true);
  });

  it('resolves the server origin when each request starts', async () => {
    let baseUrl = 'http://first.example';
    const fetchFn = scriptedFetch([
      { body: { traces: [], nextCursor: null } },
      { body: { traces: [], nextCursor: null } },
    ]);
    const controller = createTraceQuery({
      client: { fetch: fetchFn, baseUrl: () => baseUrl },
      debounceMs: 0,
    });

    await controller.refresh();
    baseUrl = 'http://second.example';
    await controller.refresh();

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls[0][0])).toContain('http://first.example');
    expect(String(calls[1][0])).toContain('http://second.example');
  });

  it('populates results from a query', async () => {
    const { controller } = make([
      { body: { traces: [trace('t1')], nextCursor: null } },
    ]);

    controller.setText('service = api');
    await flush();

    expect(controller.results.value).toHaveLength(1);
    expect(controller.loading.value).toBe(false);
  });

  it('freezes the tail as soon as a query is typed', async () => {
    const { controller } = make([{ body: { traces: [], nextCursor: null } }]);
    controller.setText('service = api');
    expect(controller.live).toBe(false);
  });

  it('returns to live when the query is cleared', async () => {
    const { controller } = make([{ body: { traces: [], nextCursor: null } }]);
    controller.setText('service = api');
    controller.setText('');
    expect(controller.live).toBe(true);
  });
});

describe('superseded requests', () => {
  it('never renders a stale response over a newer one', async () => {
    // The first request is slow and the second is fast: without sequencing, the
    // slow one would land last and show results for a query already replaced.
    const { controller } = make([
      { body: { traces: [trace('stale')], nextCursor: null }, delayMs: 30 },
      { body: { traces: [trace('fresh')], nextCursor: null } },
    ]);

    controller.setText('a');
    controller.setText('ab');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(controller.results.value.map((t) => t.traceId)).toEqual(['fresh']);
  });

  it('leaves loading owned by the newest request when an older one aborts', async () => {
    const { controller } = make([
      { body: { traces: [], nextCursor: null }, delayMs: 30 },
      { body: { traces: [trace('t')], nextCursor: null } },
    ]);

    controller.setText('a');
    controller.setText('ab');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(controller.loading.value).toBe(false);
  });
});

describe('failure handling', () => {
  it('keeps the previous results when a query becomes invalid', async () => {
    const { controller } = make([
      { body: { traces: [trace('t1')], nextCursor: null } },
      {
        status: 400,
        body: {
          errors: [{ message: 'Expected a value', range: { from: 8, to: 9 } }],
        },
      },
    ]);

    controller.setText('service = api');
    await flush();
    expect(controller.results.value).toHaveLength(1);

    controller.setText('service =');
    await flush();

    // Still showing the last good page, with the problem reported alongside.
    expect(controller.results.value).toHaveLength(1);
    expect(controller.errors.value).toHaveLength(1);
  });

  it('reports a server failure without clearing results', async () => {
    const { controller } = make([
      { body: { traces: [trace('t1')], nextCursor: null } },
      { status: 500, body: { error: 'boom' } },
    ]);

    controller.setText('a');
    await flush();
    controller.setText('ab');
    await flush();

    expect(controller.results.value).toHaveLength(1);
    expect(controller.failure.value).toMatch(/Server error/);
  });

  it('clears a stale error once a query succeeds again', async () => {
    const { controller } = make([
      {
        status: 400,
        body: { errors: [{ message: 'bad', range: { from: 0, to: 1 } }] },
      },
      { body: { traces: [trace('t1')], nextCursor: null } },
    ]);

    controller.setText('service =');
    await flush();
    expect(controller.errors.value).toHaveLength(1);

    controller.setText('service = api');
    await flush();
    expect(controller.errors.value).toEqual([]);
  });
});

describe('time window', () => {
  it('freezes the tail when the window becomes bounded', () => {
    const { controller } = make([{ body: { traces: [], nextCursor: null } }]);
    controller.setWindow({ type: 'preset', preset: '15m' });
    expect(controller.live).toBe(false);
  });

  it('stays live for the unbounded default', () => {
    const { controller } = make([{ body: { traces: [], nextCursor: null } }]);
    controller.setWindow({ type: 'preset', preset: 'all' });
    expect(controller.live).toBe(true);
  });

  it('sends the resolved window to the server', async () => {
    const { controller, fetchFn } = make([
      { body: { traces: [], nextCursor: null } },
    ]);
    controller.setWindow({ type: 'preset', preset: '15m' });
    await flush();

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse(
      (calls[calls.length - 1][1] as RequestInit).body as string,
    );
    expect(body.window).toEqual({ start: NOW - 15 * 60_000, end: NOW });
  });

  it('omits the window entirely when unbounded', async () => {
    const { controller, fetchFn } = make([
      { body: { traces: [], nextCursor: null } },
    ]);
    controller.setWindow({ type: 'preset', preset: 'all' });
    await flush();

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse(
      (calls[calls.length - 1][1] as RequestInit).body as string,
    );
    expect(body).not.toHaveProperty('window');
  });
});

describe('live arrivals', () => {
  it('counts arrivals while frozen instead of refetching', async () => {
    const { controller, fetchFn } = make([
      { body: { traces: [], nextCursor: null } },
    ]);
    controller.setSelected(true);
    const before = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;

    controller.arrived(3);
    await flush();

    expect(controller.pending).toBe(3);
    expect(
      (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(before);
  });

  it('refetches on arrival while live, so the list stays current', async () => {
    const { controller, fetchFn } = make([
      { body: { traces: [], nextCursor: null } },
    ]);
    const before = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;

    controller.arrived(1);
    await flush();

    expect(
      (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(before);
  });

  it('resume clears the query, the freeze and the pending count', async () => {
    const { controller } = make([{ body: { traces: [], nextCursor: null } }]);
    controller.setText('service = api');
    controller.setSelected(true);
    controller.arrived(5);

    controller.resume();
    await flush();

    expect(controller.live).toBe(true);
    expect(controller.pending).toBe(0);
    expect(controller.text.value).toBe('');
  });
});

describe('paging', () => {
  it('appends the next page rather than replacing the current one', async () => {
    const { controller } = make([
      { body: { traces: [trace('t1'), trace('t2')], nextCursor: 'c1' } },
      { body: { traces: [trace('t3')], nextCursor: null } },
    ]);

    controller.submit();
    await flush();
    expect(controller.results.value).toHaveLength(2);

    controller.loadMore();
    await flush();

    expect(controller.results.value.map((t) => t.traceId)).toEqual([
      't1',
      't2',
      't3',
    ]);
    expect(controller.nextCursor.value).toBeNull();
  });

  it('does nothing when there is no next page', async () => {
    const { controller, fetchFn } = make([
      { body: { traces: [trace('t1')], nextCursor: null } },
    ]);
    controller.submit();
    await flush();

    const before = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;
    controller.loadMore();
    await flush();

    expect(
      (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(before);
  });

  it('drops the cursor when the query changes, so pages cannot interleave', async () => {
    const { controller, fetchFn } = make([
      { body: { traces: [trace('t1')], nextCursor: 'c1' } },
      { body: { traces: [trace('other')], nextCursor: null } },
    ]);

    controller.submit();
    await flush();
    controller.setText('service = worker');
    await flush();

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse(
      (calls[calls.length - 1][1] as RequestInit).body as string,
    );
    expect(body).not.toHaveProperty('cursor');
    expect(controller.results.value.map((t) => t.traceId)).toEqual(['other']);
  });
});

describe('local result changes', () => {
  it('removes rows after a durable delete without waiting for a refetch', async () => {
    const { controller } = make([
      {
        body: {
          traces: [trace('keep'), trace('delete')],
          nextCursor: null,
        },
      },
    ]);
    await controller.refresh();

    controller.removeRows((row) => row.traceId === 'delete');

    expect(controller.results.value.map((row) => row.traceId)).toEqual([
      'keep',
    ]);
  });
});

describe('log adapter', () => {
  /** The log endpoint returns rows under `logs`, not `traces`. */
  function makeLogController(rows: unknown[]) {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ logs: rows, nextCursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    return {
      fetchFn,
      controller: createLogQuery({
        client: { fetch: fetchFn, baseUrl: 'http://localhost:4318' },
        now: () => NOW,
        debounceMs: 0,
      }),
    };
  }

  it('reads rows from the log payload key', async () => {
    const { controller } = makeLogController([{ id: 'l1', body: 'hello' }]);
    controller.submit();
    await flush();
    expect(controller.results.value).toHaveLength(1);
  });

  it('posts to the log endpoint', async () => {
    const { controller, fetchFn } = makeLogController([]);
    controller.submit();
    await flush();

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls[0][0])).toMatch(/\/api\/query\/logs$/);
  });

  it('shares the freeze behaviour, so logs stop reordering under a reader too', async () => {
    const { controller } = makeLogController([]);
    controller.setText('severity = ERROR');
    expect(controller.live).toBe(false);
  });
});

describe('the time window is shared, not per-controller', () => {
  /**
   * Two tabs presenting one control must mean one window. A per-controller
   * window looks identical on screen and silently changes the range as you
   * switch tabs — which is the drift the global window replaced.
   */
  it('reflects a window set on one controller in another', () => {
    const a = make([{ body: { traces: [], nextCursor: null } }]).controller;
    const b = make([{ body: { traces: [], nextCursor: null } }]).controller;

    a.setWindow({ type: 'preset', preset: '15m' });
    expect(b.window.value).toEqual({ type: 'preset', preset: '15m' });
  });

  it('shares it across signal types too', () => {
    const traces = make([
      { body: { traces: [], nextCursor: null } },
    ]).controller;
    const logs = createLogQuery({
      client: {
        fetch: (async () =>
          new Response(JSON.stringify({ logs: [], nextCursor: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })) as unknown as typeof fetch,
        baseUrl: 'http://localhost:4318',
      },
      now: () => NOW,
      debounceMs: 0,
    });

    logs.setWindow({ type: 'preset', preset: '1h' });
    expect(traces.window.value).toEqual({ type: 'preset', preset: '1h' });
  });
});
