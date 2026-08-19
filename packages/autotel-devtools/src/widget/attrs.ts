/**
 * Reading attributes off a span the devtools received.
 *
 * A span arrives over OTLP, so an attribute holds whatever the sender put
 * there - including the nested maps and lists OTLP's kvlist and array values
 * decode to. Every screen that reads one wants the string it should display,
 * and asking for it in one place keeps that decision out of the call sites.
 */
import type { SpanAttributes } from './types.js';

/** The string an attribute carries, or undefined when it carried something else. */
export function stringAttr(
  attributes: SpanAttributes | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attributes?.[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** The number an attribute carries, or undefined when it carried something else. */
export function numberAttr(
  attributes: SpanAttributes | undefined,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = attributes?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

// The coercions below take a value rather than an attribute bag: the same
// wire value turns up as a span attribute, an event attribute, or a field of
// a JSON payload an instrumentation stringified, and every reader wants the
// same answer. This is the boundary where a wire value becomes a typed one.

/** The string a wire value carries, or undefined when it carried something else. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * The number a wire value carries. A numeric string counts: instrumentations
 * routinely send counts and durations as strings.
 */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** The boolean a wire value carries, including the strings 'true' and 'false'. */
export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** The strings a wire value carries - a list of them, or a lone one. */
export function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const strings = value.filter((item) => typeof item === 'string');
    return strings.length === value.length ? strings : undefined;
  }
  return typeof value === 'string' ? [value] : undefined;
}
