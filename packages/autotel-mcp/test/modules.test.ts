import { describe, expect, it } from 'vitest';
import { buildCapabilitiesDocument } from '../src/modules/capabilities';
import { validateOtlpReceiverConfig } from '../src/modules/collector-config';
import {
  rankExpensiveTraces,
  rankSlowTraces,
} from '../src/modules/llm-analytics';
import {
  scoreSpan,
  suggestInstrumentationFixes,
} from '../src/modules/instrumentation';
import {
  spanMatchesQuery,
  traceMatchesQuery,
} from '../src/modules/query-filters';
import { buildServiceMap } from '../src/modules/service-map';
import { summarizeTrace } from '../src/modules/trace-summary';

describe('collector validation', () => {
  it('accepts a minimal OTLP receiver config', () => {
    const result = validateOtlpReceiverConfig({
      protocols: {
        grpc: { endpoint: '0.0.0.0:4317' },
        http: { endpoint: '0.0.0.0:4318' },
      },
    });
    expect(result.valid).toBe(true);
  });
});

describe('capabilities', () => {
  it('lists the expected transport modes and core groups', () => {
    const doc = buildCapabilitiesDocument('best-otel-mcp');
    expect(doc.transportModes).toEqual(['stdio', 'http', 'sse']);
    expect(doc.groups.map((group) => group.name)).toEqual([
      'investigation',
      'signals',
      'collector',
      'instrumentation',
    ]);
  });
});

describe('instrumentation scoring', () => {
  it('scores spans and suggests fixes', () => {
    const result = scoreSpan({
      operationName: 'checkout.payment',
      serviceName: 'checkout',
      hasError: true,
      tags: { 'http.method': 'GET' },
    });
    expect(result.score).toBeLessThan(100);
    expect(
      suggestInstrumentationFixes({
        operationName: 'checkout.payment',
        serviceName: 'checkout',
        hasError: true,
        tags: { 'http.method': 'GET' },
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe('trace and service summaries', () => {
  const trace = {
    traceId: 'trace-1',
    serviceName: 'checkout',
    startTimeUnixMs: 1,
    durationMs: 300,
    statusCode: 'ERROR',
    spans: [
      {
        traceId: 'trace-1',
        spanId: 'root',
        operationName: 'checkout.request',
        serviceName: 'checkout',
        startTimeUnixMs: 1,
        durationMs: 300,
        tags: { 'http.method': 'GET', 'trace.id': 'trace-1' },
        hasError: false,
        statusCode: 'OK',
      },
      {
        traceId: 'trace-1',
        spanId: 'child',
        parentSpanId: 'root',
        operationName: 'checkout.payment',
        serviceName: 'payment',
        startTimeUnixMs: 5,
        durationMs: 120,
        tags: { 'db.system': 'postgresql', 'trace.id': 'trace-1' },
        hasError: true,
        statusCode: 'ERROR',
      },
    ],
  } as const;

  it('summarizes traces', () => {
    const summary = summarizeTrace(trace);
    expect(summary.spanCount).toBe(2);
    expect(summary.errorSpanCount).toBe(1);
  });

  it('derives summary fields from spans when trace-level fields are absent', () => {
    const summary = summarizeTrace({
      traceId: 'trace-2',
      spans: [
        {
          traceId: 'trace-2',
          spanId: 'root',
          parentSpanId: null,
          operationName: 'checkout.request',
          serviceName: 'checkout',
          startTimeUnixMs: 10,
          durationMs: 300,
          statusCode: 'OK',
          tags: {},
          hasError: false,
        },
        {
          traceId: 'trace-2',
          spanId: 'child',
          parentSpanId: 'root',
          operationName: 'checkout.payment',
          serviceName: 'payment',
          startTimeUnixMs: 20,
          durationMs: 120,
          statusCode: 'ERROR',
          tags: {},
          hasError: true,
        },
      ],
    } as const);

    expect(summary.serviceName).toBe('checkout');
    expect(summary.durationMs).toBe(300);
    expect(summary.statusCode).toBe('ERROR');
  });

  it('derives llm ranking fields from spans when trace-level fields are absent', () => {
    const traces = [
      {
        traceId: 'trace-3',
        spans: [
          {
            traceId: 'trace-3',
            spanId: 'root',
            parentSpanId: null,
            operationName: 'checkout.request',
            serviceName: 'checkout',
            startTimeUnixMs: 10,
            durationMs: 300,
            statusCode: 'OK',
            tags: {
              'gen_ai.request.model': 'gpt-4',
              'gen_ai.usage.total_tokens': 100,
            },
            hasError: false,
          },
        ],
      },
    ] as const;

    const expensive = rankExpensiveTraces(traces as unknown as typeof traces);
    const slow = rankSlowTraces(traces as unknown as typeof traces);

    expect(expensive[0]?.serviceName).toBe('checkout');
    expect(expensive[0]?.startTimeUnixMs).toBe(10);
    expect(expensive[0]?.durationMs).toBe(300);
    expect(expensive[0]?.status).toBe('OK');

    expect(slow[0]?.serviceName).toBe('checkout');
    expect(slow[0]?.startTimeUnixMs).toBe(10);
    expect(slow[0]?.durationMs).toBe(300);
    expect(slow[0]?.status).toBe('OK');
  });

  it('builds service maps', () => {
    const map = buildServiceMap([trace]);
    expect(map.nodes.length).toBe(2);
    expect(map.edges.length).toBe(1);
    expect(map.edges[0]?.source).toBe('checkout');
    expect(map.edges[0]?.target).toBe('payment');
    expect(
      map.nodes.find((node) => node.service === 'checkout')?.outboundCalls,
    ).toBe(1);
    expect(
      map.nodes.find((node) => node.service === 'payment')?.inboundCalls,
    ).toBe(1);
  });

  it('respects the service map limit', () => {
    const map = buildServiceMap([trace], 1);
    expect(map.nodes.length).toBeLessThanOrEqual(1);
  });

  it('filters traces and spans by status and tags', () => {
    expect(
      traceMatchesQuery(trace, {
        statusCode: 'ERROR',
        tags: { 'db.system': 'postgresql' },
      }),
    ).toBe(true);

    expect(
      spanMatchesQuery(trace.spans[1]!, {
        statusCode: 'ERROR',
        minDurationMs: 100,
        tags: { 'db.system': 'postgresql' },
      }),
    ).toBe(true);

    expect(
      spanMatchesQuery(trace.spans[0]!, {
        statusCode: 'ERROR',
      }),
    ).toBe(false);
  });

  it('filters traces by derived duration when trace-level fields are absent', () => {
    const spanOnlyTrace = {
      traceId: 'trace-4',
      spans: [
        {
          traceId: 'trace-4',
          spanId: 'root',
          parentSpanId: null,
          operationName: 'checkout.request',
          serviceName: 'checkout',
          startTimeUnixMs: 1,
          durationMs: 300,
          statusCode: 'OK',
          tags: {},
          hasError: false,
        },
        {
          traceId: 'trace-4',
          spanId: 'child',
          parentSpanId: 'root',
          operationName: 'checkout.payment',
          serviceName: 'payment',
          startTimeUnixMs: 20,
          durationMs: 120,
          statusCode: 'ERROR',
          tags: {},
          hasError: true,
        },
      ],
    } as const;

    expect(
      traceMatchesQuery(spanOnlyTrace, {
        maxDurationMs: 250,
      }),
    ).toBe(false);
  });

  it('supports aggregate trace filters like span_count', () => {
    const spanOnlyTrace = {
      traceId: 'trace-5',
      spans: [
        {
          traceId: 'trace-5',
          spanId: 'root',
          parentSpanId: null,
          operationName: 'checkout.request',
          serviceName: 'checkout',
          startTimeUnixMs: 1,
          durationMs: 300,
          statusCode: 'OK',
          tags: {},
          hasError: false,
        },
        {
          traceId: 'trace-5',
          spanId: 'child',
          parentSpanId: 'root',
          operationName: 'checkout.payment',
          serviceName: 'payment',
          startTimeUnixMs: 20,
          durationMs: 120,
          statusCode: 'ERROR',
          tags: {},
          hasError: true,
        },
      ],
    } as const;

    expect(
      traceMatchesQuery(spanOnlyTrace, {
        filters: [
          {
            field: 'span_count',
            operator: 'equals',
            valueType: 'number',
            value: 2,
          },
        ],
      }),
    ).toBe(true);
  });

  it('supports aggregate trace filters together with service filters', () => {
    const spanOnlyTrace = {
      traceId: 'trace-6',
      spans: [
        {
          traceId: 'trace-6',
          spanId: 'root',
          parentSpanId: null,
          operationName: 'checkout.request',
          serviceName: 'checkout',
          startTimeUnixMs: 1,
          durationMs: 300,
          statusCode: 'OK',
          tags: {},
          hasError: false,
        },
        {
          traceId: 'trace-6',
          spanId: 'child',
          parentSpanId: 'root',
          operationName: 'checkout.payment',
          serviceName: 'payment',
          startTimeUnixMs: 20,
          durationMs: 120,
          statusCode: 'ERROR',
          tags: {},
          hasError: true,
        },
      ],
    } as const;

    expect(
      traceMatchesQuery(spanOnlyTrace, {
        service: 'checkout',
        filters: [
          {
            field: 'span_count',
            operator: 'equals',
            valueType: 'number',
            value: 2,
          },
        ],
      }),
    ).toBe(true);
  });
});
