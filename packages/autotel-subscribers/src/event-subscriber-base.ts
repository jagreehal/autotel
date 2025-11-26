/**
 * EventSubscriber - Standard base class for building custom subscribers
 *
 * This is the recommended base class for creating custom events subscribers.
 * It provides production-ready features out of the box:
 *
 * **Built-in Features:**
 * - **Error Handling**: Automatic error catching with customizable handlers
 * - **Pending Request Tracking**: Ensures all requests complete during shutdown
 * - **Graceful Shutdown**: Drains pending requests before closing
 * - **Enable/Disable**: Runtime control to turn subscriber on/off
 * - **Normalized Payload**: Consistent event structure across all event types
 *
 * **When to use:**
 * - Building custom subscribers for any platform
 * - Production deployments requiring reliability
 * - Need graceful shutdown and error handling
 *
 * @example Basic usage
 * ```typescript
 * import { EventSubscriber, EventPayload } from 'autotel-subscribers';
 *
 * class SnowflakeSubscriber extends EventSubscriber {
 *   name = 'SnowflakeSubscriber';
 *   version = '1.0.0';
 *
 *   protected async sendToDestination(payload: EventPayload): Promise<void> {
 *     await snowflakeClient.execute(
 *       `INSERT INTO events VALUES (?, ?, ?)`,
 *       [payload.type, payload.name, JSON.stringify(payload.attributes)]
 *     );
 *   }
 * }
 * ```
 *
 * @example With buffering
 * ```typescript
 * class BufferedSubscriber extends EventSubscriber {
 *   name = 'BufferedSubscriber';
 *   private buffer: EventPayload[] = [];
 *
 *   protected async sendToDestination(payload: EventPayload): Promise<void> {
 *     this.buffer.push(payload);
 *
 *     if (this.buffer.length >= 100) {
 *       await this.flush();
 *     }
 *   }
 *
 *   async shutdown(): Promise<void> {
 *     await super.shutdown(); // Drain pending requests first
 *     await this.flush(); // Then flush buffer
 *   }
 *
 *   private async flush(): Promise<void> {
 *     if (this.buffer.length === 0) return;
 *
 *     const batch = [...this.buffer];
 *     this.buffer = [];
 *
 *     await apiClient.sendBatch(batch);
 *   }
 * }
 * ```
 */

import type {
  EventSubscriber as IEventSubscriber,
  EventAttributes,
  FunnelStatus,
  OutcomeStatus,
} from 'autotel/event-subscriber';

// Re-export types for convenience


/**
 * Payload sent to destination
 */
export interface EventPayload {
  /** Event type: 'event', 'funnel', 'outcome', or 'value' */
  type: 'event' | 'funnel' | 'outcome' | 'value';

  /** Event name or metric name */
  name: string;

  /** Optional attributes */
  attributes?: EventAttributes;

  /** For funnel events: funnel name */
  funnel?: string;

  /** For funnel events: step status */
  step?: FunnelStatus;

  /** For outcome events: operation name */
  operation?: string;

  /** For outcome events: outcome status */
  outcome?: OutcomeStatus;

  /** For value events: numeric value */
  value?: number;

  /** Timestamp (ISO 8601) */
  timestamp: string;
}

/**
 * Standard base class for building custom events subscribers
 *
 * **What it provides:**
 * - Consistent payload structure (normalized across all event types)
 * - Enable/disable flag (runtime control)
 * - Automatic error handling (with customizable error handlers)
 * - Pending requests tracking (ensures no lost events during shutdown)
 * - Graceful shutdown (drains pending requests before closing)
 *
 * **Usage:**
 * Extend this class and implement `sendToDestination()`. All other methods
 * (trackEvent, trackFunnelStep, trackOutcome, trackValue, shutdown) are handled automatically.
 *
 * For high-throughput streaming platforms (Kafka, Kinesis, Pub/Sub), use `StreamingEventSubscriber` instead.
 */
export abstract class EventSubscriber implements IEventSubscriber {
  /**
   * Subscriber name (required for debugging)
   */
  abstract readonly name: string;

  /**
   * Subscriber version (optional)
   */
  readonly version?: string;

  /**
   * Enable/disable the subscriber (default: true)
   */
  protected enabled: boolean = true;

  /**
   * Track pending requests for graceful shutdown
   */
  private pendingRequests: Set<Promise<void>> = new Set();

  /**
   * Send payload to destination
   *
   * Override this method to implement your destination-specific logic.
   * This is called for all event types (event, funnel, outcome, value).
   *
   * @param payload - Normalized event payload
   */
  protected abstract sendToDestination(payload: EventPayload): Promise<void>;

  /**
   * Optional: Handle errors
   *
   * Override this to customize error handling (logging, retries, etc.).
   * Default behavior: log to console.error
   *
   * @param error - Error that occurred
   * @param payload - Event payload that failed
   */
  protected handleError(error: Error, payload: EventPayload): void {
    console.error(
      `[${this.name}] Failed to send ${payload.type}:`,
      error,
      payload,
    );
  }

  /**
   * Track an event
   */
  async trackEvent(name: string, attributes?: EventAttributes): Promise<void> {
    if (!this.enabled) return;

    const payload: EventPayload = {
      type: 'event',
      name,
      attributes,
      timestamp: new Date().toISOString(),
    };

    await this.send(payload);
  }

  /**
   * Track a funnel step
   */
  async trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    if (!this.enabled) return;

    const payload: EventPayload = {
      type: 'funnel',
      name: `${funnelName}.${step}`,
      funnel: funnelName,
      step,
      attributes,
      timestamp: new Date().toISOString(),
    };

    await this.send(payload);
  }

  /**
   * Track an outcome
   */
  async trackOutcome(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    if (!this.enabled) return;

    const payload: EventPayload = {
      type: 'outcome',
      name: `${operationName}.${outcome}`,
      operation: operationName,
      outcome,
      attributes,
      timestamp: new Date().toISOString(),
    };

    await this.send(payload);
  }

  /**
   * Track a value/metric
   */
  async trackValue(
    name: string,
    value: number,
    attributes?: EventAttributes,
  ): Promise<void> {
    if (!this.enabled) return;

    const payload: EventPayload = {
      type: 'value',
      name,
      value,
      attributes,
      timestamp: new Date().toISOString(),
    };

    await this.send(payload);
  }

  /**
   * Flush pending requests and clean up
   *
   * CRITICAL: Prevents race condition during shutdown
   * 1. Disables subscriber to stop new events
   * 2. Drains all pending requests (with retry logic)
   * 3. Ensures flush guarantee
   *
   * Override this if you need custom cleanup logic (close connections, flush buffers, etc.),
   * but ALWAYS call super.shutdown() first to drain pending requests.
   */
  async shutdown(): Promise<void> {
    // 1. Stop accepting new events (prevents race condition)
    this.enabled = false;

    // 2. Drain pending requests with retry logic
    // Loop until empty to handle race where new requests added during Promise.allSettled
    const maxDrainAttempts = 10;
    const drainIntervalMs = 50;

    for (let attempt = 0; attempt < maxDrainAttempts; attempt++) {
      if (this.pendingRequests.size === 0) {
        break;
      }

      // Wait for current batch
      await Promise.allSettled(this.pendingRequests);

      // Small delay to catch any stragglers added during allSettled
      if (this.pendingRequests.size > 0 && attempt < maxDrainAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, drainIntervalMs));
      }
    }

    // 3. Warn if we still have pending requests (shouldn't happen, but be defensive)
    if (this.pendingRequests.size > 0) {
      console.warn(
        `[${this.name}] Shutdown completed with ${this.pendingRequests.size} pending requests still in-flight. ` +
        `This may indicate a bug in the subscriber or extremely slow destination.`
      );
    }
  }

  /**
   * Internal: Send payload and track request
   */
  private async send(payload: EventPayload): Promise<void> {
    const request = this.sendWithErrorHandling(payload);
    this.pendingRequests.add(request);

    void request.finally(() => {
      this.pendingRequests.delete(request);
    });

    return request;
  }

  /**
   * Internal: Send with error handling
   */
  private async sendWithErrorHandling(
    payload: EventPayload,
  ): Promise<void> {
    try {
      await this.sendToDestination(payload);
    } catch (error) {
      this.handleError(error as Error, payload);
    }
  }
}

export {type EventAttributes, type FunnelStatus, type OutcomeStatus} from 'autotel/event-subscriber';