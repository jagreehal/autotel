/**
 * Database Instrumentation Helpers
 *
 * Optional import: Not included in main bundle
 * Import from: 'autotel/db'
 *
 * Provides functional utilities for database query instrumentation.
 * Works with Prisma, Drizzle, TypeORM, raw SQL, and more.
 *
 * @example
 * ```typescript
 * import { instrumentDatabase } from 'autotel/db'
 *
 * const db = drizzle(pool)
 * instrumentDatabase(db, { dbSystem: 'postgresql', dbName: 'myapp' })
 *
 * // Now all queries are automatically trace
 * await db.select().from(users)
 * ```
 */

import { SpanStatusCode } from '@opentelemetry/api';
import { getConfig } from './config';

/**
 * Helper: Trace a single database query
 *
 * @example
 * ```typescript
 * import { tracebQuery } from 'autotel/db'
 *
 * const users = await tracebQuery(
 *   'postgresql',
 *   'SELECT',
 *   () => db.query('SELECT * FROM users WHERE active = true')
 * )
 * ```
 */
export async function tracebQuery<T>(
  dbSystem: string,
  operation: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number>,
): Promise<T> {
  const config = getConfig();
  const tracer = config.tracer;

  const spanName = `${dbSystem}.${operation}`;

  return tracer.startActiveSpan(spanName, async (span) => {
    const startTime = performance.now();

    try {
      span.setAttributes({
        'db.system': dbSystem,
        'db.operation': operation,
        ...attributes,
      });

      const result = await fn();

      const duration = performance.now() - startTime;
      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttribute('db.duration_ms', duration);

      if (Array.isArray(result)) {
        span.setAttribute('db.result_count', result.length);
      }

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });

      span.setAttributes({
        'db.duration_ms': duration,
        'error.type':
          error instanceof Error ? error.constructor.name : 'Unknown',
        'error.message':
          error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    } finally {
      span.end();
    }
  });
}

// Helper functions

function inferDbOperation(methodName: string): string {
  const lower = methodName.toLowerCase();
  if (lower.includes('find') || lower.includes('get') || lower.includes('list'))
    return 'SELECT';
  if (lower.includes('create') || lower.includes('insert')) return 'INSERT';
  if (lower.includes('update') || lower.includes('modify')) return 'UPDATE';
  if (lower.includes('delete') || lower.includes('remove')) return 'DELETE';
  if (lower.includes('count')) return 'COUNT';
  return 'QUERY';
}

function inferTableName(methodName: string): string | undefined {
  // Extract table name from method patterns like:
  // findUser -> user
  // listUsers -> users
  // createOrder -> order

  const patterns = [
    /find([A-Z][a-zA-Z]+)/,
    /get([A-Z][a-zA-Z]+)/,
    /list([A-Z][a-zA-Z]+)/,
    /create([A-Z][a-zA-Z]+)/,
    /update([A-Z][a-zA-Z]+)/,
    /delete([A-Z][a-zA-Z]+)/,
    /remove([A-Z][a-zA-Z]+)/,
  ];

  for (const pattern of patterns) {
    const match = methodName.match(pattern);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  }

  return undefined;
}

function sanitizeSqlQuery(query: string): string {
  // Remove string literals and sensitive values (PII, credentials, etc.)
  // Preserves query structure for debugging while protecting data
  return query
    .replaceAll(/'[^']*'/g, "'?'")
    .replaceAll(/"[^"]*"/g, '"?"')
    .replaceAll(/\b\d+\b/g, '?') // Replace literal numbers
    .trim();
}

/**
 * Common database operation metrics
 */
export const DB_OPERATIONS = {
  SELECT: 'SELECT',
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  COUNT: 'COUNT',
  AGGREGATE: 'AGGREGATE',
} as const;

/**
 * Common database systems
 */
export const DB_SYSTEMS = {
  POSTGRESQL: 'postgresql',
  MYSQL: 'mysql',
  MONGODB: 'mongodb',
  REDIS: 'redis',
  SQLITE: 'sqlite',
  MSSQL: 'mssql',
} as const;

// Symbol for idempotency - prevents double-instrumentation
const INSTRUMENTED_SYMBOL = Symbol.for('autotel.db.instrumented');

/**
 * Options for instrumentDatabase
 */
export interface InstrumentDatabaseOptions {
  /** Database system (e.g., 'postgresql', 'mysql') */
  dbSystem: string;
  /** Database name (optional) */
  dbName?: string;
  /** Method names to instrument (if not provided, instruments common patterns) */
  methods?: string[];
  /** Method names to skip */
  skipMethods?: string[];
  /** Sanitize queries (remove sensitive data) - default: true */
  sanitizeQuery?: boolean;
  /** Slow query threshold in milliseconds - default: 1000ms */
  slowQueryThresholdMs?: number;
}

/**
 * Instrument a database client instance with OpenTelemetry tracing
 *
 * This is a function-based alternative to @DbInstrumented decorator.
 * Modifies the client in-place and returns it (idempotent - safe to call multiple times).
 *
 * Inspired by otel-drizzle and other otel instrumentation packages.
 *
 * @example Drizzle ORM
 * ```typescript
 * import { drizzle } from 'drizzle-orm/node-postgres'
 * import { instrumentDatabase } from 'autotel/db'
 *
 * const db = drizzle(pool)
 * instrumentDatabase(db, { dbSystem: 'postgresql', dbName: 'myapp' })
 *
 * // Now all db queries are automatically trace
 * await db.select().from(users)
 * ```
 *
 * @example Prisma
 * ```typescript
 * import { PrismaClient } from '@prisma/client'
 * import { instrumentDatabase } from 'autotel/db'
 *
 * const prisma = new PrismaClient()
 * instrumentDatabase(prisma, {
 *   dbSystem: 'postgresql',
 *   methods: ['findMany', 'findUnique', 'create', 'update', 'delete']
 * })
 *
 * // All specified methods are trace
 * await prisma.user.findMany()
 * ```
 *
 * @example Generic database client
 * ```typescript
 * import { instrumentDatabase } from 'autotel/db'
 *
 * const db = createDatabaseClient()
 * instrumentDatabase(db, {
 *   dbSystem: 'mongodb',
 *   methods: ['find', 'findOne', 'insertOne', 'updateOne', 'deleteOne']
 * })
 * ```
 */
export function instrumentDatabase<T extends object>(
  client: T,
  options: InstrumentDatabaseOptions,
): T {
  // Idempotency check - if already instrumented, return as-is
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((client as any)[INSTRUMENTED_SYMBOL]) {
    return client;
  }

  const {
    dbSystem,
    dbName,
    methods,
    skipMethods = [],
    sanitizeQuery = true,
    slowQueryThresholdMs = 1000,
  } = options;

  const config = getConfig();
  const tracer = config.tracer;

  // Determine which methods to instrument
  const methodsToInstrument = methods || extractDatabaseMethods(client);
  const skipSet = new Set(skipMethods);

  for (const methodName of methodsToInstrument) {
    if (skipSet.has(methodName)) continue;
    if (methodName.startsWith('_')) continue; // Skip private methods

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const method = (client as any)[methodName];
    if (typeof method !== 'function') continue;

    // Preserve the original method
    const originalMethod = method;

    // Wrap the method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any)[methodName] = async function (this: T, ...args: any[]) {
      const operation = inferDbOperation(methodName);
      const table = inferTableName(methodName);

      const spanName = table
        ? `${dbSystem}.${operation} ${table}`
        : `${dbSystem}.${operation}`;

      return tracer.startActiveSpan(spanName, async (span) => {
        const startTime = performance.now();

        try {
          span.setAttributes({
            'db.system': dbSystem,
            'db.operation': operation,
          });

          if (dbName) {
            span.setAttribute('db.name', dbName);
          }

          if (table) {
            span.setAttribute('db.sql.table', table);
          }

          // Try to extract query from arguments (common patterns)
          const query = extractQueryFromArgs(args);
          if (query) {
            span.setAttribute(
              'db.statement',
              sanitizeQuery ? sanitizeSqlQuery(query) : query,
            );
          }

          // Execute original method
          const result = await originalMethod.apply(this, args);

          const duration = performance.now() - startTime;

          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            'db.duration_ms': duration,
          });

          // Mark slow queries
          if (duration > slowQueryThresholdMs) {
            span.setAttribute('db.slow_query', true);
            span.setAttribute(
              'db.slow_query_threshold_ms',
              slowQueryThresholdMs,
            );
          }

          // Track result count if it's an array
          if (Array.isArray(result)) {
            span.setAttribute('db.result_count', result.length);
          }

          return result;
        } catch (error) {
          const duration = performance.now() - startTime;

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
          });

          span.setAttributes({
            'db.duration_ms': duration,
            'error.type':
              error instanceof Error ? error.constructor.name : 'Unknown',
            'error.message':
              error instanceof Error ? error.message : 'Unknown error',
          });

          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );

          throw error;
        } finally {
          span.end();
        }
      });
    };

    // Preserve function name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.defineProperty((client as any)[methodName], 'name', {
      value: methodName,
      configurable: true,
    });
  }

  // Mark as instrumented
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any)[INSTRUMENTED_SYMBOL] = true;

  return client;
}

/**
 * Extract method names from a database client that should be instrumented
 */
function extractDatabaseMethods(client: object): string[] {
  const methods: string[] = [];
  const proto = Object.getPrototypeOf(client);

  // Get own methods
  for (const key of Object.getOwnPropertyNames(client)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (client as any)[key] === 'function' && !key.startsWith('_')) {
      methods.push(key);
    }
  }

  // Get prototype methods
  if (proto) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (
        typeof proto[key] === 'function' &&
        !key.startsWith('_') &&
        key !== 'constructor'
      ) {
        methods.push(key);
      }
    }
  }

  return [...new Set(methods)]; // Deduplicate
}

/**
 * Try to extract SQL query from common argument patterns
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractQueryFromArgs(args: any[]): string | undefined {
  if (args.length === 0) return undefined;

  const firstArg = args[0];

  // String query (raw SQL)
  if (typeof firstArg === 'string') {
    return firstArg;
  }

  // Object with sql property
  if (firstArg && typeof firstArg === 'object') {
    if ('sql' in firstArg && typeof firstArg.sql === 'string') {
      return firstArg.sql;
    }
    // PostgreSQL-style query object
    if ('text' in firstArg && typeof firstArg.text === 'string') {
      return firstArg.text;
    }
    // Query builder pattern
    if ('toQuery' in firstArg && typeof firstArg.toQuery === 'function') {
      try {
        const queryResult = firstArg.toQuery();
        if (typeof queryResult === 'string') return queryResult;
        if (
          queryResult &&
          typeof queryResult === 'object' &&
          'sql' in queryResult
        ) {
          return queryResult.sql as string;
        }
      } catch {
        // Ignore errors from toQuery()
      }
    }
  }

  return undefined;
}
