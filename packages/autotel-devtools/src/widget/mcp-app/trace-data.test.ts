import { describe, expect, it } from 'vitest';
import {
  toTraceData,
  traceFromToolResult,
  type McpSpan,
  type McpTrace,
} from './trace-data';

function span(overrides: Partial<McpSpan>): McpSpan {
  return {
    traceId: 't1',
    spanId: 's1',
    parentSpanId: null,
    operationName: 'GET /orders',
    serviceName: 'api',
    startTimeUnixMs: 1000,
    durationMs: 100,
    statusCode: 'OK',
    tags: {},
    hasError: false,
    ...overrides,
  };
}

const trace: McpTrace = {
  traceId: 't1',
  resource: { 'service.name': 'api', 'host.name': 'box' },
  spanCount: 2,
  spans: [
    span({
      spanId: 'child',
      parentSpanId: 's1',
      operationName: 'db.query',
      startTimeUnixMs: 1020,
      durationMs: 120,
      statusCode: 'ERROR',
      tags: { 'span.kind': 'client', 'exception.message': 'timeout' },
    }),
    span({ tags: { 'span.kind': 'server' } }),
  ],
};

describe('toTraceData', () => {
  it('builds the waterfall trace from get_trace spans', () => {
    const data = toTraceData(trace);

    expect(data).toMatchObject({
      traceId: 't1',
      service: 'api',
      startTime: 1000,
      endTime: 1140,
      duration: 140,
      status: 'ERROR',
    });
    expect(data?.partial).toBeUndefined();
    expect(data?.rootSpan.spanId).toBe('s1');
    expect(data?.spans.map((s) => s.spanId)).toEqual(['s1', 'child']);
  });

  it('puts the hoisted resource back on every span', () => {
    const child = toTraceData(trace)?.spans[1];

    expect(child).toMatchObject({
      parentSpanId: 's1',
      kind: 'CLIENT',
      status: { code: 'ERROR', message: 'timeout' },
      attributes: { 'host.name': 'box', 'service.name': 'api' },
    });
  });

  it('reads kind and error message hoisted into the resource', () => {
    const data = toTraceData({
      traceId: 't1',
      resource: { 'span.kind': 'server', 'exception.message': 'db down' },
      spanCount: 2,
      spans: [
        span({ statusCode: 'ERROR' }),
        span({ spanId: 's2', parentSpanId: 's1', statusCode: 'ERROR' }),
      ],
    });

    for (const s of data?.spans ?? []) {
      expect(s.kind).toBe('SERVER');
      expect(s.status).toEqual({ code: 'ERROR', message: 'db down' });
    }
  });

  it('marks a trace with no root as partial', () => {
    const data = toTraceData({
      ...trace,
      spans: [span({ parentSpanId: 'missing' })],
    });

    expect(data?.partial).toBe(true);
    expect(data?.rootSpan.spanId).toBe('s1');
  });

  it('draws a trace too large to spread into function arguments', () => {
    const spans = Array.from({ length: 200_000 }, (_, i) =>
      span({ spanId: `s${i}`, parentSpanId: i === 0 ? null : 's0' }),
    );

    expect(toTraceData({ ...trace, spans })?.spans).toHaveLength(200_000);
  });

  it('returns null for a trace with no spans', () => {
    expect(toTraceData({ ...trace, spans: [] })).toBeNull();
  });
});

describe('traceFromToolResult', () => {
  it('reads the JSON envelope in the text content', () => {
    const text = JSON.stringify({ ok: true, data: trace });

    expect(traceFromToolResult({ content: [{ type: 'text', text }] })).toEqual(
      trace,
    );
  });

  it('prefers structuredContent', () => {
    expect(traceFromToolResult({ structuredContent: { ...trace } })).toEqual(
      trace,
    );
  });

  it('returns undefined for an error, a missing trace or non-JSON text', () => {
    expect(traceFromToolResult({ isError: true })).toBeUndefined();
    expect(
      traceFromToolResult({
        content: [{ type: 'text', text: '{"ok":true,"data":null}' }],
      }),
    ).toBeUndefined();
    expect(
      traceFromToolResult({ content: [{ type: 'text', text: 'not json' }] }),
    ).toBeUndefined();
  });
});
