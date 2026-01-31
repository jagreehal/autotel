/**
 * Events API for product events platforms
 *
 * Track user behavior, business events, and critical actions.
 * Sends to product events platforms (PostHog, Mixpanel, Amplitude) via subscribers.
 * For business people who think in events/funnels.
 *
 * For OpenTelemetry metrics (Prometheus/Grafana), use the Metrics class instead.
 *
 * @example Recommended: Configure subscribers in init(), use track() function
 * ```typescript
 * import { init, track } from 'autotel';
 * import { PostHogSubscriber } from 'autotel-subscribers/posthog';
 *
 * init({
 *   service: 'my-app',
 *   subscribers: [new PostHogSubscriber({ apiKey: 'phc_...' })]
 * });
 *
 * // Track events - uses subscribers from init()
 * track('application.submitted', { jobId: '123', userId: '456' });
 * ```
 *
 * @example Create Event instance (inherits subscribers from init)
 * ```typescript
 * import { Event } from 'autotel/event';
 *
 * // Uses subscribers configured in init()
 * const event = new Event('job-application');
 * event.trackEvent('application.submitted', { jobId: '123' });
 * ```
 *
 * @example Override subscribers for specific Event instance
 * ```typescript
 * import { Event } from 'autotel/event';
 * import { PostHogSubscriber } from 'autotel-subscribers/posthog';
 *
 * // Override: use different subscribers for this instance
 * const event = new Event('job-application', {
 *   subscribers: [new PostHogSubscriber({ apiKey: 'phc_different_project' })]
 * });
 *
 * event.trackEvent('application.submitted', { jobId: '123' });
 * ```
 */

import { trace, propagation, context, TraceFlags } from '@opentelemetry/api';
import { type Logger } from './logger';
import {
  getLogger,
  getValidationConfig,
  getConfig,
  getEventsConfig,
} from './init';
import {
  type EventSubscriber,
  type EventAttributes,
  type EventAttributesInput,
  type FunnelStatus,
  type OutcomeStatus,
  type AutotelEventContext,
} from './event-subscriber';
import { type EventCollector } from './event-testing';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';
import { validateEvent } from './validation';
import { getOperationContext } from './operation-context';
import {
  type EnrichFromBaggageConfig,
  hashValue,
  hashLinkedTraceIds,
} from './events-config';
import { getOrCreateCorrelationId } from './correlation-id';

// Re-export types for convenience
export type {
  EventAttributes,
  EventAttributesInput,
  FunnelStatus,
  OutcomeStatus,
} from './event-subscriber';

/**
 * Events class for tracking user behavior and product events
 *
 * Track critical indicators such as:
 * - User events (signups, purchases, feature usage)
 * - Conversion funnels (signup → activation → purchase)
 * - Business outcomes (success/failure rates)
 * - Product metrics (revenue, engagement, retention)
 *
 * All events are sent to events platforms via subscribers (PostHog, Mixpanel, etc.).
 * For OpenTelemetry metrics, use the Metrics class instead.
 */
/**
 * Events options
 */
export interface EventsOptions {
  /** Optional logger for audit trail */
  logger?: Logger;
  /** Optional collector for testing (captures events in memory) */
  collector?: EventCollector;
  /**
   * Optional subscribers to send events to other platforms
   * (e.g., PostHog, Mixpanel, Amplitude)
   *
   * **Subscriber Resolution**:
   * - If provided → uses these subscribers (instance override)
   * - If not provided → falls back to subscribers from `init()` (global config)
   * - If neither → no subscribers (events logged only)
   *
   * Install `autotel-subscribers` package for ready-made subscribers
   */
  subscribers?: EventSubscriber[];
}

export class Event {
  private serviceName: string;
  private logger?: Logger;
  private collector?: EventCollector;
  private subscribers: EventSubscriber[];
  private hasSubscribers: boolean; // Cached for performance
  private circuitBreakers: Map<EventSubscriber, CircuitBreaker>; // One per subscriber

  /**
   * Create a new Event instance
   *
   * **Note**: Most users should use `init()` + `track()` instead of creating Event instances directly.
   *
   * **Subscriber Resolution**:
   * - If `subscribers` provided in options → uses those (instance override)
   * - If `subscribers` not provided → falls back to subscribers from `init()` (global config)
   * - If neither → no subscribers (events logged only)
   *
   * @param serviceName - Service name for identifying events
   * @param options - Optional configuration (logger, collector, subscribers)
   *
   * @example Recommended: Use track() with init()
   * ```typescript
   * import { init, track } from 'autotel';
   * import { PostHogSubscriber } from 'autotel-subscribers/posthog';
   *
   * init({
   *   service: 'checkout',
   *   subscribers: [new PostHogSubscriber({ apiKey: 'phc_...' })]
   * });
   *
   * track('purchase.completed', { amount: 99.99 });
   * ```
   *
   * @example Inherit subscribers from init()
   * ```typescript
   * // Uses subscribers configured in init()
   * const event = new Event('checkout');
   * event.trackEvent('purchase.completed', { amount: 99.99 });
   * ```
   *
   * @example Override subscribers for this instance
   * ```typescript
   * import { Event } from 'autotel/event';
   * import { PostHogSubscriber } from 'autotel-subscribers/posthog';
   *
   * // Override: use different subscribers for this instance only
   * const event = new Event('checkout', {
   *   subscribers: [new PostHogSubscriber({ apiKey: 'phc_different_project' })]
   * });
   * ```
   */
  constructor(serviceName: string, options: EventsOptions = {}) {
    this.serviceName = serviceName;
    this.logger = options.logger;
    this.collector = options.collector;

    // Subscriber resolution: instance-level overrides global init() config
    // If subscribers provided to constructor, use those
    // Otherwise, fall back to subscribers from init()
    this.subscribers =
      options.subscribers === undefined
        ? getConfig()?.subscribers || []
        : options.subscribers;

    this.hasSubscribers = this.subscribers.length > 0; // Cache for hot path

    // Create circuit breaker for each subscriber
    this.circuitBreakers = new Map();
    for (const subscriber of this.subscribers) {
      const subscriberName = subscriber.name || 'Unknown';
      this.circuitBreakers.set(
        subscriber,
        new CircuitBreaker(subscriberName, {
          failureThreshold: 5,
          resetTimeout: 30_000, // 30s
          windowSize: 60_000, // 1min
        }),
      );
    }
  }

  /**
   * Automatically enrich attributes with all available telemetry context
   *
   * Auto-captures:
   * - Resource attributes: service.version, deployment.environment
   * - Trace context: traceId, spanId, correlationId
   * - Operation context: operation.name
   */
  private enrichWithTelemetryContext(
    attributes: EventAttributes = {},
  ): EventAttributes {
    const enriched: EventAttributes = {
      service: this.serviceName,
      ...attributes,
    };

    // 1. Resource attributes (service-level context)
    const config = getConfig();
    if (config) {
      if (config.version) {
        enriched['service.version'] = config.version;
      }
      if (config.environment) {
        enriched['deployment.environment'] = config.environment;
      }
    }

    // 2. Trace context (if inside a traced operation)
    const span = trace.getActiveSpan();
    const spanContext = span?.spanContext();
    if (spanContext) {
      enriched.traceId = spanContext.traceId;
      enriched.spanId = spanContext.spanId;
      // Add correlation ID (first 16 chars of trace ID) for easier log grouping
      enriched.correlationId = spanContext.traceId.slice(0, 16);
    }

    // 3. Operation context (if inside a trace/span)
    const operationContext = getOperationContext();
    if (operationContext) {
      enriched['operation.name'] = operationContext.name;
    }

    return enriched;
  }

  /**
   * Build autotel event context for trace correlation
   *
   * Works in 4 contexts:
   * 1. Inside a span → use current span's trace_id + span_id
   * 2. Outside span but in AsyncLocalStorage context → use trace_id + correlation_id
   * 3. Totally standalone → use correlation_id + service/env/version
   * 4. Batch/fan-in (multiple linked parents) → use count + hash or full array
   *
   * @returns AutotelEventContext or undefined if trace context is disabled
   */
  private buildAutotelContext(): AutotelEventContext | undefined {
    const eventsConfig = getEventsConfig();

    // Return undefined if trace context is not enabled
    if (!eventsConfig?.includeTraceContext) {
      // Still generate correlation_id even without full trace context
      // This provides a stable join key across events/logs/spans
      return {
        correlation_id: getOrCreateCorrelationId(),
      };
    }

    const config = getConfig();
    const span = trace.getActiveSpan();
    const spanContext = span?.spanContext();

    // Always generate a correlation_id
    const correlationId = getOrCreateCorrelationId();

    // Build base context
    const autotelContext: AutotelEventContext = {
      correlation_id: correlationId,
    };

    // Add trace context if inside a span
    if (spanContext) {
      autotelContext.trace_id = spanContext.traceId;
      autotelContext.span_id = spanContext.spanId;

      // Trace flags as 2-char hex string (canonical format)
      autotelContext.trace_flags = spanContext.traceFlags
        .toString(16)
        .padStart(2, '0');

      // Tracestate if present
      const traceState = spanContext.traceState;
      if (traceState) {
        // Convert TraceState to string representation safely
        let traceStateStr = '';
        try {
          if (typeof traceState.serialize === 'function') {
            traceStateStr = traceState.serialize();
          }
        } catch {
          // Silently ignore serialization errors - traceState is optional metadata
        }
        if (traceStateStr) {
          autotelContext.trace_state = traceStateStr;
        }
      }

      // Generate trace URL if configured
      if (eventsConfig.traceUrl) {
        const traceUrl = eventsConfig.traceUrl({
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
          correlationId,
          serviceName: config?.service || this.serviceName,
          environment: config?.environment,
        });
        if (traceUrl) {
          autotelContext.trace_url = traceUrl;
        }
      }

      // Handle linked spans (batch/fan-in scenarios)
      // Note: This would require access to span links which are not easily accessible
      // from the public OpenTelemetry API. For now, we skip this unless we have
      // explicit linked trace IDs passed in.
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
   * Enrich event attributes from baggage with guardrails
   *
   * @param attributes - Current event attributes
   * @returns Enriched attributes with baggage values
   */
  private enrichFromBaggage(attributes: EventAttributes): EventAttributes {
    const eventsConfig = getEventsConfig();
    const enrichConfig = eventsConfig?.enrichFromBaggage;

    if (!enrichConfig) {
      return attributes;
    }

    const enriched = { ...attributes };
    const activeContext = context.active();
    const baggage = propagation.getBaggage(activeContext);

    if (!baggage) {
      return enriched;
    }

    let keyCount = 0;
    let byteCount = 0;
    const maxKeys = enrichConfig.maxKeys ?? 10;
    const maxBytes = enrichConfig.maxBytes ?? 1024;
    const prefix = enrichConfig.prefix ?? '';

    // Get all baggage entries
    for (const [key, entry] of baggage.getAllEntries()) {
      // Check if key is allowed
      if (!this.isBaggageKeyAllowed(key, enrichConfig)) {
        continue;
      }

      // Check limits
      if (keyCount >= maxKeys) {
        break;
      }

      const value = entry.value;

      // Apply transform first so maxBytes is checked against transformed size (e.g. hash output)
      const transform = enrichConfig.transform?.[key];
      let transformedValue: string;

      if (transform === 'hash') {
        transformedValue = hashValue(value);
      } else if (transform === 'plain' || !transform) {
        transformedValue = value;
      } else if (typeof transform === 'function') {
        transformedValue = transform(value);
      } else {
        transformedValue = value;
      }

      const valueBytes = new TextEncoder().encode(transformedValue).length;

      if (byteCount + valueBytes > maxBytes) {
        continue; // Skip this entry if transformed value would exceed byte limit
      }

      // Add to enriched attributes with prefix
      const enrichedKey = `${prefix}${key}`;
      enriched[enrichedKey] = transformedValue;

      keyCount++;
      byteCount += valueBytes;
    }

    return enriched;
  }

  /**
   * Check if a baggage key is allowed based on config
   */
  private isBaggageKeyAllowed(
    key: string,
    config: EnrichFromBaggageConfig,
  ): boolean {
    // Check deny list first (takes precedence)
    if (config.deny) {
      for (const pattern of config.deny) {
        if (this.matchesBaggagePattern(key, pattern)) {
          return false;
        }
      }
    }

    // Check allow list
    for (const pattern of config.allow) {
      if (this.matchesBaggagePattern(key, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a key matches a baggage pattern
   * Supports exact matches and wildcard patterns (e.g., 'tenant.*')
   */
  private matchesBaggagePattern(key: string, pattern: string): boolean {
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return key.startsWith(prefix + '.');
    }
    return key === pattern;
  }

  /**
   * Track a business event
   *
   * Use this for tracking user actions, business events, product usage:
   * - "user.signup"
   * - "order.completed"
   * - "feature.used"
   *
   * Events are sent to configured subscribers (PostHog, Mixpanel, etc.).
   *
   * @example
   * ```typescript
   * // Track user signup
   * events.trackEvent('user.signup', {
   *   userId: '123',
   *   plan: 'pro'
   * })
   *
   * // Track order
   * events.trackEvent('order.completed', {
   *   orderId: 'ord_123',
   *   amount: 99.99
   * })
   * ```
   */
  trackEvent(eventName: string, attributes?: EventAttributes): void {
    // Validate and sanitize input (with custom config if provided)
    const validationConfig = getValidationConfig();
    const validated = validateEvent(
      eventName,
      attributes,
      validationConfig || undefined,
    );

    // Auto-attach all available telemetry context
    const enrichedAttributes = this.enrichWithTelemetryContext(
      validated.attributes,
    );

    this.logger?.info(
      {
        event: validated.eventName,
        attributes: enrichedAttributes,
      },
      'Event tracked',
    );

    // Record for testing
    this.collector?.recordEvent({
      event: validated.eventName,
      attributes: enrichedAttributes,
      service: this.serviceName,
      timestamp: Date.now(),
    });

    // Notify subscribers (zero overhead if no subscribers)
    // Run in background - don't block event recording
    if (this.hasSubscribers) {
      // Build autotel context for trace correlation
      const autotelContext = this.buildAutotelContext();

      // Enrich from baggage if configured
      const finalAttributes = this.enrichFromBaggage(enrichedAttributes);

      void this.notifySubscribers((subscriber) =>
        subscriber.trackEvent(validated.eventName, finalAttributes, {
          autotel: autotelContext,
        }),
      );
    }
  }

  /**
   * Notify all subscribers concurrently without blocking
   * Uses circuit breakers to protect against failing subscribers
   * Uses Promise.allSettled to prevent subscriber errors from affecting other subscribers
   */
  private async notifySubscribers(
    fn: (subscriber: EventSubscriber) => Promise<void>,
  ): Promise<void> {
    const promises = this.subscribers.map(async (subscriber) => {
      const circuitBreaker = this.circuitBreakers.get(subscriber);
      if (!circuitBreaker) return; // Should never happen

      try {
        // Execute with circuit breaker protection
        await circuitBreaker.execute(() => fn(subscriber));
      } catch (error) {
        // Handle circuit open errors (expected behavior when subscriber is down)
        if (error instanceof CircuitOpenError) {
          // Circuit is open - subscriber is down, log at warn level for visibility (same behavior in all environments)
          getLogger().warn(
            {
              subscriberName: subscriber.name || 'Unknown',
            },
            `[Events] ${error.message}`,
          );
          return;
        }

        // Log other subscriber errors but don't throw - event failures shouldn't break business logic
        getLogger().error(
          {
            err: error instanceof Error ? error : undefined,
            subscriberName: subscriber.name || 'Unknown',
          },
          `[Events] Subscriber ${subscriber.name || 'Unknown'} failed`,
        );
      }
    });

    // Wait for all subscribers (success or failure)
    await Promise.allSettled(promises);
  }

  /**
   * Track conversion funnel steps
   *
   * Monitor where users drop off in multi-step processes.
   *
   * @example
   * ```typescript
   * // Track signup funnel
   * events.trackFunnelStep('signup', 'started', { userId: '123' })
   * events.trackFunnelStep('signup', 'email_verified', { userId: '123' })
   * events.trackFunnelStep('signup', 'completed', { userId: '123' })
   *
   * // Track checkout flow
   * events.trackFunnelStep('checkout', 'started', { cartValue: 99.99 })
   * events.trackFunnelStep('checkout', 'payment_info', { cartValue: 99.99 })
   * events.trackFunnelStep('checkout', 'completed', { cartValue: 99.99 })
   * ```
   */
  trackFunnelStep(
    funnelName: string,
    status: FunnelStatus,
    attributes?: EventAttributes,
  ): void {
    // Auto-attach all available telemetry context
    const enrichedAttributes = this.enrichWithTelemetryContext(attributes);

    this.logger?.info(
      {
        funnel: funnelName,
        status,
        attributes: enrichedAttributes,
      },
      'Funnel step tracked',
    );

    // Record for testing
    this.collector?.recordFunnelStep({
      funnel: funnelName,
      status,
      attributes: enrichedAttributes,
      service: this.serviceName,
      timestamp: Date.now(),
    });

    // Notify subscribers
    if (this.hasSubscribers) {
      const autotelContext = this.buildAutotelContext();
      const finalAttributes = this.enrichFromBaggage(enrichedAttributes);

      void this.notifySubscribers((subscriber) =>
        subscriber.trackFunnelStep(funnelName, status, finalAttributes, {
          autotel: autotelContext,
        }),
      );
    }
  }

  /**
   * Track outcomes (success/failure/partial)
   *
   * Monitor success rates of critical operations.
   *
   * @example
   * ```typescript
   * // Track email delivery
   * events.trackOutcome('email.delivery', 'success', {
   *   recipientType: 'user',
   *   emailType: 'welcome'
   * })
   *
   * events.trackOutcome('email.delivery', 'failure', {
   *   recipientType: 'user',
   *   errorCode: 'invalid_email'
   * })
   *
   * // Track payment processing
   * events.trackOutcome('payment.process', 'success', { amount: 99.99 })
   * events.trackOutcome('payment.process', 'failure', { error: 'insufficient_funds' })
   * ```
   */
  trackOutcome(
    operationName: string,
    status: OutcomeStatus,
    attributes?: EventAttributes,
  ): void {
    // Auto-attach all available telemetry context
    const enrichedAttributes = this.enrichWithTelemetryContext(attributes);

    this.logger?.info(
      {
        operation: operationName,
        status,
        attributes: enrichedAttributes,
      },
      'Outcome tracked',
    );

    // Record for testing
    this.collector?.recordOutcome({
      operation: operationName,
      status,
      attributes: enrichedAttributes,
      service: this.serviceName,
      timestamp: Date.now(),
    });

    // Notify subscribers
    if (this.hasSubscribers) {
      const autotelContext = this.buildAutotelContext();
      const finalAttributes = this.enrichFromBaggage(enrichedAttributes);

      void this.notifySubscribers((subscriber) =>
        subscriber.trackOutcome(operationName, status, finalAttributes, {
          autotel: autotelContext,
        }),
      );
    }
  }

  /**
   * Track value metrics
   *
   * Record numerical values like revenue, transaction amounts,
   * item counts, processing times, engagement scores, etc.
   *
   * @example
   * ```typescript
   * // Track revenue
   * events.trackValue('order.revenue', 149.99, {
   *   currency: 'USD',
   *   productCategory: 'electronics'
   * })
   *
   * // Track items per cart
   * events.trackValue('cart.item_count', 5, {
   *   userId: '123'
   * })
   *
   * // Track processing time
   * events.trackValue('api.response_time', 250, {
   *   unit: 'ms',
   *   endpoint: '/api/checkout'
   * })
   * ```
   */
  trackValue(
    metricName: string,
    value: number,
    attributes?: EventAttributes,
  ): void {
    // Auto-attach all available telemetry context
    const enrichedAttributes = this.enrichWithTelemetryContext({
      metric: metricName,
      ...attributes,
    });

    this.logger?.debug(
      {
        metric: metricName,
        value,
        attributes: enrichedAttributes,
      },
      'Value tracked',
    );

    // Record for testing
    this.collector?.recordValue({
      metric: metricName,
      value,
      attributes: enrichedAttributes,
      service: this.serviceName,
      timestamp: Date.now(),
    });

    // Notify subscribers
    if (this.hasSubscribers) {
      const autotelContext = this.buildAutotelContext();
      const finalAttributes = this.enrichFromBaggage(enrichedAttributes);

      void this.notifySubscribers((subscriber) =>
        subscriber.trackValue(metricName, value, finalAttributes, {
          autotel: autotelContext,
        }),
      );
    }
  }

  /**
   * Flush all subscribers and wait for pending events
   *
   * Call this before shutdown to ensure all events are delivered.
   *
   * @example
   * ```typescript
   * const event =new Event('app', { subscribers: [...] });
   *
   * // Before shutdown
   * await events.flush();
   * ```
   */
  async flush(): Promise<void> {
    if (!this.hasSubscribers) return;

    const shutdownPromises = this.subscribers.map(async (subscriber) => {
      if (subscriber.shutdown) {
        try {
          await subscriber.shutdown();
        } catch (error) {
          getLogger().error(
            {
              err: error instanceof Error ? error : undefined,
              subscriberName: subscriber.name || 'Unknown',
            },
            `[Events] Failed to shutdown subscriber ${subscriber.name || 'Unknown'}`,
          );
        }
      }
    });

    await Promise.allSettled(shutdownPromises);
  }

  /**
   * Shutdown the Event instance and all subscribers
   *
   * Unlike `flush()`, this method:
   * - Shuts down all subscribers
   * - Prevents further event tracking (hasSubscribers becomes false)
   * - Should only be called once at application shutdown
   *
   * @example
   * ```typescript
   * // In Next.js API route with after()
   * import { after } from 'next/server';
   *
   * export async function POST(req: Request) {
   *   const event = new Event('checkout', { subscribers: [...] });
   *   event.trackEvent('order.completed', { orderId: '123' });
   *
   *   after(async () => {
   *     await event.shutdown();
   *   });
   *
   *   return Response.json({ success: true });
   * }
   * ```
   */
  async shutdown(): Promise<void> {
    if (!this.hasSubscribers) return;

    await Promise.allSettled(
      this.subscribers.map(async (subscriber) => {
        if (subscriber.shutdown) {
          try {
            await subscriber.shutdown();
          } catch (error) {
            getLogger().error(
              {
                err: error instanceof Error ? error : undefined,
                subscriberName: subscriber.name || 'Unknown',
              },
              `[Events] Failed to shutdown subscriber ${subscriber.name || 'Unknown'}`,
            );
          }
        }
      }),
    );

    // Prevent further tracking after shutdown
    this.hasSubscribers = false;
  }

  /**
   * Track funnel progression with custom step names
   *
   * Unlike trackFunnelStep which uses FunnelStatus enum values,
   * this method allows any string as the step name for flexible funnel tracking.
   *
   * @param funnelName - Name of the funnel (e.g., "checkout", "onboarding")
   * @param stepName - Custom step name (e.g., "cart_viewed", "payment_entered")
   * @param stepNumber - Optional numeric position in the funnel
   * @param attributes - Optional event attributes
   *
   * @example
   * ```typescript
   * // Track custom checkout steps
   * event.trackFunnelProgression('checkout', 'cart_viewed', 1);
   * event.trackFunnelProgression('checkout', 'shipping_selected', 2);
   * event.trackFunnelProgression('checkout', 'payment_entered', 3);
   * event.trackFunnelProgression('checkout', 'order_confirmed', 4);
   * ```
   */
  trackFunnelProgression(
    funnelName: string,
    stepName: string,
    stepNumber?: number,
    attributes?: EventAttributes,
  ): void {
    // Auto-attach all available telemetry context
    const enrichedAttributes = this.enrichWithTelemetryContext(attributes);

    this.logger?.info(
      {
        funnel: funnelName,
        stepName,
        stepNumber,
        attributes: enrichedAttributes,
      },
      'Funnel progression tracked',
    );

    // Record for testing (as funnel step with custom name)
    this.collector?.recordFunnelStep({
      funnel: funnelName,
      status: stepName as FunnelStatus, // Cast for testing collector
      attributes: {
        ...enrichedAttributes,
        step_name: stepName,
        ...(stepNumber === undefined ? {} : { step_number: stepNumber }),
      },
      service: this.serviceName,
      timestamp: Date.now(),
    });

    // Notify subscribers that support trackFunnelProgression
    if (this.hasSubscribers) {
      const autotelContext = this.buildAutotelContext();
      const finalAttributes = this.enrichFromBaggage(enrichedAttributes);

      void this.notifySubscribers(async (subscriber) => {
        await (subscriber.trackFunnelProgression
          ? subscriber.trackFunnelProgression(
              funnelName,
              stepName,
              stepNumber,
              finalAttributes,
              { autotel: autotelContext },
            )
          : // Fall back to trackFunnelStep with step as custom name (cast)
            subscriber.trackFunnelStep(
              funnelName,
              stepName as FunnelStatus,
              {
                ...finalAttributes,
                step_name: stepName,
                ...(stepNumber === undefined
                  ? {}
                  : { step_number: stepNumber }),
              },
              { autotel: autotelContext },
            ));
      });
    }
  }

  /**
   * Track multiple events in a batch
   *
   * Useful for bulk event tracking with consistent timestamps.
   * Events are sent to subscribers individually but processed together.
   *
   * @param events - Array of events to track
   *
   * @example
   * ```typescript
   * event.trackBatch([
   *   { name: 'item.viewed', attributes: { itemId: '1' } },
   *   { name: 'item.viewed', attributes: { itemId: '2' } },
   *   { name: 'cart.updated', attributes: { itemCount: 2 } },
   * ]);
   * ```
   */
  trackBatch(
    events: Array<{ name: string; attributes?: EventAttributesInput }>,
  ): void {
    // Filter attributes and track each event
    for (const event of events) {
      // Filter undefined/null values from attributes
      const filteredAttributes = event.attributes
        ? (Object.fromEntries(
            Object.entries(event.attributes).filter(
              ([, v]) => v !== undefined && v !== null,
            ),
          ) as EventAttributes)
        : undefined;

      this.trackEvent(event.name, filteredAttributes);
    }
  }
}

/**
 * Global events instances (singleton pattern)
 */
const eventsInstances = new Map<string, Event>();

/**
 * Get or create an Events instance for a service
 *
 * @param serviceName - Service name for identifying events
 * @param logger - Optional logger
 * @returns Events instance
 *
 * @example
 * ```typescript
 * const event =getEvents('job-application')
 * events.trackEvent('application.submitted', { jobId: '123' })
 * ```
 */
export function getEvents(serviceName: string, logger?: Logger): Event {
  if (!eventsInstances.has(serviceName)) {
    eventsInstances.set(serviceName, new Event(serviceName, { logger }));
  }
  return eventsInstances.get(serviceName)!;
}

/**
 * Reset all events instances (mainly for testing)
 */
export function resetEvents(): void {
  eventsInstances.clear();
}
