import { describe, expect, it } from 'vitest';
import {
  discoverLogFields,
  discoverServices,
  discoverTraceFields,
} from '../src/modules/discovery';
import type { LogRecord, MetricSeries, TraceRecord } from '../src/types';

const traces: TraceRecord[] = [
  {
    traceId: 't1',
    spans: [
      {
        traceId: 't1',
        spanId: 's1',
        parentSpanId: null,
        operationName: 'checkout.request',
        serviceName: 'checkout',
        startTimeUnixMs: 1,
        durationMs: 120,
        statusCode: 'OK',
        tags: {
          'http.method': 'GET',
          'telemetry.sdk.language': 'nodejs',
        },
        hasError: false,
      },
      {
        traceId: 't1',
        spanId: 's2',
        parentSpanId: 's1',
        operationName: 'payment.charge',
        serviceName: 'payment',
        startTimeUnixMs: 2,
        durationMs: 80,
        statusCode: 'ERROR',
        tags: {
          'db.system': 'postgresql',
          'gen_ai.system': 'openai',
          'gen_ai.usage.total_tokens': 42,
        },
        hasError: true,
      },
    ],
  },
];

const logs: LogRecord[] = [
  {
    timestampUnixMs: 100,
    severityText: 'ERROR',
    body: 'payment failed',
    serviceName: 'payment',
    traceId: 't1',
    spanId: 's2',
    attributes: {
      'error.kind': 'TimeoutError',
      'http.status_code': 504,
    },
  },
];

const metrics: MetricSeries[] = [
  {
    metricName: 'http.server.duration',
    points: [{ timestampUnixMs: 100, value: 10 }],
    attributes: { 'service.name': 'checkout' },
  },
];

describe('discovery module', () => {
  it('discovers trace fields with wildcard filtering', () => {
    const all = discoverTraceFields(traces);
    expect(all.totalFields).toBeGreaterThan(0);
    expect(all.searchableFields).toContain('service.name');

    const filtered = discoverTraceFields(traces, '*token*');
    expect(filtered.searchableFields).toContain('trace.total_tokens');
    expect(
      filtered.searchableFields.every((f) => f.toLowerCase().includes('token')),
    ).toBe(true);
  });

  it('discovers log fields with type inference', () => {
    const result = discoverLogFields(logs);
    expect(result.searchableFields).toContain('severity_text');
    expect(result.fieldsByType.number).toContain('http.status_code');
  });

  it('discovers service metadata from traces/logs/metrics', () => {
    const result = discoverServices({
      services: ['checkout', 'payment'],
      traces,
      logs,
      metrics,
    });

    const checkout = result.find((item) => item.name === 'checkout');
    const payment = result.find((item) => item.name === 'payment');

    expect(checkout?.signals.metrics).toBe(true);
    expect(checkout?.languages).toContain('nodejs');

    expect(payment?.signals.logs).toBe(true);
    expect(payment?.stats.errorSpans).toBe(1);
    expect(payment?.logSeverities).toContain('ERROR');
  });
});
