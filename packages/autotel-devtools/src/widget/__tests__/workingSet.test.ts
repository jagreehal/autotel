/**
 * @vitest-environment jsdom
 *
 * Working-set contract.
 *
 * This is what moved the derived views off the live tail. The behaviours worth
 * pinning are the ones whose failure is invisible: falling back to the tail
 * rather than blanking every view when the server is unreachable, and dropping
 * a superseded response rather than rendering a map of the wrong period.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWorkingSet } from '../workingSet.svelte';
import {
  storeTracesSignal,
  storeErrorGroupsSignal,
  workingSetStatusSignal,
  windowedTracesSignal,
  windowedErrorGroupsSignal,
  timeWindowSignal,
  tracesSignal,
} from '../store.svelte';
import { DEFAULT_SELECTION } from '../timeWindow';
import type { TraceData, SpanData } from '../types';

const NOW = 1_700_000_000_000;
const BASE = 'http://localhost:4318';

let seq = 0;
function trace(id: string, startTime = NOW): TraceData {
  seq++;
  const span: SpanData = {
    spanId: `s-${id}-${seq}`,
    traceId: id,
    name: 'op',
    kind: 'INTERNAL',
    startTime,
    endTime: startTime + 1,
    duration: 1,
    attributes: {},
    status: { code: 'UNSET' },
    events: [],
  };
  return {
    traceId: id,
    correlationId: id,
    spans: [span],
    rootSpan: span,
    startTime,
    endTime: startTime + 1,
    duration: 1,
    status: 'OK',
    service: 'api',
  };
}

/** A fetch stub answering the trace and error endpoints from one script. */
function stubFetch(
  responses: Array<{
    traces?: TraceData[];
    errors?: unknown[];
    status?: number;
    delayMs?: number;
    reject?: boolean;
  }>,
) {
  let call = 0;
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    // Traces and errors are fetched together; count a round trip once.
    const index = Math.min(Math.floor(call / 2), responses.length - 1);
    call++;
    const spec = responses[index];

    if (spec.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
    }
    if (init?.signal?.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (spec.reject) throw new TypeError('Failed to fetch');

    const body = href.includes('/errors')
      ? { errors: spec.errors ?? [] }
      : { traces: spec.traces ?? [], nextCursor: null };
    return new Response(JSON.stringify(body), {
      status: spec.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function make(responses: Parameters<typeof stubFetch>[0]) {
  const fetchFn = stubFetch(responses);
  return {
    fetchFn,
    workingSet: createWorkingSet({
      fetch: fetchFn,
      baseUrl: BASE,
      now: () => NOW,
      debounceMs: 0,
    }),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  storeTracesSignal.value = [];
  storeErrorGroupsSignal.value = [];
  workingSetStatusSignal.value = 'pending';
  timeWindowSignal.value = DEFAULT_SELECTION;
  tracesSignal.value = [];
});

afterEach(() => {
  workingSetStatusSignal.value = 'pending';
  storeTracesSignal.value = [];
  tracesSignal.value = [];
});

describe('fetching', () => {
  it('populates the store-backed traces', async () => {
    const { workingSet } = make([{ traces: [trace('t1'), trace('t2')] }]);
    await workingSet.refresh();
    await flush();

    expect(storeTracesSignal.value).toHaveLength(2);
    expect(workingSetStatusSignal.value).toBe('ready');
    workingSet.dispose();
  });

  it('populates the store-backed error groups', async () => {
    const { workingSet } = make([
      { traces: [], errors: [{ fingerprint: 'f1', count: 3 }] },
    ]);
    await workingSet.refresh();
    await flush();

    expect(storeErrorGroupsSignal.value).toHaveLength(1);
    workingSet.dispose();
  });

  it('sends the resolved window', async () => {
    const { workingSet, fetchFn } = make([{ traces: [] }]);
    timeWindowSignal.value = { type: 'preset', preset: '15m' };
    await workingSet.refresh();
    await flush();

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse((calls[0][1] as RequestInit).body as string);
    expect(body.window).toEqual({ start: NOW - 15 * 60_000, end: NOW });
    workingSet.dispose();
  });

  it('omits the window when it is unbounded', async () => {
    const { workingSet, fetchFn } = make([{ traces: [] }]);
    await workingSet.refresh();
    await flush();

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse((calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty('window');
    workingSet.dispose();
  });

  it('asks for far more than a page, because these views aggregate', async () => {
    // A service map built from a page of traces silently omits edges, which
    // reads as "those services do not talk" rather than as a truncation.
    const { workingSet, fetchFn } = make([{ traces: [] }]);
    await workingSet.refresh();
    await flush();

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse((calls[0][1] as RequestInit).body as string);
    expect(body.limit).toBeGreaterThanOrEqual(1000);
    workingSet.dispose();
  });

  it('follows every trace cursor so aggregate views are complete', async () => {
    const fetchFn = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes('/errors')) {
          return new Response(JSON.stringify({ errors: [] }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        const body = JSON.parse(String(init?.body)) as { cursor?: string };
        const payload = body.cursor
          ? { traces: [trace('third')], nextCursor: null }
          : {
              traces: [trace('first'), trace('second')],
              nextCursor: 'next-page',
            };
        return new Response(JSON.stringify(payload), {
          headers: { 'content-type': 'application/json' },
        });
      },
    ) as unknown as typeof fetch;
    const workingSet = createWorkingSet({
      fetch: fetchFn,
      baseUrl: BASE,
      now: () => NOW,
      debounceMs: 0,
      limit: 2,
    });

    await workingSet.refresh();

    expect(storeTracesSignal.value.map((item) => item.traceId)).toEqual([
      'first',
      'second',
      'third',
    ]);
    const traceCalls = (
      fetchFn as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter(([url]) => String(url).includes('/traces'));
    expect(traceCalls).toHaveLength(2);
    workingSet.dispose();
  });
});

describe('falling back to the live tail', () => {
  it('leaves the status unavailable when the server cannot be reached', async () => {
    const { workingSet } = make([{ reject: true }]);
    await workingSet.refresh();
    await flush();

    expect(workingSetStatusSignal.value).toBe('unavailable');
    workingSet.dispose();
  });

  it('derived views then read the live tail rather than nothing', async () => {
    // Showing the traces already in the browser beats showing nothing; those
    // views worked that way before the store existed.
    tracesSignal.value = [trace('live')];
    const { workingSet } = make([{ reject: true }]);
    await workingSet.refresh();
    await flush();

    expect(windowedTracesSignal.value.map((t) => t.traceId)).toEqual(['live']);
    workingSet.dispose();
  });

  it('prefers the store once it answers', async () => {
    tracesSignal.value = [trace('live')];
    const { workingSet } = make([{ traces: [trace('stored')] }]);
    await workingSet.refresh();
    await flush();

    expect(windowedTracesSignal.value.map((t) => t.traceId)).toEqual([
      'stored',
    ]);
    workingSet.dispose();
  });

  it('treats an empty store answer as an answer, not as a failure', async () => {
    // An empty window is a legitimate result; falling back to the tail there
    // would show traces from outside the window the user asked for.
    tracesSignal.value = [trace('live')];
    const { workingSet } = make([{ traces: [] }]);
    await workingSet.refresh();
    await flush();

    expect(windowedTracesSignal.value).toEqual([]);
    workingSet.dispose();
  });

  it('uses the store error groups once ready', async () => {
    const { workingSet } = make([
      { traces: [], errors: [{ fingerprint: 'stored', count: 1 }] },
    ]);
    await workingSet.refresh();
    await flush();

    expect(windowedErrorGroupsSignal.value.map((g) => g.fingerprint)).toEqual([
      'stored',
    ]);
    workingSet.dispose();
  });
});

describe('superseded responses', () => {
  it('never renders a stale answer over a newer one', async () => {
    // The window can change faster than a fetch completes; a stale answer would
    // show a map of the wrong period.
    const { workingSet } = make([
      { traces: [trace('stale')], delayMs: 40 },
      { traces: [trace('fresh')] },
    ]);

    void workingSet.refresh();
    void workingSet.refresh();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(storeTracesSignal.value.map((t) => t.traceId)).toEqual(['fresh']);
    workingSet.dispose();
  });

  it('ignores a response that lands after disposal', async () => {
    const { workingSet } = make([{ traces: [trace('late')], delayMs: 30 }]);
    void workingSet.refresh();
    workingSet.dispose();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(storeTracesSignal.value).toEqual([]);
  });
});

describe('coalescing', () => {
  it('collapses a burst of invalidations into one fetch', async () => {
    // Traces stream in continuously; one refetch per arrival would hammer the
    // server for a view nobody has opened.
    const fetchFn = stubFetch([{ traces: [] }]);
    const workingSet = createWorkingSet({
      fetch: fetchFn,
      baseUrl: BASE,
      now: () => NOW,
      debounceMs: 20,
    });

    workingSet.invalidate();
    workingSet.invalidate();
    workingSet.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 60));

    // One round trip = two requests (traces + errors).
    expect(
      (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(2);
    workingSet.dispose();
  });

  it('does not fetch after disposal', async () => {
    const fetchFn = stubFetch([{ traces: [] }]);
    const workingSet = createWorkingSet({
      fetch: fetchFn,
      baseUrl: BASE,
      now: () => NOW,
      debounceMs: 10,
    });

    workingSet.invalidate();
    workingSet.dispose();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(
      (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(0);
  });
});
