/**
 * Event capture for tests. Outside vitest's collection glob on purpose — this
 * is a helper, not a suite.
 */
import { setEventSink, type EventAttributes } from './emit-event';

export interface CapturedEvent {
  name: string;
  attributes: EventAttributes;
}

let captured: CapturedEvent[] = [];

/** Install a recording sink and clear anything captured so far. */
export function captureEvents(): CapturedEvent[] {
  captured = [];
  setEventSink((name, attributes) => {
    captured.push({ name, attributes });
  });
  return captured;
}

/** Events emitted under the given name. */
export function eventsNamed(name: string): CapturedEvent[] {
  return captured.filter((event) => event.name === name);
}
