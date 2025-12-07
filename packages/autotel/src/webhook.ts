/**
 * Webhook and callback tracing with the "Parking Lot" pattern
 *
 * When initiating async operations that return hours/days later (webhooks,
 * payment callbacks, human approvals), you can't keep a span open. This module
 * provides utilities to "park" trace context and retrieve it when callbacks arrive.
 *
 * @example Stripe payment webhook
 * ```typescript
 * import { createParkingLot, InMemoryTraceContextStore } from 'autotel/webhook';
 *
 * const parkingLot = createParkingLot({
 *   store: new InMemoryTraceContextStore(),
 *   defaultTTLMs: 24 * 60 * 60 * 1000, // 24 hours
 * });
 *
 * // When initiating payment
 * export const initiatePayment = trace(ctx => async (orderId: string) => {
 *   await parkingLot.park(`payment:${orderId}`, { orderId });
 *   await stripeClient.createPaymentIntent({ metadata: { orderId } });
 * });
 *
 * // When Stripe webhook arrives (hours later)
 * export const handleStripeWebhook = parkingLot.traceCallback({
 *   name: 'stripe.webhook.payment_intent.succeeded',
 *   correlationKeyFrom: (event) => `payment:${event.data.object.metadata.orderId}`,
 * })(ctx => async (event: Stripe.Event) => {
 *   // ctx.parkedContext contains the original trace context
 *   // ctx.elapsedMs shows time since payment was initiated
 *   await fulfillOrder(event.data.object);
 * });
 * ```
 *
 * @module
 */

import { SpanKind, trace as otelTrace } from '@opentelemetry/api';
import type { SpanContext, Link } from '@opentelemetry/api';
import { trace } from './functional';
import type { TraceContext } from './trace-context';

// ============================================================================
// Types
// ============================================================================

/**
 * Stored trace context for parking lot pattern
 */
export interface StoredTraceContext {
  /** Trace ID from the original span */
  traceId: string;

  /** Span ID from the original span */
  spanId: string;

  /** Trace flags (sampling decision) */
  traceFlags: number;

  /** When the context was parked */
  parkedAt: number;

  /** Optional TTL in milliseconds */
  ttlMs?: number;

  /** User-provided metadata */
  metadata?: Record<string, string>;
}

/**
 * Interface for trace context storage backends
 *
 * Implement this interface to use different storage backends (Redis, DynamoDB, etc.)
 */
export interface TraceContextStore {
  /**
   * Save trace context with a correlation key
   *
   * @param key - Unique correlation key (e.g., "payment:order-123")
   * @param context - The trace context to store
   */
  save(key: string, context: StoredTraceContext): Promise<void>;

  /**
   * Load trace context by correlation key
   *
   * @param key - The correlation key used when parking
   * @returns The stored context, or null if not found/expired
   */
  load(key: string): Promise<StoredTraceContext | null>;

  /**
   * Delete trace context by correlation key
   *
   * @param key - The correlation key to delete
   */
  delete(key: string): Promise<void>;
}

/**
 * Configuration for creating a parking lot
 */
export interface ParkingLotConfig {
  /** Storage backend for parked contexts */
  store: TraceContextStore;

  /** Default TTL in milliseconds (default: 24 hours) */
  defaultTTLMs?: number;

  /** Prefix for all correlation keys (default: "parkingLot:") */
  keyPrefix?: string;

  /** Whether to auto-delete after retrieval (default: true) */
  autoDeleteOnRetrieve?: boolean;

  /** Callback when context expires or is not found */
  onMiss?: (correlationKey: string) => void;
}

/**
 * Configuration for traceCallback wrapper
 */
export interface CallbackConfig {
  /** Span name for the callback handler */
  name: string;

  /**
   * Extract correlation key from callback arguments
   *
   * @example
   * ```typescript
   * correlationKeyFrom: (event) => `payment:${event.data.orderId}`
   * ```
   */
  correlationKeyFrom: (args: unknown[]) => string;

  /** Additional span attributes */
  attributes?: Record<string, string | number | boolean>;

  /** Whether to fail if parked context is not found (default: false) */
  requireParkedContext?: boolean;
}

/**
 * Extended context for callback handlers
 */
export interface CallbackContext extends TraceContext {
  /** The retrieved parked context, if found */
  parkedContext: StoredTraceContext | null;

  /** Time elapsed since context was parked (ms), or null if not found */
  elapsedMs: number | null;

  /** The correlation key used for retrieval */
  correlationKey: string;
}

/**
 * The parking lot instance
 */
export interface ParkingLot {
  /**
   * Park current trace context before initiating async operation
   *
   * Call this before sending a webhook, initiating a payment, or starting
   * any operation that will complete via callback.
   *
   * @param correlationKey - Unique key to retrieve context later (e.g., "payment:order-123")
   * @param metadata - Optional metadata to store with the context
   * @returns The correlation key (with prefix applied)
   *
   * @example
   * ```typescript
   * await parkingLot.park(`payment:${orderId}`, {
   *   customerId: customer.id,
   *   amount: payment.amount.toString(),
   * });
   * ```
   */
  park(
    correlationKey: string,
    metadata?: Record<string, string>,
  ): Promise<string>;

  /**
   * Retrieve parked context when callback arrives
   *
   * @param correlationKey - The key used when parking
   * @returns The stored context, or null if not found/expired
   */
  retrieve(correlationKey: string): Promise<StoredTraceContext | null>;

  /**
   * Wrap a callback handler with automatic context retrieval and linking
   *
   * Creates a traced function that:
   * 1. Extracts correlation key from arguments
   * 2. Retrieves parked context from storage
   * 3. Creates a span link to the original trace
   * 4. Provides elapsed time since parking
   *
   * @param config - Callback configuration
   * @returns Factory function for the callback handler
   *
   * @example
   * ```typescript
   * export const handleWebhook = parkingLot.traceCallback({
   *   name: 'webhook.payment.completed',
   *   correlationKeyFrom: (args) => `payment:${args[0].orderId}`,
   * })(ctx => async (event) => {
   *   console.log(`Payment completed after ${ctx.elapsedMs}ms`);
   *   await processPayment(event);
   * });
   * ```
   */
  traceCallback<TArgs extends unknown[], TReturn>(
    config: CallbackConfig,
  ): (
    fnFactory: (ctx: CallbackContext) => (...args: TArgs) => Promise<TReturn>,
  ) => (...args: TArgs) => Promise<TReturn>;

  /**
   * Manually create a span link from stored context
   *
   * Useful when you need more control over span creation.
   *
   * @param storedContext - The stored trace context
   * @returns A span link that can be added to a span
   */
  createLink(storedContext: StoredTraceContext): Link;

  /**
   * Check if a parked context exists (without retrieving/deleting it)
   *
   * @param correlationKey - The key to check
   * @returns True if context exists and hasn't expired
   */
  exists(correlationKey: string): Promise<boolean>;
}

// ============================================================================
// In-Memory Store (for testing and development)
// ============================================================================

/**
 * In-memory trace context store
 *
 * Useful for testing and development. For production, use a persistent
 * store like Redis or DynamoDB.
 *
 * @example
 * ```typescript
 * const store = new InMemoryTraceContextStore();
 * const parkingLot = createParkingLot({ store });
 * ```
 */
export class InMemoryTraceContextStore implements TraceContextStore {
  private store = new Map<string, StoredTraceContext>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private options: {
      /** Cleanup interval in ms (default: 60000) */
      cleanupIntervalMs?: number;
    } = {},
  ) {
    // Start periodic cleanup of expired entries
    const cleanupMs = options.cleanupIntervalMs ?? 60_000;
    if (cleanupMs > 0) {
      this.cleanupInterval = setInterval(() => this.cleanup(), cleanupMs);
      // Don't prevent process exit
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  async save(key: string, context: StoredTraceContext): Promise<void> {
    this.store.set(key, context);
  }

  async load(key: string): Promise<StoredTraceContext | null> {
    const context = this.store.get(key);
    if (!context) {
      return null;
    }

    // Check TTL expiration
    if (context.ttlMs) {
      const age = Date.now() - context.parkedAt;
      if (age > context.ttlMs) {
        this.store.delete(key);
        return null;
      }
    }

    return context;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * Get number of stored contexts (for testing)
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Clear all stored contexts (for testing)
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Stop the cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, context] of this.store.entries()) {
      if (context.ttlMs) {
        const age = now - context.parkedAt;
        if (age > context.ttlMs) {
          this.store.delete(key);
        }
      }
    }
  }
}

// ============================================================================
// Parking Lot Factory
// ============================================================================

/**
 * Create a parking lot for trace context storage and retrieval
 *
 * @param config - Parking lot configuration
 * @returns A parking lot instance
 *
 * @example Basic usage
 * ```typescript
 * const parkingLot = createParkingLot({
 *   store: new InMemoryTraceContextStore(),
 *   defaultTTLMs: 24 * 60 * 60 * 1000, // 24 hours
 * });
 * ```
 *
 * @example With Redis store
 * ```typescript
 * class RedisTraceContextStore implements TraceContextStore {
 *   constructor(private redis: Redis) {}
 *
 *   async save(key: string, context: StoredTraceContext) {
 *     const ttlSeconds = context.ttlMs ? Math.ceil(context.ttlMs / 1000) : 86400;
 *     await this.redis.setex(key, ttlSeconds, JSON.stringify(context));
 *   }
 *
 *   async load(key: string) {
 *     const data = await this.redis.get(key);
 *     return data ? JSON.parse(data) : null;
 *   }
 *
 *   async delete(key: string) {
 *     await this.redis.del(key);
 *   }
 * }
 *
 * const parkingLot = createParkingLot({
 *   store: new RedisTraceContextStore(redis),
 * });
 * ```
 */
export function createParkingLot(config: ParkingLotConfig): ParkingLot {
  const {
    store,
    defaultTTLMs = 24 * 60 * 60 * 1000, // 24 hours
    keyPrefix = 'parkingLot:',
    autoDeleteOnRetrieve = true,
    onMiss,
  } = config;

  /**
   * Get current span context from active context
   */
  function getCurrentSpanContext(): SpanContext | null {
    const activeSpan = otelTrace.getActiveSpan();
    if (!activeSpan) {
      return null;
    }
    return activeSpan.spanContext();
  }

  /**
   * Apply key prefix
   */
  function prefixKey(key: string): string {
    return `${keyPrefix}${key}`;
  }

  const parkingLot: ParkingLot = {
    async park(
      correlationKey: string,
      metadata?: Record<string, string>,
    ): Promise<string> {
      const spanContext = getCurrentSpanContext();
      const fullKey = prefixKey(correlationKey);

      const storedContext: StoredTraceContext = {
        traceId: spanContext?.traceId ?? '',
        spanId: spanContext?.spanId ?? '',
        traceFlags: spanContext?.traceFlags ?? 0,
        parkedAt: Date.now(),
        ttlMs: defaultTTLMs,
        metadata,
      };

      await store.save(fullKey, storedContext);

      // Add event to current span
      const activeSpan = otelTrace.getActiveSpan();
      if (activeSpan) {
        activeSpan.addEvent('trace_context_parked', {
          'parking_lot.correlation_key': correlationKey,
          'parking_lot.ttl_ms': defaultTTLMs,
          ...(metadata &&
            Object.fromEntries(
              Object.entries(metadata).map(([k, v]) => [
                `parking_lot.metadata.${k}`,
                v,
              ]),
            )),
        });
      }

      // Return the unprefixed key so callers can use the same key for retrieve()
      return correlationKey;
    },

    async retrieve(correlationKey: string): Promise<StoredTraceContext | null> {
      const fullKey = prefixKey(correlationKey);
      const storedContext = await store.load(fullKey);

      if (!storedContext) {
        onMiss?.(correlationKey);
        return null;
      }

      if (autoDeleteOnRetrieve) {
        await store.delete(fullKey);
      }

      return storedContext;
    },

    traceCallback<TArgs extends unknown[], TReturn>(
      callbackConfig: CallbackConfig,
    ): (
      fnFactory: (ctx: CallbackContext) => (...args: TArgs) => Promise<TReturn>,
    ) => (...args: TArgs) => Promise<TReturn> {
      return (
        fnFactory: (
          ctx: CallbackContext,
        ) => (...args: TArgs) => Promise<TReturn>,
      ): ((...args: TArgs) => Promise<TReturn>) => {
        return trace<TArgs, TReturn>(
          {
            name: callbackConfig.name,
            spanKind: SpanKind.SERVER,
          },
          (baseCtx) => {
            return async (...args: TArgs) => {
              // Extract correlation key from arguments
              const correlationKey = callbackConfig.correlationKeyFrom(args);

              // Retrieve parked context
              const parkedContext = await parkingLot.retrieve(correlationKey);

              // Calculate elapsed time
              const elapsedMs = parkedContext
                ? Date.now() - parkedContext.parkedAt
                : null;

              // Set span attributes
              baseCtx.setAttribute(
                'parking_lot.correlation_key',
                correlationKey,
              );

              if (parkedContext) {
                baseCtx.setAttribute('parking_lot.elapsed_ms', elapsedMs!);
                baseCtx.setAttribute(
                  'parking_lot.original_trace_id',
                  parkedContext.traceId,
                );
                baseCtx.setAttribute(
                  'parking_lot.original_span_id',
                  parkedContext.spanId,
                );

                // Add metadata as attributes
                if (parkedContext.metadata) {
                  for (const [key, value] of Object.entries(
                    parkedContext.metadata,
                  )) {
                    baseCtx.setAttribute(`parking_lot.metadata.${key}`, value);
                  }
                }

                // Create span link to original trace
                const link = parkingLot.createLink(parkedContext);
                baseCtx.addLinks([link]);

                // Add event
                baseCtx.addEvent('parked_context_retrieved', {
                  'parking_lot.correlation_key': correlationKey,
                  'parking_lot.elapsed_ms': elapsedMs!,
                  'parking_lot.original_trace_id': parkedContext.traceId,
                });
              } else {
                baseCtx.setAttribute('parking_lot.context_found', false);

                if (callbackConfig.requireParkedContext) {
                  const error = new Error(
                    `Required parked context not found for key: ${correlationKey}`,
                  );
                  baseCtx.recordException(error);
                  throw error;
                }
              }

              // Apply custom attributes
              if (callbackConfig.attributes) {
                for (const [key, value] of Object.entries(
                  callbackConfig.attributes,
                )) {
                  baseCtx.setAttribute(key, value);
                }
              }

              // Create extended context
              const callbackCtx: CallbackContext = {
                ...baseCtx,
                parkedContext,
                elapsedMs,
                correlationKey,
              };

              // Execute user's function
              const userFn = fnFactory(callbackCtx);
              return userFn(...args);
            };
          },
        );
      };
    },

    createLink(storedContext: StoredTraceContext): Link {
      return {
        context: {
          traceId: storedContext.traceId,
          spanId: storedContext.spanId,
          traceFlags: storedContext.traceFlags,
          isRemote: true,
        },
        attributes: {
          'link.type': 'parking_lot',
          'parking_lot.parked_at': storedContext.parkedAt,
          ...(storedContext.metadata && {
            'parking_lot.has_metadata': true,
          }),
        },
      };
    },

    async exists(correlationKey: string): Promise<boolean> {
      const fullKey = prefixKey(correlationKey);
      const context = await store.load(fullKey);
      return context !== null;
    },
  };

  return parkingLot;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a correlation key from multiple parts
 *
 * @param parts - Key parts to join
 * @returns A correlation key string
 *
 * @example
 * ```typescript
 * const key = createCorrelationKey('payment', orderId, 'stripe');
 * // Returns: "payment:order-123:stripe"
 * ```
 */
export function createCorrelationKey(...parts: (string | number)[]): string {
  return parts.map(String).join(':');
}

/**
 * Extract span context from stored context for manual linking
 *
 * @param storedContext - The stored trace context
 * @returns SpanContext compatible object
 */
export function toSpanContext(storedContext: StoredTraceContext): SpanContext {
  return {
    traceId: storedContext.traceId,
    spanId: storedContext.spanId,
    traceFlags: storedContext.traceFlags,
    isRemote: true,
  };
}
