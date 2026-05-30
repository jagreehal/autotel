/**
 * Reliable JSON detection for attribute values.
 *
 * Returns the parsed value only when it is a JSON object or array — either
 * because the value is already structured, or because it is a string that
 * parses into one. Scalars ("stop", 42, true), plain text, and truncated /
 * invalid JSON all return null, so callers fall back to the raw string view.
 */
export function tryParseJsonContainer(value: unknown): unknown | null {
  if (value !== null && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 2) return null;
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
