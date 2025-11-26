/**
 * Webhook Subscriber for autotel
 *
 * Send events to any webhook endpoint (custom integrations, Zapier, Make.com, etc.).
 *
 * @example
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { WebhookSubscriber } from 'autotel-subscribers/webhook';
 *
 * const events = new Events('checkout', {
 *   subscribers: [
 *     new WebhookSubscriber({
 *       url: 'https://hooks.zapier.com/hooks/catch/...',
 *       headers: { 'X-API-Key': 'secret' }
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

export interface WebhookConfig {
  /** Webhook URL */
  url: string;
  /** Optional headers (e.g., API keys) */
  headers?: Record<string, string>;
  /** Enable/disable the subscriber */
  enabled?: boolean;
  /** Retry failed requests (default: 3) */
  maxRetries?: number;
}

export class WebhookSubscriber implements EventSubscriber {
  readonly name = 'WebhookSubscriber';
  readonly version = '1.0.0';

  private config: WebhookConfig;
  private enabled: boolean;
  private pendingRequests: Set<Promise<void>> = new Set();

  constructor(config: WebhookConfig) {
    this.config = config;
    this.enabled = config.enabled ?? true;
  }

  private async send(payload: any): Promise<void> {
    if (!this.enabled) return;

    const maxRetries = this.config.maxRetries ?? 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(this.config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.config.headers,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
        }

        return; // Success
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    console.error(`Webhook subscriber failed after ${maxRetries} attempts:`, lastError);
  }

  async trackEvent(name: string, attributes?: EventAttributes): Promise<void> {
    const request = this.send({
      type: 'event',
      name,
      attributes,
      timestamp: new Date().toISOString(),
    });
    this.trackRequest(request);
    await request;
  }

  async trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    const request = this.send({
      type: 'funnel',
      funnel: funnelName,
      step,
      attributes,
      timestamp: new Date().toISOString(),
    });
    this.trackRequest(request);
    await request;
  }

  async trackOutcome(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
  ): Promise<void> {
    const request = this.send({
      type: 'outcome',
      operation: operationName,
      outcome,
      attributes,
      timestamp: new Date().toISOString(),
    });
    this.trackRequest(request);
    await request;
  }

  async trackValue(name: string, value: number, attributes?: EventAttributes): Promise<void> {
    const request = this.send({
      type: 'value',
      name,
      value,
      attributes,
      timestamp: new Date().toISOString(),
    });
    this.trackRequest(request);
    await request;
  }

  private trackRequest(request: Promise<void>): void {
    this.pendingRequests.add(request);
    void request.finally(() => {
      this.pendingRequests.delete(request);
    });
  }

  /** Wait for all pending webhook requests to complete */
  async shutdown(): Promise<void> {
    if (this.pendingRequests.size > 0) {
      await Promise.allSettled(this.pendingRequests);
    }
  }
}

