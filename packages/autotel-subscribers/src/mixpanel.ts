/**
 * Mixpanel Subscriber for autotel
 *
 * Send events to Mixpanel for product events.
 *
 * @example
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { MixpanelSubscriber } from 'autotel-subscribers/mixpanel';
 *
 * const events = new Events('checkout', {
 *   subscribers: [
 *     new MixpanelSubscriber({
 *       token: process.env.MIXPANEL_TOKEN!
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

export interface MixpanelConfig {
  /** Mixpanel project token */
  token: string;
  /** Enable/disable the subscriber */
  enabled?: boolean;
}

export class MixpanelSubscriber implements EventSubscriber {
  readonly name = 'MixpanelSubscriber';
  readonly version = '1.0.0';

  private mixpanel: any;
  private enabled: boolean;
  private config: MixpanelConfig;
  private initPromise: Promise<void> | null = null;

  constructor(config: MixpanelConfig) {
    this.enabled = config.enabled ?? true;
    this.config = config;

    if (this.enabled) {
      // Start initialization immediately but don't block constructor
      this.initPromise = this.initialize();
    }
  }

  private async initialize(): Promise<void> {
    try {
      // Dynamic import to avoid adding mixpanel as a hard dependency
      const Mixpanel = await import('mixpanel');
      this.mixpanel = Mixpanel.default.init(this.config.token);
    } catch (error) {
      console.error(
        'Mixpanel subscriber failed to initialize. Install mixpanel: pnpm add mixpanel',
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
    const distinctId = attributes?.userId || attributes?.user_id || 'anonymous';
    this.mixpanel?.track(name, {
      distinct_id: distinctId,
      ...attributes,
    });
  }

  async trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    const distinctId = attributes?.userId || attributes?.user_id || 'anonymous';
    this.mixpanel?.track(`${funnelName}.${step}`, {
      distinct_id: distinctId,
      funnel: funnelName,
      step,
      ...attributes,
    });
  }

  async trackOutcome(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    const distinctId = attributes?.userId || attributes?.user_id || 'anonymous';
    this.mixpanel?.track(`${operationName}.${outcome}`, {
      distinct_id: distinctId,
      operation: operationName,
      outcome,
      ...attributes,
    });
  }

  async trackValue(name: string, value: number, attributes?: EventAttributes): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    const distinctId = attributes?.userId || attributes?.user_id || 'anonymous';
    this.mixpanel?.track(name, {
      distinct_id: distinctId,
      value,
      ...attributes,
    });
  }
}

