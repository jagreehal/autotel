/**
 * Tests for circuit breaker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
} from './circuit-breaker';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('CLOSED state (normal operation)', () => {
    it('should execute function successfully when closed', async () => {
      const cb = new CircuitBreaker('test');

      const result = await cb.execute(async () => 'success');

      expect(result).toBe('success');
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should record failures but stay closed under threshold', async () => {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 5,
        resetTimeout: 30_000,
        windowSize: 60_000,
      });

      // 4 failures (under threshold of 5)
      for (let i = 0; i < 4; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('test error');
          });
        } catch {
          // Expected
        }
      }

      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.getFailureCount()).toBe(4);
    });
  });

  describe('OPEN state (fast-fail)', () => {
    it('should open circuit after threshold failures', async () => {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 3,
        resetTimeout: 30_000,
        windowSize: 60_000,
      });

      // Trigger 3 failures to open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('adapter error');
          });
        } catch {
          // Expected
        }
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
      expect(cb.getFailureCount()).toBe(3);
    });

    it('should fast-fail when circuit is open', async () => {
      const cb = new CircuitBreaker('test-adapter', {
        failureThreshold: 2,
        resetTimeout: 30_000,
        windowSize: 60_000,
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('error');
          });
        } catch {
          // Expected
        }
      }

      // Should fast-fail without calling function
      await expect(
        cb.execute(async () => 'should not be called'),
      ).rejects.toThrow(CircuitOpenError);

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it('should transition to half-open after reset timeout', async () => {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 2,
        resetTimeout: 30_000,
        windowSize: 60_000,
      });

      // Open circuit
      for (let i = 0; i < 2; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('error');
          });
        } catch {
          // Expected
        }
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Advance time past reset timeout
      vi.advanceTimersByTime(31_000);

      // Next call should transition to half-open
      const result = await cb.execute(async () => 'recovered');

      expect(result).toBe('recovered');
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('HALF_OPEN state (testing recovery)', () => {
    it('should close circuit on successful test request', async () => {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 2,
        resetTimeout: 30_000,
        windowSize: 60_000,
      });

      // Open circuit
      cb.forceOpen();
      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Wait for reset timeout
      vi.advanceTimersByTime(31_000);

      // Successful test request should close circuit
      await cb.execute(async () => 'success');

      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.getFailureCount()).toBe(0);
    });

    it('should reopen circuit if test request fails', async () => {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 30_000,
        windowSize: 60_000,
      });

      // Open circuit
      try {
        await cb.execute(async () => {
          throw new Error('error');
        });
      } catch {
        // Expected
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Wait for reset timeout
      vi.advanceTimersByTime(31_000);

      // Failed test request should reopen circuit
      try {
        await cb.execute(async () => {
          throw new Error('still failing');
        });
      } catch {
        // Expected
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('Time window management', () => {
    it('should only count failures within time window', async () => {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 3,
        resetTimeout: 30_000,
        windowSize: 10_000, // 10 second window
      });

      // Record 2 failures
      for (let i = 0; i < 2; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('error');
          });
        } catch {
          // Expected
        }
      }

      expect(cb.getFailureCount()).toBe(2);

      // Advance time past window
      vi.advanceTimersByTime(11_000);

      // Old failures should be cleared
      expect(cb.getFailureCount()).toBe(0);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should track failure timestamps correctly', async () => {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 5,
        resetTimeout: 30_000,
        windowSize: 60_000,
      });

      // Record failures over time
      for (let i = 0; i < 3; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('error');
          });
        } catch {
          // Expected
        }
        vi.advanceTimersByTime(5000); // 5 seconds between failures
      }

      const failures = cb.getRecentFailures();
      expect(failures).toHaveLength(3);
      expect(failures[0]?.error).toBe('error');
    });
  });

  describe('Manual control', () => {
    it('should allow manual reset', async () => {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 2,
        resetTimeout: 30_000,
        windowSize: 60_000,
      });

      // Open circuit
      for (let i = 0; i < 2; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('error');
          });
        } catch {
          // Expected
        }
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Manual reset
      cb.forceReset();

      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.getFailureCount()).toBe(0);
    });

    it('should allow manual open', () => {
      const cb = new CircuitBreaker('test');

      expect(cb.getState()).toBe(CircuitState.CLOSED);

      cb.forceOpen();

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('Configuration', () => {
    it('should use default config values', () => {
      const cb = new CircuitBreaker('test');

      // Should use default threshold of 5
      expect(cb.getFailureCount()).toBe(0);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should allow custom config', async () => {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 2,
        resetTimeout: 5000,
        windowSize: 10_000,
      });

      // Should open after 2 failures (custom threshold)
      for (let i = 0; i < 2; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('error');
          });
        } catch {
          // Expected
        }
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('Error handling', () => {
    it('should record error messages', async () => {
      const cb = new CircuitBreaker('test');

      try {
        await cb.execute(async () => {
          throw new Error('specific error message');
        });
      } catch {
        // Expected
      }

      const failures = cb.getRecentFailures();
      expect(failures[0]?.error).toBe('specific error message');
    });

    it('should handle non-Error throws', async () => {
      const cb = new CircuitBreaker('test');

      try {
        await cb.execute(async () => {
          throw 'string error';
        });
      } catch {
        // Expected
      }

      const failures = cb.getRecentFailures();
      expect(failures[0]?.error).toBe('string error');
    });
  });
});
