/**
 * Keeping binary out of spans, and keeping what is left inside the limits.
 *
 * A multimodal call carries images, audio and PDFs inline as base64. Serialised
 * into `gen_ai.input.messages` verbatim, one such call is a megabyte-scale span
 * attribute — which collectors truncate mid-string, backends reject, and nobody
 * can read anyway. The bytes were never the interesting part: the prompt around
 * them is.
 *
 * So {@link redactBinaryContent} walks a payload and swaps every recognised
 * blob for a placeholder that names what was there, and {@link truncateUtf8}
 * caps whatever survives. Both are pure and backend-agnostic — the same problem
 * exists on Grafana, Honeycomb and Jaeger as on any vendor.
 *
 * Recognition is contextual, because "is this base64?" has no safe answer from
 * the string alone. A 100-character alphanumeric run is far more likely a
 * request id than an image, so a bare string must be long (1KB) before it is
 * suspected. Under a key that means binary — `data`, `image_url`, `inline_data`
 * — or beside a `mediaType` / `format` hint, 64 bytes is enough. An explicit
 * `text/*` media type settles it the other way and nothing is touched.
 */

/** Bytes a base64-shaped string needs before it is redacted, given binary context. */
const STRONG_CONTEXT_MIN_BYTES = 64;
/** Bytes a base64-shaped string needs before it is redacted with no context at all. */
const WEAK_CONTEXT_MIN_BYTES = 1024;

const DATA_URL_RE = /^data:([^\s,;]+)(?:;[^\s,;]+)*;base64,/i;
const BASE64_ALPHABET_RE = /^[A-Za-z0-9+/_=-]+$/;

/** Sibling keys that name the media type of a payload. */
const MIME_HINT_KEYS = [
  'mediaType',
  'media_type',
  'mimeType',
  'mime_type',
] as const;

/** Keys whose value is a payload rather than prose. */
const BINARY_KEYS = new Set([
  'data',
  'file_data',
  'fileData',
  'image_url',
  'imageUrl',
  'video_url',
  'videoUrl',
  'audio',
  'audio_data',
  'audioData',
  'inline_data',
  'inlineData',
  'source',
]);

/** `type` discriminators that mean the part carries a payload. */
const BINARY_PART_TYPES = new Set([
  'image',
  'image_url',
  'input_image',
  'audio',
  'input_audio',
  'video',
  'video_url',
  'file',
  'input_file',
  'document',
  'media',
  'file-data',
]);

/** Part types with no media type finer than "some file". */
const FILE_PART_TYPES = new Set([
  'file',
  'input_file',
  'document',
  'media',
  'file-data',
]);

const AUDIO_FORMATS = new Set([
  'wav',
  'mp3',
  'ogg',
  'flac',
  'm4a',
  'aac',
  'webm',
]);

type Parent = Record<string, unknown> | undefined;

/** The media type a sibling field states outright, when one does. */
function statedMediaType(
  parent: Parent,
  explicit?: string,
): string | undefined {
  if (explicit !== undefined) return explicit;
  if (!parent) return undefined;
  for (const key of MIME_HINT_KEYS) {
    const value = parent[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/** The best name available for what a payload holds. */
function inferMediaType(
  parent: Parent,
  key: string | undefined,
  explicit?: string,
): string | undefined {
  const stated = statedMediaType(parent, explicit);
  if (stated !== undefined) return stated;

  const format = parent?.format;
  if (typeof format === 'string' && AUDIO_FORMATS.has(format.toLowerCase())) {
    return `audio/${format.toLowerCase()}`;
  }

  const type = parent?.type;
  if (typeof type === 'string') {
    if (type === 'image' || type === 'image_url' || type === 'input_image')
      return 'image';
    if (type === 'audio' || type === 'input_audio') return 'audio';
    if (type === 'video' || type === 'video_url') return 'video';
    if (FILE_PART_TYPES.has(type)) return 'file';
  }

  if (key) {
    const lower = key.toLowerCase();
    if (lower.includes('audio')) return 'audio';
    if (lower.includes('video')) return 'video';
    if (lower.includes('image')) return 'image';
    if (lower.includes('file') || lower.includes('document')) return 'file';
  }
  return undefined;
}

/**
 * Whether the surroundings suggest this string is a payload. A stated `text/*`
 * media type is the one signal that argues the other way, and it wins: prose
 * that happens to be alphanumeric is not an image.
 */
function signalsBinary(
  parent: Parent,
  key: string | undefined,
  explicit?: string,
): boolean {
  const stated = statedMediaType(parent, explicit);
  if (stated !== undefined) return !stated.toLowerCase().startsWith('text/');

  const format = parent?.format;
  if (typeof format === 'string' && AUDIO_FORMATS.has(format.toLowerCase()))
    return true;

  const type = parent?.type;
  if (typeof type === 'string' && BINARY_PART_TYPES.has(type)) return true;

  return key !== undefined && BINARY_KEYS.has(key);
}

function placeholder(mediaType?: string): string {
  if (!mediaType) return '[base64 redacted]';
  return `[base64 ${mediaType} redacted]`;
}

/**
 * Whether a sibling field states, in so many words, that this key holds
 * something that is not text. The strongest signal there is: it makes even a
 * short string a payload, and a `text/*` type makes even a long one prose.
 */
function hasExplicitBinaryMediaType(
  parent: Parent,
  key: string | undefined,
  explicit?: string,
): boolean {
  if (explicit === undefined && !(key !== undefined && BINARY_KEYS.has(key))) {
    return false;
  }
  const stated = statedMediaType(parent, explicit);
  return stated !== undefined && !stated.toLowerCase().startsWith('text/');
}

function looksBase64(value: string, minBytes: number): boolean {
  return minBytes > 0 && BASE64_ALPHABET_RE.test(value.slice(0, minBytes));
}

function redactString(
  value: string,
  parent: Parent,
  key: string | undefined,
  explicit?: string,
): string {
  const dataUrl = DATA_URL_RE.exec(value);
  if (dataUrl) return placeholder(dataUrl[1]);

  const named = placeholder(inferMediaType(parent, key, explicit));

  if (hasExplicitBinaryMediaType(parent, key, explicit)) {
    // Base64 in the wild arrives line-wrapped; the newlines are not content.
    const candidate = value.replaceAll(/[\n\r]/g, '');
    const minBytes = Math.min(candidate.length, STRONG_CONTEXT_MIN_BYTES);
    return looksBase64(candidate, minBytes) ? named : value;
  }

  const minBytes = signalsBinary(parent, key, explicit)
    ? STRONG_CONTEXT_MIN_BYTES
    : WEAK_CONTEXT_MIN_BYTES;
  if (value.length < minBytes) return value;
  return looksBase64(value, minBytes) ? named : value;
}

export interface RedactBinaryOptions {
  /**
   * Media type of the value as a whole, when the caller already knows it —
   * an image buffer handed in on its own has no sibling field to say so.
   */
  mediaType?: string;
  /**
   * Called once per payload replaced. Callers that need to declare the loss
   * (an evidence label, a metric) count them here rather than diffing the
   * result against the input, which on a multimodal payload is the expensive
   * work this function exists to avoid.
   */
  onRedact?: () => void;
}

/**
 * Replace binary and base64 payloads inside `value` with placeholders naming
 * what was removed. Returns a new structure; `value` is left alone.
 *
 * A cycle resolves to `null` rather than looping.
 */
export function redactBinaryContent<T>(
  value: T,
  options?: RedactBinaryOptions,
): T;
export function redactBinaryContent(
  value: unknown,
  options?: RedactBinaryOptions,
): unknown {
  return walk(
    value,
    undefined,
    undefined,
    options?.mediaType,
    new Set(),
    options?.onRedact,
  );
}

function walk(
  value: unknown,
  parent: Parent,
  key: string | undefined,
  explicit: string | undefined,
  path: Set<object>,
  onRedact?: () => void,
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    const redacted = redactString(value, parent, key, explicit);
    if (redacted !== value) onRedact?.();
    return redacted;
  }
  if (typeof value !== 'object') return value;

  // Buffer extends Uint8Array, so this covers both.
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    onRedact?.();
    return placeholder(inferMediaType(parent, key, explicit));
  }

  // `path` holds only the ancestors of this node, so a value reached twice by
  // different routes — the same message object in two slots, one shared tool
  // definition — is walked twice rather than mistaken for a cycle and dropped.
  // Only a value that contains itself is on its own path.
  if (path.has(value)) return null;
  path.add(value);
  try {
    if (Array.isArray(value)) {
      // An array element inherits its parent's context: `parts: [...]` and
      // `parts[0]` describe the same thing.
      return value.map((item) =>
        walk(item, parent, key, explicit, path, onRedact),
      );
    }

    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const field of Object.keys(record)) {
      out[field] = walk(
        record[field],
        record,
        field,
        undefined,
        path,
        onRedact,
      );
    }
    return out;
  } finally {
    path.delete(value);
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export interface TruncateResult {
  /** The string as it should be recorded. */
  text: string;
  /** Whether anything was cut. */
  truncated: boolean;
  /** UTF-8 byte length before truncation — the size the caller nearly recorded. */
  originalBytes: number;
}

/**
 * Cap `text` at `maxBytes` UTF-8 bytes, reporting what it cost. A limit of zero
 * or less is no limit.
 *
 * Byte-accurate rather than character-accurate because that is what every
 * attribute limit downstream is measured in, and a multi-byte character is
 * never split into a broken one.
 */
export function truncateUtf8(text: string, maxBytes: number): TruncateResult {
  const bytes = encoder.encode(text);
  const originalBytes = bytes.byteLength;
  if (maxBytes <= 0 || originalBytes <= maxBytes) {
    return { text, truncated: false, originalBytes };
  }
  let cut = decoder.decode(bytes.subarray(0, maxBytes));
  // Decoding a prefix that lands mid-sequence yields U+FFFD; that is the
  // half-character, not content, so it goes.
  while (cut.endsWith('\uFFFD')) cut = cut.slice(0, -1);
  return { text: cut, truncated: true, originalBytes };
}

/** UTF-8 byte length, the unit every attribute limit downstream is measured in. */
function utf8Length(text: string): number {
  return encoder.encode(text).byteLength;
}

/** Appended to a string leaf that was cut, so the cut is visible in the content. */
const LEAF_TRUNCATION_MARKER = '…[truncated]';

/**
 * Copy `value`, cutting every string leaf longer than `capBytes`. Structure is
 * preserved exactly — only the leaves shrink, which is what keeps the result
 * parseable and still shaped like messages.
 */
function capStringLeaves(value: unknown, capBytes: number): unknown {
  if (typeof value === 'string') {
    const cut = truncateUtf8(value, capBytes);
    return cut.truncated ? cut.text + LEAF_TRUNCATION_MARKER : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => capStringLeaves(item, capBytes));
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    out[key] = capStringLeaves(record[key], capBytes);
  }
  return out;
}

/**
 * Serialise a prefix of the container that fits. A prefix of a valid array is
 * still an array and a subset of a valid object is still an object, which is
 * the property that matters: a reader that expects messages must not be handed
 * something that no longer parses as a list of them.
 *
 * Halves rather than pops so the number of serialisations stays logarithmic in
 * the entry count — the case this branch exists for is thousands of small
 * entries, where popping one at a time would be quadratic.
 */
function serializePrefix(value: unknown, maxBytes: number): string {
  if (Array.isArray(value)) {
    let count = value.length;
    while (count > 0) {
      count = Math.floor(count / 2);
      const text = JSON.stringify(value.slice(0, count));
      if (utf8Length(text) <= maxBytes) return text;
    }
    return '[]';
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  let count = keys.length;
  while (count > 0) {
    count = Math.floor(count / 2);
    const kept: Record<string, unknown> = {};
    for (const key of keys.slice(0, count)) kept[key] = record[key];
    const text = JSON.stringify(kept);
    if (utf8Length(text) <= maxBytes) return text;
  }
  return '{}';
}

export interface SerializeWithinBudgetResult {
  /** The text to record. Always valid JSON, unless the input was a plain string. */
  text: string;
  /** Whether anything was cut. */
  truncated: boolean;
  /** UTF-8 byte size of the untruncated serialisation. */
  originalBytes: number;
}

/**
 * Serialise `value` into at most `maxBytes` UTF-8 bytes **without breaking it**.
 *
 * Slicing serialised JSON at a byte offset lands mid-token and yields a string
 * nothing can parse — including autotel's own devtools, which then drop the
 * attribute entirely. So an oversized structure is shrunk from the inside
 * instead: long string leaves are cut first (keeping every message, role and
 * part where it was), and only if that is not enough does the container lose
 * trailing entries. Either way what lands is parseable.
 *
 * A plain string is sliced, since a cut string is still a valid string.
 * A budget of zero or less is no budget. Nothing here throws: a value JSON
 * cannot serialise (a cycle, a `toJSON` that fails) degrades to `null` rather
 * than taking down the call being instrumented.
 */
export function serializeWithinBudget(
  value: unknown,
  maxBytes: number,
): SerializeWithinBudgetResult {
  if (typeof value === 'string') {
    const cut = truncateUtf8(value, maxBytes);
    return {
      text: cut.text,
      truncated: cut.truncated,
      originalBytes: cut.originalBytes,
    };
  }

  let text: string;
  try {
    text = JSON.stringify(value) ?? 'null';
  } catch {
    // A cycle or a throwing `toJSON`. Instrumentation must not be the thing
    // that fails the call it is describing.
    return { text: 'null', truncated: true, originalBytes: 0 };
  }
  const originalBytes = utf8Length(text);
  if (maxBytes <= 0 || originalBytes <= maxBytes) {
    return { text, truncated: false, originalBytes };
  }

  // One big leaf is the usual cause — a long completion, a big tool result.
  // A quarter of the budget lets several such fields coexist while still
  // leaving room for the structure around them.
  const capped = capStringLeaves(value, Math.max(64, Math.floor(maxBytes / 4)));
  const cappedText = JSON.stringify(capped) ?? 'null';
  if (utf8Length(cappedText) <= maxBytes) {
    return { text: cappedText, truncated: true, originalBytes };
  }

  if (capped !== null && typeof capped === 'object') {
    return {
      text: serializePrefix(capped, maxBytes),
      truncated: true,
      originalBytes,
    };
  }
  return { text: 'null', truncated: true, originalBytes };
}
