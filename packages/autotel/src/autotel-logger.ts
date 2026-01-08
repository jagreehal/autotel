/**
 * Zero-dependency structured logger for autotel
 *
 * This logger provides:
 * - Structured JSON logging (production) or pretty print (development)
 * - Auto trace context injection (traceId, spanId, correlationId)
 * - Dynamic log level control (per-request via OTel context)
 * - Level support (debug, info, warn, error, none)
 * - Zero additional dependencies (uses @opentelemetry/api, already a dep)
 *
 * Uses Pino-compatible signature supporting both patterns:
 * - `log.info('simple message')` - string-only
 * - `log.info({ userId: '123' }, 'message')` - object first with optional message
 *
 * Used as the default fallback when users don't provide Pino/Bunyan.
 * Can also be used directly: import { createBuiltinLogger } from 'autotel/logger'
 *
 * @example
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
 *   log.debug('This will log even if default level is "info"');
 * });
 * ```
 */

import {
  trace,
  context as api_context,
  createContextKey,
} from '@opentelemetry/api';
import type { Logger } from './logger';

export type BuiltinLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

/**
 * Context key for storing active log level (enables per-request log levels)
 */
const LOG_LEVEL_KEY = createContextKey('autotel-log-level');

/**
 * Get the active log level from context (if set)
 * Falls back to undefined if no log level is set in context
 */
export function getActiveLogLevel(): BuiltinLogLevel | undefined {
  return api_context.active().getValue(LOG_LEVEL_KEY) as
    | BuiltinLogLevel
    | undefined;
}

/**
 * Run a function with a specific log level
 * The log level is stored in OpenTelemetry context and applies to all logger calls within the callback
 *
 * @example
 * ```typescript
 * // Enable debug logging for a specific request
 * runWithLogLevel('debug', () => {
 *   log.debug('This will be logged');
 *   processRequest();
 * });
 *
 * // Disable logging temporarily
 * runWithLogLevel('none', () => {
 *   log.info('This will NOT be logged');
 * });
 * ```
 */
export function runWithLogLevel<T>(
  level: BuiltinLogLevel,
  callback: () => T,
): T {
  const ctx = api_context.active().setValue(LOG_LEVEL_KEY, level);
  return api_context.with(ctx, callback);
}

/**
 * Get current trace context from active span
 * Returns null if no active span exists
 */
function getTraceContextInternal(): {
  traceId: string;
  spanId: string;
  correlationId: string;
} | null {
  const span = trace.getActiveSpan();
  if (!span) return null;

  const ctx = span.spanContext();
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    correlationId: ctx.traceId.slice(0, 16), // First 16 chars for grouping
  };
}

/**
 * Helper to get trace context (useful for BYOL - Bring Your Own Logger)
 *
 * @example
 * ```typescript
 * import bunyan from 'bunyan';
 * import { getTraceContext } from 'autotel/logger';
 *
 * const bunyanLogger = bunyan.createLogger({ name: 'myapp' });
 * const ctx = getTraceContext();
 * bunyanLogger.info({ ...ctx, email: 'test@example.com' }, 'Creating user');
 * ```
 */
export function getTraceContext() {
  return getTraceContextInternal();
}

export interface BuiltinLoggerOptions {
  /** Minimum log level. Default: 'info' */
  level?: BuiltinLogLevel;
  /** Pretty print for development. Default: false (JSON output) */
  pretty?: boolean;
}

/**
 * Create a lightweight structured logger
 *
 * @param service - Service name for logging
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * const log = createBuiltinLogger('user-service');
 *
 * log.info('Creating user', { email: 'test@example.com' });
 * // Output: {"level":"info","service":"user-service","msg":"Creating user",
 * //          "email":"test@example.com","traceId":"...","spanId":"..."}
 *
 * // Dynamic log level control per-request
 * runWithLogLevel('debug', () => {
 *   log.debug('This will be logged even if logger was created with level: "info"');
 * });
 * ```
 */
export function createBuiltinLogger(
  service: string,
  options?: BuiltinLoggerOptions,
): Logger {
  const defaultLevel = options?.level || 'info';
  const pretty = options?.pretty || false;

  const levelPriority: Record<BuiltinLogLevel, number> = {
    none: -1,
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const shouldLog = (level: BuiltinLogLevel): boolean => {
    // Priority: context level > options level > 'info' default
    const activeLevel = getActiveLogLevel() ?? defaultLevel;

    // 'none' means suppress all logging
    if (activeLevel === 'none') return false;

    return levelPriority[level] >= levelPriority[activeLevel];
  };

  const log = (
    level: 'info' | 'error' | 'warn' | 'debug',
    msg: string,
    attrs?: Record<string, unknown>,
  ) => {
    if (!shouldLog(level)) return;

    const ctx = getTraceContextInternal();
    const logEntry: Record<string, unknown> = {
      level,
      service,
      msg,
      ...attrs,
      ...ctx, // Auto-inject traceId, spanId, correlationId
      timestamp: new Date().toISOString(),
    };

    if (pretty) {
      // Pretty print for development
      const traceInfo = ctx
        ? ` [${ctx.traceId.slice(0, 8)}.../${ctx.spanId.slice(0, 8)}...]`
        : '';
      console.log(
        `[${level.toUpperCase()}]${traceInfo} ${service}: ${msg}`,
        attrs || '',
      );
    } else {
      // Structured JSON for production
      console.log(JSON.stringify(logEntry));
    }
  };

  // Pino-compatible signature: supports both:
  // - logger.info('message') - string-only
  // - logger.info({ extra }, 'message') - Pino style with metadata
  // Also auto-detects and handles legacy Winston-style: logger.info('message', { extra })
  const createLogMethod = (level: 'info' | 'warn' | 'debug') => {
    return (
      extraOrMessage: Record<string, unknown> | string,
      message?: string | Record<string, unknown>,
    ) => {
      if (typeof extraOrMessage === 'string') {
        // First arg is string - could be:
        // 1. String-only: logger.info('message')
        // 2. Legacy Winston-style: logger.info('message', { extra })
        if (message !== undefined && typeof message === 'object') {
          // Legacy Winston-style detected - auto-swap for backward compatibility
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              `[autotel] Legacy logger pattern detected: logger.${level}('message', metadata). ` +
                `Autotel recommends Pino signature: logger.${level}({ ...metadata }, 'message'). ` +
                `Auto-swapping arguments for compatibility.`,
            );
          }
          // Swap: treat first arg as message, second as metadata
          log(level, extraOrMessage, message as Record<string, unknown>);
        } else {
          // Pure string-only call: logger.info('message')
          log(level, extraOrMessage, undefined);
        }
      } else {
        // Pino style: logger.info({ extra }, 'message')
        log(level, (message as string) || '', extraOrMessage);
      }
    };
  };

  return {
    info: createLogMethod('info'),
    warn: createLogMethod('warn'),
    debug: createLogMethod('debug'),

    error: (
      extraOrMessage: Record<string, unknown> | string,
      message?: string | Record<string, unknown> | Error,
    ) => {
      if (typeof extraOrMessage === 'string') {
        // First arg is string - could be:
        // 1. String-only: logger.error('message')
        // 2. Legacy: logger.error('message', error) - Error as second arg
        // 3. Legacy: logger.error('message', { extra }) - object as second arg

        // Handle legacy logger.error('message', error) pattern
        if (message instanceof Error) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              `[autotel] Legacy logger pattern detected: logger.error('message', error). ` +
                `Autotel recommends Pino signature: logger.error({ err: error }, 'message'). ` +
                `Auto-swapping arguments for compatibility.`,
            );
          }
          log('error', extraOrMessage, {
            error: message.message,
            stack: message.stack,
            name: message.name,
          });
          return;
        }

        // Handle legacy logger.error('message', { extra }) pattern
        if (message !== undefined && typeof message === 'object') {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(
              `[autotel] Legacy logger pattern detected: logger.error('message', metadata). ` +
                `Autotel recommends Pino signature: logger.error({ ...metadata }, 'message'). ` +
                `Auto-swapping arguments for compatibility.`,
            );
          }
          // Swap: treat first arg as message, second as metadata (handle err extraction)
          const extra = message as Record<string, unknown>;
          const { err, ...rest } = extra as Record<string, unknown> & {
            err?: unknown;
          };
          let errorAttrs: Record<string, unknown> = rest;
          if (err instanceof Error) {
            errorAttrs = {
              error: err.message,
              stack: err.stack,
              name: err.name,
              ...rest,
            };
          } else if (err !== undefined) {
            errorAttrs = { err, ...rest };
          }
          log('error', extraOrMessage, errorAttrs);
          return;
        }

        // Pure string-only call: logger.error('message')
        log('error', extraOrMessage, undefined);
        return;
      }

      // Pino style: logger.error({ err, ...extra }, 'message')
      // Extract err from extra if present (Pino convention)
      const { err, ...rest } = extraOrMessage as Record<string, unknown> & {
        err?: unknown;
      };
      let errorAttrs: Record<string, unknown> = rest;
      if (err instanceof Error) {
        // err is an Error - extract message, stack, name for structured logging
        errorAttrs = {
          error: err.message,
          stack: err.stack,
          name: err.name,
          ...rest,
        };
      } else if (err !== undefined) {
        // err is not an Error but exists - preserve it as-is
        errorAttrs = {
          err,
          ...rest,
        };
      }
      log('error', (message as string) || '', errorAttrs);
    },
  };
}

/**
 * Pino-like factory function for creating an autotel logger
 *
 * @example
 * ```typescript
 * import { autotelLogger } from 'autotel/logger';
 *
 * const log = autotelLogger();
 *
 * // Simple message
 * log.info('Server started');
 *
 * // With metadata (Pino-style: object first, message second)
 * log.info({ userId: '123' }, 'User created');
 *
 * // With options
 * const devLog = autotelLogger({ service: 'my-app', level: 'debug', pretty: true });
 * ```
 */
export function autotelLogger(options?: {
  service?: string;
  level?: BuiltinLogLevel;
  pretty?: boolean;
}): Logger {
  return createBuiltinLogger(options?.service || 'app', {
    level: options?.level,
    pretty: options?.pretty,
  });
}
