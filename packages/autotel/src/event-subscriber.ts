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
