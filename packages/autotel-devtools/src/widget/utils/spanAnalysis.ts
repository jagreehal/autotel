import type { SpanData } from '../types';

/**
 * Self time = the span's own duration minus the wall-clock time covered by its
 * direct children. Children intervals are unioned (clipped to the parent), so
 * overlapping/concurrent children are not double-counted. This isolates the
 * time actually spent in the span itself vs. waiting on children — the key
 * signal for "where did the latency really go".
 */
export function computeSelfTime(span: SpanData, children: SpanData[]): number {
  if (children.length === 0) return span.duration;

  const intervals = children
    .map(
      (c) =>
        [
          Math.max(c.startTime, span.startTime),
          Math.min(c.endTime, span.endTime),
        ] as [number, number],
    )
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  let covered = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const [s, e] of intervals) {
    if (s > curEnd) {
      if (curEnd > curStart) covered += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd > curStart) covered += curEnd - curStart;

  return Math.max(0, span.duration - covered);
}

/**
 * Span IDs on the trace's critical path — the chain that determines total
 * latency. Starts from the latest-finishing root and descends to the
 * latest-finishing child at each step. Highlighting it points straight at the
 * bottleneck instead of making the user eyeball the waterfall.
 */
export function computeCriticalPath(spans: SpanData[]): Set<string> {
  const path = new Set<string>();
  if (spans.length === 0) return path;

  const byId = new Map<string, SpanData>();
  for (const s of spans) byId.set(s.spanId, s);

  const childrenOf = new Map<string, SpanData[]>();
  for (const s of spans) {
    // Orphans (unknown parent) are treated as roots under the '' key.
    const key =
      s.parentSpanId && byId.has(s.parentSpanId) ? s.parentSpanId : '';
    const list = childrenOf.get(key);
    if (list) list.push(s);
    else childrenOf.set(key, [s]);
  }

  const roots = childrenOf.get('') ?? [];
  if (roots.length === 0) return path;

  const latest = (nodes: SpanData[]) =>
    nodes.reduce((a, b) => (b.endTime > a.endTime ? b : a));

  let cur: SpanData | undefined = latest(roots);
  while (cur && !path.has(cur.spanId)) {
    path.add(cur.spanId);
    const kids = childrenOf.get(cur.spanId);
    cur = kids && kids.length ? latest(kids) : undefined;
  }
  return path;
}
