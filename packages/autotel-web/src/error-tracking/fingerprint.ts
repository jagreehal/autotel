/**
 * Group key for a browser exception, decided here rather than by whichever
 * backend receives it. Emitted as `exception.fingerprint`, so every
 * destination groups this error the same way instead of each re-deriving
 * grouping from the stack string it happens to get.
 *
 * ponytail: these rules mirror `exception-fingerprint.ts` in the `autotel`
 * package, deliberately copied rather than imported — autotel-web carries no
 * workspace dependencies so the browser bundle stays in its 2–5KB budget. Both
 * copies must produce identical output; if they ever need to diverge, or a
 * third consumer appears, extract a leaf package instead of adding a copy.
 */

import type { StackFrame } from './types';

/** Frames deep enough to separate two bugs, shallow enough to group one. */
const FRAMES = 5;

function normalizeFilePath(filePath: string): string {
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

function normalizeMessage(message: string): string {
  return message
    .replaceAll(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '[UUID]',
    )
    .replaceAll(/\b[0-9a-f]{16,}\b/gi, '[ID]')
    .replaceAll(/\d+/g, '[N]')
    .replaceAll(/"[^"]*"/g, '"[STR]"')
    .replaceAll(/'[^']*'/g, "'[STR]'")
    .slice(0, 200);
}

function hash(parts: string[]): string {
  const value = parts.join('|');
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h << 5) - h + value.charCodeAt(i);
    h = h & h; // force 32-bit
  }
  return Math.abs(h).toString(16).padStart(8, '0');
}

/**
 * Line and column are dropped on purpose: an edit one line above the throw is
 * still the same bug, and a rebuilt bundle would otherwise regroup everything.
 */
export function fingerprintFrames(
  type: string,
  message: string,
  frames: StackFrame[] | undefined,
): string {
  const parts: string[] = [type || 'Error'];

  const top = (frames ?? []).slice(0, FRAMES);
  if (top.length > 0) {
    for (const frame of top) {
      parts.push(
        `${frame.function || 'anonymous'}@${normalizeFilePath(
          frame.abs_path ?? frame.filename ?? '',
        )}`,
      );
    }
  } else {
    parts.push(normalizeMessage(message));
  }

  return hash(parts);
}
