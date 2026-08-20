/**
 * Reading values that arrive from outside: an MCP request's `_meta`, a
 * tool's arguments, an error someone threw. Nothing about them is known until one of
 * these asks, and each answers with the type it looked for or `undefined`.
 *
 * This is the boundary. The `typeof` checks and the `unknown` parameters below
 * are what a boundary is made of; past it, the package works with types.
 *
 * Internal - not exported from the package entry points. Deliberately local:
 * this package runs on Node and the edge alike and depends on neither
 * runtime's package.
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
 * Read a member off a proxy target, by whatever key the trap was asked for.
 *
 * SAFETY: a get trap forwards every key, including ones the target's declared
 * type does not name. The value is returned as unread, so nothing here claims
 * to know what it is.
 */
export function member(target: object, key: string | symbol): unknown {
  return (target as Record<string | symbol, unknown>)[key];
}

/**
 * Call a method the wrapper found on its target, with the arguments the
 * caller passed.
 *
 * SAFETY: the value was just established to be callable, and a proxy forwards
 * the call it intercepted - so these are that method's own arguments and its
 * own result. Nothing here claims to know either type.
 */
export function callMethod(
  method: unknown,
  target: object,
  args: unknown[],
): unknown {
  const callable = asFunction(method);
  if (!callable) {
    throw new TypeError('callMethod: the value is not callable');
  }
  return callable.apply(target, args);
}

/**
 * Call a method on a value when it has one under that name, and answer with
 * whatever it returned.
 *
 * The MCP SDKs differ by era in which capability methods exist, so a client
 * or server is asked rather than assumed.
 */
export function callIfPresent(source: unknown, name: string): unknown {
  const method = asFunction(readProperty(source, name));
  return method ? method.call(source) : undefined;
}
