import { SpanStatusCode } from '@opentelemetry/api';
import type { AttributeValue, TraceContext } from './trace-context';
import { flattenToAttributes } from './flatten-attributes';
import type { UnknownRecord } from './values';
import { isFunction } from './values';

const internalKey = Symbol.for('autotel.error.internal');

export interface StructuredErrorInput {
  message: string;
  why?: string;
  fix?: string;
  link?: string;
  code?: string | number;
  status?: number;
  cause?: unknown;
  details?: UnknownRecord;
  name?: string;
  /** Backend-only context. Omitted from toJSON() and never serialized to clients. */
  internal?: UnknownRecord;
}

export interface StructuredError extends Error {
  why?: string;
  fix?: string;
  link?: string;
  code?: string | number;
  status?: number;
  details?: UnknownRecord;
  /** Backend-only context. Omitted from toJSON() and never serialized to clients. */
  readonly internal?: UnknownRecord;
}

export function createStructuredError(
  input: StructuredErrorInput,
): StructuredError {
  // SAFETY: the fields StructuredError adds to Error are all optional and are
  // set below; until then the new Error simply has none of them.
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
      // SAFETY: `internalKey` is written a few lines above, on this same
      // object and nowhere else, with the input's `internal` bag.
      return (this as StructuredError & { [internalKey]?: UnknownRecord })[
        internalKey
      ];
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
    if (error.cause instanceof Error) {
      lines.push(`  Caused by: ${error.cause.name}: ${error.cause.message}`);
    } else if (error.cause !== undefined) {
      lines.push(`  Caused by: ${String(error.cause)}`);
    }
    return lines.join('\n');
  };

  return error;
}

export function structuredErrorToJSON(error: StructuredError): UnknownRecord {
  const result: UnknownRecord = {
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

/** The `error.*` attributes a failure contributes to a span. */
export type ErrorAttributes = Record<string, AttributeValue>;

export function getStructuredErrorAttributes(error: Error) {
  // SAFETY: StructuredError only adds optional fields to Error, so a plain
  // Error read through it simply has none of them - which is what each check
  // below is for.
  const structured = error as StructuredError;
  const attributes: ErrorAttributes = {};
  attributes['error.type'] = error.name || 'Error';
  attributes['error.message'] = error.message;

  if (error.stack) attributes['error.stack'] = error.stack;
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

export function recordStructuredError(
  ctx: Pick<TraceContext, 'setAttributes' | 'setStatus'>,
  error: Error,
): void {
  // SAFETY: the parameter is the narrow slice of TraceContext this function
  // needs; a full context also records exceptions, and one that does not
  // simply leaves this undefined.
  const maybeRecordException = (
    ctx as Partial<TraceContext> & {
      recordException?: (e: Error) => void;
    }
  ).recordException;
  if (isFunction(maybeRecordException)) maybeRecordException(error);
  ctx.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message,
  });
  ctx.setAttributes(getStructuredErrorAttributes(error));
}
