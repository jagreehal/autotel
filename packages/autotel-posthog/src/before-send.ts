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

import { context, trace } from '@opentelemetry/api';

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

    const spanContext = trace.getSpanContext(context.active());
    if (!spanContext) return event;

    const properties = event.properties;
    if (properties['$trace_id'] === undefined) {
      properties['$trace_id'] = spanContext.traceId;
    }
    if (properties['$span_id'] === undefined) {
      properties['$span_id'] = spanContext.spanId;
    }

    if (options.traceUrl && properties['$trace_url'] === undefined) {
      try {
        const url = options.traceUrl({
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
        });
        if (url !== undefined) properties['$trace_url'] = url;
      } catch {
        // App-supplied callback. It does not get to take down the event it was
        // decorating.
      }
    }

    return event;
  };
}
