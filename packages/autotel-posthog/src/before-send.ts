/**
 * The other half of the join: PostHog events that know which trace they
 * happened inside.
 *
 * `posthogCompatibility()` teaches the trace about the session. This teaches
 * the session about the trace, so a `$exception` or a funnel drop-off in
 * PostHog carries the trace id that explains it, and the property names match
 * the ones autotel's server-side subscriber already writes — one set of names
 * whichever side captured the event.
 *
 * @example
 * ```ts
 * posthog.init('<key>', {
 *   before_send: [
 *     autotelBeforeSend({
 *       traceUrl: ({ traceId }) => `https://traces.example.com/${traceId}`,
 *     }),
 *   ],
 * });
 * ```
 */

import { context, trace, type SpanContext } from '@opentelemetry/api';

/**
 * Structural copy of PostHog's `CaptureResult`. Only `properties` is touched;
 * everything else is passed through untouched.
 */
/** What a PostHog event property can hold: JSON, since that is what is sent. */
export type PostHogPropertyValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<PostHogPropertyValue>
  | { [key: string]: PostHogPropertyValue };

export interface CaptureResultLike {
  properties: Record<string, PostHogPropertyValue>;
  [key: string]: PostHogPropertyValue;
}

export type BeforeSendLike = (
  event: CaptureResultLike | null,
) => CaptureResultLike | null;

export interface AutotelBeforeSendOptions {
  /**
   * Build a link to the trace in your own backend.
   *
   * Ids correlate; they do not navigate. Whoever reads a PostHog event wants
   * one click back to the trace, and only the app knows whether that is
   * Traceway, Grafana, Honeycomb or a local devtools port — so the URL shape
   * is yours to supply.
   *
   * Return `undefined` to add nothing for this event.
   */
  traceUrl?: (context: {
    traceId: string;
    spanId: string;
  }) => string | undefined;

  /**
   * Where to look when the active context is empty.
   *
   * Node keeps the active span across `await` through AsyncLocalStorage; the
   * browser has no equivalent, so `context.active()` is back to root by the
   * time the fetch resolves and the interesting event fires. Without this the
   * hook would silently add nothing to exactly the events worth joining.
   *
   * `joinPostHog()` supplies one backed by the spans it has seen start and not
   * yet end. Left unset, the hook uses only the active context.
   */
  fallbackSpanContext?: () => SpanContext | undefined;
}

/**
 * The ids of the span in progress, shaped to spread straight onto a capture.
 *
 * The hook recovers the span by itself in every case it can be sure of. This
 * is for the case it cannot: two overlapping user actions, each its own trace,
 * with no active context left to say which one an event belongs to. Read it
 * while the span is still active — before the first `await` — and spread it:
 *
 * ```ts
 * await span('checkout.click', async () => {
 *   const trace = traceProperties();
 *   await fetch('/checkout', { method: 'POST' });
 *   posthog.capture('checkout_failed', { ...trace });
 * });
 * ```
 *
 * Returns `{}` when nothing is being traced, so the spread is always safe.
 * Properties the caller sets are never overwritten, so this always wins.
 */
export function traceProperties(): {
  $trace_id?: string;
  $span_id?: string;
} {
  const spanContext = trace.getSpanContext(context.active());
  if (!spanContext) return {};
  return { $trace_id: spanContext.traceId, $span_id: spanContext.spanId };
}

/** The active context wins; this only answers when there is nothing active. */
function readFallback(
  options: AutotelBeforeSendOptions,
): SpanContext | undefined {
  try {
    return options.fallbackSpanContext?.();
  } catch {
    // A fallback that throws is a fallback that adds nothing, not an event
    // that fails to send.
    return undefined;
  }
}

/**
 * A PostHog `before_send` hook that adds `$trace_id` and `$span_id` from the
 * span in progress.
 */
export function autotelBeforeSend(
  options: AutotelBeforeSendOptions = {},
): BeforeSendLike {
  return (event) => {
    // A chain: null means an earlier hook discarded the event, and reviving it
    // would send something the page deliberately suppressed.
    if (event === null) return null;

    const properties = event.properties;
    const spanContext =
      trace.getSpanContext(context.active()) ?? readFallback(options);

    if (spanContext) {
      if (properties['$trace_id'] === undefined) {
        properties['$trace_id'] = spanContext.traceId;
      }
      if (properties['$span_id'] === undefined) {
        properties['$span_id'] = spanContext.spanId;
      }
    }

    // Read back rather than taken from the span context: an event the caller
    // stamped by hand — `traceProperties()`, or ids carried from elsewhere —
    // deserves the same clickable link as one recovered automatically.
    // Otherwise taking the documented escape hatch quietly costs you the link.
    const traceId = properties['$trace_id'];
    const spanId = properties['$span_id'];
    if (typeof traceId !== 'string' || typeof spanId !== 'string') return event;

    if (options.traceUrl && properties['$trace_url'] === undefined) {
      try {
        const url = options.traceUrl({ traceId, spanId });
        if (url !== undefined) properties['$trace_url'] = url;
      } catch {
        // App-supplied callback. It does not get to take down the event it was
        // decorating.
      }
    }

    return event;
  };
}
