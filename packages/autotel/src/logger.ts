/**
 * Logger types and utilities for autotel
 *
 * **Recommended Approach:** Bring your own logger (Pino, Winston, Bunyan, etc.)
 *
 * Simply create your logger instance and pass it to `init()`.
 * Autotel automatically instruments Pino and Winston to:
 * - Inject trace context (traceId, spanId) into log records
 * - Record errors in the active span
 * - Bridge logs to OpenTelemetry Logs API for OTLP export
 *
 * @example Using Pino (recommended, auto-instrumented)
 * ```typescript
 * import pino from 'pino';  // npm install pino
 * import { init } from 'autotel';
 *
 * const logger = pino({ level: 'info' });
 * init({ service: 'my-app', logger });
 *
 * // Logs automatically include traceId/spanId and export via OTLP!
 * logger.info('User created', { userId: '123' });
 * ```
 *
 * @example Using Winston (auto-instrumented)
 * ```typescript
 * import winston from 'winston';  // npm install winston
 * import { init } from 'autotel';
 *
 * const logger = winston.createLogger({
 *   level: 'info',
 *   format: winston.format.json(),
 *   transports: [new winston.transports.Console()]
 * });
 * init({ service: 'my-app', logger });
 * ```
 *
 * @example Using Bunyan (manual instrumentation)
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
 * @example Custom logger (any logger with 4 methods)
 * ```typescript
 * const logger = {
 *   info: (msg, extra) => console.log(msg, extra),
 *   warn: (msg, extra) => console.warn(msg, extra),
 *   error: (msg, err, extra) => console.error(msg, err, extra),
 *   debug: (msg, extra) => console.debug(msg, extra),
 * };
 * init({ service: 'my-app', logger });
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
 * Simple logger interface - minimal contract for any logger
 *
 * Bring your own Pino, Winston, or any logger with these 4 methods.
 * Autotel automatically instruments Pino and Winston loggers to:
 * - Inject trace context (traceId, spanId) into log records
 * - Record errors in the active span
 * - Bridge logs to OpenTelemetry Logs API for OTLP export
 *
 * @example Using Pino
 * ```typescript
 * import pino from 'pino';
 * const logger = pino({ level: 'info' });
 * init({ service: 'my-app', logger });
 * ```
 *
 * @example Using Winston
 * ```typescript
 * import winston from 'winston';
 * const logger = winston.createLogger({ level: 'info' });
 * init({ service: 'my-app', logger });
 * ```
 */
export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, error?: Error, extra?: Record<string, unknown>): void;
  debug(message: string, extra?: Record<string, unknown>): void;
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
 * // Simple usage
 * class OrderService {
 *   constructor(private readonly deps: { log: Logger }) {}
 *
 *   @LoggedOperation('order.create')
 *   async createOrder(data: CreateOrderData) {
 *     this.deps.logger.info('Creating order', data)
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
          log?.info('Operation started', {
            operation: operationName,
            method: methodName,
            args,
          });

          const result = await originalMethod.apply(this, args);

          const duration = performance.now() - startTime;
          log?.info('Operation completed', {
            operation: operationName,
            method: methodName,
            duration,
          });

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
            'Operation failed',
            error instanceof Error ? error : undefined,
            { operation: operationName, method: methodName, duration },
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
