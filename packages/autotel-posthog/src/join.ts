/**
 * One call, both directions.
 *
 * The two halves of the join are configured in different places — the enricher
 * belongs to the tracer, the `before_send` hook belongs to PostHog — and asking
 * for two edits in two files is how an integration ends up half-wired. This
 * takes the PostHog instance, wires the PostHog half itself, and hands back the
 * enricher for the tracer half:
 *
 * ```ts
 * import posthog from 'posthog-js';
 * import { joinPostHog } from 'autotel-posthog';
 *
 * posthog.init('<key>');
 * initFull({ service: 'web', endpoint, spanEnrichers: [joinPostHog(posthog)] });
 * ```
 */

import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  autotelBeforeSend,
  type AutotelBeforeSendOptions,
  type BeforeSendLike,
} from './before-send';
import {
  posthogCompatibility,
  resolvePostHog,
  type PostHogCompatibilityOptions,
} from './compatibility';
import type { PostHogLike } from './posthog-like';

/**
 * Marks our hook so a second call recognises it. Framework code runs more than
 * once — strict mode, HMR, a re-render — and a chain that grows on every render
 * stamps the same properties again and again. The spans the hook reads are
 * shared page-wide by `autotel-web/join`, so whichever call's processor the
 * app registers, the one installed hook sees its spans.
 */
const MARKER = '__autotelBeforeSend';

type MarkedHook = BeforeSendLike & { [MARKER]?: true };

function existingHooks(posthog: PostHogLike): BeforeSendLike[] {
  const current = posthog.config?.before_send as
    BeforeSendLike | BeforeSendLike[] | undefined;
  if (Array.isArray(current)) return current;
  return current ? [current] : [];
}

/**
 * Wire PostHog to stamp trace context on its events, and return the span
 * enricher for the other direction.
 *
 * Safe to call more than once, and safe to call on an instance that cannot be
 * configured — the loader snippet's stub has no `set_config`, and the trace
 * side is worth having even when the PostHog side cannot be wired.
 */
export interface JoinPostHogOptions
  extends
    Omit<PostHogCompatibilityOptions, 'posthog'>,
    AutotelBeforeSendOptions {
  /**
   * Copy PostHog's session id onto subsequent same-origin fetches as W3C
   * `baggage`, so the server span of a traced request carries `session.id`.
   * The backend needs `init({ baggage: '' })` for the attribute to land under
   * that name. Distinct id stays off: it can be an email.
   *
   * @default true
   */
  propagateSession?: boolean;
}

export function joinPostHog(
  posthog: PostHogLike | (() => PostHogLike | undefined),
  options: JoinPostHogOptions = {},
): SpanProcessor {
  /**
   * Returns true once the hook is in place. Kept retryable because the loader
   * snippet's stub has no `set_config`: giving up at call time would leave
   * every PostHog event on that page without its trace for the life of the
   * page, and the real library usually arrives a moment later.
   */
  const wire = (): boolean => {
    try {
      const instance = resolvePostHog({ ...options, posthog });
      if (!instance) return false;

      const hooks = existingHooks(instance) as MarkedHook[];
      if (hooks.some((hook) => hook[MARKER])) return true;
      if (typeof instance.set_config !== 'function') return false;

      const hook = autotelBeforeSend(options) as MarkedHook;
      // SAFETY: marking our own hook so a second joinPostHog() finds it
      // instead of installing another.
      hook[MARKER] = true;
      // Appended, never assigned: `before_send` is a chain the page may already
      // use to redact or drop events, and replacing it would switch that off.
      instance.set_config({ before_send: [...hooks, hook] });
      return true;
    } catch {
      // A PostHog that cannot be configured is still one worth reading from.
      return false;
    }
  };

  let wired = wire();
  const enricher = posthogCompatibility({
    ...options,
    posthog,
    propagateSession: options.propagateSession ?? true,
  });

  return {
    onStart(span, context) {
      // Every span is another chance to catch the library once it has loaded.
      if (!wired) wired = wire();
      enricher.onStart(span, context);
    },
    onEnd: (span) => enricher.onEnd(span),
    forceFlush: () => enricher.forceFlush(),
    shutdown: () => enricher.shutdown(),
  };
}
