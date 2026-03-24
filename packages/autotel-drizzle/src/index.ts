/**
 * Autotel Drizzle - OpenTelemetry instrumentation for Drizzle ORM
 *
 * This package provides instrumentation for Drizzle ORM.
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
 * import { instrumentDrizzleClient } from 'autotel-drizzle';
 * import { drizzle } from 'drizzle-orm/node-postgres';
 *
 * const db = instrumentDrizzleClient(drizzle(pool));
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
