import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => ({
  flush: vi.fn<() => Promise<void>>(),
  size: vi.fn(() => 1),
}));

vi.mock('./track', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./track')>();
  return {
    ...actual,
    getEventQueue: () => queue,
  };
});

import { init } from './init';
import { withTracing } from './functional';
import { createTraceCollector } from './testing';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('root telemetry flushing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    init({ service: 'flush-test' });
    createTraceCollector();
  });

  it('keeps an async success pending until the root flush completes', async () => {
    const flush = deferred();
    queue.flush.mockReturnValue(flush.promise);
    const traced = withTracing({ name: 'flush.success' })(() => async () => 42);
    let settled = false;

    const result = Promise.resolve(traced()).then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(queue.flush).toHaveBeenCalledOnce());

    expect(settled).toBe(false);
    flush.resolve();
    await expect(result).resolves.toBe(42);
  });

  it('keeps an async rejection pending until the root flush completes', async () => {
    const flush = deferred();
    const failure = new Error('expected failure');
    queue.flush.mockReturnValue(flush.promise);
    const traced = withTracing({ name: 'flush.failure' })(() => async () => {
      throw failure;
    });
    let settled = false;

    const result = traced().catch((error: unknown) => {
      settled = true;
      throw error;
    });
    await vi.waitFor(() => expect(queue.flush).toHaveBeenCalledOnce());

    expect(settled).toBe(false);
    flush.resolve();
    await expect(result).rejects.toBe(failure);
  });
});
