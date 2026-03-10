import type { RateLimitConfig } from './types';

const DEFAULT_CONFIG: RateLimitConfig = {
  maxPerType: 10,
  windowMs: 10000,
};

interface BucketEntry {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private buckets = new Map<string, BucketEntry>();

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  isAllowed(exceptionType: string): boolean {
    const now = Date.now();

    // Prune expired entries when map grows too large
    if (this.buckets.size > 100) {
      for (const [key, val] of this.buckets) {
        if (now - val.windowStart >= this.config.windowMs) {
          this.buckets.delete(key);
        }
      }
    }

    const entry = this.buckets.get(exceptionType);

    if (!entry || now - entry.windowStart >= this.config.windowMs) {
      this.buckets.set(exceptionType, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= this.config.maxPerType) {
      return false;
    }

    entry.count++;
    return true;
  }
}
