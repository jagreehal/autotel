/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: `any` is only used for dynamic method wrapping on runtime objects.
// Type-safe interfaces are used for all public APIs.
// BigQuery is a devDependency so we type-check against the real API; consumers use the peer.

import type { BigQuery, BigQueryOptions } from '@google-cloud/bigquery';
import { SpanKind, otelTrace as trace, type Span, type Tracer } from 'autotel';
import {
  SEMATTRS_DB_SYSTEM_NAME,
  SEMATTRS_DB_OPERATION_NAME,
  SEMATTRS_DB_QUERY_TEXT,
  SEMATTRS_DB_QUERY_SUMMARY,
  SEMATTRS_DB_NAMESPACE,
  SEMATTRS_DB_COLLECTION_NAME,
  SEMATTRS_GCP_BIGQUERY_JOB_ID,
  SEMATTRS_GCP_BIGQUERY_JOB_LOCATION,
  SEMATTRS_GCP_BIGQUERY_PROJECT_ID,
  SEMATTRS_GCP_BIGQUERY_DESTINATION_TABLE,
  SEMATTRS_GCP_BIGQUERY_QUERY_HASH,
  SEMATTRS_GCP_BIGQUERY_ROWS_AFFECTED,
  SEMATTRS_GCP_BIGQUERY_ROWS_RETURNED,
} from '../common/constants';
import { runWithSpan, finalizeSpan } from 'autotel/trace-helpers';

const DEFAULT_TRACER_NAME = 'autotel-plugins/bigquery';
const DEFAULT_DB_SYSTEM_NAME = 'gcp.bigquery';
const INSTRUMENTED_FLAG = '__autotelBigQueryInstrumented' as const;
const PROTOTYPE_INSTRUMENTED_FLAG =
  '__autotelBigQueryPrototypeInstrumented' as const;
const CONFIG_STORAGE_KEY = '__autotelBigQueryConfig' as const;
const TRACER_STORAGE_KEY = '__autotelBigQueryTracer' as const;

/**
 * Helper to get config from a BigQuery instance.
 * For Table/Dataset methods, traverses up to find the BigQuery parent.
 */
function getInstanceConfig(
  instance: any,
): BigQueryInstrumentationConfig | undefined {
  // Direct config on BigQuery instance
  if (instance?.[CONFIG_STORAGE_KEY]) {
    return instance[CONFIG_STORAGE_KEY];
  }
  // For Table: this.dataset.parent is the BigQuery instance
  if (instance?.dataset?.parent?.[CONFIG_STORAGE_KEY]) {
    return instance.dataset.parent[CONFIG_STORAGE_KEY];
  }
  // For Dataset: this.parent is the BigQuery instance
  if (instance?.parent?.[CONFIG_STORAGE_KEY]) {
    return instance.parent[CONFIG_STORAGE_KEY];
  }
  // For Job: this.parent is the BigQuery instance
  if (instance?.parent?.[CONFIG_STORAGE_KEY]) {
    return instance.parent[CONFIG_STORAGE_KEY];
  }
  return undefined;
}

/**
 * Helper to get tracer from a BigQuery instance.
 * For Table/Dataset methods, traverses up to find the BigQuery parent.
 */
function getInstanceTracer(instance: any): Tracer | undefined {
  // Direct tracer on BigQuery instance
  if (instance?.[TRACER_STORAGE_KEY]) {
    return instance[TRACER_STORAGE_KEY];
  }
  // For Table: this.dataset.parent is the BigQuery instance
  if (instance?.dataset?.parent?.[TRACER_STORAGE_KEY]) {
    return instance.dataset.parent[TRACER_STORAGE_KEY];
  }
  // For Dataset: this.parent is the BigQuery instance
  if (instance?.parent?.[TRACER_STORAGE_KEY]) {
    return instance.parent[TRACER_STORAGE_KEY];
  }
  // For Job: this.parent is the BigQuery instance
  if (instance?.parent?.[TRACER_STORAGE_KEY]) {
    return instance.parent[TRACER_STORAGE_KEY];
  }
  return undefined;
}

/**
 * Plugin-only options for BigQuery instrumentation (not part of official BigQueryOptions).
 */
export interface BigQueryInstrumentationPluginOptions {
  /**
   * Custom tracer name (default: "autotel-plugins/bigquery").
   */
  tracerName?: string;

  /**
   * How to handle query text in spans:
   * - 'never': Don't capture any query text
   * - 'summary': Only capture low-cardinality summary (default)
   * - 'sanitized': Sanitize by replacing literals with ?
   * - 'raw': Capture raw query text (opt-in, not recommended for production)
   * @default 'summary'
   */
  captureQueryText?: 'never' | 'summary' | 'sanitized' | 'raw';

  /**
   * Maximum length for captured query text. Queries longer than this will be truncated.
   * @default 1000
   */
  maxQueryTextLength?: number;

  /**
   * Whether to include a hash of the query for exact matching without exposing text.
   * @default true
   */
  includeQueryHash?: boolean;

  /**
   * Whether to instrument admin operations (dataset/table create, delete, metadata).
   * @default false
   */
  instrumentAdminOps?: boolean;

  /**
   * Whether to instrument BigQuery ML (model) operations.
   * @default false
   */
  instrumentBqmlOps?: boolean;

  /**
   * Whether to instrument routine (stored procedure/function) operations.
   * @default false
   */
  instrumentRoutineOps?: boolean;
}

/**
 * Configuration options for BigQuery instrumentation.
 * Uses official BigQueryOptions for projectId and location (same semantics as the BigQuery constructor).
 * All other fields are plugin-only options.
 */
export type BigQueryInstrumentationConfig = Pick<
  BigQueryOptions,
  'projectId' | 'location'
> &
  BigQueryInstrumentationPluginOptions;

/**
 * Creates a simple hash of a string for query identification without exposing text.
 */
function hashQuery(query: string): string {
  let hash = 0;
  for (let i = 0; i < query.length; i++) {
    const char = query.codePointAt(i) ?? 0;
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extracts the operation type (SELECT, INSERT, etc.) from SQL query.
 */
function extractOperationType(query: string): string | undefined {
  const trimmed = query.trimStart();
  const match = /^(?<op>\w+)/iu.exec(trimmed);
  return match?.groups?.op?.toUpperCase();
}

/**
 * Creates a low-cardinality summary of a query.
 * Example: "SELECT FROM users WHERE..." or "INSERT INTO orders"
 */
function createQuerySummary(query: string): string {
  const operation = extractOperationType(query);
  if (!operation) {
    return 'UNKNOWN';
  }

  // For SELECT/INSERT/UPDATE/DELETE, try to extract table name
  const patterns: Record<string, RegExp> = {
    SELECT: /FROM\s+(?<table>[\w.]+)/iu,
    INSERT: /INTO\s+(?<table>[\w.]+)/iu,
    UPDATE: /UPDATE\s+(?<table>[\w.]+)/iu,
    DELETE: /FROM\s+(?<table>[\w.]+)/iu,
  };

  const pattern = patterns[operation];
  if (pattern) {
    const match = pattern.exec(query);
    const table = match?.groups?.table;
    if (table) {
      return `${operation} ${table}`;
    }
  }

  return operation;
}

/**
 * Sanitizes a query by replacing literal values with ? placeholders.
 * Handles strings, numbers, and dates.
 */
function sanitizeQuery(query: string): string {
  // Replace string literals: '...' or "..."
  let sanitized = query.replaceAll(/'(?:[^'\\]|\\.)*'/gu, "'?'");
  sanitized = sanitized.replaceAll(/"(?:[^"\\]|\\.)*"/gu, '"?"');

  // Replace numeric literals (but preserve table names like table_123)
  // Only replace standalone numbers
  sanitized = sanitized.replaceAll(/\b\d+\.?\d*\b/gu, '?');

  // Replace boolean literals
  sanitized = sanitized.replaceAll(/\b(?:true|false)\b/giu, '?');

  // Replace NULL
  sanitized = sanitized.replaceAll(/\bNULL\b/giu, '?');

  return sanitized;
}

/**
 * Truncates text to max length with ellipsis.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

/**
 * Extracts project ID from BigQuery instance.
 */
function extractProjectId(bigquery: any): string | undefined {
  try {
    return bigquery.projectId || bigquery.options?.projectId;
  } catch {
    return undefined;
  }
}

/**
 * Extracts location from BigQuery instance or query options.
 */
function extractLocation(bigquery: any, options?: any): string | undefined {
  try {
    return options?.location || bigquery.location || bigquery.options?.location;
  } catch {
    return undefined;
  }
}

/**
 * Extracts dataset and table identifiers from various BigQuery objects.
 */
function extractTableReference(obj: any): {
  datasetId?: string;
  tableId?: string;
  projectId?: string;
} {
  try {
    // Direct properties
    if (obj.dataset?.id || obj.parent?.id) {
      return {
        projectId: obj.dataset?.parent?.projectId || obj.parent?.projectId,
        datasetId: obj.dataset?.id || obj.parent?.datasetId,
        tableId: obj.id,
      };
    }

    // From metadata
    if (obj.metadata?.tableReference) {
      return obj.metadata.tableReference;
    }

    return {};
  } catch {
    return {};
  }
}

/**
 * Creates a span for a BigQuery operation.
 */
function createSpan(
  tracer: Tracer,
  operationName: string,
  target?: string,
  projectId?: string,
  config: BigQueryInstrumentationConfig = {},
): Span {
  const spanName = target ? `${operationName} ${target}` : operationName;

  const attributes: Record<string, any> = {
    [SEMATTRS_DB_SYSTEM_NAME]: DEFAULT_DB_SYSTEM_NAME,
    [SEMATTRS_DB_OPERATION_NAME]: operationName,
  };

  if (projectId || config.projectId) {
    attributes[SEMATTRS_GCP_BIGQUERY_PROJECT_ID] =
      projectId || config.projectId;
  }

  if (config.location) {
    attributes[SEMATTRS_GCP_BIGQUERY_JOB_LOCATION] = config.location;
  }

  return tracer.startSpan(spanName, { kind: SpanKind.CLIENT, attributes });
}

/**
 * Instruments BigQuery.query() method.
 */
function instrumentQueryMethod(BigQuery: any): void {
  const originalQuery = BigQuery.prototype.query;
  if (typeof originalQuery !== 'function') {
    return;
  }

  BigQuery.prototype.query = function instrumentedQuery(
    this: any,
    query: string | { query: string; [key: string]: any },
    options?: any,
    callback?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer) {
      // Fall back to original if no config/tracer found
      return originalQuery.call(this, query, options, callback);
    }

    const queryText = typeof query === 'string' ? query : query.query;
    const projectId = extractProjectId(this);
    const location = extractLocation(this, options);

    const operation = queryText ? extractOperationType(queryText) : 'QUERY';
    const summary = queryText ? createQuerySummary(queryText) : 'QUERY';

    const span = createSpan(
      tracer,
      operation || 'QUERY',
      summary,
      projectId,
      config,
    );

    // Set location if available
    if (location) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_LOCATION, location);
    }

    // Set query summary (always)
    span.setAttribute(SEMATTRS_DB_QUERY_SUMMARY, summary);

    // Set query text based on config
    if (config.captureQueryText !== 'never' && queryText) {
      if (config.captureQueryText === 'raw') {
        const truncated = truncateText(
          queryText,
          config.maxQueryTextLength || 1000,
        );
        span.setAttribute(SEMATTRS_DB_QUERY_TEXT, truncated);
      } else if (config.captureQueryText === 'sanitized') {
        const sanitized = sanitizeQuery(queryText);
        const truncated = truncateText(
          sanitized,
          config.maxQueryTextLength || 1000,
        );
        span.setAttribute(SEMATTRS_DB_QUERY_TEXT, truncated);
      }
      // 'summary' mode only includes summary, no raw text
    }

    // Set query hash if enabled
    if (config.includeQueryHash !== false && queryText) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_QUERY_HASH, hashQuery(queryText));
    }

    // Set destination table if specified in options
    if (options?.destination) {
      const dest = extractTableReference(options.destination);
      if (dest.tableId) {
        const destTable = dest.datasetId
          ? `${dest.datasetId}.${dest.tableId}`
          : dest.tableId;
        span.setAttribute(SEMATTRS_GCP_BIGQUERY_DESTINATION_TABLE, destTable);
      }
    }

    // Handle callback-style API
    if (typeof callback === 'function') {
      const wrappedCallback = (err: any, ...args: any[]) => {
        if (err) {
          finalizeSpan(
            span,
            err instanceof Error ? err : new Error(String(err)),
          );
        } else {
          // Record row count and job ID if available in response
          const [rows, response] = args;
          if (Array.isArray(rows)) {
            span.setAttribute(SEMATTRS_GCP_BIGQUERY_ROWS_RETURNED, rows.length);
          }
          if (response?.jobReference?.jobId) {
            span.setAttribute(
              SEMATTRS_GCP_BIGQUERY_JOB_ID,
              response.jobReference.jobId,
            );
          }
          finalizeSpan(span);
        }
        return callback(err, ...args);
      };
      return originalQuery.call(this, query, options, wrappedCallback);
    }

    // Handle Promise-style API
    return runWithSpan(span, () => {
      try {
        const result = originalQuery.call(this, query, options);

        return Promise.resolve(result)
          .then(([rows, response]: [any[], any]) => {
            // Record row count
            if (Array.isArray(rows)) {
              span.setAttribute(
                SEMATTRS_GCP_BIGQUERY_ROWS_RETURNED,
                rows.length,
              );
            }

            // Extract job ID from response if available
            if (response?.jobReference?.jobId) {
              span.setAttribute(
                SEMATTRS_GCP_BIGQUERY_JOB_ID,
                response.jobReference.jobId,
              );
            }

            finalizeSpan(span);
            return [rows, response];
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments BigQuery.createQueryJob() method.
 */
function instrumentCreateQueryJob(BigQuery: any): void {
  const originalCreateQueryJob = BigQuery.prototype.createQueryJob;
  if (typeof originalCreateQueryJob !== 'function') {
    return;
  }

  BigQuery.prototype.createQueryJob = function instrumentedCreateQueryJob(
    this: any,
    options: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer) {
      return originalCreateQueryJob.call(this, options);
    }

    const queryText = typeof options === 'string' ? options : options.query;
    const projectId = extractProjectId(this);
    const location = extractLocation(this, options);

    const operation = queryText ? extractOperationType(queryText) : 'QUERY';
    const summary = queryText ? createQuerySummary(queryText) : 'QUERY';

    const span = createSpan(
      tracer,
      `${operation || 'QUERY'}_JOB`,
      summary,
      projectId,
      config,
    );

    if (location) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_LOCATION, location);
    }

    span.setAttribute(SEMATTRS_DB_QUERY_SUMMARY, summary);

    if (config.captureQueryText !== 'never' && queryText) {
      if (config.captureQueryText === 'raw') {
        const truncated = truncateText(
          queryText,
          config.maxQueryTextLength || 1000,
        );
        span.setAttribute(SEMATTRS_DB_QUERY_TEXT, truncated);
      } else if (config.captureQueryText === 'sanitized') {
        const sanitized = sanitizeQuery(queryText);
        const truncated = truncateText(
          sanitized,
          config.maxQueryTextLength || 1000,
        );
        span.setAttribute(SEMATTRS_DB_QUERY_TEXT, truncated);
      }
    }

    if (config.includeQueryHash !== false && queryText) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_QUERY_HASH, hashQuery(queryText));
    }

    if (options?.destination) {
      const dest = extractTableReference(options.destination);
      if (dest.tableId) {
        const destTable = dest.datasetId
          ? `${dest.datasetId}.${dest.tableId}`
          : dest.tableId;
        span.setAttribute(SEMATTRS_GCP_BIGQUERY_DESTINATION_TABLE, destTable);
      }
    }

    return runWithSpan(span, () => {
      try {
        const result = originalCreateQueryJob.call(this, options);

        return Promise.resolve(result)
          .then(([job, response]: [any, any]) => {
            // Record job ID
            if (job?.id) {
              span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_ID, job.id);
            } else if (response?.jobReference?.jobId) {
              span.setAttribute(
                SEMATTRS_GCP_BIGQUERY_JOB_ID,
                response.jobReference.jobId,
              );
            }

            finalizeSpan(span);
            return [job, response];
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments Table.insert() method.
 */
function instrumentTableInsert(Table: any): void {
  const originalInsert = Table.prototype.insert;
  if (typeof originalInsert !== 'function') {
    return;
  }

  Table.prototype.insert = function instrumentedInsert(
    this: any,
    rows: any,
    options?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer) {
      return originalInsert.call(this, rows, options);
    }

    const tableRef = extractTableReference(this);
    const projectId = extractProjectId(this.dataset?.parent || this.parent);
    const location = extractLocation(
      this.dataset?.parent || this.parent,
      options,
    );

    const target = tableRef.tableId
      ? tableRef.datasetId
        ? `${tableRef.datasetId}.${tableRef.tableId}`
        : tableRef.tableId
      : undefined;

    const span = createSpan(tracer, 'INSERT', target, projectId, config);

    if (location) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_LOCATION, location);
    }

    // Record row count
    const rowCount = Array.isArray(rows) ? rows.length : 1;
    span.setAttribute(SEMATTRS_GCP_BIGQUERY_ROWS_AFFECTED, rowCount);

    if (tableRef.datasetId) {
      span.setAttribute(SEMATTRS_DB_NAMESPACE, tableRef.datasetId);
    }
    if (tableRef.tableId) {
      span.setAttribute(SEMATTRS_DB_COLLECTION_NAME, tableRef.tableId);
    }

    return runWithSpan(span, () => {
      try {
        const result = originalInsert.call(this, rows, options);

        return Promise.resolve(result)
          .then((response: any) => {
            // Check for insert errors
            if (response?.insertErrors?.length > 0) {
              span.setAttribute(
                'gcp.bigquery.insert.errors',
                response.insertErrors.length,
              );
            }

            finalizeSpan(span);
            return response;
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments Table.getRows() method.
 */
function instrumentTableGetRows(Table: any): void {
  const originalGetRows = Table.prototype.getRows;
  if (typeof originalGetRows !== 'function') {
    return;
  }

  Table.prototype.getRows = function instrumentedGetRows(
    this: any,
    options?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer) {
      return originalGetRows.call(this, options);
    }

    const tableRef = extractTableReference(this);
    const projectId = extractProjectId(this.dataset?.parent || this.parent);
    const location = extractLocation(
      this.dataset?.parent || this.parent,
      options,
    );

    const target = tableRef.tableId
      ? tableRef.datasetId
        ? `${tableRef.datasetId}.${tableRef.tableId}`
        : tableRef.tableId
      : undefined;

    const span = createSpan(tracer, 'SELECT', target, projectId, config);

    if (location) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_LOCATION, location);
    }

    if (tableRef.datasetId) {
      span.setAttribute(SEMATTRS_DB_NAMESPACE, tableRef.datasetId);
    }
    if (tableRef.tableId) {
      span.setAttribute(SEMATTRS_DB_COLLECTION_NAME, tableRef.tableId);
    }

    return runWithSpan(span, () => {
      try {
        const result = originalGetRows.call(this, options);

        return Promise.resolve(result)
          .then(([rows, nextQuery, apiResponse]: [any[], any, any]) => {
            if (Array.isArray(rows)) {
              span.setAttribute(
                SEMATTRS_GCP_BIGQUERY_ROWS_RETURNED,
                rows.length,
              );
            }
            finalizeSpan(span);
            return [rows, nextQuery, apiResponse];
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments Table.createLoadJob() method.
 */
function instrumentTableCreateLoadJob(Table: any): void {
  const originalCreateLoadJob = Table.prototype.createLoadJob;
  if (typeof originalCreateLoadJob !== 'function') {
    return;
  }

  Table.prototype.createLoadJob = function instrumentedCreateLoadJob(
    this: any,
    source: any,
    metadata?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer) {
      return originalCreateLoadJob.call(this, source, metadata);
    }

    const tableRef = extractTableReference(this);
    const projectId = extractProjectId(this.dataset?.parent || this.parent);
    const location = extractLocation(
      this.dataset?.parent || this.parent,
      metadata,
    );

    const target = tableRef.tableId
      ? tableRef.datasetId
        ? `${tableRef.datasetId}.${tableRef.tableId}`
        : tableRef.tableId
      : undefined;

    const span = createSpan(tracer, 'LOAD', target, projectId, config);

    if (location) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_LOCATION, location);
    }

    if (tableRef.datasetId) {
      span.setAttribute(SEMATTRS_DB_NAMESPACE, tableRef.datasetId);
    }
    if (tableRef.tableId) {
      span.setAttribute(SEMATTRS_DB_COLLECTION_NAME, tableRef.tableId);
    }

    // Record source format if available
    if (metadata?.sourceFormat) {
      span.setAttribute('gcp.bigquery.source.format', metadata.sourceFormat);
    }

    return runWithSpan(span, () => {
      try {
        const result = originalCreateLoadJob.call(this, source, metadata);

        return Promise.resolve(result)
          .then(([job, response]: [any, any]) => {
            if (job?.id) {
              span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_ID, job.id);
            }
            finalizeSpan(span);
            return [job, response];
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments Table.createCopyJob() method.
 */
function instrumentTableCreateCopyJob(Table: any): void {
  const originalCreateCopyJob = Table.prototype.createCopyJob;
  if (typeof originalCreateCopyJob !== 'function') {
    return;
  }

  Table.prototype.createCopyJob = function instrumentedCreateCopyJob(
    this: any,
    destination: any,
    metadata?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer) {
      return originalCreateCopyJob.call(this, destination, metadata);
    }

    const sourceRef = extractTableReference(this);
    const projectId = extractProjectId(this.dataset?.parent || this.parent);
    const location = extractLocation(
      this.dataset?.parent || this.parent,
      metadata,
    );

    const source = sourceRef.tableId
      ? sourceRef.datasetId
        ? `${sourceRef.datasetId}.${sourceRef.tableId}`
        : sourceRef.tableId
      : 'unknown';

    const span = createSpan(tracer, 'COPY', source, projectId, config);

    if (location) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_LOCATION, location);
    }

    // Record destination
    if (destination) {
      const destRef = extractTableReference(destination);
      const destTable = destRef.tableId
        ? destRef.datasetId
          ? `${destRef.datasetId}.${destRef.tableId}`
          : destRef.tableId
        : undefined;
      if (destTable) {
        span.setAttribute(SEMATTRS_GCP_BIGQUERY_DESTINATION_TABLE, destTable);
      }
    }

    return runWithSpan(span, () => {
      try {
        const result = originalCreateCopyJob.call(this, destination, metadata);

        return Promise.resolve(result)
          .then(([job, response]: [any, any]) => {
            if (job?.id) {
              span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_ID, job.id);
            }
            finalizeSpan(span);
            return [job, response];
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments Table.createExtractJob() method.
 */
function instrumentTableCreateExtractJob(Table: any): void {
  const originalCreateExtractJob = Table.prototype.createExtractJob;
  if (typeof originalCreateExtractJob !== 'function') {
    return;
  }

  Table.prototype.createExtractJob = function instrumentedCreateExtractJob(
    this: any,
    destination: any,
    metadata?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer) {
      return originalCreateExtractJob.call(this, destination, metadata);
    }

    const sourceRef = extractTableReference(this);
    const projectId = extractProjectId(this.dataset?.parent || this.parent);
    const location = extractLocation(
      this.dataset?.parent || this.parent,
      metadata,
    );

    const source = sourceRef.tableId
      ? sourceRef.datasetId
        ? `${sourceRef.datasetId}.${sourceRef.tableId}`
        : sourceRef.tableId
      : 'unknown';

    const span = createSpan(tracer, 'EXTRACT', source, projectId, config);

    if (location) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_LOCATION, location);
    }

    if (sourceRef.datasetId) {
      span.setAttribute(SEMATTRS_DB_NAMESPACE, sourceRef.datasetId);
    }
    if (sourceRef.tableId) {
      span.setAttribute(SEMATTRS_DB_COLLECTION_NAME, sourceRef.tableId);
    }

    // Record destination URI
    if (typeof destination === 'string') {
      span.setAttribute('gcp.bigquery.destination.uri', destination);
    } else if (Array.isArray(destination) && destination.length > 0) {
      span.setAttribute('gcp.bigquery.destination.uri', destination[0]);
    }

    // Record format
    const format = metadata?.destinationFormat || metadata?.format;
    if (format) {
      span.setAttribute('gcp.bigquery.destination.format', format);
    }

    return runWithSpan(span, () => {
      try {
        const result = originalCreateExtractJob.call(
          this,
          destination,
          metadata,
        );

        return Promise.resolve(result)
          .then(([job, response]: [any, any]) => {
            if (job?.id) {
              span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_ID, job.id);
            }
            finalizeSpan(span);
            return [job, response];
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments Job.getQueryResults() method.
 */
function instrumentJobGetQueryResults(Job: any): void {
  const originalGetQueryResults = Job.prototype.getQueryResults;
  if (typeof originalGetQueryResults !== 'function') {
    return;
  }

  Job.prototype.getQueryResults = function instrumentedGetQueryResults(
    this: any,
    options?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer) {
      return originalGetQueryResults.call(this, options);
    }

    const jobId = this.id || this.metadata?.jobReference?.jobId;
    const projectId = this.parent?.projectId || this.projectId;
    const location = this.location || options?.location;

    const span = createSpan(
      tracer,
      'GET_QUERY_RESULTS',
      undefined,
      projectId,
      config,
    );

    if (jobId) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_ID, jobId);
    }

    if (location) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_LOCATION, location);
    }

    return runWithSpan(span, () => {
      try {
        const result = originalGetQueryResults.call(this, options);

        return Promise.resolve(result)
          .then(([rows, nextQuery, apiResponse]: [any[], any, any]) => {
            if (Array.isArray(rows)) {
              span.setAttribute(
                SEMATTRS_GCP_BIGQUERY_ROWS_RETURNED,
                rows.length,
              );
            }
            finalizeSpan(span);
            return [rows, nextQuery, apiResponse];
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments Dataset.create() method (admin operation).
 */
function instrumentDatasetCreate(Dataset: any): void {
  const originalCreate = Dataset.prototype.create;
  if (typeof originalCreate !== 'function') {
    return;
  }

  Dataset.prototype.create = function instrumentedCreate(
    this: any,
    options?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer || !config.instrumentAdminOps) {
      return originalCreate.call(this, options);
    }

    const datasetId = this.id;
    const projectId = extractProjectId(this.parent);
    const location = extractLocation(this.parent, options);

    const span = createSpan(
      tracer,
      'CREATE_DATASET',
      datasetId,
      projectId,
      config,
    );

    if (location) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_LOCATION, location);
    }

    if (datasetId) {
      span.setAttribute(SEMATTRS_DB_NAMESPACE, datasetId);
    }

    return runWithSpan(span, () => {
      try {
        const result = originalCreate.call(this, options);

        return Promise.resolve(result)
          .then((response) => {
            finalizeSpan(span);
            return response;
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments Dataset.delete() method (admin operation).
 */
function instrumentDatasetDelete(Dataset: any): void {
  const originalDelete = Dataset.prototype.delete;
  if (typeof originalDelete !== 'function') {
    return;
  }

  Dataset.prototype.delete = function instrumentedDelete(
    this: any,
    options?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer || !config.instrumentAdminOps) {
      return originalDelete.call(this, options);
    }

    const datasetId = this.id;
    const projectId = extractProjectId(this.parent);

    const span = createSpan(
      tracer,
      'DELETE_DATASET',
      datasetId,
      projectId,
      config,
    );

    if (datasetId) {
      span.setAttribute(SEMATTRS_DB_NAMESPACE, datasetId);
    }

    return runWithSpan(span, () => {
      try {
        const result = originalDelete.call(this, options);

        return Promise.resolve(result)
          .then((response) => {
            finalizeSpan(span);
            return response;
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments BigQuery.createDataset() method (admin operation).
 * This is different from Dataset.prototype.create - it's called as bigquery.createDataset(id).
 */
function instrumentBigQueryCreateDataset(BigQuery: any): void {
  const originalCreateDataset = BigQuery.prototype.createDataset;
  if (typeof originalCreateDataset !== 'function') {
    return;
  }

  BigQuery.prototype.createDataset = function instrumentedCreateDataset(
    this: any,
    id: string,
    options?: any,
    callback?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer || !config.instrumentAdminOps) {
      return originalCreateDataset.call(this, id, options, callback);
    }

    const datasetId = id;
    const projectId = extractProjectId(this);
    const location = extractLocation(this, options);

    const span = createSpan(
      tracer,
      'CREATE_DATASET',
      datasetId,
      projectId,
      config,
    );

    if (location) {
      span.setAttribute(SEMATTRS_GCP_BIGQUERY_JOB_LOCATION, location);
    }

    if (datasetId) {
      span.setAttribute(SEMATTRS_DB_NAMESPACE, datasetId);
    }

    // Handle callback-style API
    if (typeof callback === 'function') {
      const wrappedCallback = (err: any, ...args: any[]) => {
        if (err) {
          finalizeSpan(
            span,
            err instanceof Error ? err : new Error(String(err)),
          );
        } else {
          finalizeSpan(span);
        }
        return callback(err, ...args);
      };
      // Call original without runWithSpan for callbacks - the span is already active
      return originalCreateDataset.call(this, id, options, wrappedCallback);
    }

    // Handle Promise-style API
    return runWithSpan(span, () => {
      try {
        const result = originalCreateDataset.call(this, id, options);

        return Promise.resolve(result)
          .then((response) => {
            finalizeSpan(span);
            return response;
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments Table.create() method (admin operation).
 */
function instrumentTableCreate(Table: any): void {
  const originalCreate = Table.prototype.create;
  if (typeof originalCreate !== 'function') {
    return;
  }

  Table.prototype.create = function instrumentedCreate(
    this: any,
    options?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer || !config.instrumentAdminOps) {
      return originalCreate.call(this, options);
    }

    const tableRef = extractTableReference(this);
    const projectId = extractProjectId(this.dataset?.parent || this.parent);

    const target = tableRef.tableId
      ? tableRef.datasetId
        ? `${tableRef.datasetId}.${tableRef.tableId}`
        : tableRef.tableId
      : undefined;

    const span = createSpan(tracer, 'CREATE_TABLE', target, projectId, config);

    if (tableRef.datasetId) {
      span.setAttribute(SEMATTRS_DB_NAMESPACE, tableRef.datasetId);
    }
    if (tableRef.tableId) {
      span.setAttribute(SEMATTRS_DB_COLLECTION_NAME, tableRef.tableId);
    }

    return runWithSpan(span, () => {
      try {
        const result = originalCreate.call(this, options);

        return Promise.resolve(result)
          .then((response) => {
            finalizeSpan(span);
            return response;
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments Table.delete() method (admin operation).
 */
function instrumentTableDelete(Table: any): void {
  const originalDelete = Table.prototype.delete;
  if (typeof originalDelete !== 'function') {
    return;
  }

  Table.prototype.delete = function instrumentedDelete(
    this: any,
    options?: any,
  ): any {
    const config = getInstanceConfig(this);
    const tracer = getInstanceTracer(this);

    if (!config || !tracer || !config.instrumentAdminOps) {
      return originalDelete.call(this, options);
    }

    const tableRef = extractTableReference(this);
    const projectId = extractProjectId(this.dataset?.parent || this.parent);

    const target = tableRef.tableId
      ? tableRef.datasetId
        ? `${tableRef.datasetId}.${tableRef.tableId}`
        : tableRef.tableId
      : undefined;

    const span = createSpan(tracer, 'DELETE_TABLE', target, projectId, config);

    if (tableRef.datasetId) {
      span.setAttribute(SEMATTRS_DB_NAMESPACE, tableRef.datasetId);
    }
    if (tableRef.tableId) {
      span.setAttribute(SEMATTRS_DB_COLLECTION_NAME, tableRef.tableId);
    }

    return runWithSpan(span, () => {
      try {
        const result = originalDelete.call(this, options);

        return Promise.resolve(result)
          .then((response) => {
            finalizeSpan(span);
            return response;
          })
          .catch((error: unknown) => {
            finalizeSpan(
              span,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          });
      } catch (error) {
        finalizeSpan(
          span,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  };
}

/**
 * Instruments BigQuery with OpenTelemetry tracing.
 *
 * This function patches BigQuery, Dataset, Table, and Job methods to create spans
 * for all database operations. The instrumentation is idempotent - calling it multiple
 * times will only instrument once.
 *
 * @example
 * ```typescript
 * import { BigQuery } from '@google-cloud/bigquery';
 * import { init } from 'autotel';
 * import { instrumentBigQuery } from 'autotel-plugins/bigquery';
 *
 * init({ service: 'my-app' });
 *
 * const bigquery = new BigQuery({ projectId: 'my-project' });
 * instrumentBigQuery(bigquery);
 *
 * // All operations are automatically traced
 * const [rows] = await bigquery.query('SELECT * FROM my_dataset.users');
 * ```
 *
 * @example
 * ```typescript
 * // With configuration
 * instrumentBigQuery(bigquery, {
 *   captureQueryText: 'sanitized',
 *   includeQueryHash: true,
 *   instrumentAdminOps: true,
 * });
 * ```
 */
export function instrumentBigQuery(
  bigquery: BigQuery,
  config?: BigQueryInstrumentationConfig,
): BigQuery {
  if (!bigquery) {
    return bigquery;
  }

  // Use any for internal storage and prototype patching; public API remains BigQuery-typed
  const bq = bigquery as any;

  // Check if already instrumented
  if (bq[INSTRUMENTED_FLAG]) {
    return bigquery;
  }

  const finalConfig: Required<BigQueryInstrumentationConfig> = {
    projectId: config?.projectId || '',
    location: config?.location || '',
    tracerName: config?.tracerName || DEFAULT_TRACER_NAME,
    captureQueryText: config?.captureQueryText || 'summary',
    maxQueryTextLength: config?.maxQueryTextLength || 1000,
    includeQueryHash: config?.includeQueryHash ?? true,
    instrumentAdminOps: config?.instrumentAdminOps ?? false,
    instrumentBqmlOps: config?.instrumentBqmlOps ?? false,
    instrumentRoutineOps: config?.instrumentRoutineOps ?? false,
  };

  const tracer = trace.getTracer(finalConfig.tracerName);

  // Store config and tracer on this instance for per-instance customization
  bq[CONFIG_STORAGE_KEY] = finalConfig;
  bq[TRACER_STORAGE_KEY] = tracer;

  // Get the BigQuery class constructor
  const BigQuery = bq.constructor;

  // Only patch prototypes once globally (prevent double-wrapping)
  if (!BigQuery[PROTOTYPE_INSTRUMENTED_FLAG]) {
    // Instrument core query methods
    instrumentQueryMethod(BigQuery);
    instrumentCreateQueryJob(BigQuery);
    instrumentBigQueryCreateDataset(BigQuery);

    // Instrument Dataset operations (always patch, check config at runtime)
    if (bq.dataset) {
      try {
        // Get Dataset class from a temporary instance
        const tempDataset = bq.dataset('__temp__');
        const Dataset = tempDataset.constructor;

        instrumentDatasetCreate(Dataset);
        instrumentDatasetDelete(Dataset);

        // Clean up temporary reference
        tempDataset.dataset = null;
      } catch {
        // Ignore errors in getting Dataset class
      }
    }

    // Instrument Table operations
    if (bq.dataset) {
      try {
        const tempDataset = bq.dataset('__temp__');
        const tempTable = tempDataset.table('__temp__');
        const Table = tempTable.constructor;

        // Core data operations (always instrumented)
        instrumentTableInsert(Table);
        instrumentTableGetRows(Table);
        instrumentTableCreateLoadJob(Table);
        instrumentTableCreateCopyJob(Table);
        instrumentTableCreateExtractJob(Table);

        // Admin operations (always patch, check config at runtime)
        instrumentTableCreate(Table);
        instrumentTableDelete(Table);

        // Clean up temporary references
        tempTable.table = null;
        tempDataset.dataset = null;
      } catch {
        // Ignore errors in getting Table class
      }
    }

    // Instrument Job operations
    if (bq.job) {
      try {
        const tempJob = bq.job('__temp__');
        const Job = tempJob.constructor;

        instrumentJobGetQueryResults(Job);

        // Clean up temporary reference
        tempJob.job = null;
      } catch {
        // Ignore errors in getting Job class
      }
    }

    // Mark prototypes as instrumented globally
    BigQuery[PROTOTYPE_INSTRUMENTED_FLAG] = true;
  }

  // Mark this instance as instrumented
  bq[INSTRUMENTED_FLAG] = true;

  return bigquery;
}

/**
 * Legacy export for backwards compatibility.
 * @deprecated Use `instrumentBigQuery` instead.
 */
export class BigQueryInstrumentation {
  constructor(private config?: BigQueryInstrumentationConfig) {}

  enable(bigquery: BigQuery): void {
    instrumentBigQuery(bigquery, this.config);
  }
}
