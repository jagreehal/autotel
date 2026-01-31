/**
 * Events event queue with batching, backpressure, retry logic, rate limiting, and OTel metrics
 *
 * Exposes delivery pipeline metrics for observability:
 * - autotel.event_delivery.queue.size - Current queue size
 * - autotel.event_delivery.queue.oldest_age_ms - Age of oldest event in queue
 * - autotel.event_delivery.queue.delivered - Successfully delivered events
 * - autotel.event_delivery.queue.failed - Failed event deliveries
 * - autotel.event_delivery.queue.dropped - Dropped events with reason
 * - autotel.event_delivery.queue.latency_ms - Delivery latency histogram
 * - autotel.event_delivery.subscriber.health - Subscriber health (1=healthy, 0=unhealthy)
 */

import type {
  Counter,
  Histogram,
  ObservableGauge,
  Attributes,
} from '@opentelemetry/api';
import type { ObservableResult } from '@opentelemetry/api';
import type {
  EventSubscriber,
  EventAttributes,
  AutotelEventContext,
} from './event-subscriber';
import { getLogger } from './init';
import { getConfig as getRuntimeConfig } from './config';
import { TokenBucketRateLimiter, type RateLimiterConfig } from './rate-limiter';
import { getOrCreateCorrelationId } from './correlation-id';

export interface EventData {
  name: string;
  attributes?: EventAttributes;
  timestamp: number;
  /** Internal: correlation ID for debug breadcrumbs */
  _correlationId?: string;
  /** Internal: trace ID for debug breadcrumbs */
  _traceId?: string;
  /** Autotel context for trace correlation (passed to subscribers) */
  autotel?: AutotelEventContext;
}

/**
 * Drop reasons for event delivery queue metrics
 * LOW CARDINALITY: Only these 4 values allowed in metric labels
 */
export type EventDropReason =
  | 'rate_limit'
  | 'circuit_open'
  | 'payload_invalid'
  | 'shutdown';

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
 * Metrics for event delivery queue observability
 *
 * All metrics use low-cardinality labels only:
 * - subscriber: stable identifier (e.g., 'posthog', 'mixpanel')
 * - reason: one of EventDropReason values
 */
interface EventQueueMetrics {
  /** Current queue size (observable gauge) */
  queueSize: ObservableGauge;
  /** Age of oldest event in queue in ms (observable gauge) */
  oldestAge: ObservableGauge;
  /** Successfully delivered events (counter) */
  delivered: Counter;
  /** Failed event deliveries after all retries (counter) */
  failed: Counter;
  /** Dropped events (counter with reason label) */
  dropped: Counter;
  /** Event delivery latency histogram in ms */
  latency: Histogram;
  /** Subscriber health: 1=healthy, 0=unhealthy (observable gauge) */
  subscriberHealth: ObservableGauge;
}

/**
 * Get subscriber name for metrics (stable, low-cardinality)
 *
 * Priority:
 * 1. Explicit config: subscriber.name
 * 2. Class static property (if available)
 * 3. Fallback: lowercase class name without "Subscriber" suffix
 */
function getSubscriberName(subscriber: EventSubscriber): string {
  // Use explicit name if provided
  if (subscriber.name) {
    return subscriber.name.toLowerCase();
  }

  // Fallback: derive from class name
  const className = subscriber.constructor?.name || 'unknown';
  return className.replace(/Subscriber$/i, '').toLowerCase();
}

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
  private flushPromise: Promise<void> | null = null;
  private isShuttingDown = false;

  // Metrics
  private metrics: EventQueueMetrics | null = null;

  // Observable callback cleanup functions
  private observableCleanups: Array<() => void> = [];

  // Subscriber health tracking (for observable gauges)
  private subscriberHealthy: Map<string, boolean> = new Map();

  constructor(subscribers: EventSubscriber[], config?: Partial<QueueConfig>) {
    this.subscribers = subscribers;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize rate limiter if configured
    this.rateLimiter = this.config.rateLimit
      ? new TokenBucketRateLimiter(this.config.rateLimit)
      : null;

    // Initialize subscriber health tracking
    for (const subscriber of subscribers) {
      const name = getSubscriberName(subscriber);
      this.subscriberHealthy.set(name, true);
    }

    // Initialize metrics
    this.initMetrics();
  }

  /**
   * Initialize OTel metrics for queue observability
   */
  private initMetrics(): void {
    const runtimeConfig = getRuntimeConfig();
    const meter = runtimeConfig.meter;

    // Queue size gauge - observe current queue length
    const queueSize = meter.createObservableGauge(
      'autotel.event_delivery.queue.size',
      {
        description: 'Current number of events in the delivery queue',
        unit: 'count',
      },
    );
    const queueSizeCallback = (observableResult: ObservableResult) => {
      observableResult.observe(this.queue.length);
    };
    queueSize.addCallback(queueSizeCallback);
    this.observableCleanups.push(() =>
      queueSize.removeCallback(queueSizeCallback),
    );

    // Oldest event age gauge - observe wait time of oldest event
    const oldestAge = meter.createObservableGauge(
      'autotel.event_delivery.queue.oldest_age_ms',
      {
        description: 'Age of the oldest event in the queue in milliseconds',
        unit: 'ms',
      },
    );
    const oldestAgeCallback = (observableResult: ObservableResult) => {
      if (this.queue.length > 0) {
        const oldest = this.queue[0]!;
        const ageMs = Date.now() - oldest.timestamp;
        observableResult.observe(ageMs);
      } else {
        observableResult.observe(0);
      }
    };
    oldestAge.addCallback(oldestAgeCallback);
    this.observableCleanups.push(() =>
      oldestAge.removeCallback(oldestAgeCallback),
    );

    // Delivered counter
    const delivered = meter.createCounter(
      'autotel.event_delivery.queue.delivered',
      {
        description: 'Number of events successfully delivered to subscribers',
        unit: 'count',
      },
    );

    // Failed counter
    const failed = meter.createCounter('autotel.event_delivery.queue.failed', {
      description:
        'Number of events that failed delivery after all retry attempts',
      unit: 'count',
    });

    // Dropped counter (with reason label)
    const dropped = meter.createCounter(
      'autotel.event_delivery.queue.dropped',
      {
        description: 'Number of events dropped from the queue',
        unit: 'count',
      },
    );

    // Latency histogram
    const latency = meter.createHistogram(
      'autotel.event_delivery.queue.latency_ms',
      {
        description: 'Event delivery latency from enqueue to successful send',
        unit: 'ms',
      },
    );

    // Subscriber health gauge
    const subscriberHealth = meter.createObservableGauge(
      'autotel.event_delivery.subscriber.health',
      {
        description: 'Subscriber health status (1=healthy, 0=unhealthy)',
        unit: '1',
      },
    );
    const subscriberHealthCallback = (observableResult: ObservableResult) => {
      for (const [subscriberName, isHealthy] of this.subscriberHealthy) {
        observableResult.observe(isHealthy ? 1 : 0, {
          subscriber: subscriberName,
        });
      }
    };
    subscriberHealth.addCallback(subscriberHealthCallback);
    this.observableCleanups.push(() =>
      subscriberHealth.removeCallback(subscriberHealthCallback),
    );

    this.metrics = {
      queueSize,
      oldestAge,
      delivered,
      failed,
      dropped,
      latency,
      subscriberHealth,
    };
  }

  /**
   * Record a dropped event with reason and emit debug breadcrumb
   */
  private recordDropped(
    reason: EventDropReason,
    event?: EventData,
    subscriberName?: string,
  ): void {
    // Increment metric
    const attrs: Attributes = { reason };
    if (subscriberName) {
      attrs.subscriber = subscriberName;
    }
    this.metrics?.dropped.add(1, attrs);

    // Debug breadcrumb log (rate-limited via existing logger)
    const logLevel = reason === 'payload_invalid' ? 'error' : 'warn';
    const logger = getLogger();

    if (logLevel === 'error') {
      logger.error(
        {
          eventName: event?.name,
          subscriber: subscriberName,
          reason,
          correlationId: event?._correlationId,
          traceId: event?._traceId,
        },
        `[autotel] Event dropped: ${reason}`,
      );
    } else {
      logger.warn(
        {
          eventName: event?.name,
          subscriber: subscriberName,
          reason,
          correlationId: event?._correlationId,
          traceId: event?._traceId,
        },
        `[autotel] Event dropped: ${reason}`,
      );
    }
  }

  /**
   * Record permanent delivery failure (after all retries exhausted)
   * Increments failed counter and logs error
   */
  private recordFailed(
    event: EventData,
    subscriberName: string,
    error?: Error,
  ): void {
    this.metrics?.failed.add(1, { subscriber: subscriberName });

    // Mark subscriber as unhealthy
    this.subscriberHealthy.set(subscriberName, false);

    // Debug breadcrumb log
    getLogger().error(
      {
        eventName: event.name,
        subscriber: subscriberName,
        correlationId: event._correlationId,
        traceId: event._traceId,
        err: error,
      },
      `[autotel] Event delivery failed after all retries`,
    );
  }

  /**
   * Mark subscriber as unhealthy on transient failure (without incrementing failed counter)
   * Used during retry attempts - only recordFailed should increment the counter
   */
  private markSubscriberUnhealthy(subscriberName: string): void {
    this.subscriberHealthy.set(subscriberName, false);
  }

  /**
   * Record successful delivery
   */
  private recordDelivered(
    event: EventData,
    subscriberName: string,
    startTime: number,
  ): void {
    const latencyMs = Date.now() - startTime;

    this.metrics?.delivered.add(1, { subscriber: subscriberName });
    this.metrics?.latency.record(latencyMs, { subscriber: subscriberName });

    // Mark subscriber as healthy
    this.subscriberHealthy.set(subscriberName, true);
  }

  /**
   * Enqueue an event for sending
   *
   * Backpressure policy:
   * - Drops oldest event and logs warning if queue is full (same behavior in all environments)
   */
  enqueue(event: EventData): void {
    // Reject events during shutdown
    if (this.isShuttingDown) {
      this.recordDropped('shutdown', event);
      return;
    }

    // Check queue size
    if (this.queue.length >= this.config.maxSize) {
      // Drop oldest event and log warning (same behavior in all environments)
      const droppedEvent = this.queue.shift();
      this.recordDropped('rate_limit', droppedEvent);
      getLogger().warn(
        {
          droppedEvent: droppedEvent?.name,
        },
        `[autotel] Events queue full (${this.config.maxSize} events). ` +
          'Dropping oldest event. Events are being produced faster than they can be sent. ' +
          'Check your subscribers or reduce tracking frequency.',
      );
    }

    // Enrich event with correlation context for debug breadcrumbs
    const enrichedEvent: EventData = {
      ...event,
      _correlationId: event._correlationId || getOrCreateCorrelationId(),
    };

    this.queue.push(enrichedEvent);
    this.scheduleBatchFlush();
  }

  /**
   * Schedule a batch flush if not already scheduled
   */
  private scheduleBatchFlush(): void {
    if (this.flushTimer || this.flushPromise) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushBatch();
    }, this.config.flushInterval);
  }

  /**
   * Flush a batch of events
   * Uses promise-based concurrency control to prevent race conditions
   */
  private async flushBatch(): Promise<void> {
    if (this.queue.length === 0) return;

    // If already flushing, wait for existing flush
    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }

    this.flushPromise = this.doFlushBatch();

    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;

      // Schedule next flush if more events
      if (this.queue.length > 0) {
        this.scheduleBatchFlush();
      }
    }
  }

  /**
   * Internal flush implementation
   */
  private async doFlushBatch(): Promise<void> {
    const batch = this.queue.splice(0, this.config.batchSize);
    await this.sendWithRetry(batch, this.config.maxRetries);
  }

  /**
   * Send events with exponential backoff retry
   * Tracks per-event, per-subscriber failures so failed counter reflects actual failed deliveries.
   * On retry, only failed (event, subscriber) pairs are re-sent to avoid double-counting delivered.
   */
  private async sendWithRetry(
    events: EventData[],
    retriesLeft: number,
    subscribersByEventIndex?: Map<number, Set<string>>,
  ): Promise<void> {
    const failedDeliveries = await this.sendToSubscribers(
      events,
      subscribersByEventIndex,
    );

    if (failedDeliveries.length > 0) {
      if (retriesLeft > 0) {
        // Retry only events that had at least one failure, and only to subscribers that failed (avoid re-sending to healthy subscribers and double-counting delivered)
        const failedEventIndices = new Set(
          failedDeliveries.map((f) => f.eventIndex),
        );
        const failedEventIndicesOrdered = [...failedEventIndices].sort(
          (a, b) => a - b,
        );
        const eventsToRetry = failedEventIndicesOrdered.map(
          (i) => events[i],
        ) as EventData[];
        const failedSubscribersByRetryIndex = new Map<number, Set<string>>();
        for (let j = 0; j < failedEventIndicesOrdered.length; j++) {
          const origIndex = failedEventIndicesOrdered[j];
          const set = new Set<string>();
          for (const { eventIndex, subscriberName } of failedDeliveries) {
            if (eventIndex === origIndex) set.add(subscriberName);
          }
          failedSubscribersByRetryIndex.set(j, set);
        }
        const delay = Math.pow(2, this.config.maxRetries - retriesLeft) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendWithRetry(
          eventsToRetry,
          retriesLeft - 1,
          failedSubscribersByRetryIndex,
        );
      } else {
        // Give up after max retries - record one failure per (event, subscriber) pair
        for (const { eventIndex, subscriberName, error } of failedDeliveries) {
          const event = events[eventIndex];
          if (event) this.recordFailed(event, subscriberName, error);
        }

        const failedSubscriberNames = [
          ...new Set(failedDeliveries.map((f) => f.subscriberName)),
        ];
        getLogger().error(
          {
            failedSubscribers: failedSubscriberNames,
            retriesAttempted: this.config.maxRetries,
          },
          '[autotel] Failed to send events after retries',
        );
      }
    }
  }

  /**
   * Send events to configured subscribers with rate limiting and metrics.
   * When subscribersByEventIndex is provided (retry path), only those subscribers are tried per event.
   * Returns per-event, per-subscriber failures (empty if all succeeded).
   */
  private async sendToSubscribers(
    events: EventData[],
    subscribersByEventIndex?: Map<number, Set<string>>,
  ): Promise<
    Array<{ eventIndex: number; subscriberName: string; error?: Error }>
  > {
    const failedDeliveries: Array<{
      eventIndex: number;
      subscriberName: string;
      error?: Error;
    }> = [];

    const sendOne = async (event: EventData, eventIndex: number) => {
      // On retry, only try subscribers that failed for this event (never re-send to healthy subscribers)
      const subscriberNames = subscribersByEventIndex?.get(eventIndex);
      const failures = await this.sendEventToSubscribers(
        event,
        subscriberNames ?? undefined,
      );
      for (const failure of failures) {
        failedDeliveries.push({
          eventIndex,
          subscriberName: failure.subscriberName,
          error: failure.error,
        });
      }
    };

    if (!this.rateLimiter) {
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (event) await sendOne(event, i);
      }
      return failedDeliveries;
    }

    for (let i = 0; i < events.length; i++) {
      await this.rateLimiter.waitForToken();
      const event = events[i];
      if (event) await sendOne(event, i);
    }

    return failedDeliveries;
  }

  /**
   * Send a single event to subscribers.
   * - When subscriberNames is undefined (initial attempt): send to all subscribers.
   * - When subscriberNames is provided (retry): send only to those subscribers (never re-send to healthy ones).
   * Returns list of subscribers that failed (empty if all succeeded).
   */
  private async sendEventToSubscribers(
    event: EventData,
    subscriberNames?: Set<string>,
  ): Promise<Array<{ subscriberName: string; error?: Error }>> {
    const startTime = event.timestamp;
    const failures: Array<{ subscriberName: string; error?: Error }> = [];

    const subscribersToTry =
      subscriberNames === undefined
        ? this.subscribers
        : this.subscribers.filter((s) =>
            subscriberNames.has(getSubscriberName(s)),
          );

    const results = await Promise.allSettled(
      subscribersToTry.map(async (subscriber) => {
        const subscriberName = getSubscriberName(subscriber);

        try {
          await subscriber.trackEvent(event.name, event.attributes, {
            autotel: event.autotel,
          });
          this.recordDelivered(event, subscriberName, startTime);
          return { subscriberName, success: true };
        } catch (error) {
          this.markSubscriberUnhealthy(subscriberName);
          return {
            subscriberName,
            success: false,
            error: error instanceof Error ? error : undefined,
          };
        }
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && !result.value.success) {
        failures.push({
          subscriberName: result.value.subscriberName,
          error: result.value.error,
        });
      }
    }

    return failures;
  }

  /**
   * Flush all remaining events. Queue remains usable after flush (e.g. for
   * auto-flush at root span end). Use shutdown() when tearing down the queue.
   */
  async flush(): Promise<void> {
    // Cancel any pending timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Wait for any in-progress flush to complete
    if (this.flushPromise) {
      await this.flushPromise;
    }

    // Flush all remaining batches
    while (this.queue.length > 0) {
      await this.doFlushBatch();
    }
  }

  /**
   * Flush remaining events and permanently disable the queue (reject new events).
   * Use for process/SDK shutdown; use flush() for periodic or span-end drain.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    await this.flush();
  }

  /**
   * Cleanup observable metric callbacks to prevent memory leaks
   * Call this when destroying the EventQueue instance
   */
  cleanup(): void {
    // Remove all observable callbacks
    for (const cleanupFn of this.observableCleanups) {
      try {
        cleanupFn();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.observableCleanups = [];
  }

  /**
   * Get queue size (for testing/debugging)
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Get subscriber health status (for testing/debugging)
   */
  getSubscriberHealth(): Map<string, boolean> {
    return new Map(this.subscriberHealthy);
  }

  /**
   * Check if a specific subscriber is healthy
   */
  isSubscriberHealthy(subscriberName: string): boolean {
    return this.subscriberHealthy.get(subscriberName.toLowerCase()) ?? true;
  }

  /**
   * Manually mark a subscriber as healthy or unhealthy
   * (used for circuit breaker integration)
   */
  setSubscriberHealth(subscriberName: string, healthy: boolean): void {
    this.subscriberHealthy.set(subscriberName.toLowerCase(), healthy);
  }
}
