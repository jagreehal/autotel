/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: `any` types are necessary for dynamic instrumentation patterns
// where we need to wrap arbitrary methods and preserve their signatures
import { SpanKind, trace } from '@opentelemetry/api';
import {
  SEMATTRS_DB_SYSTEM,
  SEMATTRS_DB_OPERATION,
  SEMATTRS_DB_STATEMENT,
  SEMATTRS_DB_NAME,
  SEMATTRS_NET_PEER_NAME,
  SEMATTRS_NET_PEER_PORT,
} from '../common/constants';
import { runWithSpan, finalizeSpan } from 'autotel/trace-helpers';

const DEFAULT_TRACER_NAME = 'autotel-plugins/drizzle';
const DEFAULT_DB_SYSTEM = 'postgresql';
const INSTRUMENTED_FLAG = '__autotelDrizzleInstrumented' as const;

type QueryCallback = (error: unknown, result: unknown) => void;

type QueryFunction = (...args: any[]) => any;

interface DrizzleClientLike {
  query?: QueryFunction;
  execute?: QueryFunction;
  [INSTRUMENTED_FLAG]?: true;
  [key: string]: any; // Allow other properties
}

/**
 * Configuration options for Drizzle instrumentation.
 */
export interface InstrumentDrizzleConfig {
  /**
   * Custom tracer name. Defaults to "autotel-plugins/drizzle".
   */
  tracerName?: string;

  /**
   * Database system identifier (e.g., "postgresql", "mysql", "sqlite").
   * Defaults to "postgresql".
   */
  dbSystem?: string;

  /**
   * Database name to include in spans.
   */
  dbName?: string;

  /**
   * Whether to capture full SQL query text in spans.
   * Defaults to true.
   */
  captureQueryText?: boolean;

  /**
   * Maximum length for captured query text. Queries longer than this
   * will be truncated. Defaults to 1000 characters.
   */
  maxQueryTextLength?: number;

  /**
   * Remote hostname or IP address of the database server.
   * Example: "db.example.com" or "192.168.1.100"
   */
  peerName?: string;

  /**
   * Remote port number of the database server.
   * Example: 5432 for PostgreSQL, 3306 for MySQL
   */
  peerPort?: number;
}

/**
 * Extracts SQL query text from various query argument formats.
 */
function extractQueryText(queryArg: unknown): string | undefined {
  if (typeof queryArg === 'string') {
    return queryArg;
  }
  if (queryArg && typeof queryArg === 'object') {
    // Generic SQL object format (used by LibSQL, MySQL, and others)
    if (typeof (queryArg as { sql?: unknown }).sql === 'string') {
      return (queryArg as { sql: string }).sql;
    }
    // PostgreSQL-style query object
    if (typeof (queryArg as { text?: unknown }).text === 'string') {
      return (queryArg as { text: string }).text;
    }
    // Drizzle SQL object
    if (
      typeof (queryArg as { queryChunks?: unknown }).queryChunks === 'object'
    ) {
      // Drizzle query objects may have complex structure, try to extract meaningful info
      const drizzleQuery = queryArg as Record<string, unknown>;
      if (typeof drizzleQuery.sql === 'string') {
        return drizzleQuery.sql;
      }
    }
  }
  return undefined;
}

/**
 * Sanitizes and truncates query text for safe inclusion in spans.
 */
function sanitizeQueryText(queryText: string, maxLength: number): string {
  if (queryText.length <= maxLength) {
    return queryText;
  }
  return `${queryText.slice(0, Math.max(0, maxLength))}...`;
}

/**
 * Extracts the SQL operation (SELECT, INSERT, etc.) from query text.
 */
function extractOperation(queryText: string): string | undefined {
  const trimmed = queryText.trimStart();
  const match = /^(?<op>\w+)/u.exec(trimmed);
  return match?.groups?.op?.toUpperCase();
}

/**
 * Instruments a database connection pool/client with OpenTelemetry tracing.
 *
 * This function wraps the connection's `query` and `execute` methods to create spans for each database
 * operation.
 * The instrumentation is idempotent - calling it multiple times on the same connection will only
 * instrument it once.
 *
 * @typeParam TClient - The type of the database connection pool or client
 * @param client - The database connection pool or client to instrument
 * @param config - Optional configuration for instrumentation behavior
 * @returns The instrumented pool/client (same instance, modified in place)
 *
 * @example
 * ```typescript
 * // PostgreSQL with node-postgres
 * import { drizzle } from 'drizzle-orm/node-postgres';
 * import { Pool } from 'pg';
 * import { instrumentDrizzle } from 'autotel-plugins/drizzle';
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const instrumentedPool = instrumentDrizzle(pool, {
 *   dbSystem: 'postgresql',
 *   dbName: 'myapp',
 *   peerName: 'db.example.com',
 *   peerPort: 5432,
 * });
 * const db = drizzle({ client: instrumentedPool });
 * ```
 *
 * @example
 * ```typescript
 * // MySQL with mysql2
 * import { drizzle } from 'drizzle-orm/mysql2';
 * import mysql from 'mysql2/promise';
 * import { instrumentDrizzle } from 'autotel-plugins/drizzle';
 *
 * const connection = await mysql.createConnection({
 *   host: 'localhost',
 *   user: 'root',
 *   database: 'mydb',
 * });
 * const instrumentedConnection = instrumentDrizzle(connection, { dbSystem: 'mysql' });
 * const db = drizzle({ client: instrumentedConnection });
 * ```
 *
 * @example
 * ```typescript
 * // SQLite with better-sqlite3
 * import { drizzle } from 'drizzle-orm/better-sqlite3';
 * import Database from 'better-sqlite3';
 * import { instrumentDrizzle } from 'autotel-plugins/drizzle';
 *
 * const sqlite = new Database('sqlite.db');
 * const instrumentedSqlite = instrumentDrizzle(sqlite, { dbSystem: 'sqlite' });
 * const db = drizzle({ client: instrumentedSqlite });
 * ```
 *
 * @example
 * ```typescript
 * // LibSQL/Turso
 * import { drizzle } from 'drizzle-orm/libsql';
 * import { createClient } from '@libsql/client';
 * import { instrumentDrizzle } from 'autotel-plugins/drizzle';
 *
 * const client = createClient({
 *   url: process.env.DATABASE_URL!,
 *   authToken: process.env.DATABASE_AUTH_TOKEN,
 * });
 * const instrumentedClient = instrumentDrizzle(client, { dbSystem: 'sqlite' });
 * const db = drizzle({ client: instrumentedClient });
 * ```
 */
export function instrumentDrizzle<TClient extends DrizzleClientLike>(
  client: TClient,
  config?: InstrumentDrizzleConfig,
): TClient {
  if (!client) {
    return client;
  }

  // Check if client has query or execute method
  const hasQuery = typeof client.query === 'function';
  const hasExecute = typeof client.execute === 'function';

  if (!hasQuery && !hasExecute) {
    return client;
  }

  if (client[INSTRUMENTED_FLAG]) {
    return client;
  }

  const {
    tracerName = DEFAULT_TRACER_NAME,
    dbSystem = DEFAULT_DB_SYSTEM,
    dbName,
    captureQueryText = true,
    maxQueryTextLength = 1000,
    peerName,
    peerPort,
  } = config ?? {};

  const tracer = trace.getTracer(tracerName);

  // Store the original method (query or execute)
  const originalMethod = hasQuery ? client.query : client.execute;

  if (!originalMethod) {
    return client;
  }

  const instrumentedMethod: QueryFunction = function instrumented(
    this: any,
    ...incomingArgs: any[]
  ) {
    const args = [...incomingArgs];
    let callback: QueryCallback | undefined;

    // Detect callback pattern
    if (typeof args.at(-1) === 'function') {
      callback = args.pop() as QueryCallback;
    }

    // Extract query information
    const queryText = extractQueryText(args[0]);
    const operation = queryText ? extractOperation(queryText) : undefined;
    const spanName = operation
      ? `drizzle.${operation.toLowerCase()}`
      : 'drizzle.query';

    // Start span
    const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
    span.setAttribute(SEMATTRS_DB_SYSTEM, dbSystem);

    if (operation) {
      span.setAttribute(SEMATTRS_DB_OPERATION, operation);
    }

    if (dbName) {
      span.setAttribute(SEMATTRS_DB_NAME, dbName);
    }

    if (captureQueryText && queryText !== undefined) {
      const sanitized = sanitizeQueryText(queryText, maxQueryTextLength);
      span.setAttribute(SEMATTRS_DB_STATEMENT, sanitized);
    }

    if (peerName) {
      span.setAttribute(SEMATTRS_NET_PEER_NAME, peerName);
    }

    if (peerPort) {
      span.setAttribute(SEMATTRS_NET_PEER_PORT, peerPort);
    }

    // Callback-based pattern
    if (callback) {
      return runWithSpan(span, () => {
        const wrappedCallback: QueryCallback = (err, result) => {
          finalizeSpan(span, err);
          if (callback) {
            callback(err, result);
          }
        };

        try {
          return Reflect.apply(originalMethod, this, [
            ...args,
            wrappedCallback,
          ]);
        } catch (error) {
          finalizeSpan(span, error);
          throw error;
        }
      });
    }

    // Promise-based pattern
    return runWithSpan(span, () => {
      try {
        const result = originalMethod.apply(this, args);
        return Promise.resolve(result)
          .then((value) => {
            finalizeSpan(span);
            return value;
          })
          .catch((error) => {
            finalizeSpan(span, error);
            throw error;
          });
      } catch (error) {
        finalizeSpan(span, error);
        throw error;
      }
    });
  };

  client[INSTRUMENTED_FLAG] = true;

  // Replace the original method with the instrumented one
  if (hasQuery) {
    client.query = instrumentedMethod;
  } else {
    client.execute = instrumentedMethod;
  }

  return client;
}

/**
 * Interface for Drizzle database instances with minimal type requirements.
 */
interface DrizzleDbLike {
  $client?: DrizzleClientLike | any; // Allow any client type
  execute?: QueryFunction; // Direct execute method on db
  transaction?: QueryFunction; // Transaction method on db
  _?: {
    session?: {
      execute?: QueryFunction;
      [INSTRUMENTED_FLAG]?: true;
      [key: string]: any;
    };
    [key: string]: any;
  };
  [INSTRUMENTED_FLAG]?: true;
  [key: string]: any; // Allow other properties
}

/**
 * Instruments a Drizzle database instance with OpenTelemetry tracing.
 *
 * This function instruments the database at the session level, automatically tracing all database
 * operations including query builders, direct SQL execution, and transactions.
 *
 * The instrumentation is idempotent - calling it multiple times on the same
 * database will only instrument it once.
 *
 * @typeParam TDb - The type of the Drizzle database instance
 * @param db - The Drizzle database instance to instrument
 * @param config - Optional configuration for instrumentation behavior
 * @returns The instrumented database instance (same instance, modified in place)
 *
 * @example
 * ```typescript
 * // PostgreSQL with postgres.js
 * import { drizzle } from 'drizzle-orm/postgres-js';
 * import postgres from 'postgres';
 * import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';
 *
 * // Using connection string
 * const db = drizzle(process.env.DATABASE_URL!);
 * instrumentDrizzleClient(db, { dbSystem: 'postgresql' });
 *
 * // Or with a client instance
 * const queryClient = postgres(process.env.DATABASE_URL!);
 * const db = drizzle({ client: queryClient });
 * instrumentDrizzleClient(db, { dbSystem: 'postgresql' });
 * ```
 *
 * @example
 * ```typescript
 * // PostgreSQL with node-postgres (pg)
 * import { drizzle } from 'drizzle-orm/node-postgres';
 * import { Pool } from 'pg';
 * import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';
 *
 * // Using connection string
 * const db = drizzle(process.env.DATABASE_URL!);
 * instrumentDrizzleClient(db, { dbSystem: 'postgresql' });
 *
 * // Or with a pool
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const db = drizzle({ client: pool });
 * instrumentDrizzleClient(db, {
 *   dbSystem: 'postgresql',
 *   dbName: 'myapp',
 *   peerName: 'db.example.com',
 *   peerPort: 5432,
 * });
 * ```
 */
export function instrumentDrizzleClient<TDb extends DrizzleDbLike>(
  db: TDb,
  config?: InstrumentDrizzleConfig,
): TDb {
  if (!db) {
    return db;
  }

  // Check if already instrumented
  if (db[INSTRUMENTED_FLAG]) {
    return db;
  }

  const {
    tracerName = DEFAULT_TRACER_NAME,
    dbSystem = DEFAULT_DB_SYSTEM,
    dbName,
    captureQueryText = true,
    maxQueryTextLength = 1000,
    peerName,
    peerPort,
  } = config ?? {};

  const tracer = trace.getTracer(tracerName);
  let instrumented = false;

  // First priority: Instrument the session directly
  // This is where all queries actually go through
  if ((db as any).session && !instrumented) {
    const session = (db as any).session;

    // Check if session has prepareQuery method (used by select/insert/update/delete)
    if (
      typeof session.prepareQuery === 'function' &&
      !session[INSTRUMENTED_FLAG]
    ) {
      const originalPrepareQuery = session.prepareQuery;

      session.prepareQuery = function (...args: any[]) {
        const prepared = originalPrepareQuery.apply(this, args);

        // Wrap the prepared query's execute method
        if (prepared && typeof prepared.execute === 'function') {
          const originalPreparedExecute = prepared.execute;

          prepared.execute = function (this: any, ...executeArgs: any[]) {
            // Extract query information from the query object
            const queryObj = args[0]; // The query object passed to prepareQuery
            const queryText =
              queryObj?.sql ||
              queryObj?.queryString ||
              extractQueryText(queryObj);
            const operation = queryText
              ? extractOperation(queryText)
              : undefined;
            const spanName = operation
              ? `drizzle.${operation.toLowerCase()}`
              : 'drizzle.query';

            // Start span
            const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
            span.setAttribute(SEMATTRS_DB_SYSTEM, dbSystem);

            if (operation) {
              span.setAttribute(SEMATTRS_DB_OPERATION, operation);
            }

            if (dbName) {
              span.setAttribute(SEMATTRS_DB_NAME, dbName);
            }

            if (captureQueryText && queryText !== undefined) {
              const sanitized = sanitizeQueryText(
                queryText,
                maxQueryTextLength,
              );
              span.setAttribute(SEMATTRS_DB_STATEMENT, sanitized);
            }

            if (peerName) {
              span.setAttribute(SEMATTRS_NET_PEER_NAME, peerName);
            }

            if (peerPort) {
              span.setAttribute(SEMATTRS_NET_PEER_PORT, peerPort);
            }

            // Execute the prepared query
            return runWithSpan(span, () => {
              try {
                const result = originalPreparedExecute.apply(this, executeArgs);
                return Promise.resolve(result)
                  .then((value) => {
                    finalizeSpan(span);
                    return value;
                  })
                  .catch((error) => {
                    finalizeSpan(span, error);
                    throw error;
                  });
              } catch (error) {
                finalizeSpan(span, error);
                throw error;
              }
            });
          };
        }

        return prepared;
      };

      session[INSTRUMENTED_FLAG] = true;
      instrumented = true;
    }

    // Also instrument direct query method if exists
    if (
      typeof session.query === 'function' &&
      !session[INSTRUMENTED_FLAG + '_query']
    ) {
      const originalQuery = session.query;

      session.query = function (this: any, queryString: string, params: any[]) {
        const operation = queryString
          ? extractOperation(queryString)
          : undefined;
        const spanName = operation
          ? `drizzle.${operation.toLowerCase()}`
          : 'drizzle.query';

        // Start span
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        span.setAttribute(SEMATTRS_DB_SYSTEM, dbSystem);

        if (operation) {
          span.setAttribute(SEMATTRS_DB_OPERATION, operation);
        }

        if (dbName) {
          span.setAttribute(SEMATTRS_DB_NAME, dbName);
        }

        if (captureQueryText && queryString !== undefined) {
          const sanitized = sanitizeQueryText(queryString, maxQueryTextLength);
          span.setAttribute(SEMATTRS_DB_STATEMENT, sanitized);
        }

        if (peerName) {
          span.setAttribute(SEMATTRS_NET_PEER_NAME, peerName);
        }

        if (peerPort) {
          span.setAttribute(SEMATTRS_NET_PEER_PORT, peerPort);
        }

        // Execute the query
        return runWithSpan(span, () => {
          try {
            const result = Reflect.apply(originalQuery, this, [
              queryString,
              params,
            ]);
            return Promise.resolve(result)
              .then((value) => {
                finalizeSpan(span);
                return value;
              })
              .catch((error) => {
                finalizeSpan(span, error);
                throw error;
              });
          } catch (error) {
            finalizeSpan(span, error);
            throw error;
          }
        });
      };

      session[INSTRUMENTED_FLAG + '_query'] = true;
      instrumented = true;
    }

    // Instrument transaction method to ensure transaction sessions are also instrumented
    if (
      typeof session.transaction === 'function' &&
      !session[INSTRUMENTED_FLAG + '_transaction']
    ) {
      const originalTransaction = session.transaction;

      session.transaction = function (
        this: any,
        transactionCallback: any,
        ...restArgs: any[]
      ) {
        // Wrap the transaction callback to instrument the tx object
        const wrappedCallback = async function (tx: any) {
          // Instrument the transaction's session if it has one
          if (tx && (tx.session || tx._?.session || tx)) {
            const txSession = tx.session || tx._?.session || tx;

            // Instrument tx.execute if it exists
            if (
              typeof tx.execute === 'function' &&
              !tx[INSTRUMENTED_FLAG + '_execute']
            ) {
              const originalTxExecute = tx.execute;

              tx.execute = function (this: any, ...executeArgs: any[]) {
                const queryText = extractQueryText(executeArgs[0]);
                const operation = queryText
                  ? extractOperation(queryText)
                  : undefined;
                const spanName = operation
                  ? `drizzle.${operation.toLowerCase()}`
                  : 'drizzle.query';

                // Start span
                const span = tracer.startSpan(spanName, {
                  kind: SpanKind.CLIENT,
                });
                span.setAttribute(SEMATTRS_DB_SYSTEM, dbSystem);
                span.setAttribute('db.transaction', true);

                if (operation) {
                  span.setAttribute(SEMATTRS_DB_OPERATION, operation);
                }

                if (dbName) {
                  span.setAttribute(SEMATTRS_DB_NAME, dbName);
                }

                if (captureQueryText && queryText !== undefined) {
                  const sanitized = sanitizeQueryText(
                    queryText,
                    maxQueryTextLength,
                  );
                  span.setAttribute(SEMATTRS_DB_STATEMENT, sanitized);
                }

                if (peerName) {
                  span.setAttribute(SEMATTRS_NET_PEER_NAME, peerName);
                }

                if (peerPort) {
                  span.setAttribute(SEMATTRS_NET_PEER_PORT, peerPort);
                }

                // Execute the query
                return runWithSpan(span, () => {
                  try {
                    const result = originalTxExecute.apply(this, executeArgs);
                    return Promise.resolve(result)
                      .then((value) => {
                        finalizeSpan(span);
                        return value;
                      })
                      .catch((error) => {
                        finalizeSpan(span, error);
                        throw error;
                      });
                  } catch (error) {
                    finalizeSpan(span, error);
                    throw error;
                  }
                });
              };

              tx[INSTRUMENTED_FLAG + '_execute'] = true;
            }

            // Also instrument txSession.prepareQuery if it exists
            if (
              typeof txSession.prepareQuery === 'function' &&
              !txSession[INSTRUMENTED_FLAG + '_tx']
            ) {
              const originalTxPrepareQuery = txSession.prepareQuery;

              txSession.prepareQuery = function (...prepareArgs: any[]) {
                const prepared = originalTxPrepareQuery.apply(
                  this,
                  prepareArgs,
                );

                // Wrap the prepared query's execute method
                if (prepared && typeof prepared.execute === 'function') {
                  const originalPreparedExecute = prepared.execute;

                  prepared.execute = function (
                    this: any,
                    ...executeArgs: any[]
                  ) {
                    // Extract query information from the query object
                    const queryObj = prepareArgs[0]; // The query object passed to prepareQuery
                    const queryText =
                      queryObj?.sql ||
                      queryObj?.queryString ||
                      extractQueryText(queryObj);
                    const operation = queryText
                      ? extractOperation(queryText)
                      : undefined;
                    const spanName = operation
                      ? `drizzle.${operation.toLowerCase()}`
                      : 'drizzle.query';

                    // Start span
                    const span = tracer.startSpan(spanName, {
                      kind: SpanKind.CLIENT,
                    });
                    span.setAttribute(SEMATTRS_DB_SYSTEM, dbSystem);
                    span.setAttribute('db.transaction', true);

                    if (operation) {
                      span.setAttribute(SEMATTRS_DB_OPERATION, operation);
                    }

                    if (dbName) {
                      span.setAttribute(SEMATTRS_DB_NAME, dbName);
                    }

                    if (captureQueryText && queryText !== undefined) {
                      const sanitized = sanitizeQueryText(
                        queryText,
                        maxQueryTextLength,
                      );
                      span.setAttribute(SEMATTRS_DB_STATEMENT, sanitized);
                    }

                    if (peerName) {
                      span.setAttribute(SEMATTRS_NET_PEER_NAME, peerName);
                    }

                    if (peerPort) {
                      span.setAttribute(SEMATTRS_NET_PEER_PORT, peerPort);
                    }

                    // Execute the prepared query
                    return runWithSpan(span, () => {
                      try {
                        const result = originalPreparedExecute.apply(
                          this,
                          executeArgs,
                        );
                        return Promise.resolve(result)
                          .then((value) => {
                            finalizeSpan(span);
                            return value;
                          })
                          .catch((error) => {
                            finalizeSpan(span, error);
                            throw error;
                          });
                      } catch (error) {
                        finalizeSpan(span, error);
                        throw error;
                      }
                    });
                  };
                }

                return prepared;
              };

              txSession[INSTRUMENTED_FLAG + '_tx'] = true;
            }
          }

          // Call the original callback with the instrumented tx
          return transactionCallback(tx);
        };

        // Call the original transaction with the wrapped callback
        return Reflect.apply(originalTransaction, this, [
          wrappedCallback,
          ...restArgs,
        ]);
      };

      session[INSTRUMENTED_FLAG + '_transaction'] = true;
      instrumented = true;
    }
  }

  if (db.$client && !instrumented) {
    const client = db.$client;
    // Check if client has query or execute function
    if (
      typeof client.query === 'function' ||
      typeof client.execute === 'function'
    ) {
      instrumentDrizzle(client, config);
      instrumented = true;
    }
  }

  // Third priority: Try to instrument via session.execute as fallback
  if (
    db._ &&
    db._.session &&
    typeof db._.session.execute === 'function' &&
    !instrumented
  ) {
    const session = db._.session;

    // Check if already instrumented
    if (session[INSTRUMENTED_FLAG]) {
      return db;
    }

    const {
      tracerName = DEFAULT_TRACER_NAME,
      dbSystem = DEFAULT_DB_SYSTEM,
      dbName,
      captureQueryText = true,
      maxQueryTextLength = 1000,
      peerName,
      peerPort,
    } = config ?? {};

    const tracer = trace.getTracer(tracerName);
    const originalExecute = session.execute;

    if (!originalExecute) {
      return db;
    }

    const instrumentedExecute: QueryFunction = function instrumented(
      this: any,
      ...args: any[]
    ) {
      // Extract query information
      const queryText = extractQueryText(args[0]);
      const operation = queryText ? extractOperation(queryText) : undefined;
      const spanName = operation
        ? `drizzle.${operation.toLowerCase()}`
        : 'drizzle.query';

      // Start span
      const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
      span.setAttribute(SEMATTRS_DB_SYSTEM, dbSystem);

      if (operation) {
        span.setAttribute(SEMATTRS_DB_OPERATION, operation);
      }

      if (dbName) {
        span.setAttribute(SEMATTRS_DB_NAME, dbName);
      }

      if (captureQueryText && queryText !== undefined) {
        const sanitized = sanitizeQueryText(queryText, maxQueryTextLength);
        span.setAttribute(SEMATTRS_DB_STATEMENT, sanitized);
      }

      if (peerName) {
        span.setAttribute(SEMATTRS_NET_PEER_NAME, peerName);
      }

      if (peerPort) {
        span.setAttribute(SEMATTRS_NET_PEER_PORT, peerPort);
      }

      // Promise-based pattern (session.execute is typically promise-based)
      return runWithSpan(span, () => {
        try {
          const result = originalExecute.apply(this, args);
          return Promise.resolve(result)
            .then((value) => {
              finalizeSpan(span);
              return value;
            })
            .catch((error) => {
              finalizeSpan(span, error);
              throw error;
            });
        } catch (error) {
          finalizeSpan(span, error);
          throw error;
        }
      });
    };

    session[INSTRUMENTED_FLAG] = true;
    session.execute = instrumentedExecute;
    instrumented = true;
  }

  // Mark the db as instrumented if we instrumented anything
  if (instrumented) {
    db[INSTRUMENTED_FLAG] = true;
  }

  return db;
}
