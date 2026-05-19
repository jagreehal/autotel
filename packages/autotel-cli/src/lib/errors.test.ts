import { describe, expect, it } from 'vitest';
import {
  AutotelError,
  AutotelErrorCodes,
  exitCodeForError,
  toAutotelError,
} from './errors';

describe('AutotelError', () => {
  it('serialises to an envelope with required fields', () => {
    const err = new AutotelError({
      type: 'validation',
      code: AutotelErrorCodes.E_NO_PACKAGE_JSON,
      message: 'No package.json found',
      fix: 'cd into a project directory',
      expected: { file: 'package.json' },
    });

    const env = err.toEnvelope('autotel init');

    expect(env.ok).toBe(false);
    expect(env.command).toBe('autotel init');
    expect(env.error.code).toBe('AUTOTEL_E_NO_PACKAGE_JSON');
    expect(env.error.type).toBe('validation');
    expect(env.error.retryable).toBe(false);
    expect(env.error.fix).toBe('cd into a project directory');
    expect(env.error.expected).toEqual({ file: 'package.json' });
  });

  it('omits optional fields when not provided', () => {
    const err = new AutotelError({
      type: 'runtime',
      code: AutotelErrorCodes.E_UNKNOWN,
      message: 'boom',
    });

    const env = err.toEnvelope();
    expect(env.command).toBeUndefined();
    expect(env.error.fix).toBeUndefined();
    expect(env.error.expected).toBeUndefined();
    expect(env.error.suggestions).toBeUndefined();
  });

  it('defaults retryable to false', () => {
    const err = new AutotelError({
      type: 'install',
      code: AutotelErrorCodes.E_INSTALL_FAILED,
      message: 'failed',
    });
    expect(err.retryable).toBe(false);
  });
});

describe('exitCodeForError', () => {
  it('returns 2 for validation and conflict errors', () => {
    expect(
      exitCodeForError(
        new AutotelError({
          type: 'validation',
          code: AutotelErrorCodes.E_INVALID_FLAG,
          message: 'x',
        })
      )
    ).toBe(2);
    expect(
      exitCodeForError(
        new AutotelError({
          type: 'conflict',
          code: AutotelErrorCodes.E_EXISTING_CONFIG,
          message: 'x',
        })
      )
    ).toBe(2);
  });

  it('returns 1 for runtime, io, install, etc.', () => {
    expect(
      exitCodeForError(
        new AutotelError({
          type: 'runtime',
          code: AutotelErrorCodes.E_UNKNOWN,
          message: 'x',
        })
      )
    ).toBe(1);
    expect(
      exitCodeForError(
        new AutotelError({
          type: 'install',
          code: AutotelErrorCodes.E_INSTALL_FAILED,
          message: 'x',
        })
      )
    ).toBe(1);
  });
});

describe('toAutotelError', () => {
  it('returns the same instance for AutotelError input', () => {
    const err = new AutotelError({
      type: 'runtime',
      code: AutotelErrorCodes.E_UNKNOWN,
      message: 'x',
    });
    expect(toAutotelError(err)).toBe(err);
  });

  it('wraps a plain Error', () => {
    const wrapped = toAutotelError(new Error('plain boom'));
    expect(wrapped.code).toBe('AUTOTEL_E_UNKNOWN');
    expect(wrapped.message).toBe('plain boom');
  });

  it('wraps a string', () => {
    const wrapped = toAutotelError('string boom');
    expect(wrapped.message).toBe('string boom');
  });
});
