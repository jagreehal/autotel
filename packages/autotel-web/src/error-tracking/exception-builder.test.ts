import { describe, it, expect } from 'vitest';
import { buildExceptionList } from './exception-builder';

describe('buildExceptionList', () => {
  it('builds from Error with stack', () => {
    const error = new TypeError('Cannot read properties of undefined');
    const list = buildExceptionList(error, 'onerror');
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('TypeError');
    expect(list[0].value).toBe('Cannot read properties of undefined');
    expect(list[0].mechanism).toEqual({ type: 'onerror', handled: false });
    expect(list[0].stacktrace?.frames.length).toBeGreaterThan(0);
  });

  it('walks error.cause chain', () => {
    const root = new Error('root cause');
    const outer = new Error('outer', { cause: root });
    const list = buildExceptionList(outer, 'onerror');
    expect(list).toHaveLength(2);
    expect(list[0].value).toBe('root cause');
    expect(list[1].value).toBe('outer');
  });

  it('handles deep cause chain (max 5)', () => {
    let err: Error = new Error('level-0');
    for (let i = 1; i <= 10; i++) {
      err = new Error(`level-${i}`, { cause: err });
    }
    const list = buildExceptionList(err, 'onerror');
    expect(list.length).toBeLessThanOrEqual(5);
  });

  it('normalizes string input', () => {
    const list = buildExceptionList('something broke', 'manual');
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('Error');
    expect(list[0].value).toBe('something broke');
    expect(list[0].mechanism.type).toBe('manual');
  });

  it('normalizes unknown input', () => {
    const list = buildExceptionList(42, 'manual');
    expect(list).toHaveLength(1);
    expect(list[0].value).toBe('42');
  });

  it('normalizes null/undefined input', () => {
    const list = buildExceptionList(null, 'manual');
    expect(list).toHaveLength(1);
    expect(list[0].value).toBe('Unknown error');
  });

  it('sets handled=true for manual mechanism', () => {
    const list = buildExceptionList(new Error('test'), 'manual');
    expect(list[0].mechanism.handled).toBe(true);
  });

  describe('buildExceptionList with redactor', () => {
    it('redacts PII from error message', () => {
      const mockRedactor = (v: string) => v.replace(/john@example\.com/g, '[REDACTED]');
      const error = new Error('User john@example.com not found');
      const result = buildExceptionList(error, 'manual', mockRedactor);
      expect(result[0].value).toBe('User [REDACTED] not found');
    });

    it('does not redact without redactor', () => {
      const error = new Error('User john@example.com not found');
      const result = buildExceptionList(error, 'manual');
      expect(result[0].value).toBe('User john@example.com not found');
    });
  });
});
