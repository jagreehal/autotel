/**
 * Logger types and utilities for autotel
 *
 * **Zero-Config Option:** Don't provide a logger to `init()` and autotel uses
 * a built-in structured JSON logger with automatic trace context injection.
 *
 * **BYOL (Bring Your Own Logger):** Pass Pino or Bunyan to `init()` for
 * automatic instrumentation with trace context and OTLP log export.
 *
 * ## Logger Signature
 *
 * Autotel v2.10+ uses **Pino's signature**: `logger.info({ metadata }, 'message')`.
 *
 * ### Backward Compatibility
 *
 * The built-in logger auto-detects legacy Winston-style calls and swaps arguments:
 * ```typescript
 * // Legacy (auto-detected and handled)
 * logger.info('User created', { userId: '123' });
 * // → Internally treated as: logger.info({ userId: '123' }, 'User created')
 * // → Logs warning in development, works silently in production
 * ```
 *
 * ### Recommended Usage
 *
 * ```typescript
 * // ✅ Pino-style (preferred)
 * logger.info({ userId: '123' }, 'User created');
 *
 * // ✅ Simple message (no metadata)
 * logger.info('Server started');
 * ```
 *
 * **Note:** If you BYOL (bring your own logger), it must use Pino signature.
 * Winston and other `(message, meta)` loggers are NOT compatible.
 * For Winston, use `@opentelemetry/instrumentation-winston` instead.
 *
 * @example Zero-config (uses built-in logger)
 * ```typescript
 * import { init } from 'autotel';
 *
 * init({ service: 'my-app' });
 * // Internal logs: {"level":"info","service":"my-app","msg":"...","traceId":"..."}
 * ```
 *
 * @example Using built-in logger directly
 * ```typescript
 * import { createBuiltinLogger, runWithLogLevel } from 'autotel/logger';
 *
 * const log = createBuiltinLogger('my-service');
 *
 * // Simple message (no metadata)
 * log.info('Server started');
 *
 * // With metadata (Pino-style: object first, message second)
 * log.info({ userId: '123' }, 'User created');
 * // Output: {"level":"info","service":"my-service","msg":"User created","userId":"123","traceId":"..."}
 *
 * // Dynamic log level per-request
 * runWithLogLevel('debug', () => {
 *   log.debug('Debug info for this request only');
 * });
 * ```
 *
 * @example Using Pino (recommended for production, auto-instrumented)
 * ```typescript
 * import pino from 'pino';  // npm install pino
 * import { init } from 'autotel';
 *
 * const logger = pino({ level: 'info' });
 * init({ service: 'my-app', logger });
 *
 * // Logs automatically include traceId/spanId and export via OTLP!
 * logger.info({ userId: '123' }, 'User created');
 * ```
 *
 * @example Using Bunyan (auto-instrumented, same signature as Pino)
 * ```typescript
 * import bunyan from 'bunyan';  // npm install bunyan @opentelemetry/instrumentation-bunyan
 * import { init } from 'autotel';
 * import { BunyanInstrumentation } from '@opentelemetry/instrumentation-bunyan';
 *
 * const logger = bunyan.createLogger({ name: 'my-app' });
 * init({
 *   service: 'my-app',
 *   logger,
 *   instrumentations: [new BunyanInstrumentation()]
 * });
 * ```
 *
 * @example Custom logger (MUST use Pino-compatible signature)
 * ```typescript
 * // ⚠️ Your custom logger MUST accept (object, message?) signature
 * const logger = {
 *   info: (extra, msg) => console.log(msg || '', extra),
 *   warn: (extra, msg) => console.warn(msg || '', extra),
 *   error: (extra, msg) => console.error(msg || '', extra),
 *   debug: (extra, msg) => console.debug(msg || '', extra),
 * };
 * init({ service: 'my-app', logger });
 * ```
 *
 * @example BYOL helper: inject trace context into any logger
 * ```typescript
 * import bunyan from 'bunyan';
 * import { getTraceContext } from 'autotel/logger';
 *
 * const bunyanLogger = bunyan.createLogger({ name: 'myapp' });
 * const ctx = getTraceContext();
 * bunyanLogger.info({ ...ctx, userId: '123' }, 'Creating user');
 * ```
 */

import { SpanStatusCode } from '@opentelemetry/api';
import { getConfig } from './config';

// ============================================================================
// Logger Types
// ============================================================================

/**
 * Log level constants
 */
export const LOG_LEVEL = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;

export type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];

/**
 * Logger configuration (for reference - not needed with BYOL approach)
 */
export interface LoggerConfig {
  service: string;
  level?: LogLevel;
  pretty?: boolean;
  redact?: string[] | false;
}

/**
 * Pino-compatible log function signature
 *
 * Matches Pino's actual LogFn type which supports:
 * - `(msg: string)` - simple string message
 * - `(obj: object, msg?: string)` - object first with optional message
 *
 * @example
 * ```typescript
 * logger.info('User logged in');
 * logger.info({ userId: '123' }, 'User created');
 * logger.error({ err: error }, 'Operation failed');
 * ```
 */
export interface LogFn {
  (msg: string): void;
  (obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Simple logger interface - Pino/Bunyan-compatible
 *
 * Uses Pino's LogFn signature which supports both:
 * - `logger.info('message')` - simple string message
 * - `logger.info({ extra }, 'message')` - object first with optional message
 *
 * This is compatible with Pino, Bunyan, and any logger following this pattern.
 *
 * @example Using Pino (just works!)
 * ```typescript
 * import pino from 'pino';
 * const logger = pino({ level: 'info' });
 * init({ service: 'my-app', logger });
 * ```
 *
 * @example Direct usage
 * ```typescript
 * logger.info('Simple message');
 * logger.info({ userId: '123' }, 'User created');
 * logger.error({ err: error }, 'Operation failed');
 * ```
 */
export interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
}

/**
 * Alias for Logger interface (backwards compatibility)
 * @deprecated Use Logger instead
 */
export type ILogger = Logger;

/**
 * Pino logger type - re-exported for convenience
 *
 * Note: This is a type-only export. To use Pino, install it as a peer dependency:
 * `npm install pino`
 */
export type { Logger as PinoLogger } from 'pino';

// ============================================================================
// LoggedOperation Decorator
// ============================================================================

export interface LoggedOperationOptions {
  /** Operation name for tracing (e.g., 'user.createUser') */
  operationName: string;
}

/**
 * TS5+ Standard Decorator for logging and tracing operations
 * Uses TC39 Stage 3 decorator syntax
 *
 * This is the traditional per-method decorator approach.
 * For zero-boilerplate solution, see @Instrumented class decorator.
 *
 * @example
 * // Simple usage (Pino-style: object first, message second)
 * class OrderService {
 *   constructor(private readonly deps: { log: Logger }) {}
 *
 *   @LoggedOperation('order.create')
 *   async createOrder(data: CreateOrderData) {
 *     // ✅ Correct Pino-style logging
 *     this.deps.log.info({ orderId: data.id }, 'Creating order');
 *   }
 * }
 *
 * // Advanced usage (future-proof for options)
 * @LoggedOperation({ operationName: 'order.create' })
 * async createOrder(data: CreateOrderData) { }
 */
export function LoggedOperation(
  operationNameOrOptions: string | LoggedOperationOptions,
) {
  const operationName =
    typeof operationNameOrOptions === 'string'
      ? operationNameOrOptions
      : operationNameOrOptions.operationName;

  return function <This, Args extends unknown[], Return>(
    originalMethod: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Promise<Return>
    >,
  ) {
    const methodName = String(context.name);

    return async function (this: This, ...args: Args): Promise<Return> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const log = (this as any).deps?.log;
      const startTime = performance.now();

      const config = getConfig();
      const tracer = config.tracer;

      return tracer.startActiveSpan(operationName, async (span) => {
        try {
          log?.info(
            {
              operation: operationName,
              method: methodName,
              args,
            },
            'Operation started',
          );

          const result = await originalMethod.apply(this, args);

          const duration = performance.now() - startTime;
          log?.info(
            {
              operation: operationName,
              method: methodName,
              duration,
            },
            'Operation completed',
          );

          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            'operation.name': operationName,
            'operation.method': methodName,
            'operation.duration': duration,
            'operation.success': true,
          });

          return result;
        } catch (error) {
          const duration = performance.now() - startTime;
          log?.error(
            {
              err: error instanceof Error ? error : undefined,
              operation: operationName,
              method: methodName,
              duration,
            },
            'Operation failed',
          );

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
          });
          span.setAttributes({
            'operation.name': operationName,
            'operation.method': methodName,
            'operation.duration': duration,
            'operation.success': false,
            'error.type':
              error instanceof Error ? error.constructor.name : 'Unknown',
          });

          throw error;
        } finally {
          span.end();
        }
      });
    };
  };
}

// ============================================================================
// Built-in Logger (re-exports)
// ============================================================================

export {
  autotelLogger,
  createBuiltinLogger,
  runWithLogLevel,
  getTraceContext,
  getActiveLogLevel,
  type BuiltinLogLevel,
  type BuiltinLoggerOptions,
} from './autotel-logger';
