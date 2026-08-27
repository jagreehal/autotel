/**
 * Trace wire codec.
 *
 * `endTime` is the one field worth removing from the wire after compression:
 * it is a distinct high-entropy number per span, so deflate cannot fold it
 * away, and it is derivable from `startTime + duration`. Measured on a
 * 4,891-span trace it is 32% of the compressed payload.
 *
 * The seam is the codec pair. A trace that survives a round trip unchanged is
 * the whole contract, because every view downstream reads `SpanData` and none
 * of them know the transport changed.
 */

import { describe, it, expect } from 'vitest';
import { encodeTrace, decodeTrace } from '../wire';
import type { SpanData, TraceData } from '../../server/types';

function span(overrides: Partial<SpanData> = {}): SpanData {
  const startTime = 1_767_000_000_000;
  return {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    name: 'GET /checkout',
    kind: 'SERVER',
    startTime,
    endTime: startTime + 12,
    duration: 12,
    attributes: { 'http.request.method': 'GET' },
    status: { code: 'OK' },
    events: [{ name: 'cache.miss', timestamp: startTime + 3, attributes: {} }],
    scope: { name: '@otel/http', version: '0.57.0' },
    ...overrides,
  };
}

function trace(spans: SpanData[]): TraceData {
  const root = spans[0];
  const startTime = Math.min(...spans.map((s) => s.startTime));
  const endTime = Math.max(...spans.map((s) => s.endTime));
  return {
    traceId: root.traceId,
    correlationId: root.traceId,
    rootSpan: root,
    spans,
    startTime,
    endTime,
    duration: endTime - startTime,
    status: 'OK',
    service: 'checkout-api',
  };
}

describe('trace wire codec', () => {
  it('round-trips a trace unchanged', () => {
    const original = trace([
      span(),
      span({
        spanId: 'c'.repeat(16),
        parentSpanId: 'b'.repeat(16),
        startTime: 1_767_000_000_000,
        endTime: 1_767_000_000_004,
        duration: 4,
      }),
    ]);

    expect(decodeTrace(encodeTrace(original))).toEqual(original);
  });

  it('leaves no span endTime on the wire', () => {
    const wire = encodeTrace(trace([span()]));

    expect(JSON.stringify(wire)).not.toContain('endTime');
  });

  it('keeps an endTime that its duration cannot reproduce', () => {
    // An embedder calling ingestTraces directly is not bound by the invariant
    // ingest keeps. Dropping this would silently draw the wrong bar.
    const odd = span({ startTime: 1000, endTime: 9999, duration: 5 });

    const wire = encodeTrace(trace([odd]));
    expect(JSON.stringify(wire)).toContain('endTime');
    expect(decodeTrace(wire).spans[0].endTime).toBe(9999);
  });
});
