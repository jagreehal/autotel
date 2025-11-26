/**
 * Segment Subscriber for autotel
 *
 * Send events to Segment (customer data platform).
 *
 * @example
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { SegmentSubscriber } from 'autotel-subscribers/segment';
 *
 * const events = new Events('checkout', {
 *   subscribers: [
 *     new SegmentSubscriber({
 *       writeKey: process.env.SEGMENT_WRITE_KEY!
 *     })
 *   ]
 * });
 *
 * events.trackEvent('order.completed', { userId: '123', amount: 99.99 });
 * ```
 */

import type {
  EventSubscriber,
  EventAttributes,
  FunnelStatus,
  OutcomeStatus,
} from 'autotel/event-subscriber';

export interface SegmentConfig {
  /** Segment write key */
  writeKey: string;
  /** Enable/disable the subscriber */
  enabled?: boolean;
}

export class SegmentSubscriber implements EventSubscriber {
  readonly name = 'SegmentSubscriber';
  readonly version = '1.0.0';

  private events: any;
  private enabled: boolean;
  private config: SegmentConfig;
  private initPromise: Promise<void> | null = null;

  constructor(config: SegmentConfig) {
    this.enabled = config.enabled ?? true;
    this.config = config;

    if (this.enabled) {
      // Start initialization immediately but don't block constructor
      this.initPromise = this.initialize();
    }
  }

  private async initialize(): Promise<void> {
    try {
      // Dynamic import to avoid adding @segment/events-node as a hard dependency
      const { Analytics } = await import('@segment/analytics-node');
      this.events = new Analytics({ writeKey: this.config.writeKey });
    } catch (error) {
      console.error(
        'Segment subscriber failed to initialize. Install @segment/events-node: pnpm add @segment/events-node',
        error,
      );
      this.enabled = false;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
  }

  async trackEvent(name: string, attributes?: EventAttributes): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    this.events?.track({
      userId: attributes?.userId || attributes?.user_id || 'anonymous',
      event: name,
      properties: attributes,
    });
  }

  async trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    this.events?.track({
      userId: attributes?.userId || attributes?.user_id || 'anonymous',
      event: `${funnelName}.${step}`,
      properties: {
        funnel: funnelName,
        step,
        ...attributes,
      },
    });
  }

  async trackOutcome(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    this.events?.track({
      userId: attributes?.userId || attributes?.user_id || 'anonymous',
      event: `${operationName}.${outcome}`,
      properties: {
        operation: operationName,
        outcome,
        ...attributes,
      },
    });
  }

  async trackValue(name: string, value: number, attributes?: EventAttributes): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    this.events?.track({
      userId: attributes?.userId || attributes?.user_id || 'anonymous',
      event: name,
      properties: {
        value,
        ...attributes,
      },
    });
  }

  /** Flush pending events before shutdown */
  async shutdown(): Promise<void> {
    await this.ensureInitialized();
    if (this.events) {
      await this.events.closeAndFlush();
    }
  }
}

