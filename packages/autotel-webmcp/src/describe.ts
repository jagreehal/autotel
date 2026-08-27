/**
 * Facts about what an agent actually receives from a WebMCP tool.
 *
 * Chrome serialises a handler's return value and hands the agent a string.
 * These helpers record what that string will be, so a span carries the truth
 * rather than the developer's intent. Behaviour verified against Chrome 151.
 */

export interface ResultDescription {
  /** The handler's own return type, before serialisation. */
  type: string;
  /** What the agent receives. */
  serialized: string;
  /** UTF-8 bytes the agent pays for. */
  bytes: number;
  /** True when the value is an MCP `{ content: [...] }` envelope, which Chrome does not unwrap. */
  envelope: boolean;
  /** True when Chrome replaced an empty result with a canned message. */
  substituted: boolean;
}

/** Chrome substitutes this for an empty string, and only for an empty string. */
const EMPTY_SUBSTITUTE = 'Operation succeeded';

const hasContentArray = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { content?: unknown }).content);

/**
 * Tool libraries normalise results before the browser sees them, so an
 * envelope often arrives here already serialised to a string. Checking only
 * the object form silently reports `envelope: false` for exactly the case the
 * attribute exists to catch.
 */
const isEnvelope = (value: unknown): boolean => {
  if (hasContentArray(value)) return true;
  if (typeof value !== 'string') return false;
  try {
    return hasContentArray(JSON.parse(value));
  } catch {
    return false;
  }
};

export function describeResult(value: unknown): ResultDescription {
  const raw = typeof value === 'string' ? value : String(JSON.stringify(value));
  const substituted = raw === '';
  const serialized = substituted ? EMPTY_SUBSTITUTE : raw;

  return {
    type: value === null ? 'null' : typeof value,
    serialized,
    bytes: new TextEncoder().encode(serialized).length,
    envelope: isEnvelope(value),
    substituted,
  };
}

/**
 * Annotations the browser discarded.
 *
 * Chrome keeps only `readOnlyHint` and `untrustedContentHint`, normalising both
 * to booleans. Anything else — `destructiveHint`, `idempotentHint`, and the
 * rest of the server-side MCP vocabulary — disappears with no error at all.
 */
export function diffAnnotations(
  sent: Record<string, unknown> | undefined,
  kept: Record<string, unknown> | undefined,
): string[] {
  if (!sent) return [];
  const survived = new Set(Object.keys(kept ?? {}));
  return Object.keys(sent).filter((key) => !survived.has(key));
}
