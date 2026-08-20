import type { AttributeValue } from './trace-context';
import {
  asBoolean,
  asNumber,
  asPlainRecord,
  asString,
  type UnknownRecord,
} from './values';

/**
 * Convert a value that arrived from outside to an OTel-compatible
 * AttributeValue. Returns undefined when the value cannot be represented -
 * which is how flattenToAttributes below learns it has an object to descend
 * into rather than a leaf to record.
 */
export function toAttributeValue(value: unknown): AttributeValue | undefined {
  const scalar = asString(value) ?? asNumber(value) ?? asBoolean(value);
  if (scalar !== undefined) return scalar;
  if (Array.isArray(value)) return toAttributeArray(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return value.message;
  return undefined;
}

/** A homogeneous array as itself; anything else as the JSON it serialises to. */
function toAttributeArray(values: unknown[]): AttributeValue {
  const strings = values.filter((v) => asString(v) !== undefined);
  if (strings.length === values.length) return strings.map(String);
  const numbers = values.filter((v) => asNumber(v) !== undefined);
  if (numbers.length === values.length) return numbers.map(Number);
  const booleans = values.filter((v) => asBoolean(v) !== undefined);
  if (booleans.length === values.length) return booleans.map(Boolean);
  try {
    return JSON.stringify(values);
  } catch {
    return '<serialization-failed>';
  }
}

/** A flat, dot-notation attribute bag: what a nested object flattens to. */
export interface FlatAttributes {
  [key: string]: AttributeValue;
}

/**
 * Recursively flatten a nested object into dot-notation OTel attributes.
 * Includes circular reference protection via WeakSet.
 */
export function flattenToAttributes(
  fields: UnknownRecord,
  prefix = '',
): FlatAttributes {
  const out: FlatAttributes = {};
  const seen = new WeakSet<object>();

  function flatten(obj: UnknownRecord, currentPrefix: string): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value == null) continue;
      const nextKey = currentPrefix ? `${currentPrefix}.${key}` : key;

      const attr = toAttributeValue(value);
      if (attr !== undefined) {
        out[nextKey] = attr;
        continue;
      }

      const nested = asPlainRecord(value);
      if (nested !== undefined) {
        if (seen.has(nested)) {
          out[nextKey] = '<circular-reference>';
          continue;
        }
        seen.add(nested);
        flatten(nested, nextKey);
        continue;
      }

      try {
        out[nextKey] = JSON.stringify(value);
      } catch {
        out[nextKey] = '<serialization-failed>';
      }
    }
  }

  flatten(fields, prefix);
  return out;
}
