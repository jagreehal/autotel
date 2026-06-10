/**
 * Webhook Subscriber for autotel
 */

import type {
  EventSubscriber,
  EventAttributes,
  EventTrackingOptions,
  FunnelStatus,
  OutcomeStatus,
} from 'autotel/event-subscriber';
import { createHttpClient } from './http-client';
import { postJsonWithRetry } from './webhook-delivery';

export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  maxRetries?: number;
  method?: 'POST' | 'PUT';
  timeoutMs?: number;
  retryDelayMs?: number;
}

export class WebhookSubscriber implements EventSubscriber {
  readonly name = 'WebhookSubscriber';
  readonly version = '1.1.0';

  private readonly config: WebhookConfig;
  private enabled: boolean;
  private readonly pendingRequests: Set<Promise<void>> = new Set();
  private readonly httpClient;

  constructor(config: WebhookConfig) {
    this.config = config;
    this.enabled = config.enabled ?? true;
    this.httpClient = createHttpClient({ timeoutMs: config.timeoutMs });
  }

  private async send(payload: unknown): Promise<void> {
    if (!this.enabled) return;

    await postJsonWithRetry(this.httpClient, this.config.url, payload, {
      method: this.config.method,
      headers: this.config.headers,
      maxRetries: this.config.maxRetries,
      retryDelayMs: this.config.retryDelayMs,
      label: 'Webhook',
    });
  }

  async trackEvent(
    name: string,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    const request = this.send({
      type: 'event',
      name,
      attributes,
      timestamp: new Date().toISOString(),
      autotel: options?.autotel,
    });
    this.trackRequest(request);
    await request;
  }

  async trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    const request = this.send({
      type: 'funnel',
      funnel: funnelName,
      step,
      attributes,
      timestamp: new Date().toISOString(),
      autotel: options?.autotel,
    });
    this.trackRequest(request);
    await request;
  }

  async trackOutcome(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    const request = this.send({
      type: 'outcome',
      operation: operationName,
      outcome,
      attributes,
      timestamp: new Date().toISOString(),
      autotel: options?.autotel,
    });
    this.trackRequest(request);
    await request;
  }

  async trackValue(
    name: string,
    value: number,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    const request = this.send({
      type: 'value',
      name,
      value,
      attributes,
      timestamp: new Date().toISOString(),
      autotel: options?.autotel,
    });
    this.trackRequest(request);
    await request;
  }

  private trackRequest(request: Promise<void>): void {
    this.pendingRequests.add(request);
    void request.catch(() => {}).finally(() => {
      this.pendingRequests.delete(request);
    });
  }

  async shutdown(): Promise<void> {
    if (this.pendingRequests.size > 0) {
      await Promise.allSettled(this.pendingRequests);
    }
  }
}
