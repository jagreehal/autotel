import { describe, it, expect } from 'vitest';
import { defaultSerializer, createStatementCapture } from './statement';
import type { SerializerPayload } from './types';

describe('defaultSerializer', () => {
  it('serializes a query condition payload without its values', () => {
    const payload: SerializerPayload = {
      condition: { name: 'Alice' },
      options: { lean: true },
    };
    expect(defaultSerializer('find', payload)).toBe(
      '{"condition":{"name":"?"},"options":{"lean":"?"}}',
    );
  });

  it('serializes an aggregate pipeline payload', () => {
    const payload: SerializerPayload = {
      aggregatePipeline: [{ $match: { status: 'active' } }],
    };
    expect(defaultSerializer('aggregate', payload)).toBe(
      '{"aggregatePipeline":[{"$match":{"status":"?"}}]}',
    );
  });
});

describe('createStatementCapture', () => {
  it('captures no values by default', () => {
    const capture = createStatementCapture({
      // SAFETY: a JavaScript caller can leave this unset, which is the default
      // path being tested; the type requires a value.
      dbStatementSerializer: undefined as any,
      statementRedactor: 'default',
    });
    const result = capture('find', {
      condition: { email: 'test@example.com' },
    });
    expect(result).toBe('{"condition":{"email":"?"}}');
  });

  it('redacts a serializer that captures values', () => {
    const capture = createStatementCapture({
      dbStatementSerializer: (_op, payload) => JSON.stringify(payload),
      statementRedactor: 'default',
    });
    const result = capture('find', {
      condition: { email: 'test@example.com' },
    });
    // Email should be smart-masked by the default preset (t***@***.com).
    expect(result).not.toContain('test@example.com');
    expect(result).toContain('t***@***.com');
  });

  it('returns undefined when dbStatementSerializer is false', () => {
    const capture = createStatementCapture({
      dbStatementSerializer: false,
      statementRedactor: 'default',
    });
    const result = capture('find', { condition: { name: 'Alice' } });
    expect(result).toBeUndefined();
  });

  it('uses custom serializer when provided', () => {
    const customSerializer = (op: string, _payload: SerializerPayload) =>
      `custom:${op}`;
    const capture = createStatementCapture({
      dbStatementSerializer: customSerializer,
      statementRedactor: false,
    });
    const result = capture('find', { condition: { name: 'Alice' } });
    expect(result).toBe('custom:find');
  });

  it('skips redaction when statementRedactor is false', () => {
    const capture = createStatementCapture({
      dbStatementSerializer: (_op, payload) => JSON.stringify(payload),
      statementRedactor: false,
    });
    const result = capture('find', {
      condition: { email: 'test@example.com' },
    });
    expect(result).toContain('test@example.com');
  });

  it('returns undefined when custom serializer returns undefined', () => {
    const capture = createStatementCapture({
      dbStatementSerializer: () => {},
      statementRedactor: 'default',
    });
    const result = capture('find', { condition: {} });
    expect(result).toBeUndefined();
  });
});
