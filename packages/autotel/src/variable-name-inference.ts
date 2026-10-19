/**
 * Variable Name Inference Utility
 *
 * Attempts to infer variable names from const/export const assignments
 * by analyzing the call stack and parsing source code.
 *
 * This is a best-effort approach with graceful degradation - if inference
 * fails for any reason, it returns undefined without breaking the application.
 */

// namespace imports for browser-bundler compat — see node-require.ts
import * as nodeFs from 'node:fs';
import * as nodeUrl from 'node:url';

interface CallLocation {
  file: string;
  line: number;
  column: number;
}

/**
 * LRU Cache for inferred variable names
 * Key: "file:line" (e.g., "/path/to/file.ts:42")
 * Value: inferred variable name or undefined
 */
const inferenceCache = new Map<string, string | undefined>();
const MAX_CACHE_SIZE = 50;

/**
 * Captures the current call stack
 */
function captureStackTrace(): string {
  const originalStackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 10; // Only need first few frames

  const err = new Error('Stack trace capture');
  const stack = err.stack || '';

  Error.stackTraceLimit = originalStackTraceLimit;
  return stack;
}

/**
 * Modules whose stack frames sit between the user's `trace()` call and this
 * file, as source files (tests, tsx). The extension is anchored so
 * `functional.ts` does not also match `functional.test.ts`.
 *
 * A bundle names these differently (`functional-DPuMySRd.js`), which is why a
 * frame is also internal when it is in the same file as this module: the
 * bundler puts this module and its callers in one chunk.
 */
const INTERNAL_FRAME_MODULES = [
  'variable-name-inference',
  'functional',
  'functional-wrapper',
];
const INTERNAL_FRAME = new RegExp(
  String.raw`(?:${INTERNAL_FRAME_MODULES.join('|')})\.(?:ts|js)`,
);

/** Parses one stack line (`at fn (file:line:col)` or `at file:line:col`). */
function parseFrame(line: string): CallLocation | undefined {
  const match =
    line.match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/) ||
    line.match(/^.*?([^:]+):(\d+):(\d+)/);
  if (!match) return undefined;

  let filePath = match[1]!.trim();
  // ESM frames are file:// URLs
  if (filePath.startsWith('file://')) {
    try {
      filePath = nodeUrl.fileURLToPath(filePath);
    } catch {
      return undefined;
    }
  }

  return {
    file: filePath,
    line: Number.parseInt(match[2]!, 10),
    column: Number.parseInt(match[3]!, 10),
  };
}

/** The file this module was loaded from - the source file, or the bundle chunk. */
const OWN_FILE = (new Error('own file').stack ?? '')
  .split('\n')
  .map((line) => parseFrame(line))
  .find(Boolean)?.file;

/**
 * The first two stack frames outside autotel: the line that called `trace()`,
 * then its caller, for when the first is a wrapper around `trace()`.
 */
function parseCallLocations(stack: string): CallLocation[] {
  const locations: CallLocation[] = [];

  for (const line of stack.split('\n')) {
    if (INTERNAL_FRAME.test(line)) continue;
    const frame = parseFrame(line);
    if (!frame || frame.file === OWN_FILE) continue;
    locations.push(frame);
    if (locations.length === 2) break;
  }

  return locations;
}

/**
 * Reads a specific line from a source file
 */
function readSourceLine(
  filePath: string,
  lineNumber: number,
): string | undefined {
  try {
    // Check if we can access the file system (not available in edge runtimes)
    if (typeof nodeFs.readFileSync !== 'function') {
      return undefined;
    }

    const content = nodeFs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Line numbers are 1-based
    return lines[lineNumber - 1];
  } catch {
    // File doesn't exist, permission denied, or other error
    return undefined;
  }
}

/**
 * Extracts variable name from source code line using regex patterns
 *
 * Supported patterns:
 * - const varName = anyFunction(
 * - export const varName = anyFunction(
 * - let varName = anyFunction(
 * - var varName = anyFunction(
 *
 * Note: This won't work with destructuring assignments or complex patterns
 */
function extractVariableName(sourceLine: string): string | undefined {
  // Remove leading/trailing whitespace
  const trimmed = sourceLine.trim();

  // Pattern: (export)? (const|let|var) varName = anyFunctionCall(
  // We match any function call, not just trace(), to support wrapper functions
  const patterns = [
    // export const varName = anyFunction(
    /export\s+const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/,
    // const varName = anyFunction(
    /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/,
    // export let varName = anyFunction(
    /export\s+let\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/,
    // let varName = anyFunction(
    /let\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/,
    // export var varName = anyFunction(
    /export\s+var\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/,
    // var varName = anyFunction(
    /var\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Adds an entry to the cache with LRU eviction
 */
function cacheInference(key: string, value: string | undefined): void {
  // If cache is full, remove oldest entry (first entry in Map)
  if (inferenceCache.size >= MAX_CACHE_SIZE) {
    const firstKey = inferenceCache.keys().next().value;
    if (firstKey) {
      inferenceCache.delete(firstKey);
    }
  }

  inferenceCache.set(key, value);
}

/** The variable assigned on the source line at `location`, cached per line. */
function variableNameAt(location: CallLocation): string | undefined {
  const cacheKey = `${location.file}:${location.line}`;
  if (inferenceCache.has(cacheKey)) {
    return inferenceCache.get(cacheKey);
  }

  const sourceLine = readSourceLine(location.file, location.line);
  const variableName = sourceLine ? extractVariableName(sourceLine) : undefined;
  // Cache misses too, to avoid repeated file reads
  cacheInference(cacheKey, variableName);
  return variableName;
}

/**
 * Main entry point: Attempts to infer the variable name from the call stack
 *
 * This function:
 * 1. Captures the call stack
 * 2. Parses it to find where trace() was called (file + line)
 * 3. Reads that line from the source file
 * 4. Extracts the variable name using regex
 *
 * Returns undefined if inference fails at any step (graceful degradation).
 * Results are cached to avoid repeated file I/O.
 *
 * @returns The inferred variable name, or undefined if inference failed
 */
export function inferVariableNameFromCallStack(): string | undefined {
  try {
    // The call site, then its caller, so a helper around trace() takes the
    // name its caller assigns.
    for (const location of parseCallLocations(captureStackTrace())) {
      const name = variableNameAt(location);
      if (name) return name;
    }
    return undefined;
  } catch {
    // Graceful degradation - don't break the app if inference fails
    return undefined;
  }
}

/**
 * Clears the inference cache (useful for testing)
 */
export function clearInferenceCache(): void {
  inferenceCache.clear();
}
