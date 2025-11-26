/**
 * Token bucket rate limiter for event subscribers
 *
 * Prevents overwhelming downstream events platforms with too many events.
 * Uses token bucket algorithm for smooth rate limiting with burst capacity.
 */

export interface RateLimiterConfig {
  /** Maximum events per second (default: 100) */
  maxEventsPerSecond: number;
  /** Burst capacity - max events in a single burst (default: 2x rate) */
  burstCapacity?: number;
}

/**
 * Token bucket rate limiter
 *
 * Allows bursts up to burstCapacity, then smooths to maxEventsPerSecond.
 * Thread-safe for async operations.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond
  private lastRefill: number;

  constructor(config: RateLimiterConfig) {
    this.maxTokens = config.burstCapacity || config.maxEventsPerSecond * 2;
    this.tokens = this.maxTokens; // Start with full bucket
    this.refillRate = config.maxEventsPerSecond / 1000; // Convert to per-ms
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume a token (allow an event)
   * Returns true if allowed, false if rate limit exceeded
   */
  tryConsume(count = 1): boolean {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }

    return false;
  }

  /**
   * Wait until a token is available (async rate limiting)
   * Returns a promise that resolves when the event can be processed
   */
  async waitForToken(count = 1): Promise<void> {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return;
    }

    // Calculate wait time until we have enough tokens
    const tokensNeeded = count - this.tokens;
    const waitMs = Math.ceil(tokensNeeded / this.refillRate);

    await new Promise((resolve) => setTimeout(resolve, waitMs));

    // After waiting, try again (recursive)
    return this.waitForToken(count);
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Get current available tokens (for testing/debugging)
   */
  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Reset the rate limiter (for testing)
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }
}
