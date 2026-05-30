import { describe, it, expect } from 'vitest';
import { computeSelfTime, computeCriticalPath } from '../utils/spanAnalysis';
import type { SpanData } from '../types';

function span(p: Partial<SpanData> & { spanId: string }): SpanData {
  const startTime = p.startTime ?? 0;
  const endTime = p.endTime ?? startTime + (p.duration ?? 0);
  return {
    traceId: 't1',
    spanId: p.spanId,
    parentSpanId: p.parentSpanId,
    name: p.name ?? p.spanId,
    kind: 'INTERNAL',
    startTime,
    endTime,
    duration: p.duration ?? endTime - startTime,
    attributes: {},
    status: { code: p.status?.code ?? 'OK' },
  };
}

describe('computeSelfTime', () => {
  it('equals duration for a leaf span', () => {
    const s = span({ spanId: 'a', startTime: 0, endTime: 100 });
    expect(computeSelfTime(s, [])).toBe(100);
  });

  it('subtracts a single child interval', () => {
    const parent = span({ spanId: 'p', startTime: 0, endTime: 100 });
    const child = span({ spanId: 'c', startTime: 20, endTime: 90 });
    expect(computeSelfTime(parent, [child])).toBe(30); // 100 - 70
  });

  it('unions overlapping children (no double counting)', () => {
    const parent = span({ spanId: 'p', startTime: 0, endTime: 100 });
    const c1 = span({ spanId: 'c1', startTime: 10, endTime: 60 });
    const c2 = span({ spanId: 'c2', startTime: 40, endTime: 80 });
    // union covered = [10,80] = 70 → self = 30
    expect(computeSelfTime(parent, [c1, c2])).toBe(30);
  });

  it('clamps children to the parent window and never goes negative', () => {
    const parent = span({ spanId: 'p', startTime: 0, endTime: 50 });
    const child = span({ spanId: 'c', startTime: -20, endTime: 200 });
    expect(computeSelfTime(parent, [child])).toBe(0);
  });
});

describe('computeCriticalPath', () => {
  it('follows the latest-finishing child from the root', () => {
    const spans = [
      span({ spanId: 'root', startTime: 0, endTime: 100 }),
      span({ spanId: 'fast', parentSpanId: 'root', startTime: 0, endTime: 30 }),
      span({ spanId: 'slow', parentSpanId: 'root', startTime: 0, endTime: 95 }),
      span({ spanId: 'leaf', parentSpanId: 'slow', startTime: 10, endTime: 90 }),
    ];
    const path = computeCriticalPath(spans);
    expect([...path].sort()).toEqual(['leaf', 'root', 'slow']);
    expect(path.has('fast')).toBe(false);
  });

  it('handles orphan spans as roots without infinite loops', () => {
    const spans = [
      span({ spanId: 'orphan', parentSpanId: 'missing', startTime: 0, endTime: 50 }),
    ];
    expect(computeCriticalPath(spans).has('orphan')).toBe(true);
  });

  it('returns empty set for no spans', () => {
    expect(computeCriticalPath([]).size).toBe(0);
  });
});
