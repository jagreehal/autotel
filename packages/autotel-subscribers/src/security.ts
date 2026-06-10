/**
 * SecuritySubscriber - Forward security events to a webhook, SIEM, or pager
 *
 * Pairs with `autotel-audit`'s security-event schema: track security events
 * through the Events API and this subscriber forwards the ones that matter
 * (severity-gated) to your alerting destination.
 *
 * @example Webhook (SIEM / incident channel)
 * ```typescript
 * import { Events } from 'autotel/events';
 * import { SecuritySubscriber } from 'autotel-subscribers/security';
 *
 * const events = new Events('api', {
 *   subscribers: [
 *     new SecuritySubscriber({
 *       webhookUrl: process.env.SECURITY_WEBHOOK_URL!,
 *       minSeverity: 'error',
 *     }),
 *   ],
 * });
 *
 * events.trackEvent('security.access.tenant.violation', {
 *   category: 'authorization',
 *   outcome: 'denied',
 *   severity: 'critical',
 *   actorId: 'user-1',
 * });
 * ```
 *
 * @example Custom handler (PagerDuty, OpsGenie, internal bus)
 * ```typescript
 * new SecuritySubscriber({
 *   handler: async (alert) => pagerduty.trigger(alert),
 *   minSeverity: 'critical',
 * });
 * ```
 */

import {
  EventSubscriber,
  type EventPayload,
  type AutotelEventContext,
} from './event-subscriber-base';
import type { EventAttributes } from 'autotel/event-subscriber';
import {
  SECURITY_SEVERITY_RANK,
  parseSecuritySeverity,
} from 'autotel/security-schema';
import type { SecuritySeverity } from 'autotel/security-schema';
import { createHttpClient } from './http-client';
import { postJsonWithRetry } from './webhook-delivery';

export type SecurityAlertSeverity = SecuritySeverity;

/** Normalized alert passed to handlers and POSTed to webhooks. */
export interface SecurityAlert {
  /** Full event name, e.g. `security.auth.login.failed`. */
  event: string;
  severity: SecurityAlertSeverity;
  category?: string;
  outcome?: string;
  reason?: string;
  /** Remaining event attributes (severity/category/outcome/reason lifted out). */
  attributes?: EventAttributes;
  /** ISO 8601. */
  timestamp: string;
  /** Trace correlation, when the Events pipeline includes it. */
  trace?: AutotelEventContext;
}

export interface SecuritySubscriberConfig {
  /** POST alerts as JSON to this URL. Required unless `handler` is set. */
  webhookUrl?: string;
  /** Extra headers for the webhook request (e.g. auth). */
  headers?: Record<string, string>;
  /** Custom destination — takes precedence over `webhookUrl`. */
  handler?: (alert: SecurityAlert) => void | Promise<void>;
  /** Forward events at or above this severity. Default `warning`. */
  minSeverity?: SecurityAlertSeverity;
  /**
   * Events are recognized as security events when their name starts with
   * this prefix. Default `security.`.
   */
  eventPrefix?: string;
  /** Extra predicate applied after the prefix/severity gates. */
  filter?: (payload: EventPayload) => boolean;
  /** Enable/disable subscriber. Default true. */
  enabled?: boolean;
  /** Webhook delivery attempts including the first. Default 3. */
  maxRetries?: number;
  /** Webhook request timeout in milliseconds. Default 30_000. */
  timeoutMs?: number;
  /** Base webhook retry backoff; doubles per attempt. Default 1000. */
  retryDelayMs?: number;
}

export class SecuritySubscriber extends EventSubscriber {
  readonly name = 'SecuritySubscriber';
  readonly version = '1.0.0';

  private config: {
    webhookUrl?: string;
    headers: Record<string, string>;
    handler?: (alert: SecurityAlert) => void | Promise<void>;
    minSeverity: SecurityAlertSeverity;
    eventPrefix: string;
    filter?: (payload: EventPayload) => boolean;
    maxRetries?: number;
    retryDelayMs?: number;
  };

  private readonly httpClient;

  constructor(config: SecuritySubscriberConfig) {
    super();

    this.config = {
      webhookUrl: config.webhookUrl,
      headers: config.headers ?? {},
      handler: config.handler,
      minSeverity: config.minSeverity ?? 'warning',
      eventPrefix: config.eventPrefix ?? 'security.',
      filter: config.filter,
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelayMs,
    };
    this.httpClient = createHttpClient({ timeoutMs: config.timeoutMs });

    this.enabled = config.enabled ?? true;

    if (!this.config.webhookUrl && !this.config.handler) {
      console.error(
        '[SecuritySubscriber] No webhookUrl or handler provided - subscriber disabled',
      );
      this.enabled = false;
    }
  }

  protected async sendToDestination(payload: EventPayload): Promise<void> {
    if (!payload.name.startsWith(this.config.eventPrefix)) {
      return; // Not a security event
    }

    const severity = parseSecuritySeverity(payload.attributes?.severity);
    if (
      SECURITY_SEVERITY_RANK[severity] <
      SECURITY_SEVERITY_RANK[this.config.minSeverity]
    ) {
      return; // Below the alerting bar
    }

    const filterFn = this.config.filter;
    if (filterFn && !filterFn(payload)) {
      return;
    }

    const alert = this.toAlert(payload, severity);

    if (this.config.handler) {
      await this.config.handler(alert);
      return;
    }

    await postJsonWithRetry(
      this.httpClient,
      this.config.webhookUrl as string,
      alert,
      {
        headers: this.config.headers,
        maxRetries: this.config.maxRetries,
        retryDelayMs: this.config.retryDelayMs,
        label: 'Security webhook',
      },
    );
  }

  private toAlert(
    payload: EventPayload,
    severity: SecurityAlertSeverity,
  ): SecurityAlert {
    const {
      severity: _severity,
      category,
      outcome,
      reason,
      ...rest
    } = payload.attributes ?? {};

    return {
      event: payload.name,
      severity,
      ...(typeof category === 'string' && { category }),
      ...(typeof outcome === 'string' && { outcome }),
      ...(typeof reason === 'string' && { reason }),
      ...(Object.keys(rest).length > 0 && { attributes: rest }),
      timestamp: payload.timestamp,
      ...(payload.autotel && { trace: payload.autotel }),
    };
  }
}
