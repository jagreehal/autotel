/**
 * What content reaches a span: failure text only with `captureErrorMessages`,
 * and every captured payload, intent and failure text through the caller's
 * `redactPayload` / `redact` first. A redactor that throws records nothing:
 * failing open would export exactly what it was there to stop.
 */
import { errorName } from './error-name.js';
import type {
  McpInstrumentationConfig,
  PayloadInfo,
  TextInfo,
} from './types.js';

type ContentConfig = Pick<
  McpInstrumentationConfig,
  'captureErrorMessages' | 'redact' | 'redactPayload'
>;

/** Text after `redact`, or undefined to record none. */
export function redactText(
  config: ContentConfig,
  text: string | undefined,
  info: TextInfo,
): string | undefined {
  if (!text) return undefined;
  if (!config.redact) return text;
  try {
    return config.redact(text, info) || undefined;
  } catch {
    return undefined;
  }
}

/** A payload after `redactPayload`; `{ ok: false }` when the redactor threw. */
export function redactPayload(
  config: ContentConfig,
  value: unknown,
  info: PayloadInfo,
): { ok: true; value: unknown } | { ok: false } {
  if (!config.redactPayload) return { ok: true, value };
  try {
    return { ok: true, value: config.redactPayload(value, info) };
  } catch {
    return { ok: false };
  }
}

/** A payload as a span attribute, after `redactPayload`; none when it threw. */
export function capturedPayload(
  config: ContentConfig,
  value: unknown,
  info: PayloadInfo,
): string | undefined {
  const redacted = redactPayload(config, value, info);
  if (!redacted.ok) return undefined;
  try {
    return JSON.stringify(redacted.value);
  } catch {
    return '[Circular or non-serializable]';
  }
}

/** A failure's text as the span may carry it: none unless `captureErrorMessages`. */
export function failureMessage(
  config: ContentConfig,
  text: string | undefined,
  name: string,
): string | undefined {
  return config.captureErrorMessages
    ? redactText(config, text, { kind: 'error', name })
    : undefined;
}

/**
 * The error to record: the original when its text may be kept as it is;
 * otherwise a copy with its type, `code` and only the allowed text. A
 * preformatted stack can contain an earlier version of the error message.
 */
export function recordableError(
  config: ContentConfig,
  error: unknown,
  name: string,
): unknown {
  if (config.captureErrorMessages && !config.redact) return error;
  let copy: Error;
  try {
    copy = sanitized(config, error, name);
  } catch {
    // An error whose properties throw on read: record that it failed, no more.
    copy = new Error('unreadable error');
  }
  delete copy.stack;
  return copy;
}

function sanitized(config: ContentConfig, error: unknown, name: string): Error {
  const type = errorName(error);
  const message = failureMessage(
    config,
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : undefined,
    name,
  );
  const copy: Error & { code?: unknown } = new Error(message ?? '');
  copy.name = type;
  // A code is an identifier; a structured error's why/fix/details are text.
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' || typeof code === 'number') copy.code = code;
  return copy;
}

/** The original error, by the recordable copy a span threw in its place. */
const ORIGINAL = new WeakMap<object, unknown>();

/**
 * What to throw inside a span: the span (autotel's wrapper) records what is
 * thrown through it, so it gets `recorded`, the one copy
 * {@link recordableError} made for this failure (redacting twice could give
 * two answers). Pair with {@link rethrowOriginal} outside the span, so
 * callers get the real error.
 */
export function thrownInSpan(error: unknown, recorded: unknown): unknown {
  if (recorded !== error && typeof recorded === 'object' && recorded !== null)
    ORIGINAL.set(recorded, error);
  return recorded;
}

/** Rethrow what the traced code threw, never the recordable copy. */
export function rethrowOriginal(thrown: unknown): never {
  throw typeof thrown === 'object' && thrown !== null && ORIGINAL.has(thrown)
    ? ORIGINAL.get(thrown)
    : thrown;
}
