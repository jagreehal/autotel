import { SpanStatusCode } from '@opentelemetry/api';
import type { AttributeValue, TraceContext } from './trace-context';
import { flattenToAttributes } from './flatten-attributes';
import type { UnknownRecord } from './values';
import { asString, isFunction, readProperty, readString } from './values';
import { safeRequire } from './node-require';

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

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- JavaScript can throw any value: these helpers decode a thrown value into an Error and its type. */
/**
 * The `error.type` for a failure, shared by thrown and recorded errors so they
 * group alike. A `name` that was set wins (createStructuredError() sets one on a
 * plain Error), even 'Error' when assigned explicitly; otherwise the class, since
 * a subclass that never sets `name` inherits 'Error' from Error.prototype.
 */
export function errorTypeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'Error';
  try {
    const name = 'name' in error ? error.name : undefined;
    // An own `name` was set on purpose; an inherited 'Error' is only the default.
    const set = name !== 'Error' || Object.hasOwn(error, 'name');
    if (typeof name === 'string' && name && set) return name;
    if (!isError(error)) return 'Error';
    return error.constructor?.name || 'Error';
  } catch {
    // A throwing getter or Proxy trap.
    return 'Error';
  }
}

/** Brand check that reads no property of the value; null where the runtime has none. */
let nativeErrorCheck: ((value: unknown) => boolean) | null | undefined;

function isNativeError(value: unknown): boolean {
  if (nativeErrorCheck === undefined) {
    // Resolved on first use, so importing this module in a browser bundle,
    // where node:util is a stub, loads nothing.
    try {
      // SAFETY: Error.isError is ES2026 (Node 24+, current browsers); TS's lib here predates it.
      const standard = (Error as { isError?: (value: unknown) => boolean })
        .isError;
      nativeErrorCheck =
        standard ??
        safeRequire<typeof import('node:util')>('node:util')?.types
          .isNativeError ??
        null;
    } catch {
      nativeErrorCheck = null;
    }
  }
  return nativeErrorCheck?.(value) === true;
}

/**
 * An Error from any realm, including node:vm and iframes, which have their own
 * Error constructor. The native check reads no property of the value.
 */
export function isError(value: unknown): value is Error {
  try {
    return value instanceof Error || isNativeError(value);
  } catch {
    // A Proxy whose getPrototypeOf trap throws.
    return false;
  }
}

/** The value as an Error, wrapping a non-Error. Never throws. */
export function toError(value: unknown): Error {
  if (isError(value)) return value;
  let wrapped: Error;
  try {
    wrapped = new Error(String(value));
  } catch {
    wrapped = new Error('Unknown error');
  }
  // Keeps the original's type: { name: 'Timeout' } records as Timeout.
  wrapped.name = errorTypeOf(value);
  return wrapped;
}
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof */

/** The `error.*` attributes a failure contributes to a span. */
export type ErrorAttributes = Record<string, AttributeValue>;

export function getStructuredErrorAttributes(error: Error) {
  // SAFETY: StructuredError only adds optional fields to Error, so a plain
  // Error read through it simply has none of them - which is what each check
  // below is for.
  const structured = error as StructuredError;
  // Starts empty so the binding keeps its declared type (anti-slop
  // no-known-value-widening); fields are added below, some conditionally.
  const attributes: ErrorAttributes = {};
  // oxlint-disable-next-line unicorn/no-immediate-mutation -- see above
  attributes['error.type'] = errorTypeOf(error);
  // Each field read on its own, so a throwing getter drops only its attribute.
  const read = (write: () => void) => {
    try {
      write();
    } catch {
      // Field omitted.
    }
  };
  read(() => {
    attributes['error.message'] = error.message;
  });
  read(() => {
    if (error.stack) attributes['error.stack'] = error.stack;
  });
  read(() => {
    if (structured.why) attributes['error.why'] = structured.why;
  });
  read(() => {
    if (structured.fix) attributes['error.fix'] = structured.fix;
  });
  read(() => {
    if (structured.link) attributes['error.link'] = structured.link;
  });
  read(() => {
    if (structured.code !== undefined) {
      attributes['error.code'] = String(structured.code);
    }
  });
  read(() => {
    if (structured.status !== undefined) {
      attributes['error.status'] = structured.status;
    }
  });
  read(() => {
    if (structured.details) {
      Object.assign(
        attributes,
        flattenToAttributes(structured.details, 'error.details'),
      );
    }
  });

  return attributes;
}

/** An exception event's fields, as OpenTelemetry's recordException() reads them. */
export interface ExceptionFields {
  name: string;
  code?: string;
  message?: string;
  stack?: string;
}

/**
 * The exception event for an error, its fields read one at a time. Passing the
 * error itself would let the SDK read each getter again.
 */
export function exceptionOf(error: Error, type: string): ExceptionFields {
  return {
    name: type,
    // The SDK uses a truthy code as the event's exception.type, else the name.
    code: readString(() => {
      const code = readProperty(error, 'code');
      return code ? String(code) : undefined;
    }),
    message: readString(() => error.message),
    stack: readString(() => error.stack),
  };
}

export function recordStructuredError(
  ctx: Pick<TraceContext, 'setAttributes' | 'setStatus'>,
  error: Error,
): void {
  // Status and attributes first, so the failure is recorded before the event.
  const attributes = getStructuredErrorAttributes(error);
  ctx.setStatus({
    code: SpanStatusCode.ERROR,
    message: asString(attributes['error.message']),
  });
  ctx.setAttributes(attributes);
  // SAFETY: the parameter is the narrow slice of TraceContext this function
  // needs; a full context also records exceptions, and one that does not
  // simply leaves this undefined.
  const maybeRecordException = (
    ctx as Partial<TraceContext> & {
      recordException?: (e: ExceptionFields) => void;
    }
  ).recordException;
  if (isFunction(maybeRecordException)) {
    maybeRecordException(exceptionOf(error, String(attributes['error.type'])));
  }
}
