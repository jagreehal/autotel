/**
 * Subscriber middleware system for transforming, filtering, and enriching events
 *
 * Provides composable middleware for adding cross-cutting concerns:
 * - Retry logic, rate limiting, and circuit breaker patterns
 * - Event filtering, transformation, and enrichment
 * - Idempotency and batching
 * - Event logging and observability
 *
 * @example
 * ```typescript
 * import { applyMiddleware, retryMiddleware, rateLimitMiddleware } from 'autotel-subscribers/middleware'
 *
 * const subscriber = applyMiddleware(
 *   createPostHogSubscriber({ apiKey: '...' }),
 *   [
 *     retryMiddleware({ maxRetries: 3 }),
 *     rateLimitMiddleware({ requestsPerSecond: 100 })
 *   ]
 * )
 * ```
 */

import type {
  EventSubscriber,
  EventAttributes,
  FunnelStatus,
  OutcomeStatus,
  EventTrackingOptions,
} from 'autotel/event-subscriber';

/** Normalized event for middleware processing */
export type EventsEvent =
  | {
      type: 'event';
      name: string;
      attributes?: EventAttributes;
      options?: EventTrackingOptions;
    }
  | {
      type: 'funnel';
      funnel: string;
      step: FunnelStatus;
      attributes?: EventAttributes;
      options?: EventTrackingOptions;
    }
  | {
      type: 'outcome';
      operation: string;
      outcome: OutcomeStatus;
      attributes?: EventAttributes;
      options?: EventTrackingOptions;
    }
  | {
      type: 'value';
      name: string;
      value: number;
      attributes?: EventAttributes;
      options?: EventTrackingOptions;
    };

export type SendEventRecord = {
  subscriberName: string;
  eventType: EventsEvent['type'];
  eventName: string;
  status: 'success' | 'error';
  durationMs: number;
  startedAt: Date;
  endedAt: Date;
  error?: { name: string; message: string; code?: string };
};

export type SendEventSink = {
  write(event: SendEventRecord): Promise<void>;
};

export type RateLimitAlgorithm = 'fixed' | 'sliding';
export type RateLimitRecord = { count: number; resetAtMs: number };

export type RateLimitStore = {
  record(
    key: string,
    windowMs: number,
    algorithm: RateLimitAlgorithm,
  ): Promise<RateLimitRecord>;
};

export type IdempotencyStore<TResult = unknown> = {
  get(key: string): Promise<TResult | null>;
  set(key: string, result: TResult, ttlMs: number): Promise<void>;
};

export type SubscriberMiddleware<TCtxIn = Record<string, unknown>, TCtxOut = TCtxIn> = (
  params: {
    event: EventsEvent;
    ctx: TCtxIn;
    subscriber: Pick<EventSubscriber, 'name' | 'version'>;
    next: (update?: { event?: EventsEvent; ctxPatch?: Partial<TCtxOut> }) => Promise<void>;
  },
) => Promise<void>;

/** Type-safe middleware factory helper */
export const createMiddleware = <TCtxIn = Record<string, unknown>, TCtxOut = TCtxIn>(
  fn: SubscriberMiddleware<TCtxIn, TCtxOut>,
): SubscriberMiddleware<TCtxIn, TCtxOut> => fn;

function eventNameOf(event: EventsEvent): string {
  switch (event.type) {
    case 'event':
    case 'value': {
      return event.name;
    }
    case 'funnel': {
      return `${event.funnel}.${event.step}`;
    }
    case 'outcome': {
      return `${event.operation}.${event.outcome}`;
    }
  }
}

function defaultContextFactory() {
  return {} as Record<string, unknown>;
}

async function dispatchEvent(subscriber: EventSubscriber, event: EventsEvent): Promise<void> {
  switch (event.type) {
    case 'event': {
      await subscriber.trackEvent(event.name, event.attributes, event.options);
      return;
    }
    case 'funnel': {
      await subscriber.trackFunnelStep(event.funnel, event.step, event.attributes, event.options);
      return;
    }
    case 'outcome': {
      await subscriber.trackOutcome(
        event.operation,
        event.outcome,
        event.attributes,
        event.options,
      );
      return;
    }
    case 'value': {
      await subscriber.trackValue(event.name, event.value, event.attributes, event.options);
    }
  }
}

/**
 * Apply middleware to a subscriber
 *
 * Chains middleware in order, each can transform events or context before passing to next
 *
 * @example
 * ```typescript
 * const enriched = applyMiddleware(
 *   subscriber,
 *   [enrichmentMiddleware(event => ({ ...event, timestamp: Date.now() }))]
 * )
 * ```
 */
export function applyMiddleware<TCtx = Record<string, unknown>>(
  subscriber: EventSubscriber,
  middlewares: Array<SubscriberMiddleware<TCtx, TCtx>>,
  options?: { initialContext?: () => TCtx },
): EventSubscriber {
  const runChain = async (initialEvent: EventsEvent): Promise<void> => {
    const baseCtx = (options?.initialContext ?? defaultContextFactory)() as TCtx;

    const execute = async (index: number, event: EventsEvent, ctx: TCtx): Promise<void> => {
      const middleware = middlewares[index];
      if (!middleware) {
        await dispatchEvent(subscriber, event);
        return;
      }

      await middleware({
        event,
        ctx,
        subscriber,
        next: async (update) => {
          const nextEvent = update?.event ?? event;
          const nextCtx = update?.ctxPatch
            ? ({ ...ctx, ...update.ctxPatch } as TCtx)
            : ctx;
          await execute(index + 1, nextEvent, nextCtx);
        },
      });
    };

    await execute(0, initialEvent, baseCtx);
  };

  return {
    name: `${subscriber.name}(middleware)`,
    version: subscriber.version,
    trackEvent: async (name, attributes, options_) =>
      runChain({ type: 'event', name, attributes, options: options_ }),
    trackFunnelStep: async (funnel, step, attributes, options_) =>
      runChain({ type: 'funnel', funnel, step, attributes, options: options_ }),
    trackOutcome: async (operation, outcome, attributes, options_) =>
      runChain({ type: 'outcome', operation, outcome, attributes, options: options_ }),
    trackValue: async (name, value, attributes, options_) =>
      runChain({ type: 'value', name, value, attributes, options: options_ }),
    shutdown: async () => {
      await subscriber.shutdown?.();
    },
  };
}

/**
 * Retry middleware with exponential backoff
 *
 * Automatically retries failed events with exponential backoff delay
 */
export function retryMiddleware(options: {
  maxRetries?: number;
  delayMs?: number;
  onRetry?: (attempt: number, error: Error, event: EventsEvent) => void;
}): SubscriberMiddleware {
  const { maxRetries = 3, delayMs = 1000, onRetry } = options;

  return async ({ event, next }) => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await next();
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          onRetry?.(attempt, lastError, event);
          await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
        }
      }
    }

    throw lastError;
  };
}

/**
 * Sampling middleware to reduce event volume
 *
 * Only passes through a percentage of events based on the rate (0.0 to 1.0)
 */
export function samplingMiddleware(rate: number): SubscriberMiddleware {
  if (rate < 0 || rate > 1) throw new Error('Sample rate must be between 0 and 1');

  return async ({ next }) => {
    if (Math.random() < rate) await next();
  };
}

/**
 * Enrichment middleware to add or modify event data
 *
 * Apply a transformation function to each event before sending
 */
export function enrichmentMiddleware(enricher: (event: EventsEvent) => EventsEvent): SubscriberMiddleware {
  return async ({ event, next }) => {
    await next({ event: enricher(event) });
  };
}

/**
 * Logging middleware for debugging event flow
 *
 * Logs event type and name (optionally full event) to console
 */
export function loggingMiddleware(options: { prefix?: string; logAttributes?: boolean } = {}): SubscriberMiddleware {
  const { prefix = '[Events]', logAttributes = false } = options;

  return async ({ event, next }) => {
    if (logAttributes) {
      console.log(prefix, event.type, event);
    } else {
      console.log(prefix, event.type, eventNameOf(event));
    }
    await next();
  };
}

/**
 * Filter middleware to selectively process events
 *
 * Only forwards events that match the predicate
 */
export function filterMiddleware(predicate: (event: EventsEvent) => boolean): SubscriberMiddleware {
  return async ({ event, next }) => {
    if (predicate(event)) await next();
  };
}

/**
 * Transform middleware to modify event structure
 *
 * Similar to enrichment but replaces entire event
 */
export function transformMiddleware(transformer: (event: EventsEvent) => EventsEvent): SubscriberMiddleware {
  return async ({ event, next }) => {
    await next({ event: transformer(event) });
  };
}

/**
 * Batching middleware to group events for bulk sending
 *
 * Collects events into batches before forwarding
 */
export function batchingMiddleware(options: {
  batchSize?: number;
  flushInterval?: number;
}): SubscriberMiddleware {
  const { batchSize = 100, flushInterval = 5000 } = options;
  const queue: Array<() => Promise<void>> = [];
  let timer: NodeJS.Timeout | null = null;

  const flush = async () => {
    const pending = queue.splice(0);
    await Promise.all(pending.map((run) => run()));
  };

  return async ({ next }) => {
    await new Promise<void>((resolve, reject) => {
      queue.push(async () => {
        try {
          await next();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      if (queue.length >= batchSize) {
        if (timer) clearTimeout(timer);
        timer = null;
        void flush().catch(reject);
        return;
      }

      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          void flush().catch(reject);
        }, flushInterval);
      }
    });
  };
}

/**
 * Rate limit middleware to control event sending rate
 *
 * Enforces a maximum rate of events sent per second
 */
export function rateLimitMiddleware(options: { requestsPerSecond: number }): SubscriberMiddleware {
  const intervalMs = 1000 / options.requestsPerSecond;
  let lastAt = 0;

  return async ({ next }) => {
    const now = Date.now();
    const waitMs = Math.max(0, intervalMs - (now - lastAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastAt = Date.now();
    await next();
  };
}

/**
 * Circuit breaker middleware for fault tolerance
 *
 * Prevents cascading failures by stopping requests when error rate exceeds threshold
 */
export function circuitBreakerMiddleware(options: {
  failureThreshold?: number;
  timeout?: number;
  onOpen?: () => void;
  onClose?: () => void;
}): SubscriberMiddleware {
  const { failureThreshold = 5, timeout = 60_000, onOpen, onClose } = options;
  let failureCount = 0;
  let lastFailureAt = 0;
  let open = false;

  return async ({ next }) => {
    if (open) {
      if (Date.now() - lastFailureAt > timeout) {
        open = false;
        failureCount = 0;
        onClose?.();
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      await next();
      failureCount = 0;
    } catch (error) {
      failureCount += 1;
      lastFailureAt = Date.now();
      if (failureCount >= failureThreshold) {
        open = true;
        onOpen?.();
      }
      throw error;
    }
  };
}

/**
 * Timeout middleware to prevent hanging requests
 *
 * Rejects the event if processing exceeds the specified timeout
 */
export function timeoutMiddleware(options: { timeoutMs: number }): SubscriberMiddleware {
  return async ({ next }) => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${options.timeoutMs}ms`)), options.timeoutMs);
    });

    await Promise.race([next(), timeoutPromise]);
  };
}

/**
 * Create an idempotency store with custom get/set operations
 *
 * Used with withIdempotency middleware to prevent duplicate event processing
 */
export function createIdempotencyStore<TResult = unknown>(options: {
  get: (key: string) => Promise<TResult | null>;
  set: (key: string, result: TResult, ttlMs: number) => Promise<void>;
}): IdempotencyStore<TResult> {
  return { get: options.get, set: options.set };
}

/**
 * In-memory idempotency store
 *
 * Useful for testing or single-process applications
 */
export function inMemoryIdempotencyStore<TResult = unknown>(): IdempotencyStore<TResult> {
  type Entry = { result: TResult; expiresAtMs: number };
  const map = new Map<string, Entry>();

  return createIdempotencyStore<TResult>({
    get: async (key) => {
      const entry = map.get(key);
      if (!entry) return null;
      if (entry.expiresAtMs <= Date.now()) {
        map.delete(key);
        return null;
      }
      return entry.result;
    },
    set: async (key, result, ttlMs) => {
      map.set(key, { result, expiresAtMs: Date.now() + ttlMs });
    },
  });
}

/**
 * Create a rate limit store with custom record operation
 *
 * Used with withRateLimit middleware for distributed rate limiting
 */
export function createRateLimitStore(options: {
  record: (
    key: string,
    windowMs: number,
    algorithm: RateLimitAlgorithm,
  ) => Promise<RateLimitRecord>;
}): RateLimitStore {
  return { record: options.record };
}

/**
 * In-memory rate limit store
 *
 * Supports fixed and sliding window algorithms
 */
export function inMemoryRateLimitStore(): RateLimitStore {
  type FixedEntry = { count: number; expireAtMs: number };
  const fixed = new Map<string, FixedEntry>();
  const sliding = new Map<string, number[]>();

  return {
    async record(key, windowMs, algorithm) {
      const now = Date.now();
      if (algorithm === 'fixed') {
        const entry = fixed.get(key);
        if (!entry || entry.expireAtMs <= now) {
          const next = { count: 1, expireAtMs: now + windowMs };
          fixed.set(key, next);
          return { count: 1, resetAtMs: next.expireAtMs };
        }
        entry.count += 1;
        return { count: entry.count, resetAtMs: entry.expireAtMs };
      }

      const cutoff = now - windowMs;
      const points = (sliding.get(key) ?? []).filter((ts) => ts > cutoff);
      points.push(now);
      sliding.set(key, points);
      return { count: points.length, resetAtMs: points[0]! + windowMs };
    },
  };
}

/**
 * Idempotency middleware to prevent duplicate processing
 *
 * Skips processing if the same event (by key) was processed within TTL
 *
 * @example
 * ```typescript
 * const middleware = withIdempotency({
 *   store: inMemoryIdempotencyStore(),
 *   key: event => event.name,
 *   ttlMs: 60000
 * })
 * ```
 */
export function withIdempotency(options: {
  store: IdempotencyStore<boolean>;
  key: string | ((event: EventsEvent) => string);
  ttlMs: number;
}): SubscriberMiddleware {
  return async ({ event, next }) => {
    const key = typeof options.key === 'function' ? options.key(event) : options.key;
    const cached = await options.store.get(key);
    if (cached) return;

    await next();
    await options.store.set(key, true, options.ttlMs);
  };
}

/**
 * Rate limiting middleware with store-based tracking
 *
 * Enforces rate limits across distributed systems using a store backend
 *
 * @example
 * ```typescript
 * const middleware = withRateLimit({
 *   store: inMemoryRateLimitStore(),
 *   key: event => 'global',
 *   max: 1000,
 *   windowMs: 60000
 * })
 * ```
 */
export function withRateLimit(options: {
  store: RateLimitStore;
  key: string | ((event: EventsEvent) => string);
  max: number;
  windowMs: number;
  algorithm?: RateLimitAlgorithm;
}): SubscriberMiddleware {
  const algorithm = options.algorithm ?? 'fixed';

  return async ({ event, next }) => {
    const key = typeof options.key === 'function' ? options.key(event) : options.key;
    const { count, resetAtMs } = await options.store.record(key, options.windowMs, algorithm);
    if (count > options.max) {
      const retryAfterMs = Math.max(0, resetAtMs - Date.now());
      throw new Error(`Rate limited for key "${key}". Retry after ${retryAfterMs}ms.`);
    }
    await next();
  };
}

/**
 * Event logger middleware for observability
 *
 * Writes event records to a sink for monitoring, audit logging, or analytics
 *
 * @example
 * ```typescript
 * const middleware = withEventLogger({
 *   sink: {
 *     write: async (record) => {
 *       await db.eventLogs.insert(record)
 *     }
 *   }
 * })
 * ```
 */
export function withEventLogger(options: { sink: SendEventSink }): SubscriberMiddleware {
  return async ({ event, next, subscriber }) => {
    const startedAt = new Date();
    const start = performance.now();

    try {
      await next();
      const endedAt = new Date();
      await options.sink.write({
        subscriberName: subscriber.name ?? 'unknown',
        eventType: event.type,
        eventName: eventNameOf(event),
        status: 'success',
        durationMs: performance.now() - start,
        startedAt,
        endedAt,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const endedAt = new Date();
      const maybeCode = (err as { code?: unknown }).code;

      await options.sink.write({
        subscriberName: subscriber.name ?? 'unknown',
        eventType: event.type,
        eventName: eventNameOf(event),
        status: 'error',
        durationMs: performance.now() - start,
        startedAt,
        endedAt,
        error: {
          name: err.name,
          message: err.message,
          code: typeof maybeCode === 'string' ? maybeCode : undefined,
        },
      });
      throw err;
    }
  };
}
