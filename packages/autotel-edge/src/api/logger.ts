/**
 * Zero-dependency structured logger for edge environments
 *
 * This logger is ~100 LOC and provides:
 * - Structured JSON logging
 * - Auto trace context injection (traceId, spanId)
 * - Dynamic log level control (per-request via context)
 * - Level support (info, error, warn, debug)
 * - Zero dependencies (console-based)
 *
 * Unlike Pino/Winston (~500KB), this is <1KB minified!
 */

import { trace, context as api_context, createContextKey } from '@opentelemetry/api';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

/**
 * Context key for storing active log level (enables per-request log levels)
 */
const LOG_LEVEL_KEY = createContextKey('autotel-edge-log-level');

export interface EdgeLogger {
  info(msg: string, attrs?: Record<string, any>): void;
  error(msg: string, error?: Error | unknown, attrs?: Record<string, any>): void;
  warn(msg: string, attrs?: Record<string, any>): void;
  debug(msg: string, attrs?: Record<string, any>): void;
}

/**
 * Get the active log level from context (if set)
 * Falls back to undefined if no log level is set in context
 */
export function getActiveLogLevel(): LogLevel | undefined {
  return api_context.active().getValue(LOG_LEVEL_KEY) as LogLevel | undefined;
}

/**
 * Run a function with a specific log level
 * The log level is stored in OpenTelemetry context and applies to all logger calls within the callback
 *
 * This works in edge runtimes (uses OTel context, not Node.js AsyncLocalStorage)
 *
 * @example
 * ```typescript
 * // Enable debug logging for a specific request
 * runWithLogLevel('debug', () => {
 *   log.debug('This will be logged')
 *   processRequest()
 * })
 *
 * // Disable logging temporarily
 * runWithLogLevel('none', () => {
 *   log.info('This will NOT be logged')
 * })
 * ```
 */
export function runWithLogLevel<T>(level: LogLevel, callback: () => T): T {
  const ctx = api_context.active().setValue(LOG_LEVEL_KEY, level);
  return api_context.with(ctx, callback);
}

/**
 * Get current trace context from active span
 */
function getTraceContext():
  | { traceId: string; spanId: string; correlationId: string }
  | null {
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
 * Create a lightweight structured logger
 *
 * @param service - Service name for logging
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * const log = createEdgeLogger('user-service')
 *
 * log.info('Creating user', { email: 'test@example.com' })
 * // Output: {"level":"info","service":"user-service","msg":"Creating user",
 * //          "email":"test@example.com","traceId":"...","spanId":"..."}
 *
 * // Dynamic log level control per-request
 * runWithLogLevel('debug', () => {
 *   log.debug('This will be logged even if logger was created with level: "info"')
 * })
 * ```
 */
export function createEdgeLogger(
  service: string,
  options?: {
    level?: LogLevel;
    pretty?: boolean; // For development
  },
): EdgeLogger {
  const defaultLevel = options?.level || 'info';
  const pretty = options?.pretty || false;

  const levelPriority: Record<LogLevel, number> = {
    none: -1,
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const shouldLog = (level: LogLevel): boolean => {
    // Priority: context level > options level > 'info' default
    const activeLevel = getActiveLogLevel() ?? defaultLevel;

    // 'none' means suppress all logging
    if (activeLevel === 'none') return false;

    return levelPriority[level] >= levelPriority[activeLevel];
  };

  const log = (
    level: 'info' | 'error' | 'warn' | 'debug',
    msg: string,
    attrs?: Record<string, any>,
  ) => {
    if (!shouldLog(level)) return;

    const ctx = getTraceContext();
    const logEntry: Record<string, any> = {
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
    info: (msg: string, attrs?: Record<string, any>) => log('info', msg, attrs),

    error: (msg: string, error?: Error | unknown, attrs?: Record<string, any>) => {
      const errorAttrs = error instanceof Error
        ? {
            error: error.message,
            stack: error.stack,
            name: error.name,
            ...attrs,
          }
        : { error: String(error), ...attrs };

      log('error', msg, errorAttrs);
    },

    warn: (msg: string, attrs?: Record<string, any>) => log('warn', msg, attrs),

    debug: (msg: string, attrs?: Record<string, any>) => log('debug', msg, attrs),
  };
}

/**
 * Helper to get trace context (useful for BYOL - Bring Your Own Logger)
 *
 * @example
 * ```typescript
 * import bunyan from 'bunyan'
 * import { getEdgeTraceContext } from 'autotel-edge/api/logger'
 *
 * const bunyanLogger = bunyan.createLogger({ name: 'myapp' })
 * const ctx = getEdgeTraceContext()
 * bunyanLogger.info({ ...ctx, email: 'test@example.com' }, 'Creating user')
 * ```
 */
export function getEdgeTraceContext() {
  return getTraceContext();
}
