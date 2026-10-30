// Messaging attributes
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

// Batch consumer attributes
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
