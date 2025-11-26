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
} from './init';
import { validateEvent } from './validation';

// Global events queue (initialized on first track call)
let eventsQueue: EventQueue | null = null;

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

  queue.enqueue({
    name: validated.eventName,
    attributes: enrichedData,
    timestamp: Date.now(),
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
