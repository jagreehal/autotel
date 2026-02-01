/**
 * Trace model utilities - pure logic for trace grouping, tree building, and filtering.
 * Kept in lib/ for testability; no React or Ink.
 */

import type { TerminalSpanEvent } from '../span-stream';

/** Trace summary for the "Recent traces" list */
export interface TraceSummary {
  traceId: string;
  rootName: string;
  durationMs: number;
  hasError: boolean;
  spanCount: number;
  lastEndTime: number;
  spans: TerminalSpanEvent[];
}

/** Tree node for indented span tree (parent/child) */
export interface SpanTreeNode {
  span: TerminalSpanEvent;
  depth: number;
  children: SpanTreeNode[];
}

/** Span with depth for waterfall (sorted by startTime, then depth) */
export interface SpanWithDepth {
  span: TerminalSpanEvent;
  depth: number;
}

/** Aggregate stats over spans */
export interface SpanStats {
  total: number;
  errors: number;
  avg: number;
  p95: number;
}

/** Per-span-name stats for "3x slower than average" */
export interface PerSpanNameStats {
  byName: Map<string, { count: number; totalMs: number; avgMs: number }>;
}

/**
 * Build a map traceId -> spans[] from a flat list of spans.
 * Traces are ordered by most recent span end time (latest first).
 */
export function buildTraceMap(
  spans: TerminalSpanEvent[],
  maxTraces = 50,
): Map<string, TerminalSpanEvent[]> {
  const byTrace = new Map<string, TerminalSpanEvent[]>();
  for (const s of spans) {
    const list = byTrace.get(s.traceId) ?? [];
    list.push(s);
    byTrace.set(s.traceId, list);
  }
  // Sort traces by latest span end time (desc)
  const entries = [...byTrace.entries()].toSorted((a, b) => {
    const maxA = Math.max(...a[1].map((x) => x.endTime));
    const maxB = Math.max(...b[1].map((x) => x.endTime));
    return maxB - maxA;
  });
  const limited = entries.slice(0, maxTraces);
  return new Map(limited);
}

/**
 * Build a trace summary for the "Recent traces" list.
 * Root = span with no parentSpanId or parent not in this trace; duration = root duration or max end - min start.
 */
export function buildTraceSummaries(
  traceMap: Map<string, TerminalSpanEvent[]>,
): TraceSummary[] {
  const summaries: TraceSummary[] = [];
  for (const [traceId, traceSpans] of traceMap) {
    const spanIds = new Set(traceSpans.map((s) => s.spanId));
    const root =
      traceSpans.find((s) => !s.parentSpanId || !spanIds.has(s.parentSpanId)) ??
      traceSpans[0];
    const durationMs = root ? root.durationMs : 0;
    const hasError = traceSpans.some((s) => s.status === 'ERROR');
    const lastEndTime = Math.max(...traceSpans.map((s) => s.endTime));
    summaries.push({
      traceId,
      rootName: root?.name ?? 'unknown',
      durationMs,
      hasError,
      spanCount: traceSpans.length,
      lastEndTime,
      spans: traceSpans,
    });
  }
  return summaries;
}

/**
 * Build a parent-child tree from spans of one trace.
 * Root = span with no parentSpanId (or parent not in list); children by parentSpanId.
 */
export function buildTraceTree(spans: TerminalSpanEvent[]): SpanTreeNode[] {
  const byId = new Map<string, TerminalSpanEvent>();
  for (const s of spans) {
    byId.set(s.spanId, s);
  }
  const roots: SpanTreeNode[] = [];

  function addNode(span: TerminalSpanEvent, depth: number): SpanTreeNode {
    const children = spans
      .filter((s) => s.parentSpanId === span.spanId)
      .map((s) => addNode(s, depth + 1));
    return { span, depth, children };
  }

  const rootSpans = spans.filter(
    (s) => !s.parentSpanId || !byId.has(s.parentSpanId),
  );
  for (const s of rootSpans) {
    roots.push(addNode(s, 0));
  }
  return roots;
}

/**
 * Flatten tree to list for display (pre-order: root, then children).
 */
export function flattenTraceTree(nodes: SpanTreeNode[]): SpanTreeNode[] {
  const out: SpanTreeNode[] = [];
  function walk(n: SpanTreeNode) {
    out.push(n);
    for (const c of n.children) walk(c);
  }
  for (const n of nodes) walk(n);
  return out;
}

/**
 * Sort spans for waterfall: by startTime, then by depth (parent before children at same time).
 */
export function sortSpansForWaterfall(spans: TerminalSpanEvent[]): SpanWithDepth[] {
  const byId = new Map<string, TerminalSpanEvent>();
  for (const s of spans) byId.set(s.spanId, s);

  function depth(s: TerminalSpanEvent): number {
    if (!s.parentSpanId || !byId.has(s.parentSpanId)) return 0;
    const parent = byId.get(s.parentSpanId)!;
    return 1 + depth(parent);
  }

  const withDepth = spans.map((s) => ({ span: s, depth: depth(s) }));
  withDepth.sort((a, b) => {
    if (a.span.startTime !== b.span.startTime) return a.span.startTime - b.span.startTime;
    return a.depth - b.depth;
  });
  return withDepth;
}

/**
 * Filter spans by search query (substring match on name) and optional errors-only.
 */
export function filterBySearch(
  spans: TerminalSpanEvent[],
  searchQuery: string,
  errorsOnly: boolean,
): TerminalSpanEvent[] {
  let list = spans;
  if (errorsOnly) list = list.filter((s) => s.status === 'ERROR');
  if (searchQuery.trim() === '') return list;
  const q = searchQuery.toLowerCase();
  return list.filter((s) => s.name.toLowerCase().includes(q));
}

/**
 * Filter trace summaries: include trace if any span name matches search (or search empty) and optionally has error.
 */
export function filterTraceSummaries(
  summaries: TraceSummary[],
  searchQuery: string,
  errorsOnly: boolean,
): TraceSummary[] {
  let list = summaries;
  if (errorsOnly) list = list.filter((s) => s.hasError);
  if (searchQuery.trim() === '') return list;
  const q = searchQuery.toLowerCase();
  return list.filter((s) => s.spans.some((sp) => sp.name.toLowerCase().includes(q)));
}

/**
 * Compute aggregate stats over spans.
 */
export function computeStats(spans: TerminalSpanEvent[]): SpanStats {
  const total = spans.length;
  const errors = spans.filter((s) => s.status === 'ERROR').length;
  const avg = total ? spans.reduce((a, s) => a + s.durationMs, 0) / total : 0;
  const p95 =
    total
      ? (() => {
          const sorted = spans.map((s) => s.durationMs).toSorted((a, b) => a - b);
          return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        })()
      : 0;
  return { total, errors, avg, p95 };
}

/**
 * Compute per-span-name stats for "Nx slower than average".
 */
export function computePerSpanNameStats(
  spans: TerminalSpanEvent[],
): PerSpanNameStats {
  const byName = new Map<string, { count: number; totalMs: number }>();
  for (const s of spans) {
    const cur = byName.get(s.name) ?? { count: 0, totalMs: 0 };
    cur.count += 1;
    cur.totalMs += s.durationMs;
    byName.set(s.name, cur);
  }
  const result = new Map<string, { count: number; totalMs: number; avgMs: number }>();
  for (const [name, { count, totalMs }] of byName) {
    result.set(name, { count, totalMs, avgMs: totalMs / count });
  }
  return { byName: result };
}
