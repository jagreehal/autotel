/**
 * autotel-subscribers
 *
 * Send events to multiple platforms:
 * - PostHog (product events)
 * - Mixpanel (product events)
 * - Amplitude (product events)
 * - Segment (customer data platform)
 * - Slack (team notifications)
 * - Webhook (custom integrations, Zapier, Make.com)
 *
 * @example Multi-platform tracking
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { PostHogSubscriber, MixpanelSubscriber } from 'autotel-subscribers';
 *
 * const events = new Events('checkout', {
 *   subscribers: [
 *     new PostHogSubscriber({ apiKey: 'phc_...' }),
 *     new MixpanelSubscriber({ token: '...' })
 *   ]
 * });
 *
 * // Sent to: OpenTelemetry + PostHog + Mixpanel
 * events.trackEvent('order.completed', { userId: '123', amount: 99.99 });
 * ```
 *
 */

// ============================================================================
// Destination Subscribers (where events go)
// ============================================================================

export { PostHogSubscriber, type PostHogConfig } from './posthog';
export { MixpanelSubscriber, type MixpanelConfig } from './mixpanel';
export { SegmentSubscriber, type SegmentConfig } from './segment';
export { AmplitudeSubscriber, type AmplitudeConfig } from './amplitude';
export { SlackSubscriber, type SlackSubscriberConfig } from './slack';
export { WebhookSubscriber, type WebhookConfig } from './webhook';

// ============================================================================
// Base Classes for Building Custom Subscribers
// ============================================================================

// Standard base class - extend this for custom subscribers
export { EventSubscriber, type EventPayload } from './event-subscriber-base';

// Specialized base class for streaming platforms (Kafka, Kinesis, Pub/Sub)
export { StreamingEventSubscriber } from './streaming-event-subscriber';

