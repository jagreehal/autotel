/**
 * Kafka Streaming Subscriber Example
 *
 * Production-ready Kafka subscriber for high-throughput, ordered event streaming.
 *
 * Installation:
 * ```bash
 * pnpm add kafkajs
 * ```
 *
 * Features:
 * - Partitioning by userId for ordered events per user
 * - High-throughput batching (configurable up to 10,000+ events/batch)
 * - Backpressure handling
 * - Automatic retries with exponential backoff
 * - Compression support (gzip, snappy, lz4, zstd)
 * - Graceful shutdown with buffer draining
 *
 * Usage:
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { KafkaSubscriber } from './adapter-kafka';
 *
 * const events = new Events('app', {
 *   subscribers: [
 *     new KafkaSubscriber({
 *       clientId: 'events-producer',
 *       brokers: ['kafka1:9092', 'kafka2:9092', 'kafka3:9092'],
 *       topic: 'events.events',
 *       partitionStrategy: 'userId', // or 'tenantId', 'eventType', 'round-robin'
 *       compression: 'gzip',
 *       maxBufferSize: 10000,
 *       maxBatchSize: 1000,
 *       bufferOverflowStrategy: 'block'
 *     })
 *   ]
 * });
 *
 * // High-throughput: 10k+ events/sec
 * for (let i = 0; i < 10000; i++) {
 *   await events.trackEvent('page.viewed', { userId: `user_${i % 100}` });
 * }
 *
 * // Graceful shutdown
 * await events.flush();
 * ```
 */

import {
  StreamingEventSubscriber,
  type BufferOverflowStrategy,
} from '../src/streaming-event-subscriber';
import type { EventPayload } from '../src/event-subscriber-base';
import { Kafka, Producer, CompressionTypes, type ProducerRecord } from 'kafkajs';

type CompressionType = 'gzip' | 'snappy' | 'lz4' | 'zstd' | 'none';
type PartitionStrategy = 'userId' | 'tenantId' | 'eventType' | 'round-robin';

export interface KafkaSubscriberConfig {
  /** Kafka client ID */
  clientId: string;

  /** Kafka broker addresses */
  brokers: string[];

  /** Topic to publish events to */
  topic: string;

  /** Partitioning strategy (default: 'userId') */
  partitionStrategy?: PartitionStrategy;

  /** Compression type (default: 'gzip') */
  compression?: CompressionType;

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

  /** SASL authentication (optional) */
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };

  /** SSL/TLS configuration (optional) */
  ssl?: boolean;
}

export class KafkaSubscriber extends StreamingEventSubscriber {
  readonly name = 'KafkaSubscriber';
  readonly version = '1.0.0';

  private kafka: Kafka;
  private producer: Producer;
  private subscriberConfig: Required<Omit<KafkaSubscriberConfig, 'sasl' | 'ssl'>> & {
    sasl?: KafkaSubscriberConfig['sasl'];
    ssl?: boolean;
  };
  private roundRobinCounter = 0;
  private isConnected = false;

  constructor(config: KafkaSubscriberConfig) {
    super({
      maxBufferSize: config.maxBufferSize ?? 10_000,
      maxBatchSize: config.maxBatchSize ?? 1000,
      bufferOverflowStrategy: config.bufferOverflowStrategy ?? 'block',
      flushIntervalMs: config.flushIntervalMs ?? 1000,
    });

    // Set config defaults
    this.adapterConfig = {
      clientId: config.clientId,
      brokers: config.brokers,
      topic: config.topic,
      partitionStrategy: config.partitionStrategy ?? 'userId',
      compression: config.compression ?? 'gzip',
      enabled: config.enabled ?? true,
      maxBufferSize: config.maxBufferSize ?? 10_000,
      maxBatchSize: config.maxBatchSize ?? 1000,
      bufferOverflowStrategy: config.bufferOverflowStrategy ?? 'block',
      flushIntervalMs: config.flushIntervalMs ?? 1000,
      sasl: config.sasl,
      ssl: config.ssl,
    };

    this.enabled = this.adapterConfig.enabled;

    if (this.enabled) {
      this.initializeKafka();
    }
  }

  private initializeKafka(): void {
    try {
      // Initialize Kafka client
      this.kafka = new Kafka({
        clientId: this.adapterConfig.clientId,
        brokers: this.adapterConfig.brokers,
        sasl: this.adapterConfig.sasl,
        ssl: this.adapterConfig.ssl,
        retry: {
          initialRetryTime: 100,
          retries: 8,
          maxRetryTime: 30_000,
          multiplier: 2,
        },
      });

      // Create producer
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: false,
        compression: this.getCompressionType(this.adapterConfig.compression),
        maxInFlightRequests: 5,
        idempotent: true, // Exactly-once semantics
      });

      // Connect asynchronously
      void this.connect();
    } catch (error) {
      console.error('[KafkaSubscriber] Failed to initialize:', error);
      this.enabled = false;
    }
  }

  private async connect(): Promise<void> {
    try {
      await this.producer.connect();
      this.isConnected = true;
      console.log('[KafkaSubscriber] Connected successfully');
    } catch (error) {
      console.error('[KafkaSubscriber] Failed to connect:', error);
      this.enabled = false;
      this.isConnected = false;
    }
  }

  private getCompressionType(compression: CompressionType): CompressionTypes {
    switch (compression) {
      case 'gzip': {
        return CompressionTypes.GZIP;
      }
      case 'snappy': {
        return CompressionTypes.Snappy;
      }
      case 'lz4': {
        return CompressionTypes.LZ4;
      }
      case 'zstd': {
        return CompressionTypes.ZSTD;
      }
      default: {
        return CompressionTypes.None;
      }
    }
  }

  /**
   * Get partition key based on configured strategy
   */
  protected getPartitionKey(payload: EventPayload): string {
    switch (this.adapterConfig.partitionStrategy) {
      case 'userId': {
        return payload.attributes?.userId?.toString() || 'default';
      }

      case 'tenantId': {
        return payload.attributes?.tenantId?.toString() || 'default';
      }

      case 'eventType': {
        return payload.type;
      } // 'event', 'funnel', 'outcome', 'value'

      case 'round-robin': {
        // Round-robin across partitions
        this.roundRobinCounter = (this.roundRobinCounter + 1) % 100;
        return `partition-${this.roundRobinCounter}`;
      }

      default: {
        return 'default';
      }
    }
  }

  /**
   * Send batch of events to Kafka
   */
  protected async sendBatch(events: EventPayload[]): Promise<void> {
    if (!this.isConnected) {
      throw new Error('[KafkaSubscriber] Producer not connected');
    }

    // Build Kafka messages
    const messages = events.map((event) => ({
      key: this.getPartitionKey(event),
      value: JSON.stringify(event),
      headers: {
        'event-type': event.type,
        'event-name': event.name,
        timestamp: event.timestamp,
      },
    }));

    // Send to Kafka
    const record: ProducerRecord = {
      topic: this.adapterConfig.topic,
      messages,
    };

    try {
      const result = await this.producer.send(record);

      // Log successful send (debug)
      if (process.env.DEBUG) {
        console.log(
          `[KafkaSubscriber] Sent ${messages.length} events to partition ${result[0].partition}`
        );
      }
    } catch (error) {
      console.error(
        `[KafkaSubscriber] Failed to send ${messages.length} events:`,
        error
      );
      throw error; // Re-throw for retry logic
    }
  }

  /**
   * Handle errors (override from EventSubscriber)
   */
  protected handleError(error: Error, payload: EventPayload): void {
    console.error(
      `[KafkaSubscriber] Failed to process ${payload.type} event:`,
      error,
      {
        eventName: payload.name,
        partitionKey: this.getPartitionKey(payload),
      }
    );

    // Check for specific Kafka errors
    if (error.message.includes('NOT_LEADER_FOR_PARTITION')) {
      console.error(
        '[KafkaSubscriber] Partition leadership changed - will retry'
      );
    }

    if (error.message.includes('BROKER_NOT_AVAILABLE')) {
      console.error('[KafkaSubscriber] Broker unavailable - check cluster health');
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[KafkaSubscriber] Starting graceful shutdown...');

    // Flush buffer and drain pending requests
    await super.shutdown();

    // Disconnect producer
    if (this.isConnected && this.producer) {
      try {
        await this.producer.disconnect();
        this.isConnected = false;
        console.log('[KafkaSubscriber] Disconnected successfully');
      } catch (error) {
        console.error('[KafkaSubscriber] Error during disconnect:', error);
      }
    }
  }
}
