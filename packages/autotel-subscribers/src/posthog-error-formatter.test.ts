import { describe, it, expect } from 'vitest';
import { formatExceptionForPostHog, errorToExceptionList } from './posthog-error-formatter';

describe('formatExceptionForPostHog', () => {
  it('formats an ExceptionList for PostHog $exception event', () => {
    const exceptionList = [
      {
        type: 'TypeError',
        value: 'Cannot read properties of undefined',
        mechanism: { type: 'onerror' as const, handled: false },
        stacktrace: {
          frames: [
            { filename: 'app.js', function: 'handleClick', lineno: 42, colno: 10, in_app: true },
          ],
        },
      },
    ];

    const result = formatExceptionForPostHog(exceptionList);
    expect(result.$exception_list).toHaveLength(1);
    expect(result.$exception_list[0].type).toBe('TypeError');
    expect(result.$exception_list[0].value).toBe('Cannot read properties of undefined');
    expect(result.$exception_list[0].stacktrace.frames[0].platform).toBe('web:javascript');
  });

  it('adds platform to all frames', () => {
    const exceptionList = [
      {
        type: 'Error',
        value: 'test',
        mechanism: { type: 'manual' as const, handled: true },
        stacktrace: {
          frames: [
            { filename: 'a.js', lineno: 1, colno: 1 },
            { filename: 'b.js', lineno: 2, colno: 2 },
          ],
        },
      },
    ];

    const result = formatExceptionForPostHog(exceptionList, 'node:javascript');
    expect(result.$exception_list[0].stacktrace.frames[0].platform).toBe('node:javascript');
    expect(result.$exception_list[0].stacktrace.frames[1].platform).toBe('node:javascript');
  });
});

describe('formatExceptionForPostHog with redactor', () => {
  const mockRedactor = (value: string) =>
    value.replaceAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, '[REDACTED]');

  it('redacts PII from exception.value', () => {
    const exceptionList = [
      {
        type: 'Error',
        value: 'User not found: alice@example.com',
        mechanism: { type: 'manual' as const, handled: true },
      },
    ];

    const result = formatExceptionForPostHog(exceptionList, 'web:javascript', mockRedactor);
    expect(result.$exception_list[0].value).toBe('User not found: [REDACTED]');
  });

  it('redacts PII from abs_path in stack frames', () => {
    const exceptionList = [
      {
        type: 'Error',
        value: 'fail',
        mechanism: { type: 'manual' as const, handled: true },
        stacktrace: {
          frames: [
            { filename: 'app.js', abs_path: '/home/alice@example.com/app.js', lineno: 1, colno: 1 },
          ],
        },
      },
    ];

    const result = formatExceptionForPostHog(exceptionList, 'web:javascript', mockRedactor);
    expect(result.$exception_list[0].stacktrace.frames[0].abs_path).toBe('/home/[REDACTED]/app.js');
  });

  it('does not redact exception.type', () => {
    const exceptionList = [
      {
        type: 'TypeError',
        value: 'Error for alice@example.com',
        mechanism: { type: 'manual' as const, handled: true },
      },
    ];

    const result = formatExceptionForPostHog(exceptionList, 'web:javascript', mockRedactor);
    expect(result.$exception_list[0].type).toBe('TypeError');
    expect(result.$exception_list[0].value).toBe('Error for [REDACTED]');
  });

  it('works without redactor (backwards compatible)', () => {
    const exceptionList = [
      {
        type: 'Error',
        value: 'User alice@example.com not found',
        mechanism: { type: 'manual' as const, handled: true },
      },
    ];

    const result = formatExceptionForPostHog(exceptionList);
    expect(result.$exception_list[0].value).toBe('User alice@example.com not found');
  });
});

describe('errorToExceptionList with redactor', () => {
  const mockRedactor = (value: string) =>
    value.replaceAll(/secret-token-\w+/g, '[REDACTED]');

  it('redacts error message', () => {
    const error = new Error('Failed with secret-token-abc123');
    const result = errorToExceptionList(error, mockRedactor);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('Failed with [REDACTED]');
  });

  it('works without redactor', () => {
    const error = new Error('Failed with secret-token-abc123');
    const result = errorToExceptionList(error);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('Failed with secret-token-abc123');
  });
});

describe('errorToExceptionList', () => {
  it('builds exception list from Error', () => {
    const error = new TypeError('test');
    const result = errorToExceptionList(error);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TypeError');
    expect(result[0].value).toBe('test');
  });

  it('handles non-Error input', () => {
    const result = errorToExceptionList('string error');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('string error');
  });

  it('walks cause chain', () => {
    const cause = new Error('root');
    const outer = new Error('outer', { cause });
    const result = errorToExceptionList(outer);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('root');
    expect(result[1].value).toBe('outer');
  });
});
