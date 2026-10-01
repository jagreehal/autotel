// How a failure becomes an issue key. Browser-safe (no `node:*`): the widget,
// the devtools server and autotel-mcp all group with this one function, so a
// failure lands in the same issue wherever it is looked at.

import { parseStackTrace, type StackFrame } from '../server/parse-stack';

/** Collapse the parts of a message that vary per occurrence. */
export function normalizeMessage(message: string): string {
  return (
    message
      .replaceAll(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '[UUID]',
      )
      .replaceAll(/\b(?:0x)?[0-9a-f]{12,}\b/gi, '[ID]')
      // Unbounded on purpose: `\b\d+\b` would leave `412ms` alone.
      .replaceAll(/\d+/g, '[N]')
      .replaceAll(/"[^"]*"/g, '"[STR]"')
      .replaceAll(/'[^']*'/g, "'[STR]'")
      .replaceAll(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  );
}

function basename(file: string): string {
  return file.split(/[/\\]/).pop() ?? file;
}

function frameKey(frame: StackFrame): string {
  return `${frame.function ?? 'anonymous'}@${basename(frame.file)}`;
}

/** App frames only: the code you wrote, not dependencies or the runtime. */
export function appFrames(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  return parseStackTrace(stack).filter((frame) => frame.kind === 'app');
}

/**
 * Where the failure lives, as `fn (file)`: directories, line and column are
 * dropped so the key survives rebuilds (bundlers write to a fresh temp
 * directory) and unrelated edits above the failing line.
 */
export function culpritOf(stack: string | undefined): string | undefined {
  const [top] = appFrames(stack);
  if (!top) return undefined;
  return top.function
    ? `${top.function} (${basename(top.file)})`
    : basename(top.file);
}

/** 64-bit FNV-1a as two 32-bit halves: stable, short, dependency-free. */
export function hashKey(text: string): string {
  let low = 0x811c9dc5;
  let high = 0xcbf29ce4;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index) ?? 0;
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ (code + 0x9e37), 0x01000193);
  }
  return (
    (high >>> 0).toString(16).padStart(8, '0') +
    (low >>> 0).toString(16).padStart(8, '0')
  );
}

export interface FingerprintInput {
  service: string;
  type?: string;
  message: string;
  stack?: string;
  /** Span name, the stand-in for "where" when there is no stack. */
  operation?: string;
  /** `exception.fingerprint`: the emitter's own grouping decision wins. */
  override?: string;
}

/**
 * Service + type + the top three app frames. Without a stack, the normalised
 * message and operation stand in for the frames.
 */
export function fingerprintOf(input: FingerprintInput): string {
  if (input.override) return input.override;
  const frames = appFrames(input.stack).slice(0, 3).map(frameKey);
  const where =
    frames.length > 0
      ? frames
      : [normalizeMessage(input.message), input.operation ?? ''];
  return hashKey([input.service, input.type ?? '', ...where].join('\u0000'));
}
