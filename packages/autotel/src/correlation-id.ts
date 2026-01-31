/**
 * Correlation ID utilities for event-driven observability
 *
 * Provides a stable join key across events, logs, and spans even when traces fragment.
 * Format: 16 hex chars (64 bits), crypto-random, URL-safe.
 *
 * Lifecycle:
 * 1. Generated at boundary root (HTTP server span, message process span, cron job span)
 * 2. Reused within context (nested work shares it via AsyncLocalStorage)
 * 3. Propagated via baggage (optional, default OFF to avoid header bloat)
 *
 * @example Basic usage
 * ```typescript
 * import { generateCorrelationId, getCorrelationId } from 'autotel/correlation-id';
 *
 * // Generate a new correlation ID
 * const id = generateCorrelationId();
 * // Returns: 'a1b2c3d4e5f67890'
 *
 * // Get current correlation ID from context
 * const currentId = getCorrelationId();
 * ```
 */

import { trace, propagation, context } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * AsyncLocalStorage for storing correlation ID
 * This allows correlation IDs to persist across async boundaries
 */
const correlationStorage = new AsyncLocalStorage<string>();

/**
 * Baggage key for correlation ID propagation
 */
export const CORRELATION_ID_BAGGAGE_KEY = 'autotel.correlation_id';

/**
 * Generate a new correlation ID
 *
 * Format: 16 hex chars (64 bits), crypto-random, URL-safe
 *
 * @returns A new correlation ID
 *
 * @example
 * ```typescript
 * const id = generateCorrelationId();
 * // Returns: 'a1b2c3d4e5f67890'
 * ```
 */
export function generateCorrelationId(): string {
  // Use crypto.getRandomValues for secure random bytes
  const bytes = new Uint8Array(8); // 64 bits
  crypto.getRandomValues(bytes);

  // Convert to hex string
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get the current correlation ID from context
 *
 * Resolution order:
 * 1. AsyncLocalStorage (from explicit setCorrelationId or runWithCorrelationId)
 * 2. Baggage (if propagated from upstream)
 * 3. Active span's trace ID (first 16 chars as fallback)
 * 4. undefined (if not in any context)
 *
 * @returns Current correlation ID or undefined
 *
 * @example
 * ```typescript
 * const id = getCorrelationId();
 * if (id) {
 *   console.log('Correlation ID:', id);
 * }
 * ```
 */
export function getCorrelationId(): string | undefined {
  // 1. Check AsyncLocalStorage first (explicit correlation ID)
  const storedId = correlationStorage.getStore();
  if (storedId) {
    return storedId;
  }

  // 2. Check baggage (propagated from upstream)
  const activeContext = context.active();
  const baggage = propagation.getBaggage(activeContext);
  const baggageEntry = baggage?.getEntry(CORRELATION_ID_BAGGAGE_KEY);
  if (baggageEntry?.value) {
    return baggageEntry.value;
  }

  // 3. Fall back to active span's trace ID (first 16 chars)
  const span = trace.getActiveSpan();
  if (span) {
    const spanContext = span.spanContext();
    return spanContext.traceId.slice(0, 16);
  }

  // 4. No context available
  return undefined;
}

/**
 * Get or create a correlation ID
 *
 * If a correlation ID exists in the current context, returns it.
 * Otherwise, generates a new one.
 *
 * @returns Existing or new correlation ID
 *
 * @example
 * ```typescript
 * const id = getOrCreateCorrelationId();
 * // Always returns a valid correlation ID
 * ```
 */
export function getOrCreateCorrelationId(): string {
  return getCorrelationId() ?? generateCorrelationId();
}

/**
 * Run a function with a specific correlation ID in context
 *
 * The correlation ID will be available via getCorrelationId() throughout
 * the execution of the function and any async operations it spawns.
 *
 * @param correlationId - Correlation ID to use
 * @param fn - Function to execute
 * @returns The return value of the function
 *
 * @example
 * ```typescript
 * await runWithCorrelationId('abc123', async () => {
 *   // getCorrelationId() returns 'abc123' here
 *   await processRequest();
 * });
 * ```
 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationStorage.run(correlationId, fn);
}

/**
 * Set correlation ID in the current context (mutates context)
 *
 * Note: This updates the AsyncLocalStorage context. For proper scoping
 * across async boundaries, prefer runWithCorrelationId() instead.
 *
 * @param correlationId - Correlation ID to set
 *
 * @example
 * ```typescript
 * setCorrelationId('abc123');
 * // Now getCorrelationId() returns 'abc123'
 * ```
 */
export function setCorrelationId(correlationId: string): void {
  correlationStorage.enterWith(correlationId);
}

/**
 * Set correlation ID in baggage for propagation
 *
 * This adds the correlation ID to the W3C baggage header, allowing it
 * to be propagated to downstream services.
 *
 * Note: Only use this when you explicitly want cross-service propagation.
 * Default is OFF to avoid header bloat.
 *
 * @param correlationId - Correlation ID to propagate
 * @returns New context with baggage set
 *
 * @example
 * ```typescript
 * const newContext = setCorrelationIdInBaggage('abc123');
 * context.with(newContext, () => {
 *   // Baggage will be propagated in outgoing requests
 * });
 * ```
 */
export function setCorrelationIdInBaggage(
  correlationId: string,
): import('@opentelemetry/api').Context {
  const activeContext = context.active();
  let baggage =
    propagation.getBaggage(activeContext) ?? propagation.createBaggage();
  baggage = baggage.setEntry(CORRELATION_ID_BAGGAGE_KEY, {
    value: correlationId,
  });
  return propagation.setBaggage(activeContext, baggage);
}

/**
 * Get the correlation storage instance (for internal use in init/shutdown)
 */
export function getCorrelationStorage(): AsyncLocalStorage<string> {
  return correlationStorage;
}
