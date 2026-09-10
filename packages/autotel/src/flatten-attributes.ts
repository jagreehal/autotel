import type { AttributeValue } from './trace-context';
import {
  asBoolean,
  asNumber,
  asPlainRecordOrMap,
  asString,
  type UnknownRecord,
} from './values';

/** What a value that cannot be represented is recorded as. */
const INVALID_DATE = '<invalid-date>';
const INVALID_NUMBER = '<invalid-number>';
const SERIALIZATION_FAILED = '<serialization-failed>';
const CIRCULAR_REFERENCE = '<circular-reference>';

/**
 * Convert a value that arrived from outside to an OTel-compatible
 * AttributeValue. Returns undefined when the value cannot be represented -
 * which is how flattenToAttributes below learns it has an object to descend
 * into rather than a leaf to record.
 *
 * Total by construction: this runs on whatever an application hands an
 * attribute setter, so a value that cannot be read is a marker in the
 * telemetry, never an exception on the request path.
 */
export function toAttributeValue(value: unknown): AttributeValue | undefined {
  const scalar = asString(value) ?? asNumber(value) ?? asBoolean(value);
  if (scalar !== undefined) return scalar;
  // NaN and the infinities say a measurement failed, and no numeric encoding
  // carries that: OTLP/JSON writes `null`, which a collector reads back as a
  // confident 0. Name the failure instead, the way an invalid date is named.
  if (typeof value === 'number') return INVALID_NUMBER;
  try {
    if (Array.isArray(value)) return toAttributeArray(value);
    if (value instanceof Set) return toAttributeArray([...value]);
    // `toISOString` throws RangeError on an invalid date - `new Date('x')`, or
    // a date parsed from a malformed field - so ask before converting.
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? INVALID_DATE : value.toISOString();
    }
    if (value instanceof Error) return value.message;
  } catch {
    return SERIALIZATION_FAILED;
  }
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
    return SERIALIZATION_FAILED;
  }
}

/** A flat, dot-notation attribute bag: what a nested object flattens to. */
export interface FlatAttributes {
  [key: string]: AttributeValue;
}

/**
 * Recursively flatten a nested object into dot-notation OTel attributes.
 * Includes circular reference protection via WeakSet.
 *
 * Every key is converted inside its own guard, so one value that cannot be read
 * - a getter that throws, an exotic proxy, a `Map` whose key has no string form
 * - costs that key alone and never the call. Keys are listed before their
 * values are read, so a sibling of the bad value still lands.
 */
export function flattenToAttributes(
  fields: UnknownRecord,
  prefix = '',
): FlatAttributes {
  const out: FlatAttributes = {};
  const seen = new WeakSet<object>();

  function flatten(obj: UnknownRecord, currentPrefix: string): void {
    // Object.keys, not entries: a getter must run inside the guard below.
    for (const key of Object.keys(obj)) {
      const nextKey = currentPrefix ? `${currentPrefix}.${key}` : key;
      try {
        const value = obj[key];
        if (value == null) continue;

        const attr = toAttributeValue(value);
        if (attr !== undefined) {
          out[nextKey] = attr;
          continue;
        }

        const nested = asPlainRecordOrMap(value);
        if (nested !== undefined) {
          // Keyed on the value itself, not on `nested`: a Map flattens to a
          // fresh object each time, which a WeakSet would never recognise.
          if (seen.has(value as object)) {
            out[nextKey] = CIRCULAR_REFERENCE;
            continue;
          }
          seen.add(value as object);
          flatten(nested, nextKey);
          continue;
        }

        // undefined from JSON.stringify means there is nothing to record - a
        // function or a symbol - rather than a failure to record it.
        const json = JSON.stringify(value);
        if (json !== undefined) out[nextKey] = json;
      } catch {
        out[nextKey] = SERIALIZATION_FAILED;
      }
    }
  }

  try {
    flatten(fields, prefix);
  } catch {
    // The bag itself refused to be listed; whatever was read already stands.
  }
  return out;
}
