import { SpanStatusCode } from '@opentelemetry/api';
import type { AttributeValue, TraceContext } from './trace-context';
import { flattenToAttributes } from './flatten-attributes';

const internalKey = Symbol.for('autotel.error.internal');

export interface StructuredErrorInput {
  message: string;
  why?: string;
  fix?: string;
  link?: string;
  code?: string | number;
  status?: number;
  cause?: unknown;
  details?: Record<string, unknown>;
  name?: string;
  /** Backend-only context. Omitted from toJSON() and never serialized to clients. */
  internal?: Record<string, unknown>;
}

export interface StructuredError extends Error {
  why?: string;
  fix?: string;
  link?: string;
  code?: string | number;
  status?: number;
  details?: Record<string, unknown>;
  /** Backend-only context. Omitted from toJSON() and never serialized to clients. */
  readonly internal?: Record<string, unknown>;
}

export function createStructuredError(
  input: StructuredErrorInput,
): StructuredError {
  const error = new Error(input.message, {
    cause: input.cause,
  }) as StructuredError;

  error.name = input.name ?? 'StructuredError';
  if (input.why !== undefined) error.why = input.why;
  if (input.fix !== undefined) error.fix = input.fix;
  if (input.link !== undefined) error.link = input.link;
  if (input.code !== undefined) error.code = input.code;
  if (input.status !== undefined) error.status = input.status;
  if (input.details !== undefined) error.details = input.details;

  if (input.internal !== undefined) {
    Object.defineProperty(error, internalKey, {
      value: input.internal,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }

  Object.defineProperty(error, 'internal', {
    get() {
      return (
        this as StructuredError & { [internalKey]?: Record<string, unknown> }
      )[internalKey];
    },
    enumerable: false,
    configurable: true,
  });

  error.toString = () => {
    const lines = [`${error.name}: ${error.message}`];
    if (error.why) lines.push(`  Why: ${error.why}`);
    if (error.fix) lines.push(`  Fix: ${error.fix}`);
    if (error.link) lines.push(`  Link: ${error.link}`);
    if (error.code !== undefined) lines.push(`  Code: ${error.code}`);
    if (error.status !== undefined) lines.push(`  Status: ${error.status}`);
    if (error.cause) {
      const cause = error.cause as Error;
      lines.push(`  Caused by: ${cause.name}: ${cause.message}`);
    }
    return lines.join('\n');
  };

  return error;
}

export function structuredErrorToJSON(
  error: StructuredError,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if (error.status !== undefined) result.status = error.status;
  if (error.why || error.fix || error.link) {
    result.data = {
      ...(error.why && { why: error.why }),
      ...(error.fix && { fix: error.fix }),
      ...(error.link && { link: error.link }),
    };
  }
  if (error.code !== undefined) result.code = error.code;
  if (error.details) result.details = error.details;
  if (error.cause instanceof Error) {
    result.cause = { name: error.cause.name, message: error.cause.message };
  }

  return result;
}

export function getStructuredErrorAttributes(
  error: Error,
): Record<string, AttributeValue> {
  const structured = error as StructuredError;
  const attributes: Record<string, AttributeValue> = {
    'error.type': error.name || 'Error',
    'error.message': error.message,
  };

  if (error.stack) attributes['error.stack'] = error.stack;
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

export function recordStructuredError(
  ctx: Pick<TraceContext, 'setAttributes' | 'setStatus'>,
  error: Error,
): void {
  const maybeRecordException = (
    ctx as unknown as {
      recordException?: (e: Error) => void;
    }
  ).recordException;
  if (typeof maybeRecordException === 'function') {
    maybeRecordException(error);
  }
  ctx.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message,
  });
  ctx.setAttributes(getStructuredErrorAttributes(error));
}
