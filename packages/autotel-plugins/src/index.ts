/**
 * Autotel Plugins - OpenTelemetry instrumentation for libraries without official support
 *
 * This package provides instrumentation for libraries that don't have official OpenTelemetry support
 * OR where the official support is fundamentally broken.
 *
 * Currently supported:
 * - Drizzle ORM (no official instrumentation available)
 * - Mongoose (official package broken in ESM+tsx - see mongoose/index.ts for details)
 * - BigQuery (no official instrumentation available)
 * - Kafka (composition layer for use with @opentelemetry/instrumentation-kafkajs):
 *   - Processing span wrapper with context mode control (inherit/link/none)
 *   - Batch lineage for fan-in trace correlation
 *   - Correlation ID policy for org-level conventions
 *
 * Philosophy:
 * Only include plugins for libraries that either:
 * 1. Have NO official instrumentation (e.g., Drizzle ORM)
 * 2. Have BROKEN official instrumentation (e.g., Mongoose in ESM+tsx)
 * 3. Add SIGNIFICANT value beyond official packages (e.g., Kafka processing spans)
 *
 * For databases/ORMs with working official instrumentation, use those directly with the --import pattern:
 * - MongoDB: @opentelemetry/instrumentation-mongodb
 * - PostgreSQL: @opentelemetry/instrumentation-pg
 * - MySQL: @opentelemetry/instrumentation-mysql2
 * - Redis: @opentelemetry/instrumentation-redis
 * - Kafka: @opentelemetry/instrumentation-kafkajs (use with autotel-plugins/kafka for processing spans)
 *
 * See: https://github.com/open-telemetry/opentelemetry-js-contrib
 *
 * @example
 * ```typescript
 * // Drizzle manual instrumentation
 * import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';
 * import { drizzle } from 'drizzle-orm/node-postgres';
 *
 * const db = instrumentDrizzleClient(drizzle(pool));
 * ```
 *
 * @example
 * ```typescript
 * // Mongoose runtime patching (works in ESM+tsx)
 * import mongoose from 'mongoose';
 * import { instrumentMongoose } from 'autotel-plugins/mongoose';
 *
 * instrumentMongoose(mongoose, { dbName: 'myapp' });
 * ```
 *
 * @packageDocumentation
 */

// Re-export common semantic conventions
export {
  SEMATTRS_DB_SYSTEM,
  SEMATTRS_DB_SYSTEM_NAME,
  SEMATTRS_DB_OPERATION,
  SEMATTRS_DB_OPERATION_NAME,
  SEMATTRS_DB_STATEMENT,
  SEMATTRS_DB_NAME,
  SEMATTRS_DB_NAMESPACE,
  SEMATTRS_DB_COLLECTION_NAME,
  SEMATTRS_DB_QUERY_TEXT,
  SEMATTRS_DB_QUERY_SUMMARY,
  SEMATTRS_NET_PEER_NAME,
  SEMATTRS_NET_PEER_PORT,
  SEMATTRS_GCP_BIGQUERY_JOB_ID,
  SEMATTRS_GCP_BIGQUERY_JOB_LOCATION,
  SEMATTRS_GCP_BIGQUERY_PROJECT_ID,
  SEMATTRS_GCP_BIGQUERY_DESTINATION_TABLE,
  SEMATTRS_GCP_BIGQUERY_SOURCE_TABLES,
  SEMATTRS_GCP_BIGQUERY_STATEMENT_TYPE,
  SEMATTRS_GCP_BIGQUERY_QUERY_HASH,
  SEMATTRS_GCP_BIGQUERY_ROWS_AFFECTED,
  SEMATTRS_GCP_BIGQUERY_ROWS_RETURNED,
  SEMATTRS_GCP_BIGQUERY_SCHEMA_FIELDS,
} from './common/constants';

// Re-export Drizzle plugin
export {
  instrumentDrizzle,
  instrumentDrizzleClient,
  type InstrumentDrizzleConfig,
} from './drizzle';

// Re-export Mongoose plugin
export {
  instrumentMongoose,
  MongooseInstrumentation,
  type MongooseInstrumentationConfig,
} from './mongoose';

// Re-export BigQuery plugin
export {
  instrumentBigQuery,
  BigQueryInstrumentation,
  type BigQueryInstrumentationConfig,
} from './bigquery';

// Re-export Kafka plugin
export {
  withProcessingSpan,
  withProducerSpan,
  extractBatchLineage,
  extractBatchLineageAsync,
  injectTraceHeaders,
  extractTraceContext,
  extractCorrelationId,
  deriveCorrelationId,
  normalizeHeaders,
  withBatchConsumer,
  createMessageErrorSpan,
  createStreamProcessor,
  ConsumerMetrics,
  instrumentConsumerEvents,
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_OPERATION,
  SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP,
  SEMATTRS_MESSAGING_KAFKA_PARTITION,
  SEMATTRS_MESSAGING_KAFKA_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY,
  SEMATTRS_LINKED_TRACE_ID_COUNT,
  SEMATTRS_LINKED_TRACE_ID_HASH,
  CORRELATION_ID_HEADER,
  SEMATTRS_MESSAGING_BATCH_MESSAGE_COUNT,
  SEMATTRS_MESSAGING_KAFKA_BATCH_FIRST_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_BATCH_LAST_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_PROCESSED,
  SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_FAILED,
  SEMATTRS_MESSAGING_KAFKA_BATCH_PROCESSING_TIME_MS,
  type RawKafkaHeaders,
  type ContextMode,
  type ProcessingDescriptor,
  type ProducerDescriptor,
  type ProcessingSpanCallback,
  type ProducerSpanCallback,
  type BatchLineageOptions,
  type BatchLineageResult,
  type InjectOptions,
  type BatchItem,
  type EachBatchPayload,
  type EachBatchHandler,
  type BatchProgressMetrics,
  type PerMessageSpanMode,
  type BatchConsumerConfig,
  type StreamMessage,
  type StreamProcessorConfig,
  type ProduceOptions,
  type ProcessorContext,
  type ProcessorCallback,
  type StreamProcessor,
  type LagStrategy,
  type KafkaConsumer,
  type KafkaAdmin,
  type ConsumerMetricsConfig,
  type EventMode,
  type EventConsumer,
  type ConsumerEventsConfig,
  type CleanupFunction,
} from './kafka';

// Re-export RabbitMQ plugin
export {
  withConsumeSpan,
  withPublishSpan,
  extractBatchLineage as extractRabbitMQBatchLineage,
  injectTraceHeaders as injectRabbitMQTraceHeaders,
  extractTraceContext as extractRabbitMQTraceContext,
  extractCorrelationId as extractRabbitMQCorrelationId,
  deriveCorrelationId as deriveRabbitMQCorrelationId,
  normalizeHeaders as normalizeRabbitMQHeaders,
  recordAckResult,
  SEMATTRS_MESSAGING_OPERATION_NAME,
  SEMATTRS_MESSAGING_MESSAGE_ID,
  SEMATTRS_MESSAGING_MESSAGE_CONVERSATION_ID,
  SEMATTRS_MESSAGING_CONSUMER_ID,
  SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY,
  SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_EXCHANGE,
  SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT,
  SEMATTRS_MESSAGING_RABBITMQ_REQUEUE,
  type RawAmqpHeaders,
  type ContextMode as RabbitMQContextMode,
  type AckOutcome,
  type AckControls,
  type ConsumeDescriptor,
  type PublishDescriptor as RabbitMQPublishDescriptor,
  type ConsumeSpanCallback,
  type DeferredConsumeSpanCallback,
  type PublishSpanCallback as RabbitMQPublishSpanCallback,
  type BatchLineageOptions as RabbitMQBatchLineageOptions,
  type BatchLineageResult as RabbitMQBatchLineageResult,
  type InjectOptions as RabbitMQInjectOptions,
  type BatchItem as RabbitMQBatchItem,
  type AckResult,
  type RecordAckOptions,
} from './rabbitmq';
