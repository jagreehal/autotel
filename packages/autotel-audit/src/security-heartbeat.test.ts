import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSecurityHeartbeat } from './security-heartbeat';

const counterAdd = vi.fn();

vi.mock('autotel', () => ({
  createCounter: vi.fn(() => ({ add: counterAdd })),
}));

describe('startSecurityHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('beats immediately and then on every interval', () => {
    const heartbeat = startSecurityHeartbeat({ intervalMs: 10_000 });

    expect(counterAdd).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(counterAdd).toHaveBeenCalledTimes(4);

    heartbeat.stop();
  });

  it('stops beating after stop()', () => {
    const heartbeat = startSecurityHeartbeat({ intervalMs: 10_000 });
    heartbeat.stop();

    vi.advanceTimersByTime(60_000);
    expect(counterAdd).toHaveBeenCalledTimes(1); // only the initial beat

    heartbeat.stop(); // idempotent
  });

  it('attaches custom attributes to every beat', () => {
    const heartbeat = startSecurityHeartbeat({
      intervalMs: 10_000,
      attributes: { component: 'payments' },
    });

    vi.advanceTimersByTime(10_000);
    expect(counterAdd).toHaveBeenLastCalledWith(1, { component: 'payments' });

    heartbeat.stop();
  });

  it('survives a broken meter', async () => {
    const { createCounter } = vi.mocked(await import('autotel'));
    createCounter.mockImplementation(() => {
      throw new Error('meter not configured');
    });

    expect(() => {
      const heartbeat = startSecurityHeartbeat({ intervalMs: 10_000 });
      vi.advanceTimersByTime(20_000);
      heartbeat.stop();
    }).not.toThrow();
  });
});
