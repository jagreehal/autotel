/**
 * Reading values that arrive from outside autotel: a caller's config, a
 * message off a broker, an error someone threw, a payload another library
 * handed over. Nothing about them is known until one of these asks, and each
 * answers with the type it looked for or `undefined`.
 *
 * This is the boundary. The `typeof` checks and the `unknown` parameters below
 * are what a boundary is made of; past it, the rest of the package works with
 * types rather than with representations.
 *
 * Internal - not exported from the package entry points.
 */

import type { AttributeValue } from '@opentelemetry/api';

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

/**
 * The value as a map of strings - a header bag, say - or undefined when it is
 * not an object at all. Entries whose value is not a string are left out.
 */
export function asStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const strings: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const text = asString(entry);
    if (text !== undefined) strings[key] = text;
  }
  return strings;
}

/** The scalar the value carries - string, number or boolean - or undefined. */
export function asScalar(
  value: unknown,
): string | number | boolean | undefined {
  return asString(value) ?? asNumber(value) ?? asBoolean(value);
}

/** The numbers the value carries as a list, or undefined when it is not one. */
export function asNumberArray(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every((v) => asNumber(v) !== undefined)
    ? value.map(Number)
    : undefined;
}

/** The booleans the value carries as a list, or undefined when it is not one. */
export function asBooleanArray(value: unknown): boolean[] | undefined {
  return Array.isArray(value) && value.every((v) => asBoolean(v) !== undefined)
    ? value.map(Boolean)
    : undefined;
}

/** The strings the value carries as a list, or undefined when it is not one. */
export function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => asString(v) !== undefined)
    ? value.map(String)
    : undefined;
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

/**
 * A config field that may be given as a value or as a function producing one,
 * resolved to the value.
 */
export function resolveValue<TValue>(
  source: TValue | (() => TValue | undefined) | undefined,
): TValue | undefined {
  // SAFETY: a function is the only callable arm of the union, so this is the
  // getter form. A caller passing some other function gets whatever it
  // returns, which is what asking for a getter means.
  return typeof source === 'function'
    ? (source as () => TValue | undefined)()
    : source;
}

/**
 * An overloaded first argument that is either a name or an options object,
 * split into the two.
 */
export function splitNameOrOptions<TOptions>(
  value: string | TOptions | undefined,
): { name?: string; options?: TOptions } {
  return typeof value === 'string' ? { name: value } : { options: value };
}

/** A function whose parameters are not known here - a wrapped method, say. */
export type UnknownFunction = (...args: unknown[]) => unknown;

/** The value as a callable, or undefined when it is not one. */
export function asFunction(value: unknown): UnknownFunction | undefined {
  if (typeof value !== 'function') return undefined;
  // SAFETY: a callable value is invoked with whatever its own caller passed.
  // Nothing here claims to know its parameter or return types, which is what
  // UnknownFunction says.
  return value as UnknownFunction;
}

/**
 * The value as a plain object - one built from a literal, not an instance of
 * some class that has its own idea of what it is.
 */
export function asPlainRecordOrMap(value: unknown): UnknownRecord | undefined {
  if (value instanceof Map) {
    const entries: UnknownRecord = {};
    for (const [key, entry] of value) entries[String(key)] = entry;
    return entries;
  }
  return asPlainRecord(value);
}

export function asPlainRecord(value: unknown): UnknownRecord | undefined {
  const record = asRecord(value);
  return record !== undefined &&
    Object.getPrototypeOf(record) === Object.prototype
    ? record
    : undefined;
}

/**
 * Set a field on a value whose shape is not known here - a propagation
 * carrier, say, or an object being given a member named at runtime. A value
 * that is not an object is left alone: there is nowhere to put the field.
 */
export function writeProperty(
  target: unknown,
  key: string,
  value: unknown,
): void {
  const record = asRecord(target);
  if (record !== undefined) record[key] = value;
}

/** One field of a value, when the value is an object at all. */
export function readProperty(source: unknown, key: string): unknown {
  return asRecord(source)?.[key];
}

/**
 * What a value is, for a diagnostic message: the same words `typeof` uses,
 * plus `null` and `array`, which are the two cases `typeof` answers uselessly.
 */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

/** A field of a field: `readPath(v, 'a', 'b')` reads `v.a.b`. */
export function readPath(source: unknown, ...keys: string[]): unknown {
  let value = source;
  for (const key of keys) value = readProperty(value, key);
  return value;
}

/**
 * The Error a caller's callback expects, wrapping whatever was actually
 * thrown - a string, a number, an object with no stack.
 */
export function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Fields an HTTP client hangs on its errors (axios, got, fetch wrappers):
 * the request and response, with their headers - Authorization, cookies, API
 * keys. Never copied, whatever they hold.
 */
const REQUEST_ERROR_KEYS = new Set([
  'config',
  'request',
  'response',
  'headers',
  'options',
]);

/**
 * An Error as a record: name, message, stack, its cause (recursively), and the
 * scalar fields the thrower attached (`code`, `status`, `errno`...). JSON
 * writes an Error as `{}`, and its message alone drops the rest.
 *
 * Only scalar fields are copied: an object on an error is usually the request
 * or response that failed, with its credentials, and redaction may be off.
 * `seen` breaks cycles: an error already being written becomes
 * `<circular-reference>`.
 */
export function errorToRecord(
  error: Error,
  seen: WeakSet<object> = new WeakSet(),
): UnknownRecord {
  seen.add(error);
  const record: UnknownRecord = { name: error.name, message: error.message };
  if (error.stack) record.stack = error.stack;
  // SAFETY: an Error is an object; its own enumerable keys are the fields
  // the thrower attached, read one at a time.
  const fields = error as unknown as UnknownRecord;
  for (const key of Object.keys(error)) {
    if (REQUEST_ERROR_KEYS.has(key.toLowerCase())) continue;
    const value = fields[key];
    const scalar = asString(value) ?? asNumber(value) ?? asBoolean(value);
    if (scalar !== undefined) record[key] = scalar;
  }
  // `cause` from the constructor option is own but not enumerable.
  const cause = error.cause;
  if (cause instanceof Error) {
    record.cause = seen.has(cause)
      ? '<circular-reference>'
      : errorToRecord(cause, seen);
  } else {
    const scalar = asString(cause) ?? asNumber(cause) ?? asBoolean(cause);
    if (scalar !== undefined) record.cause = scalar;
  }
  return record;
}

/** JSON.stringify, with any Error inside written as its {@link errorToRecord}. */
export function stringifyWithErrors(value: unknown): string | undefined {
  const seen = new WeakSet<object>();
  // The holder is an object or an array; `Reflect.get` reads either.
  const raw = (holder: unknown, key: string, v: unknown): unknown =>
    typeof holder === 'object' && holder !== null
      ? Reflect.get(holder, key)
      : v;
  return JSON.stringify(value, function (key, v: unknown) {
    // The raw value, not `v`: JSON has already called `toJSON`, and an HTTP
    // client error's toJSON (axios) hands back its config, headers and all.
    const original = raw(this, key, v);
    if (!(original instanceof Error)) return v;
    return seen.has(original)
      ? '<circular-reference>'
      : errorToRecord(original, seen);
  });
}

/**
 * A value as an OTel attribute, or undefined when it cannot be one.
 *
 * OTel accepts scalars and homogeneous arrays of scalars. Anything else - a
 * nested object, a mixed array - is stringified rather than dropped, because
 * a caller that attached it wanted to see it.
 */
export function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (value === undefined || value === null) return undefined;
  const scalar = asString(value) ?? asNumber(value) ?? asBoolean(value);
  if (scalar !== undefined) return scalar;
  if (Array.isArray(value)) return toAttributeArray(value);
  if (value instanceof Set) return toAttributeArray([...value]);
  if (value instanceof Map) {
    return stringifyWithErrors(Object.fromEntries(value));
  }
  return stringifyWithErrors(value);
}

/** The scalars in an array, dropping the entries OTel cannot carry. */
function toAttributeArray(values: unknown[]): AttributeValue | undefined {
  const strings = values.filter((v) => typeof v === 'string');
  if (strings.length === values.length) return strings;
  const numbers = values.filter((v) => typeof v === 'number');
  if (numbers.length === values.length) return numbers;
  const booleans = values.filter((v) => typeof v === 'boolean');
  if (booleans.length === values.length) return booleans;
  return values.length > 0 ? stringifyWithErrors(values) : undefined;
}

/** Whether a Node-style `process` global exists at all - edge runtimes have none. */
export function hasProcess(): boolean {
  return typeof process !== 'undefined';
}

/**
 * Whether this build is running outside production, for warnings meant to
 * help during development. `process` is probed because the same code runs in
 * edge runtimes that have no such global.
 */
export function isDevelopment(): boolean {
  return hasProcess() && process.env.NODE_ENV !== 'production';
}
