import type { SpanData } from '../types';

export type SpanEvent = NonNullable<SpanData['events']>[number];

export interface PackedEvent {
  /** Index into the original `events` array. */
  index: number;
  /** Horizontal position as a percentage of the trace duration (0–100). */
  posPercent: number;
}

/** Minimum horizontal gap (in % of trace width) before two markers overlap. */
const MIN_GAP_PERCENT = 2;

/**
 * Packs span-event markers into horizontal sub-lanes so that markers closer
 * than {@link MIN_GAP_PERCENT} don't visually overlap. Events that are far
 * enough apart share a lane; collisions spill into the next available lane.
 */
export function packEventLanes(
  events: readonly SpanEvent[],
  traceStartTime: number,
  traceDuration: number,
): PackedEvent[][] {
  const lanes: PackedEvent[][] = [];

  for (let i = 0; i < events.length; i++) {
    const raw =
      traceDuration > 0
        ? ((events[i].timestamp - traceStartTime) / traceDuration) * 100
        : 0;
    const posPercent = Math.min(Math.max(raw, 0), 100);

    const lane = lanes.find((entries) =>
      entries.every((e) => Math.abs(posPercent - e.posPercent) > MIN_GAP_PERCENT),
    );
    if (lane) {
      lane.push({ index: i, posPercent });
    } else {
      lanes.push([{ index: i, posPercent }]);
    }
  }
  return lanes;
}

export type EventSeverity = 'exception' | 'event';

const ERROR_LEVELS = new Set(['error', 'fatal', 'critical']);

/**
 * Classifies a span event so the UI can colour its marker. OTel `exception`
 * events and any event carrying an error-ish severity/level attribute are
 * treated as exceptions.
 */
export function classifyEvent(event: SpanEvent): EventSeverity {
  if (event.name === 'exception') return 'exception';
  const level = event.attributes?.['level'] ?? event.attributes?.['severity'];
  if (typeof level === 'string' && ERROR_LEVELS.has(level.toLowerCase())) {
    return 'exception';
  }
  return 'event';
}
