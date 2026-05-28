// A subscriber that emits each captured event to in-process listeners. Sits
// alongside ArchitectureSnapshotSubscriber so the live HTTP server can push
// updates to connected dashboards the moment a track() call fires.

import { EventSubscriber, type EventPayload } from 'autotel-subscribers';

export type LiveEvent = {
  type: 'event';
  name: string;
  attributes: Record<string, unknown>;
  timestamp: string;
  channel?: string;
  producer?: string;
};

export type LiveEventListener = (event: LiveEvent) => void;

/**
 * Cap on concurrent SSE listeners. The dashboard is a demo, but a misbehaving
 * client (or a `curl -N` loop) could otherwise accumulate listeners forever
 * and grow the broadcast cost without bound. When the cap is hit, the oldest
 * subscription is dropped so a fresh tab can always connect.
 */
const DEFAULT_MAX_LISTENERS = 64;

export class LiveStreamSubscriber extends EventSubscriber {
  readonly name = 'LiveStreamSubscriber';

  private listeners = new Set<LiveEventListener>();
  private readonly maxListeners: number;

  constructor(opts: { maxListeners?: number } = {}) {
    super();
    this.maxListeners = opts.maxListeners ?? DEFAULT_MAX_LISTENERS;
  }

  protected async sendToDestination(payload: EventPayload): Promise<void> {
    if (payload.type !== 'event') return;
    const attrs = (payload.attributes ?? {}) as Record<string, unknown>;
    const meta = (attrs._autotel as { channel?: string; producer?: string } | undefined) ?? {};
    const event: LiveEvent = {
      type: 'event',
      name: payload.name,
      attributes: attrs,
      timestamp: payload.timestamp,
      channel: meta.channel,
      producer: meta.producer,
    };
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        // Listener errors must never block the producer.
        process.stderr.write(`live-stream listener error: ${(err as Error).message}\n`);
      }
    }
  }

  subscribe(fn: LiveEventListener): () => void {
    if (this.listeners.size >= this.maxListeners) {
      // FIFO eviction: drop the oldest subscriber so a new connection always
      // succeeds rather than failing silently when the cap is reached.
      const oldest = this.listeners.values().next().value;
      if (oldest) this.listeners.delete(oldest);
    }
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}
