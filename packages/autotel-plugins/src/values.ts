/**
 * Reading values that arrive from outside: a broker message, a client
 * library's result, an error someone threw. Nothing about them is known until one of
 * these asks, and each answers with the type it looked for or `undefined`.
 *
 * This is the boundary. The `typeof` checks and the `unknown` parameters below
 * are what a boundary is made of; past it, the package works with types.
 *
 * Internal - not exported from the package entry points. Deliberately local:
 * each plugin here is tree-shaken on its own and pulls in nothing shared.
 */

/** An object whose fields have not been read yet. */
export interface UnknownRecord {
  [key: string]: unknown;
}

/** A function whose parameters are not known here - a wrapped method, say. */
export type UnknownFunction = (...args: unknown[]) => unknown;

/** The value as an object, or undefined when it is anything else. */
export function asRecord(value: unknown): UnknownRecord | undefined {
  // SAFETY: an object nothing has read yet is exactly a bag of unread fields,
  // which is what UnknownRecord says. Arrays are excluded - callers that want
  // a list ask for one.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

/** The string the value carries, or undefined when it carries anything else. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The value as a callable, or undefined when it is not one. */
export function asFunction(value: unknown): UnknownFunction | undefined {
  if (typeof value !== 'function') return undefined;
  // SAFETY: a callable value is invoked with whatever its own caller passed.
  // Nothing here claims to know its parameter or return types, which is what
  // UnknownFunction says.
  return value as UnknownFunction;
}

/** One field of a value, when the value is an object at all. */
export function readProperty(source: unknown, key: string): unknown {
  return asRecord(source)?.[key];
}

/**
 * The value a client-library call resolved to, as the shape that library's
 * own API documents.
 *
 * SAFETY: these wrappers patch a published client (BigQuery, Kafka, RabbitMQ)
 * and forward its call untouched; the result is whatever that method returns,
 * which its type declares at the call site. The wrapper only reads the parts
 * it records, and records nothing when they are absent.
 */
export function clientResult<TResult>(value: unknown): Promise<TResult> {
  return Promise.resolve(value as TResult);
}
