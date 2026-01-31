/**
 * Global track() function for business events
 *
 * Simple, no instantiation needed, auto-attaches trace context
 */

import { trace } from '@opentelemetry/api';
import { EventQueue } from './event-queue';
import {
  getConfig,
  warnIfNotInitialized,
  isInitialized,
  getValidationConfig,
  getEventsConfig,
} from './init';
import { validateEvent } from './validation';
import { getOrCreateCorrelationId } from './correlation-id';
import type { AutotelEventContext } from './event-subscriber';

// Global events queue (initialized on first track call)
let eventsQueue: EventQueue | null = null;

/**
 * Build autotel event context for trace correlation
 *
 * Works in multiple contexts:
 * 1. Inside a span → use current span's trace_id + span_id
 * 2. Outside span → use correlation_id only
 * 3. With trace URL config → include clickable trace URL
 */
function buildAutotelContext(
  span: ReturnType<typeof trace.getActiveSpan>,
): AutotelEventContext | undefined {
  const eventsConfig = getEventsConfig();
  const config = getConfig();

  // Always generate a correlation_id
  const correlationId = getOrCreateCorrelationId();

  // Return minimal context if trace context is not enabled
  if (!eventsConfig?.includeTraceContext) {
    return {
      correlation_id: correlationId,
    };
  }

  // Build base context
  const autotelContext: AutotelEventContext = {
    correlation_id: correlationId,
  };

  // Add trace context if inside a span
  const spanContext = span?.spanContext();
  if (spanContext) {
    autotelContext.trace_id = spanContext.traceId;
    autotelContext.span_id = spanContext.spanId;

    // Trace flags as 2-char hex string (canonical format)
    autotelContext.trace_flags = spanContext.traceFlags
      .toString(16)
      .padStart(2, '0');

    // Tracestate if present
    // Defensive: serialize() is standard OTel API but may be missing in some runtimes
    const traceState = spanContext.traceState;
    if (traceState) {
      try {
        if (typeof traceState.serialize === 'function') {
          const traceStateStr = traceState.serialize();
          if (traceStateStr) {
            autotelContext.trace_state = traceStateStr;
          }
        }
      } catch {
        // Silently ignore serialization errors
      }
    }

    // Generate trace URL if configured
    if (eventsConfig.traceUrl && config) {
      const traceUrl = eventsConfig.traceUrl({
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        correlationId,
        serviceName: config.service,
        environment: config.environment,
      });
      if (traceUrl) {
        autotelContext.trace_url = traceUrl;
      }
    }
  } else {
    // Outside span but may still have trace URL generator
    if (eventsConfig.traceUrl && config) {
      const traceUrl = eventsConfig.traceUrl({
        correlationId,
        serviceName: config.service,
        environment: config.environment,
      });
      if (traceUrl) {
        autotelContext.trace_url = traceUrl;
      }
    }
  }

  return autotelContext;
}

/**
 * Initialize events queue lazily
 */
function getOrCreateQueue(): EventQueue | null {
  if (!isInitialized()) {
    warnIfNotInitialized('track()');
    return null;
  }

  if (!eventsQueue) {
    const config = getConfig();
    if (!config?.subscribers || config.subscribers.length === 0) {
      // No subscribers configured - no-op
      return null;
    }

    eventsQueue = new EventQueue(config.subscribers);
  }

  return eventsQueue;
}

/**
 * Track a business events event
 *
 * Features:
 * - Auto-attaches traceId and spanId if in active span
 * - Batched sending with retry
 * - Type-safe with optional generic
 * - No-op if init() not called or no subscribers configured
 *
 * @example Basic usage
 * ```typescript
 * track('user.signup', { userId: '123', plan: 'pro' })
 * ```
 *
 * @example With type safety
 * ```typescript
 * interface EventDatas {
 *   'user.signup': { userId: string; plan: string }
 *   'plan.upgraded': { userId: string; revenue: number }
 * }
 *
 * track<EventDatas>('user.signup', { userId: '123', plan: 'pro' })
 * ```
 *
 * @example Trace correlation (automatic)
 * ```typescript
 * @Instrumented()
 * class UserService {
 *   async createUser(data: CreateUserData) {
 *     // This track call automatically includes traceId + spanId
 *     track('user.signup', { userId: data.id })
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function track<Events extends Record<string, any> = Record<string, any>>(
  event: keyof Events & string,
  data?: Events[typeof event],
): void {
  const queue = getOrCreateQueue();
  if (!queue) return; // No-op if not initialized or no subscribers

  // Validate and sanitize input (with custom config if provided)
  const validationConfig = getValidationConfig();
  const validated = validateEvent(event, data, validationConfig || undefined);

  // Auto-attach trace context if available (free win!)
  const span = trace.getActiveSpan();
  const enrichedData = span
    ? {
        ...validated.attributes,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
      }
    : validated.attributes;

  // Build autotel context (same as Event class)
  const autotelContext = buildAutotelContext(span);

  queue.enqueue({
    name: validated.eventName,
    attributes: enrichedData,
    timestamp: Date.now(),
    autotel: autotelContext,
  });
}

/**
 * Get events queue (for flush/shutdown)
 * @internal
 */
export function getEventQueue(): EventQueue | null {
  return eventsQueue;
}

/**
 * Reset events queue (for shutdown/cleanup)
 * @internal
 */
export function resetEventQueue(): void {
  eventsQueue = null;
}
