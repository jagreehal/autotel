// Lane layout for the GenAI timeline: which row each span is drawn on.
// Pure so the rules can be tested away from the component.

import { spanLabel } from './label';
import type { GenAiSpan } from './types';

/**
 * The row a span belongs on. Handoffs and named agents get their own; anything
 * else is titled the way the span list titles it, so a tool run reads
 * `tool: get_weather` rather than the `provider/unknown` of a span that has no
 * model.
 */
export function laneFor(span: GenAiSpan): string {
  if (span.handoff)
    return `handoff: ${span.handoff.fromAgent ?? '?'} → ${span.handoff.toAgent ?? '?'}`;
  if (span.agent?.name) return span.agent.name;
  return spanLabel(span).text;
}

/** A span's identity: span ids are unique only within their trace. */
export const spanKey = (span: GenAiSpan): string =>
  `${span.traceId}:${span.spanId}`;

/**
 * Spans that hold another span in the same list, keyed by `spanKey`. A
 * wrapper is drawn as an outlined rail behind what it holds, so the inner
 * steps do not disappear under it.
 *
 * The parent link decides first: an exchange that answers in one turn has
 * exactly that turn's timestamps, so no time test can tell which holds which.
 * Strict time containment is the fallback, for wrappers that emit no link to
 * what they wrap.
 */
export function markWrappers(spans: readonly GenAiSpan[]): Set<string> {
  const present = new Set(spans.map(spanKey));
  const wrapperIds = new Set<string>();
  for (const span of spans) {
    if (!span.parentSpanId) continue;
    const parent = `${span.traceId}:${span.parentSpanId}`;
    if (present.has(parent)) wrapperIds.add(parent);
  }
  for (const a of spans) {
    if (wrapperIds.has(spanKey(a))) continue;
    for (const b of spans) {
      if (a === b) continue;
      const contains =
        b.startMs >= a.startMs &&
        b.endMs <= a.endMs &&
        b.endMs - b.startMs < a.endMs - a.startMs;
      if (contains) {
        wrapperIds.add(spanKey(a));
        break;
      }
    }
  }
  return wrapperIds;
}

export interface Lanes {
  laneOrder: string[];
  laneMap: Map<string, GenAiSpan[]>;
  wrapperIdsByLane: Map<string, Set<string>>;
  durationMs: number;
}

/**
 * Rows in order of first appearance. A wrapper on a row that also holds what
 * it wraps moves to a row of its own just above, named for its operation: an
 * agent exchange starts at the same instant as its first turn, so on one row
 * the two labels were drawn on top of each other. On its own row the exchange
 * reads like a waterfall, its turns beneath it.
 */
export function buildLanes(
  spans: readonly GenAiSpan[],
  startMs: number,
  endMs: number,
): Lanes {
  const firstOrder: string[] = [];
  const byLane = new Map<string, GenAiSpan[]>();
  for (const span of spans) {
    const lane = laneFor(span);
    if (!byLane.has(lane)) {
      byLane.set(lane, []);
      firstOrder.push(lane);
    }
    byLane.get(lane)!.push(span);
  }

  const laneOrder: string[] = [];
  const laneMap = new Map<string, GenAiSpan[]>();
  for (const lane of firstOrder) {
    const members = byLane.get(lane)!;
    const wrappers = markWrappers(members);
    const outer = members.filter((s) => wrappers.has(spanKey(s)));
    const inner = members.filter((s) => !wrappers.has(spanKey(s)));
    if (outer.length > 0 && inner.length > 0) {
      // Operation first: the lane column truncates, and the wrapper's row
      // must not read the same as the row beneath it once cut.
      const wrapperLane = `${outer[0]!.operation} · ${lane}`;
      laneOrder.push(wrapperLane);
      laneMap.set(wrapperLane, outer);
      laneOrder.push(lane);
      laneMap.set(lane, inner);
    } else {
      laneOrder.push(lane);
      laneMap.set(lane, members);
    }
  }

  // Nesting that remains within one row (a wrapper inside a wrapper) still
  // draws as a rail.
  const wrapperIdsByLane = new Map<string, Set<string>>();
  for (const [lane, members] of laneMap) {
    wrapperIdsByLane.set(lane, markWrappers(members));
  }
  return {
    laneOrder,
    laneMap,
    wrapperIdsByLane,
    durationMs: Math.max(1, endMs - startMs),
  };
}
