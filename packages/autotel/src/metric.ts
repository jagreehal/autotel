/**
 * Metrics API for OpenTelemetry
 *
 * Track business metrics for OpenTelemetry (Prometheus/Grafana).
 * For business people who think in metrics.
 *
 * @example Track business metrics
 * ```typescript
 * const metrics = new Metric('checkout')
 *
 * // Track events as metrics
 * metrics.trackEvent('order.completed', {
 *   amount: 99.99,
 *   currency: 'USD'
 * })
 *
 * // Track conversion funnels
 * metrics.trackFunnelStep('checkout', 'started', { cartValue: 99.99 })
 * metrics.trackFunnelStep('checkout', 'completed', { cartValue: 99.99 })
 *
 * // Track outcomes
 * metrics.trackOutcome('payment.process', 'success', { amount: 99.99 })
 * metrics.trackOutcome('payment.process', 'failure', { error: 'insufficient_funds' })
 *
 * // Track values
 * metrics.trackValue('revenue', 149.99, { currency: 'USD' })
 * ```
 */

import {
  type Counter,
  type Histogram,
  type Attributes,
} from '@opentelemetry/api';
import { getConfig } from './config';
import { type Logger } from './logger';
import {
  type EventAttributes,
  type FunnelStatus,
  type OutcomeStatus,
} from './event-subscriber';
import { type MetricsCollector } from './metric-testing';

// Re-export types for convenience
export type {
  EventAttributes,
  FunnelStatus,
  OutcomeStatus,
} from './event-subscriber';

/**
 * Metrics class for tracking business metrics in OpenTelemetry
 *
 * Track critical business indicators such as:
 * - User events (signups, purchases, feature usage) as metrics
 * - Conversion funnels (signup → activation → purchase)
 * - Business outcomes (success/failure rates)
 * - Value metrics (revenue, counts, etc.)
 *
 * All metrics are sent to OpenTelemetry (OTLP/Prometheus/Grafana).
 */
/**
 * Metric configuration for customizing metric names and descriptions
 */
export interface MetricConfig {
  /** Metric name (e.g., 'metrics.events' or 'custom.events') */
  name?: string;
  /** Metric description */
  description?: string;
  /** Metric unit (default: '1') */
  unit?: string;
}

/**
 * Metrics options
 */
export interface MetricsOptions {
  /** Optional logger for audit trail */
  logger?: Logger;
  /** Optional collector for testing (captures metrics in memory) */
  collector?: MetricsCollector;

  /**
   * Namespace for metrics (default: 'metrics')
   * Results in metrics like: {serviceName}.{namespace}.events
   */
  namespace?: string;

  /**
   * Custom metric configurations
   * Override metric names, descriptions, and units
   */
  metrics?: {
    events?: MetricConfig;
    funnel?: MetricConfig;
    outcomes?: MetricConfig;
    value?: MetricConfig;
  };
}

export class Metric {
  private serviceName: string;
  private eventCounter: Counter;
  private funnelCounter: Counter;
  private outcomeCounter: Counter;
  private valueHistogram: Histogram;
  private logger?: Logger;
  private collector?: MetricsCollector;

  /**
   * Create a new Metrics instance
   *
   * @param serviceName - Service name for metric namespacing
   * @param options - Optional configuration (logger, collector, namespace, metrics)
   *
   * @example Basic usage (default 'metrics' namespace)
   * ```typescript
   * const metrics = new Metric('checkout');
   * // Creates: checkout.metrics.events, checkout.metrics.funnel, etc.
   * ```
   *
   * @example Custom namespace
   * ```typescript
   * const metrics = new Metric('api', { namespace: 'business' });
   * // Creates: api.business.events, api.business.funnel, etc.
   * ```
   *
   * @example Custom metric names and descriptions
   * ```typescript
   * const metrics = new Metric('payments', {
   *   metrics: {
   *     outcomes: {
   *       name: 'payments.transactions',
   *       description: 'Payment transaction outcomes',
   *       unit: 'transactions'
   *     },
   *     value: {
   *       name: 'payments.revenue',
   *       description: 'Payment revenue in USD',
   *       unit: 'USD'
   *     }
   *   }
   * });
   * ```
   */
  constructor(serviceName: string, options: MetricsOptions = {}) {
    this.serviceName = serviceName;
    this.logger = options.logger;
    this.collector = options.collector;

    const config = getConfig();
    const meter = config.meter;

    // Default namespace and metric configurations
    const namespace = options.namespace || 'metrics';
    const metricsConfig = options.metrics || {};

    // Event counter configuration
    const eventsConfig = metricsConfig.events || {};
    this.eventCounter = meter.createCounter(
      eventsConfig.name || `${serviceName}.${namespace}.events`,
      {
        description: eventsConfig.description || 'Count of business events',
        unit: eventsConfig.unit || '1',
      },
    );

    // Funnel counter configuration
    const funnelConfig = metricsConfig.funnel || {};
    this.funnelCounter = meter.createCounter(
      funnelConfig.name || `${serviceName}.${namespace}.funnel`,
      {
        description: funnelConfig.description || 'Conversion funnel tracking',
        unit: funnelConfig.unit || '1',
      },
    );

    // Outcome counter configuration
    const outcomesConfig = metricsConfig.outcomes || {};
    this.outcomeCounter = meter.createCounter(
      outcomesConfig.name || `${serviceName}.${namespace}.outcomes`,
      {
        description:
          outcomesConfig.description || 'Outcome tracking (success/failure)',
        unit: outcomesConfig.unit || '1',
      },
    );

    // Value histogram configuration
    const valueConfig = metricsConfig.value || {};
    this.valueHistogram = meter.createHistogram(
      valueConfig.name || `${serviceName}.${namespace}.value`,
      {
        description:
          valueConfig.description || 'Value metrics (revenue, counts, etc.)',
        unit: valueConfig.unit || '1',
      },
    );
  }

  /**
   * Track a business event as a metric
   *
   * Use this for tracking user actions, business events, product usage as metrics:
   * - "user.signup"
   * - "order.completed"
   * - "feature.used"
   *
   * @example
   * ```typescript
   * // Track user signup as metric
   * metrics.trackEvent('user.signup', {
   *   userId: '123',
   *   plan: 'pro'
   * })
   *
   * // Track order as metric
   * metrics.trackEvent('order.completed', {
   *   orderId: 'ord_123',
   *   amount: 99.99
   * })
   * ```
   */
  trackEvent(eventName: string, attributes?: EventAttributes): void {
    const attrs: Attributes = {
      service: this.serviceName,
      event: eventName,
      ...attributes,
    };

    this.eventCounter.add(1, attrs);

    this.logger?.info(
      {
        event: eventName,
        attributes,
      },
      'Metric event tracked',
    );

    // Record for testing
    this.collector?.recordEvent({
      event: eventName,
      attributes,
      service: this.serviceName,
      timestamp: Date.now(),
    });
  }

  /**
   * Track conversion funnel steps as metrics
   *
   * Monitor where users drop off in multi-step processes.
   *
   * @example
   * ```typescript
   * // Track signup funnel
   * metrics.trackFunnelStep('signup', 'started', { userId: '123' })
   * metrics.trackFunnelStep('signup', 'email_verified', { userId: '123' })
   * metrics.trackFunnelStep('signup', 'completed', { userId: '123' })
   *
   * // Track checkout flow
   * metrics.trackFunnelStep('checkout', 'started', { cartValue: 99.99 })
   * metrics.trackFunnelStep('checkout', 'payment_info', { cartValue: 99.99 })
   * metrics.trackFunnelStep('checkout', 'completed', { cartValue: 99.99 })
   * ```
   */
  trackFunnelStep(
    funnelName: string,
    status: FunnelStatus,
    attributes?: EventAttributes,
  ): void {
    const attrs: Attributes = {
      service: this.serviceName,
      funnel: funnelName,
      status,
      ...attributes,
    };

    this.funnelCounter.add(1, attrs);

    this.logger?.info(
      {
        funnel: funnelName,
        status,
        attributes,
      },
      'Funnel step tracked',
    );

    // Record for testing
    this.collector?.recordFunnelStep({
      funnel: funnelName,
      status,
      attributes,
      service: this.serviceName,
      timestamp: Date.now(),
    });
  }

  /**
   * Track outcomes (success/failure/partial) as metrics
   *
   * Monitor success rates of critical operations.
   *
   * @example
   * ```typescript
   * // Track email delivery
   * metrics.trackOutcome('email.delivery', 'success', {
   *   recipientType: 'user',
   *   emailType: 'welcome'
   * })
   *
   * metrics.trackOutcome('email.delivery', 'failure', {
   *   recipientType: 'user',
   *   errorCode: 'invalid_email'
   * })
   *
   * // Track payment processing
   * metrics.trackOutcome('payment.process', 'success', { amount: 99.99 })
   * metrics.trackOutcome('payment.process', 'failure', { error: 'insufficient_funds' })
   * ```
   */
  trackOutcome(
    operationName: string,
    status: OutcomeStatus,
    attributes?: EventAttributes,
  ): void {
    const attrs: Attributes = {
      service: this.serviceName,
      operation: operationName,
      status,
      ...attributes,
    };

    this.outcomeCounter.add(1, attrs);

    this.logger?.info(
      {
        operation: operationName,
        status,
        attributes,
      },
      'Outcome tracked',
    );

    // Record for testing
    this.collector?.recordOutcome({
      operation: operationName,
      status,
      attributes,
      service: this.serviceName,
      timestamp: Date.now(),
    });
  }

  /**
   * Track value metrics
   *
   * Record numerical values like revenue, transaction amounts,
   * item counts, processing times, engagement scores, etc.
   *
   * @example
   * ```typescript
   * // Track revenue
   * metrics.trackValue('order.revenue', 149.99, {
   *   currency: 'USD',
   *   productCategory: 'electronics'
   * })
   *
   * // Track items per cart
   * metrics.trackValue('cart.item_count', 5, {
   *   userId: '123'
   * })
   *
   * // Track processing time
   * metrics.trackValue('api.response_time', 250, {
   *   unit: 'ms',
   *   endpoint: '/api/checkout'
   * })
   * ```
   */
  trackValue(
    metricName: string,
    value: number,
    attributes?: EventAttributes,
  ): void {
    const attrs: Attributes = {
      service: this.serviceName,
      metric: metricName,
      ...attributes,
    };

    this.valueHistogram.record(value, attrs);

    this.logger?.debug(
      {
        metric: metricName,
        value,
        attributes,
      },
      'Value metric tracked',
    );

    // Record for testing
    this.collector?.recordValue({
      metric: metricName,
      value,
      attributes,
      service: this.serviceName,
      timestamp: Date.now(),
    });
  }
}

/**
 * Global metrics instances (singleton pattern)
 */
const metricsInstances = new Map<string, Metric>();

/**
 * Get or create a Metrics instance for a service
 *
 * @param serviceName - Service name for metric namespacing
 * @param logger - Optional logger
 * @returns Metrics instance
 *
 * @example
 * ```typescript
 * const metrics = getMetrics('checkout')
 * metrics.trackEvent('order.completed', { orderId: '123' })
 * ```
 */
export function getMetrics(serviceName: string, logger?: Logger): Metric {
  if (!metricsInstances.has(serviceName)) {
    metricsInstances.set(serviceName, new Metric(serviceName, { logger }));
  }
  return metricsInstances.get(serviceName)!;
}

/**
 * Reset all metrics instances (mainly for testing)
 */
export function resetMetrics(): void {
  metricsInstances.clear();
}
