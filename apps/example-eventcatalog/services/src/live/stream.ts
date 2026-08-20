// A subscriber that emits each captured event to in-process listeners. Sits
// alongside ArchitectureSnapshotSubscriber so the live HTTP server can push
// updates to connected dashboards the moment a track() call fires.

import { EventSubscriber, type EventPayload } from 'autotel-subscribers';

/** What an event attribute can hold once it has been serialized for the wire. */
export type LiveAttributeValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>
  | { [key: string]: LiveAttributeValue };

/** The `_autotel` block the subscribers add to every tracked event. */
type AutotelMeta = {
  channel?: string;
  producer?: string;
};

export type LiveEvent = {
  type: 'event';
  name: string;
  attributes: Record<string, LiveAttributeValue>;
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
    // SAFETY: EventPayload types attributes loosely because a subscriber sees
    // whatever track() was given. Everything below either passes them straight
    // to JSON or reads `_autotel`, which autotel writes in this shape.
    const attrs = (payload.attributes ?? {}) as Record<
      string,
      LiveAttributeValue
    >;
    // SAFETY: `_autotel` is written by autotel's own subscribers in exactly this
    // shape; both fields are optional and only ever read for display.
    const meta = (attrs._autotel as AutotelMeta | undefined) ?? {};
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
        process.stderr.write(
          `live-stream listener error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
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
