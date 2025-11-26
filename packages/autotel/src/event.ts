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

import { trace } from '@opentelemetry/api';
import { type Logger } from './logger';
import { getLogger, getValidationConfig, getConfig } from './init';
import {
  type EventSubscriber,
  type EventAttributes,
  type FunnelStatus,
  type OutcomeStatus,
} from './event-subscriber';
import { type EventCollector } from './event-testing';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';
import { validateEvent } from './validation';
import { getOperationContext } from './operation-context';

// Re-export types for convenience
export type {
  EventAttributes,
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

    this.logger?.info('Event tracked', {
      event: validated.eventName,
      attributes: enrichedAttributes,
    });

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
      void this.notifySubscribers((subscriber) =>
        subscriber.trackEvent(validated.eventName, enrichedAttributes),
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
          getLogger().warn(`[Events] ${error.message}`, {
            subscriberName: subscriber.name || 'Unknown',
          });
          return;
        }

        // Log other subscriber errors but don't throw - event failures shouldn't break business logic
        getLogger().error(
          `[Events] Subscriber ${subscriber.name || 'Unknown'} failed`,
          error instanceof Error ? error : undefined,
          { subscriberName: subscriber.name || 'Unknown' },
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

    this.logger?.info('Funnel step tracked', {
      funnel: funnelName,
      status,
      attributes: enrichedAttributes,
    });

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
      void this.notifySubscribers((subscriber) =>
        subscriber.trackFunnelStep(funnelName, status, enrichedAttributes),
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

    this.logger?.info('Outcome tracked', {
      operation: operationName,
      status,
      attributes: enrichedAttributes,
    });

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
      void this.notifySubscribers((subscriber) =>
        subscriber.trackOutcome(operationName, status, enrichedAttributes),
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

    this.logger?.debug('Value tracked', {
      metric: metricName,
      value,
      attributes: enrichedAttributes,
    });

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
      void this.notifySubscribers((subscriber) =>
        subscriber.trackValue(metricName, value, enrichedAttributes),
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
            `[Events] Failed to shutdown subscriber ${subscriber.name || 'Unknown'}`,
            error instanceof Error ? error : undefined,
            { subscriberName: subscriber.name || 'Unknown' },
          );
        }
      }
    });

    await Promise.allSettled(shutdownPromises);
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
