/**
 * Stable exception fingerprints, computed where the error happened.
 *
 * Every backend that groups errors — Sentry, autotel-devtools' own
 * Errors tab — reconstructs grouping from the stack string it happens to
 * receive, and each one reconstructs it differently. The same crash becomes one
 * issue here and three there, and no two dashboards agree on how often it fires.
 *
 * Emitting the fingerprint as an attribute moves that decision to the one place
 * that has the real error: the SDK. Every destination then inherits the same
 * grouping without being taught anything.
 *
 * The algorithm is deliberately identical to the one `ErrorAggregator` in
 * autotel-devtools has always used, so groups keep their identity when the
 * attribute starts arriving.
 *
 * @example
 * ```typescript
 * import { exceptionFingerprint } from 'autotel/exception-fingerprint';
 *
 * init({
 *   service: 'checkout',
 *   spanEnrichers: [exceptionFingerprint()],
 * });
 * ```
 */

import type { Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { nonEmptyString } from './values';

/** Attribute the fingerprint is written to. */
export const EXCEPTION_FINGERPRINT_ATTRIBUTE = 'exception.fingerprint';

/**
 * Frames deep enough to separate two different bugs, shallow enough that the
 * same bug reached through different callers still groups.
 */
const DEFAULT_FRAMES = 5;

export interface ExceptionInput {
  /** Error class name, e.g. `TypeError`. Defaults to `Error`. */
  type?: string;
  /** Error message. Only used for grouping when there is no usable stack. */
  message?: string;
  /** Raw stack string, as `Error.stack` produces it. */
  stack?: string;
}

// Node style: "at functionName (file:line:col)".
const NODE_FRAME = /^at\s+(.+?)\s+\((.+?):(\d+):\d+\)$/;
// Anonymous: "at file:line:col".
const ANON_FRAME = /^at\s+(.+?):(\d+):\d+$/;
// Browser style: "functionName@file:line:col".
const BROWSER_FRAME = /^(.+?)@(.+?):(\d+):\d+$/;

/**
 * Collapse a path to the part that identifies the code rather than the machine
 * it ran on: a dependency becomes its package name, and an absolute path
 * becomes the project-relative one. Without this, the same error fingerprints
 * differently in CI, in Docker, and on a laptop.
 */
export function normalizeFilePath(filePath: string): string {
  const nodeModulesMatch = filePath.match(
    /node_modules\/(@[^/]+\/[^/]+|[^/]+)/,
  );
  if (nodeModulesMatch) {
    return `[npm]/${nodeModulesMatch[1]}`;
  }

  return filePath
    .replace(/^.*?\/src\//, 'src/')
    .replace(/^.*?\/dist\//, 'dist/')
    .replace(/^.*?\/lib\//, 'lib/')
    .replace(/^file:\/\//, '');
}

/**
 * Strip the parts of a message that change on every occurrence, so
 * `timeout after 341ms` and `timeout after 78ms` are one issue rather than two.
 */
export function normalizeMessage(message: string): string {
  return (
    message
      .replaceAll(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '[UUID]',
      )
      .replaceAll(/\b[0-9a-f]{16,}\b/gi, '[ID]')
      // Unbounded on purpose: there is no word boundary between a digit and a
      // letter, so `\b\d+\b` would leave `341ms` and `78ms` intact.
      .replaceAll(/\d+/g, '[N]')
      .replaceAll(/"[^"]*"/g, '"[STR]"')
      .replaceAll(/'[^']*'/g, "'[STR]'")
      .slice(0, 200)
  );
}

/**
 * `function@normalized-path` for the top N frames. Line and column are
 * deliberately dropped: an edit one line above the throw is the same bug.
 */
export function normalizeStackFrames(stack: string, count: number): string[] {
  const frames: string[] = [];

  for (const line of stack.split('\n')) {
    if (frames.length >= count) break;
    const trimmed = line.trim();

    const node = NODE_FRAME.exec(trimmed);
    if (node) {
      frames.push(
        `${node[1] ?? 'anonymous'}@${normalizeFilePath(node[2] ?? '')}`,
      );
      continue;
    }

    const anon = ANON_FRAME.exec(trimmed);
    if (anon) {
      frames.push(`anonymous@${normalizeFilePath(anon[1] ?? '')}`);
      continue;
    }

    const browser = BROWSER_FRAME.exec(trimmed);
    if (browser) {
      frames.push(
        `${browser[1] ?? 'anonymous'}@${normalizeFilePath(browser[2] ?? '')}`,
      );
    }
  }

  return frames;
}

/** 32-bit djb2-style hash, rendered as 8 hex characters. */
export function hashFingerprintParts(parts: string[]): string {
  const value = parts.join('|');
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    // Must stay `charCodeAt`: `ErrorAggregator` hashes this way, and code
    // points would silently regroup every existing error on a surrogate pair.
    // eslint-disable-next-line unicorn/prefer-code-point
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash = hash & hash; // force 32-bit
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Group key for an exception. Returns `undefined` when there is nothing to
 * group on, so callers never write an attribute that means "no information".
 */
export function fingerprintException(
  input: ExceptionInput,
  frames: number = DEFAULT_FRAMES,
): string | undefined {
  const stackFrames = input.stack
    ? normalizeStackFrames(input.stack, frames)
    : [];

  // A stack is the strong signal; the message is the fallback for the many
  // runtimes and rejections that arrive without one.
  if (stackFrames.length === 0 && !input.message && !input.type) {
    return undefined;
  }

  const parts: string[] = [input.type || 'Error'];
  if (stackFrames.length > 0) {
    parts.push(...stackFrames);
  } else if (input.message) {
    parts.push(normalizeMessage(input.message));
  }

  return hashFingerprintParts(parts);
}

/**
 * Read the error off a finished span, wherever it was recorded: the OTel
 * `exception` event, the `exception.*` attributes autotel-web sets, or the
 * `error.*` attributes structured errors write instead of an event.
 */
function readException(span: ReadableSpan): ExceptionInput | undefined {
  const { attributes } = span;
  const event = span.events?.find((e) => e.name === 'exception');
  const eventAttributes = event?.attributes ?? {};

  const type =
    nonEmptyString(attributes['exception.type']) ??
    nonEmptyString(attributes['error.type']) ??
    nonEmptyString(eventAttributes['exception.type']);

  const stack =
    nonEmptyString(attributes['exception.stacktrace']) ??
    nonEmptyString(attributes['exception.stack']) ??
    nonEmptyString(attributes['error.stack']) ??
    nonEmptyString(eventAttributes['exception.stacktrace']) ??
    nonEmptyString(eventAttributes['exception.stack']);

  // No type, no stack, no exception event: this span did not fail in a way
  // anyone groups. `status.message` alone is not enough — plenty of healthy
  // spans carry one.
  if (!type && !stack && !event) return undefined;

  const message =
    nonEmptyString(attributes['exception.message']) ??
    nonEmptyString(attributes['error.message']) ??
    nonEmptyString(eventAttributes['exception.message']) ??
    nonEmptyString(span.status.message);

  return { type, message, stack };
}

export interface ExceptionFingerprintOptions {
  /** Stack frames to fingerprint on. @default 5 */
  frames?: number;
}

/**
 * Span enricher that stamps {@link EXCEPTION_FINGERPRINT_ATTRIBUTE} on every
 * span that recorded an exception.
 *
 * Pass it to `init({ spanEnrichers: [...] })` rather than `spanProcessors`:
 * enrichers add to the pipeline instead of replacing it, and sit outside the
 * redaction wrapper so the attribute reaches every exporter.
 */
export function exceptionFingerprint(
  options: ExceptionFingerprintOptions = {},
): SpanProcessor {
  const frames = options.frames ?? DEFAULT_FRAMES;

  return {
    onStart(_span: Span, _context: Context): void {
      // Nothing to fingerprint until the span has actually failed.
    },

    onEnd(span: ReadableSpan): void {
      const { attributes } = span;

      // A span that fingerprinted itself knows something this enricher does
      // not — a domain-specific grouping key, say. Never overwrite it.
      if (attributes[EXCEPTION_FINGERPRINT_ATTRIBUTE] !== undefined) return;

      const exception = readException(span);
      if (!exception) return;

      const fingerprint = fingerprintException(exception, frames);
      if (fingerprint) {
        attributes[EXCEPTION_FINGERPRINT_ATTRIBUTE] = fingerprint;
      }
    },

    forceFlush(): Promise<void> {
      return Promise.resolve();
    },

    shutdown(): Promise<void> {
      return Promise.resolve();
    },
  };
}
