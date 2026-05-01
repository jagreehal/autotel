import { describe, it, expect } from 'vitest';
import { findRootCause } from '../src/modules/correlator';
import type { TraceRecord } from '../src/types';

describe('findRootCause', () => {
  it('identifies the slowest leaf span as bottleneck', () => {
    const trace: TraceRecord = {
      traceId: 't1',
      spans: [
        {
          traceId: 't1',
          spanId: 'root',
          parentSpanId: null,
          operationName: 'GET /api',
          serviceName: 'gateway',
          startTimeUnixMs: 1000,
          durationMs: 500,
          statusCode: 'OK',
          tags: {},
          hasError: false,
        },
        {
          traceId: 't1',
          spanId: 'child1',
          parentSpanId: 'root',
          operationName: 'query',
          serviceName: 'db',
          startTimeUnixMs: 1010,
          durationMs: 450,
          statusCode: 'OK',
          tags: {},
          hasError: false,
        },
        {
          traceId: 't1',
          spanId: 'child2',
          parentSpanId: 'root',
          operationName: 'cache.get',
          serviceName: 'redis',
          startTimeUnixMs: 1005,
          durationMs: 5,
          statusCode: 'OK',
          tags: {},
          hasError: false,
        },
      ],
    };
    const result = findRootCause(trace);
    expect(result.bottleneck.spanId).toBe('child1');
    expect(result.bottleneck.serviceName).toBe('db');
    expect(result.percentOfTrace).toBeGreaterThan(80);
  });

  it('identifies error spans as root cause', () => {
    const trace: TraceRecord = {
      traceId: 't1',
      spans: [
        {
          traceId: 't1',
          spanId: 'root',
          parentSpanId: null,
          operationName: 'POST /checkout',
          serviceName: 'web',
          startTimeUnixMs: 1000,
          durationMs: 200,
          statusCode: 'ERROR',
          tags: {},
          hasError: true,
        },
        {
          traceId: 't1',
          spanId: 'child',
          parentSpanId: 'root',
          operationName: 'charge',
          serviceName: 'payments',
          startTimeUnixMs: 1010,
          durationMs: 50,
          statusCode: 'ERROR',
          tags: { 'error.message': 'insufficient funds' },
          hasError: true,
        },
      ],
    };
    const result = findRootCause(trace);
    expect(result.bottleneck.spanId).toBe('child');
    expect(result.reason).toContain('error');
  });

  it('clamps percentOfTrace to <= 100 when spans are not linked into a tree', () => {
    // Reproducer: a flat trace (every span has parentSpanId === null) — happens
    // when a backend strips parent refs. Previously percentOfTrace divided
    // bottleneck duration by the (often tiny) first span and produced values
    // like 2348%. Should now use the trace wall-clock window instead.
    const trace: TraceRecord = {
      traceId: 't-flat',
      spans: [
        {
          traceId: 't-flat',
          spanId: 'a',
          parentSpanId: null,
          operationName: 'mark-running',
          serviceName: 'processor',
          startTimeUnixMs: 1000,
          durationMs: 9,
          statusCode: 'OK',
          tags: {},
          hasError: false,
        },
        {
          traceId: 't-flat',
          spanId: 'b',
          parentSpanId: null,
          operationName: 'workflow',
          serviceName: 'processor',
          startTimeUnixMs: 1000,
          durationMs: 200,
          statusCode: 'ERROR',
          tags: {},
          hasError: true,
        },
      ],
    };
    const result = findRootCause(trace);
    expect(result.percentOfTrace).toBeLessThanOrEqual(100);
    expect(result.percentOfTrace).toBeGreaterThanOrEqual(0);
  });
});
