import type { StackFrame } from './types';

// Chrome/V8: "    at funcName (url:line:col)" or "    at url:line:col"
const CHROME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

// Firefox/Safari: "funcName@url:line:col" or "url:line:col"
const FIREFOX_RE = /^(?:(.+)@)?(.+?):(\d+):(\d+)$/;

function extractFilename(absPath: string): string {
  try {
    const url = new URL(absPath);
    const parts = url.pathname.split('/');
    return parts[parts.length - 1] || absPath;
  } catch {
    const parts = absPath.split('/');
    return parts[parts.length - 1] || absPath;
  }
}

function isInApp(absPath: string): boolean {
  if (absPath.includes('node_modules')) return false;
  if (absPath.includes('extensions/')) return false;
  if (absPath.startsWith('chrome-extension://')) return false;
  if (absPath.includes('<anonymous>')) return false;
  if (absPath.startsWith('eval')) return false;
  return true;
}

export function parseStack(stack: string | undefined | null): StackFrame[] {
  if (!stack) return [];

  const lines = stack.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match = trimmed.match(CHROME_RE);
    if (match) {
      const [, fn, absPath, lineStr, colStr] = match;
      frames.push({
        function: fn || undefined,
        abs_path: absPath,
        filename: extractFilename(absPath),
        lineno: parseInt(lineStr, 10),
        colno: parseInt(colStr, 10),
        in_app: isInApp(absPath),
      });
      continue;
    }

    match = trimmed.match(FIREFOX_RE);
    if (match) {
      const [, fn, absPath, lineStr, colStr] = match;
      frames.push({
        function: fn || undefined,
        abs_path: absPath,
        filename: extractFilename(absPath),
        lineno: parseInt(lineStr, 10),
        colno: parseInt(colStr, 10),
        in_app: isInApp(absPath),
      });
      continue;
    }
  }

  return frames;
}
