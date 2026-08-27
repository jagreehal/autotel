/**
 * Retention actually runs.
 *
 * The caps are worthless if nothing enforces them: `enforceRetention` existed
 * and was exposed for a while before anything called it on a schedule, and the
 * symptom — a store that grows for the life of the process — only appears after
 * hours of running, which is exactly the kind of thing a test has to catch
 * instead of a person.
 *
 * The timer must also not keep Node alive, or a CLI that has finished its work
 * hangs instead of exiting.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { DevtoolsServer } from '../server';
import type { TraceData, SpanData } from '../types';

let server: Server | null = null;
let devtools: DevtoolsServer | null = null;

afterEach(async () => {
  vi.useRealTimers();
  if (devtools) await devtools.close();
  else if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  devtools = null;
});

let seq = 0;
function trace(startTime: number): TraceData {
  seq++;
  const span: SpanData = {
    spanId: `s${seq}`,
    traceId: `t${seq}`,
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
    traceId: span.traceId,
    correlationId: span.traceId,
    spans: [span],
    rootSpan: span,
    startTime,
    endTime: startTime + 1,
    duration: 1,
    status: 'OK',
    service: 'api',
  };
}

describe('retention loop', () => {
  it('prunes past the cap without anyone calling enforceRetention', async () => {
    vi.useFakeTimers();
    server = createServer();
    devtools = new DevtoolsServer({
      server,
      maxTraces: 2,
      retentionIntervalMs: 1000,
    });

    const base = Date.now();
    for (let i = 0; i < 5; i++) devtools.addTrace(trace(base + i * 1000));

    expect(devtools.queryTraces({ query: '' }).traces).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(1100);

    expect(devtools.queryTraces({ query: '' }).traces).toHaveLength(2);
  });

  it('keeps pruning on each tick, not only the first', async () => {
    vi.useFakeTimers();
    server = createServer();
    devtools = new DevtoolsServer({
      server,
      maxTraces: 1,
      retentionIntervalMs: 1000,
    });

    const base = Date.now();
    devtools.addTrace(trace(base));
    devtools.addTrace(trace(base + 1000));
    await vi.advanceTimersByTimeAsync(1100);
    expect(devtools.queryTraces({ query: '' }).traces).toHaveLength(1);

    devtools.addTrace(trace(base + 2000));
    devtools.addTrace(trace(base + 3000));
    await vi.advanceTimersByTimeAsync(1100);
    expect(devtools.queryTraces({ query: '' }).traces).toHaveLength(1);
  });

  it('can be disabled', async () => {
    vi.useFakeTimers();
    server = createServer();
    devtools = new DevtoolsServer({
      server,
      maxTraces: 1,
      retentionIntervalMs: 0,
    });

    const base = Date.now();
    devtools.addTrace(trace(base));
    devtools.addTrace(trace(base + 1000));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(devtools.queryTraces({ query: '' }).traces).toHaveLength(2);
  });

  it('does not keep the process alive', () => {
    // Without unref, this timer alone stops Node exiting, so a CLI that has
    // finished its work hangs. Asserted on the timer the server actually
    // creates rather than on the process handle list, which is full of
    // vitest's own timers.
    const unref = vi.fn();
    const spy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue({ unref } as unknown as ReturnType<typeof setInterval>);

    server = createServer();
    devtools = new DevtoolsServer({ server, retentionIntervalMs: 1000 });

    expect(spy).toHaveBeenCalled();
    expect(unref).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('stops the loop when the server closes', async () => {
    vi.useFakeTimers();
    server = createServer();
    const instance = new DevtoolsServer({
      server,
      maxTraces: 1,
      retentionIntervalMs: 1000,
    });
    devtools = instance;

    const base = Date.now();
    instance.addTrace(trace(base));
    instance.addTrace(trace(base + 1000));

    await instance.close();
    devtools = null;
    server = null;

    // Advancing past several intervals must not run a prune against a closed
    // store, which would throw.
    await expect(vi.advanceTimersByTimeAsync(5000)).resolves.not.toThrow();
  });
});
