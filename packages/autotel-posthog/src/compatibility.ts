/**
 * Span enricher that joins an autotel trace to the PostHog session it happened
 * in.
 *
 * PostHog already knows two things no tracer can work out for itself: which
 * recorded session a page view belongs to, and which person is behind it.
 * Copying them onto every span is what turns "a slow span" into "watch the
 * person it was slow for", in whatever backend the spans land in.
 */

import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { emitEvent } from 'autotel-web';
import { enrichSpans } from 'autotel-web/join';
import { recordFeatureFlag } from 'autotel/feature-flags';
import {
  isUsable,
  readDistinctId,
  readFeatureFlag,
  readReplayUrl,
  readSessionId,
  type PostHogLike,
} from './posthog-like';

export interface PostHogCompatibilityOptions {
  /**
   * The PostHog instance, or a function returning it.
   *
   * Defaults to `globalThis.posthog`, which is where the snippet and
   * `posthog-js` both leave it. An instance passed here is preferred — two
   * PostHog instances on one page is a real setup and an explicit argument is a
   * decision — but only while it can answer: hand in the loader snippet's array
   * stub and this falls back to the global once posthog-js swaps the real
   * library in over the top of it.
   */
  posthog?: PostHogLike | (() => PostHogLike | undefined);

  /**
   * Flag keys to record on every span, using the canonical OpenTelemetry
   * `feature_flag.*` attributes and one `feature_flag.evaluation` event each —
   * so error rate and latency can be split by variant in whichever backend
   * receives the spans, with no PostHog in the query path.
   *
   * Named explicitly rather than read wholesale: every flag is another
   * attribute on every span, and "all of them" is how an analytics convenience
   * turns into a cardinality bill.
   */
  featureFlags?: string[];

  /**
   * Explain, once per distinct reason, why a span that should have carried a
   * replay link did not.
   *
   * Every exit on this path is deliberately quiet — a missing PostHog, a
   * session that rotated, a project with replay switched off all just produce
   * no attribute. In production that is correct. While wiring it up it is
   * indistinguishable from success, which is how a broken join survives a
   * green test suite.
   *
   * On by default in development and silent in production, the way React and
   * Redux warn: a diagnostic nobody switches on is a diagnostic nobody reads.
   * Development is `process.env.NODE_ENV` where a bundler substituted one, and
   * a localhost page otherwise. Set it explicitly to override either way.
   *
   * @default true in development, false in production
   */
  debug?: boolean;
}

/**
 * Whether to copy PostHog's session id onto same-origin fetches as baggage.
 * Off here, on in `joinPostHog`, which documents it.
 */
interface PropagateOption {
  propagateSession?: boolean;
}

export function resolvePostHog(
  options: PostHogCompatibilityOptions,
): PostHogLike | undefined {
  const configured =
    typeof options.posthog === 'function' ? options.posthog() : options.posthog;
  if (isUsable(configured)) return configured;

  const global = globalThis.posthog;
  return isUsable(global) ? global : undefined;
}

export function posthogCompatibility(
  options: PostHogCompatibilityOptions & PropagateOption = {},
): SpanProcessor {
  const resolve = () => resolvePostHog(options);

  return enrichSpans({
    name: 'posthog',
    debug: options.debug,
    propagateSession: options.propagateSession ?? false,

    // PostHog's session id is the one the replay, the funnels and the person
    // profile are keyed on, so it outranks whatever the tracer minted.
    session: () => {
      const posthog = resolve();
      return posthog ? readSessionId(posthog) : undefined;
    },

    /**
     * Identity is read at the start because it is a fact about when the
     * operation happened: PostHog rotates a session after 30 minutes idle, and
     * `identify()` can land mid-request.
     */
    onStart: (span) => {
      const posthog = resolve();
      if (!posthog) return undefined;
      const distinctId = readDistinctId(posthog);

      // One sink for the span: the projection keys on it, so the span keeps
      // its first flag whole rather than a mix of every flag's fields.
      const sink = {
        // The span this sink writes to, so `recordFeatureFlag()` elsewhere in
        // the request sees the same span and keeps it unmixed.
        [Symbol.for('autotel.traceContext.span')]: span,
        setAttributes: (
          attributes: Record<string, string | number | boolean>,
        ) => span.setAttributes(attributes),
        // A span processor holds a span, not a trace context, so it brings
        // its own correlated-log seam rather than reaching for
        // `Span.addEvent`. One event per flag carries every evaluation.
        track: emitEvent,
      };
      for (const key of options.featureFlags ?? []) {
        const value = readFeatureFlag(posthog, key);
        // A flag PostHog cannot answer for is not an evaluation. Recording it
        // as `false` would make "off" and "unknown" the same reading.
        if (value === undefined) continue;
        recordFeatureFlag(sink, {
          key,
          value,
          // A multivariate flag answers with its variant's name, which is
          // the identifier the convention records; a boolean is the value.
          variant: typeof value === 'string' ? value : undefined,
          provider: 'posthog',
          contextId: distinctId,
        });
      }

      return { 'user.id': distinctId };
    },

    onFailure: () => {
      const posthog = resolve();
      if (!posthog) {
        return (
          'no usable PostHog on the page. Pass the instance to joinPostHog(), ' +
          'or check posthog.init() runs before the first span.'
        );
      }
      const url = readReplayUrl(posthog);
      if (url === undefined) {
        return (
          'session replay is not recording. Check it is enabled for the ' +
          'project, that this session was not sampled out, and that the ' +
          'recorder has started. Note posthog-js does not record bots or ' +
          'headless browsers.'
        );
      }
      return { 'session.replay.url': url };
    },
  });
}
