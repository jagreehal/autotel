/**
 * Readers for JSON that arrived from outside the devtools - an imported file,
 * a pasted snapshot. Nothing about it is known until a reader is asked, and
 * every reader answers with the type it looked for or `undefined`, so callers
 * validate by asking rather than by narrowing with `typeof` at each use.
 *
 * This is the one file where the shape is genuinely unknown; the `unknown`
 * parameter and the `typeof` checks below are the parse boundary itself.
 */

/** An object decoded from JSON, before any field has been read. */
export interface JsonObject {
  [key: string]: unknown;
}

/** The value as an object, or `undefined` when it is anything else. */
export function asObject(value: unknown): JsonObject | undefined {
  // SAFETY: an object decoded from JSON is exactly a bag of unread fields,
  // which is what JsonObject says. Arrays are excluded above.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

/** The field as a string, or `undefined` when it is missing or another type. */
export function stringField(
  source: JsonObject,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

/** The field as a number, or `undefined` when it is missing or another type. */
export function numberField(
  source: JsonObject,
  key: string,
): number | undefined {
  const value = source[key];
  return typeof value === 'number' ? value : undefined;
}

/** The field as an object, or `undefined` when it is missing or another type. */
export function objectField(
  source: JsonObject,
  key: string,
): JsonObject | undefined {
  return asObject(source[key]);
}

/** The field as an array, or an empty one when it is missing or another type. */
export function arrayField(source: JsonObject, key: string): unknown[] {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

/** Whether the field is an array at all - an empty one is still present. */
export function hasArrayField(source: JsonObject, key: string): boolean {
  return Array.isArray(source[key]);
}

/** A reader, so a validator can ask for a list of fields in one go. */
export type FieldReader = (
  source: JsonObject,
  key: string,
) => string | number | JsonObject | undefined;

/** One message per named field the reader could not find. */
export function missingFields(
  source: JsonObject,
  path: string,
  read: FieldReader,
  keys: readonly string[],
): string[] {
  return keys
    .filter((key) => read(source, key) === undefined)
    .map((key) => `${path}: Missing or invalid ${key}`);
}
