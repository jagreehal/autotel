import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DeterministicSampler,
  KeyTargetRateSampler,
  hashUnitInterval,
  type SamplingContext,
} from './sampling';

function contextFor(operationName: string): SamplingContext {
  return { operationName, args: [] };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DeterministicSampler', () => {
  it('reaches the same verdict for a key regardless of process', () => {
    const options = {
      sampleRate: 0.5,
      key: (context: SamplingContext) => context.operationName,
    };
    const upstream = new DeterministicSampler(options);
    const downstream = new DeterministicSampler(options);

    for (const traceId of ['trace-a', 'trace-b', 'trace-c', 'trace-d']) {
      expect(upstream.shouldSample(contextFor(traceId))).toBe(
        downstream.shouldSample(contextFor(traceId)),
      );
    }
  });

  it('keeps roughly the requested share of keys', () => {
    const sampler = new DeterministicSampler({
      sampleRate: 0.25,
      key: (context) => context.operationName,
    });

    const kept = Array.from({ length: 2000 }, (_, index) =>
      sampler.shouldSample(contextFor(`trace-${index}`)),
    ).filter(Boolean).length;

    expect(kept / 2000).toBeGreaterThan(0.15);
    expect(kept / 2000).toBeLessThan(0.35);
  });

  it('reports the rate as "1 in N"', () => {
    expect(
      new DeterministicSampler({
        sampleRate: 0.1,
        key: () => 'k',
      }).sampleRate(),
    ).toBeCloseTo(10);
  });

  it('rejects a rate outside 0-1', () => {
    expect(
      () => new DeterministicSampler({ sampleRate: 1.5, key: () => 'k' }),
    ).toThrow();
  });

  it('hashes a key to a stable position in the unit interval', () => {
    expect(hashUnitInterval('tenant-7')).toBe(hashUnitInterval('tenant-7'));
    expect(hashUnitInterval('tenant-7')).toBeGreaterThanOrEqual(0);
    expect(hashUnitInterval('tenant-7')).toBeLessThan(1);
  });

  it('spreads keys that share a prefix across the whole interval', () => {
    // Regression: a multiply-and-add hash packed `user_1000`-style keys into
    // a narrow band, so UserIdSampler kept 0% of them at a 10% rate.
    const values = Array.from({ length: 2000 }, (_, index) =>
      hashUnitInterval(`user_${1000 + index}`),
    );

    for (const rate of [0.01, 0.1, 0.5]) {
      const share = values.filter((value) => value < rate).length / 2000;
      expect(share).toBeGreaterThan(rate * 0.5);
      expect(share).toBeLessThan(rate * 1.5);
    }
  });
});

describe('KeyTargetRateSampler', () => {
  it('keeps everything in the first window, then thins the loud key', () => {
    vi.useFakeTimers();
    const sampler = new KeyTargetRateSampler({
      key: (context) => context.operationName,
      targetPerKey: 10,
      windowMs: 1000,
    });

    // First window: 1000 hits on the loud key, 5 on the quiet one.
    for (let i = 0; i < 1000; i++) {
      expect(sampler.shouldSample(contextFor('loud'))).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      sampler.shouldSample(contextFor('quiet'));
    }

    vi.advanceTimersByTime(1001);
    // Roll the window with the first call of the new one.
    sampler.shouldSample(contextFor('loud'));

    expect(sampler.sampleRate(contextFor('loud'))).toBeCloseTo(100);
    expect(sampler.sampleRate(contextFor('quiet'))).toBe(1);
  });

  it('preserves a rare key while thinning a busy one', () => {
    vi.useFakeTimers();
    const sampler = new KeyTargetRateSampler({
      key: (context) => context.operationName,
      targetPerKey: 10,
      windowMs: 1000,
    });

    for (let i = 0; i < 500; i++) {
      sampler.shouldSample(contextFor('busy'));
    }
    for (let i = 0; i < 4; i++) {
      sampler.shouldSample(contextFor('rare'));
    }

    vi.advanceTimersByTime(1001);

    let busyKept = 0;
    for (let i = 0; i < 500; i++) {
      if (sampler.shouldSample(contextFor('busy'))) busyKept++;
    }
    let rareKept = 0;
    for (let i = 0; i < 4; i++) {
      if (sampler.shouldSample(contextFor('rare'))) rareKept++;
    }

    expect(rareKept).toBe(4);
    expect(busyKept).toBeLessThan(60);
  });

  it('collapses unbounded keys into one bucket instead of growing forever', () => {
    const sampler = new KeyTargetRateSampler({
      key: (context) => context.operationName,
      maxKeys: 10,
    });

    for (let i = 0; i < 500; i++) {
      sampler.shouldSample(contextFor(`unique-${i}`));
    }

    // Beyond maxKeys everything shares the overflow bucket, so a fresh key
    // resolves to the same rate rather than allocating a new entry.
    expect(sampler.sampleRate(contextFor('unique-499'))).toBe(1);
  });

  it('rejects a non-positive target', () => {
    expect(
      () => new KeyTargetRateSampler({ key: () => 'k', targetPerKey: 0 }),
    ).toThrow();
  });
});
