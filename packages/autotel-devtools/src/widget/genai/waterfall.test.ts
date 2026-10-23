import { describe, it, expect } from 'vitest';
import type { TraceNode } from './trace';
import {
  axisFor,
  descendantCount,
  hasRunning,
  LIVE_QUIET_MS,
  runningParents,
  slowestId,
  visibleRows,
  workSegments,
} from './waterfall';

function node(
  id: string,
  extra: Partial<TraceNode> = {},
  children: TraceNode[] = [],
): TraceNode {
  return { id, kind: 'step', label: id, depth: 0, children, ...extra };
}

const run = [
  node('agent', { kind: 'agent', startMs: 1000, durationMs: 7000 }, [
    node('plan', { startMs: 1000, durationMs: 2000 }, [
      node('text', { kind: 'text' }),
    ]),
    node('search', { kind: 'tool', startMs: 3200, durationMs: 4500 }),
  ]),
];

describe('axisFor', () => {
  it('starts at the first span and rounds the width up to a tick', () => {
    const axis = axisFor(run, 0)!;
    expect(axis.t0).toBe(1000);
    expect(axis.ticks[0]).toBe(0);
    expect(axis.spanMs).toBeGreaterThanOrEqual(7000);
    expect(axis.ticks.at(-1)).toBe(axis.spanMs);
  });

  it('stretches to now while a parent is running', () => {
    const live = [node('r', { kind: 'running', startMs: 1000 })];
    expect(axisFor(live, 1000 + 12_345)!.spanMs).toBeGreaterThanOrEqual(12_345);
  });

  it('has nothing to draw without timing', () => {
    expect(axisFor([node('t', { kind: 'text' })], 0)).toBeUndefined();
  });
});

describe('visibleRows', () => {
  it('walks depth first and hides what a collapsed row holds', () => {
    expect(visibleRows(run, new Set()).map((n) => n.id)).toEqual([
      'agent',
      'plan',
      'text',
      'search',
    ]);
    expect(visibleRows(run, new Set(['agent'])).map((n) => n.id)).toEqual([
      'agent',
    ]);
  });
});

describe('workSegments and descendantCount', () => {
  it('draws the timed work under a fold, not its containers', () => {
    expect(workSegments(run[0]).map((n) => n.id)).toEqual(['plan', 'search']);
    expect(descendantCount(run[0])).toBe(3);
  });
});

describe('slowestId', () => {
  it('names the longest model call or tool', () => {
    expect(slowestId(run)).toBe('search');
  });

  it('says nothing with a single candidate', () => {
    expect(
      slowestId([node('only', { startMs: 0, durationMs: 5 })]),
    ).toBeUndefined();
  });
});

describe('runningParents', () => {
  const trace = (endTime: number, parent: string) => ({
    endTime,
    spans: [{ spanId: `${parent}-child`, parentSpanId: parent }],
  });

  it('treats a missing parent as running while its trace is producing spans', () => {
    expect(
      runningParents([trace(10_000, 'p')], 10_000 + LIVE_QUIET_MS),
    ).toEqual(new Set(['p']));
  });

  it('stops once the trace has gone quiet', () => {
    expect(runningParents([trace(0, 'p')], LIVE_QUIET_MS + 1).size).toBe(0);
  });

  it('judges each trace on its own, so a new turn does not revive an old one', () => {
    const now = 200_000;
    expect(
      runningParents([trace(0, 'old'), trace(now - 1000, 'new')], now),
    ).toEqual(new Set(['new']));
  });

  it('finds a running node anywhere in the tree', () => {
    expect(hasRunning(run)).toBe(false);
    expect(hasRunning([node('x', {}, [node('r', { kind: 'running' })])])).toBe(
      true,
    );
  });
});
