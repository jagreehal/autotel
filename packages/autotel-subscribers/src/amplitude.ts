/**
 * Amplitude Subscriber for autotel
 *
 * Send events to Amplitude for product events.
 *
 * @example
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { AmplitudeSubscriber } from 'autotel-subscribers/amplitude';
 *
 * const events = new Events('checkout', {
 *   subscribers: [
 *     new AmplitudeSubscriber({
 *       apiKey: process.env.AMPLITUDE_API_KEY!
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

export interface AmplitudeConfig {
  /** Amplitude API key */
  apiKey: string;
  /** Enable/disable the subscriber */
  enabled?: boolean;
}

export class AmplitudeSubscriber implements EventSubscriber {
  readonly name = 'AmplitudeSubscriber';
  readonly version = '1.0.0';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private amplitudeModule: any = null;
  private enabled: boolean;
  private config: AmplitudeConfig;
  private initPromise: Promise<void> | null = null;

  constructor(config: AmplitudeConfig) {
    this.enabled = config.enabled ?? true;
    this.config = config;

    if (this.enabled) {
      // Start initialization immediately but don't block constructor
      this.initPromise = this.initialize();
    }
  }

  private async initialize(): Promise<void> {
    try {
      // Dynamic import to avoid adding @amplitude/analytics-node as a hard dependency
      // The SDK exports init(), track(), flush() as separate functions
      const amplitude = await import('@amplitude/analytics-node');
      amplitude.init(this.config.apiKey);
      this.amplitudeModule = amplitude;
    } catch (error) {
      console.error(
        'Amplitude subscriber failed to initialize. Install @amplitude/analytics-node: pnpm add @amplitude/analytics-node',
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
    this.amplitudeModule?.track({
      event_type: name,
      user_id: attributes?.userId || attributes?.user_id || 'anonymous',
      event_properties: attributes,
    });
  }

  async trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    this.amplitudeModule?.track({
      event_type: `${funnelName}.${step}`,
      user_id: attributes?.userId || attributes?.user_id || 'anonymous',
      event_properties: {
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
    this.amplitudeModule?.track({
      event_type: `${operationName}.${outcome}`,
      user_id: attributes?.userId || attributes?.user_id || 'anonymous',
      event_properties: {
        operation: operationName,
        outcome,
        ...attributes,
      },
    });
  }

  async trackValue(name: string, value: number, attributes?: EventAttributes): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    this.amplitudeModule?.track({
      event_type: name,
      user_id: attributes?.userId || attributes?.user_id || 'anonymous',
      event_properties: {
        value,
        ...attributes,
      },
    });
  }

  /** Flush pending events before shutdown */
  async shutdown(): Promise<void> {
    await this.ensureInitialized();
    if (this.amplitudeModule) {
      await this.amplitudeModule.flush();
    }
  }
}

