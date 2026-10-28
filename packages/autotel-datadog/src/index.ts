/**
 * autotel-datadog: join autotel-web's traces to Datadog RUM on the same page.
 *
 * RUM keeps capturing errors, sessions and replays; autotel owns the tracing.
 * RUM only lets `beforeSend` change an event's `context` (it reverts edits to
 * anything else, `_dd.trace_id` included), so the join is two halves, one per
 * SDK:
 *
 * ```ts
 * import { datadogRum } from '@datadog/browser-rum';
 * import { initFull } from 'autotel-web/full';
 * import { joinDatadog } from 'autotel-datadog';
 *
 * const datadog = joinDatadog(datadogRum);
 * datadogRum.init({ applicationId, clientToken, site, service, env,
 *   beforeSend: datadog.beforeSend });
 * initFull({ service, endpoint: '/otel', spanEnrichers: [datadog] });
 * ```
 *
 * - RUM errors carry `context.trace_id` (128-bit hex, as Datadog APM stores
 *   OpenTelemetry trace ids) and `context.span_id` (decimal, as APM shows it),
 *   so `@context.trace_id:<id>` in RUM and `trace_id:<id>` in APM find each
 *   other.
 * - Spans carry the RUM session as `session.id` (also sent to your server as
 *   baggage), `user.id` from `setUser`, and on failure the session replay link.
 *
 * Imports no Datadog package: RUM is read structurally.
 */

import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { currentSpanContext, enrichSpans } from 'autotel-web/join';
import {
  asIdentifier,
  asString,
  readProperty,
  type UnknownRecord,
} from './values';

/**
 * The slice of `datadogRum` this join reads, every member optional: the CDN
 * snippet's stub and a RUM that has not started yet answer nothing.
 * `contract.test.ts` holds it to `@datadog/browser-rum`.
 */
export interface DatadogRumLike {
  getInternalContext?: (
    startTime?: number,
  ) => { session_id?: string | undefined } | undefined;
  getUser?: () => { id?: unknown };
  getSessionReplayLink?: () => string | undefined;
}

/** The parts of a RUM event the hook reads and writes. */
export interface RumEventLike {
  type: string;
  context?: UnknownRecord;
}

export interface JoinDatadogOptions {
  /**
   * A link from the RUM error to the trace, written as `context.trace_url`.
   * For Datadog APM: `({ traceId }) =>
   * \`https://app.datadoghq.eu/apm/trace/${traceId}\``.
   */
  traceUrl?: (span: { traceId: string; spanId: string }) => string | undefined;

  /**
   * Explain, once per reason, why a link did not happen. Defaults to on in
   * development and off in production.
   */
  debug?: boolean;
}

export interface DatadogJoin extends SpanProcessor {
  /**
   * Pass to `datadogRum.init({ beforeSend })`. Never drops an event. To keep
   * your own hook too: `beforeSend: (event, context) =>
   * datadog.beforeSend(event, context) && mine(event, context)`. Pass the
   * context on: it holds the original error, which is how an error from a
   * failed request finds that request's trace.
   */
  beforeSend: (event: RumEventLike, context?: unknown) => boolean;
}

const HINT =
  'With Datadog RUM: read it before the await and pass it as ' +
  'datadogRum.addError(error, { trace_id }).';

/** Why RUM's replay link opens nothing, keyed by the `error-type` it carries. */
const REPLAY_REASONS = new Map([
  ['rum-not-tracked', 'this RUM session is not tracked (sampled out).'],
  [
    'incorrect-session-plan',
    'session replay is off for this session (sessionReplaySampleRate).',
  ],
  [
    'replay-not-started',
    'session replay has not started recording (startSessionReplayRecording).',
  ],
]);

function guarded<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * The span id in OpenTelemetry's hex, from the decimal form on the event (or
 * whatever the app put there), for `traceUrl`. Empty when there is none.
 */
function hexSpanId(spanId: string | undefined): string {
  if (spanId === undefined) return '';
  if (!/^\d+$/.test(spanId)) return spanId;
  return guarded(() => BigInt(spanId).toString(16).padStart(16, '0')) ?? '';
}

/** Hex span id to the decimal Datadog APM shows. */
function decimal(spanId: string): string | undefined {
  return guarded(() => BigInt(`0x${spanId}`).toString(10));
}

/**
 * Join autotel's traces to Datadog RUM. Returns the span enricher for
 * `initFull({ spanEnrichers })`, carrying the `beforeSend` hook for
 * `datadogRum.init`.
 */
export function joinDatadog(
  rum: DatadogRumLike,
  options: JoinDatadogOptions = {},
): DatadogJoin {
  const enricher = enrichSpans({
    name: 'datadog',
    debug: options.debug,
    session: () => rum.getInternalContext?.()?.session_id,
    onStart: () => {
      const id = guarded(() => rum.getUser?.()?.id);
      return { 'user.id': asIdentifier(id) };
    },
    onFailure: () => {
      const link = guarded(() => rum.getSessionReplayLink?.());
      if (!link) return 'Datadog RUM has not started on this page.';
      const errorType = guarded(() =>
        new URL(link).searchParams.get('error-type'),
      );
      if (errorType) {
        return REPLAY_REASONS.get(errorType) ?? `RUM reports ${errorType}.`;
      }
      return { 'session.replay.url': link };
    },
  });

  const beforeSend = (event: RumEventLike, domain?: unknown): boolean => {
    try {
      if (event.type !== 'error') return true;
      // RUM's domain context for an error carries the original error object.
      const error = guarded(() => readProperty(domain, 'error'));
      const context = { ...event.context };
      const supplied = asString(context.trace_id);
      // With a supplied trace there is nothing ambiguous to warn about.
      const span = currentSpanContext({
        debug: supplied === undefined ? options.debug : false,
        hint: HINT,
        error,
      });
      // A trace the app passed (`addError(error, { trace_id })`, the escape
      // hatch for when another trace may be in flight) is the answer. Only a
      // span from that same trace may fill the rest: ids from two different
      // traces make a link that opens the wrong one.
      const traceId = supplied ?? span?.traceId;
      if (traceId === undefined) return true;
      context.trace_id = traceId;
      if (span && span.traceId === traceId) {
        context.span_id ??= decimal(span.spanId);
      }
      if (options.traceUrl && context.trace_url === undefined) {
        const spanId = hexSpanId(asString(context.span_id));
        const url = guarded(() => options.traceUrl!({ traceId, spanId }));
        if (url) context.trace_url = url;
      }
      event.context = context;
    } catch {
      // A link that fails to stamp must not cost RUM the error.
    }
    return true;
  };

  return Object.assign(enricher, { beforeSend });
}
