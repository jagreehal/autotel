/**
 * The PostHog surface this package reads, taken from `posthog-js` itself.
 *
 * Deriving the type from the real library rather than restating it is what
 * keeps the two in step: if PostHog renames a method or changes a signature,
 * this stops compiling instead of silently reading `undefined` at runtime in
 * someone's browser. `contract.test-d.ts` holds it to that.
 *
 * `Partial` is the deliberate loosening. A page is in one of three states and
 * only the last one answers questions:
 *   1. no `posthog` at all,
 *   2. the loader snippet's array stub, which queues calls made before the
 *      real library arrives and has none of these methods,
 *   3. the loaded library, which still returns an empty session id until it
 *      has finished initializing.
 * The type is what PostHog says it is; the optionality is about when it is.
 */

import type { PostHog } from 'posthog-js';

/** Exactly the members read, with PostHog's own signatures. */
declare global {
  /**
   * PostHog installs itself on the page - as the loader snippet's array stub
   * first, then as the real instance. Declaring it here is what lets the rest
   * of this package read `globalThis.posthog` without asserting a shape.
   */
  var posthog: PostHogLike | undefined;
}

export type PostHogLike = Partial<
  Pick<
    PostHog,
    | 'get_session_id'
    | 'get_distinct_id'
    | 'get_session_replay_url'
    | 'getFeatureFlag'
    | 'sessionRecordingStarted'
    | 'set_config'
  >
> & {
  /**
   * Pre-`sessionRecordingStarted()` fallback. Not part of the public type —
   * PostHog exposes only `_forceAllowLocalhostNetworkCapture` on this object —
   * so it is declared here and read defensively, never preferred.
   */
  sessionRecording?: { started?: boolean };
  config?: Partial<PostHog['config']>;
};

/**
 * Whether this object can actually answer questions yet.
 *
 * The loader snippet leaves an array on `window.posthog` that queues calls, and
 * posthog-js later *replaces* it with the real instance. An integration holding
 * the array from before the swap holds something that will never answer, so the
 * only useful test is whether the methods are there.
 */
export function isUsable(posthog: PostHogLike | undefined): boolean {
  return typeof posthog?.get_session_id === 'function';
}

/**
 * Call a PostHog getter without letting the page's analytics break the page's
 * tracing. A stub throws `TypeError`, a partly-initialized instance returns an
 * empty string, and neither is worth an attribute.
 */
function readString(
  fn: (() => string) | undefined,
  receiver: PostHogLike,
): string | undefined {
  if (typeof fn !== 'function') return undefined;
  try {
    const value = fn.call(receiver);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function readSessionId(posthog: PostHogLike): string | undefined {
  return readString(posthog.get_session_id, posthog);
}

export function readDistinctId(posthog: PostHogLike): string | undefined {
  return readString(posthog.get_distinct_id, posthog);
}

/**
 * Whether a replay actually exists to link to.
 *
 * `get_session_replay_url()` composes a URL out of the session id whether or
 * not anything was recorded — replay disabled, sampled out, or simply not
 * started yet all still produce a link, and it lands on an empty player. Only
 * an affirmative answer counts, so an instance too old or too stubbed to say
 * produces no link rather than a confident wrong one.
 */
export function isRecording(posthog: PostHogLike): boolean {
  try {
    if (typeof posthog.sessionRecordingStarted === 'function') {
      return posthog.sessionRecordingStarted() === true;
    }
    // Older builds without the public method. Reading the recorder's own flag
    // is a fallback, not the contract.
    return posthog.sessionRecording?.started === true;
  } catch {
    return false;
  }
}

export function readReplayUrl(posthog: PostHogLike): string | undefined {
  if (!isRecording(posthog)) return undefined;
  const fn = posthog.get_session_replay_url;
  if (typeof fn !== 'function') return undefined;
  try {
    // `withTimestamp` is the whole point: a link to the session is a video to
    // scrub through, a link to the second the error fired is an answer.
    const value = fn.call(posthog, { withTimestamp: true });
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An evaluated flag value.
 *
 * `false` is an answer — "this person is not in the variant" — and is kept as a
 * boolean so a query can ask for it. Only `undefined`, meaning PostHog has no
 * opinion yet, is dropped: an attribute that says nothing is worse than an
 * absent one.
 */
export function readFeatureFlag(
  posthog: PostHogLike,
  key: string,
): string | boolean | undefined {
  const fn = posthog.getFeatureFlag;
  if (typeof fn !== 'function') return undefined;
  try {
    const value = fn.call(posthog, key);
    if (value === undefined) return undefined;
    // `true`/`false` for a boolean flag, the variant name for a multivariate one.
    return typeof value === 'boolean' ? value : String(value);
  } catch {
    return undefined;
  }
}
