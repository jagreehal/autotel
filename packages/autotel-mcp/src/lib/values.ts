/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type -- This module is the parse-at-the-boundary layer those rules ask every other module to route through. An `unknown` parameter and a `typeof` check are what a decoder is made of; pushing them behind another decoder only moves the boundary one file further down. Every other module in this package now calls these instead of re-deriving them. */

/**
 * Reading values that arrive from outside: a backend's JSON response, a
 * config file, an error someone threw. Nothing about them is known until one
 * of these asks, and each answers with the type it looked for or `undefined`.
 *
 * This is the boundary. The `typeof` checks and the `unknown` parameters below
 * are what a boundary is made of; past it, the server works with types.
 *
 * Internal - not exported from the package entry points.
 */

import type { TagValue } from '../types';

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

/**
 * The number the value carries. A numeric string counts: a backend's JSON
 * routinely sends counts, timestamps and durations as strings.
 */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** The boolean the value carries, or undefined when it carries anything else. */
export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** One field of a value, when the value is an object at all. */
export function readProperty(source: unknown, key: string): unknown {
  return asRecord(source)?.[key];
}

/** A field of a field: `readPath(v, 'a', 'b')` reads `v.a.b`. */
export function readPath(source: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((value, key) => readProperty(value, key), source);
}

/** The number at this path, when the value carries one there. */
export function numberAt(
  source: unknown,
  ...keys: string[]
): number | undefined {
  return asNumber(readPath(source, ...keys));
}

/** The value as a flat tag, or undefined when it is a shape a tag cannot hold. */
export function asTagValue(value: unknown): TagValue | undefined {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  return undefined;
}

/** Any flat tag rendered as text - a number or boolean prints, a shape does not. */
export function tagText(value: unknown): string | undefined {
  const tag = asTagValue(value);
  return tag === undefined ? undefined : String(tag);
}

/** Which flat tag this is, or undefined when it is a shape a tag cannot hold. */
export function tagKind(
  value: unknown,
): 'string' | 'number' | 'boolean' | undefined {
  const tag = asTagValue(value);
  if (tag === undefined) return undefined;
  if (typeof tag === 'string') return 'string';
  return typeof tag === 'number' ? 'number' : 'boolean';
}
