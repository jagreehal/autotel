/**
 * autotel-sentry/browser: join autotel's browser traces to the Sentry SDK
 * already on the page.
 *
 * Sentry keeps capturing errors and replays; autotel owns the tracing. One
 * call links them both ways:
 *
 * ```ts
 * import * as Sentry from '@sentry/browser'; // or @sentry/react, @sentry/vue…
 * import { initFull } from 'autotel-web/full';
 * import { joinSentry, sentryOtlpConfig } from 'autotel-sentry/browser';
 *
 * const sentry = sentryOtlpConfig(SENTRY_DSN);
 * Sentry.init({ dsn: sentry.dsn }); // no browserTracingIntegration
 * initFull({
 *   service: 'web',
 *   endpoint: sentry.browserEndpoint,
 *   spanEnrichers: [joinSentry(Sentry)],
 * });
 * ```
 *
 * - Every Sentry error carries the autotel trace it happened in, so the issue
 *   opens the trace (in Sentry, when spans are exported there; anywhere else
 *   through `traceUrl`).
 * - Every span carries `user.id` from the Sentry scope and, while replay is
 *   recording the session, `sentry.replay_id`, which Sentry's trace view
 *   reads to open the replay.
 *
 * No Sentry package is imported: the SDK is read structurally, so whichever
 * `@sentry/*` entry the app uses is the one copy on the page.
 */

import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { currentSpanContext, enrichSpans } from 'autotel-web/join';
import { asString, isFunction } from './values';

export { sentryOtlpConfig } from './config';
export type { SentryOtlpConfig } from './types';

/** The parts of a Sentry event this join reads and writes. */
export interface SentryEventLike {
  type?: string;
  contexts?: Record<string, Record<string, unknown> | undefined>;
}

/**
 * The slice of the Sentry browser SDK this join uses, every member optional:
 * a page may run the CDN loader's stub, an SDK without replay, or none at all.
 * `contract.test.ts` holds it to `@sentry/browser` itself.
 */
export interface SentryLike {
  addEventProcessor?: (
    processor: <E extends SentryEventLike>(
      event: E,
      hint?: { originalException?: unknown },
    ) => E,
  ) => void;
  getActiveSpan?: () => object | undefined;
  getIsolationScope?: () => {
    getUser(): { id?: string | number } | undefined;
    getPropagationContext?(): { traceId?: string };
  };
  getCurrentScope?: () => {
    getPropagationContext?(): { traceId?: string };
  };
  getReplay?: () =>
    | {
        getReplayId(onlyIfSampled?: boolean): string | undefined;
        getRecordingMode(): 'session' | 'buffer' | undefined;
      }
    | undefined;
  getClient?: () =>
    { getIntegrationByName?(name: string): object | undefined } | undefined;
}

export interface JoinSentryOptions {
  /**
   * Link from a Sentry issue to the trace in your own backend, for when spans
   * are exported somewhere other than Sentry. Written to the event's `autotel`
   * context as `trace_url`. Return `undefined` to add nothing.
   */
  traceUrl?: (span: { traceId: string; spanId: string }) => string | undefined;

  /**
   * Build a link to the Sentry replay, added to failed spans as
   * `session.replay.url` so a backend other than Sentry can open it:
   * `(id) => \`https://my-org.sentry.io/replays/${id}/\``.
   *
   * Only while replay records the whole session. A buffered replay
   * (`replaysOnErrorSampleRate`) is kept only if Sentry captures an error, so
   * a link from a span that failed without one would open nothing.
   */
  replayUrl?: (replayId: string) => string | undefined;

  /**
   * Explain, once per reason, why a join did not happen. Defaults to on in
   * development and off in production.
   */
  debug?: boolean;
}

const REPLAY_ID = 'sentry.replay_id';

const HINT =
  'With Sentry: read it before the await and pass it as ' +
  'Sentry.captureException(error, { contexts: { trace: { trace_id, span_id } } }).';

/** Sentry SDKs this page has already been given an event processor on. */
const wired = new WeakSet<object>();

function guarded<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** The replay id, only while the whole session is being recorded. */
function recordingReplayId(sentry: SentryLike): string | undefined {
  return guarded(() => {
    const replay = sentry.getReplay?.();
    if (replay?.getRecordingMode() !== 'session') return undefined;
    return replay.getReplayId(true) || undefined;
  });
}

/** Stamp the autotel trace on a Sentry event. */
/** Whether a trace id is the one Sentry fills in itself from its scopes. */
function isSentryDefault(sdk: SentryLike, traceId: string): boolean {
  const ids = [
    guarded(() => sdk.getCurrentScope?.().getPropagationContext?.().traceId),
    guarded(() => sdk.getIsolationScope?.().getPropagationContext?.().traceId),
  ];
  // An SDK too old or stubbed to say: treat as Sentry's, as before.
  return ids.every((id) => id === undefined) || ids.includes(traceId);
}

function addTraceUrl(
  event: SentryEventLike,
  opts: JoinSentryOptions,
  span: { traceId: string; spanId: string },
): void {
  const url = opts.traceUrl && guarded(() => opts.traceUrl!(span));
  if (!url) return;
  event.contexts = {
    ...event.contexts,
    autotel: { ...event.contexts?.autotel, trace_url: url },
  };
}

function linkEvent<E extends SentryEventLike>(
  sdk: SentryLike,
  event: E,
  opts: JoinSentryOptions,
  error?: unknown,
): E {
  try {
    if (event.type === 'transaction') return event;
    // Sentry's own tracer is running and holds a span: it knows better.
    if (sdk.getActiveSpan?.()) return event;

    // A trace the caller passed (`captureException(error, { contexts: {
    // trace } })`, the documented escape hatch) is the answer, not something
    // to infer over: by the time of capture another trace may be in flight.
    // Sentry's own default is its scope's propagation id; anything else was
    // supplied on purpose.
    const suppliedTrace = asString(event.contexts?.trace?.trace_id);
    if (suppliedTrace !== undefined && !isSentryDefault(sdk, suppliedTrace)) {
      addTraceUrl(event, opts, {
        traceId: suppliedTrace,
        spanId: asString(event.contexts?.trace?.span_id) ?? '',
      });
      return event;
    }

    const span = currentSpanContext({ debug: opts.debug, hint: HINT, error });
    if (!span) return event;

    // Assigned: without an active Sentry span, Sentry's trace id is a
    // random propagation id with no spans behind it. Its parent span id
    // belongs to that one, so it goes too.
    const trace = { ...event.contexts?.trace };
    delete trace.parent_span_id;
    event.contexts = {
      ...event.contexts,
      trace: { ...trace, trace_id: span.traceId, span_id: span.spanId },
    };

    addTraceUrl(event, opts, span);
  } catch {
    // A link that fails to stamp must not cost Sentry the error.
  }
  return event;
}

/**
 * Join autotel's traces to the Sentry SDK on the page, and return the span
 * enricher for `initFull({ spanEnrichers })`.
 *
 * Safe to call more than once: the event processor is installed once per SDK.
 */
export function joinSentry(
  sentry: SentryLike,
  options: JoinSentryOptions = {},
): SpanProcessor {
  const debug = options.debug;

  if (!wired.has(sentry) && isFunction(sentry.addEventProcessor)) {
    wired.add(sentry);
    guarded(() =>
      sentry.addEventProcessor!((event, hint) =>
        linkEvent(sentry, event, options, hint?.originalException),
      ),
    );
  }

  let checkedTracing = false;
  const warnIfSentryTraces = (): void => {
    if (checkedTracing) return;
    const client = guarded(() => sentry.getClient?.());
    if (!client) return;
    checkedTracing = true;
    const tracing = guarded(() =>
      client.getIntegrationByName?.('BrowserTracing'),
    );
    if (tracing && (debug ?? true)) {
      console.warn(
        '[autotel-sentry] Sentry browserTracingIntegration is tracing this ' +
          'page as well as autotel. Two tracers put two traceparent headers ' +
          'on each fetch, and errors link to whichever span Sentry holds. ' +
          'Remove browserTracingIntegration from Sentry.init and let autotel ' +
          'trace.',
      );
    }
  };

  return enrichSpans({
    name: 'sentry',
    debug,

    onStart: () => {
      warnIfSentryTraces();
      const id = guarded(() => sentry.getIsolationScope?.().getUser()?.id);
      return {
        'user.id': id === undefined ? undefined : String(id),
        [REPLAY_ID]: recordingReplayId(sentry),
      };
    },

    onFailure: options.replayUrl
      ? (span) => {
          const started = span.attributes[REPLAY_ID];
          if (!isFunction(sentry.getReplay)) {
            return 'replayIntegration() is not in Sentry.init.';
          }
          const current = recordingReplayId(sentry);
          if (current === undefined) {
            return (
              'Sentry replay is not recording the whole session. Buffered ' +
              'replays (replaysOnErrorSampleRate) are kept only when Sentry ' +
              'captures an error.'
            );
          }
          if (current !== started) {
            return 'the replay changed while this span ran.';
          }
          const url = guarded(() => options.replayUrl!(current));
          return url ? { 'session.replay.url': url } : undefined;
        }
      : undefined,
  });
}
