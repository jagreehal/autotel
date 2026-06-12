import { createHash } from 'node:crypto';

/**
 * Deterministic JSON stringify with sorted object keys, so two structurally
 * equal values always produce the same string regardless of key insertion
 * order. Shared by `defineEvent` and the validation layer for stable schema
 * hashes.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .toSorted()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
    .join(',');
  return '{' + body + '}';
}

/** Stable sha256 of any JSON-serializable value. */
export function hashJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
