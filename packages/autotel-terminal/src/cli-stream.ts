import type { TerminalSpanEvent, TerminalSpanStream } from './span-stream';

type Subscriber = (event: TerminalSpanEvent) => void;

/**
 * In-memory stream implementation for standalone CLI ingestion.
 */
export class CliTerminalSpanStream implements TerminalSpanStream {
  #subscribers = new Set<Subscriber>();

  onSpanEnd(callback: Subscriber): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  push(event: TerminalSpanEvent): void {
    for (const subscriber of this.#subscribers) {
      subscriber(event);
    }
  }
}
