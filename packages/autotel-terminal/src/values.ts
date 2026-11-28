/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- This module is the parse-at-the-boundary layer for OTLP payloads, config and thrown values; an `unknown` parameter and a `typeof` check are what a decoder is made of, and every other module routes through these instead. */
/**
 * Reading values that arrive from outside: an OTLP payload posted to the
 * receiver, a config file, an error someone threw. Nothing about them is known
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

/**
 * `text` with control characters written as escapes (`\r`, `\n`, `\u001b`),
 * the way JSON shows them. A span name or log body is whatever a client sent,
 * and a raw `\r\u001b[2K` would erase the line it is drawn on.
 */
export function escapeControl(text: string): string {
  // oxlint-disable-next-line no-control-regex -- matching control characters is the point
  return text.replaceAll(/[\u0000-\u001F\u007F-\u009F]/g, (char) => {
    const json = JSON.stringify(char).slice(1, -1);
    return json.length > 1
      ? json
      : `\\u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`;
  });
}

/**
 * An attribute key with its backslashes doubled before controls are escaped,
 * as JSON writes them, so two keys never become one: a real newline reads
 * `\n` and a literal backslash-n reads `\\n`.
 */
function escapeKey(key: string): string {
  return escapeControl(key.replaceAll('\\', String.raw`\\`));
}

/** `value` with every string in it run through `escapeControl`, and object keys through `escapeKey`. */
export function escapeControlDeep<T>(value: T): T {
  const text = asString(value);
  if (text !== undefined) {
    // SAFETY: `value` is the string `text` read, and escaping returns a string.
    return escapeControl(text) as T;
  }
  if (Array.isArray(value)) {
    // SAFETY: an array maps to an array of the same length and element kinds.
    return value.map((item) => escapeControlDeep(item)) as T;
  }
  const record = asRecord(value);
  if (!record) return value;
  // fromEntries defines each key as an own property; assigning would send a
  // literal `__proto__` attribute to the prototype and lose it.
  const out = Object.fromEntries(
    Object.entries(record).map(([key, field]) => [
      escapeKey(key),
      escapeControlDeep(field),
    ]),
  );
  // SAFETY: `out` has the fields of `value`, each rebuilt in its own shape.
  return out as T;
}
