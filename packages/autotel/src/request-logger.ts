import { AsyncLocalStorage } from 'node:async_hooks';
import { trace as otelTrace } from '@opentelemetry/api';
import type { TraceContext } from './trace-context';
import { createTraceContext } from './trace-context';
import { recordStructuredError } from './structured-error';
import { flattenToAttributes } from './flatten-attributes';

const requestContextStore = new AsyncLocalStorage<TraceContext>();

export function runWithRequestContext<T>(ctx: TraceContext, fn: () => T): T {
  return requestContextStore.run(ctx, fn);
}

export interface RequestLogger {
  set(fields: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(error: Error | string, fields?: Record<string, unknown>): void;
  getContext(): Record<string, unknown>;
  emitNow(overrides?: Record<string, unknown>): RequestLogSnapshot;
}

export interface RequestLogSnapshot {
  timestamp: string;
  traceId: string;
  spanId: string;
  correlationId: string;
  context: Record<string, unknown>;
}

export interface RequestLoggerOptions {
  /** Callback invoked by emitNow() for manual fan-out. */
  onEmit?: (snapshot: RequestLogSnapshot) => void | Promise<void>;
}

function resolveContext(ctx?: TraceContext): TraceContext {
  if (ctx) return ctx;

  const stored = requestContextStore.getStore();
  if (stored) return stored;

  const span = otelTrace.getActiveSpan();
  if (!span) {
    throw new Error(
      '[autotel] getRequestLogger() requires an active span or runWithRequestContext(). Wrap your handler with trace() or use runWithRequestContext().',
    );
  }
  return createTraceContext(span);
}

export function getRequestLogger(
  ctx?: TraceContext,
  options?: RequestLoggerOptions,
): RequestLogger {
  const activeContext = resolveContext(ctx);
  let contextState: Record<string, unknown> = {};

  const addLogEvent = (
    level: 'info' | 'warn' | 'error',
    message: string,
    fields?: Record<string, unknown>,
  ) => {
    const attrs = fields ? flattenToAttributes(fields) : undefined;
    activeContext.addEvent(`log.${level}`, {
      message,
      ...attrs,
    });
  };

  return {
    set(fields: Record<string, unknown>) {
      contextState = {
        ...contextState,
        ...fields,
      };
      activeContext.setAttributes(flattenToAttributes(fields));
    },

    info(message: string, fields?: Record<string, unknown>) {
      addLogEvent('info', message, fields);
      if (fields) {
        contextState = {
          ...contextState,
          ...fields,
        };
        activeContext.setAttributes(flattenToAttributes(fields));
      }
    },

    warn(message: string, fields?: Record<string, unknown>) {
      addLogEvent('warn', message, fields);
      activeContext.setAttribute('autotel.log.level', 'warn');
      if (fields) {
        contextState = {
          ...contextState,
          ...fields,
        };
        activeContext.setAttributes(flattenToAttributes(fields));
      }
    },

    error(error: Error | string, fields?: Record<string, unknown>) {
      const err = typeof error === 'string' ? new Error(error) : error;
      recordStructuredError(activeContext, err);
      addLogEvent('error', err.message, fields);

      if (fields) {
        contextState = {
          ...contextState,
          ...fields,
        };
        activeContext.setAttributes(flattenToAttributes(fields));
      }
      activeContext.setAttribute('autotel.log.level', 'error');
    },

    getContext() {
      return { ...contextState };
    },

    emitNow(overrides?: Record<string, unknown>): RequestLogSnapshot {
      const mergedContext = {
        ...contextState,
        ...(overrides ?? {}),
      };
      const flattened = flattenToAttributes(mergedContext);
      activeContext.setAttributes(flattened);

      const snapshot: RequestLogSnapshot = {
        timestamp: new Date().toISOString(),
        traceId: activeContext.traceId,
        spanId: activeContext.spanId,
        correlationId: activeContext.correlationId,
        context: mergedContext,
      };

      activeContext.addEvent('log.emit.manual', {
        ...flattened,
      });

      if (options?.onEmit) {
        Promise.resolve(options.onEmit(snapshot)).catch((error) => {
          console.warn('[autotel] request logger onEmit failed:', error);
        });
      }

      return snapshot;
    },
  };
}
