/**
 * Variable Name Inference Utility
 *
 * Attempts to infer variable names from const/export const assignments
 * by analyzing the call stack and parsing source code.
 *
 * This is a best-effort approach with graceful degradation - if inference
 * fails for any reason, it returns undefined without breaking the application.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
 * Parses the stack trace to find where trace() was called
 *
 * Stack trace format (Node.js):
 *   at functionName (file:line:column)
 *   at file:line:column
 *
 * We skip frames until we find one that's NOT in functional.ts or this file.
 * We also need to skip one additional frame (the trace/span/instrument function itself)
 * to get to the actual user code.
 */
function parseCallLocation(stack: string): CallLocation | undefined {
  const lines = stack.split('\n');
  let skippedExternalFrame = false;

  for (const line of lines) {
    // Skip if line contains this file or functional.ts (internal frames)
    // Be specific about the filename to avoid matching test files
    if (
      line.includes('variable-name-inference.ts') ||
      line.includes('variable-name-inference.js') ||
      line.includes('functional.ts') ||
      line.includes('functional.js')
    ) {
      continue;
    }

    // Match various stack trace formats
    // Format 1: at functionName (file:line:column)
    // Format 2: at file:line:column
    const match =
      line.match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/) ||
      line.match(/^.*?([^:]+):(\d+):(\d+)/);

    if (match) {
      let filePath = match[1]!.trim();

      // Handle file:// URLs (convert to paths)
      if (filePath.startsWith('file://')) {
        try {
          filePath = fileURLToPath(filePath);
        } catch {
          continue;
        }
      }

      // Skip the first external frame (the trace/span function itself)
      // We want the frame where the user CALLS trace(), not inside trace()
      if (!skippedExternalFrame) {
        skippedExternalFrame = true;
        continue;
      }

      return {
        file: filePath,
        line: Number.parseInt(match[2]!, 10),
        column: Number.parseInt(match[3]!, 10),
      };
    }
  }

  return undefined;
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
    if (typeof readFileSync !== 'function') {
      return undefined;
    }

    const content = readFileSync(filePath, 'utf8');
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
    // Capture stack trace
    const stack = captureStackTrace();

    // Parse stack to find trace() call location
    const callLocation = parseCallLocation(stack);
    if (!callLocation) {
      return undefined;
    }

    // Check cache
    const cacheKey = `${callLocation.file}:${callLocation.line}`;
    if (inferenceCache.has(cacheKey)) {
      return inferenceCache.get(cacheKey);
    }

    // Read source line
    const sourceLine = readSourceLine(callLocation.file, callLocation.line);
    if (!sourceLine) {
      return undefined;
    }

    // Extract variable name
    const variableName = extractVariableName(sourceLine);

    // Cache result (even if undefined, to avoid repeated failed attempts)
    cacheInference(cacheKey, variableName);

    return variableName;
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
