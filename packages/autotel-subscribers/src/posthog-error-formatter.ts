/**
 * Format errors for PostHog's $exception event format.
 * Compatible with autotel-web's ExceptionList type.
 */

type StringRedactor = (value: string) => string;

interface StackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  abs_path?: string;
  in_app?: boolean;
  platform?: string;
}

interface ExceptionRecord {
  type: string;
  value: string;
  mechanism: { type: string; handled: boolean };
  stacktrace?: { frames: StackFrame[] };
}

interface PostHogExceptionProperties {
  $exception_list: Array<{
    type: string;
    value: string;
    mechanism: { type: string; handled: boolean };
    stacktrace: { frames: Array<StackFrame & { platform: string }> };
  }>;
}

const MAX_CAUSE_DEPTH = 5;

export function formatExceptionForPostHog(
  exceptionList: ExceptionRecord[],
  platform: string = 'web:javascript',
  redactor?: StringRedactor,
): PostHogExceptionProperties {
  return {
    $exception_list: exceptionList.map((ex) => ({
      type: ex.type,
      value: redactor ? redactor(ex.value) : ex.value,
      mechanism: ex.mechanism,
      stacktrace: {
        frames: (ex.stacktrace?.frames || []).map((frame) => ({
          ...frame,
          abs_path: frame.abs_path && redactor ? redactor(frame.abs_path) : frame.abs_path,
          platform,
        })),
      },
    })),
  };
}

export function errorToExceptionList(
  input: unknown,
  redactor?: StringRedactor,
): ExceptionRecord[] {
  const error = input instanceof Error ? input : new Error(
    input === null || input === undefined ? 'Unknown error' : String(input),
  );

  const records: ExceptionRecord[] = [];
  let current: Error | undefined = error;
  let depth = 0;

  while (current && depth < MAX_CAUSE_DEPTH) {
    const value = current.message || 'Unknown error';
    const frames = current.stack ? parseStackBasic(current.stack) : undefined;
    records.push({
      type: current.name || 'Error',
      value: redactor ? redactor(value) : value,
      mechanism: { type: 'manual', handled: true },
      stacktrace: frames ? {
        frames: redactor
          ? frames.map((f) => ({
              ...f,
              abs_path: f.abs_path ? redactor(f.abs_path) : f.abs_path,
            }))
          : frames,
      } : undefined,
    });
    current = current.cause instanceof Error ? current.cause : undefined;
    depth++;
  }

  return records.toReversed();
}

function parseStackBasic(stack: string): StackFrame[] {
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];
  const re = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

  for (const line of lines) {
    const match = line.trim().match(re);
    if (match) {
      const [, fn, absPath, lineStr, colStr] = match;
      frames.push({
        function: fn || undefined,
        abs_path: absPath,
        filename: absPath.split('/').pop() || absPath,
        lineno: Number.parseInt(lineStr, 10),
        colno: Number.parseInt(colStr, 10),
        in_app: !absPath.includes('node_modules'),
      });
    }
  }

  return frames;
}
