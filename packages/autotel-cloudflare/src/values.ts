/**
 * Reading values that arrive from outside: a Worker's env, a binding's
 * response, an error someone threw. Nothing about them is known until one of
 * these asks, and each answers with the type it looked for or `undefined`.
 *
 * This is the boundary. The `typeof` checks and the `unknown` parameters below
 * are what a boundary is made of; past it, the package works with types.
 *
 * Internal - not exported from the package entry points. Deliberately local
 * rather than shared with `autotel`: this package targets the edge and pulls
 * in no Node-side dependency.
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

/** The number the value carries, or undefined when it carries anything else. */
/** A string with something in it - a blank one counts as absent. */
export function nonEmptyString(value: unknown): string | undefined {
  const text = asString(value);
  return text !== undefined && text.trim() !== '' ? text : undefined;
}

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

/** Whether an object carries a callable under this name. */
export function hasMethod(source: unknown, name: string): boolean {
  return isFunction(readProperty(source, name));
}

/** Whether an object carries a callable under every one of these names. */
export function hasMethods(source: unknown, names: string[]): boolean {
  return names.every((name) => hasMethod(source, name));
}

/**
 * Call the function a proxy trap is wrapping, with the arguments the caller
 * actually passed.
 *
 * SAFETY: an apply trap receives the argument list of the very call it is
 * intercepting, so those arguments are the wrapped function's own parameter
 * tuple and its result is that function's return. TypeScript types a trap's
 * `argArray` as `any[]` and cannot carry either fact, so it is stated here
 * once rather than at every trap in the package.
 */
export function applyTrap<TFn extends (...args: never[]) => unknown>(
  fn: TFn,
  thisArg: unknown,
  args: unknown[],
): ReturnType<TFn> {
  return fn.apply(thisArg, args as Parameters<TFn>) as ReturnType<TFn>;
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
 * The arguments a proxy trap intercepted, read as the wrapped call's own
 * parameters.
 *
 * SAFETY: as with applyTrap - an apply trap receives the argument list of the
 * very call it is intercepting, which is that function's parameter tuple.
 * TypeScript types a trap's `argArray` as `any[]` and cannot carry that.
 */
export function trapArgs<TArgs extends unknown[]>(args: unknown[]): TArgs {
  return args as TArgs;
}

/** A field of a value's field - `readProperty(readProperty(v, a), b)`, said once. */
export function readPath(source: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((value, key) => readProperty(value, key), source);
}

/** The number at this path, when the value carries one there. */
export function numberAt(
  source: unknown,
  ...keys: string[]
): number | undefined {
  const value = readPath(source, ...keys);
  return asNumber(value) ?? asNumber(Number(asString(value)));
}

/** The scalar the value carries - string, number or boolean - or undefined. */
export function asScalar(
  value: unknown,
): string | number | boolean | undefined {
  return asString(value) ?? asNumber(value) ?? asBoolean(value);
}

/** A homogeneous list of scalars, or undefined when the value is not one. */
export function asScalarArray(
  value: unknown,
): string[] | number[] | boolean[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.every((v) => asString(v) !== undefined)) return value.map(String);
  if (value.every((v) => asNumber(v) !== undefined)) return value.map(Number);
  if (value.every((v) => asBoolean(v) !== undefined)) return value.map(Boolean);
  return undefined;
}

/**
 * What a value is, for a diagnostic attribute: the same words `typeof` uses,
 * plus `null` and `array`, which are the two cases `typeof` answers uselessly.
 */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}
