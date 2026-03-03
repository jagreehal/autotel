import { describe, expect, it, vi } from 'vitest';
import { createDrainPipeline } from './drain-pipeline';

describe('createDrainPipeline', () => {
  it('batches by size and sends to drain', async () => {
    const batchDrain = vi.fn(async () => {});
    const pipeline = createDrainPipeline<number>({
      batch: { size: 2, intervalMs: 1000 },
    });
    const drain = pipeline(batchDrain);

    drain(1);
    drain(2);
    await new Promise((resolve) => setImmediate(resolve));

    expect(batchDrain).toHaveBeenCalledTimes(1);
    expect(batchDrain).toHaveBeenCalledWith([1, 2]);
    expect(drain.pending).toBe(0);
  });

  it('retries failed batches and eventually succeeds', async () => {
    let attempts = 0;
    const batchDrain = vi.fn(async () => {
      attempts++;
      if (attempts < 2) throw new Error('temporary');
    });

    const pipeline = createDrainPipeline<number>({
      batch: { size: 1, intervalMs: 1000 },
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1,
        maxDelayMs: 2,
        backoff: 'fixed',
        jitter: false,
      },
    });
    const drain = pipeline(batchDrain);

    drain(42);
    await drain.flush();

    expect(batchDrain).toHaveBeenCalledTimes(2);
    expect(drain.pending).toBe(0);
  });

  it('drops overflowed events based on policy', async () => {
    const dropped: number[] = [];
    const batchDrain = vi.fn(async () => {});
    const pipeline = createDrainPipeline<number>({
      batch: { size: 10, intervalMs: 1000 },
      maxBufferSize: 2,
      dropPolicy: 'oldest',
      onDropped: (events) => dropped.push(...events),
    });
    const drain = pipeline(batchDrain);

    drain(1);
    drain(2);
    drain(3); // drops 1

    expect(dropped).toEqual([1]);
    expect(drain.pending).toBe(2);

    await drain.flush();
    expect(batchDrain).toHaveBeenCalledWith([2, 3]);
  });
});
