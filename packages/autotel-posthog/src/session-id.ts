/**
 * PostHog's session id, shaped for `autotel-web`'s `session.id` provider.
 *
 * The span enricher covers full mode, where there is an OpenTelemetry pipeline
 * to hang a processor on. The minimal browser build has no such pipeline — it
 * writes spans straight to OTLP — so it takes the id from a function instead,
 * and this is that function:
 *
 * ```ts
 * import { init } from 'autotel-web';
 * import { posthogSessionId } from 'autotel-posthog';
 *
 * init({ service: 'web', session: { id: posthogSessionId } });
 * ```
 *
 * Returns `undefined` when PostHog is absent or not yet initialized, which is
 * the signal for autotel-web to fall back to minting its own id rather than
 * emitting spans with no session at all.
 */

import { readSessionId, type PostHogLike } from './posthog-like';

export function posthogSessionId(posthog?: PostHogLike): string | undefined {
  const instance = posthog ?? globalThis.posthog ?? undefined;
  return instance ? readSessionId(instance) : undefined;
}
