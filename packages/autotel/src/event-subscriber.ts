/**
 * Event Subscriber Interface (Type-only)
 *
 * Import this interface to create custom subscribers without importing implementations.
 * Keeps core package focused on OpenTelemetry with zero extra dependencies.
 *
 * For ready-made subscribers (PostHog, Mixpanel, Amplitude, Segment),
 * see the separate `autotel-subscribers` package.
 *
 * @example Custom subscriber
 * ```typescript
 * import { EventSubscriber } from 'autotel/event-subscriber';
 *
 * class MyCustomSubscriber implements EventSubscriber {
 *   trackEvent(name: string, attributes?: Record<string, any>): void {
 *     // Send to your events platform
 *   }
 *   // ... implement other methods
 * }
 * ```
 *
 * @example Use pre-built subscribers
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { PostHogSubscriber } from 'autotel-subscribers/posthog';
 * import { MixpanelSubscriber } from 'autotel-subscribers/mixpanel';
 *
 * const event =new Event('checkout', {
 *   subscribers: [
 *     new PostHogSubscriber({ apiKey: 'phc_...' }),
 *     new MixpanelSubscriber({ token: '...' })
 *   ]
 * });
 * ```
 */

/**
 * Event attributes (supports any JSON-serializable values)
 *
 * Allows primitive types for flat attributes and unknown for flexibility
 * with nested objects when using subscribers that support JSON payloads
 * (e.g., WebhookSubscriber).
 */
export type EventAttributes = Record<string, unknown>;

/**
 * Permissive input type for event attributes
 *
 * Accepts undefined/null values which will be filtered out before sending.
 * This improves DX when working with optional properties from objects.
 *
 * @example
 * ```typescript
 * // No need to filter out undefined values manually
 * event.trackEvent('user.action', {
 *   userId: user.id,
 *   email: user.email,        // might be undefined
 *   plan: user.subscription,  // might be null
 * });
 * ```
 */
export type EventAttributesInput = Record<
  string,
  string | number | boolean | undefined | null
>;

/**
 * Funnel step status
 */
export type FunnelStatus = 'started' | 'completed' | 'abandoned' | 'failed';

/**
 * Outcome status
 */
export type OutcomeStatus = 'success' | 'failure' | 'partial';

/**
 * Autotel event context for trace correlation
 *
 * This structured object contains trace context and correlation IDs.
 * Subscribers decide how to map/flatten these for their platform.
 */
export interface AutotelEventContext {
  /** Trace ID (32 hex chars) - present when inside a trace */
  trace_id?: string;
  /** Span ID (16 hex chars) - present when inside a span */
  span_id?: string;
  /** Trace flags (2 hex chars, e.g., '01' for sampled) */
  trace_flags?: string;
  /** Raw tracestate string - present if tracestate exists */
  trace_state?: string;
  /** Clickable trace URL - present if traceUrl config is set */
  trace_url?: string;
  /** Correlation ID (always present, 16 hex chars) */
  correlation_id: string;
  /** Number of linked parent traces (batch/fan-in scenarios) */
  linked_trace_id_count?: number;
  /** Stable hash of linked trace IDs (default for batch/fan-in) */
  linked_trace_id_hash?: string;
  /** Full array of linked trace IDs (only if includeLinkedTraceIds: true) */
  linked_trace_ids?: string[];
}

/**
 * Options for event tracking methods
 */
export interface EventTrackingOptions {
  /** Autotel trace context to include in the event */
  autotel?: AutotelEventContext;
}

/**
 * Event subscriber interface
 *
 * Implement this to send events to any platform.
 * Zero runtime dependencies - just types.
 *
 * All tracking methods are async to support:
 * - Backpressure signaling (buffer full)
 * - Streaming platforms (Kafka, Kinesis, Pub/Sub)
 * - Await delivery confirmation
 * - Proper error propagation
 */
export interface EventSubscriber {
  /**
   * Track an event (e.g., "user.registered", "order.created")
   *
   * @param name - Event name
   * @param attributes - Optional event attributes
   * @param options - Optional tracking options including autotel context
   * @returns Promise that resolves when event is sent (or buffered)
   */
  trackEvent(
    name: string,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void>;

  /**
   * Track a funnel step (e.g., checkout: started → completed)
   *
   * @param funnelName - Funnel name
   * @param step - Funnel step status
   * @param attributes - Optional event attributes
   * @param options - Optional tracking options including autotel context
   * @returns Promise that resolves when event is sent (or buffered)
   */
  trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void>;

  /**
   * Track an outcome (e.g., "payment.processing" → success/failure)
   *
   * @param operationName - Operation name
   * @param outcome - Outcome status
   * @param attributes - Optional event attributes
   * @param options - Optional tracking options including autotel context
   * @returns Promise that resolves when event is sent (or buffered)
   */
  trackOutcome(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void>;

  /**
   * Track a value/metric (e.g., revenue, cart value)
   *
   * @param name - Metric name
   * @param value - Numeric value
   * @param attributes - Optional event attributes
   * @param options - Optional tracking options including autotel context
   * @returns Promise that resolves when event is sent (or buffered)
   */
  trackValue(
    name: string,
    value: number,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void>;

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
   * @param options - Optional tracking options including autotel context
   *
   * @example
   * ```typescript
   * // Track custom checkout steps
   * await subscriber.trackFunnelProgression('checkout', 'cart_viewed', 1);
   * await subscriber.trackFunnelProgression('checkout', 'shipping_selected', 2);
   * await subscriber.trackFunnelProgression('checkout', 'payment_entered', 3);
   * await subscriber.trackFunnelProgression('checkout', 'order_confirmed', 4);
   * ```
   */
  trackFunnelProgression?(
    funnelName: string,
    stepName: string,
    stepNumber?: number,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void>;

  /**
   * Optional: Flush pending events and clean up resources
   *
   * Implement this if your subscriber buffers events, maintains connections,
   * or needs cleanup before shutdown. Called during graceful shutdown.
   *
   * @example
   * ```typescript
   * class MySubscriber implements EventSubscriber {
   *   async shutdown(): Promise<void> {
   *     await this.flushBuffer();
   *     await this.closeConnections();
   *   }
   * }
   * ```
   */
  shutdown?(): Promise<void>;

  /**
   * Optional: Subscriber name for debugging and error reporting
   *
   * @example "PostHogSubscriber", "SnowflakeSubscriber", "CustomWebhookSubscriber"
   */
  readonly name?: string;

  /**
   * Optional: Subscriber version for debugging
   *
   * @example "1.0.0"
   */
  readonly version?: string;
}
