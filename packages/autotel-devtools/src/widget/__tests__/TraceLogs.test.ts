/**
 * @vitest-environment jsdom
 *
 * A trace's logs, shown without selecting a span first. They come from the
 * store, so a trace opened from history has them too, and they read in the
 * order they were written.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import TraceLogs from '../components/TraceLogs.svelte';
import { logsSignal } from '../store.svelte';
import type { LogData, SpanData, TraceData } from '../types';

const span: SpanData = {
  traceId: 'trace-1',
  spanId: 'span-1',
  name: 'atm.withdraw',
  kind: 'INTERNAL',
  startTime: 1000,
  endTime: 1100,
  duration: 100,
  attributes: {},
  status: { code: 'OK' },
};

const trace: TraceData = {
  traceId: 'trace-1',
  correlationId: 'trace-1',
  rootSpan: span,
  spans: [span],
  startTime: 1000,
  endTime: 1100,
  duration: 100,
  status: 'OK',
  service: 'atm',
};

const log = (id: string, body: string, timestamp: number): LogData => ({
  id,
  traceId: 'trace-1',
  spanId: 'span-1',
  body,
  timestamp,
});

function answer(logs: LogData[]) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ logs, nextCursor: null }, { status: 200 }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('TraceLogs', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    logsSignal.value = [];
  });

  it('asks the store for the trace and lists its logs oldest first', async () => {
    const fetch = answer([
      log('b', 'pin ok', 1050),
      log('a', 'withdrawal started', 1000),
    ]);
    render(TraceLogs, { props: { trace, onSpanSelect: () => {} } });

    expect(await screen.findByText('Logs (2)')).toBeTruthy();
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.query).toBe('trace_id = "trace-1"');
    const lines = screen.getAllByRole('button').map((b) => b.textContent);
    expect(lines[0]).toContain('withdrawal started');
    expect(lines[1]).toContain('pin ok');
  });

  it('selects the span that wrote a line', async () => {
    answer([log('a', 'withdrawal started', 1000)]);
    const onSpanSelect = vi.fn();
    render(TraceLogs, { props: { trace, onSpanSelect } });

    await fireEvent.click(await screen.findByText('withdrawal started'));
    expect(onSpanSelect).toHaveBeenCalledWith('span-1');
  });

  it('falls back to the live buffer when the store has nothing', async () => {
    answer([]);
    logsSignal.value = [log('live', 'debited', 1080)];
    render(TraceLogs, { props: { trace, onSpanSelect: () => {} } });

    expect(await screen.findByText('debited')).toBeTruthy();
  });

  it('follows every page, so older lines are not dropped', async () => {
    const pages = [
      { logs: [log('b', 'pin ok', 1050)], nextCursor: 'page-2' },
      { logs: [log('a', 'withdrawal started', 1000)], nextCursor: null },
    ];
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(pages.shift(), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch);
    render(TraceLogs, { props: { trace, onSpanSelect: () => {} } });

    expect(await screen.findByText('Logs (2)')).toBeTruthy();
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).cursor).toBe(
      'page-2',
    );
  });

  it('shows live lines the store has not returned, once each', async () => {
    answer([log('a', 'withdrawal started', 1000)]);
    logsSignal.value = [
      log('a', 'withdrawal started', 1000),
      log('live', 'debited', 1080),
    ];
    render(TraceLogs, { props: { trace, onSpanSelect: () => {} } });

    expect(await screen.findByText('Logs (2)')).toBeTruthy();
    expect(screen.getByText('debited')).toBeTruthy();
  });

  it('keeps new live lines visible when a refresh fails', async () => {
    answer([log('a', 'withdrawal started', 1000)]);
    render(TraceLogs, { props: { trace, onSpanSelect: () => {} } });
    expect(await screen.findByText('Logs (1)')).toBeTruthy();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'down' }, { status: 500 })),
    );
    logsSignal.value = [log('live', 'debited', 1080)];

    expect(await screen.findByText('debited')).toBeTruthy();
    expect(screen.getByText('Logs (2)')).toBeTruthy();
  });

  it('finishes reading history while other traces log', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pages = [
      { logs: [log('b', 'pin ok', 1050)], nextCursor: 'page-2' },
      { logs: [log('a', 'withdrawal started', 1000)], nextCursor: null },
    ];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const { cursor } = JSON.parse(String(init?.body));
      if (cursor) await gate;
      return Response.json(pages[cursor ? 1 : 0], { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    render(TraceLogs, { props: { trace, onSpanSelect: () => {} } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    // Traffic for another trace while page two is outstanding.
    logsSignal.value = [{ ...log('x', 'other', 1), traceId: 'trace-2' }];
    logsSignal.value = [
      { ...log('x', 'other', 1), traceId: 'trace-2' },
      { ...log('y', 'other', 2), traceId: 'trace-2' },
    ];
    release();

    expect(await screen.findByText('Logs (2)')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('queues one refresh when this trace logs mid-read', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) await gate;
      return Response.json(
        { logs: [log('a', 'withdrawal started', 1000)], nextCursor: null },
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetch);
    render(TraceLogs, { props: { trace, onSpanSelect: () => {} } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    logsSignal.value = [log('live', 'debited', 1080)];
    expect(await screen.findByText('debited')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Logs (2)')).toBeTruthy();
  });

  it('keeps refreshing once the live buffer is full', async () => {
    const stored: LogData[] = [];
    const fetch = vi.fn(async () =>
      Response.json({ logs: [...stored], nextCursor: null }, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch);
    render(TraceLogs, { props: { trace, onSpanSelect: () => {} } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    // A full buffer: the newest line replaces the oldest, the count holds.
    stored.push(log('a', 'first', 1000));
    logsSignal.value = [log('a', 'first', 1000)];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    stored.push(log('b', 'second', 1001));
    logsSignal.value = [log('b', 'second', 1001)];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    // 'first' left the buffer and still shows, from the store.
    expect(await screen.findByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
  });
});
