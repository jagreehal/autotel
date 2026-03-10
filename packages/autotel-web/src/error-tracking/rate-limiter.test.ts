import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('allows events within the limit', () => {
    const limiter = new RateLimiter({ maxPerType: 3, windowMs: 10000 });
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(true);
  });

  it('blocks events exceeding the limit', () => {
    const limiter = new RateLimiter({ maxPerType: 2, windowMs: 10000 });
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(false);
  });

  it('tracks types independently', () => {
    const limiter = new RateLimiter({ maxPerType: 1, windowMs: 10000 });
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('RangeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(false);
    expect(limiter.isAllowed('RangeError')).toBe(false);
  });

  it('resets after the time window', () => {
    const limiter = new RateLimiter({ maxPerType: 1, windowMs: 10000 });
    expect(limiter.isAllowed('TypeError')).toBe(true);
    expect(limiter.isAllowed('TypeError')).toBe(false);

    vi.advanceTimersByTime(10001);
    expect(limiter.isAllowed('TypeError')).toBe(true);
  });

  it('uses default config when none provided', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 10; i++) {
      expect(limiter.isAllowed('Error')).toBe(true);
    }
    expect(limiter.isAllowed('Error')).toBe(false);
  });
});
