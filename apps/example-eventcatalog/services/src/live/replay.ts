// Offline record / replay for the live demo.
//
// RECORDING: when the runner is wired with attachRecorder(), every event the
// LiveStreamSubscriber emits also gets appended to a JSONL file with a
// relative timestamp. The file is a faithful, replayable transcript of the
// session.
//
// REPLAYING: `replay()` reads the JSONL and feeds the events back into the
// snapshot + stream subscribers using their public trackEvent() interface,
// pacing the dispatch to match the original deltas. The dashboard sees an
// identical SSE stream and the snapshot accumulates identically, but the
// session is fully deterministic — no random orders, no live PSP — useful
// for repeatable demos and CI runs that need a stable event stream.

import { createWriteStream } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';
import type { LiveEvent, LiveStreamSubscriber } from './stream';

/** A single recorded line. `at` is ms since the recording's first event. */
export type RecordedLine = {
  at: number;
  event: LiveEvent;
};

/**
 * Attach a file recorder to the live stream. Returns a stop() that flushes
 * and closes. Idempotent timestamps anchor against the first event seen, so
 * a recording can begin mid-flight without warping the replay clock.
 */
export async function attachRecorder(
  stream: LiveStreamSubscriber,
  path: string,
): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true });
  const ws = createWriteStream(path, { flags: 'w' });
  let firstAt: number | null = null;

  const unsubscribe = stream.subscribe((event) => {
    const now = Date.now();
    if (firstAt === null) firstAt = now;
    const line: RecordedLine = { at: now - firstAt, event };
    ws.write(JSON.stringify(line) + '\n');
  });

  return async () => {
    unsubscribe();
    await new Promise<void>((resolve) => ws.end(() => resolve()));
  };
}

export interface ReplayOptions {
  /** Loop forever (default true — desk-friendly demo). */
  loop?: boolean;
  /** Playback speed multiplier. 2 = double-time, 0.5 = half-time. */
  speed?: number;
  /** Minimum gap between events on loop boundary, so the replay doesn't snap. */
  loopGapMs?: number;
  /** Called when each line is dispatched (useful for tests). */
  onTick?: (line: RecordedLine) => void;
}

/**
 * Replay a recorded JSONL back through the snapshot + stream subscribers.
 * Dashboards connected to the live server see an identical event stream;
 * the snapshot accumulates identically.
 */
export async function replay(
  path: string,
  snapshot: ArchitectureSnapshotSubscriber,
  stream: LiveStreamSubscriber,
  options: ReplayOptions = {},
): Promise<void> {
  const { loop = true, speed = 1, loopGapMs = 600 } = options;
  const raw = await readFile(path, 'utf8');
  const entries: RecordedLine[] = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  if (entries.length === 0) return;

  do {
    const startWall = Date.now();
    for (const line of entries) {
      const targetWall = startWall + line.at / speed;
      const wait = targetWall - Date.now();
      if (wait > 0) await sleep(wait);

      // Re-stamp timestamps to "now" so the dashboard treats this as a
      // live event, not a stale one. Trace IDs remain from the recording
      // so click-through to the original trace is preserved if desired.
      const event: LiveEvent = {
        ...line.event,
        timestamp: new Date().toISOString(),
      };
      await snapshot.trackEvent(event.name, event.attributes);
      await stream.trackEvent(event.name, event.attributes);
      options.onTick?.(line);
    }
    if (loop) await sleep(loopGapMs / speed);
  } while (loop);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
