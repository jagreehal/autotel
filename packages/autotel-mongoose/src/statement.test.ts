import { describe, it, expect } from 'vitest';
import { defaultSerializer, createStatementCapture } from './statement';
import type { SerializerPayload } from './types';

describe('defaultSerializer', () => {
  it('serializes a query condition payload to JSON', () => {
    const payload: SerializerPayload = {
      condition: { name: 'Alice' },
      options: { lean: true },
    };
    const result = defaultSerializer('find', payload);
    expect(result).toBe(JSON.stringify(payload));
  });

  it('serializes an aggregate pipeline payload', () => {
    const payload: SerializerPayload = {
      aggregatePipeline: [{ $match: { status: 'active' } }],
    };
    const result = defaultSerializer('aggregate', payload);
    expect(result).toBe(JSON.stringify(payload));
  });
});

describe('createStatementCapture', () => {
  it('uses default serializer and default redactor when no config provided', () => {
    const capture = createStatementCapture({
      dbStatementSerializer: undefined as any,
      statementRedactor: 'default',
    });
    const result = capture('find', {
      condition: { email: 'test@example.com' },
    });
    expect(result).toBeDefined();
    // Email should be redacted by default preset
    expect(result).not.toContain('test@example.com');
    expect(result).toContain('[REDACTED]');
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
      dbStatementSerializer: undefined as any,
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
