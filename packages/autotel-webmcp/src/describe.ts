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

/** True when the browser may show a friendlier label than the name that runs. */
export function labelMismatch(name: string, title: unknown): boolean {
  return typeof title === 'string' && title.length > 0 && title !== name;
}

export interface DescriptorFields {
  annotations?: unknown;
  description?: unknown;
  /**
   * The handler's source, when the host asked for it. A descriptor says what a
   * tool claims to be; only this says what it will do. Left out by default —
   * see `fingerprintHandler`.
   */
  handler?: unknown;
  inputSchema?: unknown;
  name: string;
  title?: unknown;
}

/**
 * A short identity for the descriptor that was sent to `registerTool`.
 *
 * Not a security boundary — it exists so a later register of the same name
 * can be compared to the earlier one. FNV-1a over the canonical JSON.
 */
export function descriptorFingerprint(tool: DescriptorFields): string {
  const canonical = JSON.stringify([
    tool.name,
    typeof tool.title === 'string' ? tool.title : '',
    String(tool.description ?? ''),
    tool.inputSchema ?? null,
    tool.annotations ?? null,
    tool.handler === undefined ? null : String(tool.handler),
  ]);
  return fnv1aHex(canonical);
}

/** The two refusal shapes recognised by default. Anything else is unclassified. */
export type RefusalKind = 'confirm' | 'unavailable';

/**
 * A refusal is a tool declining to act rather than failing, and telling the
 * two apart is worth an attribute. This is a text match on someone else's
 * English, and it is the default only because it costs nothing and covers the
 * common case: reword either sentence and `webmcp.result.refused` goes quiet
 * with nothing failing. A host that cares, or one whose tools refuse in their
 * own words, passes `isRefusal` to `instrumentWebMCP` instead. This package
 * depends on no tool library.
 */
export function describeRefusal(value: unknown): RefusalKind | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.endsWith(' was not confirmed.')) return 'confirm';
  if (value.endsWith(' is not available right now.')) return 'unavailable';
  return undefined;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const fnv1aHex = (value: string): string => {
  let hash = FNV_OFFSET;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
