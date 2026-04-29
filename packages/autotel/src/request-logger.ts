import { AsyncLocalStorage } from 'node:async_hooks';
import { trace as otelTrace } from '@opentelemetry/api';
import type { TraceContext } from './trace-context';
import { createTraceContext } from './trace-context';
import { recordStructuredError } from './structured-error';
import { flattenToAttributes } from './flatten-attributes';
import { emitCorrelatedEvent } from './correlated-events';

const POST_EMIT_FORK_HINT =
  "For intentional background work tied to this request, use log.fork('label', fn) when available.";

function warnPostEmit(method: string, detail: string): void {
  console.warn(
    `[autotel] ${method} called after the wide event was emitted — ${detail} This data will not appear in observability. ${POST_EMIT_FORK_HINT}`,
  );
}

function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key in source) {
    const sourceVal = source[key];
    if (sourceVal === undefined) continue;
    const targetVal = target[key];
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      mergeInto(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else if (Array.isArray(targetVal) && Array.isArray(sourceVal)) {
      target[key] = [...targetVal, ...sourceVal];
    } else {
      target[key] = sourceVal;
    }
  }
}

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
  fork(label: string, fn: () => void | Promise<void>): void;
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
  let emitted = false;
  let lastSnapshot: RequestLogSnapshot | null = null;

  const addLogEvent = (
    level: 'info' | 'warn' | 'error',
    message: string,
    fields?: Record<string, unknown>,
  ) => {
    const attrs = fields ? flattenToAttributes(fields) : undefined;
    emitCorrelatedEvent(activeContext, `log.${level}`, {
      message,
      ...(attrs ?? {}),
    });
  };

  const sealCheck = (method: string, keys: string[]): void => {
    if (emitted) {
      warnPostEmit(
        method,
        `Keys dropped: ${keys.length ? keys.join(', ') : '(empty)'}.`,
      );
    }
  };

  return {
    set(fields: Record<string, unknown>) {
      sealCheck('log.set()', Object.keys(fields));
      if (emitted) return;
      mergeInto(contextState, fields);
      activeContext.setAttributes(flattenToAttributes(fields));
    },

    info(message: string, fields?: Record<string, unknown>) {
      const keys = fields
        ? ['message', ...Object.keys(fields).filter((k) => k !== 'requestLogs')]
        : ['message'];
      sealCheck('log.info()', keys);
      if (emitted) return;
      addLogEvent('info', message, fields);
      if (fields) {
        mergeInto(contextState, fields);
        activeContext.setAttributes(flattenToAttributes(fields));
      }
    },

    warn(message: string, fields?: Record<string, unknown>) {
      const keys = fields
        ? ['message', ...Object.keys(fields).filter((k) => k !== 'requestLogs')]
        : ['message'];
      sealCheck('log.warn()', keys);
      if (emitted) return;
      addLogEvent('warn', message, fields);
      activeContext.setAttribute('autotel.log.level', 'warn');
      if (fields) {
        mergeInto(contextState, fields);
        activeContext.setAttributes(flattenToAttributes(fields));
      }
    },

    error(error: Error | string, fields?: Record<string, unknown>) {
      const keys = fields ? [...Object.keys(fields), 'error'] : ['error'];
      sealCheck('log.error()', keys);
      if (emitted) return;
      const err = typeof error === 'string' ? new Error(error) : error;
      recordStructuredError(activeContext, err);
      addLogEvent('error', err.message, fields);

      if (fields) {
        mergeInto(contextState, fields);
        activeContext.setAttributes(flattenToAttributes(fields));
      }
      activeContext.setAttribute('autotel.log.level', 'error');
    },

    getContext() {
      return { ...contextState };
    },

    emitNow(overrides?: Record<string, unknown>): RequestLogSnapshot {
      if (emitted) {
        warnPostEmit('log.emitNow()', 'Ignoring duplicate emit.');
        return lastSnapshot as RequestLogSnapshot;
      }

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

      emitCorrelatedEvent(activeContext, 'log.emit.manual', {
        ...flattened,
      });

      if (options?.onEmit) {
        Promise.resolve(options.onEmit(snapshot)).catch((error) => {
          console.warn('[autotel] request logger onEmit failed:', error);
        });
      }

      emitted = true;
      lastSnapshot = snapshot;
      return snapshot;
    },

    fork(label: string, fn: () => void | Promise<void>): void {
      const parentRequestId = activeContext.correlationId;
      if (typeof parentRequestId !== 'string' || parentRequestId.length === 0) {
        throw new Error(
          '[autotel] log.fork() requires the parent logger to have a correlationId. ' +
            'Ensure the request was created by autotel middleware.',
        );
      }

      const tracer = otelTrace.getTracer('autotel.request-logger');
      void tracer.startActiveSpan(`request.fork:${label}`, (childSpan) => {
        const childContext: TraceContext = {
          ...createTraceContext(childSpan),
          correlationId: crypto.randomUUID(),
        };

        requestContextStore.run(childContext, () => {
          const childLog = getRequestLogger(childContext);
          childLog.set({
            operation: label,
            _parentCorrelationId: parentRequestId,
          });

          void Promise.resolve()
            .then(() => fn())
            .then(() => {
              childLog.emitNow();
            })
            .catch((err: unknown) => {
              const error = err instanceof Error ? err : new Error(String(err));
              childLog.error(error);
              childLog.emitNow();
            })
            .finally(() => {
              childSpan.end();
            });
        });
      });
    },
  };
}
