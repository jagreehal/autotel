import type { ExceptionList, ExceptionMechanism, ExceptionRecord } from './types';
import type { StringRedactor } from './redact-values';
import { parseStack } from './stack-parser';

const MAX_CAUSE_DEPTH = 5;

function normalizeToError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  if (value === null || value === undefined) return new Error('Unknown error');
  try {
    return new Error(String(value));
  } catch {
    return new Error('Unknown error');
  }
}

export function buildExceptionList(
  input: unknown,
  mechanismType: ExceptionMechanism['type'],
  redactor?: StringRedactor,
): ExceptionList {
  const error = normalizeToError(input);
  const handled = mechanismType === 'manual';

  const records: ExceptionRecord[] = [];
  let current: Error | undefined = error;
  let depth = 0;

  while (current && depth < MAX_CAUSE_DEPTH) {
    const message = current.message || 'Unknown error';
    const record: ExceptionRecord = {
      type: current.name || 'Error',
      value: redactor ? redactor(message) : message,
      mechanism: { type: mechanismType, handled },
    };

    if (current.stack) {
      const frames = parseStack(current.stack);
      if (frames.length > 0) {
        if (redactor) {
          for (const frame of frames) {
            if (frame.abs_path) {
              frame.abs_path = redactor(frame.abs_path);
            }
          }
        }
        record.stacktrace = { frames };
      }
    }

    records.push(record);
    current = current.cause instanceof Error ? current.cause : undefined;
    depth++;
  }

  return records.reverse();
}
