import { describe, expect, it } from 'vitest';
import { toInvestigateError } from './runtime';
import { AutotelError } from '../../lib/errors';

describe('toInvestigateError', () => {
  it('passes AutotelError through unchanged', () => {
    const original = new AutotelError({
      type: 'environment',
      code: 'AUTOTEL_E_NO_PACKAGE_JSON',
      message: 'no package.json',
      retryable: false,
    });
    const out = toInvestigateError('query traces', original);
    expect(out).toBe(original);
  });

  it('wraps a plain Error in a runtime envelope', () => {
    const out = toInvestigateError('query traces', new Error('boom'));
    expect(out.type).toBe('runtime');
    expect(out.code).toBe('AUTOTEL_E_UNKNOWN');
    expect(out.message).toContain('autotel query traces failed: boom');
  });

  it('handles non-Error throwables (strings, numbers)', () => {
    const out = toInvestigateError('health', 'nope');
    expect(out.type).toBe('runtime');
    expect(out.message).toContain('nope');
  });

  it('detects ZodError-shaped objects (issues array) and emits validation envelope', () => {
    // Tests the detection shape used by autotel-mcp's loadConfig() failures
    // — we sniff by `.issues` array rather than `instanceof ZodError` to
    // avoid taking a runtime zod dep in CLI-land.
    const zodLike = {
      issues: [
        {
          path: ['backend'],
          message: 'Invalid option: expected one of "jaeger"|"tempo"',
          code: 'invalid_value',
          values: ['jaeger', 'tempo'],
        },
      ],
    };
    const out = toInvestigateError('health', zodLike);
    expect(out.type).toBe('validation');
    expect(out.code).toBe('AUTOTEL_E_INVALID_INPUT');
    expect(out.message).toContain('autotel health: invalid input');
    expect(out.message).toContain('"backend"');
    expect(out.message).toContain('Invalid option');
    expect(out.expected).toBeDefined();
    expect((out.expected as { issues: unknown[] }).issues).toHaveLength(1);
  });

  it('handles ZodError with nested path', () => {
    const out = toInvestigateError('discover services', {
      issues: [{ path: ['x', 'y'], message: 'must be a thing' }],
    });
    expect(out.type).toBe('validation');
    expect(out.message).toContain('"x.y"');
    expect(out.message).toContain('must be a thing');
  });
});
