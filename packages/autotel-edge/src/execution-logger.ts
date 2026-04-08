import { trace as otelTrace, SpanStatusCode } from '@opentelemetry/api';
import type { AttributeValue } from '@opentelemetry/api';
import type { TraceContext } from './functional';
import { createTraceContext } from './core/trace-context';

export interface ExecutionLogger {
  set(fields: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(error: Error | string, fields?: Record<string, unknown>): void;
  getContext(): Record<string, unknown>;
  emitNow(overrides?: Record<string, unknown>): ExecutionLogSnapshot;
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

      activeContext.recordException(err);
      activeContext.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message,
      });
      activeContext.setAttributes(getErrorAttributes(err));
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

    emitNow(overrides?: Record<string, unknown>): ExecutionLogSnapshot {
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

      return snapshot;
    },
  };
}
