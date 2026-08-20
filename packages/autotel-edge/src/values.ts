import type { AttributeValue } from '@opentelemetry/api';

/**
 * Reading values that arrive from outside: a caller's config, a
 * request's headers, an error someone threw. Nothing about them is known until one of
 * these asks, and each answers with the type it looked for or `undefined`.
 *
 * This is the boundary. The `typeof` checks and the `unknown` parameters below
 * are what a boundary is made of; past it, the package works with types.
 *
 * Internal - not exported from the package entry points. Deliberately local
 * rather than shared with `autotel`: this package is the edge foundation and
 * pulls in no Node-side dependency.
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

/** A string with something in it - a blank one counts as absent. */
export function nonEmptyString(value: unknown): string | undefined {
  const text = asString(value);
  return text !== undefined && text.trim() !== '' ? text : undefined;
}

/** The number the value carries, or undefined when it carries anything else. */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** The boolean the value carries, or undefined when it carries anything else. */
export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Whether the value is callable. */
export function isFunction(
  value: unknown,
): value is (...args: never[]) => unknown {
  return typeof value === 'function';
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
 * The Error a caller's callback expects, wrapping whatever was actually
 * thrown - a string, a number, an object with no stack.
 */
export function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * A value as an OTel attribute, or undefined when it cannot be one.
 *
 * OTel accepts scalars and homogeneous arrays of scalars. Anything else - a
 * nested object, a mixed array - is stringified rather than dropped, because
 * a caller that attached it wanted to see it.
 *
 * A non-finite number is the exception: OTLP has no encoding for NaN or
 * Infinity, and `JSON.stringify` renders both as the string `"null"`. Emitting
 * that would claim the attribute holds null, so the key is dropped instead.
 */
export function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (value === undefined || value === null) return undefined;
  const scalar = asString(value) ?? asNumber(value) ?? asBoolean(value);
  if (scalar !== undefined) return scalar;
  if (typeof value === 'number') return undefined;
  if (Array.isArray(value)) return toAttributeArray(value);
  return JSON.stringify(value);
}

/** The scalars in an array, or the whole thing as text when they are mixed. */
function toAttributeArray(values: unknown[]): AttributeValue | undefined {
  const strings = values.filter((v) => typeof v === 'string');
  if (strings.length === values.length) return strings;
  // asNumber, not `typeof`, so one NaN stops the array being sent as numbers
  // OTLP cannot encode - it falls through to text below.
  const numbers = values.map((v) => asNumber(v)).filter((n) => n !== undefined);
  if (numbers.length === values.length) return numbers;
  const booleans = values.filter((v) => typeof v === 'boolean');
  if (booleans.length === values.length) return booleans;
  return values.length > 0 ? JSON.stringify(values) : undefined;
}
