import { describe, expect, it } from 'vitest';
import { createUseLogger, getHeader } from './core';

describe('createUseLogger', () => {
  it('throws clear adapter-specific error when called without active span', () => {
    const useLogger = createUseLogger<{ requestId: string }>({
      adapterName: 'test-framework',
      enrich: (ctx) => ({ request_id: ctx.requestId }),
    });

    expect(() => useLogger({ requestId: 'r1' })).toThrow(
      '[autotel-adapters/test-framework] No active trace context.',
    );
  });
});

describe('getHeader', () => {
  it('reads from Headers-like object with get()', () => {
    const headers = { get: (name: string) => (name === 'x-request-id' ? 'req-1' : null) };
    expect(getHeader(headers, 'x-request-id')).toBe('req-1');
    expect(getHeader(headers, 'x-missing')).toBeUndefined();
  });

  it('reads from plain object with exact key match', () => {
    const headers = { 'X-Request-Id': 'req-2' };
    expect(getHeader(headers, 'X-Request-Id')).toBe('req-2');
  });

  it('falls back to lowercase key lookup', () => {
    const headers = { 'x-request-id': 'req-3' };
    expect(getHeader(headers, 'X-Request-Id')).toBe('req-3');
  });

  it('returns undefined for missing headers', () => {
    expect(getHeader(undefined, 'x-request-id')).toBeUndefined();
    expect(getHeader({}, 'x-request-id')).toBeUndefined();
  });
});
