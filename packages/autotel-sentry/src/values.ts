/**
 * Reading values that arrive from outside: the page's Sentry SDK, a Sentry
 * event's contexts, an error someone threw. Nothing about them is known
 * until one of these asks, and each answers with the type it looked for or
 * `undefined`.
 *
 * This is the boundary. The `typeof` checks and the `unknown` parameters below
 * are what a boundary is made of; past it, the package works with types.
 *
 * Internal - not exported from the package entry points.
 */

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
