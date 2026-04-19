import { describe, it, expect } from 'vitest';
import { detectAnomalies } from '../src/modules/anomaly';
import type { TraceRecord, SpanRecord } from '../src/types';

function makeSpan(overrides: Partial<SpanRecord>): SpanRecord {
  return {
    traceId: 't1',
    spanId: 's1',
    parentSpanId: null,
    operationName: 'op',
    serviceName: 'svc',
    startTimeUnixMs: Date.now(),
    durationMs: 100,
    statusCode: 'OK',
    tags: {},
    hasError: false,
    ...overrides,
  };
}

describe('detectAnomalies', () => {
  it('detects latency spikes', () => {
    const now = Date.now();
    const traces: TraceRecord[] = [];
    for (let i = 0; i < 9; i++) {
      traces.push({
        traceId: `t${i}`,
        spans: [
          makeSpan({
            traceId: `t${i}`,
            spanId: `s${i}`,
            serviceName: 'web',
            durationMs: 90 + Math.random() * 20,
            startTimeUnixMs: now + i * 1000,
          }),
        ],
      });
    }
    traces.push({
      traceId: 't-outlier',
      spans: [
        makeSpan({
          traceId: 't-outlier',
          spanId: 's-outlier',
          serviceName: 'web',
          durationMs: 1000,
          startTimeUnixMs: now + 9000,
        }),
      ],
    });

    const results = detectAnomalies(traces, { service: 'web' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.type === 'latency_spike')).toBe(true);
  });

  it('detects error rate spikes', () => {
    const traces: TraceRecord[] = [];
    for (let i = 0; i < 8; i++) {
      traces.push({
        traceId: `t${i}`,
        spans: [
          makeSpan({ traceId: `t${i}`, spanId: `s${i}`, serviceName: 'api' }),
        ],
      });
    }
    for (let i = 8; i < 10; i++) {
      traces.push({
        traceId: `t${i}`,
        spans: [
          makeSpan({
            traceId: `t${i}`,
            spanId: `s${i}`,
            serviceName: 'api',
            statusCode: 'ERROR',
            hasError: true,
          }),
        ],
      });
    }

    const results = detectAnomalies(traces, { service: 'api' });
    expect(results.some((r) => r.type === 'error_rate_spike')).toBe(true);
  });

  it('returns empty for normal traffic', () => {
    const traces = Array.from({ length: 10 }, (_, i) => ({
      traceId: `t${i}`,
      spans: [
        makeSpan({
          traceId: `t${i}`,
          spanId: `s${i}`,
          serviceName: 'web',
          durationMs: 100,
        }),
      ],
    }));

    const results = detectAnomalies(traces, { service: 'web' });
    const latencySpikes = results.filter((r) => r.type === 'latency_spike');
    expect(latencySpikes).toHaveLength(0);
  });
});
