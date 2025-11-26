/**
 * Streaming Events Subscriber Base Class
 *
 * Specialized base class for high-throughput streaming platforms like
 * Kafka, Kinesis, Pub/Sub, etc.
 *
 * Extends EventSubscriber with streaming-specific features:
 * - Partitioning strategy for ordered delivery
 * - Buffer overflow handling (drop/block/disk)
 * - High-throughput optimizations
 * - Backpressure signaling
 *
 * @example Kafka Streaming Subscriber
 * ```typescript
 * import { StreamingEventSubscriber } from 'autotel-subscribers/streaming-event-subscriber';
 *
 * class KafkaSubscriber extends StreamingEventSubscriber {
 *   name = 'KafkaSubscriber';
 *   version = '1.0.0';
 *
 *   constructor(config: KafkaConfig) {
 *     super({
 *       maxBufferSize: 10000,
 *       bufferOverflowStrategy: 'block',
 *       maxBatchSize: 500
 *     });
 *   }
 *
 *   protected getPartitionKey(payload: EventPayload): string {
 *     // Partition by userId for ordered events per user
 *     return payload.attributes?.userId || 'default';
 *   }
 *
 *   protected async sendBatch(events: EventPayload[]): Promise<void> {
 *     await this.producer.send({
 *       topic: this.topic,
 *       messages: events.map(e => ({
 *         key: this.getPartitionKey(e),
 *         value: JSON.stringify(e)
 *       }))
 *     });
 *   }
 * }
 * ```
 */

import {
  EventSubscriber,
  type EventPayload,
} from './event-subscriber-base';

/**
 * Buffer overflow strategy
 *
 * - 'drop': Drop new events when buffer is full (prevents blocking, but loses data)
 * - 'block': Wait for space in buffer (backpressure, may slow application)
 * - 'disk': Spill to disk when memory buffer full (reliable, but complex - not implemented yet)
 */
export type BufferOverflowStrategy = 'drop' | 'block' | 'disk';

/**
 * Streaming subscriber configuration
 */
export interface StreamingSubscriberConfig {
  /** Maximum buffer size before triggering overflow strategy (default: 10000) */
  maxBufferSize?: number;

  /** Strategy when buffer is full (default: 'block') */
  bufferOverflowStrategy?: BufferOverflowStrategy;

  /** Maximum batch size for sending (default: 500) */
  maxBatchSize?: number;

  /** Flush interval in milliseconds (default: 1000) */
  flushIntervalMs?: number;

  /** Enable compression (default: false) */
  compressionEnabled?: boolean;
}

/**
 * Buffer status for monitoring
 */
export interface BufferStatus {
  /** Current number of events in buffer */
  size: number;

  /** Maximum capacity */
  capacity: number;

  /** Utilization percentage (0-100) */
  utilization: number;

  /** Is buffer near full (>80%) */
  isNearFull: boolean;

  /** Is buffer full (100%) */
  isFull: boolean;
}

/**
 * Streaming Events Subscriber Base Class
 *
 * Provides streaming-specific patterns on top of EventSubscriber.
 */
export abstract class StreamingEventSubscriber extends EventSubscriber {
  protected config: Required<StreamingSubscriberConfig>;
  protected buffer: EventPayload[] = [];
  protected flushIntervalHandle: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(config: StreamingSubscriberConfig = {}) {
    super();

    // Set defaults
    this.config = {
      maxBufferSize: config.maxBufferSize ?? 10_000,
      bufferOverflowStrategy: config.bufferOverflowStrategy ?? 'block',
      maxBatchSize: config.maxBatchSize ?? 500,
      flushIntervalMs: config.flushIntervalMs ?? 1000,
      compressionEnabled: config.compressionEnabled ?? false,
    };

    // Start periodic flushing
    this.startFlushInterval();
  }

  /**
   * Get partition key for event
   *
   * Override this to implement your partitioning strategy.
   * Events with the same partition key go to the same partition/shard.
   *
   * Common strategies:
   * - By userId: Ordered events per user
   * - By tenantId: Isolate tenants
   * - By eventType: Group similar events
   * - Round-robin: Load balancing
   *
   * @param payload - Event payload
   * @returns Partition key (string)
   *
   * @example Partition by userId
   * ```typescript
   * protected getPartitionKey(payload: EventPayload): string {
   *   return payload.attributes?.userId || 'default';
   * }
   * ```
   */
  protected abstract getPartitionKey(payload: EventPayload): string;

  /**
   * Send batch of events to streaming platform
   *
   * Override this to implement platform-specific batch sending.
   * Called when buffer reaches maxBatchSize or flush interval triggers.
   *
   * @param events - Batch of events to send
   */
  protected abstract sendBatch(events: EventPayload[]): Promise<void>;

  /**
   * Send single event to destination (from EventSubscriber)
   *
   * This buffers events and sends in batches for performance.
   * Override sendBatch() instead of this method.
   */
  protected async sendToDestination(payload: EventPayload): Promise<void> {
    // Check buffer capacity before adding
    await this.ensureBufferCapacity();

    // Add to buffer
    this.buffer.push(payload);

    // Auto-flush if batch size reached
    if (this.buffer.length >= this.config.maxBatchSize) {
      await this.flushBuffer();
    }
  }

  /**
   * Ensure buffer has capacity for new event
   *
   * Implements buffer overflow strategy:
   * - 'drop': Returns immediately (event will be added, oldest may be dropped)
   * - 'block': Waits until space available (backpressure)
   * - 'disk': Not implemented yet (would spill to disk)
   */
  private async ensureBufferCapacity(): Promise<void> {
    if (this.buffer.length < this.config.maxBufferSize) {
      return; // Has space
    }

    // Buffer is full - apply overflow strategy
    switch (this.config.bufferOverflowStrategy) {
      case 'drop': {
        // Drop oldest event to make space
        this.buffer.shift();
        console.warn(
          `[${this.name}] Buffer full (${this.config.maxBufferSize}), dropped oldest event`
        );
        break;
      }

      case 'block': {
        // Wait for flush to complete (backpressure)
        console.warn(
          `[${this.name}] Buffer full (${this.config.maxBufferSize}), blocking until space available`
        );
        await this.flushBuffer();

        // If still full after flush, wait a bit and retry
        if (this.buffer.length >= this.config.maxBufferSize) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          await this.ensureBufferCapacity(); // Recursive retry
        }
        break;
      }

      case 'disk': {
        throw new Error(
          `[${this.name}] Disk overflow strategy not implemented yet`
        );
      }
    }
  }

  /**
   * Flush buffer to destination
   */
  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      await this.sendBatch(batch);
    } catch (error) {
      console.error(
        `[${this.name}] Failed to send batch of ${batch.length} events:`,
        error
      );

      // On failure, put events back in buffer (at front)
      this.buffer.unshift(...batch);

      // If we're near capacity, we need to make a decision
      if (this.buffer.length >= this.config.maxBufferSize * 0.9 && this.config.bufferOverflowStrategy === 'drop') {
          // Drop oldest to prevent runaway growth
          const toDrop = Math.floor(this.config.maxBufferSize * 0.1);
          this.buffer.splice(0, toDrop);
          console.warn(
            `[${this.name}] After failed flush, dropped ${toDrop} oldest events to prevent overflow`
          );
        }
    }
  }

  /**
   * Start periodic flushing
   */
  private startFlushInterval(): void {
    this.flushIntervalHandle = setInterval(() => {
      if (!this.isShuttingDown) {
        void this.flushBuffer();
      }
    }, this.config.flushIntervalMs);
  }

  /**
   * Get current buffer status (for monitoring/observability)
   */
  public getBufferStatus(): BufferStatus {
    const size = this.buffer.length;
    const capacity = this.config.maxBufferSize;
    const utilization = Math.round((size / capacity) * 100);

    return {
      size,
      capacity,
      utilization,
      isNearFull: utilization > 80,
      isFull: utilization >= 100,
    };
  }

  /**
   * Shutdown with proper buffer draining
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Stop flush interval (no more automatic flushes)
    if (this.flushIntervalHandle) {
      clearInterval(this.flushIntervalHandle);
      this.flushIntervalHandle = null;
    }

    // Call parent shutdown FIRST to:
    // 1. Set enabled = false (stop accepting new events)
    // 2. Drain any pending sendToDestination() calls
    await super.shutdown();

    // THEN flush remaining buffer
    // (no new events can arrive after super.shutdown() disabled the subscriber)
    await this.flushBuffer();
  }

  /**
   * Optional: Compress payload before sending
   *
   * Override this if your streaming platform supports compression.
   * Only called if compressionEnabled = true.
   */
  protected async compressPayload(
    payload: string
  ): Promise<Buffer | string> {
    // Default: no compression
    // Override with gzip, snappy, lz4, etc.
    return payload;
  }
}
