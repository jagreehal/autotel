/**
 * OpenTelemetry semantic conventions for database operations.
 * These constants are shared across all plugins.
 */

// Common database attributes
export const SEMATTRS_DB_SYSTEM = 'db.system' as const;
export const SEMATTRS_DB_SYSTEM_NAME = 'db.system.name' as const;
export const SEMATTRS_DB_OPERATION = 'db.operation' as const;
export const SEMATTRS_DB_STATEMENT = 'db.statement' as const;
export const SEMATTRS_DB_NAME = 'db.name' as const;
export const SEMATTRS_DB_NAMESPACE = 'db.namespace' as const;
export const SEMATTRS_DB_COLLECTION_NAME = 'db.collection.name' as const;
export const SEMATTRS_DB_OPERATION_NAME = 'db.operation.name' as const;
export const SEMATTRS_DB_QUERY_TEXT = 'db.query.text' as const;
export const SEMATTRS_DB_QUERY_SUMMARY = 'db.query.summary' as const;

// MongoDB-specific attributes
export const SEMATTRS_DB_MONGODB_COLLECTION = 'db.mongodb.collection' as const;

// Network attributes
export const SEMATTRS_NET_PEER_NAME = 'net.peer.name' as const;
export const SEMATTRS_NET_PEER_PORT = 'net.peer.port' as const;

// Messaging attributes (Kafka, etc.)
export const SEMATTRS_MESSAGING_SYSTEM = 'messaging.system' as const;
export const SEMATTRS_MESSAGING_DESTINATION_NAME =
  'messaging.destination.name' as const;
export const SEMATTRS_MESSAGING_OPERATION = 'messaging.operation' as const;
export const SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP =
  'messaging.kafka.consumer.group' as const;
export const SEMATTRS_MESSAGING_KAFKA_PARTITION =
  'messaging.kafka.partition' as const;
export const SEMATTRS_MESSAGING_KAFKA_OFFSET =
  'messaging.kafka.offset' as const;
export const SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY =
  'messaging.kafka.message.key' as const;

// Batch lineage attributes
export const SEMATTRS_LINKED_TRACE_ID_COUNT = 'linked_trace_id_count' as const;
export const SEMATTRS_LINKED_TRACE_ID_HASH = 'linked_trace_id_hash' as const;

// Correlation ID header name
export const CORRELATION_ID_HEADER = 'x-correlation-id' as const;

// BigQuery-specific attributes (namespaced under gcp.bigquery per OTel spec)
export const SEMATTRS_GCP_BIGQUERY_JOB_ID = 'gcp.bigquery.job.id' as const;
export const SEMATTRS_GCP_BIGQUERY_JOB_LOCATION =
  'gcp.bigquery.job.location' as const;
export const SEMATTRS_GCP_BIGQUERY_PROJECT_ID =
  'gcp.bigquery.project.id' as const;
export const SEMATTRS_GCP_BIGQUERY_DESTINATION_TABLE =
  'gcp.bigquery.destination.table' as const;
export const SEMATTRS_GCP_BIGQUERY_SOURCE_TABLES =
  'gcp.bigquery.source.tables' as const;
export const SEMATTRS_GCP_BIGQUERY_STATEMENT_TYPE =
  'gcp.bigquery.statement_type' as const;
export const SEMATTRS_GCP_BIGQUERY_QUERY_HASH =
  'gcp.bigquery.query.hash' as const;
export const SEMATTRS_GCP_BIGQUERY_ROWS_AFFECTED =
  'gcp.bigquery.rows.affected' as const;
export const SEMATTRS_GCP_BIGQUERY_ROWS_RETURNED =
  'gcp.bigquery.rows.returned' as const;
export const SEMATTRS_GCP_BIGQUERY_SCHEMA_FIELDS =
  'gcp.bigquery.schema.fields' as const;

// RabbitMQ-specific attributes (aligned with OTel messaging semantic conventions)
export const SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY =
  'messaging.rabbitmq.destination.routing_key' as const;
export const SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_EXCHANGE =
  'messaging.rabbitmq.destination.exchange' as const;
export const SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT =
  'messaging.rabbitmq.ack_result' as const;
export const SEMATTRS_MESSAGING_RABBITMQ_REQUEUE =
  'messaging.rabbitmq.requeue' as const;

// Messaging attributes (shared across messaging systems)
export const SEMATTRS_MESSAGING_MESSAGE_ID = 'messaging.message.id' as const;
export const SEMATTRS_MESSAGING_MESSAGE_CONVERSATION_ID =
  'messaging.message.conversation_id' as const;
export const SEMATTRS_MESSAGING_CONSUMER_ID = 'messaging.consumer.id' as const;
export const SEMATTRS_MESSAGING_OPERATION_NAME =
  'messaging.operation.name' as const;

// Kafka batch consumer attributes
export const SEMATTRS_MESSAGING_BATCH_MESSAGE_COUNT =
  'messaging.batch.message_count' as const;
export const SEMATTRS_MESSAGING_KAFKA_BATCH_FIRST_OFFSET =
  'messaging.kafka.batch.first_offset' as const;
export const SEMATTRS_MESSAGING_KAFKA_BATCH_LAST_OFFSET =
  'messaging.kafka.batch.last_offset' as const;
export const SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_PROCESSED =
  'messaging.kafka.batch.messages_processed' as const;
export const SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_FAILED =
  'messaging.kafka.batch.messages_failed' as const;
export const SEMATTRS_MESSAGING_KAFKA_BATCH_PROCESSING_TIME_MS =
  'messaging.kafka.batch.processing_time_ms' as const;
