/**
 * Events event queue with batching, backpressure, retry logic, and rate limiting
 */

import type { EventSubscriber, EventAttributes } from './event-subscriber';
import { getLogger } from './init';
import { TokenBucketRateLimiter, type RateLimiterConfig } from './rate-limiter';

export interface EventData {
  name: string;
  attributes?: EventAttributes;
  timestamp: number;
}

export interface QueueConfig {
  maxSize: number; // Max events in queue (default: 50,000)
  batchSize: number; // Events per batch (default: 100)
  flushInterval: number; // Flush interval in ms (default: 10,000)
  maxRetries: number; // Max retry attempts (default: 3)
  rateLimit?: RateLimiterConfig; // Optional rate limiting (default: 100 events/sec)
}

const DEFAULT_CONFIG: QueueConfig = {
  maxSize: 50_000,
  batchSize: 100,
  flushInterval: 10_000,
  maxRetries: 3,
  rateLimit: {
    maxEventsPerSecond: 100,
    burstCapacity: 200,
  },
};

/**
 * Events queue with batching and backpressure
 *
 * Features:
 * - Batches events for efficient sending
 * - Bounded queue with drop-oldest policy (prod) or blocking (dev)
 * - Exponential backoff retry
 * - Rate limiting to prevent overwhelming subscribers
 * - Graceful flush on shutdown
 */
export class EventQueue {
  private queue: EventData[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly config: QueueConfig;
  private readonly subscribers: EventSubscriber[];
  private readonly rateLimiter: TokenBucketRateLimiter | null;
  private flushing = false;

  constructor(subscribers: EventSubscriber[], config?: Partial<QueueConfig>) {
    this.subscribers = subscribers;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize rate limiter if configured
    this.rateLimiter = this.config.rateLimit
      ? new TokenBucketRateLimiter(this.config.rateLimit)
      : null;
  }

  /**
   * Enqueue an event for sending
   *
   * Backpressure policy:
   * - Drops oldest event and logs warning if queue is full (same behavior in all environments)
   */
  enqueue(event: EventData): void {
    // Check queue size
    if (this.queue.length >= this.config.maxSize) {
      // Drop oldest event and log warning (same behavior in all environments)
      const droppedEvent = this.queue.shift();
      getLogger().warn(
        {
          droppedEvent: droppedEvent?.name,
        },
        `[autotel] Events queue full (${this.config.maxSize} events). ` +
          'Dropping oldest event. Events are being produced faster than they can be sent. ' +
          'Check your subscribers or reduce tracking frequency.',
      );
    }

    this.queue.push(event);
    this.scheduleBatchFlush();
  }

  /**
   * Schedule a batch flush if not already scheduled
   */
  private scheduleBatchFlush(): void {
    if (this.flushTimer || this.flushing) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushBatch();
    }, this.config.flushInterval);
  }

  /**
   * Flush a batch of events
   */
  private async flushBatch(): Promise<void> {
    if (this.queue.length === 0 || this.flushing) return;

    this.flushing = true;

    try {
      const batch = this.queue.splice(0, this.config.batchSize);
      await this.sendWithRetry(batch, this.config.maxRetries);
    } finally {
      this.flushing = false;

      // Schedule next flush if more events
      if (this.queue.length > 0) {
        this.scheduleBatchFlush();
      }
    }
  }

  /**
   * Send events with exponential backoff retry
   */
  private async sendWithRetry(
    events: EventData[],
    retriesLeft: number,
  ): Promise<void> {
    try {
      await this.sendToSubscribers(events);
    } catch (error) {
      if (retriesLeft > 0) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, this.config.maxRetries - retriesLeft) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendWithRetry(events, retriesLeft - 1);
      } else {
        // Give up after max retries
        // Always log failed retries to maintain visibility (same behavior in all environments)
        getLogger().error(
          {
            err: error instanceof Error ? error : undefined,
            retriesAttempted: this.config.maxRetries,
          },
          '[autotel] Failed to send events after retries',
        );
      }
    }
  }

  /**
   * Send events to all configured subscribers with rate limiting
   */
  private async sendToSubscribers(events: EventData[]): Promise<void> {
    // If rate limiting is disabled, send all at once
    if (!this.rateLimiter) {
      const promises = events.map((event) =>
        Promise.all(
          this.subscribers.map((subscriber) =>
            subscriber.trackEvent(event.name, event.attributes),
          ),
        ),
      );
      await Promise.all(promises);
      return;
    }

    // With rate limiting: wait for token before sending each event
    for (const event of events) {
      // Wait for rate limiter token (smooth traffic)
      await this.rateLimiter.waitForToken();

      // Send to all subscribers concurrently
      await Promise.all(
        this.subscribers.map((subscriber) =>
          subscriber.trackEvent(event.name, event.attributes),
        ),
      );
    }
  }

  /**
   * Flush all remaining events (for shutdown)
   */
  async flush(): Promise<void> {
    // Cancel any pending timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Wait for any in-progress flush to complete
    while (this.flushing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Flush all batches
    while (this.queue.length > 0) {
      await this.flushBatch();
    }
  }

  /**
   * Get queue size (for testing/debugging)
   */
  size(): number {
    return this.queue.length;
  }
}
