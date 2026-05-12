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
import {
  mapHttpStatus,
  SubscriberProviderError,
  isProviderRetriable,
} from './retry-classification';

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

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async send(payload: unknown): Promise<void> {
    if (!this.enabled) return;

    const maxRetries = this.config.maxRetries ?? 3;
    const retryDelayMs = this.config.retryDelayMs ?? 1000;
    const method = this.config.method ?? 'POST';
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const response = await this.httpClient.request<unknown, unknown>(
        this.config.url,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...this.config.headers,
          },
          body: JSON.stringify(payload),
          timeoutMs: this.config.timeoutMs,
        },
      );

      if (response.ok) return;

      if (response.kind === 'network') {
        lastError = new SubscriberProviderError({
          message: response.timedOut
            ? 'Webhook request timed out'
            : 'Webhook network request failed',
          code: 'NETWORK',
          retriable: true,
          details: response.cause,
          cause: response.cause,
        });
      } else {
        const mapped = mapHttpStatus(response.status);
        lastError = new SubscriberProviderError({
          message: `Webhook returned ${response.status}: ${response.statusText}`,
          code: mapped.code,
          retriable: mapped.retriable,
          details: response.body,
        });
      }

      const canRetry = isProviderRetriable(lastError) && attempt < maxRetries;
      if (!canRetry) break;

      const backoffMs = retryDelayMs * 2 ** (attempt - 1);
      await this.delay(backoffMs);
    }

    throw lastError ?? new Error('Webhook send failed');
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
