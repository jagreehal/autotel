/**
 * Testing utilities for subscriber authors.
 *
 * Use these to validate your custom subscribers work correctly.
 *
 * @example Test your subscriber
 * ```typescript
 * import { SubscriberTestHarness } from 'autotel-subscribers/testing';
 *
 * const harness = new SubscriberTestHarness(new MySubscriber());
 * const results = await harness.runAll();
 * SubscriberTestHarness.printResults(results);
 * ```
 *
 * @example Test webhook subscriber
 * ```typescript
 * import { MockWebhookServer } from 'autotel-subscribers/testing';
 *
 * const server = new MockWebhookServer();
 * const url = await server.start();
 * const subscriber = new WebhookSubscriber({ url });
 *
 * await subscriber.trackEvent('test', {});
 * expect(server.getRequestCount()).toBe(1);
 *
 * await server.stop();
 * ```
 */

export { SubscriberTestHarness } from './subscriber-test-harness';
export type { TestResult, TestSuiteResult } from './subscriber-test-harness';

export { MockWebhookServer } from './mock-webhook-server';
export type { RecordedRequest, MockServerOptions } from './mock-webhook-server';

// Re-export MockEventSubscriber for convenience
export { MockEventSubscriber } from '../mock-event-subscriber';
