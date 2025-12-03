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
 */
export type EventAttributes = Record<string, string | number | boolean>;

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
   * @returns Promise that resolves when event is sent (or buffered)
   */
  trackEvent(name: string, attributes?: EventAttributes): Promise<void>;

  /**
   * Track a funnel step (e.g., checkout: started → completed)
   *
   * @returns Promise that resolves when event is sent (or buffered)
   */
  trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
  ): Promise<void>;

  /**
   * Track an outcome (e.g., "payment.processing" → success/failure)
   *
   * @returns Promise that resolves when event is sent (or buffered)
   */
  trackOutcome(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
  ): Promise<void>;

  /**
   * Track a value/metric (e.g., revenue, cart value)
   *
   * @returns Promise that resolves when event is sent (or buffered)
   */
  trackValue(
    name: string,
    value: number,
    attributes?: EventAttributes,
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
