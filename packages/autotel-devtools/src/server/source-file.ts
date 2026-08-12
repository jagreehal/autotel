// Reading source off disk so a stack frame can show the line that threw.
//
// This is the one place devtools opens a file the *telemetry* named, so the
// path is untrusted input even though it arrived from your own process: a span
// attribute is just a string, and the receiver accepts spans from anywhere.
// Everything here exists to keep that string inside the project root.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/** A slice of a file around one line, ready to render. */
export interface SourceWindow {
  /** Path relative to the root — safe to show, and never leaks the absolute layout. */
  file: string;
  /** The line the frame pointed at, 1-based. */
  line: number;
  /** Line number of `lines[0]`, 1-based. */
  startLine: number;
  lines: string[];
}

/** Refuse to slurp something huge just because a span named it. */
const MAX_BYTES = 2_000_000;

const DISABLED = new Set(['false', '0', 'off', 'no', '']);

/**
 * Decide what `GET /source` may read, from `AUTOTEL_DEVTOOLS_SOURCE_ROOT`.
 *
 * Defaults **on**, at the working directory: devtools is a local tool whose
 * whole point is showing you your own code, and requiring a flag for that would
 * mean nobody ever sees the feature. The blast radius stays small because two
 * other things still hold — the receiver is bound to loopback, and nothing
 * outside this directory is reachable. Set the variable to `false` to turn it
 * off outright.
 *
 * A non-loopback bind (`--host 0.0.0.0`) removes the first of those, and the
 * Origin guard does not replace it: a request with no `Origin` at all — any
 * `curl` on the network — passes. The root holds whatever else lives in the
 * project, `.env` included, so the default flips to **off** there. An explicit
 * root is still honoured: exposing it on purpose is the caller's call.
 */
export function resolveSourceRoot(
  configured: string | undefined,
  cwd: string,
  loopbackOnly = true,
): string | undefined {
  if (configured === undefined) return loopbackOnly ? cwd : undefined;
  if (DISABLED.has(configured.trim().toLowerCase())) return undefined;
  return configured;
}

/**
 * Resolve `requested` against `root`, or return `null` if it escapes.
 *
 * Containment is judged on **real** paths so a symlink inside the root that
 * points outside it is rejected — lexical `..` stripping alone cannot see that.
 * The value returned is the *lexical* resolution, because the real one differs
 * from the caller's path whenever an ancestor is a symlink (on macOS both
 * `/tmp` and `/var` are), and a caller comparing paths should not have to know.
 */
export function resolveWithinRoot(
  root: string,
  requested: string,
): string | null {
  const lexicalRoot = path.resolve(root);
  const realRoot = safeRealpath(lexicalRoot);
  if (realRoot === null) return null;

  const lexicalTarget = path.resolve(lexicalRoot, requested);
  const realTarget = safeRealpath(lexicalTarget);
  // A path that does not exist is indistinguishable from one we may not read,
  // and both answers are "no file for you".
  if (realTarget === null) return null;

  if (!isInside(realRoot, realTarget)) return null;
  return lexicalTarget;
}

/** True when `target` is `root` itself or sits beneath it. */
function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  // The separator matters: `/proj-secrets` must not count as inside `/proj`.
  return target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Read `context` lines either side of `line` from a file inside `root`.
 * Returns `null` when the path escapes the root, is not a readable file, or is
 * too large — the caller cannot distinguish those, which is the point.
 */
export function readSourceWindow(
  root: string,
  requested: string,
  line: number,
  context: number,
): SourceWindow | null {
  const resolved = resolveWithinRoot(root, requested);
  if (resolved === null) return null;

  let text: string;
  try {
    const stat = statSync(resolved);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    text = readFileSync(resolved, 'utf8');
  } catch {
    return null;
  }

  // A trailing newline is a terminator, not an empty final line.
  const all = text.split('\n');
  if (all.at(-1) === '') all.pop();

  // Clamp rather than pad, so line numbers stay truthful at both edges.
  const startLine = Math.max(1, line - context);
  const endLine = Math.min(all.length, line + context);
  if (startLine > all.length) return null;

  return {
    file: path.relative(path.resolve(root), resolved),
    line,
    startLine,
    lines: all.slice(startLine - 1, endLine),
  };
}
