import type { AttributeValue } from './trace-context';

/**
 * Convert an unknown value to an OTel-compatible AttributeValue.
 * Returns undefined when the value cannot be represented.
 */
export function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (
      value.every((v) => typeof v === 'string') ||
      value.every((v) => typeof v === 'number') ||
      value.every((v) => typeof v === 'boolean')
    ) {
      return value as AttributeValue;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '<serialization-failed>';
    }
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return value.message;
  }
  return undefined;
}

/**
 * Recursively flatten a nested object into dot-notation OTel attributes.
 * Includes circular reference protection via WeakSet.
 */
export function flattenToAttributes(
  fields: Record<string, unknown>,
  prefix = '',
): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  const seen = new WeakSet<object>();

  function flatten(obj: Record<string, unknown>, currentPrefix: string): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value == null) continue;
      const nextKey = currentPrefix ? `${currentPrefix}.${key}` : key;

      const attr = toAttributeValue(value);
      if (attr !== undefined) {
        out[nextKey] = attr;
        continue;
      }

      if (typeof value === 'object' && value.constructor === Object) {
        if (seen.has(value)) {
          out[nextKey] = '<circular-reference>';
          continue;
        }
        seen.add(value);
        flatten(value as Record<string, unknown>, nextKey);
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
