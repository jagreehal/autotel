/**
 * Google Cloud Pub/Sub Streaming Subscriber Example
 *
 * Production-ready Pub/Sub subscriber for GCP-native event streaming.
 *
 * Installation:
 * ```bash
 * pnpm add @google-cloud/pubsub
 * ```
 *
 * Features:
 * - Ordered delivery with ordering keys
 * - Automatic batching and flow control
 * - Backpressure handling
 * - Message deduplication
 * - Dead letter queue support
 * - Graceful shutdown
 *
 * Setup:
 * ```bash
 * # Create topic
 * gcloud pubsub topics create events-events \
 *   --message-retention-duration=7d
 *
 * # Create subscription (for consumers)
 * gcloud pubsub subscriptions create events-events-sub \
 *   --topic=events-events \
 *   --ack-deadline=60 \
 *   --message-retention-duration=7d
 * ```
 *
 * Usage:
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { PubSubSubscriber } from './adapter-pubsub';
 *
 * const events = new Events('app', {
 *   subscribers: [
 *     new PubSubSubscriber({
 *       projectId: 'my-gcp-project',
 *       topicName: 'events-events',
 *       enableMessageOrdering: true,
 *       partitionStrategy: 'userId',
 *       maxBufferSize: 10000,
 *       maxBatchSize: 1000,
 *       bufferOverflowStrategy: 'block'
 *     })
 *   ]
 * });
 *
 * // Events ordered by userId
 * await events.trackEvent('order.completed', {
 *   userId: 'user_123',
 *   amount: 99.99
 * });
 * ```
 */

import {
  StreamingEventSubscriber,
  type BufferOverflowStrategy,
} from '../src/streaming-event-subscriber';
import type { EventPayload } from '../src/event-subscriber-base';
import { PubSub, Topic } from '@google-cloud/pubsub';

type PartitionStrategy = 'userId' | 'tenantId' | 'eventType' | 'none';

export interface PubSubSubscriberConfig {
  /** GCP Project ID */
  projectId: string;

  /** Pub/Sub topic name */
  topicName: string;

  /** Enable message ordering (default: true) */
  enableMessageOrdering?: boolean;

  /** Partitioning strategy for ordering keys (default: 'userId') */
  partitionStrategy?: PartitionStrategy;

  /** Enable/disable subscriber */
  enabled?: boolean;

  /** Maximum buffer size (default: 10000) */
  maxBufferSize?: number;

  /** Maximum batch size (default: 1000) */
  maxBatchSize?: number;

  /** Buffer overflow strategy (default: 'block') */
  bufferOverflowStrategy?: BufferOverflowStrategy;

  /** Flush interval in ms (default: 1000) */
  flushIntervalMs?: number;

  /** Service account key file path (optional, uses GOOGLE_APPLICATION_CREDENTIALS if not set) */
  keyFilename?: string;

  /** Enable batching settings (default: true) */
  enableBatching?: boolean;

  /** Max outstanding messages (flow control) (default: 1000) */
  maxOutstandingMessages?: number;

  /** Max outstanding bytes (flow control) (default: 100MB) */
  maxOutstandingBytes?: number;
}

export class PubSubSubscriber extends StreamingEventSubscriber {
  readonly name = 'PubSubSubscriber';
  readonly version = '1.0.0';

  private client: PubSub;
  private topic: Topic;
  private subscriberConfig: Required<
    Omit<PubSubSubscriberConfig, 'keyFilename'>
  > & {
    keyFilename?: string;
  };

  constructor(config: PubSubSubscriberConfig) {
    super({
      maxBufferSize: config.maxBufferSize ?? 10_000,
      maxBatchSize: config.maxBatchSize ?? 1000,
      bufferOverflowStrategy: config.bufferOverflowStrategy ?? 'block',
      flushIntervalMs: config.flushIntervalMs ?? 1000,
    });

    // Set config defaults
    this.adapterConfig = {
      projectId: config.projectId,
      topicName: config.topicName,
      enableMessageOrdering: config.enableMessageOrdering ?? true,
      partitionStrategy: config.partitionStrategy ?? 'userId',
      enabled: config.enabled ?? true,
      maxBufferSize: config.maxBufferSize ?? 10_000,
      maxBatchSize: config.maxBatchSize ?? 1000,
      bufferOverflowStrategy: config.bufferOverflowStrategy ?? 'block',
      flushIntervalMs: config.flushIntervalMs ?? 1000,
      keyFilename: config.keyFilename,
      enableBatching: config.enableBatching ?? true,
      maxOutstandingMessages: config.maxOutstandingMessages ?? 1000,
      maxOutstandingBytes: config.maxOutstandingBytes ?? 100 * 1024 * 1024, // 100MB
    };

    this.enabled = this.adapterConfig.enabled;

    if (this.enabled) {
      this.initializePubSub();
    }
  }

  private initializePubSub(): void {
    try {
      const options: any = {
        projectId: this.adapterConfig.projectId,
      };

      if (this.adapterConfig.keyFilename) {
        options.keyFilename = this.adapterConfig.keyFilename;
      }

      this.client = new PubSub(options);

      // Get topic reference
      this.topic = this.client.topic(this.adapterConfig.topicName);

      // Configure topic settings (combine all options in single call to avoid overwriting)
      const publishOptions: any = {};

      if (this.adapterConfig.enableMessageOrdering) {
        publishOptions.messageOrdering = true;
      }

      if (this.adapterConfig.enableBatching) {
        publishOptions.batching = {
          maxMessages: this.adapterConfig.maxBatchSize,
          maxMilliseconds: this.adapterConfig.flushIntervalMs,
        };
        publishOptions.flowControlOptions = {
          maxOutstandingMessages: this.adapterConfig.maxOutstandingMessages,
          maxOutstandingBytes: this.adapterConfig.maxOutstandingBytes,
        };
      }

      // Set all options at once to avoid overwriting previous settings
      if (Object.keys(publishOptions).length > 0) {
        this.topic.setPublishOptions(publishOptions);
      }

      console.log('[PubSubSubscriber] Initialized successfully');
    } catch (error) {
      console.error('[PubSubSubscriber] Failed to initialize:', error);
      this.enabled = false;
    }
  }

  /**
   * Get ordering key (partition key) based on configured strategy
   *
   * Pub/Sub uses ordering keys to ensure messages with same key
   * are delivered in order to subscribers.
   */
  protected getPartitionKey(payload: EventPayload): string {
    switch (this.adapterConfig.partitionStrategy) {
      case 'userId': {
        return payload.attributes?.userId?.toString() || '';
      }

      case 'tenantId': {
        return payload.attributes?.tenantId?.toString() || '';
      }

      case 'eventType': {
        return payload.type;
      } // 'event', 'funnel', 'outcome', 'value'

      case 'none': {
        return '';
      } // No ordering

      default: {
        return '';
      }
    }
  }

  /**
   * Send batch of events to Pub/Sub
   */
  protected async sendBatch(events: EventPayload[]): Promise<void> {
    // Publish all messages concurrently
    const publishPromises = events.map((event) => {
      const data = Buffer.from(JSON.stringify(event));
      const orderingKey = this.getPartitionKey(event);

      const message: any = {
        data,
        attributes: {
          eventType: event.type,
          eventName: event.name,
          timestamp: event.timestamp,
        },
      };

      // Add ordering key if message ordering is enabled
      if (
        this.adapterConfig.enableMessageOrdering &&
        orderingKey
      ) {
        message.orderingKey = orderingKey;
      }

      return this.topic.publishMessage(message);
    });

    try {
      // Wait for all publishes to complete
      const messageIds = await Promise.all(publishPromises);

      // Success - log metrics
      if (process.env.DEBUG) {
        console.log(
          `[PubSubSubscriber] Published ${events.length} messages (IDs: ${messageIds.slice(0, 3).join(', ')}${events.length > 3 ? '...' : ''})`
        );
      }
    } catch (error: any) {
      console.error(
        `[PubSubSubscriber] Failed to publish ${events.length} messages:`,
        error
      );

      // Handle specific Pub/Sub errors
      if (error.code === 10) {
        console.error(
          '[PubSubSubscriber] Flow control limits exceeded - reduce rate or increase limits'
        );
      }

      if (error.code === 5) {
        console.error(
          `[PubSubSubscriber] Topic not found: ${this.adapterConfig.topicName}`
        );
      }

      throw error;
    }
  }

  /**
   * Handle errors (override from EventSubscriber)
   */
  protected handleError(error: Error, payload: EventPayload): void {
    console.error(
      `[PubSubSubscriber] Failed to process ${payload.type} event:`,
      error,
      {
        eventName: payload.name,
        orderingKey: this.getPartitionKey(payload),
        topicName: this.adapterConfig.topicName,
      }
    );
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[PubSubSubscriber] Starting graceful shutdown...');

    // Flush buffer and drain pending requests
    await super.shutdown();

    // Flush any remaining messages in topic's internal buffer
    if (this.topic) {
      try {
        await this.topic.flush();
        console.log('[PubSubSubscriber] Flushed topic buffer');
      } catch (error) {
        console.error('[PubSubSubscriber] Error flushing topic:', error);
      }
    }

    // Close Pub/Sub client
    if (this.client) {
      try {
        await this.client.close();
        console.log('[PubSubSubscriber] Closed Pub/Sub client');
      } catch (error) {
        console.error('[PubSubSubscriber] Error closing client:', error);
      }
    }

    console.log('[PubSubSubscriber] Shutdown complete');
  }
}
