import { describe, expect, it, vi } from 'vitest';
import {
  chunkIntervalStats,
  computeStreamTiming,
  createStreamTimer,
  recordStreamTiming,
} from './streaming.js';

describe('computeStreamTiming', () => {
  it('computes TTFC, total time, and throughput', () => {
    const timing = computeStreamTiming({
      startTime: 1000,
      firstChunkTime: 1200, // 200ms wait
      finishTime: 3000, // 2s total
      outputTokens: 100,
    });
    expect(timing.timeToFirstChunk).toBe(0.2);
    expect(timing.timeToFinish).toBe(2);
    expect(timing.outputTokensPerSecond).toBe(50); // 100 / 2s
    // steady = 100 / (2 - 0.2) = 55.5556
    expect(timing.steadyOutputTokensPerSecond).toBeCloseTo(55.5556, 3);
  });

  it('handles a non-streamed response (no first chunk)', () => {
    const timing = computeStreamTiming({
      startTime: 0,
      finishTime: 1000,
      outputTokens: 10,
    });
    expect(timing.timeToFirstChunk).toBeUndefined();
    expect(timing.steadyOutputTokensPerSecond).toBeUndefined();
    expect(timing.outputTokensPerSecond).toBe(10);
  });

  it('omits throughput without token counts', () => {
    const timing = computeStreamTiming({
      startTime: 0,
      firstChunkTime: 100,
      finishTime: 1000,
    });
    expect(timing.outputTokensPerSecond).toBeUndefined();
  });

  it('derives the inter-chunk distribution from timestamps', () => {
    const timing = computeStreamTiming({
      startTime: 0,
      firstChunkTime: 100,
      finishTime: 500,
      outputTokens: 5,
      chunkTimestamps: [100, 200, 300, 400, 500],
    });
    expect(timing.chunkCount).toBe(5);
    expect(timing.chunkIntervals?.avg).toBe(0.1); // even 100ms gaps
    expect(timing.timePerOutputChunk).toBe(0.1);
  });
});

describe('chunkIntervalStats', () => {
  it('summarises gaps between timestamps in seconds', () => {
    const stats = chunkIntervalStats([0, 100, 200, 400]); // gaps: .1 .1 .2
    expect(stats).toEqual(
      expect.objectContaining({ min: 0.1, max: 0.2, avg: expect.any(Number) }),
    );
  });

  it('returns undefined without enough samples', () => {
    expect(chunkIntervalStats([0, 100])).toBeUndefined();
  });
});

describe('recordStreamTiming', () => {
  it('sets canonical + extension attributes, skipping absent fields', () => {
    const setAttributes = vi.fn();
    recordStreamTiming(
      { setAttributes },
      {
        timeToFirstChunk: 0.2,
        timeToFinish: 2,
        outputTokensPerSecond: 50,
        timePerOutputChunk: 0.05,
        chunkCount: 40,
      },
    );
    expect(setAttributes).toHaveBeenCalledWith({
      'gen_ai.response.time_to_finish': 2,
      'gen_ai.response.time_to_first_chunk': 0.2,
      'gen_ai.response.output_tokens_per_second': 50,
      'gen_ai.response.time_per_output_chunk': 0.05,
    });
  });

  it('omits first-chunk and throughput when absent', () => {
    const setAttributes = vi.fn();
    recordStreamTiming({ setAttributes }, { timeToFinish: 1, chunkCount: 0 });
    expect(setAttributes).toHaveBeenCalledWith({
      'gen_ai.response.time_to_finish': 1,
    });
  });
});

describe('createStreamTimer', () => {
  it('times chunks with an injected clock', () => {
    let clock = 1000;
    const timer = createStreamTimer(() => clock);
    clock = 1150; // first chunk at +150ms
    timer.chunk();
    clock = 1250;
    timer.chunk();
    clock = 1350;
    timer.chunk();
    clock = 1450; // finish at +450ms
    const timing = timer.finish({ outputTokens: 30 });
    expect(timing.timeToFirstChunk).toBe(0.15);
    expect(timing.timeToFinish).toBe(0.45);
    expect(timing.chunkCount).toBe(3);
    expect(timing.outputTokensPerSecond).toBeCloseTo(66.6667, 3);
  });
});
