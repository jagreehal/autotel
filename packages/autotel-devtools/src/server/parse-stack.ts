// Structured stack-frame parsing.
//
// `error-aggregator.ts` already matched stack lines, but only to build a
// fingerprint: it normalised paths and discarded line/column, which are exactly
// the parts needed to show the failing source. This module is the one parser,
// keeping the position data; the aggregator composes its fingerprint from it.

// Deliberately free of `node:*` imports: the widget parses the stack string it
// already receives over the WebSocket, so this module has to run in the browser
// too. `URL` is native on both sides, unlike `node:url`'s `fileURLToPath`
// (which also throws on a Windows URL when the host is POSIX).

/**
 * Why a frame matters to the reader:
 * - `app` — your source. The only kind worth opening in an editor.
 * - `dependency` — inside `node_modules`. Rarely where the bug is.
 * - `native` — Node internals (`node:*`) or synthetic (`[eval]`), no file to open.
 *
 * Derived from the path alone, so this stays a pure function — no cwd, no fs.
 */
export type StackFrameKind = 'app' | 'dependency' | 'native';

export interface StackFrame {
  /** Function or method name. Absent for anonymous top-level frames. */
  function?: string;
  /** Filesystem path, or the raw specifier for non-file frames (`node:` internals). */
  file: string;
  line: number;
  column: number;
  kind: StackFrameKind;
}

function classify(file: string): StackFrameKind {
  // `node:` builtins, plus V8's synthetic `[eval]` / `<anonymous>` specifiers,
  // have no file on disk.
  if (
    file.startsWith('node:') ||
    file.startsWith('[') ||
    file.startsWith('<')
  ) {
    return 'native';
  }
  // Path-segment match, not a substring match: a project legitimately called
  // `my-node_modules-tool` is app code. pnpm nests `node_modules` several
  // segments deep, so this cannot assume it is the first segment.
  if (/(^|[/\\])node_modules([/\\]|$)/.test(file)) return 'dependency';
  return 'app';
}

// V8 prefixes awaited frames with `async `; it is a marker, not part of the
// name or the path, so both patterns consume it without capturing it.
// Named frame: `at fn (file:line:col)` / `at Class.method (file:line:col)`.
const NAMED_FRAME = /^\s*at\s+(?:async\s+)?(.+?)\s+\((.+?):(\d+):(\d+)\)$/;
// Anonymous frame — no function, no parens: `at file:line:col`.
const ANON_FRAME = /^\s*at\s+(?:async\s+)?(.+?):(\d+):(\d+)$/;

/** `file:///a/b.ts` → `/a/b.ts`. Left untouched when it is not a file URL. */
function toPath(specifier: string): string {
  if (!specifier.startsWith('file://')) return specifier;
  try {
    const decoded = decodeURIComponent(new URL(specifier).pathname);
    // `file:///C:/x` parses to `/C:/x`; the slash before a drive letter is an
    // artefact of the URL form, not part of the path.
    return /^\/[A-Za-z]:/.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return specifier;
  }
}

export function parseStackTrace(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];

  for (const rawLine of stack.split('\n')) {
    const named = NAMED_FRAME.exec(rawLine);
    if (named) {
      const file = toPath(named[2]);
      frames.push({
        function: named[1],
        file,
        line: Number(named[3]),
        column: Number(named[4]),
        kind: classify(file),
      });
      continue;
    }

    const anon = ANON_FRAME.exec(rawLine);
    if (anon) {
      const file = toPath(anon[1]);
      frames.push({
        file,
        line: Number(anon[2]),
        column: Number(anon[3]),
        kind: classify(file),
      });
    }
  }

  return frames;
}
