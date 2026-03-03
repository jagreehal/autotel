import { describe, expect, it, vi } from 'vitest';
import { formatDuration, formatPrettyLogLine } from './pretty-log-formatter';
import type { CanonicalLogLineEvent } from './processors/canonical-log-line-processor';

describe('formatDuration', () => {
  it('formats sub-second durations as ms', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(45)).toBe('45ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds with one decimal under 10s', () => {
    expect(formatDuration(1234)).toBe('1.2s');
    expect(formatDuration(9500)).toBe('9.5s');
  });

  it('rounds seconds above 10s', () => {
    expect(formatDuration(12345)).toBe('12s');
  });

  it('formats minutes', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(120000)).toBe('2m');
  });
});

describe('formatPrettyLogLine', () => {
  const originalEnv = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.NO_COLOR = '1';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalEnv;
    }
  });

  it('formats a basic request line', () => {
    const ctx: CanonicalLogLineEvent = {
      span: {} as any,
      level: 'info',
      message: '[checkout] Request completed',
      event: {
        timestamp: '2025-01-24T16:45:31.060Z',
        'service.name': 'my-app',
        'http.request.method': 'GET',
        'http.route': '/api/checkout',
        'http.response.status_code': 200,
        duration_ms: 234,
        status_code: 0,
        operation: 'checkout',
        traceId: 'abc123',
        spanId: 'def456',
        correlationId: 'abc1',
      },
    };

    const output = formatPrettyLogLine(ctx);
    expect(output).toContain('INFO');
    expect(output).toContain('[my-app]');
    expect(output).toContain('GET');
    expect(output).toContain('/api/checkout');
    expect(output).toContain('200');
    expect(output).toContain('234ms');
  });

  it('includes context attributes as tree', () => {
    const ctx: CanonicalLogLineEvent = {
      span: {} as any,
      level: 'info',
      message: 'Request completed',
      event: {
        timestamp: '2025-01-24T16:45:31.060Z',
        duration_ms: 100,
        status_code: 0,
        operation: 'checkout',
        traceId: 'abc',
        spanId: 'def',
        correlationId: 'abc',
        'user.id': '123',
        'user.plan': 'premium',
        'cart.items': 3,
      },
    };

    const output = formatPrettyLogLine(ctx);
    expect(output).toContain('user');
    expect(output).toContain('id=123');
    expect(output).toContain('plan=premium');
    expect(output).toContain('cart');
    expect(output).toContain('items');
  });

  it('skips internal telemetry attributes', () => {
    const ctx: CanonicalLogLineEvent = {
      span: {} as any,
      level: 'info',
      message: 'Request completed',
      event: {
        timestamp: '2025-01-24T16:45:31.060Z',
        duration_ms: 50,
        status_code: 0,
        operation: 'test',
        traceId: 'abc',
        spanId: 'def',
        correlationId: 'abc',
        'telemetry.sdk.name': 'autotel',
        'otel.scope.name': 'my-scope',
        'service.name': 'my-app',
        custom_field: 'visible',
      },
    };

    const output = formatPrettyLogLine(ctx);
    expect(output).not.toContain('telemetry.sdk.name');
    expect(output).not.toContain('otel.scope.name');
    expect(output).toContain('custom_field');
  });
});
