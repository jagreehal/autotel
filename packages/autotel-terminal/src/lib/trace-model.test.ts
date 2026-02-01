import { describe, it, expect } from 'vitest';
import {
  buildTraceMap,
  buildTraceSummaries,
  buildTraceTree,
  flattenTraceTree,
  sortSpansForWaterfall,
  filterBySearch,
  filterTraceSummaries,
  computeStats,
  computePerSpanNameStats,
} from './trace-model';
import type { TerminalSpanEvent } from '../span-stream';

function span(
  overrides: Partial<TerminalSpanEvent> & {
    spanId: string;
    traceId: string;
    name: string;
  },
): TerminalSpanEvent {
  return {
    name: overrides.name,
    spanId: overrides.spanId,
    traceId: overrides.traceId,
    parentSpanId: overrides.parentSpanId,
    startTime: overrides.startTime ?? 0,
    endTime: overrides.endTime ?? 100,
    durationMs: overrides.durationMs ?? 100,
    status: overrides.status ?? 'OK',
    kind: overrides.kind,
    attributes: overrides.attributes,
  };
}

describe('buildTraceMap', () => {
  it('groups spans by traceId', () => {
    const spans = [
      span({ spanId: 'a', traceId: 't1', name: 'root' }),
      span({ spanId: 'b', traceId: 't1', parentSpanId: 'a', name: 'child' }),
      span({ spanId: 'c', traceId: 't2', name: 'root2' }),
    ];
    const map = buildTraceMap(spans, 10);
    expect(map.size).toBe(2);
    expect(map.get('t1')).toHaveLength(2);
    expect(map.get('t2')).toHaveLength(1);
  });

  it('limits to maxTraces', () => {
    const spans = [
      span({ spanId: '1', traceId: 't1', name: 'a', endTime: 100 }),
      span({ spanId: '2', traceId: 't2', name: 'b', endTime: 200 }),
      span({ spanId: '3', traceId: 't3', name: 'c', endTime: 300 }),
    ];
    const map = buildTraceMap(spans, 2);
    expect(map.size).toBe(2);
    expect(map.has('t3')).toBe(true);
    expect(map.has('t2')).toBe(true);
    expect(map.has('t1')).toBe(false);
  });
});

describe('buildTraceSummaries', () => {
  it('computes root name and duration', () => {
    const map = new Map<string, TerminalSpanEvent[]>([
      [
        't1',
        [
          span({ spanId: 'a', traceId: 't1', name: 'root', durationMs: 50 }),
          span({ spanId: 'b', traceId: 't1', parentSpanId: 'a', name: 'child', durationMs: 20 }),
        ],
      ],
    ]);
    const summaries = buildTraceSummaries(map);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.rootName).toBe('root');
    expect(summaries[0]!.durationMs).toBe(50);
    expect(summaries[0]!.spanCount).toBe(2);
    expect(summaries[0]!.hasError).toBe(false);
  });

  it('sets hasError when any span is ERROR', () => {
    const map = new Map<string, TerminalSpanEvent[]>([
      [
        't1',
        [
          span({ spanId: 'a', traceId: 't1', name: 'root', status: 'OK' }),
          span({ spanId: 'b', traceId: 't1', parentSpanId: 'a', name: 'child', status: 'ERROR' }),
        ],
      ],
    ]);
    const summaries = buildTraceSummaries(map);
    expect(summaries[0]!.hasError).toBe(true);
  });
});

describe('buildTraceTree', () => {
  it('builds root and children', () => {
    const spans = [
      span({ spanId: 'a', traceId: 't1', name: 'root' }),
      span({ spanId: 'b', traceId: 't1', parentSpanId: 'a', name: 'child1' }),
      span({ spanId: 'c', traceId: 't1', parentSpanId: 'a', name: 'child2' }),
    ];
    const tree = buildTraceTree(spans);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.span.name).toBe('root');
    expect(tree[0]!.children).toHaveLength(2);
    expect(tree[0]!.children.map((n) => n.span.name).toSorted()).toEqual(['child1', 'child2']);
  });

  it('assigns depth', () => {
    const spans = [
      span({ spanId: 'a', traceId: 't1', name: 'root' }),
      span({ spanId: 'b', traceId: 't1', parentSpanId: 'a', name: 'child' }),
      span({ spanId: 'c', traceId: 't1', parentSpanId: 'b', name: 'grandchild' }),
    ];
    const flat = flattenTraceTree(buildTraceTree(spans));
    expect(flat[0]!.depth).toBe(0);
    expect(flat[1]!.depth).toBe(1);
    expect(flat[2]!.depth).toBe(2);
  });
});

describe('sortSpansForWaterfall', () => {
  it('sorts by startTime then depth', () => {
    const spans = [
      span({ spanId: 'a', traceId: 't1', name: 'root', startTime: 0, endTime: 100 }),
      span({ spanId: 'b', traceId: 't1', parentSpanId: 'a', name: 'c1', startTime: 10, endTime: 50 }),
      span({ spanId: 'c', traceId: 't1', parentSpanId: 'a', name: 'c2', startTime: 60, endTime: 90 }),
    ];
    const sorted = sortSpansForWaterfall(spans);
    expect(sorted.map((s) => s.span.name)).toEqual(['root', 'c1', 'c2']);
    expect(sorted[0]!.depth).toBe(0);
    expect(sorted[1]!.depth).toBe(1);
    expect(sorted[2]!.depth).toBe(1);
  });
});

describe('filterBySearch', () => {
  it('filters by substring on name', () => {
    const spans = [
      span({ spanId: 'a', traceId: 't1', name: 'fetchUser' }),
      span({ spanId: 'b', traceId: 't1', name: 'createOrder' }),
    ];
    expect(filterBySearch(spans, 'User', false)).toHaveLength(1);
    expect(filterBySearch(spans, 'fetch', false)).toHaveLength(1);
    expect(filterBySearch(spans, '', false)).toHaveLength(2);
  });

  it('combines with errorsOnly', () => {
    const spans = [
      span({ spanId: 'a', traceId: 't1', name: 'fetchUser', status: 'ERROR' }),
      span({ spanId: 'b', traceId: 't1', name: 'createOrder', status: 'OK' }),
    ];
    expect(filterBySearch(spans, 'User', true)).toHaveLength(1);
    expect(filterBySearch(spans, 'Order', true)).toHaveLength(0);
  });
});

describe('filterTraceSummaries', () => {
  it('filters by search on any span name', () => {
    const summaries = buildTraceSummaries(
      new Map([
        [
          't1',
          [
            span({ spanId: 'a', traceId: 't1', name: 'fetchUser' }),
            span({ spanId: 'b', traceId: 't1', parentSpanId: 'a', name: 'dbQuery' }),
          ],
        ],
      ]),
    );
    expect(filterTraceSummaries(summaries, 'User', false)).toHaveLength(1);
    expect(filterTraceSummaries(summaries, 'db', false)).toHaveLength(1);
    expect(filterTraceSummaries(summaries, 'xyz', false)).toHaveLength(0);
  });
});

describe('computeStats', () => {
  it('computes total, errors, avg, p95', () => {
    const spans = [
      span({ spanId: 'a', traceId: 't1', name: 'a', durationMs: 100, status: 'OK' }),
      span({ spanId: 'b', traceId: 't1', name: 'b', durationMs: 200, status: 'OK' }),
      span({ spanId: 'c', traceId: 't1', name: 'c', durationMs: 300, status: 'ERROR' }),
    ];
    const st = computeStats(spans);
    expect(st.total).toBe(3);
    expect(st.errors).toBe(1);
    expect(st.avg).toBe(200);
    expect(st.p95).toBe(300);
  });
});

describe('computePerSpanNameStats', () => {
  it('computes per-name count and avgMs', () => {
    const spans = [
      span({ spanId: 'a', traceId: 't1', name: 'fetchUser', durationMs: 100 }),
      span({ spanId: 'b', traceId: 't1', name: 'fetchUser', durationMs: 200 }),
      span({ spanId: 'c', traceId: 't1', name: 'createOrder', durationMs: 50 }),
    ];
    const per = computePerSpanNameStats(spans);
    expect(per.byName.get('fetchUser')).toEqual({ count: 2, totalMs: 300, avgMs: 150 });
    expect(per.byName.get('createOrder')).toEqual({ count: 1, totalMs: 50, avgMs: 50 });
  });
});
