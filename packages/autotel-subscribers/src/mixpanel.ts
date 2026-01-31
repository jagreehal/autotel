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
  EventTrackingOptions,
  AutotelEventContext,
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

  /**
   * Map autotel context to Mixpanel properties
   *
   * Mixpanel uses standard snake_case field names:
   * - autotel.trace_id → trace_id
   * - autotel.span_id → span_id
   * - autotel.correlation_id → correlation_id
   */
  private mapAutotelContext(
    autotel?: AutotelEventContext,
  ): Record<string, unknown> {
    if (!autotel) return {};

    const mapped: Record<string, unknown> = {};

    if (autotel.trace_id) {
      mapped.trace_id = autotel.trace_id;
    }
    if (autotel.span_id) {
      mapped.span_id = autotel.span_id;
    }
    if (autotel.correlation_id) {
      mapped.correlation_id = autotel.correlation_id;
    }
    if (autotel.trace_flags) {
      mapped.trace_flags = autotel.trace_flags;
    }
    if (autotel.trace_state) {
      mapped.trace_state = autotel.trace_state;
    }
    if (autotel.trace_url) {
      mapped.trace_url = autotel.trace_url;
    }
    // Batch/fan-in context
    if (autotel.linked_trace_id_count !== undefined) {
      mapped.linked_trace_id_count = autotel.linked_trace_id_count;
    }
    if (autotel.linked_trace_id_hash) {
      mapped.linked_trace_id_hash = autotel.linked_trace_id_hash;
    }
    if (autotel.linked_trace_ids) {
      mapped.linked_trace_ids = autotel.linked_trace_ids;
    }

    return mapped;
  }

  async trackEvent(
    name: string,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    const distinctId = attributes?.userId || attributes?.user_id || 'anonymous';
    const autotelProps = this.mapAutotelContext(options?.autotel);

    this.mixpanel?.track(name, {
      distinct_id: distinctId,
      ...attributes,
      ...autotelProps,
    });
  }

  async trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    const distinctId = attributes?.userId || attributes?.user_id || 'anonymous';
    const autotelProps = this.mapAutotelContext(options?.autotel);

    this.mixpanel?.track(`${funnelName}.${step}`, {
      distinct_id: distinctId,
      funnel: funnelName,
      step,
      ...attributes,
      ...autotelProps,
    });
  }

  async trackOutcome(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    const distinctId = attributes?.userId || attributes?.user_id || 'anonymous';
    const autotelProps = this.mapAutotelContext(options?.autotel);

    this.mixpanel?.track(`${operationName}.${outcome}`, {
      distinct_id: distinctId,
      operation: operationName,
      outcome,
      ...attributes,
      ...autotelProps,
    });
  }

  async trackValue(
    name: string,
    value: number,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    if (!this.enabled) return;

    await this.ensureInitialized();
    const distinctId = attributes?.userId || attributes?.user_id || 'anonymous';
    const autotelProps = this.mapAutotelContext(options?.autotel);

    this.mixpanel?.track(name, {
      distinct_id: distinctId,
      value,
      ...attributes,
      ...autotelProps,
    });
  }
}
