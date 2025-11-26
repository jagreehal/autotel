/**
 * Factory functions for creating events subscribers
 *
 * Function-based alternatives to `new SubscriberClass()` pattern.
 * Provides a consistent API and better tree-shaking.
 *
 * @example
 * ```typescript
 * import { createPostHogSubscriber, createWebhookSubscriber } from 'autotel-subscribers/factories'
 *
 * const events = new Events('my-service', {
 *   subscribers: [
 *     createPostHogSubscriber({ apiKey: 'phc_...' }),
 *     createWebhookSubscriber({ url: 'https://...' })
 *   ]
 * })
 * ```
 */

import { PostHogSubscriber } from './posthog';
import { MixpanelSubscriber } from './mixpanel';
import { AmplitudeSubscriber } from './amplitude';
import { SegmentSubscriber } from './segment';
import { WebhookSubscriber } from './webhook';
import { SlackSubscriber } from './slack';
import { MockEventSubscriber } from './mock-event-subscriber';

import type { EventSubscriber, EventAttributes, OutcomeStatus, FunnelStatus } from 'autotel/event-subscriber';

// Re-export config types
export type { PostHogConfig } from './posthog';
export type { MixpanelConfig } from './mixpanel';
export type { AmplitudeConfig } from './amplitude';
export type { SegmentConfig } from './segment';
export type { WebhookConfig } from './webhook';
export type { SlackSubscriberConfig } from './slack';

/**
 * Create a PostHog events subscriber
 *
 * @example
 * ```typescript
 * const posthog = createPostHogSubscriber({
 *   apiKey: 'phc_...',
 *   host: 'https://app.posthog.com' // optional
 * })
 * ```
 */
export function createPostHogSubscriber(config: {
  apiKey: string;
  host?: string;
  enabled?: boolean;
}): EventSubscriber {
  return new PostHogSubscriber(config);
}

/**
 * Create a Mixpanel events subscriber
 *
 * @example
 * ```typescript
 * const mixpanel = createMixpanelSubscriber({
 *   token: 'YOUR_TOKEN'
 * })
 * ```
 */
export function createMixpanelSubscriber(config: {
  token: string;
  enabled?: boolean;
}): EventSubscriber {
  return new MixpanelSubscriber(config);
}

/**
 * Create an Amplitude events subscriber
 *
 * @example
 * ```typescript
 * const amplitude = createAmplitudeSubscriber({
 *   apiKey: 'YOUR_API_KEY'
 * })
 * ```
 */
export function createAmplitudeSubscriber(config: {
  apiKey: string;
  enabled?: boolean;
}): EventSubscriber {
  return new AmplitudeSubscriber(config);
}

/**
 * Create a Segment events subscriber
 *
 * @example
 * ```typescript
 * const segment = createSegmentSubscriber({
 *   writeKey: 'YOUR_WRITE_KEY'
 * })
 * ```
 */
export function createSegmentSubscriber(config: {
  writeKey: string;
  enabled?: boolean;
}): EventSubscriber {
  return new SegmentSubscriber(config);
}

/**
 * Create a Webhook events subscriber
 *
 * @example
 * ```typescript
 * const webhook = createWebhookSubscriber({
 *   url: 'https://your-webhook-endpoint.com/events',
 *   headers: { 'Authorization': 'Bearer token' }
 * })
 * ```
 */
export function createWebhookSubscriber(config: {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  enabled?: boolean;
}): EventSubscriber {
  return new WebhookSubscriber(config);
}

/**
 * Create a Slack events subscriber
 *
 * @example
 * ```typescript
 * const slack = createSlackSubscriber({
 *   webhookUrl: 'https://hooks.slack.com/services/...',
 *   channel: '#events'
 * })
 * ```
 */
export function createSlackSubscriber(config: {
  webhookUrl: string;
  channel?: string;
  enabled?: boolean;
}): EventSubscriber {
  return new SlackSubscriber(config);
}


/**
 * Create a mock events subscriber (for testing)
 *
 * @example
 * ```typescript
 * const mock = createMockSubscriber()
 *
 * // Capture events
 * events.trackEvent('test.event', { foo: 'bar' })
 *
 * // Assert
 * expect(mock.events).toHaveLength(1)
 * expect(mock.events[0].name).toBe('test.event')
 * ```
 */
export function createMockSubscriber(): MockEventSubscriber {
  return new MockEventSubscriber();
}

/**
 * Compose multiple subscribers into one
 *
 * @example
 * ```typescript
 * const multiSubscriber = composeSubscribers([
 *   createPostHogSubscriber({ apiKey: '...' }),
 *   createWebhookSubscriber({ url: '...' })
 * ])
 * ```
 */
export function composeSubscribers(adapters: EventSubscriber[]): EventSubscriber {
  return {
    name: 'ComposedSubscriber',
    async trackEvent(name: string, attributes: EventAttributes) {
      await Promise.all(adapters.map(a => a.trackEvent(name, attributes)));
    },
    async trackFunnelStep(funnel: string, step: FunnelStatus, attributes: EventAttributes) {
      await Promise.all(adapters.map(a => a.trackFunnelStep(funnel, step, attributes)));
    },
    async trackOutcome(operation: string, outcome: OutcomeStatus, attributes: EventAttributes) {
      await Promise.all(adapters.map(a => a.trackOutcome(operation, outcome, attributes)));
    },
    async trackValue(name: string, value: number, attributes: EventAttributes) {
      await Promise.all(adapters.map(a => a.trackValue(name, value, attributes)));
    },
    async shutdown() {
      await Promise.all(adapters.map(a => a.shutdown?.()));
    },
  };
}
