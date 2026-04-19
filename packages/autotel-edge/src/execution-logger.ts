import { trace as otelTrace, SpanStatusCode } from '@opentelemetry/api';
import type { AttributeValue } from '@opentelemetry/api';
import type { TraceContext } from './functional';
import { createTraceContext } from './core/trace-context';

const POST_EMIT_FORK_HINT =
  "For intentional background work tied to this execution, use log.fork('label', fn) when available.";

function warnPostEmit(method: string, detail: string): void {
  console.warn(
    `[autotel-edge] ${method} called after the execution event was emitted - ${detail} This data will not appear in observability. ${POST_EMIT_FORK_HINT}`,
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

function generateCorrelationId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface ExecutionLogger {
  set(fields: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(error: Error | string, fields?: Record<string, unknown>): void;
  getContext(): Record<string, unknown>;
  emitNow(overrides?: Record<string, unknown>): ExecutionLogSnapshot;
  fork(label: string, fn: () => void | Promise<void>): void;
}

export interface ExecutionLogSnapshot {
  timestamp: string;
  traceId: string;
  spanId: string;
  correlationId: string;
  context: Record<string, unknown>;
}

export interface ExecutionLoggerOptions {
  onEmit?: (snapshot: ExecutionLogSnapshot) => void | Promise<void>;
}

function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    if (
      value.every((item) => typeof item === 'string') ||
      value.every((item) => typeof item === 'number') ||
      value.every((item) => typeof item === 'boolean')
    ) {
      return value as AttributeValue;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return '<serialization-failed>';
    }
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return value.message;
  }

  return undefined;
}

function flattenToAttributes(
  fields: Record<string, unknown>,
  prefix = '',
): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  const seen = new WeakSet<object>();

  function flatten(obj: Record<string, unknown>, currentPrefix: string): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value == null) continue;

      const nextKey = currentPrefix ? `${currentPrefix}.${key}` : key;
      const attr = toAttributeValue(value);

      if (attr !== undefined) {
        out[nextKey] = attr;
        continue;
      }

      if (typeof value === 'object' && value.constructor === Object) {
        if (seen.has(value)) {
          out[nextKey] = '<circular-reference>';
          continue;
        }

        seen.add(value);
        flatten(value as Record<string, unknown>, nextKey);
        continue;
      }

      try {
        out[nextKey] = JSON.stringify(value);
      } catch {
        out[nextKey] = '<serialization-failed>';
      }
    }
  }

  flatten(fields, prefix);
  return out;
}

function getErrorAttributes(error: Error): Record<string, AttributeValue> {
  const attributes: Record<string, AttributeValue> = {
    'error.type': error.name || 'Error',
    'error.message': error.message,
  };

  if (error.stack) {
    attributes['error.stack'] = error.stack;
  }

  const structured = error as Error & {
    why?: string;
    fix?: string;
    link?: string;
    code?: string | number;
    status?: number;
    details?: Record<string, unknown>;
  };

  if (structured.why) attributes['error.why'] = structured.why;
  if (structured.fix) attributes['error.fix'] = structured.fix;
  if (structured.link) attributes['error.link'] = structured.link;
  if (structured.code !== undefined) {
    attributes['error.code'] =
      typeof structured.code === 'string'
        ? structured.code
        : String(structured.code);
  }
  if (structured.status !== undefined) {
    attributes['error.status'] = structured.status;
  }
  if (structured.details) {
    Object.assign(
      attributes,
      flattenToAttributes(structured.details, 'error.details'),
    );
  }

  return attributes;
}

function resolveContext(ctx?: TraceContext): TraceContext {
  if (ctx) return ctx;

  const span = otelTrace.getActiveSpan();
  if (!span) {
    throw new Error(
      '[autotel-edge] getExecutionLogger() requires an active span or explicit TraceContext. Wrap your handler with trace() or pass ctx directly.',
    );
  }

  return createTraceContext(span);
}

export function getExecutionLogger(
  ctx?: TraceContext,
  options?: ExecutionLoggerOptions,
): ExecutionLogger {
  const activeContext = resolveContext(ctx);
  let contextState: Record<string, unknown> = {};
  let emitted = false;
  let lastSnapshot: ExecutionLogSnapshot | null = null;

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

      activeContext.recordException(err);
      activeContext.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message,
      });
      activeContext.setAttributes(getErrorAttributes(err));
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

    emitNow(overrides?: Record<string, unknown>): ExecutionLogSnapshot {
      if (emitted) {
        warnPostEmit('log.emitNow()', 'Ignoring duplicate emit.');
        return lastSnapshot as ExecutionLogSnapshot;
      }

      const mergedContext = {
        ...contextState,
        ...(overrides ?? {}),
      };
      const flattened = flattenToAttributes(mergedContext);
      activeContext.setAttributes(flattened);

      const snapshot: ExecutionLogSnapshot = {
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
          console.warn('[autotel-edge] execution logger onEmit failed:', error);
        });
      }

      emitted = true;
      lastSnapshot = snapshot;
      return snapshot;
    },

    fork(label: string, fn: () => void | Promise<void>): void {
      const parentCorrelationId = activeContext.correlationId;
      if (
        typeof parentCorrelationId !== 'string' ||
        parentCorrelationId.length === 0
      ) {
        throw new Error(
          '[autotel-edge] log.fork() requires the parent logger to have a correlationId. ' +
            'Ensure execution context was created by autotel trace instrumentation.',
        );
      }

      const tracer = otelTrace.getTracer('autotel-edge.execution-logger');
      void tracer.startActiveSpan(`execution.fork:${label}`, (childSpan) => {
        const childContext: TraceContext = {
          ...createTraceContext(childSpan),
          correlationId: generateCorrelationId(),
        };

        const childLog = getExecutionLogger(childContext);
        childLog.set({
          operation: label,
          _parentCorrelationId: parentCorrelationId,
        });

        return Promise.resolve()
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
    },
  };
}
