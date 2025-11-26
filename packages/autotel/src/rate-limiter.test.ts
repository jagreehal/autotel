/**
 * Tests for token bucket rate limiter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucketRateLimiter } from './rate-limiter';

describe('TokenBucketRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('tryConsume()', () => {
    it('should allow events within rate limit', () => {
      const limiter = new TokenBucketRateLimiter({
        maxEventsPerSecond: 10,
        burstCapacity: 20,
      });

      // Should allow first 20 events (burst capacity)
      for (let i = 0; i < 20; i++) {
        expect(limiter.tryConsume()).toBe(true);
      }

      // 21st event should be rejected
      expect(limiter.tryConsume()).toBe(false);
    });

    it('should refill tokens over time', () => {
      const limiter = new TokenBucketRateLimiter({
        maxEventsPerSecond: 10, // 10 events/sec = 1 event/100ms
        burstCapacity: 10,
      });

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        expect(limiter.tryConsume()).toBe(true);
      }

      // Should be rate limited
      expect(limiter.tryConsume()).toBe(false);

      // Advance time by 100ms (1 token should be added)
      vi.advanceTimersByTime(100);

      // Should allow 1 more event
      expect(limiter.tryConsume()).toBe(true);
      expect(limiter.tryConsume()).toBe(false);

      // Advance time by 500ms (5 tokens should be added)
      vi.advanceTimersByTime(500);

      // Should allow 5 more events
      for (let i = 0; i < 5; i++) {
        expect(limiter.tryConsume()).toBe(true);
      }
      expect(limiter.tryConsume()).toBe(false);
    });

    it('should not exceed max tokens', () => {
      const limiter = new TokenBucketRateLimiter({
        maxEventsPerSecond: 10,
        burstCapacity: 20,
      });

      // Wait a long time
      vi.advanceTimersByTime(10_000);

      // Should only have 20 tokens (burstCapacity), not more
      expect(limiter.getAvailableTokens()).toBe(20);
    });

    it('should consume multiple tokens at once', () => {
      const limiter = new TokenBucketRateLimiter({
        maxEventsPerSecond: 100,
        burstCapacity: 200,
      });

      // Consume 50 tokens at once
      expect(limiter.tryConsume(50)).toBe(true);
      expect(limiter.getAvailableTokens()).toBe(150);

      // Consume another 150 tokens
      expect(limiter.tryConsume(150)).toBe(true);
      expect(limiter.getAvailableTokens()).toBe(0);

      // Should reject request for 1 token
      expect(limiter.tryConsume(1)).toBe(false);
    });
  });

  describe('waitForToken()', () => {
    it('should wait until token is available', async () => {
      const limiter = new TokenBucketRateLimiter({
        maxEventsPerSecond: 10, // 1 token every 100ms
        burstCapacity: 1,
      });

      // Consume the only token
      expect(limiter.tryConsume()).toBe(true);
      expect(limiter.tryConsume()).toBe(false);

      // Wait for next token
      const promise = limiter.waitForToken();

      // Advance time by 100ms
      vi.advanceTimersByTime(100);

      // Should resolve after 100ms
      await promise;

      // Token should be consumed
      expect(limiter.tryConsume()).toBe(false);
    });

    it('should calculate correct wait time for multiple tokens', async () => {
      const limiter = new TokenBucketRateLimiter({
        maxEventsPerSecond: 10, // 1 token every 100ms
        burstCapacity: 10,
      });

      // Consume all tokens
      expect(limiter.tryConsume(10)).toBe(true);

      // Request 5 tokens (should wait 500ms)
      const promise = limiter.waitForToken(5);

      // Advance by 400ms (not enough)
      vi.advanceTimersByTime(400);

      // Promise should not resolve yet
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      await vi.runAllTimersAsync();

      // Should be resolved now
      expect(resolved).toBe(true);
    });
  });

  describe('getAvailableTokens()', () => {
    it('should return current token count', () => {
      const limiter = new TokenBucketRateLimiter({
        maxEventsPerSecond: 100,
        burstCapacity: 200,
      });

      expect(limiter.getAvailableTokens()).toBe(200);

      limiter.tryConsume(50);
      expect(limiter.getAvailableTokens()).toBe(150);

      // Advance time by 100ms (10 tokens added)
      vi.advanceTimersByTime(100);
      expect(limiter.getAvailableTokens()).toBe(160);
    });
  });

  describe('reset()', () => {
    it('should reset to full capacity', () => {
      const limiter = new TokenBucketRateLimiter({
        maxEventsPerSecond: 10,
        burstCapacity: 20,
      });

      // Consume all tokens
      limiter.tryConsume(20);
      expect(limiter.getAvailableTokens()).toBe(0);

      // Reset
      limiter.reset();
      expect(limiter.getAvailableTokens()).toBe(20);
    });
  });

  describe('Burst capacity', () => {
    it('should default to 2x rate if not specified', () => {
      const limiter = new TokenBucketRateLimiter({
        maxEventsPerSecond: 50,
        // burstCapacity not specified
      });

      // Should have 100 tokens (2x rate)
      expect(limiter.getAvailableTokens()).toBe(100);
    });

    it('should allow custom burst capacity', () => {
      const limiter = new TokenBucketRateLimiter({
        maxEventsPerSecond: 50,
        burstCapacity: 500, // 10x rate
      });

      expect(limiter.getAvailableTokens()).toBe(500);
    });
  });
});
