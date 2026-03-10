import { describe, it, expect } from 'vitest';
import { isSuppressed } from './suppression';
import type { ExceptionRecord, SuppressionRule } from './types';

const makeException = (type: string, value: string): ExceptionRecord => ({
  type,
  value,
  mechanism: { type: 'onerror', handled: false },
});

describe('isSuppressed', () => {
  it('returns false with no rules', () => {
    expect(isSuppressed(makeException('Error', 'test'), [])).toBe(false);
  });

  it('matches exact type', () => {
    const rules: SuppressionRule[] = [{ key: 'type', operator: 'exact', value: 'ResizeObserver loop' }];
    expect(isSuppressed(makeException('ResizeObserver loop', 'x'), rules)).toBe(true);
    expect(isSuppressed(makeException('TypeError', 'x'), rules)).toBe(false);
  });

  it('matches contains on value', () => {
    const rules: SuppressionRule[] = [{ key: 'value', operator: 'contains', value: 'Script error' }];
    expect(isSuppressed(makeException('Error', 'Script error.'), rules)).toBe(true);
    expect(isSuppressed(makeException('Error', 'other'), rules)).toBe(false);
  });

  it('matches regex on value', () => {
    const rules: SuppressionRule[] = [{ key: 'value', operator: 'regex', value: '^Loading chunk \\d+' }];
    expect(isSuppressed(makeException('Error', 'Loading chunk 42 failed'), rules)).toBe(true);
    expect(isSuppressed(makeException('Error', 'other error'), rules)).toBe(false);
  });

  it('matches if any rule matches (OR logic)', () => {
    const rules: SuppressionRule[] = [
      { key: 'type', operator: 'exact', value: 'AbortError' },
      { key: 'value', operator: 'contains', value: 'Script error' },
    ];
    expect(isSuppressed(makeException('AbortError', 'request aborted'), rules)).toBe(true);
    expect(isSuppressed(makeException('Error', 'Script error.'), rules)).toBe(true);
    expect(isSuppressed(makeException('TypeError', 'other'), rules)).toBe(false);
  });

  it('handles invalid regex gracefully', () => {
    const rules: SuppressionRule[] = [{ key: 'value', operator: 'regex', value: '[invalid' }];
    expect(isSuppressed(makeException('Error', 'test'), rules)).toBe(false);
  });
});
