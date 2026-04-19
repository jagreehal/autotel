import { describe, it, expect } from 'vitest';
import type {
  SpanRecord,
  TraceRecord,
  QueryFilter,
  BackendCapabilities,
} from '../src/types';

describe('types', () => {
  it('SpanRecord has required fields', () => {
    const span: SpanRecord = {
      traceId: 'abc123',
      spanId: 'def456',
      parentSpanId: null,
      operationName: 'GET /api',
      serviceName: 'web',
      startTimeUnixMs: 1700000000000,
      durationMs: 150,
      statusCode: 'OK',
      tags: { 'http.method': 'GET' },
      hasError: false,
    };
    expect(span.traceId).toBe('abc123');
    expect(span.hasError).toBe(false);
  });

  it('TraceRecord wraps spans', () => {
    const trace: TraceRecord = {
      traceId: 'abc123',
      spans: [],
    };
    expect(trace.spans).toHaveLength(0);
  });

  it('QueryFilter supports all operator types', () => {
    const filter: QueryFilter = {
      field: 'duration_ms',
      operator: 'gt',
      value: 100,
    };
    expect(filter.operator).toBe('gt');
  });

  it('BackendCapabilities declares signal support', () => {
    const caps: BackendCapabilities = {
      traces: 'available',
      metrics: 'available',
      logs: 'unsupported',
    };
    expect(caps.logs).toBe('unsupported');
  });
});
