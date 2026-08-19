import type { UnknownRecord } from './values';
import {
  asFunction,
  asRecord,
  asString,
  nonEmptyString,
  readProperty,
  toAttributeValue,
  toError,
} from './values';
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

function mergeInto(target: UnknownRecord, source: UnknownRecord): void {
  for (const key in source) {
    const sourceVal = source[key];
    if (sourceVal === undefined) continue;
    const targetVal = target[key];
    const sourceRecord = asRecord(sourceVal);
    const targetRecord = asRecord(targetVal);
    if (sourceRecord && targetRecord) {
      mergeInto(targetRecord, sourceRecord);
    } else if (Array.isArray(targetVal) && Array.isArray(sourceVal)) {
      target[key] = [...targetVal, ...sourceVal];
    } else {
      target[key] = sourceVal;
    }
  }
}

function generateCorrelationId(): string {
  const randomUUID = asFunction(readProperty(globalThis.crypto, 'randomUUID'));
  const uuid = randomUUID
    ? asString(randomUUID.call(globalThis.crypto))
    : undefined;
  if (uuid !== undefined) return uuid;

  return `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Optional lifecycle hooks for adapters that need to track child loggers
 * spawned by `log.fork()` (e.g. activeLoggers maps in framework integrations).
 */
export interface ForkLifecycle {
  /** Called after the child logger is created, before `fn` runs. */
  onChildEnter?: (child: ExecutionLogger) => void;
  /** Called after the child has finished (emit + drain), success or failure. */
  onChildExit?: (child: ExecutionLogger) => void;
}

export interface ForkOptions {
  lifecycle?: ForkLifecycle;
}

export interface ExecutionLogger {
  set(fields: UnknownRecord): void;
  info(message: string, fields?: UnknownRecord): void;
  warn(message: string, fields?: UnknownRecord): void;
  error(error: Error | string, fields?: UnknownRecord): void;
  getContext(): UnknownRecord;
  emitNow(overrides?: UnknownRecord): ExecutionLogSnapshot;
  fork(
    label: string,
    fn: () => void | Promise<void>,
    options?: ForkOptions,
  ): void;
}

export interface ExecutionLogSnapshot {
  timestamp: string;
  traceId: string;
  spanId: string;
  correlationId: string;
  context: UnknownRecord;
}

export interface ExecutionLoggerOptions {
  onEmit?: (snapshot: ExecutionLogSnapshot) => void | Promise<void>;
}

/**
 * A field of an execution log line, as an OTel attribute. Dates and Errors get
 * a readable form of their own; everything else goes through the shared rule,
 * except that a plain object is left for the flattener below to walk.
 */
function toLogAttribute(value: unknown): AttributeValue | undefined {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return value.message;
  if (asRecord(value)) return undefined;
  try {
    return toAttributeValue(value);
  } catch {
    return '<serialization-failed>';
  }
}

function flattenToAttributes(fields: UnknownRecord, prefix = '') {
  const out: Record<string, AttributeValue> = {};
  const seen = new WeakSet<object>();

  function flatten(obj: UnknownRecord, currentPrefix: string): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value == null) continue;

      const nextKey = currentPrefix ? `${currentPrefix}.${key}` : key;
      const attr = toLogAttribute(value);

      if (attr !== undefined) {
        out[nextKey] = attr;
        continue;
      }

      const nested = asRecord(value);
      if (nested && nested.constructor === Object) {
        if (seen.has(nested)) {
          out[nextKey] = '<circular-reference>';
          continue;
        }

        seen.add(nested);
        flatten(nested, nextKey);
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

/** The `error.*` attributes a failure contributes to an execution line. */
type ErrorAttributes = Record<string, AttributeValue>;

function getErrorAttributes(error: Error) {
  const attributes: ErrorAttributes = {};
  attributes['error.type'] = error.name || 'Error';
  attributes['error.message'] = error.message;

  if (error.stack) {
    attributes['error.stack'] = error.stack;
  }

  // SAFETY: a structured error adds these optional fields to Error; a plain
  // Error read through the same type simply has none of them, which is what
  // each check below is for.
  const structured = error as Error & {
    why?: string;
    fix?: string;
    link?: string;
    code?: string | number;
    status?: number;
    details?: UnknownRecord;
  };

  if (structured.why) attributes['error.why'] = structured.why;
  if (structured.fix) attributes['error.fix'] = structured.fix;
  if (structured.link) attributes['error.link'] = structured.link;
  if (structured.code !== undefined) {
    attributes['error.code'] = String(structured.code);
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
  let contextState: UnknownRecord = {};
  let emitted = false;
  let lastSnapshot: ExecutionLogSnapshot | null = null;

  const addLogEvent = (
    level: 'info' | 'warn' | 'error',
    message: string,
    fields?: UnknownRecord,
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
    set(fields: UnknownRecord) {
      sealCheck('log.set()', Object.keys(fields));
      if (emitted) return;
      mergeInto(contextState, fields);
      activeContext.setAttributes(flattenToAttributes(fields));
    },

    info(message: string, fields?: UnknownRecord) {
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

    warn(message: string, fields?: UnknownRecord) {
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

    error(error: Error | string, fields?: UnknownRecord) {
      const keys = fields ? [...Object.keys(fields), 'error'] : ['error'];
      sealCheck('log.error()', keys);
      if (emitted) return;
      const err = toError(error);

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

    emitNow(overrides?: UnknownRecord): ExecutionLogSnapshot {
      if (emitted) {
        warnPostEmit('log.emitNow()', 'Ignoring duplicate emit.');
        // SAFETY: `emitted` is only ever set together with `lastSnapshot`, in
        // the one place below that assigns both.
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

    fork(
      label: string,
      fn: () => void | Promise<void>,
      forkOptions?: ForkOptions,
    ): void {
      const parentCorrelationId = nonEmptyString(activeContext.correlationId);
      if (parentCorrelationId === undefined) {
        throw new Error(
          '[autotel-edge] log.fork() requires the parent logger to have a correlationId. ' +
            'Ensure execution context was created by autotel trace instrumentation.',
        );
      }

      const lifecycle = forkOptions?.lifecycle;
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

        lifecycle?.onChildEnter?.(childLog);

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
            try {
              lifecycle?.onChildExit?.(childLog);
            } catch (hookError) {
              console.warn(
                '[autotel-edge] fork onChildExit hook threw:',
                hookError,
              );
            }
            childSpan.end();
          });
      });
    },
  };
}
