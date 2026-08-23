/**
 * Span enricher that joins an autotel trace to the PostHog session it happened
 * in.
 *
 * PostHog already knows two things no tracer can work out for itself: which
 * recorded session a page view belongs to, and which person is behind it.
 * Copying them onto every span is what turns "a slow span" into "watch the
 * person it was slow for", in whatever backend the spans land in.
 */

import type { Attributes } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { isDevelopment } from './dev-mode';
import {
  isUsable,
  readDistinctId,
  readFeatureFlag,
  readReplayUrl,
  readSessionId,
  type PostHogLike,
} from './posthog-like';

/** `SpanStatusCode.ERROR`, without importing the enum for one comparison. */
const STATUS_ERROR = 2;

function failed(span: ReadableSpan): boolean {
  return (
    span.status?.code === STATUS_ERROR ||
    span.attributes['exception.type'] !== undefined ||
    span.events?.some((event) => event.name === 'exception') === true
  );
}

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
   * Flag keys to stamp on every span as `feature_flag.<key>`, so error rate and
   * latency can be split by variant in whichever backend receives the spans.
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

/** Why a failed span ended up with no replay link. */
type Reason = 'no-posthog' | 'session-rotated' | 'not-recording';

const EXPLANATION: Record<Reason, string> = {
  'no-posthog':
    'no usable PostHog on the page. Pass the instance to joinPostHog(), or ' +
    'check posthog.init() runs before the first span.',
  'session-rotated':
    'the PostHog session rotated after this span started, so a link would ' +
    'point at a different recording than the one the span belongs to.',
  'not-recording':
    'session replay is not recording. Check it is enabled for the project, ' +
    'that this session was not sampled out, and that the recorder has ' +
    'started. Note posthog-js does not record bots or headless browsers.',
};

/**
 * One warning per reason, not per span. A failing join fails on every span,
 * and a console with a thousand copies of the same line is the same as a
 * console with none.
 */
function explainer(enabled: boolean | undefined) {
  const said = new Set<Reason>();
  return (reason: Reason): void => {
    if (!enabled || said.has(reason)) return;
    said.add(reason);
    console.warn(
      `[autotel-posthog] No session.replay.url on a failed span: ${EXPLANATION[reason]}`,
    );
  };
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
  options: PostHogCompatibilityOptions = {},
): SpanProcessor {
  const explain = explainer(options.debug ?? isDevelopment());

  return {
    /**
     * Identity is read here, not in `onEnd`, because it is a fact about when
     * the operation happened. PostHog rotates a session after 30 minutes idle,
     * and `identify()` can land mid-request; a long span asking at the end
     * would be filed under whoever the visitor had become by then rather than
     * who started it.
     */
    onStart(span: Span, _context: Context): void {
      const posthog = resolvePostHog(options);
      if (!posthog) return;

      // Assigned, not filled. PostHog's session id is the one the replay, the
      // funnels and the person profile are keyed on, so where PostHog has one
      // it outranks whatever the tracer minted for itself — a span carrying any
      // other id links to nothing.
      const sessionId = readSessionId(posthog);
      if (sessionId !== undefined) {
        span.setAttribute('session.id', sessionId);
      }

      // SAFETY: ReadableSpan types attributes as readonly; a span enricher's job
      // is to add to them before export, which is what this processor does.
      const attributes = span.attributes as Attributes;
      const fill = (key: string, value: string | boolean | undefined): void => {
        if (value !== undefined && attributes[key] === undefined) {
          span.setAttribute(key, value);
        }
      };

      fill('user.id', readDistinctId(posthog));

      for (const key of options.featureFlags ?? []) {
        fill(`feature_flag.${key}`, readFeatureFlag(posthog, key));
      }
    },

    /**
     * Only the replay link is left for the end, because only the end knows
     * whether the span failed.
     */
    onEnd(span: ReadableSpan): void {
      if (!failed(span)) return;

      const posthog = resolvePostHog(options);
      if (!posthog) {
        explain('no-posthog');
        return;
      }

      // SAFETY: ReadableSpan types attributes as readonly; a span enricher's job
      // is to add to them before export, which is what this processor does.
      const attributes = span.attributes as Attributes;
      if (attributes['session.replay.url'] !== undefined) return;

      // `get_session_replay_url()` describes the session PostHog is in *now*.
      // If that is no longer the session this span was stamped with — a
      // rotation, a reset, an identify — the link would point at a recording
      // the span has nothing to do with.
      const current = readSessionId(posthog);
      if (current === undefined || current !== attributes['session.id']) {
        explain('session-rotated');
        return;
      }

      const url = readReplayUrl(posthog);
      if (url === undefined) {
        explain('not-recording');
        return;
      }
      attributes['session.replay.url'] = url;
    },

    forceFlush(): Promise<void> {
      return Promise.resolve();
    },

    shutdown(): Promise<void> {
      return Promise.resolve();
    },
  };
}
