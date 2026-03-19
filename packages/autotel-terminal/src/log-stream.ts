import type { TerminalLogEvent } from './lib/log-model';

/**
 * Stream interface for terminal log events.
 */
export interface TerminalLogStream {
  /**
   * Subscribe to log events.
   *
   * @param callback - Called when a log event is emitted
   * @returns Unsubscribe function
   */
  onLog(callback: (event: TerminalLogEvent) => void): () => void;
}

/**
 * Internal in-memory implementation used for the global log stream.
 */
class InMemoryTerminalLogStream implements TerminalLogStream {
  private subscribers = new Set<(event: TerminalLogEvent) => void>();

  onLog(callback: (event: TerminalLogEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  emit(event: TerminalLogEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        console.error('[autotel-terminal] Log subscriber error:', error);
      }
    }
  }
}

let globalLogStream: InMemoryTerminalLogStream | null = null;

/**
 * Get or create the global terminal log stream.
 *
 * This is intended to be used from Autotel canonical log line drains
 * or request logger hooks:
 *
 * ```ts
 * import { getTerminalLogStream } from 'autotel-terminal';
 *
 * const logStream = getTerminalLogStream();
 * logStream.emit({
 *   time: Date.now(),
 *   level: 'info',
 *   message: 'request completed',
 *   traceId,
 *   spanId,
 *   attributes: { route: '/users/:id', status: 200 },
 * });
 * ```
 */
export function getTerminalLogStream(): InMemoryTerminalLogStream {
  if (!globalLogStream) {
    globalLogStream = new InMemoryTerminalLogStream();
  }
  return globalLogStream;
}

