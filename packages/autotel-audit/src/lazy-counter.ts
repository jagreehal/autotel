import { createCounter } from 'autotel';

export interface LazyCounter {
  add(value: number, attributes?: Record<string, string | number | boolean>): void;
}

/**
 * Counter that is created on first use (the meter may not be configured
 * until `init()` completes) and whose failures are swallowed — metrics
 * must never break event emission or the span pipeline.
 */
export function lazyCounter(name: string, description: string): LazyCounter {
  let counter: ReturnType<typeof createCounter> | undefined;
  return {
    add(value, attributes) {
      try {
        counter ??= createCounter(name, { description });
        counter.add(value, attributes);
      } catch {
        // Swallow — observability must never take the process down.
      }
    },
  };
}
