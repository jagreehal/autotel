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
 * Used as the default fallback when users don't provide Pino/Winston.
 * Can also be used directly: import { createBuiltinLogger } from 'autotel/logger'
 *
 * @example
 * ```typescript
 * import { createBuiltinLogger, runWithLogLevel } from 'autotel/logger';
 *
 * const log = createBuiltinLogger('my-service');
 * log.info('User created', { userId: '123' });
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

  return {
    info: (msg: string, attrs?: Record<string, unknown>) =>
      log('info', msg, attrs),

    error: (
      msg: string,
      error?: Error | unknown,
      attrs?: Record<string, unknown>,
    ) => {
      let errorAttrs: Record<string, unknown> | undefined;
      if (error instanceof Error) {
        errorAttrs = {
          error: error.message,
          stack: error.stack,
          name: error.name,
          ...attrs,
        };
      } else if (error === undefined) {
        errorAttrs = attrs;
      } else {
        errorAttrs = { error: String(error), ...attrs };
      }

      log('error', msg, errorAttrs);
    },

    warn: (msg: string, attrs?: Record<string, unknown>) =>
      log('warn', msg, attrs),

    debug: (msg: string, attrs?: Record<string, unknown>) =>
      log('debug', msg, attrs),
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
 * log.info('User created', { userId: '123' });
 *
 * // With options
 * const log = autotelLogger({ service: 'my-app', level: 'debug', pretty: true });
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
