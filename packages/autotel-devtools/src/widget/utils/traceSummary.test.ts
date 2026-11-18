import { describe, it, expect } from 'vitest';
import { hasTraceCardDetails, summarizeTrace } from './traceSummary';
import type { SpanData, TraceData } from '../types';

const span = (s: Partial<SpanData> & { spanId: string }): SpanData => ({
  traceId: 't',
  name: s.spanId,
  kind: 'INTERNAL',
  startTime: 0,
  endTime: 0,
  duration: 0,
  attributes: {},
  status: { code: 'OK' },
  ...s,
});

const trace = (spans: SpanData[]): TraceData => ({
  traceId: 't',
  correlationId: 't',
  rootSpan: spans[0]!,
  spans,
  startTime: 0,
  endTime: 100,
  duration: 100,
  status: 'OK',
  service: 'api',
});

describe('summarizeTrace', () => {
  // root 0-100 waits on db 10-70 and smtp 70-95; db waits on cache 10-20.
  const spans = [
    span({ spanId: 'root', endTime: 100, duration: 100 }),
    span({
      spanId: 'db',
      parentSpanId: 'root',
      startTime: 10,
      endTime: 70,
      duration: 60,
      attributes: { 'service.name': 'db' },
    }),
    span({
      spanId: 'cache',
      parentSpanId: 'db',
      startTime: 10,
      endTime: 20,
      duration: 10,
      attributes: { 'service.name': 'cache' },
    }),
    span({
      spanId: 'smtp',
      parentSpanId: 'root',
      startTime: 70,
      endTime: 95,
      duration: 25,
      status: { code: 'ERROR', message: 'SMTP 550' },
    }),
  ];

  it('picks the top spans by self time, listed in the order they started', () => {
    const { slowest } = summarizeTrace(trace(spans));
    expect(slowest.map((s) => [s.span.spanId, s.selfTime])).toEqual([
      ['root', 15],
      ['db', 50],
      ['smtp', 25],
    ]);
  });

  it('leaves out spans under 1% of the trace', () => {
    // root spends 0.5 of 100 itself around its child: noise, not a step.
    const busy = [
      span({ spanId: 'root', endTime: 100, duration: 100 }),
      span({
        spanId: 'email',
        parentSpanId: 'root',
        startTime: 0.5,
        endTime: 100,
        duration: 99.5,
      }),
    ];
    expect(
      summarizeTrace(trace(busy)).slowest.map((s) => s.span.spanId),
    ).toEqual(['email']);
  });

  it('lists services by first appearance with span counts, defaulting to the trace service', () => {
    expect(summarizeTrace(trace(spans)).services).toEqual([
      { name: 'api', spans: 2 },
      { name: 'db', spans: 1 },
      { name: 'cache', spans: 1 },
    ]);
  });

  it('collects error spans and finds where the failure started', () => {
    const failed = spans.map((s) =>
      s.spanId === 'root' ? { ...s, status: { code: 'ERROR' as const } } : s,
    );
    const summary = summarizeTrace(trace(failed));
    expect(summary.errors.map((s) => s.spanId)).toEqual(['root', 'smtp']);
    expect(summary.errorOrigin?.spanId).toBe('smtp');
  });

  it('has no card details for a healthy one-span trace with no notable attributes', () => {
    const solo = trace([
      span({ spanId: 'user.find', endTime: 100, duration: 100 }),
    ]);
    expect(hasTraceCardDetails(solo)).toBe(false);
    expect(hasTraceCardDetails(trace(spans))).toBe(true);
  });
});
