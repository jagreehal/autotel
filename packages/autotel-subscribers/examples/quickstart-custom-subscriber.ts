/**
 * QUICKSTART: Your First Custom Subscriber in 5 Minutes
 *
 * This template shows you EVERYTHING you need to write a custom events subscriber.
 * Just copy-paste this code and replace the console.log statements with your API calls.
 *
 * @example
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { MyFirstSubscriber } from './my-first-subscriber';
 *
 * const event =new Event('my-app', {
 *   subscribers: [new MyFirstSubscriber()]
 * });
 *
 * events.trackEvent('user.signup', { userId: '123', email: 'user@example.com' });
 * ```
 */

import type { EventSubscriber, EventAttributes, FunnelStatus, OutcomeStatus } from '../src/event-subscriber-base';

export class MyFirstSubscriber implements EventSubscriber {
  // Required: Subscriber name (shows up in logs)
  readonly name = 'MyFirstSubscriber';

  // Optional: Version for debugging
  readonly version = '1.0.0';

  /**
   * Track a business event (e.g., "user.signup", "order.completed")
   */
  async trackEvent(name: string, attributes?: EventAttributes): Promise<void> {
    console.log('📊 EVENT:', name, attributes);

    // TODO: Replace with your API call
    // Example:
    // await fetch('https://your-api.com/events', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ event: name, properties: attributes })
    // });
  }

  /**
   * Track a funnel step (e.g., checkout flow: "started" → "completed")
   */
  async trackFunnelStep(
    funnel: string,
    step: FunnelStatus,
    attributes?: EventAttributes
  ): Promise<void> {
    console.log('🔄 FUNNEL:', funnel, step, attributes);

    // TODO: Replace with your API call
    // Most platforms just treat this as a regular event:
    // await this.trackEvent(`${funnel}.${step}`, { ...attributes, funnel, step });
  }

  /**
   * Track an operation outcome (e.g., payment: "success" or "failure")
   */
  async trackOutcome(
    operation: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes
  ): Promise<void> {
    console.log('✅ OUTCOME:', operation, outcome, attributes);

    // TODO: Replace with your API call
    // await this.trackEvent(`${operation}.${outcome}`, { ...attributes, operation, outcome });
  }

  /**
   * Track a numeric value (e.g., revenue, response time)
   */
  async trackValue(
    name: string,
    value: number,
    attributes?: EventAttributes
  ): Promise<void> {
    console.log('💰 VALUE:', name, value, attributes);

    // TODO: Replace with your API call
    // await this.trackEvent(name, { ...attributes, value });
  }

  /**
   * Optional: Cleanup on shutdown
   * Use this to flush buffered events, close connections, etc.
   */
  async shutdown(): Promise<void> {
    console.log('👋 SHUTDOWN');

    // TODO: Add cleanup logic
    // Example:
    // await this.flushBuffer();
    // await this.httpClient.close();
  }
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

// Uncomment to test:
// import { Events } from 'autotel/events';
//
// const events = new Events('my-app', {
//   subscribers: [new MyFirstSubscriber()]
// });
//
// // Track events
// await events.trackEvent('user.signup', {
//   userId: 'user-123',
//   email: 'user@example.com',
//   plan: 'pro'
// });
//
// await events.trackFunnelStep('checkout', 'started', {
//   cartValue: 99.99
// });
//
// await events.trackOutcome('payment', 'success', {
//   amount: 99.99,
//   method: 'credit_card'
// });
//
// await events.trackValue('revenue', 99.99, {
//   currency: 'USD',
//   orderId: 'ord-456'
// });
//
// // Cleanup
// await events.shutdown();

// ============================================================================
// NEXT STEPS
// ============================================================================

// 1. Copy this file to your project
// 2. Rename "MyFirstSubscriber" to your service name (e.g., "AmplitudeSubscriber")
// 3. Replace console.log with your API calls
// 4. Test it! (see examples/testing-custom-adapter.ts)
// 5. Add error handling and retry logic (see docs/adapter-guide.md)
