/**
 * Reading values that arrive from outside: a command argument VS Code
 * passed, a package.json, an error someone threw. Nothing about them is known
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

/** Whether the value is callable. */
export function isFunction(
  value: unknown,
): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

/** One field of a value, when the value is an object at all. */
export function readProperty(source: unknown, key: string): unknown {
  return asRecord(source)?.[key];
}
