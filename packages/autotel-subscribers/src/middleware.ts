/**
 * Middleware System for Events Subscribers
 *
 * Compose subscriber behaviors using middleware (like Redux/Express).
 * Add retry logic, sampling, enrichment, logging, and more without modifying subscriber code.
 *
 * @example
 * ```typescript
 * import { applyMiddleware, retryMiddleware, loggingMiddleware } from 'autotel-subscribers/middleware';
 *
 * const subscriber = applyMiddleware(
 *   new PostHogSubscriber({ apiKey: '...' }),
 *   [
 *     retryMiddleware({ maxRetries: 3 }),
 *     loggingMiddleware()
 *   ]
 * );
 * ```
 */

import type { EventSubscriber, EventAttributes, FunnelStatus, OutcomeStatus } from 'autotel/event-subscriber';

/**
 * Unified event type for middleware
 */
export type EventsEvent =
  | {
      type: 'event';
      name: string;
      attributes?: EventAttributes;
    }
  | {
      type: 'funnel';
      funnel: string;
      step: FunnelStatus;
      attributes?: EventAttributes;
    }
  | {
      type: 'outcome';
      operation: string;
      outcome: OutcomeStatus;
      attributes?: EventAttributes;
    }
  | {
      type: 'value';
      name: string;
      value: number;
      attributes?: EventAttributes;
    };

/**
 * Middleware function signature.
 *
 * Like Express middleware: `(event, next) => Promise<void>`
 */
export type SubscriberMiddleware = (
  event: EventsEvent,
  next: (event: EventsEvent) => Promise<void>
) => Promise<void>;

/**
 * Apply middleware to an subscriber.
 *
 * Middleware is executed in order. Each middleware can:
 * - Transform the event before passing to next()
 * - Add side effects (logging, metrics)
 * - Skip calling next() (filtering)
 * - Handle errors
 *
 * @example
 * ```typescript
 * const subscriber = applyMiddleware(
 *   new WebhookSubscriber({ url: '...' }),
 *   [
 *     loggingMiddleware(),
 *     retryMiddleware({ maxRetries: 3 }),
 *     samplingMiddleware(0.1) // Only 10% of events
 *   ]
 * );
 * ```
 */
export function applyMiddleware(
  subscriber: EventSubscriber,
  middlewares: SubscriberMiddleware[]
): EventSubscriber {
  // Convert subscriber methods to event format
  const trackEvent = async (event: EventsEvent): Promise<void> => {
    switch (event.type) {
      case 'event': {
        await subscriber.trackEvent(event.name, event.attributes);
        break;
      }
      case 'funnel': {
        await subscriber.trackFunnelStep(event.funnel, event.step, event.attributes);
        break;
      }
      case 'outcome': {
        await subscriber.trackOutcome(event.operation, event.outcome, event.attributes);
        break;
      }
      case 'value': {
        await subscriber.trackValue(event.name, event.value, event.attributes);
        break;
      }
    }
  };

  // Build middleware chain
  type ChainFunction = (event: EventsEvent) => Promise<void>;
  const reversedMiddlewares = middlewares.toReversed();
  let chain: ChainFunction = trackEvent;
  for (const middleware of reversedMiddlewares) {
    const next = chain;
    chain = (event: EventsEvent) => middleware(event, next);
  }

  // Wrap subscriber with middleware chain
  return {
    name: `${subscriber.name}(middleware)`,
    version: subscriber.version,

    async trackEvent(name: string, attributes?: EventAttributes): Promise<void> {
      await chain({ type: 'event', name, attributes });
    },

    async trackFunnelStep(funnel: string, step: FunnelStatus, attributes?: EventAttributes): Promise<void> {
      await chain({ type: 'funnel', funnel, step, attributes });
    },

    async trackOutcome(operation: string, outcome: OutcomeStatus, attributes?: EventAttributes): Promise<void> {
      await chain({ type: 'outcome', operation, outcome, attributes });
    },

    async trackValue(name: string, value: number, attributes?: EventAttributes): Promise<void> {
      await chain({ type: 'value', name, value, attributes });
    },

    async shutdown(): Promise<void> {
      await subscriber.shutdown?.();
    },
  };
}

// ============================================================================
// Built-in Middleware
// ============================================================================

/**
 * Retry failed requests with exponential backoff.
 *
 * @example
 * ```typescript
 * const subscriber = applyMiddleware(adapter, [
 *   retryMiddleware({ maxRetries: 3, delayMs: 1000 })
 * ]);
 * ```
 */
export function retryMiddleware(options: {
  maxRetries?: number;
  delayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}): SubscriberMiddleware {
  const { maxRetries = 3, delayMs = 1000, onRetry } = options;

  return async (event, next) => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await next(event);
        return; // Success!
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          onRetry?.(attempt, lastError);
          // Exponential backoff: 1s, 2s, 4s, 8s...
          await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)));
        }
      }
    }

    throw lastError;
  };
}

/**
 * Sample events (only send a percentage).
 *
 * @example
 * ```typescript
 * // Only send 10% of events (reduce costs)
 * const subscriber = applyMiddleware(adapter, [
 *   samplingMiddleware(0.1)
 * ]);
 * ```
 */
export function samplingMiddleware(rate: number): SubscriberMiddleware {
  if (rate < 0 || rate > 1) {
    throw new Error('Sample rate must be between 0 and 1');
  }

  return async (event, next) => {
    if (Math.random() < rate) {
      await next(event);
    }
    // Else: skip this event
  };
}

/**
 * Enrich events with additional attributes.
 *
 * @example
 * ```typescript
 * const subscriber = applyMiddleware(adapter, [
 *   enrichmentMiddleware((event) => ({
 *     ...event,
 *     attributes: {
 *       ...event.attributes,
 *       environment: process.env.NODE_ENV,
 *       timestamp: Date.now()
 *     }
 *   }))
 * ]);
 * ```
 */
export function enrichmentMiddleware(
  enricher: (event: EventsEvent) => EventsEvent
): SubscriberMiddleware {
  return async (event, next) => {
    const enriched = enricher(event);
    await next(enriched);
  };
}

/**
 * Log events to console.
 *
 * @example
 * ```typescript
 * const subscriber = applyMiddleware(adapter, [
 *   loggingMiddleware({ prefix: '[Events]', logAttributes: true })
 * ]);
 * ```
 */
export function loggingMiddleware(options: {
  prefix?: string;
  logAttributes?: boolean;
} = {}): SubscriberMiddleware {
  const { prefix = '[Events]', logAttributes = false } = options;

  return async (event, next) => {
    if (logAttributes) {
      console.log(prefix, event.type, event);
    } else {
      // Just log event type and name
      const eventName = 'name' in event ? event.name : `${(event as any).funnel || (event as any).operation}`;
      console.log(prefix, event.type, eventName);
    }

    await next(event);
  };
}

/**
 * Filter events based on a predicate.
 *
 * @example
 * ```typescript
 * // Only send 'order' events
 * const subscriber = applyMiddleware(adapter, [
 *   filterMiddleware((event) =>
 *     event.type === 'event' && event.name.startsWith('order.')
 *   )
 * ]);
 * ```
 */
export function filterMiddleware(
  predicate: (event: EventsEvent) => boolean
): SubscriberMiddleware {
  return async (event, next) => {
    if (predicate(event)) {
      await next(event);
    }
  };
}

/**
 * Transform events.
 *
 * @example
 * ```typescript
 * // Lowercase all event names
 * const subscriber = applyMiddleware(adapter, [
 *   transformMiddleware((event) => {
 *     if (event.type === 'event') {
 *       return { ...event, name: event.name.toLowerCase() };
 *     }
 *     return event;
 *   })
 * ]);
 * ```
 */
export function transformMiddleware(
  transformer: (event: EventsEvent) => EventsEvent
): SubscriberMiddleware {
  return async (event, next) => {
    const transformed = transformer(event);
    await next(transformed);
  };
}

/**
 * Batch events and flush periodically.
 *
 * @example
 * ```typescript
 * const subscriber = applyMiddleware(adapter, [
 *   batchingMiddleware({ batchSize: 100, flushInterval: 5000 })
 * ]);
 * ```
 */
export function batchingMiddleware(options: {
  batchSize?: number;
  flushInterval?: number;
}): SubscriberMiddleware {
  const { batchSize = 100, flushInterval = 5000 } = options;
  const buffer: Array<{ event: EventsEvent; next: (event: EventsEvent) => Promise<void> }> = [];
  let flushTimer: NodeJS.Timeout | null = null;

  const flush = async () => {
    const batch = [...buffer];
    buffer.length = 0;

    await Promise.all(batch.map(({ event, next }) => next(event)));
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flush().catch(console.error);
      flushTimer = null;
    }, flushInterval);
  };

  return async (event, next) => {
    buffer.push({ event, next });

    if (buffer.length >= batchSize) {
      await flush();
    } else {
      scheduleFlush();
    }
  };
}

/**
 * Rate limit events (throttle).
 *
 * @example
 * ```typescript
 * // Max 100 events per second
 * const subscriber = applyMiddleware(adapter, [
 *   rateLimitMiddleware({ requestsPerSecond: 100 })
 * ]);
 * ```
 */
export function rateLimitMiddleware(options: {
  requestsPerSecond: number;
}): SubscriberMiddleware {
  const { requestsPerSecond } = options;
  const intervalMs = 1000 / requestsPerSecond;
  let lastCallTime = 0;
  const queue: Array<() => void> = [];
  let processing = false;

  const processQueue = async () => {
    if (processing) return;
    processing = true;

    while (queue.length > 0) {
      const now = Date.now();
      const timeSinceLastCall = now - lastCallTime;

      if (timeSinceLastCall < intervalMs) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs - timeSinceLastCall));
      }

      const fn = queue.shift();
      if (fn) {
        lastCallTime = Date.now();
        fn();
      }
    }

    processing = false;
  };

  return async (event, next) => {
    return new Promise<void>((resolve, reject) => {
      queue.push(() => {
        next(event).then(resolve).catch(reject);
      });
      processQueue().catch(reject);
    });
  };
}

/**
 * Circuit breaker pattern.
 *
 * Opens circuit after N failures, prevents further requests for a timeout period.
 *
 * @example
 * ```typescript
 * const subscriber = applyMiddleware(adapter, [
 *   circuitBreakerMiddleware({
 *     failureThreshold: 5,
 *     timeout: 60000 // 1 minute
 *   })
 * ]);
 * ```
 */
export function circuitBreakerMiddleware(options: {
  failureThreshold?: number;
  timeout?: number;
  onOpen?: () => void;
  onClose?: () => void;
}): SubscriberMiddleware {
  const { failureThreshold = 5, timeout = 60_000, onOpen, onClose } = options;
  let failureCount = 0;
  let lastFailureTime = 0;
  let circuitOpen = false;

  return async (event, next) => {
    // Check if circuit should close
    if (circuitOpen) {
      const now = Date.now();
      if (now - lastFailureTime > timeout) {
        circuitOpen = false;
        failureCount = 0;
        onClose?.();
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      await next(event);
      // Success resets failure count
      failureCount = 0;
    } catch (error) {
      failureCount++;
      lastFailureTime = Date.now();

      if (failureCount >= failureThreshold) {
        circuitOpen = true;
        onOpen?.();
      }

      throw error;
    }
  };
}

/**
 * Add timeout to events.
 *
 * @example
 * ```typescript
 * const subscriber = applyMiddleware(adapter, [
 *   timeoutMiddleware({ timeoutMs: 5000 })
 * ]);
 * ```
 */
export function timeoutMiddleware(options: {
  timeoutMs: number;
}): SubscriberMiddleware {
  const { timeoutMs } = options;

  return async (event, next) => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    await Promise.race([next(event), timeoutPromise]);
  };
}
