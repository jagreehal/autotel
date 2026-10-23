// Layout for the GenAI run waterfall (RunTraceView): which rows show, where on
// the time axis each one sits, and what to call out. Pure, so the arithmetic is
// tested away from the component.

import { niceTicks } from '../charts/aggregate';
import { missingParentIds, type TraceNode } from './trace';

/** How long a trace may be quiet before a missing parent stops counting as
 *  running. A single model call can stream for most of a minute, so anything
 *  shorter flickers a live run to "done" between its spans. A parent that is
 *  never coming (sampled out, or exported elsewhere) stops looking live once
 *  this passes. */
export const LIVE_QUIET_MS = 60_000;

export interface Axis {
  /** Epoch ms the axis starts at: the run's first span. */
  t0: number;
  /** Width of the axis in ms, rounded up to the last tick. */
  spanMs: number;
  /** Tick offsets from `t0`, in ms. */
  ticks: number[];
}

/** End of a node: its own, or `now` while it is running. */
export function endOf(node: TraceNode, now: number): number | undefined {
  if (node.startMs == null) return undefined;
  if (node.kind === 'running') return Math.max(now, node.startMs);
  return node.durationMs == null ? undefined : node.startMs + node.durationMs;
}

export function axisFor(nodes: TraceNode[], now: number): Axis | undefined {
  let t0 = Infinity;
  let tEnd = -Infinity;
  const walk = (n: TraceNode): void => {
    const end = endOf(n, now);
    if (n.startMs != null && end != null) {
      t0 = Math.min(t0, n.startMs);
      tEnd = Math.max(tEnd, end);
    }
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  if (!Number.isFinite(t0)) return undefined;
  // A run of one instant still needs a width to draw on.
  const ticks = niceTicks(0, Math.max(tEnd - t0, 1), 4);
  return { t0, spanMs: ticks[ticks.length - 1], ticks };
}

/** Rows to render: a depth-first walk that skips beneath collapsed nodes. */
export function visibleRows(
  nodes: TraceNode[],
  collapsed: ReadonlySet<string>,
): TraceNode[] {
  const out: TraceNode[] = [];
  const walk = (n: TraceNode): void => {
    out.push(n);
    if (!collapsed.has(n.id)) n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

export function descendantCount(node: TraceNode): number {
  return node.children.reduce((sum, c) => sum + 1 + descendantCount(c), 0);
}

const hasTimedChild = (n: TraceNode): boolean =>
  n.children.some((c) => c.startMs != null && c.durationMs != null);

/**
 * The timed work beneath a node: every descendant with a bar whose own children
 * have none. Drawn inside a collapsed row so the fold still shows where its
 * time went.
 */
export function workSegments(node: TraceNode): TraceNode[] {
  const out: TraceNode[] = [];
  const walk = (n: TraceNode): void => {
    for (const c of n.children) {
      if (c.startMs != null && c.durationMs != null && !hasTimedChild(c))
        out.push(c);
      else walk(c);
    }
  };
  walk(node);
  return out;
}

/**
 * The slowest model call or tool: the row someone opening a slow run wants
 * first. Containers are skipped, since they are always longer than what they
 * hold. Undefined with fewer than two candidates, where "slowest" says nothing.
 */
export function slowestId(nodes: TraceNode[]): string | undefined {
  let best: TraceNode | undefined;
  let candidates = 0;
  const walk = (n: TraceNode): void => {
    if (
      (n.kind === 'step' || n.kind === 'tool') &&
      n.durationMs != null &&
      !hasTimedChild(n)
    ) {
      candidates++;
      if (!best || n.durationMs > (best.durationMs ?? 0)) best = n;
    }
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return candidates >= 2 ? best?.id : undefined;
}

/**
 * Parents still running: ones a trace's children point at that have not
 * arrived, while that trace is still producing spans. Spans are exported when
 * they end, so this is the only "in progress" a receiver can see. Judged per
 * trace, so a new turn in a conversation does not revive an old turn's parent
 * that was never coming.
 */
export function runningParents(
  traces: ReadonlyArray<{
    spans: ReadonlyArray<{ spanId: string; parentSpanId?: string }>;
    endTime: number;
  }>,
  now: number,
): Set<string> {
  const running = new Set<string>();
  for (const t of traces)
    if (now - t.endTime <= LIVE_QUIET_MS)
      for (const id of missingParentIds(t.spans)) running.add(id);
  return running;
}

export function hasRunning(nodes: TraceNode[]): boolean {
  return nodes.some((n) => n.kind === 'running' || hasRunning(n.children));
}
