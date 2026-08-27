import { describe, it, expect } from 'vitest';
import {
  compactSpans,
  compactTrace,
  compactTraceResult,
} from './trace-payload';
import type { SpanRecord, TraceRecord } from '../types';

function span(
  spanId: string,
  parentSpanId: string | null,
  tags: Record<string, string>,
): SpanRecord {
  return {
    traceId: 't1',
    spanId,
    parentSpanId,
    operationName: parentSpanId === null ? 'GET /feed' : 'drizzle.select',
    serviceName: 'evidence-loop',
    startTimeUnixMs: 0,
    durationMs: 1,
    statusCode: 'OK',
    tags,
    hasError: false,
  };
}

// Every span in a real trace repeats the resource attributes verbatim.
const RESOURCE = {
  'service.name': 'evidence-loop',
  'process.command_args': '/very/long/node,--import,tsx,src/index.ts,broken',
};

function trace(): TraceRecord {
  return {
    traceId: 't1',
    spans: [
      span('root', null, { ...RESOURCE }),
      span('a', 'root', { ...RESOURCE, 'db.collection.name': 'posts' }),
      span('b', 'root', { ...RESOURCE, 'db.collection.name': 'comments' }),
    ],
  };
}

const result = () => ({ items: [trace()], totalCount: 1 });

describe('compactTraceResult()', () => {
  it('returns roots only when nothing is asked for', () => {
    // Scanning is the common case and a single N+1 trace carries hundreds of
    // spans, so the default has to be the one that cannot blow the limit.
    const out = compactTraceResult(result());

    expect(out.items[0]?.spans.map((s) => s.spanId)).toEqual(['root']);
  });

  it('keeps every span when they are asked for', () => {
    const out = compactTraceResult(result(), { includeSpans: true });

    expect(out.items[0]?.spans).toHaveLength(3);
  });

  it('keeps only root spans when spans are excluded', () => {
    const out = compactTraceResult(result(), { includeSpans: false });

    expect(out.items[0]?.spans.map((s) => s.spanId)).toEqual(['root']);
  });

  it('still reports the real span count when spans are excluded', () => {
    const out = compactTraceResult(result(), { includeSpans: false });

    expect(out.items[0]?.spanCount).toBe(3);
  });

  it('hoists attributes that every span repeats', () => {
    const out = compactTraceResult(result(), { includeSpans: true });

    expect(out.items[0]?.resource['process.command_args']).toBe(
      '/very/long/node,--import,tsx,src/index.ts,broken',
    );
    expect(
      out.items[0]?.spans[1]?.tags['process.command_args'],
    ).toBeUndefined();
  });

  it('leaves attributes that differ between spans on the spans', () => {
    const out = compactTraceResult(result(), { includeSpans: true });

    expect(out.items[0]?.resource['db.collection.name']).toBeUndefined();
    expect(out.items[0]?.spans[1]?.tags['db.collection.name']).toBe('posts');
  });
});

describe('compactTrace()', () => {
  it('hoists the attributes every span repeats', () => {
    const out = compactTrace(trace());

    expect(out.resource['process.command_args']).toBe(
      '/very/long/node,--import,tsx,src/index.ts,broken',
    );
    expect(out.spans[1]?.tags['process.command_args']).toBeUndefined();
  });

  it('keeps the per-span attributes', () => {
    const out = compactTrace(trace());

    expect(out.spans[1]?.tags['db.collection.name']).toBe('posts');
  });
});

describe('compactSpans()', () => {
  it('hoists the attributes every returned span repeats', () => {
    const out = compactSpans({ items: trace().spans, totalCount: 3 });

    expect(out.resource['service.name']).toBe('evidence-loop');
    expect(out.items[1]?.tags['service.name']).toBeUndefined();
  });

  it('leaves attributes that only some spans carry', () => {
    const out = compactSpans({ items: trace().spans, totalCount: 3 });

    expect(out.items[1]?.tags['db.collection.name']).toBe('posts');
  });
});
