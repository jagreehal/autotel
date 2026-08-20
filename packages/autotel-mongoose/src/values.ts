/**
 * Reading values that arrive from outside: a Mongoose query or document,
 * a driver result, an error someone threw. Nothing about them is known
 * until one of these asks, and each answers with the type it looked for or
 * `undefined`.
 *
 * This is the boundary. The `typeof` checks and the `unknown` parameters below
 * are what a boundary is made of; past it, the package works with types.
 *
 * Internal - not exported from the package entry points.
 */

/** An object whose fields have not been read yet. */
export interface UnknownRecord {
  [key: string]: unknown;
}

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

/** Whether the value is callable. */
export function isFunction(
  value: unknown,
): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

/** A function whose parameters are not known here - a wrapped method, say. */
export type UnknownFunction = (...args: unknown[]) => unknown;

/** The value as a callable, or undefined when it is not one. */
export function asFunction(value: unknown): UnknownFunction | undefined {
  if (typeof value !== 'function') return undefined;
  // SAFETY: a callable value is invoked with whatever its own caller passed.
  // Nothing here claims to know its parameter or return types.
  return value as UnknownFunction;
}

/** One field of a value, when the value is an object at all. */
export function readProperty(source: unknown, key: string): unknown {
  return asRecord(source)?.[key];
}

/**
 * The Error a caller's callback expects, wrapping whatever was actually
 * thrown - a string, a number, an object with no stack.
 */
export function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Call a function with a receiver and the arguments its caller passed.
 *
 * SAFETY: the wrapper forwards a call it intercepted, so these are that
 * function's own arguments; nothing here claims to know their types.
 */
export function callFunction(
  fn: (...args: never[]) => unknown,
  thisArg: unknown,
  args: unknown[],
): unknown {
  return (fn as UnknownFunction).apply(thisArg, args);
}
