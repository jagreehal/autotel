import { createHash } from 'node:crypto';

export interface HashPayloadOptions {
  algorithm?: 'sha256';
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString(10);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (value && typeof value === 'object') {
    // `toSorted()` would need ES2023 lib types; keep runtime output ES2022-friendly.
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }

  return value;
}

export function canonicalizeForHash(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashPayload(
  value: unknown,
  options: HashPayloadOptions = {},
): string {
  const algorithm = options.algorithm ?? 'sha256';
  const canonical = canonicalizeForHash(value);
  const digest = createHash(algorithm).update(canonical).digest('hex');
  return `${algorithm}:${digest}`;
}
