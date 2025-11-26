import { describe, it, expect } from 'vitest';
import {
  generateTraceId,
  generateSpanId,
  createTraceparent,
  parseTraceparent,
} from './traceparent';

describe('traceparent generation', () => {
  it('should generate valid trace IDs (32 hex chars)', () => {
    const traceId = generateTraceId();
    expect(traceId).toHaveLength(32);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should generate valid span IDs (16 hex chars)', () => {
    const spanId = generateSpanId();
    expect(spanId).toHaveLength(16);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should create valid W3C traceparent header', () => {
    const traceparent = createTraceparent();
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('should use provided trace ID when given', () => {
    const customTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const traceparent = createTraceparent(customTraceId);
    expect(traceparent).toContain(customTraceId);
  });

  it('should parse valid traceparent header', () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const parsed = parseTraceparent(traceparent);

    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe('00');
    expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(parsed?.spanId).toBe('00f067aa0ba902b7');
    expect(parsed?.flags).toBe('01');
  });

  it('should return null for invalid traceparent', () => {
    expect(parseTraceparent('invalid')).toBeNull();
    expect(parseTraceparent('00-abc-def-01')).toBeNull();
    expect(parseTraceparent('00-toolong-00f067aa0ba902b7-01')).toBeNull();
  });
});
