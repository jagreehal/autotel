/**
 * Consumer metrics for Kafka observability.
 *
 * Provides opt-in metrics collection for Kafka consumers, including
 * consumer lag tracking with configurable strategies.
 *
 * @example
 * ```typescript
 * import { ConsumerMetrics } from 'autotel-plugins/kafka';
 *
 * const metrics = new ConsumerMetrics({
 *   consumer,
 *   metricsPrefix: 'kafka.consumer',
 *   enableLag: true,
 *   lagStrategy: 'polling',
 *   lagPollIntervalMs: 30000,
 * });
 *
 * // Start metrics collection
 * await metrics.start();
 *
 * // ... consumer runs ...
 *
 * // Stop metrics collection
 * await metrics.stop();
 * ```
 */

import { metrics as otelMetrics } from '@opentelemetry/api';

/**
 * Lag tracking strategy.
 * - 'polling': Explicit admin calls (accurate, more overhead)
 * - 'event': Consumer events only (less accurate, no admin calls)
 * - 'hybrid': Event-based with periodic validation (default if enabled)
 */
export type LagStrategy = 'polling' | 'event' | 'hybrid';

/**
 * Minimal Kafka consumer interface for metrics collection.
 * Matches KafkaJS consumer shape.
 */
export interface KafkaConsumer {
  on(event: string, listener: (...args: unknown[]) => void): void;
  describeGroup?(): Promise<{
    members: Array<{
      memberId: string;
      clientId: string;
      memberAssignment: Buffer;
    }>;
    state: string;
  }>;
}

/**
 * Minimal Kafka admin interface for lag calculation.
 */
export interface KafkaAdmin {
  fetchTopicOffsets(
    topic: string,
  ): Promise<
    Array<{ partition: number; offset: string; high: string; low: string }>
  >;
  fetchOffsets(options: { groupId: string; topics: string[] }): Promise<
    Array<{
      topic: string;
      partitions: Array<{ partition: number; offset: string }>;
    }>
  >;
}

/**
 * Configuration for consumer metrics.
 */
export interface ConsumerMetricsConfig {
  /**
   * The Kafka consumer to monitor.
   */
  consumer: KafkaConsumer;

  /**
   * Optional Kafka admin client for lag calculation.
   * Required if enableLag is true and lagStrategy is 'polling' or 'hybrid'.
   */
  admin?: KafkaAdmin;

  /**
   * Consumer group ID (required for lag calculation).
   */
  groupId?: string;

  /**
   * Topics to monitor for lag.
   */
  topics?: string[];

  /**
   * Prefix for metric names.
   * @default 'kafka.consumer'
   */
  metricsPrefix?: string;

  /**
   * Enable consumer lag tracking.
   * @default false
   */
  enableLag?: boolean;

  /**
   * Strategy for lag calculation.
   * @default 'hybrid'
   */
  lagStrategy?: LagStrategy;

  /**
   * Interval for lag polling in milliseconds.
   * Required when enableLag is true and lagStrategy is 'polling'.
   * @default 30000
   */
  lagPollIntervalMs?: number;
}

/**
 * Internal state for tracking offsets.
 */
interface PartitionState {
  topic: string;
  partition: number;
  currentOffset: string;
  highWatermark?: string;
}

/**
 * Consumer metrics collector.
 *
 * Provides:
 * - kafka.consumer.messages_processed (counter)
 * - kafka.consumer.processing_duration (histogram)
 * - kafka.consumer.batch_size (histogram)
 * - kafka.consumer.rebalances (counter)
 * - kafka.consumer.lag (gauge, opt-in)
 */
export class ConsumerMetrics {
  private readonly config: Required<
    Pick<
      ConsumerMetricsConfig,
      'metricsPrefix' | 'enableLag' | 'lagStrategy' | 'lagPollIntervalMs'
    >
  > &
    ConsumerMetricsConfig;

  private readonly meter;
  private readonly messagesProcessed;
  private readonly processingDuration;
  private readonly batchSize;
  private readonly rebalances;
  private readonly lag;

  private partitionStates: Map<string, PartitionState> = new Map();
  private lagPollInterval?: ReturnType<typeof setInterval>;
  private isRunning = false;

  constructor(config: ConsumerMetricsConfig) {
    // Validate config
    if (
      config.enableLag &&
      config.lagStrategy === 'polling' &&
      !config.lagPollIntervalMs
    ) {
      throw new Error('Lag polling requires lagPollIntervalMs');
    }

    if (
      config.enableLag &&
      (config.lagStrategy === 'polling' || config.lagStrategy === 'hybrid')
    ) {
      if (!config.admin) {
        throw new Error(
          `Lag strategy '${config.lagStrategy}' requires admin client`,
        );
      }
      if (!config.groupId) {
        throw new Error('Lag tracking requires groupId');
      }
      if (!config.topics || config.topics.length === 0) {
        throw new Error('Lag tracking requires topics');
      }
    }

    this.config = {
      ...config,
      metricsPrefix: config.metricsPrefix ?? 'kafka.consumer',
      enableLag: config.enableLag ?? false,
      lagStrategy: config.lagStrategy ?? 'hybrid',
      lagPollIntervalMs: config.lagPollIntervalMs ?? 30_000,
    };

    // Initialize meter
    this.meter = otelMetrics.getMeter('autotel-plugins/kafka');
    const prefix = this.config.metricsPrefix;

    // Create metric instruments
    this.messagesProcessed = this.meter.createCounter(
      `${prefix}.messages_processed`,
      {
        description: 'Total number of messages processed',
      },
    );

    this.processingDuration = this.meter.createHistogram(
      `${prefix}.processing_duration`,
      {
        description: 'Message processing duration in milliseconds',
        unit: 'ms',
      },
    );

    this.batchSize = this.meter.createHistogram(`${prefix}.batch_size`, {
      description: 'Number of messages in each batch',
    });

    this.rebalances = this.meter.createCounter(`${prefix}.rebalances`, {
      description: 'Number of consumer group rebalances',
    });

    this.lag = this.meter.createObservableGauge(`${prefix}.lag`, {
      description: 'Consumer lag per topic-partition',
    });

    // Set up lag observation callback
    if (this.config.enableLag) {
      this.lag.addCallback((observableResult) => {
        for (const [, state] of this.partitionStates.entries()) {
          if (state.highWatermark) {
            const lagValue =
              BigInt(state.highWatermark) - BigInt(state.currentOffset);
            observableResult.observe(Number(lagValue), {
              topic: state.topic,
              partition: state.partition,
            });
          }
        }
      });
    }
  }

  /**
   * Start metrics collection.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const { consumer } = this.config;

    // Attach event listeners
    consumer.on('consumer.rebalancing', () => {
      this.rebalances.add(1, { event: 'rebalancing' });
    });

    consumer.on('consumer.group_join', () => {
      this.rebalances.add(1, { event: 'group_join' });
    });

    // Start lag polling if configured
    if (
      this.config.enableLag &&
      (this.config.lagStrategy === 'polling' ||
        this.config.lagStrategy === 'hybrid')
    ) {
      await this.pollLag();
      this.lagPollInterval = setInterval(
        () => this.pollLag().catch(() => {}),
        this.config.lagPollIntervalMs,
      );
    }
  }

  /**
   * Stop metrics collection.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.lagPollInterval) {
      clearInterval(this.lagPollInterval);
      this.lagPollInterval = undefined;
    }
  }

  /**
   * Record a message being processed.
   *
   * @param topic - Message topic
   * @param partition - Message partition
   * @param durationMs - Processing duration in milliseconds
   */
  recordMessageProcessed(
    topic: string,
    partition: number,
    durationMs?: number,
  ): void {
    this.messagesProcessed.add(1, { topic, partition });

    if (durationMs !== undefined) {
      this.processingDuration.record(durationMs, { topic, partition });
    }
  }

  /**
   * Record a batch being processed.
   *
   * @param topic - Batch topic
   * @param partition - Batch partition
   * @param size - Number of messages in the batch
   */
  recordBatch(topic: string, partition: number, size: number): void {
    this.batchSize.record(size, { topic, partition });
  }

  /**
   * Update offset state for event-based lag tracking.
   *
   * @param topic - Topic name
   * @param partition - Partition number
   * @param offset - Current consumer offset
   * @param highWatermark - Optional high watermark
   */
  updateOffset(
    topic: string,
    partition: number,
    offset: string,
    highWatermark?: string,
  ): void {
    const key = `${topic}-${partition}`;
    const existing = this.partitionStates.get(key);

    this.partitionStates.set(key, {
      topic,
      partition,
      currentOffset: offset,
      highWatermark: highWatermark ?? existing?.highWatermark,
    });
  }

  /**
   * Poll for lag using admin client.
   */
  private async pollLag(): Promise<void> {
    const { admin, groupId, topics } = this.config;
    if (!admin || !groupId || !topics) return;

    try {
      // Fetch committed offsets for the consumer group
      const committedOffsets = await admin.fetchOffsets({
        groupId,
        topics,
      });

      // For each topic, fetch the high watermarks
      for (const topicOffsets of committedOffsets) {
        const topicHighWatermarks = await admin.fetchTopicOffsets(
          topicOffsets.topic,
        );

        for (const partition of topicOffsets.partitions) {
          const hwm = topicHighWatermarks.find(
            (p) => p.partition === partition.partition,
          );
          if (hwm) {
            const key = `${topicOffsets.topic}-${partition.partition}`;
            this.partitionStates.set(key, {
              topic: topicOffsets.topic,
              partition: partition.partition,
              currentOffset: partition.offset,
              highWatermark: hwm.high,
            });
          }
        }
      }
    } catch {
      // Silently fail - lag metrics are best-effort
    }
  }
}
