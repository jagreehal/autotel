/**
 * Span processor that copies baggage entries to span attributes
 *
 * This makes baggage visible in trace UIs without manual attribute setting.
 * Enabled via init({ baggage: true }) or init({ baggage: 'custom-prefix' })
 */

import type { Span, Context } from '@opentelemetry/api';
import { propagation, context as otelContext } from '@opentelemetry/api';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { requireModule } from './node-require';

export interface BaggageSpanProcessorOptions {
  /**
   * Prefix for baggage attributes
   * @default 'baggage.'
   */
  prefix?: string;
}

/**
 * Span processor that automatically copies baggage entries to span attributes
 *
 * This makes baggage visible in trace UIs (Jaeger, Grafana, DataDog, etc.)
 * without manually calling ctx.setAttribute() for each baggage entry.
 *
 * @example Enable in init()
 * ```typescript
 * init({
 *   service: 'my-app',
 *   baggage: true // Uses default 'baggage.' prefix
 * });
 *
 * // Now baggage automatically appears as span attributes
 * await withBaggage({
 *   baggage: { 'tenant.id': 't1', 'user.id': 'u1' },
 *   fn: async () => {
 *     // Span has baggage.tenant.id and baggage.user.id attributes!
 *   }
 * });
 * ```
 *
 * @example Custom prefix
 * ```typescript
 * init({
 *   service: 'my-app',
 *   baggage: 'ctx' // Uses 'ctx.' prefix
 * });
 * // Creates attributes: ctx.tenant.id, ctx.user.id
 * ```
 */
export class BaggageSpanProcessor implements SpanProcessor {
  private readonly prefix: string;

  constructor(options: BaggageSpanProcessorOptions = {}) {
    this.prefix = options.prefix ?? 'baggage.';
  }

  onStart(span: Span, parentContext: Context): void {
    // Read baggage from parentContext first (spans created with explicit context)
    // Then fall back to active context (spans created without explicit context)
    // Also check getActiveContextWithBaggage() to see baggage set via ctx.setBaggage()
    let baggage = propagation.getBaggage(parentContext);
    if (!baggage) {
      baggage = propagation.getBaggage(otelContext.active());
    }
    // Check stored context from ctx.setBaggage() if still no baggage
    if (!baggage) {
      try {
        const { getActiveContextWithBaggage } = requireModule<{
          getActiveContextWithBaggage: () => Context;
        }>('./trace-context');
        const storedContext = getActiveContextWithBaggage();
        baggage = propagation.getBaggage(storedContext);
      } catch {
        // Fallback if trace-context isn't available
      }
    }
    if (!baggage) return;

    // Copy all baggage entries to span attributes
    for (const [key, entry] of baggage.getAllEntries()) {
      span.setAttribute(`${this.prefix}${key}`, entry.value);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onEnd(_span: ReadableSpan): void {
    // No-op - required by SpanProcessor interface
  }

  async shutdown(): Promise<void> {
    // No-op
  }

  async forceFlush(): Promise<void> {
    // No-op
  }
}
